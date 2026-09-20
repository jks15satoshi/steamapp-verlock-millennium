---
status: active
type: process
---

# Spec 1 - Toolchain Selection

## Summary

This spec fixes the toolchain that builds, checks, and tests the `Steam App Verlock` Millennium plugin and its spec corpus. It selects the plugin build system, the package manager, the source languages, the tool that pins tool versions, and the code-quality tools for the Lua backend and the TypeScript/React frontend. [Spec 5](005_testing-strategy.md) owns the test organization; this spec owns the runners that organization invokes.

## Motivation

The plugin spans a Lua backend, a TypeScript/TSX frontend, and a compiled plugin package; the spec corpus adds Markdown. Without one agreed toolchain, contributors pick incompatible build paths, the compiled artifact drifts from source, and each contributor runs a different quality baseline. One toolchain keeps the build reproducible and the checks uniform.

## Design

### Plugin Build System

The plugin build uses Starlight, Millennium's plugin compiler. Starlight reads `millennium.toml` and compiles the Lua backend, the TSX frontend, and the declared resources into one installable plugin. `bun run build` runs `starlight pack`; `[compiler].output_path = "auto"` installs the build into the detected Millennium installation. `bun run dev` runs `starlight watch` for rebuilds during development. `bun run prepare` runs `starlight lsp`, which generates the `.millennium/` type stubs the frontend imports. `millennium.toml` is the single plugin manifest; the project does not use the legacy `plugin.json`.

### Package Manager

Bun manages the frontend dependency tree and runs the project scripts. `bun.lock` is committed so every checkout resolves the same dependency graph, and it pins the JavaScript and TypeScript tools listed in [Tool Version Pinning](#tool-version-pinning).

### Languages

The backend is Lua under `backend/`. It runs on Millennium's LuaJIT host and has native filesystem and network access. The frontend is TypeScript with TSX under `frontend/`, and it runs inside Steam's React UI. `millennium.toml` is TOML. Resources and persistent plugin state are JSON.

### Tool Version Pinning

mise pins the runtime and repository-level tools: `bun`, `node`, `lua`, `luajit`, `stylua`, `lua-language-server`, `cspell`, `markdownlint-cli2`, and `tombi`. `mise.toml` declares the tools, `mise.lock` is committed, and `mise.local.toml` carries machine-local overrides and stays untracked. Continuous integration provisions these pinned versions with `mise`; a local contributor may use `mise` or install the same versions by hand. The package manager pins the JavaScript and TypeScript tools — `@steambrew/starlight`, `typescript`, `oxlint`, `oxlint-tsgolint`, `oxfmt`, and `lefthook` — through `bun.lock`. The Lua development tools `luacheck`, `busted`, and `luacov` come from LuaRocks, provisioned by the committed `scripts/setup-luarocks.sh` and `scripts/setup-luarocks.ps1`, which pin LuaRocks `3.13.0`, and by the dev rockspec.

### Frontend Code Quality

The Oxc toolchain checks the frontend. `oxlint` lints TypeScript and React code; `oxfmt` formats it; `oxlint --type-aware --type-check` reports type-aware lint diagnostics and compiler errors. `tsc --noEmit` stays the authoritative compiler check, because the Oxc type engine tracks a pinned TypeScript release. `cspell` checks spelling. The frontend tools other than `cspell` are pinned through `bun.lock`; `cspell` is pinned by `mise`.

### Backend Code Quality

`luacheck` performs static analysis on Lua. StyLua formats Lua. `lua-language-server` supplies type hints and diagnostics. `cspell` checks spelling. `luacheck` comes from LuaRocks; `stylua` and `lua-language-server` come from `mise`.

### Lint Rule Policy

The frontend lint policy lives in `.oxlintrc.json`, and the backend lint policy lives in `.luacheckrc`. `oxlint` enables the `correctness` and `suspicious` categories as errors and the `perf` category as warnings; a `perf` warning does not fail `bun run lint`. `tsconfig.json` includes the `ES2023` library so the frontend may use `Array.prototype.toSorted`. `luacheck` sets `max_line_length` to `120`, matching StyLua's `column_width`.

Three `oxlint` rules are off because the plugin's Steam-bound code would violate them by design: `typescript/no-unsafe-type-assertion`, because the Steam globals and the bridge payloads are untyped; `eslint/no-await-in-loop`, because the lock, refresh, and restore operations must run their backend calls one at a time; and `eslint/no-unmodified-loop-condition`, because a test loop's callback mutates the condition the rule cannot see. `eslint/no-underscore-dangle` allows the React internal property `_owner`.

### Repository Quality

EditorConfig fixes line endings, indentation, and charset per file type. markdownlint-cli2 checks the repository Markdown, including the spec corpus, while the corpus's content still follows [Spec 0](000_metaspec.md). `tombi` formats and lints TOML. `cspell` checks spelling across the repository. `markdownlint-cli2`, `cspell`, and `tombi` are pinned by `mise`.

### Git Hooks and Continuous Integration

lefthook installs a `pre-commit` hook that runs the formatters, the linters, and the type checks on staged files, and it blocks the change when a check fails. GitHub Actions runs the `verification` workflow, whose jobs run the full check set on an Ubuntu runner and the test suites from [Spec 5](005_testing-strategy.md) on a Windows and an Ubuntu runner. The two-runner matrix covers the platform-specific path and read-only behavior the plugin depends on. GitHub Actions also runs the `spec-status` workflow, which executes `.github/scripts/verify-spec-status.ts` and fails a ready-for-review pull request that contains an `active` `feature` spec ([Spec 0](000_metaspec.md#statuses)); `master`'s branch protection requires the workflow's check before a merge. GitHub Actions also runs the `release` workflow on a version tag, and it calls the `verification` workflow through `workflow_call`; [Spec 9](009_release-and-distribution.md) owns the release workflow's mechanics.

## Alternatives Considered

No genuine alternative was considered.
