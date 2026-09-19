---
status: active
type: feature
---

# Spec 4 - App Version Lock

## Summary

For an app whose content Steam alone updates, App Version Lock pins a Steam app to its installed build and prevents Steam from updating it. The feature rewrites the app's manifest metadata so Steam treats the pinned build as current, and it exposes `Lock`, `Unlock`, and `Refresh` actions through a library context menu and a settings panel, with `Restore All` in the panel. It also marks a locked app with a `Locked` badge on the app's library game page.

## Motivation

Steam updates an app to the latest build whenever it can, and the built-in "only update this app when I launch it" setting still applies the update at launch. Some users keep a working build to maintain their mods, to cope with limited network bandwidth, or to preserve a stable game environment; an update destroys that carefully maintained setup.

The fix is used where the user already is, in the Steam library while the client runs, so it is delivered inside the client rather than beside it. An external program would pull the user out of the client and require Steam to close before the program can edit the appmanifest, the file that records the installed build.

Millennium injects React UI into the desktop Steam client, so the feature offers `Lock`, `Unlock`, and `Refresh` in the library context menu and a settings panel. For an app whose content Steam alone updates, the feature holds the installed build in place and keeps it launchable.

## Design

### Steam Update Mechanism

Steam records each installed app's local build in `appmanifest_<appid>.acf`: `StateFlags`, `buildid`, and the manifest ID of every depot under `InstalledDepots`. On an update check, the client compares those values against the latest app info in PICS, the product-info store the client refreshes on demand. When the latest `buildid` or a depot manifest differs from the local value, Steam queues an update; the built-in "only update this app when I launch it" setting defers that queue but still applies it at launch.

The feature bypasses the comparison with one named invariant, the **update-state invariant**: the appmanifest must hold the client's current build state and no pending update. Lock and Refresh write the invariant, and [Watch and Reapply](#watch-and-reapply) reapplies it whenever Steam rewrites the appmanifest. The invariant fixes these fields:

| Field | Value |
|---|---|
| `buildid` | the client's PICS `branches.<branch>.buildid` |
| `InstalledDepots.<depot>.manifest` | the owning app's PICS `gid` for that depot |
| `StateFlags` | `4` (`FullyInstalled`) |
| `TargetBuildID` | `0` or the installed `buildid` |
| `BytesDownloaded` / `BytesStaged` | equal to `BytesToDownload` / `BytesToStage` |
| `DownloadType` | `3` |
| `UpdateResult`, `StagingSize`, `ScheduledAutoUpdate` | `0` |

A depot the appmanifest does not list is never added, and a field the invariant does not name is never rewritten. The feature reads the client's cached PICS values through the client console; [Build Info Capture](#build-info-capture) describes that capture.

### Scope

The feature supports the Windows and Linux desktop Steam clients, the platforms Millennium officially supports. It excludes SteamOS: devices that run SteamOS, such as Steam Deck and Steam Machine, are unsupported, and SteamOS Desktop Mode carries no availability guarantee. It excludes Big Screen Mode and macOS. It does not downgrade an app to an older build; [Alternatives Considered](#alternatives-considered) records that decision.

### Architecture

The feature is built on the Millennium plugin system, with a Lua backend and a TypeScript/TSX frontend; [Spec 1](001_toolchain.md) owns the language and toolchain choices. The backend owns filesystem access, the [Valve Data File (VDF)](https://developer.valvesoftware.com/wiki/VDF) codecs, the lock state, the `Lock`, `Refresh`, `Unlock`, and `Restore All` operations, and reading the appmanifest and lock file for display. The frontend owns the Steam React UI, the Steam client console, which only the frontend can reach, and the watch lifecycle, which starts and stops the per-app event handlers. The frontend calls backend methods through Millennium's `backend` FFI bridge, and the backend calls frontend methods through Millennium's `millennium.call_frontend_method` bridge; the backend never blocks on a synchronous frontend call.

### Build Info Capture

`frontend/console.ts` reads the running Steam client's cached PICS state with one Steam console command:

- `app_info_print <appid>` dumps the app info the client has cached. Valve documents `app_info_print` as displaying the Steamworks configuration the Steam servers report for the game ([Debugging the Steamworks API](https://partner.steamgames.com/doc/sdk/api/debugging), [Uploading to Steam](https://partner.steamgames.com/doc/sdk/uploading)).

The feature never issues `app_info_update`. `app_info_print` prints the client's own PICS cache, the same cache the client compares against to decide whether an update exists; a spoof that matches its `buildid` and depot manifests makes the client see no update, so the server's absolute latest is not needed. Reading the cache also avoids a network round trip and the asynchronous-refresh race in which `app_info_print` prints empty text while an `app_info_update` is in flight ([steam-for-linux#9683](https://github.com/ValveSoftware/steam-for-linux/issues/9683), [steam-for-linux#11521](https://github.com/ValveSoftware/steam-for-linux/issues/11521)).

`frontend/console.ts` samples `app_info_print` until the captured text carries the app block — the quoted numeric `appid` key and the `depots` table — and returns the raw dump. A sample that carries only the command echo, or any text without the `depots` table, is neither content nor a candidate; when no sample carries the app block before the time limit, the capture fails. The limit is undecided: it is a constant in `frontend/console.ts`, and the current working value is 2 seconds.

`SteamClient.Console` is the Steam client's console as exposed to the frontend. `frontend/console.ts` calls `SteamClient.Console.RegisterForSpewOutput(callback)` to read the console output, then `SteamClient.Console.ExecCommand(<command>)` to run the command; the returned handle's `unregister()` stops the callback. Millennium's SDK declares both methods ([Console.ts](https://github.com/SteamClientHomebrew/Millennium/blob/main/src/typescript/sdk/src/sharedjscontext/globals/steam-client/Console.ts)). Captures run one at a time, because `RegisterForSpewOutput` exposes one shared spew stream.

The base app's `app_info_print` does not always list the installed DLC depots: `Sid Meier's Civilization VI` lists them, while `The Sims 4` lists only its own depots, so a spoof built from the base dump alone leaves the `The Sims 4` DLC depots stale. `frontend/console.ts` closes that gap with `capture_build_info_set`, which calls the backend's `get_required_apps` bridge method with the base dump and receives the distinct `dlcappid` values whose depot is absent from the base `BuildInfo`. The frontend captures each returned app in turn. The base and per-app dumps travel in the `lock_app` or `refresh_app` payload's `dumps` map, keyed by app id, through Millennium's `backend` FFI bridge, which carries the payload as a single JSON string ([Millennium TS SDK](https://docs.steambrew.app/plugins/ts/Millennium)); the backend merges the depot maps and takes `buildid` from the base dump.

A set whose captures together exceed the set time limit fails. The limit is undecided: it is a constant in `frontend/console.ts`, and the current working value is 60 seconds.

A capture is first-class data, not a fallback: when any capture in the set reports `ok: false`, the frontend aborts without calling `lock_app` or `refresh_app`, so a dump that carries no app info never reaches the appmanifest.

### Background Refresh

When the Steam UI finishes loading, the backend's `on_frontend_loaded` calls `request_build_info` once for every lock record (the persisted per-app JSON file described in [Lock Data Structure](#lock-data-structure)). `request_build_info` runs on the frontend and calls `capture_then_refresh`. On a successful capture the frontend passes the dump to `refresh_app` for the same app, so the backend rewrites the appmanifest and updates the record's `locked_build` and `refreshed_at`. On a failed capture the frontend leaves the lock unchanged. The trigger is the Steam UI load, the object is every lock record, and the use is to roll a locked app forward to the client's latest cached build without a user action. The backstop timer (see [Watch and Reapply](#watch-and-reapply)) runs the same capture-and-refresh pass on a fixed interval.

### Injection and Validation

`frontend/console.ts` builds every console command from a validated numeric `appid`, and it never interpolates user text into a command. The backend independently checks that every `appid` it receives is a numeric string before it touches state or paths; the check lives in `main.lua`. The backend treats the captured dump as untrusted input: `buildinfo.lua` extracts the numeric-keyed app block, parses it with the VDF codec of `vdf.lua`, and rejects a dump that fails strict validation before any value reaches the appmanifest.

### Lock Operation

The backend locates the app's `appmanifest_<appid>.acf` (see [Data Discovery](#data-discovery)) and reads its `StateFlags`. It locks the app only when `StateFlags` is exactly `4` (`FullyInstalled`) or `6` (`FullyInstalled | UpdateRequired`), so a mid-download, running, or otherwise incomplete app is never locked. The accepted values are a whitelist in `backend/lock.lua`; `20` (`UpdateOptional`) and `68` (`SharedOnly`) are not yet in it.

The backend records the file's verbatim text as the `original` field of the lock record (the persisted JSON file described in [Lock Data Structure](#lock-data-structure)). It writes the update-state invariant into the appmanifest, using the merged depot manifests the base and DLC captures supply, and stores the same `buildid` and the depot manifests restricted to the appmanifest's `InstalledDepots` in the record's `locked_build` field. A capture can carry a depot the appmanifest does not install, because the base PICS lists other platforms and a DLC app's PICS lists its other language depots; the record keeps only the installed depots.

The frontend reads the app's current auto-update behavior from `AppDetails.eAutoUpdateValue` (`EAppAutoUpdateBehavior`), through `window.appDetailsStore.GetAppDetails(...)` with `window.appDetailsStore.GetAppData(...).details` and then `window.appStore.GetAppOverviewByAppID(...)` as fallbacks, sends it in the `lock_app` payload, and, after a successful lock, sets the behavior to `Launch` through `SteamClient.Apps.SetAppAutoUpdateBehavior(appid, Launch)`. It then starts watching the app (see [Watch and Reapply](#watch-and-reapply)).

The behavior change matters because Steam's `Always` value schedules background updates that never pass through a launch action; setting `Launch` turns every update into a launch-time action, which the watch can intercept. When the frontend cannot read the current value, it aborts the lock, the same as a failed capture, so the original value is never lost. When the post-lock behavior write fails, the frontend rolls the lock back by calling `unlock_app` and reports the failure.

### Refresh Operation

The feature re-captures the current PICS state for an already locked app, including the owning apps of any installed depot the base PICS omits, and rewrites the appmanifest to the update-state invariant — the same values the reapply path enforces. It updates the record's `locked_build` and `refreshed_at`, restricting `locked_build`'s depots to the installed depots, and keeps watching the app. The backend parses each captured dump against its app's branch through `buildinfo.parse`, merges them through `buildinfo.merge`, and takes `buildid` from the base app's dump; [Function List](#function-list) fixes the branch rule, and Lock and Refresh share it.

When the appmanifest write fails, the feature restores the record's `locked_build`, `refreshed_at`, and `manifest_path` to their previous values and reports the failure, so the record keeps matching the appmanifest.

### Unlock Operation

The feature writes the record's `original` text back to the appmanifest and deletes the record. The frontend stops watching the app before it calls `unlock_app` and re-watches the app when `unlock_app` fails, so a failed unlock never leaves the app unwatched.

The frontend restores the app's auto-update behavior from the `auto_update_behavior` value in the unlock result through `SteamClient.Apps.SetAppAutoUpdateBehavior`; a record without the field skips the restore. The restore is best-effort: when the behavior write fails after the record is deleted, the frontend does not roll the deletion back, because the appmanifest already holds the `original` text. The result's `auto_update_restored` is `true` when the behavior was written or the record carried no behavior, and `false` when the write failed; the settings panel shows a warning for a `false` value, while the library context menu's `Unlock` has no persistent status area and keeps the `Launch` setting without a warning.

### Restore All Operation

The feature restores every locked app whose restore succeeds, then deletes the restored records and removes the latest captured dumps. For each record, it writes the record's `original` text back to the appmanifest and deletes the record. A record whose appmanifest cannot be written stays in place for a retry, and a record whose app is confirmed no longer installed is dropped because there is nothing to restore. A dropped record counts as neither restored nor failed.

`Restore All` changes no plugin configuration setting, but it does restore each app's pre-lock auto-update behavior, as described next.

The frontend stops watching every app before it calls `restore_all`, and re-watches each app whose record the result lists under `failed`, because a failed record stays locked. The frontend then restores each app's auto-update behavior from the result's `auto_update` list through `SteamClient.Apps.SetAppAutoUpdateBehavior`, and writes the app ids whose behavior write failed into the result's `auto_update_failed`. The restore is best-effort: when a behavior write fails after its record is deleted, the frontend does not roll the deletion back, because the appmanifest already holds the `original` text. The settings panel includes the failed app ids in its status message.

### Watch and Reapply

The lock is enforced by reapplying the spoof — the update-state invariant written into the appmanifest — not by file permissions. The frontend watches each locked app and asks the backend to reapply whenever Steam rewrites its appmanifest.

The frontend rebuilds the watch set at startup and on every reapply or refresh pass: `frontend/index.tsx` calls `sync_watches` when the plugin loads, and `reapply_all` and `refresh_all` call `sync_watches` before they act. `sync_watches` reads the persisted lock records through `list_locked`, calls `watch_app` for each record's appid, and ensures the global handlers and the backstop timer — a fixed-interval refresh timer (see below) — run; it retries a failed or non-array `list_locked` response a bounded number of times. The retry count and interval are undecided: they are constants in `frontend/watch.ts`, and the current working values are 5 attempts and 1 second.

- `SteamClient.Apps.RegisterForAppOverviewChanges` and `SteamClient.Apps.RegisterForAppDetails(appid)` fire when a locked app's state changes; the handler calls the backend's `reapply_app` method.
- `SteamClient.Apps.RegisterForGameActionStart` fires when a launch or update action targets a locked app; the handler cancels the action with `SteamClient.Apps.CancelGameAction`, reapplies the spoof, and issues the action again. When the cancel fails, it reapplies and lets the action proceed.
- `SteamClient.System.RegisterForOnResumeFromSuspend`, opening the settings panel, and opening the library context menu each reapply opportunistically.
- A backstop timer captures and refreshes every watched app on a fixed interval, so a lock the client later moves ahead is rolled forward without a user action; a capture that fails falls back to reapplying the stored spoof. The interval is undecided: it is a constant in `frontend/watch.ts`, and the current working value is 1 hour. The interval must be long enough to be negligible and short enough to bound how long a lock lags the client's cached build.

The backend's `reapply_app` reads the appmanifest and, when any field of the update-state invariant differs from the intended value, rewrites the spoof through the appmanifest's temporary-file-and-rename path. A recorded depot the appmanifest does not install is ignored, because the record holds only the installed depots; an installed depot the record does not list is ignored, because there is no captured manifest to write; a recorded installed depot whose manifest is missing or mismatched forces a rewrite. On its first pass over a legacy record, `reapply_app` drops the recorded depots the appmanifest does not install and persists the trimmed record. Reapplies for one app are serialized. Before it writes, `reapply_app` re-reads the lock record and aborts when the record is gone, so it never rewrites an appmanifest for a record `Unlock` or `Restore All` has already removed. When the appmanifest is gone because the app was uninstalled, `reapply_app` returns `code = "not_installed"`; the frontend stops watching the app only on that signal and leaves the record in place. When the app was moved, the backend re-runs discovery and writes the new path back into the record. On `not_installed`, the frontend stops watching the app but the backend keeps the record by design, so the library context menu still marks the app as locked until the user removes the record.

### Data Discovery

The backend treats the record's `manifest_path` as a cache. Before a `Refresh`, `Unlock`, `Reapply`, or `Restore All` touches an appmanifest, the backend validates the cached path: the file exists, is named `appmanifest_<appid>.acf`, and carries the same `appid`. When the cached path fails validation — for example after the user moves the app's install directory — the backend re-runs discovery, writes the new path back into the record, and continues.

Discovery reads the Steam root directory from `MILLENNIUM__STEAM_PATH`, unions the library paths in `steamapps/libraryfolders.vdf` and `config/libraryfolders.vdf` with the Steam root directory, sorts the candidates by normalized path, and returns the first existing `steamapps/appmanifest_<appid>.acf`. Lock runs discovery directly, because no record exists yet.

When discovery finds no path, the operation fails: a `Refresh`, `Unlock`, or `Restore All` treats the app as no longer installed only when discovery could run, and returns an error that keeps the record when `MILLENNIUM__STEAM_PATH` is unavailable and discovery cannot run.

### Data Migration

The data root directory is user-selectable. Changing the data root directory always migrates it. The backend validates the new path (absolute, distinct from and not nested with the current data root directory, creatable, writable), copies `locks/` into it, verifies that every copied `.lock` parses and carries its required fields, persists the new root path through Millennium's config API, and only then deletes the old `locks/`.

The migration moves lock records only; a captured dump lives only in the operation that captured it, so the migration touches nothing else. A failure before the new root path is persisted leaves the old root directory intact and removes the partial copy. A failure to delete the old `locks/` after the new root path is persisted does not roll the migration back; the result carries a warning. While a migration runs, the backend rejects reads and writes of the lock data.

### Persistent State

The feature stores each locked app as one self-contained JSON file, `<data_root>/locks/<appid>.lock`; [Lock Data Structure](#lock-data-structure) fixes its fields. The embedded `original` text lets Unlock and Restore All restore the app without a separate backup file.

### User Interface

A library context menu adds `Lock`, `Unlock`, and `Refresh` for the selected app and marks a locked app. A settings panel lists every locked app; an installed record offers `Refresh` and `Unlock`, while a record whose app is no longer installed offers only `Unlock`, shown with a warning, and `Unlock` removes that orphaned lock record when discovery can run and finds no appmanifest.

The panel decides installed state per record by reading `window.appStore.GetAppOverviewByAppID(...).local_per_client_data.installed`. The panel offers a data-directory control (a path field with `Change`, `Reset to Default`, and `Open Folder`) and `Restore All`. `Open Folder` is a frontend call to `SteamClient.System.OpenLocalDirectoryInSystemExplorer`.

The panel supports multi-select and batch `Refresh` and `Unlock` over the selected records.

The app's Properties window carries a `Steam App Verlock` tab for the app the window shows. The tab shows the lock state, then the lock and refresh times: those times always render, an unlocked app shows a gray `N/A`, and a locked app with no refresh yet shows `Not yet` in the accent color. The times render through `frontend/time.ts` with the year always included (see [Game Page Badge](#game-page-badge)). Below a divider and a `Lock Snapshot` heading, the tab always shows the app id, the locked `buildid`, the depot manifests under a `Depots` list that is collapsed until clicked, and the auto-update behavior; the values a lock record supplies render as a gray `N/A` when there is no record, and these static values render without the accent color. The section carries an `Appmanifest` button that shows the appmanifest's text in a native modal, and, while a record exists, a `Lock File` button that shows the lock record the same way to its left. The `Lock File` button is absent when there is no record. The tab offers `Lock` when the app is not locked and `Refresh` and `Unlock` when it is. It reads the same `list_locked` records and calls the same shared actions as the context menu, and it no-ops when the window's DOM shape changes. It matches the client's native dialog styling through the method of [Spec 7](007_native-ui-style-alignment.md).

A user-initiated operation that fails reports its failure instead of staying silent: `Lock`, `Refresh`, `Unlock`, the batch and `Restore All` actions, and the data-directory change each open the same native modal, which names the operation and shows the error text with a `Copy error` button; a second failure replaces the open dialog instead of stacking. A warning that degrades but lets the operation complete — a failed action cancel or a failed auto-update restore — shows a transient toast instead. A successful user-initiated `Lock`, `Refresh`, or `Unlock` shows a transient toast that names the app, and the settings panel's batch `Refresh` and `Unlock` show one summary toast for the batch. An `Unlock` whose auto-update restore failed keeps only its warning toast, and `Restore All` keeps its inline status message without a success toast. Background work that has no user gesture, such as the reapply path and the startup sync, stays log-only.

The failure dialog, the file content dialog, the warning toast, and the success toast are built by `frontend/notify.tsx` from the `showModal`, `ConfirmModal`, and `toaster` exports of the Millennium SDK; `frontend/errors.ts` normalizes an error value for both the dialog and the log. The content dialog and the read-failure dialog receive the Properties popup window as the modal's `parent` (see [View File](#view-file)).

### Game Page Badge

The feature marks a locked app on its library game page with a `Locked` badge. The badge sits after the last cell of the page's play bar — the row that carries the native `LAST PLAYED` and `PLAY TIME` cells — and it shows a lock icon, the `Last refreshed` label, and the app's refresh time. The badge renders nothing while the page's app is not locked.

`frontend/gamepage.tsx` owns the badge. It resolves the main window's document from `g_PopupManager`'s `SP Desktop_uid0` popup, with `Millennium.AddWindowCreateHook` and a one-second poll as fallbacks, and it watches that document's body with a `MutationObserver`. It reads the page's app id from the pathname's `/app/<appid>`, and, when the path carries no id, from the page's `library_hero` image, a `data-appid` element, a Steam link, or an app image URL. It marks a page as a game page when the path carries an app id or the document carries a `PLAY TIME` cell or a `library_hero` image.

The badge locates the `PLAY TIME` cell through a recorded class selector, a text match, and a `Panel`-display selector as fallbacks, samples the cell's computed label, value, and icon styles, and merges them over recorded fallback constants. The insertion point is the last cell of the play bar, not the `PLAY TIME` cell, so a page that carries more cells, such as `CLOUD STATUS` and `ACHIEVEMENTS`, keeps the badge on the same row. The badge stays the last cell: when the page renders a later cell after the badge mounts, the watcher moves the badge back to the end of the play bar. The badge sets the play bar's inline `flex-wrap` to `nowrap` while it is mounted and restores the saved value when it unmounts.

The badge reads the locked set and the record through `frontend/locked.ts` and the `list_locked` bridge method, and it subscribes to locked-set changes. It shows the `Last refreshed` label and renders the record's `refreshed_at`, falling back to `locked_at`, as the badge value through `format_client_time` of `frontend/time.ts`, and renders no value when neither is present. The date uses the client language's short month and numeric day, and it carries the year only when the date's year differs from the current year, because the badge passes `current_year_short`; the Properties tab and the settings panel request the default format, which always includes the year. The language comes from `SteamClient.Settings.GetCurrentLanguage`, mapped to a locale tag (`english` to `en`, `schinese` to `zh-CN`, otherwise `en`). The time follows the client's 24-hour clock setting: `frontend/time.ts` reads it once through the `get_clock_format` bridge method, whose backend handler reads `b24HourClock` from the per-user `sharedconfig.vdf`, because the running client exposes the setting through no API. The setting on forces 24-hour, and the setting off or absent follows the language's default; the `SteamClient.FriendSettings` and `SteamClient.Settings` change callbacks stay a best-effort live source. `frontend/time.ts` owns the clock format and the rendering, and the Properties tab and the settings panel share it for their own times. On an app change, a page change, or a disconnect, it unmounts the React root and removes the node. A game page whose DOM shape changed makes `install_gamepage_patch` mount no badge: it logs a warning once for the app and leaves the page unchanged.

### View File

The `Appmanifest` and `Lock File` buttons call the backend's `read_file` method, which resolves the file path itself and returns the file's text; the tab shows it in a native modal through the `show_text_dialog` helper of `frontend/notify.tsx`. `read_file` validates the numeric `appid` and a `target` of `appmanifest` or `lock`; for `lock` it requires a record and uses `state.path`, and for `appmanifest` it uses the record's `manifest_path` or, without a record, discovery. A read failure or a file larger than 512 KiB shows the failure dialog instead.

The `Lock File` dialog renders the record through `format_lock_text`: when the file's text parses as a JSON object, the dialog shows it pretty-printed at two spaces of indentation, and, because the pretty text differs from the file's on-disk bytes, it carries a one-line note above the text box that names the text a readability rendering. A record that does not parse as a JSON object shows the raw text with no note. The `Appmanifest` dialog shows the VDF text unchanged, because the appmanifest already spans multiple lines.

The helper builds the same `ConfirmModal` shape as the failure dialog, with a bordered scrollable text box styled after the client's System Information panel and `Copy` and `Close` buttons side by side below it, without a cancel button; `Copy` changes its own label to `Copied` for one second and leaves the dialog open. The note, when present, sits above the text box, and `Copy` copies the text box alone.

The tab passes the Properties popup's window, `document.defaultView`, as the modal's `parent`. The Millennium `showModal` falls back to its `findSP` helper when `parent` is absent, and `findSP` dereferences the gamepad navigation tree's root, which the Properties popup lacks, so an absent `parent` throws inside the host before any dialog renders. Passing the popup window skips that fallback and renders the modal in the window the tab lives in.

### Concurrency and Atomicity

The backend writes the appmanifest through a temporary file and renames it into place, so a failed write leaves the previous appmanifest intact. Every backend write operation for one app — `Lock`, `Refresh`, `Unlock`, and `Reapply` — is serialized, and `Restore All` excludes them all while it runs. The feature runs while the Steam client runs and assumes Steam rewrites the appmanifest; the watch reapplies the spoof, and the launch and update interception reapplies before the action proceeds.

### Logging

The feature records its operations through the logging mechanism of [Spec 6](006_logging.md). A record carries the level `info` for a completed state change or a batch summary, `warn` for an expected refusal or a recoverable degradation that lets the operation complete, and `error` for an I/O, parse, or persistence failure, a user-initiated operation that aborts or fails, or an uncaught exception. The backend writes its records directly; the frontend writes its own and relays each through the `append_log` bridge method of [Spec 6](006_logging.md#relay-bridge). No record carries the contents of a captured dump.

The backend records:

- `locked app <appid> at build <buildid>`, `refreshed app <appid> to build <buildid>`, and `unlocked app <appid>` at `info` for the matching operation;
- `reapplied app <appid>` at `info` when `reapply_app` rewrites the appmanifest, and no record when the appmanifest already matches;
- `restored <n> app(s), kept <m>` at `info` for a Restore All summary, and `migrated the data root to <path>` at `info` for a completed migration;
- `refused to lock app <appid>: <reason>` at `warn` for a lock the appmanifest's state forbids, and `app <appid> is no longer installed` at `warn` when discovery confirms an app is gone;
- `<operation> failed for app <appid>: <error>` at `error` for a failed read, parse, or appmanifest or record write, and `method <name> failed: <error>` at `error` when the dispatcher catches an exception.

The frontend records:

- `captured build info for app <appid>` at `info` for an accepted capture;
- `capture failed for app <appid>: <error>` at `error` for a failed capture, because the lock or refresh that requested it aborts;
- `aborted the lock for app <appid>: the auto-update behavior was unreadable` at `error` when the current behavior cannot be read, and `rolled back the lock for <appid> after the auto-update write failed` at `error` when the post-lock write fails and the lock rolls back;
- `could not cancel the action for app <appid>; reapplied and let it proceed` at `warn` when a game action cannot be cancelled;
- `could not restore the auto-update setting for app <appid>` at `warn` when a behavior restore fails but the unlock or restore completes;
- `could not read the <target> for app <appid>: <error>` at `error` when `read_file` cannot resolve or read the target file;
- `game page badge watcher installed` at `info` when `frontend/gamepage.tsx` attaches its observer to the main window, `game page badge mounted for app <appid>` at `info` when the badge mounts, and `game page badge found no anchor for app <appid>` at `warn` when a game page carries no play-bar anchor;
- `<operation> failed for app <appid>: <error>` at `error` for a failed backend call.

## Data Root Directory and Settings

The feature resolves one root directory. The data root directory holds the lock records and resolves in three steps:

- the Millennium config API key `data_root`, when set; `is_default` — which reports whether the data root directory resolved from the OS-conventional path — is `false`;
- otherwise the OS-conventional path, when the OS environment variables that anchor it can be determined (`LOCALAPPDATA` on Windows; `XDG_DATA_HOME`, or `HOME` when `XDG_DATA_HOME` is unset, on Linux): `%LOCALAPPDATA%\steamapp-verlock\` on Windows and `${XDG_DATA_HOME:-$HOME/.local/share}/steamapp-verlock/` on Linux; `is_default` is `true`;
- otherwise `MILLENNIUM__CONFIG_PATH/steamapp-verlock/`, or `millennium.get_install_path()` joined with `steamapp-verlock/` when `MILLENNIUM__CONFIG_PATH` is missing; `is_default` is `false`.

It is `true` only for the second step, and `false` for a configured root and for the config-path fallback.

Under the data root directory, `locks/<appid>.lock` holds one locked-app record. The settings panel never writes config directly: it calls the backend's `set_data_root`, and the backend performs the config-API write through `migrate.lua`. `set_data_root` with an empty path resets to the OS-conventional default: the backend migrates to `paths.defaults().data_root` when that differs from the current root and clears the `data_root` config key through `clear_data_root_config`, so the next resolve returns to the default.

## Lock Data Structure

A lock record is one JSON file, `<data_root>/locks/<appid>.lock`:

```json
{
  "version": 1,
  "appid": "<appid>",
  "name": "<display name>",
  "manifest_path": "<absolute path to appmanifest_<appid>.acf>",
  "locked_at": 1726000000,
  "refreshed_at": 1726003600,
  "auto_update_behavior": 0,
  "locked_build": { "buildid": "<id>", "depots": { "<depot id>": "<manifest id>" } },
  "original": "<verbatim VDF text of the pre-lock appmanifest>"
}
```

| Field | Type | Meaning |
|---|---|---|
| `version` | `number` | Schema version, an integer; the backend refuses a record whose version is not `1` on load. |
| `appid` | `string` | Numeric Steam app id. |
| `name` | `string` | App display name at lock time. |
| `manifest_path` | `string` | Absolute path to the appmanifest. A cache only: the feature validates it before use and re-runs discovery, updating the record, when it no longer names the app's appmanifest. |
| `locked_at` | `number` | Lock time as a Unix timestamp in seconds, an integer. |
| `refreshed_at` | `number`, optional | Time of the last refresh, as a Unix timestamp in seconds, an integer. |
| `auto_update_behavior` | `number`, optional | The app's `EAppAutoUpdateBehavior` value at lock time, used to restore the setting on `Unlock` and `Restore All`. When present, it must be a number, or the backend treats the record as invalid on load. A record without the field skips the restore. |
| `locked_build` | `BuildInfo` (see [Shared Types](#shared-types)) | The `buildid` and the installed depots' manifests written into the appmanifest; a captured depot the appmanifest does not install is absent. |
| `original` | `string` | The pre-lock appmanifest text, stored verbatim. It must be non-empty, or the backend treats the record as invalid on load. |

## Implementation Plan

The plugin adds these files. The file layout follows the toolchain in [Spec 1](001_toolchain.md).

| File | Role |
|---|---|
| `millennium.toml` | Plugin manifest |
| `package.json`, `bun.lock`, `tsconfig.json` | Frontend toolchain |
| `backend/main.lua` | Plugin entry, lifecycle, RPC dispatch |
| `backend/vdf.lua` | Text VDF codec |
| `backend/buildinfo.lua` | Dump cleaning, parsing, validation |
| `backend/acf.lua` | Appmanifest read, field update, write |
| `backend/lock.lua` | Lock, refresh, unlock, and Restore All operations |
| `backend/state.lua` | Locked-app records |
| `backend/paths.lua` | Data root directory resolution, path validation, appmanifest discovery |
| `backend/migrate.lua` | Data root directory migration |
| `backend/clock.lua` | 24-hour clock preference from the Steam config |
| `frontend/index.tsx` | Plugin entry and UI registration |
| `frontend/bridge.ts` | Backend RPC wire framing; single JSON-string payloads, with zero-argument methods carrying no payload |
| `frontend/locked.ts` | Reactive locked-app-id store shared by the menu and settings panel |
| `frontend/console.ts` | PICS capture |
| `frontend/watch.ts` | App event watch and reapply triggers |
| `frontend/actions.ts` | Shared `Lock`, `Refresh`, and `Unlock` flows used by the menu and the Properties tab |
| `frontend/errors.ts` | Error-value normalization for the failure dialog and its log record |
| `frontend/notify.tsx` | Failure dialog, warning toast, and success toast |
| `frontend/menu.tsx` | Library context menu |
| `frontend/settings.tsx` | Settings panel |
| `frontend/properties.tsx` | App Properties window tab |
| `frontend/gamepage.tsx` | Game page badge |
| `frontend/time.ts` | Shared client date and time formatting |

### Function List

#### Shared Types

- `AppId = string` — a Steam app id written as a numeric string.
- `Ack = { ok: boolean; error?: string; code?: string }` — the result envelope a backend operation that reports its outcome returns. It wraps the operations that change state; `list_locked` returns its records directly when it can and carries the error form of the envelope only while a data root migration runs, and `get_data_root` always returns its data directly and never carries the envelope.
- `LockResult = Ack & { record?: LockedAppRecord }` — success carries the locked-app record.
- `RefreshResult = Ack` — the refresh result.
- `UnlockResult = Ack & { auto_update_behavior?: number; auto_update_restored?: boolean }` — the unlock result; success carries the stored auto-update behavior when the record has one, and the frontend sets `auto_update_restored` to `false` when restoring that behavior failed (it is `true` when the behavior was written or the record carried no behavior).
- `CaptureResult = { ok: true; appid: AppId; dump: string } | { ok: false; error: string }` — success carries the captured dump; failure carries an error.
- `CaptureSet = { ok: true; dumps: Record<AppId, string> } | { ok: false; error: string }` — success carries the base dump and each required DLC app's dump, keyed by app id; failure carries an error.
- `RequiredAppsResult = Ack & { apps?: AppId[] }` — the `get_required_apps` result; success carries the distinct `dlcappid` values whose installed depot the base `BuildInfo` omits.
- `BuildInfo = { buildid: string; depots: Record<string, string> }` — a captured or spoofed build state.
- `BadgeStyle = { label: CSSProperties; value: CSSProperties; icon: { color: string; width: string; height: string; opacity: number } }` — the game page badge's sampled label, value, and icon styles; `CSSProperties` is React's style type.
- `ClockFormat = { locale: string; hour12: boolean | undefined }` — the plugin's shared date and time inputs; `hour12` is `false` when the client's 24-hour clock setting is on and `undefined` when it is off or unread.
- `ClientTimeOptions = { current_year_short?: boolean }` — the date options `format_client_time` takes; `current_year_short` omits the year for the current year, and its absence keeps the year.
- `LockedAppRecord = { version: number; appid: AppId; name: string; manifest_path: string; locked_at: number; refreshed_at?: number; auto_update_behavior?: number; locked_build: BuildInfo; original: string }` — the persisted locked-app record.
- `DataRoots = { data_root: string; is_default: boolean }` — the resolved data root directory; `is_default` reports whether it resolved from the OS-conventional path (see [Data Root Directory and Settings](#data-root-directory-and-settings)).
- `MigrateResult = Ack & { data_root?: string; warning?: string; is_default?: boolean }` — the migration result; success carries the new data root directory, `warning` carries a non-fatal cleanup failure, and `is_default` is `true` when an empty `set_data_root` reset the root to the OS-conventional default.
- `PathsResult = Ack & { appmanifest?: string; lock?: string }` — the resolved file paths for one app; `appmanifest` is the appmanifest path and `lock` is the lock record path, and a path that cannot be resolved is absent.
- `FileContentResult = Ack & { content?: string }` — the `read_file` result; success carries the file's text.
- `RestoreResult = Ack & { restored: number; failed: AppId[]; auto_update?: { appid: AppId; behavior: number }[]; auto_update_failed?: AppId[] }` — the `Restore All` result; `restored` counts the apps put back, `failed` lists the ones left in place, a record dropped as no longer installed counts as neither, `auto_update` lists the auto-update behaviors the frontend restores, and the frontend sets `auto_update_failed` to the app ids whose behavior write failed.

#### Backend

`backend/main.lua`

- `on_load() -> void` — initialize the feature and signal readiness to Millennium.
- `on_frontend_loaded() -> void` — run once the Steam UI has loaded; call `request_build_info` for every lock record.
- `on_unload() -> void` — release resources when the plugin unloads.
- `dispatch(name: string, payload: table) -> table` — internal/test interface; route a bridge method name to its handler and return the handler's result as-is; a handler that raises an error returns an `Ack` error envelope.
- `handlers` — internal/test interface; the table that maps each bridge method name to its handler.
- `get_required_apps(payload: table) -> RequiredAppsResult` — parse `payload.dump` against the app's branch, read the appmanifest's `InstalledDepots`, and return the distinct `dlcappid` values whose depot is absent from the parsed `BuildInfo`; use discovery for an app with no lock record.
- `set_data_root(payload: table) -> MigrateResult` — migrate the data root directory to `payload.path`; an empty path resets to the OS-conventional default (see [Data Root Directory and Settings](#data-root-directory-and-settings)).
- `clear_data_root_config() -> void` — internal; clear the `data_root` config key through `config.delete`, or through `config.set("data_root", nil)` when `config.delete` is unavailable.
- `get_clock_format(payload: table) -> Ack & { is_24h?: boolean }` — read the client's 24-hour clock preference; `is_24h` is absent when the preference cannot be read.

`backend/vdf.lua`

- `parse(text: string) -> state: table?, err: string?` — decode text VDF into a table; return an error when the text is malformed.
- `serialize(state: table) -> text: string` — encode a table as text VDF.

`backend/buildinfo.lua`

- `clean(raw: string) -> text: string` — return the numeric-keyed app block from a captured dump, stripping the command echo, any line prefix, missing newlines, and trailing console noise; return an empty string when no block is present.
- `parse(text: string, branch?: string) -> info: BuildInfo?, err: string?` — read the `buildid` and the depot manifests from the cleaned dump against `branch`; the branch comes from the appmanifest's `BetaKey` and defaults to `public` when `BetaKey` is absent or empty, and both Lock and Refresh share this rule.
- `validate(info: BuildInfo) -> ok: boolean, err: string?` — reject a dump that fails strict validation.
- `merge(infos: BuildInfo[]) -> info: BuildInfo?, err: string?` — take `buildid` from the first entry, which is the base app's `BuildInfo`, and return the union of every entry's `depots`, where the base's value wins a depot both it and a later entry carry.

`backend/acf.lua`

- `read(path: string) -> state: table?, err: string?` — read an appmanifest into a table.
- `set(state: table, key: string, value: string) -> void` — set one field in the appmanifest table.
- `write(path: string, state: table) -> ok: boolean, err: string?` — write the table back through a temporary file and a rename.

`backend/lock.lua`

- `lock(appid: AppId, info: BuildInfo, auto_update_behavior?: number) -> LockResult` — record the current appmanifest's verbatim text in the record's `original` field, store `auto_update_behavior`, write the update-state invariant into the appmanifest, and store `info`'s `buildid` and its installed depot manifests in the record's `locked_build` field; the frontend starts watching the app after a successful lock.
- `refresh(appid: AppId, info: BuildInfo) -> RefreshResult` — write the update-state invariant into the appmanifest and update `locked_build` and `refreshed_at`, restricting `locked_build`'s depots to the installed depots.
- `unlock(appid: AppId) -> UnlockResult` — write the record's `original` back to the appmanifest and delete the record; the result carries the record's `auto_update_behavior` when present. The frontend owns the watch lifecycle.
- `reapply(appid: AppId) -> Ack` — rewrite the spoof when the appmanifest leaves the update-state invariant.
- `required_apps(appid: AppId, info: BuildInfo) -> AppId[]?, err: string?` — read the appmanifest — through `state.read` for a locked app, through discovery otherwise — and return the sorted distinct `dlcappid` values whose installed depot id is absent from `info.depots`; return an empty list when every installed depot is covered.
- `restore_all() -> RestoreResult` — restore every recorded app and delete the restored records; the result carries the restored records' `auto_update_behavior` values.

`backend/state.lua`

- `list() -> records: LockedAppRecord[]?, err: string?` — return every locked-app record; while a data root migration runs, return an error instead of records.
- `read(appid: AppId) -> record: LockedAppRecord?, err: string?` — read one record.
- `write(record: LockedAppRecord) -> ok: boolean, err: string?` — add or update one record.
- `remove(appid: AppId) -> void` — drop one record.
- `path(appid: AppId) -> path: string` — return one record's file path.
- `valid(record: table) -> ok: boolean` — internal/test interface; report whether a decoded value is a valid `version` `1` lock record.
- `set_migrating(flag: boolean) -> void` — internal/test interface; set the migration guard that makes `list` and `read` return an error and `write` and `remove` no-op.

`backend/paths.lua`

- `resolve() -> DataRoots` — resolve the data root directory.
- `defaults() -> DataRoots` — return the OS-conventional data root directory.
- `validate(path: string) -> ok: boolean, err: string?` — validate a candidate data root path.
- `find_appmanifest(appid: AppId) -> path: string?, err: string?` — locate the appmanifest across the libraries, accepting both the object-style and the legacy string-style entries of `libraryfolders.vdf`.
- `resolve_manifest(appid: AppId, cached: string) -> path: string?, err: string?` — validate the cached path, fall back to discovery, and return the resolved path.

`backend/migrate.lua`

- `move(from: string, to: string) -> MigrateResult` — migrate the lock data to a new root directory; a failure to delete the old `locks/` after the new root path is persisted is reported in the result's `warning`.

`backend/clock.lua`

- `is_24h() -> boolean?` — read `b24HourClock` from the per-user `sharedconfig.vdf` under `MILLENNIUM__STEAM_PATH`, through the `UserRoamingConfigStore` path and the `UserLocalConfigStore` fallback, and return `nil` when the file or the value is absent.

#### Frontend

`frontend/errors.ts`

- `format_error(error: unknown): string` — normalize an `Error`, string, object, or empty value into the text shown in both the failure dialog and its log record.

`frontend/locked.ts`

- `is_locked(appid: AppId): boolean` — report whether an app id is in the local locked set.
- `subscribe_locked(listener: () => void): () => void` — subscribe to locked-set changes and return an unsubscribe function.
- `as_record_list(value: unknown): LockedAppRecord[] | null` — normalize a decoded backend response: an array stays, a keyless object without `ok` becomes an empty list, and anything else becomes `null` so a caller can tell an error envelope from an empty result.
- `sync_locked_ids(records: unknown): void` — replace the local locked set from a record list.
- `refresh_locked_ids(force = false): Promise<void>` — reload the local locked set from the backend within a cache TTL.
- `mark_locked(appid: AppId): void` — add an app id to the local locked set and notify subscribers.
- `mark_unlocked(appid: AppId): void` — remove an app id from the local locked set and notify subscribers.

`frontend/console.ts`

- `capture_build_info(appid: AppId): Promise<CaptureResult>` — run `app_info_print` and sample the spew until the app block appears, then return the raw dump; a sample without the `depots` table is not a candidate, and a capture that never sees the app block fails.
- `capture_build_info_set(appid: AppId): Promise<CaptureSet>` — capture the base app, call the backend's `get_required_apps`, capture each returned app in turn, and return the dumps keyed by app id; the required list is an array, or the keyless object the backend's `cjson` encoder produces for an empty list, and any other value is an invalid response; a failed capture fails the set, and a set that exceeds the set time limit fails.
- `capture_then_refresh(appid: AppId): Promise<void>` — call `capture_build_info_set` and, on success, pass the dumps to `refresh_app`; the background-refresh entry point.

`frontend/notify.tsx`

- `show_failure_dialog(title: string, message: string, parent?: EventTarget): void` — open the native failure modal, or replace the open one, with the message and a `Copy error` control; `parent` is the window the modal renders in, and an absent `parent` defaults to the current `window` so `showModal` never falls back to `findSP`.
- `show_text_dialog(title: string, message: string, parent?: EventTarget, note?: string): void` — open the file-content modal the same way; when `note` is present, render it as a small line above the text box, and `Copy` copies the text box alone.
- `report_failure(title: string, message: string, parent?: EventTarget): void` — record the message at `error` and open the failure modal.
- `report_warning(message: string, title?: string): void` — record the message at `warn` and show a toast.
- `report_success(message: string, title?: string): void` — show a transient success toast without a log record; a failed toast never changes the operation's result.

`frontend/watch.ts`

- `watch_app(appid: AppId): void` — start watching one locked app and reapplying its spoof on a Steam write.
- `unwatch_app(appid: AppId): void` — stop watching one app.
- `sync_watches(): Promise<void>` — read every persisted lock record, start watching each app, and ensure the global handlers and backstop timer run; retry a failed or non-array `list_locked` read a bounded number of times, with the retry count and interval undecided (their home is constants in `frontend/watch.ts`; the current working values are 5 attempts and 1 second).
- `reapply_all(): Promise<void>` — reapply every watched app's spoof and ensure the global handlers and backstop timer are running.
- `refresh_all(): Promise<void>` — capture the base app and its required DLC apps for every watched app, pass each set of dumps to `refresh_app`, and ensure the global handlers and backstop timer are running; a capture that fails falls back to `reapply`. The backstop timer calls it.
- `unwatch_all(): void` — stop watching every app, unregister the handlers that expose `unregister`, neutralize the overview callback by clearing the watch set, and stop the backstop timer.
- `read_auto_update_behavior(appid: AppId): number | undefined` — read the app's current `EAppAutoUpdateBehavior` from the app details store (`window.appDetailsStore.GetAppDetails`), with `GetAppData(...).details` and the app overview store as fallbacks.
- `apply_auto_update_behavior(appid: AppId, behavior: number): boolean` — write one auto-update behavior through `SetAppAutoUpdateBehavior` and report whether the write succeeded.
- `app_name(appid: AppId, fallback?: string): string` — return the app's `display_name` from the app store, otherwise a non-empty `fallback`, otherwise `app <appid>`; the settings panel passes the lock record's `name` as the fallback.
- `unwatch_then_unlock(appid: AppId): Promise<UnlockResult>` — stop watching the app, call `unlock_app`, re-watch the app when the call fails, restore the returned `auto_update_behavior`, and set the result's `auto_update_restored` from the restore outcome.
- `unwatch_all_then_restore(appids: AppId[]): Promise<RestoreResult>` — stop watching every app, call `restore_all`, re-watch the records the result lists under `failed` (or every given app when the call fails), restore the returned `auto_update` behaviors, and record the failed app ids in the result's `auto_update_failed`.

`frontend/actions.ts`

- `lock_app(appid: AppId, parent?: EventTarget): Promise<void>` — capture the build info set, read the current auto-update behavior, call the backend's `lock_app` with the dumps, set the behavior to `Launch`, start watching the app, and show a success toast; a failed behavior write rolls the lock back without a success toast, and `parent` is the modal window for its failure dialog.
- `refresh_app(appid: AppId, parent?: EventTarget): Promise<void>` — capture the build info set, call the backend's `refresh_app` with the dumps, mark the app locked again on success so a subscribing UI reloads its record, and show a success toast.
- `unlock_app(appid: AppId, parent?: EventTarget): Promise<void>` — stop watching the app, call `unlock_app`, clear the local locked mark on success, and show a success toast unless the auto-update restore failed and only the warning toast shows.

`frontend/properties.tsx`

- `install_properties_patch(): () => void` — install the App Properties hook and return a disposer; a missing `AddWindowCreateHook` or a changed dialog shape makes the tab a no-op.
- `VerlockTabContent({ appid }): JSX.Element` — the tab content: the app's lock record, status, locked build, and actions.
- `format_time(value: number | undefined, format: ClockFormat): string | null` — internal/test interface; render a Unix timestamp through `format_client_time`, or `null` when it is absent, so the tab chooses between `N/A` and `Not yet`.
- `format_lock_text(content: string): string` — internal/test interface; pretty-print a lock record's JSON at two spaces of indentation, or return the text unchanged when it does not parse as a JSON object.
- `behavior_label(value: number | undefined): string` — internal/test interface; name an `EAppAutoUpdateBehavior` value.
- `find_record(records: LockedAppRecord[] | null, appid: AppId): LockedAppRecord | null` — internal/test interface; select the record for one app id.

`frontend/gamepage.tsx`

- `install_gamepage_patch(): () => void` — resolve the main window document, watch it for game pages, and return a disposer that stops the watcher and removes the badge.
- `LockBadge({ appid, style }): ReactNode` — the game page badge: subscribe to the locked set and the clock format, read the record's refresh time, and render the lock icon, the `Last refreshed` label, and the refresh time, or nothing while the app is not locked.
- `appid_from_path(path: string): AppId | undefined` — internal/test interface; read the app id from a `/app/<appid>` path.
- `appid_from_image_src(src: string): AppId | undefined` — internal/test interface; read the app id from a `library_hero` image URL.
- `merge_style(sampled: Partial<BadgeStyle> | null, fallback: BadgeStyle): BadgeStyle` — internal/test interface; merge a sampled style over the fallback field by field.

`frontend/time.ts`

- `install_clock_format(): void` — read `SteamClient.Settings.GetCurrentLanguage` and register the `SteamClient.FriendSettings` clock callback once.
- `subscribe_clock_format(listener: () => void): () => void` — subscribe to clock-format changes and return an unsubscribe function.
- `current_clock_format(): ClockFormat` — internal/test interface; the current language and 24-hour clock inputs.
- `format_client_time(value: number | undefined, format: ClockFormat, options?: ClientTimeOptions, now?: Date): string | undefined` — internal/test interface; render a Unix timestamp as the client language's short date and time, include the year unless `current_year_short` omits it for the current year, or return `undefined` when the value is absent or non-positive; `now` is a test seam for the current-year check.

#### Bridge

frontend to backend (`backend` FFI bridge)

- `get_required_apps(payload: { appid: AppId; dump: string }): Promise<RequiredAppsResult>` — parse the base dump and return the distinct `dlcappid` values whose installed depot the base `BuildInfo` omits; the frontend then captures each returned app.
- `lock_app(payload: { appid: AppId; dumps: Record<AppId, string>; auto_update_behavior?: number }): Promise<LockResult>` — lock the app and store the app's current auto-update behavior; the backend builds each `BuildInfo` through `buildinfo.clean`, `buildinfo.parse`, and `buildinfo.validate`, merges them through `buildinfo.merge`, and then calls `lock.lua`'s `lock`.
- `refresh_app(payload: { appid: AppId; dumps: Record<AppId, string> }): Promise<RefreshResult>` — refresh a locked app; the backend merges the payload's dumps the same way and then calls `lock.lua`'s `refresh`.
- `unlock_app(payload: { appid: AppId }): Promise<UnlockResult>` — unlock the app; the result carries the stored `auto_update_behavior` when present.
- `list_locked(): Promise<LockedAppRecord[] | Ack>` — return the locked-app records for the UI directly; a migration in progress makes it return an error envelope instead of records.
- `restore_all(): Promise<RestoreResult>` — restore every locked app and delete the restored records.
- `get_data_root(): Promise<DataRoots>` — return the resolved data root directory directly.
- `get_paths(payload: { appid: AppId }): Promise<PathsResult>` — return the app's appmanifest path — from the lock record when one exists, otherwise from discovery — and the lock record path when a record exists.
- `read_file(payload: { appid: AppId; target: "appmanifest" | "lock" }): Promise<FileContentResult>` — resolve the target file and return its text for the tab's content dialog; a file larger than 512 KiB is refused.
- `set_data_root(payload: { path: string }): Promise<MigrateResult>` — migrate the data root directory to `path`; an empty `path` resets to the OS-conventional default and clears the `data_root` config key (see [Data Root Directory and Settings](#data-root-directory-and-settings)).
- `reapply_app(payload: { appid: AppId }): Promise<Ack>` — reapply a locked app's spoof when its appmanifest no longer matches; return `code = "not_installed"` when the app is gone.
- `get_clock_format(): Promise<Ack & { is_24h?: boolean }>` — read the client's 24-hour clock preference from the Steam config; `is_24h` is absent when the preference cannot be read.

backend to frontend (`millennium.call_frontend_method`)

- `request_build_info(appid: AppId): void` — ask the frontend to capture a dump; on success the frontend passes the dump to `refresh_app`.

## Risks

- `SteamClient.Console` is an undocumented client API, and a Steam client update can change or remove it — prevention: console access is confined to `frontend/console.ts`, and a missing console method returns a runtime `CaptureResult` error before any lock record is written.
- The client's cached PICS can lag the server, so the lock mirrors a build the client has not yet replaced — prevention: the lock's effect is defined against the client's own cache, the same source the client compares against, and the backstop refresh plus the client's own PICS refresh bound the lag.
- The client's PICS cache can lack the app block, so the capture never sees it — prevention: the capture fails with an error and the frontend aborts without locking, and a later Refresh retries.
- The base app's PICS can omit an installed DLC depot, so a spoof built from the base dump alone leaves that depot at its stale manifest and Steam queues a manifest download — prevention: `get_required_apps` names the owning apps, the frontend captures each one, and the backend merges the depot maps before it writes.
- A capture set grows with the installed DLC count and can exceed the time budget — prevention: the set time limit aborts the capture, and the frontend aborts without calling `lock_app` or `refresh_app`.
- The spoof can inject a PICS-only depot into `InstalledDepots`, so Steam treats an uninstalled depot as installed — prevention: `apply_spoof` only overwrites a depot the appmanifest already lists, and the record keeps only the installed depots.
- The requested branch can differ from the branch the captured dump carries, so the parser reads the wrong `buildid` or depot manifests — prevention: the branch comes from the appmanifest's `BetaKey` and defaults to `public`, and the parser falls back to `public` branch data when the requested branch is absent.
- A launch or update action can begin between Steam's rewrite of the appmanifest and the reapply, so an update can still start — prevention: the action interception cancels, reapplies, and re-issues the action, and the backstop interval bounds how long a lost spoof survives.
- An in-flight reapply can race `Unlock` or `Restore All` and rewrite an appmanifest for a record that was just removed — prevention: reapply re-reads the record before it writes and aborts when the record is gone, and per-app write operations are serialized.
- The captured console spew can be truncated or interleaved with unrelated output, so the dump fails to parse — prevention: `buildinfo.clean` extracts the numeric-keyed app block, strict validation rejects a malformed dump before any value reaches the appmanifest, and a failed capture aborts the operation.
- The app's original auto-update value can be unreadable, so the feature would lose the ability to restore it — prevention: a failed read aborts the lock before any record or appmanifest change, so the stored value is never missing.
- Restoring an app's auto-update behavior can fail after the lock record is deleted, so the setting stays at `Launch` with no record to retry from — prevention: the restore is best-effort; `Unlock` and `Restore All` do not roll back a deleted record. The settings panel surfaces the failure through the unlock result's `auto_update_restored` and the restore result's `auto_update_failed`; the library context menu's `Unlock` keeps the `Launch` setting without a warning.
- The app event APIs are undocumented client internals and can change across client versions, so a missed event leaves only the backstop interval — prevention: the resume hook, the settings panel, and the library context menu each reapply opportunistically.
- Cancelling a game action and pausing an update are reported unreliable — prevention: the handler reapplies and lets the action proceed when the cancel fails, so the lock degrades instead of blocking the user.
- Re-issuing an update action calls `SteamClient.Apps.ContinueGameAction(game_action_id, action)` with the original action name as the second argument, but the SDK documents that argument only with other tokens (`SkipShaders`, `skip`, `ShowDurationControl`) and its `@remarks` ends in `todo:`, so the action name's validity as a continuation token is unverified — no preventive measure currently exists; a non-update action is re-issued through `RunGame` and does not use the continuation parameter.
- A spoofed manifest can fail the game's own file check and trigger a re-download — no preventive measure currently exists; Unlock restores the original appmanifest.
- Online play and anti-cheat can reject a build whose files do not match the spoofed manifest — no preventive measure currently exists; the feature documents the limitation.
- A third-party launcher can update or repair an app's content independently of Steam, so the pinned build is not held and the files no longer match the spoofed manifest — no preventive measure currently exists; the feature documents the limitation.
- Multiple library folders and the Windows/Linux path separator difference complicate app discovery — prevention: discovery unions `steamapps/libraryfolders.vdf`, `config/libraryfolders.vdf`, and the Steam root directory, and the cached `manifest_path` is re-resolved when it goes stale.
- A concurrent Steam write can race the plugin's appmanifest write — prevention: the backend writes through a temporary file and renames it into place, and per-app write operations are serialized.
- A data root directory migration can fail across filesystems, hit a permission error, or be interrupted — prevention: the migration copies and verifies before it persists the new path and keeps the old root directory until the new one verifies.
- A path that contains spaces or non-ASCII characters, or a data root directory on a removable drive, can break path handling — prevention: `paths.validate` rejects a data root path that is not absolute, creatable, or writable, or that is equal to or nests with the current data root directory, and discovery re-resolves a path that is gone.
- The host's `showModal` throws when it can fall back to `findSP`, which the Properties popup cannot satisfy — prevention: `frontend/notify.tsx` defaults the modal `parent` to the current window, and the Properties tab passes the popup window, so `showModal` skips the `findSP` fallback.
- `window.appStore.GetAppOverviewByAppID` and the state flags it reflects are undocumented client internals, so the installed check in the settings panel can be unavailable or wrong — prevention: the panel treats a missing overview or a missing field as not installed, so the record still offers `Unlock`.
- The app Properties window is an undocumented client internal, so a client update can move its tab list or content area and drop or misplace the tab — prevention: the injection lives in `frontend/properties.tsx`, the active-tab class is derived at runtime, the content area is found relative to the `role='tablist'` and `general_Content` anchors, and a missing anchor or `AddWindowCreateHook` makes the tab a no-op.
- The library game page is an undocumented client internal, so a client update can move its play bar, rename the `PLAY TIME` cell's class, or change the hero image URL and make the badge find no anchor or the wrong app id — prevention: the app id comes from the pathname, the hero image, a `data-appid` element, a Steam link, or an app image URL in turn, the `PLAY TIME` cell comes from a recorded class selector, a text match, and a `Panel`-display selector in turn, the label, value, and icon styles are sampled at run time over recorded fallbacks, and a missing anchor logs a warning once and leaves the page unchanged.
- The badge sets the play bar's inline `flex-wrap` to `nowrap` while it is mounted, so a client update that relies on wrapping the play bar can push the row's cells off the page — prevention: the badge saves the container's inline `flex-wrap` on mount and restores it on unmount.
- The running client exposes the 24-hour clock setting through no API, so the backend reads `b24HourClock` from the per-user `sharedconfig.vdf`, whose path and `FriendsUIJSON` shape are an undocumented client internal, and `SteamClient.Settings.GetCurrentLanguage` resolves asynchronously, so the first render can use the language's default hours and the fallback `en` — prevention: `backend/clock.lua` tries the `UserRoamingConfigStore` path and the `UserLocalConfigStore` fallback and returns `nil` when the file or the value is absent, the clock format starts at `{ locale: "en", hour12: undefined }`, and the `SteamClient.FriendSettings` and `SteamClient.Settings` change callbacks stay a best-effort live source that re-renders the badge.
- The native icon's tint can live in a `fill` or `stroke` value the svg's computed `color` does not carry, so the badge icon can keep the fallback tint and read brighter than its neighbors — prevention: the badge samples the icon svg's computed `color` and `opacity`, falls back to the label's color and the recorded constants, and a mismatched sample only changes the icon's tint.
- The native icon's tint can live in a `fill` or `stroke` value the svg's computed `color` does not carry, so the badge icon can keep the fallback tint and read brighter than its neighbors — prevention: the badge samples the icon svg's computed `color` and `opacity`, falls back to the label's color and the recorded constants, and a mismatched sample only changes the icon's tint.
- The play bar can render a cell, such as `ACHIEVEMENTS`, after the badge mounts, which would leave the badge before that cell — prevention: on every watch pass, `frontend/gamepage.tsx` checks whether the badge is the last cell of the play bar and moves it back to the end when it is not.
- The feature has no uninstall hook, so removing the plugin leaves the lock records in place and stops the reapply — prevention: `Restore All` restores every record's `original` appmanifest and deletes each record after its appmanifest write succeeds, so running it before uninstalling the plugin deletes every successfully restored record, and a record whose write-back fails stays in place for a retry; uninstalling before running it leaves the lock records in place and stops the reapply.
- Deleting a record without restoring it leaves an app locked with no restore basis — prevention: `Restore All` deletes a record only after its appmanifest write succeeds, and `Unlock` removes a record whose app is no longer installed only when discovery runs and finds no appmanifest.

## Alternatives Considered

- **SteamOS Game Mode support** — excluded: Millennium does not officially support SteamOS installation, the SteamOS Game Mode Quick Access Menu (QAM) is a separate window with limited injection, and coexistence with Decky Loader is unsupported; [Scope](#scope) excludes SteamOS.
- **Big Screen Mode support** — excluded: it shares the Gamepad UI injection and QAM limits of SteamOS Game Mode.
- **macOS support** — excluded: Millennium marks macOS experimental through its wrapper app installation, and the platform rule admits only officially supported platforms.
- **Downgrade support** — deferred: `download_depot` can fetch an older manifest, but Valve's manifest request-code gate makes deep history unreliable, and the flow requires a manifest picker and a full depot copy.
- **Central `locked.json` instead of per-app `.lock`** — rejected: one file corrupts more easily under partial writes and concurrency, and it complicates migration; per-app files are atomic and independently recoverable.
- **A separate `appmanifest_<appid>.acf` backup instead of embedding `original`** — rejected: it overlaps the record, adds migration and cleanup cost, and adds a missing-backup failure mode and a consistency-maintenance burden.
- **Storing the lock records in Millennium's config API** — rejected: the config API caps a plugin at 256 keys and 256 KB per value, and its uninstall prompt deletes settings, which would remove the restore basis.
- **A persisted build-info cache** — storing the latest captured dump under a cache root directory with a freshness rule. Rejected: the cache adds a root-directory concept, a schema, and an existence/freshness/validity state for no user-visible benefit, and a stale entry can pin an old build; `app_info_print` reads the client's own cache cheaply, so the feature captures per operation and passes the dump in the operation payload instead.
- **Forcing `app_info_update` before a capture** — rejected: `app_info_update` is asynchronous and lacks official documentation, and issuing it inside a capture window makes `app_info_print` print empty text until the refresh settles; the client's cached PICS is the same source the client compares against, so reading it without an update is sufficient and issues no server request.
- **A targeted `app_info_request` before `app_info_print`** — rejected with the forced update: the request is asynchronous and undocumented, and the client's own PICS refresh already keeps the cache current enough for the spoof to match.
- **Capturing every installed `dlcappid` instead of only the uncovered ones** — rejected: the base PICS already covers the installed DLC depots of some apps, so the simple form captures apps the spoof does not need; `get_required_apps` returns the uncovered `dlcappid` values, and the difference is capture count, not correctness.
- **Freezing the appmanifest with a read-only permission instead of reapplying** — rejected: forcing read-only can break Steam's internal operations (on Windows a read-only file cannot be deleted or renamed, which can fail uninstall, moving the install folder, and verify/repair; this is not yet verified on a real machine), and edits to a Steam-owned file should stay within the necessary minimum; reapplying without touching file permissions keeps the appmanifest an ordinary, operable file in the Steam client's view and avoids the potential unreliability.
- **Opening the appmanifest and lock file with the OS default application** — rejected: the platform opener's result is unreliable (on Linux `xdg-open` exits non-zero for a file whose extension carries no MIME association, and the Lua host may lack `utils.exec`), it pulls the user out of the Steam client into an external application, and the file's text is what the user needs; the in-client content dialog shows both files consistently and without an external dependency.
- **Writing the lock record to disk in pretty-printed form** — rejected: formatting serves the reader in the dialog, and keeping the stored record compact leaves the on-disk format and the `state` and `migrate` tests unchanged.
- **Showing the pretty text without a note** — rejected: the pretty text differs from the file's on-disk bytes, so a silent reformat invites the reader to trust the display as the file's exact content.
