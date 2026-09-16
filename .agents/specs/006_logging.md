---
status: active
type: feature
---

# Spec 6 - Logging

## Summary

This spec defines the plugin's logging: how the Lua backend and the TS/TSX frontend record operational events, where those records land, and how a frontend record reaches the same destination as a backend record. The plugin appends every record to one file that it owns, and it also passes the record to the `logger` module of Millennium's Lua host, which fills the in-app log viewer. The host `logger` of a `.star` plugin writes no file and no console line, so the plugin's file stays the only log file. [Spec 4](004_app-version-lock.md) owns the operations that emit the records, and [Spec 5](005_testing-strategy.md) owns the tests.

## Motivation

The plugin performs background work — build-info capture, refresh, reapply, and Restore All — that a user never sees directly, and a failure leaves no record once the session ends. The frontend's `console.*` output lives only in the Steam UI console.

Millennium's Lua host buffers a plugin's `logger` output for the in-app log viewer ([`plugin_logger::collect_logs`, `src/system/logger.cc`](https://github.com/SteamClientHomebrew/Millennium/blob/main/src/system/logger.cc)), but it persists nothing for a `.star` plugin. Starlight installs the plugin as `<id>.star` ([`pack.rs`](https://github.com/SteamClientHomebrew/Millennium/blob/main/starlight/src/pack.rs)); the host loads a `.star` plugin with format `star` ([`star_parser.cc`](https://github.com/SteamClientHomebrew/Millennium/blob/main/src/engine/star_parser.cc)) and marks its logger as v2 ([`main.cc`](https://github.com/SteamClientHomebrew/Millennium/blob/main/src/lua_host/main.cc)); the host passes that v2 flag to the plugin logger as `onlyBuffer` ([`plugin_loader.cc`](https://github.com/SteamClientHomebrew/Millennium/blob/main/src/engine/plugin_loader.cc)); and the plugin logger then skips both the console and the file and keeps the record in memory only ([`logger.cc`](https://github.com/SteamClientHomebrew/Millennium/blob/main/src/system/logger.cc)). The record therefore disappears when Steam restarts. This behavior is confirmed on Millennium v3.4.1, and it explains the report that a Starlight plugin's backend output reaches the viewer but not the console ([Millennium issue 895](https://github.com/SteamClientHomebrew/Millennium/issues/895)).

The frontend contributes a second gap: the host captures frontend `console.*` lines for the viewer in memory only ([`console_capture.cc`](https://github.com/SteamClientHomebrew/Millennium/blob/main/src/mep/console_capture.cc)), so a frontend failure the user does not witness is lost at restart.

The plugin therefore appends every record to a file that it owns, and it still calls the host `logger` so the in-app viewer shows the same record. It creates the file's directory itself and adds no second file.

## Design

### Log Layers

A log record has one of three levels — `info`, `warn`, or `error` — and one of two sources, `backend` or `frontend`. The backend writes a record to the log file and passes it to the host `logger`. The frontend writes a record by calling `console.*` and then relaying the record to the backend, which writes it the same way. Both sources therefore reach the same file and the same viewer.

### Backend Logger

The module `backend/log.lua` owns the backend's logging. It exports `info`, `warn`, and `error`, which each write one record at their level with the `backend` source, and `persist`, which writes one record at a caller-given level and source for the relay.

Each write formats the text as `<timestamp> [<source>] <message>\n`, where `<timestamp>` is `os.date("!%Y-%m-%dT%H:%M:%SZ", utils.time())`, an ISO 8601 instant in UTC. The write appends the formatted line to the log file and passes the same line to the host `logger`. Both steps run under a protected call, so a logging failure never raises into the operation that emitted the record.

### Log File

The file is `<MILLENNIUM__LOGS_PATH>/steamapp-verlock.log`. `backend/log.lua` reads the directory from `utils.getenv("MILLENNIUM__LOGS_PATH")`, whose value Millennium sets on every platform ([`environment.cc`](https://github.com/SteamClientHomebrew/Millennium/blob/main/src/system/environment.cc)), and creates it with `fs.create_directories` once per session. `path()` returns the file path, or `nil` when the variable is absent. When `path()` is `nil`, the write skips the file and still passes the record to the host `logger`. The file has no rotation and no size cap; the growth is observed before a cap or a rotation is added.

### Frontend Logger

The module `frontend/log.ts` owns the frontend's logging. It exports `log_info`, `log_warn`, and `log_error`, which each write one line through `console.log`, `console.warn`, or `console.error` with the `[steamapp-verlock]` prefix, and then relay the record to the backend through `bridge.append_log`. The relay is fire-and-forget: a rejected call is swallowed, so a logging failure never interrupts the UI.

### Relay Bridge

The bridge method `append_log` carries a frontend record to the backend. Its payload is `{ level: string; message: string }`. The backend handler accepts a `level` of `info`, `warn`, or `error` and a string `message`; it rejects anything else with an `Ack` error envelope, and on success it calls `log.persist("frontend", level, message)` and returns `{ ok: true }`.

### Privacy and Failure Handling

A log message never contains a token, a credential, or the contents of a captured build-info dump. It carries identifiers such as an app id and an appmanifest path, and short outcome descriptions. Logging is best-effort: a failed directory creation or append is ignored, a rejected frontend relay is swallowed, and no logging failure changes the result of the operation that emitted the record.

## Implementation Plan

The plugin adds `backend/log.lua` and `frontend/log.ts`, and changes `backend/main.lua`, `frontend/bridge.ts`, and the test files below. The operations that emit records — the lock, refresh, and reapply paths in `backend/lock.lua`, the capture path in `frontend/console.ts`, and the rest of [Spec 4](004_app-version-lock.md)'s behavior — are owned by Spec 4 and wire into these helpers in a later change. This spec delivers the mechanism and the relay only.

| File | Role |
|---|---|
| `backend/log.lua` | New; backend logging module: log file, formatting, directory creation, viewer relay |
| `frontend/log.ts` | New; frontend logging helper: console output and relay |
| `backend/main.lua` | Add the `append_log` handler and FFI wrapper; require `log` |
| `frontend/bridge.ts` | Add the `append_log` method |
| `backend/tests/log_spec.lua` | New; `log.lua` unit tests |
| `backend/tests/support/init.lua` | Add `log` to `BACKEND_MODULES`; record logger calls in `stub_logger` |
| `backend/tests/main_spec.lua` | Add `append_log` to the bridge list and its validation cases |
| `frontend/tests/log.test.ts` | New; `log.ts` unit tests |
| `frontend/tests/contract.test.ts` | Add `append_log` and update the method count |
| `.agents/specs/005_testing-strategy.md` | Update the contract count, the unit-test list, and the doubles |

### Function List

#### Backend

`backend/log.lua`

- `info(message: string) -> void` — write one `info` record with source `backend`.
- `warn(message: string) -> void` — write one `warn` record with source `backend`.
- `error(message: string) -> void` — write one `error` record with source `backend`.
- `persist(source: string, level: string, message: string) -> void` — write one record at `level` with `source`; the relay entry point.
- `path() -> string?` — internal/test interface; the log file's absolute path, or `nil` when `MILLENNIUM__LOGS_PATH` is absent.
- `ensure_directory() -> void` — internal/test interface; create `MILLENNIUM__LOGS_PATH` once, ignoring a missing variable or a failed creation.

#### Frontend

`frontend/log.ts`

- `log_info(message: string): void` — write the console line and relay an `info` record.
- `log_warn(message: string): void` — write the console line and relay a `warn` record.
- `log_error(message: string): void` — write the console line and relay an `error` record.

#### Bridge

frontend to backend (`backend` FFI bridge)

- `append_log(payload: { level: string; message: string }): Promise<Ack>` — write one frontend record through the backend logger.

## Risks

- The log file has no rotation or size cap, so it grows for the life of the installation — no preventive measure currently exists; the maintainer observes the growth after release before a cap or a rotation is added.
- The host marks a `.star` plugin's logger viewer-only, so the file is the only persistent record; a host version that also writes a file would add a second one — prevention: the plugin's file name `steamapp-verlock.log` differs from the host's `<plugin>_log.log` name ([`logger.cc`](https://github.com/SteamClientHomebrew/Millennium/blob/main/src/system/logger.cc)).
- The viewer depends on the host `logger`; if its v2 behavior changes, the viewer can lose backend records — prevention: the file is independent of the viewer.
- A log record can carry an appmanifest path into a file that outlives the session — prevention: no record carries a token, a credential, or the contents of a build-info dump.
- A read-only or full filesystem can make directory creation or the append fail — prevention: every logging step is best-effort and never changes the emitting operation's result.

## Alternatives Considered

- **Rely on the host logger alone** — rejected: a `.star` plugin's host logger keeps records in the viewer buffer only, so nothing survives a restart.
- **Both the host file and a plugin-owned file** — rejected: it yields two files wherever the host writes one, and every backend record appears twice.
- **Cap and rotate the file now** — deferred: a cap and a rotation are added only when observed growth justifies them.
