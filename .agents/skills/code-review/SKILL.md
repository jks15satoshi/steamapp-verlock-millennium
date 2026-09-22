---
name: code-review
description: Reviews a change to Steam App Verlock — a diff, a pull request, or another branch — before it lands. Use to find dead or speculative code, duplicated logic, weak tests, invented facts, and scope beyond the request, and to report each finding with evidence.
---

# Code Review

[Spec 2](../../specs/002_agent-skills.md) owns how a skill relates to the specs; this skill offers guidance only and never overrides a spec. A finding that changes user- or model-facing behavior, a shared contract, or a recorded decision is a spec change first ([Spec 0](../../specs/000_metaspec.md#when-to-create-a-spec)).

## Scope

Apply this skill to a change under review: a diff, a pull request, or another branch. Judge the change against `AGENTS.md` and the specs that own the area. Report each finding before any rewrite, and implement only what the user authorizes. Prefer a few well-supported findings over a count of complaints.

This skill owns the review of a change. It delegates the search for removable obligations and the preservation of ownership and failure semantics to the [find-simplifications](../find-simplifications/SKILL.md) skill, and it does not restate that skill's criteria.

## Establish Context

Read `AGENTS.md` and the specs that own the area before judging it — [Spec 1](../../specs/001_toolchain.md) for tooling, [Spec 3](../../specs/003_collaboration-conventions.md) for landing a change, [Spec 4](../../specs/004_app-version-lock.md) for behavior, and [Spec 5](../../specs/005_testing-strategy.md) for tests. A behavior Spec 4 fixes is protected until the user overrides it.

## Review the Change

- **Does every changed line serve the stated motivation?**
  Restate the motivation from the issue, the spec, or the user's request, then compare the diff with it. Flag behavior, configuration, or refactoring beyond the request.
- **Does the change trace to an owner?**
  Name the spec that owns each behavior the change adds or alters; a change that touches behavior, a shared contract, or process without a spec is missing one ([Spec 0](../../specs/000_metaspec.md#when-to-create-a-spec)).
- **What does the change make a consumer do differently?**
  Trace each added field, flag, or branch to a reader whose action it changes; a distinction no consumer acts on is a candidate for removal.

## Removable Obligations

Run the [find-simplifications](../find-simplifications/SKILL.md) skill over the change's dead, duplicated, or speculative code, configuration, and infrastructure. That skill owns the effect-path trace, the reachability proof, and the rejection tests.

## Test Quality

Assert each changed behavior through a test that fails before the change and passes after it.

- An assertion that cannot fail, that restates its setup, or that only checks a mock's call does not cover the behavior; [Spec 5](../../specs/005_testing-strategy.md) owns the layers and doubles the tests use.
- A test that also passes without the change proves nothing about the change.
- A snapshot with no named invariant records the output without stating what must hold.

## Claim and Reference Fidelity

A path, file name, field, key, default, method name, or citation the change states must trace to the code, a cited source, or the user; a plausible guess is not evidence ([Spec 0](../../specs/000_metaspec.md#claim-fidelity)). The `bun run check:refs` check validates the spec and skill links and anchors mechanically.

## Ownership and Failure Semantics

Run the [find-simplifications](../find-simplifications/SKILL.md) skill when the change touches copies, validators, callback captures, or asynchronous machinery. That skill owns the origin, next-owner, and trust-boundary test.

## Report and Handoff

- Record each finding with its `file:line`, the evidence that supports it (`rg` matches, reads, or test runs), its category, and the strongest reason to retain the code.
- Keep each finding's action distinct: remove, narrow with an explicit loss, or retain as protected.
- Update the affected spec, README, test, or configuration in the same change that moves it, so recorded facts stay current.
- Use the [spec-prose-style](../spec-prose-style/SKILL.md) skill when spec prose is in scope.
- Validate with the commands `AGENTS.md` lists — `bun run test`, `bun run lint`, `bun run typecheck`, `bun run spell`, and `bun run format`.

A finding that changes behavior or a shared contract follows the spec process of [Spec 0](../../specs/000_metaspec.md) and the land conventions of [Spec 3](../../specs/003_collaboration-conventions.md). A local, behavior-preserving cleanup needs no spec. A finding that no user authorized yet stays a proposal in the report.
