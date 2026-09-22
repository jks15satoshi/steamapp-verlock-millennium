# AGENTS.md

Millennium plugin that pins a Steam app to its installed build. The Lua backend runs in
Millennium's LuaJIT host; the TS/TSX frontend runs in Steam's React UI. `millennium.toml`
is the only plugin manifest (there is no `plugin.json`).

## Authority

`.agents/specs/` holds the project's decisions and is the source of truth; where prose
elsewhere disagrees, the spec wins. Read @.agents/specs/000_metaspec.md before creating or
editing a spec. Commit, branch, issue, and PR rules are owned by
@.agents/specs/003_collaboration-conventions.md; agents carry the same obligations as
humans. `README.md` and `README.zh-CN.md` give the project overview. `CONTRIBUTING.md` is a
human onboarding guide that owns no rule and defers to Spec 3.

Any directory that contains an `AGENTS.md` may also contain a gitignored, machine-local
`AGENTS.local.md`; read it when present and follow it.

## Setup

Tools are pinned by `mise` (`mise install`). The Lua tools are not on npm; provision them
from LuaRocks:

    bun install
    bun run setup:lua   # builds .rocks/, needs `mise where luajit`
    bun run prepare     # generates the .millennium/ type stubs

`.rocks/`, `.millennium/`, `.tmp/`, and `coverage/` are generated and gitignored; never edit
or commit them. `bun run prepare` is required before `bun run typecheck`.

## Commands

    bun run test        # frontend then backend
    bun run test:frontend
    bun run test:backend
    bun run lint
    bun run typecheck
    bun run format
    bun run spell
    bun run build
    bun run dev

`package.json` holds the full script list and each script's implementation.

Single tests:

    bun test frontend/tests/locked.test.ts
    busted backend/tests/lock_spec.lua
    busted --filter="lock_app"      # Lua pattern matched against test names

## Gotchas

- Starlight rewrites parts of the committed repository config on `prepare`, `build`, and
  `dev`; do not hand-edit or format what it owns. @.agents/specs/001_toolchain.md records
  what it rewrites and how CI checks it.
- A new domain word fails `bun run spell`; add it to `.cspell.json`.
- `lefthook.yml` hooks format, lint, and typecheck on staged files; CI runs the full set.
- Commit, branch, issue, and PR rules live in Spec 3 and the `.github/` templates; follow
  them instead of restating them.
