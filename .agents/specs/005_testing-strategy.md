---
status: active
type: process
---

# Spec 5 - Testing Strategy

## Summary

This spec defines how the `Steam App Verlock` plugin is tested: the test layers, the doubles and seams the tests use, the fixtures that stand in for a live Steam client, the runners, and the continuous-integration matrix. [Spec 1](001_toolchain.md) owns the toolchain that provides the runners, [Spec 4](004_app-version-lock.md) owns the behavior under test, and [Spec 6](006_logging.md) owns the logging mechanism the tests exercise.

## Motivation

The plugin edits files that the Steam client also writes, and it reads its build data from an undocumented client API. A test environment cannot run a live Steam client, so the strategy separates the pure logic, which tests cover directly, from the Steam-bound glue, which doubles and a manual checklist cover. [Spec 4](004_app-version-lock.md) fixes the behavior each layer asserts.

## Design

### Test Layers

The strategy has four layers.

- Unit tests cover the pure backend logic — the `vdf.lua` codec, the `buildinfo.lua` parser, the `acf.lua` appmanifest writer, the `state.lua` record store, the `paths.lua` resolver and discovery, the `migrate.lua` migration, the `lock.lua` operations, and the `log.lua` logging module — and the frontend logic in `console.ts`, `watch.ts`, `locked.ts`, `log.ts`, and `properties.tsx`. The tests inject a fake filesystem, a fake clock, a fake `SteamClient`, and a fake `Millennium`.
- Integration tests run lock, refresh, unlock, reapply, and Restore All against a temporary Steam root seeded with fixture `libraryfolders.vdf` and `appmanifest_*.acf` files, then assert the appmanifest fields, the record, and the restored text.
- Contract tests check the frontend/backend RPC method names and payload shapes against the shared TypeScript types and Lua shape assertions.
- Manual end-to-end tests follow a documented checklist on a real Windows and Linux client, because a test environment cannot reproduce Steam's update behavior.

### Unit Tests

Backend unit tests run under busted and cover each module in [Spec 4](004_app-version-lock.md#implementation-plan) and the `log.lua` module from [Spec 6](006_logging.md).

- `vdf.lua` — `parse` and `serialize` round-trip a table, `parse` returns an error on malformed text, and the codec preserves quoting, escaping, comments, and nested objects.
- `buildinfo.lua` — `clean` extracts the numeric-keyed app block from a dump with a command echo, missing newlines, or trailing noise and returns an empty string for an echo-only dump, `parse` reads `buildid` and the `InstalledDepots` manifests, and `validate` rejects a dump that lacks a required field.
- `acf.lua` — `read` parses an appmanifest, `set` writes one field, and `write` goes through a temporary file and a rename; a failed write leaves the previous file intact.
- `state.lua` — `path`, `write`, `read`, `list`, and `remove` manage one record per file, and a record whose `version` is not `1` is refused on load.
- `paths.lua` — `resolve` applies the `data_root` precedence and reports `is_default`; `defaults` returns the OS-conventional directory; `validate` rejects a path that is not absolute, that is equal to or nests with the current data root, or that cannot be created or written; `find_appmanifest` unions `steamapps/libraryfolders.vdf`, `config/libraryfolders.vdf`, and the Steam root; `resolve_manifest` falls back to discovery when the cached path is stale.
- `migrate.lua` — `move` copies, verifies, persists, and then deletes; a failure before the new path is persisted leaves the old root intact and removes the partial copy.
- `lock.lua` — `reapply` rewrites only when `buildid`, a recorded depot manifest, `StateFlags`, or `TargetBuildID` differs, ignores a depot the record does not list, and keeps an ignored depot and its nested fields when a mismatch does force a rewrite; re-applies for one app are serialized; `restore_all` keeps a record whose appmanifest write fails and drops a record whose app is no longer installed; a completed `lock`, `refresh`, `unlock`, `reapply`, or migration writes an `info` record, a refusal writes a `warn` record, and a read, parse, or write failure writes an `error` record.
- `main.lua` — the dispatch table exposes every bridge method name, returns each handler's result as-is, and turns a raised error into an `Ack` error envelope; an unknown method returns an error; `open_path` resolves the target file and invokes the stubbed `utils.exec`, `read_file` returns the resolved file's text, and `open_command` builds the Windows and POSIX opener commands and rejects a path the platform cannot carry.
- `log.lua` — `info`, `warn`, and `error` append one record at their level with the `backend` source to the log file and pass it to the host `logger`, and `persist` does the same for the given level and source; a record carries a UTC timestamp, a `[<source>]` tag, and a trailing newline; `path` resolves the file under `MILLENNIUM__LOGS_PATH`; the module creates the directory once through `fs.create_directories`, skips the write when the variable is absent, ignores a failed append, and never raises.

Frontend unit tests run under Bun test.

- `console.ts` — `capture_build_info` runs `app_info_print`, samples the spew until the app block appears, and returns the dump; a dump that carries only the command echo, a dump with no `depots` table, and an empty response each fail the capture, and the command builder rejects a non-numeric `appid`; `capture_then_refresh` passes the captured dump to `refresh_app` and refreshes only after a successful capture; an accepted capture relays an `info` record, and a failed capture relays an `error` record.
- `errors.ts` — `format_error` normalizes an `Error`, a string, an object, and an empty value, and falls back to the base object form for an unstringifiable value.
- `notify.tsx` — the failure dialog and the warning toast depend on the host's `showModal` and `toaster`, so they stay on the manual checklist.
- `watch.ts` — `watch_app` and `unwatch_app` register and release the Steam callbacks; the action handler cancels the action, re-applies, and re-issues it, and re-applies then lets the action proceed when the cancel fails; the backstop timer captures and refreshes a watched app and stops after `unwatch_app`; `unwatch_then_unlock` and `unwatch_all_then_restore` stop watching before they unlock or restore, and re-watch on failure — `unwatch_then_unlock` re-watches the app when the call fails, and `unwatch_all_then_restore` re-watches the records the result lists under `failed`, or every given app when the call itself fails; `read_auto_update_behavior` reads the app details store and falls back to the app overview store, and `apply_auto_update_behavior` writes the app's auto-update setting; `unwatch_then_unlock` reports `auto_update_restored` and `unwatch_all_then_restore` records `auto_update_failed` when a behavior write fails; a `list_locked` response of `{}` counts as an empty record list; a `not_installed` reapply, a failed action cancel, and a failed behavior restore each relay a `warn` record, and a failed backend call relays an `error` record.
- `locked.ts` — `sync_locked_ids` replaces the local locked set from a record list, treats a `{}` response as an empty list, and keeps the set for an error envelope.
- `properties.tsx` — `format_time` renders a locale-formatted time and returns `null` for a missing or zero value, `behavior_label` names the known `EAppAutoUpdateBehavior` values and falls back for an unknown or absent one, and `find_record` selects the record for one app id regardless of its type; the tab's DOM injection stays on the manual checklist.
- `log.ts` — `log_info`, `log_warn`, and `log_error` write the matching console method with the `[steamapp-verlock]` prefix and relay one `{ level, message }` record through `bridge.append_log`; a rejected relay is swallowed and the console line still appears.

### Integration Tests

Integration tests create a temporary Steam root, seed it with fixture `libraryfolders.vdf` and `appmanifest_*.acf` files, set `MILLENNIUM__STEAM_PATH`, and run the operations through the backend. They assert that lock writes `StateFlags` `4`, `TargetBuildID` `0`, the captured `buildid`, and the captured depot manifests and stores the verbatim `original`; that refresh updates `locked_build` and `refreshed_at`; that unlock restores the `original` text and deletes the record; that reapply repairs an appmanifest Steam rewrote; that discovery finds the appmanifest after the install directory moves; that migration rolls back on a failure; that each operation emits the record [Spec 4](004_app-version-lock.md#logging) fixes; and that Restore All restores the healthy apps, keeps the failed records, and drops the uninstalled records.

### Contract Tests

Contract tests assert the twelve frontend-to-backend method names and the one backend-to-frontend method name from [Spec 4](004_app-version-lock.md#bridge) and [Spec 6](006_logging.md#relay-bridge), and the payload and response shape of each against the shared TypeScript types and matching Lua shape assertions. The `append_log` method and its payload come from [Spec 6](006_logging.md#relay-bridge).

### Test Doubles and Seams

The backend tests replace the filesystem module in `package.loaded` before they require the module under test, so the production functions keep the signatures [Spec 4](004_app-version-lock.md#function-list) fixes and gain no test-only parameter. The tests save and restore `os.time` for the clock. The frontend tests set `globalThis.SteamClient` to a fake with the `Console` and `Apps` methods and use the Bun fake timers. Every frontend test file registers the same `millennium` double from `frontend/tests/millennium_mock.ts`, because Bun links a mocked module once per test run and a per-file double would leave a later file with a missing export. The backend tests stub the `Millennium` global for the frontend calls and the config API. The logging tests include `log` in `BACKEND_MODULES` and assert against the calls the `logger` stub records. Integration tests use a real temporary directory.

### Console Capture Tests

A fake `SteamClient.Console` feeds recorded `app_info_print` dumps to the capture module. The fixtures include a multi-depot dump and a beta-branch dump for the backend parser, and the frontend capture test emits a valid dump, an echo-only response, and no response. The tests assert that the module accepts a dump that carries the app block, rejects an echo-only response and a timeout, runs only `app_info_print` (never `app_info_update`), and that the command builder rejects a non-numeric `appid`.

### Fixtures

The fixtures live under `backend/tests/fixtures/` and `frontend/tests/fixtures/`. The backend fixtures carry `libraryfolders.vdf`, single-depot and multi-depot `appmanifest_*.acf` files, and `app_info_print` dumps. The frontend fixtures carry the recorded console spew for each dump scenario.

### Runners

Bun test runs the TypeScript tests and reports coverage as `bunfig.toml` enables it. busted runs the Lua tests, and luacov reports Lua coverage. `bun run test:frontend`, `bun run test:backend`, and `bun run test` run the suites. `bunfig.toml` holds the Bun test configuration, `.busted` holds the busted configuration, and `.luacov` holds the Lua coverage configuration. [Spec 1](001_toolchain.md) owns the runners this organization invokes.

### Coverage

The strategy reports coverage from both suites and enforces no threshold. The coverage threshold remains undecided; its home is this spec.

### Continuous Integration

The `verification` workflow runs three parallel jobs. The `docs` job, on an Ubuntu runner, runs the spell check and markdownlint. The `static` job, on an Ubuntu runner, runs the type check, the build, the format checks, and the linters from [Spec 1](001_toolchain.md). The `tests` job runs on a Windows and an Ubuntu runner and runs both test suites and the Lua coverage; on Windows, it installs Lua and LuaRocks with the MSVC toolchain before it installs busted and luacov. The manual end-to-end checklist stays outside continuous integration.

### Undecided Items

- The coverage threshold (see [Coverage](#coverage)).
- Whether the `actions.ts`, `menu.tsx`, `settings.tsx`, and `properties.tsx` UI components get component-level tests or stay on the manual checklist.

## Alternatives Considered

- **A `deps` parameter on each backend function instead of `package.loaded` mocking** — rejected: it changes the function signatures [Spec 4](004_app-version-lock.md#function-list) fixes, which are frozen; replacing the filesystem module in `package.loaded` keeps the production interface unchanged.
