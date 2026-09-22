---
name: find-simplifications
description: Finds evidence-backed simplifications in Steam App Verlock code, specs, configuration, tests, and prose; assists a survey, a small local cleanup, or an assessment of another branch. Use for removing dead, duplicated, speculative, or unnecessarily maintained behavior and infrastructure.
---

# Finding Simplifications

[Spec 2](../../specs/002_agent-skills.md) owns how a skill relates to the specs; this skill offers guidance only and never overrides a spec. A simplification that changes user- or model-facing behavior, a shared contract, or a recorded decision is a spec change first ([Spec 0](../../specs/000_metaspec.md#when-to-create-a-spec)).

## Scope

Apply this skill to `backend/`, `frontend/`, `.agents/specs/`, configuration, tests, and prose. A survey is not permission to implement its proposals: report candidates, then implement only what the user authorizes. Prefer a few well-supported candidates over a count of deletions.

## Establish Context

Read `AGENTS.md` and the specs that own the area before judging it — [Spec 1](../../specs/001_toolchain.md) for tooling, [Spec 3](../../specs/003_collaboration-conventions.md) for landing a change, [Spec 4](../../specs/004_app-version-lock.md) for behavior, and [Spec 5](../../specs/005_testing-strategy.md) for tests. A behavior Spec 4 fixes is protected until the user overrides it; an unused helper inside that behavior is still a candidate.

For a broad survey, divide independent areas — backend modules, frontend modules, specs, tests, and tooling — among subagents, and require each to return consumer evidence and rejected candidates.

## Search for Removable Obligations

- **Does a declared capability have a complete effect path?**
  Trace producer, transformations, bridge, and observable result; a field copied everywhere may still have no reader. Search both `main.lua`'s dispatch table and the bridge types in Spec 4.
- **Which distinctions change a consumer's action?**
  Several internal states may require one displayable status. Keep the distinctions that control a real decision.
- **Can a consumer read the authoritative value when needed?**
  Look for copied state beside a shared source; derivation may delete a cache and its invalidation path together.
- **What owns the complete maintenance cost?**
  Trace pass-through configuration, duplicate definitions, and helpers with their own lifecycle; compare the whole removed system with its replacement, including residual glue.

## Prove Reachability

Start with `rg`, then read the matches. Search exact symbols, property reads and writes, bridge method names, config keys, and both `.method(` and `method(` forms. Tests and type declarations can show a contract without proving a shipped producer or consumer.

Cover `backend/`, `frontend/`, `.agents/specs/`, `scripts/`, `package.json`, and `millennium.toml`. For each candidate, record its current owner, its effective producer and consumer path, what disappears, what remains, and the strongest reason to retain it. Distinguish:

- removal of unreachable or unread behavior;
- a narrower behavior with an explicit loss;
- a protected obligation or insufficient evidence.

Reject a candidate that breaks a protected obligation, merely relocates the same complexity, or has no meaningful reduction.

## Preserve Ownership and Failure Semantics

For copies, validators, and callback captures, name the value's origin, next owner, and trust boundary (see [Spec 4](../../specs/004_app-version-lock.md#build-info-validation)). A typed same-process call ordinarily borrows a readonly value.

For asynchronous machinery, map each promise, flag, cancellation path, and disposer to its owner and transition. Collapse mechanisms only when they express the same fact, and preserve synchronous publication, rollback, and first-terminal-outcome arbitration where the behavior depends on them.

## Record and Validate

Use the [spec-prose-style](../spec-prose-style/SKILL.md) skill when spec prose is in scope. Update the affected spec, README, test, or configuration in the same change that moves it, so recorded facts stay current.

A supported simplification that changes behavior or a shared contract follows the spec process of [Spec 0](../../specs/000_metaspec.md) and the land conventions of [Spec 3](../../specs/003_collaboration-conventions.md). A local, behavior-preserving cleanup needs no spec. A small improvement that no user authorized yet stays a proposal in the report.

Validate with the commands `AGENTS.md` lists — `bun run test`, `bun run lint`, `bun run typecheck`, `bun run spell`, and `bun run format` — and report the areas surveyed, the supported candidates, and the meaningful rejections.
