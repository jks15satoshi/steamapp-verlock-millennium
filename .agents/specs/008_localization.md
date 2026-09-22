---
status: active
type: feature
---

# Spec 8 - Localization

## Summary

This spec defines how `Steam App Verlock` localizes its user-facing text: the catalog files that map a message key to a display string, how the plugin selects a catalog from the running Steam client's language, the fallback rules when a language or a key is absent, and the backend error codes the frontend turns into localized messages.

The plugin supports English and Simplified Chinese; every other Steam language falls back to English.

[Spec 4](004_app-version-lock.md) owns the operations and the user interface that show the text, and [Spec 5](005_testing-strategy.md) owns the tests.

## Motivation

The plugin hardcodes its user-facing text in English. A Simplified Chinese user — the audience of the project's `README.zh-CN.md` — reads an English library context menu, an English settings panel, and English failure messages, even though the Steam client already carries the user's language. A localized plugin follows the client's language instead of asking the user to choose one.

Two kinds of text reach the user. The frontend owns the menu and the settings panel's labels, buttons, and status messages. The backend owns the failure text of the lock, refresh, unlock, reapply, Restore All, and data-root operations, which the frontend displays verbatim in its status area. Localizing only the frontend leaves half the user-visible text in English, so the design covers both kinds.

## Design

A **catalog** is one JSON file that maps a **message key** — a dotted identifier such as `settings.restore_all` — to a display string. The plugin ships one catalog per supported language and selects one at run time. The plugin reads the selected language from the Steam client, and every lookup falls back to English when the selected catalog or the requested key is absent.

### Supported Languages

The plugin supports English and Simplified Chinese. English is the source catalog and serves as the fallback; Simplified Chinese is the first translation. A language the plugin does not support resolves to English, so the plugin never shows a key or an empty string in place of a message.

### Catalog Files

`frontend/locales/english.json` is the source of truth: every message key appears in it. `frontend/locales/schinese.json` carries the Simplified Chinese translation of every key. A catalog is a flat JSON object whose values are strings, and the two files carry the same key set; a key that only one file carries is a defect, and [Spec 5](005_testing-strategy.md) owns a test that refuses it.

The plugin imports both catalogs as modules. Starlight bundles the frontend with rolldown, which compiles a `.json` import without extra configuration, so the catalogs add no build step and no runtime fetch.

### Message Keys

A message key is lowercase `snake_case` segments separated by `.`. The first segment is the namespace, which groups keys by the surface that shows them.

| Namespace | Covers | Examples |
|---|---|---|
| `menu.*` | Library context menu, and the shared `Lock`, `Refresh`, and `Unlock` labels | `menu.lock`, `menu.unlock`, `menu.state.locked` |
| `gamepage.*` | Library game page badge | `gamepage.last_refreshed` |
| `settings.*` | Settings panel labels, buttons, and field captions | `settings.locked_apps`, `settings.restore_all`, `settings.data_root_label` |
| `settings.status.*` | Settings panel status messages | `settings.status.load_failed`, `settings.status.restored_all` |
| `properties.*` | App Properties tab labels and behavior names | `properties.lock_snapshot`, `properties.behavior.launch` |
| `dialog.*` | Dialog controls shared by the failure and content dialogs | `dialog.copy_error`, `dialog.close` |
| `actions.*` | Operation titles, success toasts, and rollback warnings | `actions.lock_failed`, `actions.locked_success` |
| `common.*` | Short words shared across surfaces | `common.yes`, `common.no`, `common.never`, `common.unknown` |
| `error.*` | Failure messages, one key per backend error code | `error.not_installed`, `error.manifest_write_failed` |

The group label `Steam App Verlock` names the project and is never translated. A status message that embeds a value carries an interpolation placeholder in place of the value (see [Lookup and Interpolation](#lookup-and-interpolation)).

The catalogs are the authoritative inventory of message keys. `frontend/i18n.ts` derives a `MessageKey` type from `english.json`, so a call site that names a key the source catalog lacks fails the type check.

### Language Detection

`SteamClient.Settings.GetCurrentLanguage()` returns the Steam client's language as a short name. The plugin maps the short name to a catalog with a fixed table: `english` selects `english.json` and `schinese` selects `schinese.json`. Any other short name, a rejected call, or an absent `Settings` object resolves `english`. The plugin never throws on a failed or unknown detection.

### Lookup and Interpolation

`t(key, params?)` returns the display string for one message key. It reads the selected catalog, then the English catalog, then the key itself, so a lookup always returns a string. Interpolation replaces each `{{name}}` placeholder in the resolved string with the matching `params` value; a placeholder without a matching parameter stays verbatim, and a parameter without a placeholder is ignored.

The plugin implements no plural rules. A message that embeds a count is phrased so that one written form fits every count, or it stays as the catalog wrote it.

### Frontend Wiring

`frontend/index.tsx` calls `init_i18n()` when the plugin loads, and the settings panel calls `refresh_locale()` when it mounts, so a language change shows after the panel is reopened.

`frontend/menu.tsx`, `frontend/settings.tsx`, `frontend/properties.tsx`, `frontend/notify.tsx`, and `frontend/actions.ts` replace every user-visible literal and every assembled status string with a `t(...)` call. `frontend/gamepage.tsx` replaces the badge's `Last refreshed` label with a `t("gamepage.last_refreshed")` call; the formatted timestamp under it is produced by `frontend/time.ts` and is not a message.

A failure message the frontend assembles from a value, such as an app id, passes the value as an interpolation parameter instead of concatenating it.

`frontend/settings.tsx` formats a timestamp with `format_client_time` and passes a language tag for the selected catalog — `en` for English and `zh-CN` for Simplified Chinese — so the date follows the same language as the surrounding text. The group label `Steam App Verlock` and the properties tab label of the same text stay untranslated.

### Backend Error Codes

Every backend operation reports a failure as the `Ack` envelope of [Spec 4](004_app-version-lock.md#shared-types), which carries an `error` string and an optional `code`. This spec requires a stable `code` for every failure the settings panel can display.

A `code` is a lowercase `snake_case` identifier from the closed set below; the `error` string stays a developer diagnostic and is never displayed when its code has a translation.

| Code | Condition |
|---|---|
| `invalid_appid` | The payload's `appid` is absent or not a numeric string, or a `dumps` map key is not a numeric string. |
| `invalid_behavior` | `auto_update_behavior` is present but not a number. |
| `invalid_target` | A `read_file` payload's `target` is neither `appmanifest` nor `lock`. |
| `build_info_required` | A captured-dump payload carries no `dump`. |
| `dump_parse_failed` | The captured dump does not parse. |
| `dump_validation_failed` | The parsed dump lacks a required field or carries an invalid depot manifest. |
| `already_locked` | A lock targets an app that already has a record. |
| `not_locked` | A refresh, unlock, or reapply targets an app with no record. |
| `not_installed` | Discovery finds no appmanifest for the app. |
| `not_fully_installed` | The app's `StateFlags` lacks `FullyInstalled` or carries a download or pending-update bit. |
| `cannot_read_manifest` | The appmanifest cannot be read. |
| `cannot_parse_manifest` | The appmanifest does not parse. |
| `manifest_write_failed` | The appmanifest write or rename fails. |
| `record_persist_failed` | The lock record cannot be written. |
| `record_read_failed` | A lock record exists but does not decode or lacks a required field. |
| `operation_in_progress` | Another operation holds an app's write serialization. |
| `record_removed` | A reapply finds the lock record removed after the reapply began. |
| `restore_in_progress` | A restore or a migration already runs. |
| `data_root_required` | A `set_data_root` payload carries no path. |
| `data_root_invalid` | The candidate data root fails validation. |
| `default_data_root_unavailable` | An empty `set_data_root` cannot resolve the OS-conventional default. |
| `migration_in_progress` | A data-root migration already runs. |
| `migration_failed` | A migration cannot copy, verify, or persist the lock data. |
| `unknown_method` | The bridge receives a method name its dispatch table lacks. |
| `read_failed` | `read_file` cannot resolve or read the target file, or the file exceeds the display limit. |
| `steam_path_unavailable` | Discovery cannot run because `MILLENNIUM__STEAM_PATH` is absent. |
| `console_unavailable` | The Steam console API is absent, so a capture cannot start. |
| `capture_timeout` | A capture's time limit expires with no non-empty dump. |
| `invalid_response` | A bridge response is not an `Ack`. |
| `unlock_failed` | The frontend's unlock path catches a rejected or invalid bridge call. |
| `restore_all_failed` | The frontend's restore path catches a rejected or invalid bridge call. |

A code names the failure, not the operation that hit it. `not_installed` therefore serves lock, refresh, unlock, reapply, and Restore All alike, and the frontend displays the same message for each.

### Error Resolution

`resolve_error(result)` returns the localized message for a failed `Ack`. It uses `t("error." + result.code)` when `result.code` is present, falls back to `result.error` when the code is absent or the key is missing, and falls back to `t("error.unknown")` when both are absent. The `error.*` key set equals the code set above, and [Spec 5](005_testing-strategy.md) owns a test that refuses a code without a key.

### Scope

This spec covers the plugin's user-facing text: the library context menu, the settings panel, the app Properties tab, the library game page badge, the failure and content dialogs, the operation toasts, and the failure messages the surfaces display.

It excludes the plugin's log messages, which are developer diagnostics and stay in English under [Spec 6](006_logging.md); the plugin manifest's `name` and `description`; the group label `Steam App Verlock`; and the repository's Markdown, which the bilingual `README.md` and `README.zh-CN.md` already cover.

## Implementation Plan

The plugin adds three frontend files and changes the files below. The frontend error paths in `console.ts` and `watch.ts` gain a `code` on each failure they return, and the backend modules gain a `code` on each failure the settings panel can display. The behavior those failures guard is owned by [Spec 4](004_app-version-lock.md) and does not change.

| File | Role |
|---|---|
| `frontend/locales/english.json` | New; source catalog and fallback |
| `frontend/locales/schinese.json` | New; Simplified Chinese catalog |
| `frontend/i18n.ts` | New; language selection, `t`, error resolution |
| `frontend/index.tsx` | Call `init_i18n()` when the plugin loads |
| `frontend/menu.tsx` | Replace every literal with `t(...)` |
| `frontend/settings.tsx` | Replace every literal and status string with `t(...)`; call `refresh_locale()` on mount; format dates with `current_locale_tag()` |
| `frontend/gamepage.tsx` | Replace the badge's `Last refreshed` label with `t("gamepage.last_refreshed")` |
| `frontend/properties.tsx` | Replace every label and behavior name with `t(...)` |
| `frontend/notify.tsx` | Replace the dialog controls and fallback text with `t(...)` |
| `frontend/actions.ts` | Replace the operation titles, success toasts, and rollback warnings with `t(...)` |
| `frontend/console.ts` | Carry a `code` on each capture failure |
| `frontend/watch.ts` | Carry a `code` on each unlock and restore failure |
| `backend/main.lua` | Carry a `code` on each user-visible failure |
| `backend/lock.lua` | Carry a `code` on each user-visible failure |
| `backend/state.lua` | Carry a `code` on a record read or write failure |
| `backend/paths.lua` | Carry a `code` on a path validation or discovery failure |
| `backend/migrate.lua` | Carry a `code` on each migration failure |
| `backend/buildinfo.lua` | Carry a `code` on each dump parse or validation failure |
| `backend/acf.lua` | Carry a `code` on each appmanifest read or write failure |
| `frontend/tests/i18n.test.ts` | New; `i18n.ts` unit tests |
| `frontend/tests/harness.ts` | Add the `Settings.GetCurrentLanguage` fake |
| `frontend/tests/contract.test.ts` | Assert catalog key parity and error-code coverage |
| `backend/tests/*_spec.lua` | Assert the `code` on each covered failure |
| `.agents/specs/004_app-version-lock.md` | Update the `Ack` code facts |
| `.agents/specs/005_testing-strategy.md` | Add the `i18n.ts` unit test and the parity test |
| `.cspell.json` | Add the new domain words |
| `CONTRIBUTING.md` | Point its Where to Read More section at the specs directory |

### Function List

#### Frontend

`frontend/i18n.ts`

- `init_i18n(): Promise<void>`  
  Resolve the Steam client's language through `SteamClient.Settings.GetCurrentLanguage` and select the matching catalog; resolve English on an unknown language, a rejected call, or an absent `Settings` object, and do nothing on a later call.
- `refresh_locale(): Promise<void>`  
  Re-resolve the client's language and select the matching catalog; keep the current catalog when the call is rejected or returns an unknown language, so a transient failure never demotes a translated user to English.
- `t(key: MessageKey, params?: Record<string, string | number>): string`  
  Resolve one message key through the selected catalog, the English catalog, and the key itself, then interpolate the given parameters.
- `resolve_error(result: Ack): string`  
  Resolve a failed `Ack` to a localized message through its `code`, its `error`, and `t("error.unknown")`, in that order.
- `current_locale(): string`  
  Internal/test interface; return the selected catalog's language short name.
- `current_locale_tag(): string`  
  Internal/test interface; return the `Intl` language tag for the selected catalog (`en` or `zh-CN`).
- `set_locale(language: string): void`  
  Internal/test interface; select a catalog by language short name, resolving an unknown name to English.
- `MessageKey`  
  The union of the source catalog's keys, derived from `english.json`.

## Risks

- A backend failure that reaches the settings panel without a `code` shows its English `error` text.  
  Prevention: the code set above covers every displayable failure, and [Spec 5](005_testing-strategy.md) owns a test that refuses a code absent from the catalogs.
- A message key present in one catalog but not the other shows the English string through the fallback.  
  Prevention: the parity test refuses a key that only one file carries.
- A new frontend string that omits a `t(...)` call stays English.  
  Prevention: the `MessageKey` type catches a missing key only at a call site that uses one, so reviewers check the two UI files against the catalogs.
- A Steam client update can change or remove `GetCurrentLanguage`.  
  Prevention: a missing or rejected call resolves English before any lookup.
- A language change while Steam runs can leave the already-rendered menu in the previous language until the menu is reopened.  
  Prevention: the settings panel re-resolves the language when it mounts, and the Steam client reloads the UI on a language change.
- A translation can lag the English string after the English catalog changes.  
  Prevention: parity is enforced on the key set, not on the text, so a translated value is correct in the sense of being present; a reviewer refreshes a stale value when the English text changes meaning.

## Alternatives Considered

- **`i18next` or `react-i18next`**  
  Rejected: the plugin carries a few dozen strings and no plural or date rules beyond `toLocaleString`; a small module with JSON catalogs keeps the dependency tree empty and follows the custom locale manager Millennium itself uses.
- **Map the English `error` strings in the frontend**  
  Rejected: it couples the frontend to exact backend wording, so a reworded backend message silently loses its translation; a stable `code` survives a wording change.
- **Return already-localized text from the backend**  
  Rejected: the backend has no language and no catalog, and reaching the frontend's selected language from Lua would couple the backend to the UI layer.
- **Support every Steam language now**  
  Deferred: only English and Simplified Chinese have an author who can maintain them, and an unmaintained catalog shows English through the fallback; a later catalog is an additive change under this spec.
- **Re-render the menu when the language changes without reopening it**  
  Rejected: Millennium's own locale manager reads the language once at startup, and a language change reloads the Steam UI, so a subscription adds a moving part for a case the client already handles.
