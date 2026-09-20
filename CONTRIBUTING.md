# Contributing

Thanks for helping `Steam App Verlock`, a Millennium plugin that locks Steam apps to their installed builds.

This guide gets a human contributor from a fresh clone to a merged pull request. It summarizes the flow; [Spec 3](.agents/specs/003_collaboration-conventions.md) owns the actual rules and wins if the two disagree.

## Requirements

The project needs these runtimes and tools. `mise install` is the recommended way to get all of them at the pinned versions; `mise.toml` declares the same list if you would rather install them yourself.

Runtimes:

- Bun 1.x
- Node.js 26.x
- Lua 5.4
- LuaJIT 2.1

Tools:

- StyLua 2.x
- lua-language-server 3.x
- LuaRocks 3.13.0
- cspell
- markdownlint-cli2
- tombi

LuaRocks 3.13.0 installs the Lua development rocks (`luacheck`, `busted`, `luacov`). `bun install` brings the JavaScript and TypeScript tools at the versions fixed in `bun.lock`.

## Quick Start

`mise install` is the recommended way to install the pinned tool versions:

    mise install
    bun install
    bun run prepare     # generates the .millennium/ type stubs

You do not have to use `mise`. If you prefer, install the tools from the Requirements list yourself, using the versions declared in `mise.toml`.

The Lua tests run on LuaRocks:

    bun run setup:lua   # builds .rocks/

`setup:lua` finds LuaJIT with `mise where luajit`, so it expects `mise`. Without `mise`, install LuaRocks 3.13.0, `luacheck`, `busted`, and `luacov` yourself.

`.rocks/`, `.millennium/`, `.tmp/`, and `coverage/` are generated and gitignored; never edit or commit them.

## Common Commands

    bun run test                    # frontend then backend
    bun run test:frontend           # bun test frontend
    bun run test:backend            # busted
    bun run lint                    # oxlint + luacheck + tombi
    bun run typecheck               # tsc --noEmit (after prepare)
    bun run format                  # oxfmt, stylua, tombi
    bun run spell                   # cspell
    bun run build                   # starlight pack
    bun run dev                     # starlight watch

Single tests:

    bun test frontend/tests/locked.test.ts
    busted backend/tests/lock_spec.lua
    busted --filter="lock_app"

## Making a Change

- Branch from `master` as `<type>/<slug>`, for example `feat/app-verlock`.
- Prefer a [Conventional Commits](https://www.conventionalcommits.org/) header: `<type>(<scope>): <subject>`. [Spec 3](.agents/specs/003_collaboration-conventions.md) owns the type table, the scope rules, and the subject phrasing.
- Keep one logical change per commit, and run the checks above before you push.

## Opening a Pull Request

- A bug-fix pull request references an issue. A non-trivial change also references the spec that owns it, or says why it is exempt.
- The template asks for `Motivation` (with `Fixes #NN`, `Closes #NN`, `Resolves #NN`, `Related #NN`, or `Refs #NN`), `Changes`, and `Testing`.
- Keep the pull request a draft until the checks and the evidence are ready.
- You may review and merge your own pull request.

## Reporting Bugs and Requesting Features

Open an issue with the matching form: `Bug`, `Feature`, or `Task`. The forms ask for the details a reviewer needs.

## Where to Read More

- [Spec 0](.agents/specs/000_metaspec.md) — the spec process.
- [Spec 1](.agents/specs/001_toolchain.md) — the toolchain and the checks.
- [Spec 3](.agents/specs/003_collaboration-conventions.md) — commit, branch, issue, and pull request rules.
- [Spec 4](.agents/specs/004_app-version-lock.md) — the plugin's behavior.
- [Spec 5](.agents/specs/005_testing-strategy.md) — the test organization.
- [Spec 6](.agents/specs/006_logging.md) — the logging mechanism.
- [Spec 7](.agents/specs/007_native-ui-style-alignment.md) — matching the client's native styling.
- [Spec 8](.agents/specs/008_localization.md) — the localization catalogs and error codes.
