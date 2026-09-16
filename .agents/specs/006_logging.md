---
status: active
type: feature
---

# Spec 6 - Logging

## Summary

This spec defines the plugin's logging: how the Lua backend and the TS/TSX frontend record operational events, where those records land, and how a frontend record reaches the same destination as a backend record. The mechanism routes both sides through the `logger` module of Millennium's Lua host, which prints each record, buffers it for the in-app log viewer, and appends it to one file; the plugin creates the host's log directory when the host does not. [Spec 4](004_app-version-lock.md) owns the operations that emit the records, and [Spec 5](005_testing-strategy.md) owns the tests.

## Motivation

The plugin performs background work — build-info capture, refresh, reapply, and Restore All — that a user never sees directly, and a failure leaves no record once the session ends. The frontend's `console.*` output lives only in the Steam UI console, and the backend's `logger` output lives only in the Millennium log viewer and the host console for the current session.

Millennium's Lua host already provides the natural sink. Its `logger` module forwards each call to the host's per-plugin logger, which prints the line to the console, buffers it for the in-app viewer, and appends it to `<MILLENNIUM__LOGS_PATH>/<plugin>_log.log`. The host leaves three gaps. It opens the file without creating the log directory, and on Linux no other component creates that directory, so the open fails silently and the file never appears. It provides no rotation, so the file grows without bound. And its line format is uneven: an `info` line carries no timestamp, and a `warn` or an `error` line carries no trailing newline.

The frontend contributes a fourth gap: the host captures frontend `console.*` lines for the viewer in memory only, so a frontend failure the user does not witness is lost at restart.

The plugin therefore adopts the host logger as its single sink, creates the missing directory, and gives every record a consistent timestamp and source tag. It adds no second file.

## Design

### Log Layers

A log record has one of three levels — `info`, `warn`, or `error` — and one of two sources — `BCK` for the Lua backend and `FRT` for the frontend. The backend writes a record by calling the host `logger`. The frontend writes a record by calling `console.*` and then relaying the record to the backend, which writes it through the same host `logger`. Both sources therefore reach the same console, the same log viewer, and the same file.

### Backend Logger

The module `backend/log.lua` owns the backend's logging. It exports `info`, `warn`, and `error`, which each write one record at their level with the `BCK` source, and `persist`, which writes one record at a caller-given level and source for the relay.

Each write formats the text as `<timestamp> [<source>] <message>`, where `<timestamp>` is an ISO 8601 instant in UTC. Because the host omits the timestamp from an `info` line and the newline from a `warn` or an `error` line, the record carries its own timestamp at every level and ends with `\n` at `warn` and `error`. A `warn` or an `error` line therefore shows the host's local timestamp and the record's UTC timestamp; the duplication is accepted for a uniform format.

A write calls the host `logger` through a protected call, so a logging failure never raises into the operation that emitted the record.

### Log Directory

The host opens its log file without creating `MILLENNIUM__LOGS_PATH`, so the plugin creates that directory itself. `backend/log.lua` reads the directory from `utils.getenv("MILLENNIUM__LOGS_PATH")` and creates it with `fs.create_directories` before the first write. The module attempts the creation once per session and ignores its result. A missing variable or a failed creation leaves the log viewer path intact, because the failed file open affects the file only. The first write reaches the host logger after the directory exists, so the host's own open then succeeds.

### Frontend Logger

The module `frontend/log.ts` owns the frontend's logging. It exports `log_info`, `log_warn`, and `log_error`, which each write one line through `console.log`, `console.warn`, or `console.error` with the `[steam-app-verlock]` prefix, and then relay the record to the backend through `bridge.append_log`. The relay is fire-and-forget: a rejected call is swallowed, so a logging failure never interrupts the UI.

### Relay Bridge

The bridge method `append_log` carries a frontend record to the backend. Its payload is `{ level: string; message: string }`. The backend handler accepts a `level` of `info`, `warn`, or `error` and a string `message`; it rejects anything else with an `Ack` error envelope, and on success it calls `log.persist("FRT", level, message)` and returns `{ ok: true }`.

### Log File

The single file is the host's `<MILLENNIUM__LOGS_PATH>/steamapp-verlock_log.log`. The plugin creates the directory but not the file, and it neither rotates the file nor caps its size; the host appends and flushes each line, so the file is complete through the last write even after a crash. The host formats a line around the record: an `info` line is `<plugin> <record>\n`, and a `warn` or an `error` line is `[<local time>] <plugin> <record>`, where the record supplies the newline that the host omits.

### Privacy and Failure Handling

A log message never contains a token, a credential, or the contents of a captured build-info dump. It carries identifiers such as an app id and an appmanifest path, and short outcome descriptions. Logging is best-effort: a failed directory creation is ignored, a rejected frontend relay is swallowed, and no logging failure changes the result of the operation that emitted the record.

## Implementation Plan

The plugin adds `backend/log.lua` and `frontend/log.ts`, and changes `backend/main.lua`, `frontend/bridge.ts`, and the test files below. The operations that emit records — the lock, refresh, and reapply paths in `backend/lock.lua`, the capture path in `frontend/console.ts`, and the rest of [Spec 4](004_app-version-lock.md)'s behavior — are owned by Spec 4 and wire into these helpers in a later change. This spec delivers the mechanism and the relay only.

| File | Role |
|---|---|
| `backend/log.lua` | New; backend logging module: level wrappers, relay, formatting, directory creation |
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

- `info(message: string) -> void` — write one `info` record with source `BCK`.
- `warn(message: string) -> void` — write one `warn` record with source `BCK`.
- `error(message: string) -> void` — write one `error` record with source `BCK`.
- `persist(source: string, level: string, message: string) -> void` — write one record at `level` with `source`; the relay entry point.
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

- The host log file has no rotation or size cap, so it grows for the life of a Millennium installation — no preventive measure currently exists; the spec records the limitation and the rejected rotation alternative.
- The host opens its file without creating the directory or reporting a failed open, so a host or platform change can move the file or drop it — prevention: the plugin creates the directory itself, and the log viewer keeps working when the file does not.
- The host's line format can change across Millennium versions, so the timestamp and newline compensation can become wrong — prevention: the plugin writes through the host `logger` methods only and never parses the host file.
- A log record can carry an appmanifest path into a file that outlives the session — prevention: no record carries a token, a credential, or the contents of a build-info dump.
- A read-only or full filesystem can make directory creation fail — prevention: every logging step is best-effort and never changes the emitting operation's result.

## Alternatives Considered

- **A plugin-owned log file with rotation** — rejected: it adds a second log artifact beside the host's file and gives up the in-app viewer, for a rotation the host does not provide.
- **Both the host file and a plugin-owned file** — rejected: it duplicates every backend record and makes the user reconcile two files.
- **Using the host logger without creating the log directory** — rejected: on Linux the host never creates the directory and its file open fails silently, so the file receives nothing.
- **Frontend logging through `console.*` alone** — rejected: the host captures frontend lines in memory for the viewer only, so nothing survives a restart.
- **No logging** — rejected: a failed lock, refresh, or reapply leaves no post-hoc record for a maintainer to inspect.
