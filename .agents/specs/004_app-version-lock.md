---
status: active
type: feature
---

# Spec 4 - App Version Lock

## Summary

For an app whose content Steam alone updates, App Version Lock pins a Steam app to its installed build and prevents Steam from updating it. The feature rewrites the app's manifest metadata so Steam treats the pinned build as current, and it exposes `Lock`, `Unlock`, and `Refresh` actions through a library context menu and a settings panel, with `Restore All` in the panel.

## Motivation

Steam updates an app to the latest build whenever it can, and the built-in "only update this app when I launch it" setting still applies the update at launch. Some users keep a working build to maintain their mods, to cope with limited network bandwidth, or to preserve a stable game environment; an update destroys that carefully maintained setup.

The fix is used where the user already is, in the Steam library while the client runs, so it is delivered inside the client rather than beside it. An external program would pull the user out of the client and require Steam to close before the program can edit the appmanifest, the file that records the installed build.

Millennium injects React UI into the desktop Steam client, so the feature offers `Lock`, `Unlock`, and `Refresh` in the library context menu and a settings panel. For an app whose content Steam alone updates, the feature holds the installed build in place and keeps it launchable.

## Design

### Steam Update Mechanism

Steam records each installed app's local build in `appmanifest_<appid>.acf`: `StateFlags`, `buildid`, and the manifest ID of every depot under `InstalledDepots`. On an update check, the client compares those values against the latest app info in PICS, the product-info store the client refreshes on demand. When the latest `buildid` or a depot manifest differs from the local value, Steam queues an update; the built-in "only update this app when I launch it" setting defers that queue but still applies it at launch.

The feature bypasses the comparison with two mechanisms. It rewrites the local `buildid` and depot manifests with the latest PICS values, so Steam treats the frozen files as current. It sets `StateFlags` to `4` (`FullyInstalled`) and `TargetBuildID` to `0`, so no update stays pending, and it reapplies those values whenever Steam rewrites the appmanifest (see [Watch and Reapply](#watch-and-reapply)). The feature reads the latest PICS values through the client console; [Build Info Capture](#build-info-capture) describes that capture.

### Scope

The feature supports the Windows and Linux desktop Steam clients, the platforms Millennium officially supports. It excludes SteamOS: devices that run SteamOS, such as Steam Deck and Steam Machine, are unsupported, and SteamOS Desktop Mode carries no availability guarantee. It excludes Big Screen Mode and macOS. It does not downgrade an app to an older build; [Alternatives Considered](#alternatives-considered) records that decision.

### Architecture

The feature is built on the Millennium plugin system, with a Lua backend and a TypeScript/TSX frontend; [Spec 1](001_toolchain.md) owns the language and toolchain choices. The backend owns filesystem access, the [Valve Data File (VDF)](https://developer.valvesoftware.com/wiki/VDF) codecs, the lock state, and the `Lock`, `Refresh`, `Unlock`, and `Restore All` operations. The frontend owns the Steam React UI, the Steam client console, which only the frontend can reach, and the watch lifecycle, which starts and stops the per-app event handlers. The frontend calls backend methods through Millennium's `backend` FFI bridge, and the backend calls frontend methods through Millennium's `millennium.call_frontend_method` bridge; the backend never blocks on a synchronous frontend call.

### Build Info Capture

`frontend/console.ts` captures the running Steam client's PICS state with two Steam console commands:

- `app_info_update 1` asks the client to refresh PICS from Steam's servers;
- `app_info_print <appid>` dumps the app info the client has cached. Valve documents `app_info_print` as displaying the Steamworks configuration the Steam servers report for the game ([Debugging the Steamworks API](https://partner.steamgames.com/doc/sdk/api/debugging), [Uploading to Steam](https://partner.steamgames.com/doc/sdk/uploading)).

The refresh is asynchronous: `app_info_update` returns before the refreshed data arrives, so `app_info_print` can print the pre-refresh cached state, or empty text, until the data arrives ([steam-for-linux#9683](https://github.com/ValveSoftware/steam-for-linux/issues/9683), [steam-for-linux#11521](https://github.com/ValveSoftware/steam-for-linux/issues/11521)). A dump issued before the data arrives can therefore carry the pre-refresh app info — the earlier `buildid` and depot manifests.

`frontend/console.ts` samples `app_info_print`, takes the first non-empty dump as the baseline, and skips an empty dump as neither the baseline nor a candidate. It keeps sampling until a dump differs from the baseline, which indicates that the refreshed data has arrived; if none differs before the time limit, it uses the most recent non-empty dump. The limit is undecided: it is a constant in `frontend/console.ts`, and the current working value is 2 seconds. The constant must cover a slow PICS round trip without a long user wait.

`SteamClient.Console` is the Steam client's console as exposed to the frontend. `frontend/console.ts` calls `SteamClient.Console.RegisterForSpewOutput(callback)` to read the console output, then `SteamClient.Console.ExecCommand(<command>)` to run each command; the returned handle's `unregister()` stops the callback. Millennium's SDK declares both methods ([Console.ts](https://github.com/SteamClientHomebrew/Millennium/blob/main/src/typescript/sdk/src/sharedjscontext/globals/steam-client/Console.ts)). The sampler reassembles the captured output into the latest captured dump and passes it to the backend's `set_build_info` method through Millennium's `backend` FFI bridge, `backend.set_build_info(JSON.stringify({ appid, dump }))`, which carries the payload as a single JSON string ([Millennium TS SDK](https://docs.steambrew.app/plugins/ts/Millennium)).

The backend persists the latest captured dump — the most recent dump a successful capture stored — under `buildinfo/<appid>.kv` in the cache root directory (see [Data Root Directory and Settings](#data-root-directory-and-settings)). `set_build_info` stores the payload without validating it; validation happens when a `Lock` or `Refresh` parses the dump. The frontend captures before it calls `lock_app` or `refresh_app`, so the backend consumes the latest captured dump. A capture is first-class data, not a fallback: when a capture reports `ok: false`, the frontend aborts without calling `lock_app` or `refresh_app`, so a stale dump from an earlier capture never locks an app.

### Background Refresh

When the Steam UI finishes loading, the backend's `on_frontend_loaded` calls `request_build_info` once for every lock record (the persisted per-app JSON file described in [Lock Data Structure](#lock-data-structure)). `request_build_info` runs on the frontend and calls `capture_then_refresh`. On a successful capture `capture_then_refresh` calls `refresh_app` for the same app, so the backend rewrites the appmanifest and updates the record's `locked_build` and `refreshed_at`; the capture stores the dump through `set_build_info` before it returns. On a failed capture the frontend leaves the lock unchanged. The trigger is the Steam UI load, the object is every lock record, and the use is to roll a locked app forward to the latest build without a user action.

### Injection and Validation

`frontend/console.ts` builds every console command from a validated numeric `appid`, and it never interpolates user text into a command. The backend independently checks that every `appid` it receives is a numeric string before it touches state or paths; the check lives in `main.lua`. The backend treats the captured dump as untrusted input: `buildinfo.lua` strips console noise, parses the dump with the VDF codec of `vdf.lua`, and rejects a dump that fails strict validation before any value reaches the appmanifest.

### Lock Operation

The backend locates the app's `appmanifest_<appid>.acf` (see [Data Discovery](#data-discovery)) and reads its `StateFlags`. It refuses to lock an app whose `StateFlags` does not include `FullyInstalled` (`4`) or does include a download or pending-update bit, so an incomplete or mid-download app is never locked. The exact set of download and pending-update bits is undecided: it is a constant in `backend/lock.lua`, and the current working value is `{2, 8, 1024, 16384, 32768}`.

The backend records the file's verbatim text as the `original` field of the lock record (the persisted JSON file described in [Lock Data Structure](#lock-data-structure)). It sets `StateFlags` to `4` and `TargetBuildID` to `0`, writes the captured latest `buildid` and each captured `InstalledDepots` manifest into the appmanifest, and stores the same values in the record's `locked_build` field.

The frontend reads the app's current auto-update behavior from `SteamAppOverview.eAutoUpdateValue` (`EAppAutoUpdateBehavior`), sends it in the `lock_app` payload, and, after a successful lock, sets the behavior to `Launch` through `SteamClient.Apps.SetAppAutoUpdateBehavior(appid, Launch)`. It then starts watching the app (see [Watch and Reapply](#watch-and-reapply)).

The behavior change matters because Steam's `Always` value schedules background updates that never pass through a launch action; setting `Launch` turns every update into a launch-time action, which the watch can intercept. When the frontend cannot read the current value, it aborts the lock, the same as a failed capture, so the original value is never lost. When the post-lock behavior write fails, the frontend rolls the lock back by calling `unlock_app` and reports the failure.

### Refresh Operation

The feature re-captures the latest PICS state for an already locked app and rewrites the appmanifest's `buildid`, depot manifests, `StateFlags` (`4`), and `TargetBuildID` (`0`) — the same intended values the reapply path enforces. It updates the record's `locked_build` and `refreshed_at` and keeps watching the app. The backend parses the captured dump against the app's branch through `buildinfo.parse`; [Function List](#function-list) fixes the branch rule, and Lock and Refresh share it.

When the appmanifest write fails, the feature restores the record's `locked_build`, `refreshed_at`, and `manifest_path` to their previous values and reports the failure, so the record keeps matching the appmanifest.

### Unlock Operation

The feature writes the record's `original` text back to the appmanifest and deletes the record. The frontend stops watching the app before it calls `unlock_app` and re-watches the app when `unlock_app` fails, so a failed unlock never leaves the app unwatched.

The frontend restores the app's auto-update behavior from the `auto_update_behavior` value in the unlock result through `SteamClient.Apps.SetAppAutoUpdateBehavior`; a record without the field skips the restore. The restore is best-effort: when the behavior write fails after the record is deleted, the frontend does not roll the deletion back, because the appmanifest already holds the `original` text. The result's `auto_update_restored` is `true` when the behavior was written or the record carried no behavior, and `false` when the write failed; the settings panel shows a warning for a `false` value, while the library context menu's `Unlock` has no persistent status area and keeps the `Launch` setting without a warning.

### Restore All Operation

The feature restores every locked app whose restore succeeds, then deletes the restored records and removes the latest captured dumps. For each record, it writes the record's `original` text back to the appmanifest and deletes the record. A record whose appmanifest cannot be written stays in place for a retry, and a record whose app is confirmed no longer installed is dropped because there is nothing to restore. A dropped record counts as neither restored nor failed.

After every record is handled, the feature removes the files under the cache's `buildinfo/` directory and keeps the directory itself. `Restore All` changes no plugin configuration setting, but it does restore each app's pre-lock auto-update behavior, as described next.

The frontend stops watching every app before it calls `restore_all`, and re-watches each app whose record the result lists under `failed`, because a failed record stays locked. The frontend then restores each app's auto-update behavior from the result's `auto_update` list through `SteamClient.Apps.SetAppAutoUpdateBehavior`, and writes the app ids whose behavior write failed into the result's `auto_update_failed`. The restore is best-effort: when a behavior write fails after its record is deleted, the frontend does not roll the deletion back, because the appmanifest already holds the `original` text. The settings panel includes the failed app ids in its status message.

### Watch and Reapply

The lock is enforced by reapplying the spoof — the latest PICS `buildid`, depot manifests, `StateFlags` `4`, and `TargetBuildID` `0` written into the appmanifest — not by file permissions. The frontend watches each locked app and asks the backend to reapply whenever Steam rewrites its appmanifest.

The frontend rebuilds the watch set at startup and on every reapply pass: `frontend/index.tsx` calls `sync_watches` when the plugin loads, and `reapply_all` calls `sync_watches` before it reapplies. `sync_watches` reads the persisted lock records through `list_locked`, calls `watch_app` for each record's appid, and ensures the global handlers and the backstop timer — a fixed-interval reapply timer (see below) — run; it retries a failed or non-array `list_locked` response a bounded number of times. The retry count and interval are undecided: they are constants in `frontend/watch.ts`, and the current working values are 5 attempts and 1 second.

- `SteamClient.Apps.RegisterForAppOverviewChanges` and `SteamClient.Apps.RegisterForAppDetails(appid)` fire when a locked app's state changes; the handler calls the backend's `reapply_app` method.
- `SteamClient.Apps.RegisterForGameActionStart` fires when a launch or update action targets a locked app; the handler cancels the action with `SteamClient.Apps.CancelGameAction`, reapplies the spoof, and issues the action again. When the cancel fails, it reapplies and lets the action proceed.
- `SteamClient.System.RegisterForOnResumeFromSuspend`, opening the settings panel, and opening the library context menu each reapply opportunistically.
- A backstop timer reapplies on a fixed interval. The interval is undecided: it is a constant in `frontend/watch.ts`, and the current working value is 1 hour. The interval must be long enough to be negligible and short enough to bound how long a lost spoof survives.

The backend's `reapply_app` reads the appmanifest and, when its `buildid`, depot manifests, `StateFlags`, or `TargetBuildID` differ from the intended values, rewrites the spoof through the appmanifest's temporary-file-and-rename path. Reapplies for one app are serialized. Before it writes, `reapply_app` re-reads the lock record and aborts when the record is gone, so it never rewrites an appmanifest for a record `Unlock` or `Restore All` has already removed. When the appmanifest is gone because the app was uninstalled, `reapply_app` returns `code = "not_installed"`; the frontend stops watching the app only on that signal and leaves the record in place. When the app was moved, the backend re-runs discovery and writes the new path back into the record. On `not_installed`, the frontend stops watching the app but the backend keeps the record by design, so the library context menu still marks the app as locked until the user removes the record.

### Data Discovery

The backend treats the record's `manifest_path` as a cache. Before a `Refresh`, `Unlock`, `Reapply`, or `Restore All` touches an appmanifest, the backend validates the cached path: the file exists, is named `appmanifest_<appid>.acf`, and carries the same `appid`. When the cached path fails validation — for example after the user moves the app's install directory — the backend re-runs discovery, writes the new path back into the record, and continues.

Discovery reads the Steam root directory from `MILLENNIUM__STEAM_PATH`, unions the library paths in `steamapps/libraryfolders.vdf` and `config/libraryfolders.vdf` with the Steam root directory, sorts the candidates by normalized path, and returns the first existing `steamapps/appmanifest_<appid>.acf`. Lock runs discovery directly, because no record exists yet.

When discovery finds no path, the operation fails: a `Refresh`, `Unlock`, or `Restore All` treats the app as no longer installed only when discovery could run, and returns an error that keeps the record when `MILLENNIUM__STEAM_PATH` is unavailable and discovery cannot run.

### Data Migration

The data root directory is user-selectable; the cache root directory is not. Changing the data root directory always migrates it. The backend validates the new path (absolute, distinct from and not nested with the current data root directory, not equal to or inside the cache root directory, creatable, writable), copies `locks/` into it, verifies that every copied `.lock` parses and carries its required fields, persists the new root path through Millennium's config API, and only then deletes the old `locks/`.

The migration moves lock records only; it never reads or writes the cache root directory, whose `buildinfo/` entries are disposable and rebuild themselves on the next capture. A failure before the new root path is persisted leaves the old root directory intact and removes the partial copy. A failure to delete the old `locks/` after the new root path is persisted does not roll the migration back; the result carries a warning. While a migration runs, the backend rejects reads and writes of the lock data.

### Persistent State

The feature stores each locked app as one self-contained JSON file, `<data_root>/locks/<appid>.lock`; [Lock Data Structure](#lock-data-structure) fixes its fields. The embedded `original` text lets Unlock and Restore All restore the app without a separate backup file.

### User Interface

A library context menu adds `Lock`, `Unlock`, and `Refresh` for the selected app and marks a locked app. A settings panel lists every locked app; an installed record offers `Refresh` and `Unlock`, while a record whose app is no longer installed offers only `Unlock`, shown with a warning, and `Unlock` removes that orphaned lock record when discovery can run and finds no appmanifest.

The panel decides installed state per record by reading `window.appStore.GetAppOverviewByAppID(...).local_per_client_data.installed`. The panel offers a data-directory control (a path field with `Change`, `Reset to Default`, and `Open Folder`) and `Restore All`. `Open Folder` is a frontend call to `SteamClient.System.OpenLocalDirectoryInSystemExplorer`.

The panel supports multi-select and batch `Refresh` and `Unlock` over the selected records.

The app's Properties window carries a `Steam App Verlock` tab for the app the window shows. The tab lists the lock state, the app id and name, the locked `buildid` and depot manifests, the lock and refresh times, and the auto-update behavior, and it offers `Lock` when the app is not locked and `Refresh` and `Unlock` when it is. The tab reads the same `list_locked` records and calls the same shared actions as the context menu, and it no-ops when the window's DOM shape changes.

### Concurrency and Atomicity

The backend writes the appmanifest through a temporary file and renames it into place, so a failed write leaves the previous appmanifest intact. Every backend write operation for one app — `Lock`, `Refresh`, `Unlock`, and `Reapply` — is serialized, and `Restore All` excludes them all while it runs. The feature runs while the Steam client runs and assumes Steam rewrites the appmanifest; the watch reapplies the spoof, and the launch and update interception reapplies before the action proceeds.

### Logging

The feature records its operations through the logging mechanism of [Spec 6](006_logging.md). A record carries the level `info` for a completed state change or a batch summary, `warn` for an expected refusal or a recoverable degradation, and `error` for an I/O, parse, or persistence failure or an uncaught exception. The backend writes its records directly; the frontend writes its own and relays each through the `append_log` bridge method of [Spec 6](006_logging.md#relay-bridge). No record carries the contents of a captured dump.

The backend records:

- `locked app <appid> at build <buildid>`, `refreshed app <appid> to build <buildid>`, and `unlocked app <appid>` at `info` for the matching operation;
- `reapplied app <appid>` at `info` when `reapply_app` rewrites the appmanifest, and no record when the appmanifest already matches;
- `restored <n> app(s), kept <m>` at `info` for a Restore All summary, and `migrated the data root to <path>` at `info` for a completed migration;
- `refused to lock app <appid>: <reason>` at `warn` for a lock the appmanifest's state forbids, and `app <appid> is no longer installed` at `warn` when discovery confirms an app is gone;
- `<operation> failed for app <appid>: <error>` at `error` for a failed read, parse, or appmanifest or record write, and `method <name> failed: <error>` at `error` when the dispatcher catches an exception.

The frontend records:

- `captured build info for app <appid>` at `info` for an accepted capture;
- `capture failed for app <appid>: <error>` at `warn` for a failed capture;
- `aborted the lock for app <appid>: the auto-update behavior was unreadable` at `warn` when the current behavior cannot be read, and `rolled back the lock for <appid> after the auto-update write failed` at `warn` when the post-lock write fails and the lock rolls back;
- `could not cancel the action for app <appid>; reapplied and let it proceed` at `warn` when a game action cannot be cancelled;
- `could not restore the auto-update setting for app <appid>` at `warn` when a behavior restore fails;
- `<operation> failed for app <appid>: <error>` at `error` for a failed backend call.

## Data Root Directory and Settings

The feature resolves two root directories. The data root directory holds the lock records and resolves in three steps:

- the Millennium config API key `data_root`, when set; `is_default` — which reports whether the data root directory resolved from the OS-conventional path — is `false`;
- otherwise the OS-conventional path, when the OS environment variables that anchor it can be determined (`LOCALAPPDATA` on Windows; `XDG_DATA_HOME`, or `HOME` when `XDG_DATA_HOME` is unset, on Linux): `%LOCALAPPDATA%\steamapp-verlock\` on Windows and `${XDG_DATA_HOME:-$HOME/.local/share}/steamapp-verlock/` on Linux; `is_default` is `true`;
- otherwise `MILLENNIUM__CONFIG_PATH/steamapp-verlock/`, or `millennium.get_install_path()` joined with `steamapp-verlock/` when `MILLENNIUM__CONFIG_PATH` is missing; `is_default` is `false`.

It is `true` only for the second step, and `false` for a configured root and for the config-path fallback.

The cache root directory is fixed at `%LOCALAPPDATA%\steamapp-verlock\cache\` on Windows and `${XDG_CACHE_HOME:-$HOME/.cache}/steamapp-verlock/` on Linux; the user cannot change it. When the OS environment variables that anchor the cache root directory cannot be determined, the cache root falls back to `<config path>/steamapp-verlock/cache/`, mirroring the data root's third step.

Under the data root directory, `locks/<appid>.lock` holds one locked-app record; under the cache root directory, `buildinfo/<appid>.kv` holds the latest captured dump. The settings panel never writes config directly: it calls the backend's `set_data_root`, and the backend performs the config-API write through `migrate.lua`. `set_data_root` with an empty path resets to the OS-conventional default: the backend migrates to `paths.defaults().data_root` when that differs from the current root and clears the `data_root` config key through `clear_data_root_config`, so the next resolve returns to the default.

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
| `locked_build` | `BuildInfo` (see [Shared Types](#shared-types)) | The `buildid` and depot manifests written into the appmanifest. |
| `original` | `string` | The pre-lock appmanifest text, stored verbatim. It must be non-empty, or the backend treats the record as invalid on load. |

## Implementation Plan

The plugin adds these files. The file layout follows the toolchain in [Spec 1](001_toolchain.md).

| File | Role |
|---|---|
| `millennium.toml` | Plugin manifest |
| `package.json`, `bun.lock`, `tsconfig.json` | Frontend toolchain |
| `backend/main.lua` | Plugin entry, lifecycle, RPC dispatch |
| `backend/vdf.lua` | Text VDF codec |
| `backend/buildinfo.lua` | Dump cleaning, parsing, validation, dump store |
| `backend/acf.lua` | Appmanifest read, field update, write |
| `backend/lock.lua` | Lock, refresh, unlock, and Restore All operations |
| `backend/state.lua` | Locked-app records |
| `backend/paths.lua` | Data root directory resolution, path validation, appmanifest discovery |
| `backend/migrate.lua` | Data root directory migration |
| `frontend/index.tsx` | Plugin entry and UI registration |
| `frontend/bridge.ts` | Backend RPC wire framing; single JSON-string payloads, with zero-argument methods carrying no payload |
| `frontend/locked.ts` | Reactive locked-app-id store shared by the menu and settings panel |
| `frontend/console.ts` | PICS capture |
| `frontend/watch.ts` | App event watch and reapply triggers |
| `frontend/actions.ts` | Shared `Lock`, `Refresh`, and `Unlock` flows used by the menu and the Properties tab |
| `frontend/menu.tsx` | Library context menu |
| `frontend/settings.tsx` | Settings panel |
| `frontend/properties.tsx` | App Properties window tab |

### Function List

#### Shared Types

- `AppId = string` — a Steam app id written as a numeric string.
- `Ack = { ok: boolean; error?: string; code?: string }` — the result envelope a backend operation that reports its outcome returns. It wraps the operations that change state; `list_locked` returns its records directly when it can and carries the error form of the envelope only while a data root migration runs, and `get_data_root` always returns its data directly and never carries the envelope.
- `LockResult = Ack & { record?: LockedAppRecord }` — success carries the locked-app record.
- `RefreshResult = Ack` — the refresh result.
- `UnlockResult = Ack & { auto_update_behavior?: number; auto_update_restored?: boolean }` — the unlock result; success carries the stored auto-update behavior when the record has one, and the frontend sets `auto_update_restored` to `false` when restoring that behavior failed (it is `true` when the behavior was written or the record carried no behavior).
- `CaptureResult = { ok: true; appid: AppId; dump: string } | { ok: false; error: string }` — success carries the reassembled dump; failure carries an error.
- `BuildInfo = { buildid: string; depots: Record<string, string> }` — a captured or spoofed build state.
- `LockedAppRecord = { version: number; appid: AppId; name: string; manifest_path: string; locked_at: number; refreshed_at?: number; auto_update_behavior?: number; locked_build: BuildInfo; original: string }` — the persisted locked-app record.
- `DataRoots = { data_root: string; cache_root: string; is_default: boolean }` — the resolved data and cache root directories; `is_default` reports whether the data root directory resolved from the OS-conventional path (see [Data Root Directory and Settings](#data-root-directory-and-settings)).
- `MigrateResult = Ack & { data_root?: string; warning?: string; is_default?: boolean }` — the migration result; success carries the new data root directory, `warning` carries a non-fatal cleanup failure, and `is_default` is `true` when an empty `set_data_root` reset the root to the OS-conventional default.
- `RestoreResult = Ack & { restored: number; failed: AppId[]; auto_update?: { appid: AppId; behavior: number }[]; auto_update_failed?: AppId[] }` — the `Restore All` result; `restored` counts the apps put back, `failed` lists the ones left in place, a record dropped as no longer installed counts as neither, `auto_update` lists the auto-update behaviors the frontend restores, and the frontend sets `auto_update_failed` to the app ids whose behavior write failed.

#### Backend

`backend/main.lua`

- `on_load() -> void` — initialize the feature and signal readiness to Millennium.
- `on_frontend_loaded() -> void` — run once the Steam UI has loaded; call `request_build_info` for every lock record.
- `on_unload() -> void` — release resources when the plugin unloads.
- `dispatch(name: string, payload: table) -> table` — internal/test interface; route a bridge method name to its handler and return the handler's result as-is; a handler that raises an error returns an `Ack` error envelope.
- `handlers` — internal/test interface; the table that maps each bridge method name to its handler.
- `set_data_root(payload: table) -> MigrateResult` — migrate the data root directory to `payload.path`; an empty path resets to the OS-conventional default (see [Data Root Directory and Settings](#data-root-directory-and-settings)).
- `clear_data_root_config() -> void` — internal; clear the `data_root` config key through `config.delete`, or through `config.set("data_root", nil)` when `config.delete` is unavailable.

`backend/vdf.lua`

- `parse(text: string) -> state: table?, err: string?` — decode text VDF into a table; return an error when the text is malformed.
- `serialize(state: table) -> text: string` — encode a table as text VDF.

`backend/buildinfo.lua`

- `clean(raw: string) -> text: string` — strip console noise from a captured dump.
- `parse(text: string, branch?: string) -> info: BuildInfo?, err: string?` — read the `buildid` and the depot manifests from the cleaned dump against `branch`; the branch comes from the appmanifest's `BetaKey` and defaults to `public` when `BetaKey` is absent or empty, and both Lock and Refresh share this rule.
- `validate(info: BuildInfo) -> ok: boolean, err: string?` — reject a dump that fails strict validation.
- `store(appid: AppId, dump: string) -> ok: boolean, err: string?` — persist the latest captured dump under the cache root directory.
- `load(appid: AppId) -> dump: string?, err: string?` — read the latest captured dump for an app.
- `clear_all() -> void` — remove the latest captured dump for each app while keeping the `buildinfo/` directory.

`backend/acf.lua`

- `read(path: string) -> state: table?, err: string?` — read an appmanifest into a table.
- `set(state: table, key: string, value: string) -> void` — set one field in the appmanifest table.
- `write(path: string, state: table) -> ok: boolean, err: string?` — write the table back through a temporary file and a rename.

`backend/lock.lua`

- `lock(appid: AppId, info: BuildInfo, auto_update_behavior?: number) -> LockResult` — record the current appmanifest's verbatim text in the record's `original` field, store `auto_update_behavior`, write `info` into the appmanifest, and store the same `buildid` and depot manifests in the record's `locked_build` field; the frontend starts watching the app after a successful lock.
- `refresh(appid: AppId, info: BuildInfo) -> RefreshResult` — write `info` into the appmanifest and update `locked_build` and `refreshed_at`.
- `unlock(appid: AppId) -> UnlockResult` — write the record's `original` back to the appmanifest and delete the record; the result carries the record's `auto_update_behavior` when present. The frontend owns the watch lifecycle.
- `reapply(appid: AppId) -> Ack` — rewrite the spoof when the appmanifest no longer matches the record.
- `restore_all() -> RestoreResult` — restore every recorded app, delete the restored records, and clear the latest captured dumps; the result carries the restored records' `auto_update_behavior` values.

`backend/state.lua`

- `list() -> records: LockedAppRecord[]?, err: string?` — return every locked-app record; while a data root migration runs, return an error instead of records.
- `read(appid: AppId) -> record: LockedAppRecord?, err: string?` — read one record.
- `write(record: LockedAppRecord) -> ok: boolean, err: string?` — add or update one record.
- `remove(appid: AppId) -> void` — drop one record.
- `path(appid: AppId) -> path: string` — return one record's file path.
- `valid(record: table) -> ok: boolean` — internal/test interface; report whether a decoded value is a valid `version` `1` lock record.
- `set_migrating(flag: boolean) -> void` — internal/test interface; set the migration guard that makes `list` and `read` return an error and `write` and `remove` no-op.

`backend/paths.lua`

- `resolve() -> DataRoots` — resolve the data and cache root directories.
- `defaults() -> DataRoots` — return the OS-conventional root directories.
- `validate(path: string) -> ok: boolean, err: string?` — validate a candidate data root path.
- `find_appmanifest(appid: AppId) -> path: string?, err: string?` — locate the appmanifest across the libraries, accepting both the object-style and the legacy string-style entries of `libraryfolders.vdf`.
- `resolve_manifest(appid: AppId, cached: string) -> path: string?, err: string?` — validate the cached path, fall back to discovery, and return the resolved path.

`backend/migrate.lua`

- `move(from: string, to: string) -> MigrateResult` — migrate the lock data to a new root directory; a failure to delete the old `locks/` after the new root path is persisted is reported in the result's `warning`.

#### Frontend

`frontend/locked.ts`

- `is_locked(appid: AppId): boolean` — report whether an app id is in the local locked set.
- `subscribe_locked(listener: () => void): () => void` — subscribe to locked-set changes and return an unsubscribe function.
- `as_record_list(value: unknown): LockedAppRecord[] | null` — normalize a decoded backend response: an array stays, a keyless object without `ok` becomes an empty list, and anything else becomes `null` so a caller can tell an error envelope from an empty result.
- `sync_locked_ids(records: unknown): void` — replace the local locked set from a record list.
- `refresh_locked_ids(force = false): Promise<void>` — reload the local locked set from the backend within a cache TTL.
- `mark_locked(appid: AppId): void` — add an app id to the local locked set and notify subscribers.
- `mark_unlocked(appid: AppId): void` — remove an app id from the local locked set and notify subscribers.

`frontend/console.ts`

- `capture_build_info(appid: AppId): Promise<CaptureResult>` — run the two console commands, wait for the refresh, store the accepted dump through `set_build_info`, and return the reassembled dump.
- `capture_then_refresh(appid: AppId): Promise<void>` — call `capture_build_info` and, on success, call `refresh_app`; the background-refresh entry point.

`frontend/watch.ts`

- `watch_app(appid: AppId): void` — start watching one locked app and reapplying its spoof on a Steam write.
- `unwatch_app(appid: AppId): void` — stop watching one app.
- `sync_watches(): Promise<void>` — read every persisted lock record, start watching each app, and ensure the global handlers and backstop timer run; retry a failed or non-array `list_locked` read a bounded number of times, with the retry count and interval undecided (their home is constants in `frontend/watch.ts`; the current working values are 5 attempts and 1 second).
- `reapply_all(): Promise<void>` — reapply every watched app's spoof and ensure the global handlers and backstop timer are running.
- `unwatch_all(): void` — stop watching every app, unregister the handlers that expose `unregister`, neutralize the overview callback by clearing the watch set, and stop the backstop timer.
- `read_auto_update_behavior(appid: AppId): number | undefined` — read the app's current `EAppAutoUpdateBehavior` from the app overview store.
- `apply_auto_update_behavior(appid: AppId, behavior: number): boolean` — write one auto-update behavior through `SetAppAutoUpdateBehavior` and report whether the write succeeded.
- `unwatch_then_unlock(appid: AppId): Promise<UnlockResult>` — stop watching the app, call `unlock_app`, re-watch the app when the call fails, restore the returned `auto_update_behavior`, and set the result's `auto_update_restored` from the restore outcome.
- `unwatch_all_then_restore(appids: AppId[]): Promise<RestoreResult>` — stop watching every app, call `restore_all`, re-watch the records the result lists under `failed` (or every given app when the call fails), restore the returned `auto_update` behaviors, and record the failed app ids in the result's `auto_update_failed`.

`frontend/actions.ts`

- `lock_app(appid: AppId): Promise<void>` — capture the build info, read the current auto-update behavior, call `lock_app`, set the behavior to `Launch`, and start watching the app; it rolls the lock back when the behavior write fails.
- `refresh_app(appid: AppId): Promise<void>` — capture the build info and call `refresh_app`.
- `unlock_app(appid: AppId): Promise<void>` — stop watching the app, call `unlock_app`, and clear the local locked mark on success.

`frontend/properties.tsx`

- `install_properties_patch(): () => void` — install the App Properties hook and return a disposer; a missing `AddWindowCreateHook` or a changed dialog shape makes the tab a no-op.
- `VerlockTabContent({ appid }): JSX.Element` — the tab content: the app's lock record, status, locked build, and actions.
- `format_time(value: number | undefined): string` — internal/test interface; render a Unix timestamp, or `Never` when it is absent.
- `behavior_label(value: number | undefined): string` — internal/test interface; name an `EAppAutoUpdateBehavior` value.
- `find_record(records: LockedAppRecord[] | null, appid: AppId): LockedAppRecord | null` — internal/test interface; select the record for one app id.

#### Bridge

frontend to backend (`backend` FFI bridge)

- `set_build_info(payload: { appid: AppId; dump: string }): Promise<Ack>` — store the captured dump as the latest captured dump.
- `lock_app(payload: { appid: AppId; auto_update_behavior?: number }): Promise<LockResult>` — lock the app and store the app's current auto-update behavior; the backend reads the cached dump through `buildinfo.load`, builds the `BuildInfo` through `buildinfo.parse` and `buildinfo.validate`, and then calls `lock.lua`'s `lock`.
- `refresh_app(payload: { appid: AppId }): Promise<RefreshResult>` — refresh a locked app; the backend reads the cached dump through `buildinfo.load`, builds the `BuildInfo` through `buildinfo.parse` and `buildinfo.validate`, and then calls `lock.lua`'s `refresh`.
- `unlock_app(payload: { appid: AppId }): Promise<UnlockResult>` — unlock the app; the result carries the stored `auto_update_behavior` when present.
- `list_locked(): Promise<LockedAppRecord[] | Ack>` — return the locked-app records for the UI directly; a migration in progress makes it return an error envelope instead of records.
- `restore_all(): Promise<RestoreResult>` — restore every locked app and clear the latest captured dumps.
- `get_data_root(): Promise<DataRoots>` — return the resolved root directories directly.
- `set_data_root(payload: { path: string }): Promise<MigrateResult>` — migrate the data root directory to `path`; an empty `path` resets to the OS-conventional default and clears the `data_root` config key (see [Data Root Directory and Settings](#data-root-directory-and-settings)).
- `reapply_app(payload: { appid: AppId }): Promise<Ack>` — reapply a locked app's spoof when its appmanifest no longer matches; return `code = "not_installed"` when the app is gone.

backend to frontend (`millennium.call_frontend_method`)

- `request_build_info(appid: AppId): void` — ask the frontend to capture a dump; on success the frontend calls `refresh_app`, and the capture stores the dump through `set_build_info`.

## Risks

- `SteamClient.Console` is an undocumented client API, and a Steam client update can change or remove it — prevention: console access is confined to `frontend/console.ts`, and a missing console method returns a runtime `CaptureResult` error before any lock record is written.
- The time limit can expire before the refreshed data arrives, so the sampler falls back to the pre-refresh dump and the lock can fail to take effect — prevention: the backend rejects a dump without the required fields, and Refresh re-captures.
- An empty dump can be mistaken for a valid baseline, so the baseline-difference test never fires and the sampler accepts pre-refresh data — prevention: the sampler treats an empty dump as neither the baseline nor a candidate and falls through to the time-limit fallback.
- The requested branch can differ from the branch the captured dump carries, so the parser reads the wrong `buildid` or depot manifests — prevention: the branch comes from the appmanifest's `BetaKey` and defaults to `public`, and the parser falls back to `public` branch data when the requested branch is absent.
- A launch or update action can begin between Steam's rewrite of the appmanifest and the reapply, so an update can still start — prevention: the action interception cancels, reapplies, and re-issues the action, and the backstop interval bounds how long a lost spoof survives.
- An in-flight reapply can race `Unlock` or `Restore All` and rewrite an appmanifest for a record that was just removed — prevention: reapply re-reads the record before it writes and aborts when the record is gone, and per-app write operations are serialized.
- The captured console spew can be truncated or interleaved with unrelated output, so the dump fails to parse — prevention: `buildinfo.clean` strips console noise, strict validation rejects a malformed dump before any value reaches the appmanifest, and a failed capture aborts the operation.
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
- A data root directory migration can fail across filesystems, hit a permission error, or be interrupted — prevention: the migration copies and verifies before it persists the new path, keeps the old root directory until the new one verifies, and never touches the cache root directory.
- A path that contains spaces or non-ASCII characters, or a data root directory on a removable drive, can break path handling — prevention: `paths.validate` rejects a data root path that is not absolute, creatable, or writable, that is equal to or nests with the current data root directory, or that is equal to or inside the cache root directory, and discovery re-resolves a path that is gone.
- `window.appStore.GetAppOverviewByAppID` and the state flags it reflects are undocumented client internals, so the installed check in the settings panel can be unavailable or wrong — prevention: the panel treats a missing overview or a missing field as not installed, so the record still offers `Unlock`.
- The app Properties window is an undocumented client internal, so a client update can move its tab list or content area and drop or misplace the tab — prevention: the injection lives in `frontend/properties.tsx`, the active-tab class is derived at runtime, the content area is found relative to the `role='tablist'` and `general_Content` anchors, and a missing anchor or `AddWindowCreateHook` makes the tab a no-op.
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
- **Putting the Windows cache in `%TEMP%`** — rejected: `%TEMP%` is reclaimed by the system or cleanup tools at any time; `%LOCALAPPDATA%\steamapp-verlock\cache` keeps the cache across sessions, matching Microsoft's LocalCache guidance.
- **Making the cache root directory user-selectable and migrated too** — rejected: the cache is disposable and rebuildable, so a fixed cache root directory removes a setting and a migration failure mode.
- **Using the `change number` header or a console completion signal to detect the refresh** — rejected: the header semantics are undocumented, and its sentinel appears only when the client has never fetched, so it cannot separate an already-current cache from a not-yet-arrived refresh; the baseline-difference test is self-contained.
- **Freezing the appmanifest with a read-only permission instead of reapplying** — rejected: forcing read-only can break Steam's internal operations (on Windows a read-only file cannot be deleted or renamed, which can fail uninstall, moving the install folder, and verify/repair; this is not yet verified on a real machine), and edits to a Steam-owned file should stay within the necessary minimum; reapplying without touching file permissions keeps the appmanifest an ordinary, operable file in the Steam client's view and avoids the potential unreliability.
