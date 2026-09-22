---
status: active
type: process
---

# Spec 2 - Agent Skills

## Summary

A skill is a reusable instruction document that an agent loads on demand to guide a recurring task. This spec introduces skills to `Steam App Verlock`. It fixes where a skill lives, how a skill is named and formatted, how an agent discovers a skill, and how a skill relates to the specs that record the project's decisions.

## Motivation

A spec records a decision and the rationale behind it; it is a poor home for reusable guidance that decides nothing — style advice, review checklists, repeatable procedures. Folding such guidance into a spec blurs the line between an obligation and a suggestion and grows the decision corpus, while leaving it unwritten loses it and makes every agent re-derive it per task.

A skill holds reusable guidance, loads only when its task is at hand, and leaves specs the single home for decisions.

## Design

### Location and Naming

A skill lives at `.agents/skills/<name>/SKILL.md`. `<name>` is the skill name in lowercase kebab-case and matches the containing directory; the file is named `SKILL.md` exactly. One skill occupies one directory. Example: `.agents/skills/spec-prose-style/SKILL.md`.

A skill must satisfy the [Agent Skills specification](https://agentskills.io/specification). This spec adopts that specification by reference, pinned to commit `69ef37e9424c0a7ea9dd2293b559e43ec8176379` of `agentskills/agentskills` (source file `docs/specification.mdx`).

The specification owns the `SKILL.md` format and the skill directory layout but not the directory location; it is normative for this project only through this reference, and this spec prevails on any conflict. Adopting a newer version requires a spec change.

The directory location is the cross-client convention `.agents/skills/`, which the project adopts.

### File Format

The `SKILL.md` frontmatter fields and constraints are owned by the [Agent Skills specification](https://agentskills.io/specification) (see [Location and Naming](#location-and-naming)). The project adds three rules on top of that specification.

The `description` is written in the third person, leads with the words that trigger the skill, and states the condition that selects it. The frontmatter carries no `status` and no `type`: a skill is not a decision record. The body is Markdown and uses the same basic constructs as a spec body (see [Plain Markdown](000_metaspec.md#plain-markdown)).

At this stage the project uses none of the specification's optional frontmatter fields (`license`, `compatibility`, `metadata`, `allowed-tools`).

### Discovery

An agent discovers a skill by scanning the `.agents/skills/` tree for `SKILL.md` files. Discovery is defined by the harness — the agent runtime that loads skills — not by this spec: a harness that scans `.agents/skills/` by default loads every skill under it, and a harness that does not scan `.agents/skills/` by default reads the path when the project registers it in that harness's configuration.

The project ships that registration for each harness it supports. A skill whose directory or `SKILL.md` file is absent is not loaded.

### Authority Boundary

A spec records a decision, the contract that decision fixes, and the rules the decision imposes. A skill offers guidance only. A skill never states a decision, never restates a rule a spec already carries, and never overrides a spec. When a skill and a spec disagree, the spec prevails.

A skill that needs a rule links to the spec section that owns it instead of copying the rule. The `spec-prose-style` skill is one instance: it is subordinate to the [Prose Rules](000_metaspec.md#prose-rules) in Spec 0.

### Scope

This spec establishes the skills mechanism. A skill carries reusable operational guidance or an advisory standard.

### Skill Versus Spec

A decision, or a contract shared across files, packages, or components, is recorded as a spec (see [When to Create a Spec](000_metaspec.md#when-to-create-a-spec)). Reusable operational guidance, or advisory style that no decision depends on, is recorded as a skill. A skill never replaces a spec: the spec states what the project decided, and the skill states how to apply guidance.

## Alternatives Considered

- **A harness-native skills directory**  
  rejected: `.agents/skills/` is the cross-client convention that a harness scans in addition to its native path, so one skill tree serves every supported harness.
- **Reusable guidance inside a spec**  
  rejected: mixing guidance with decisions blurs the boundary a spec owns and grows the decision corpus; a skill keeps decisions and guidance distinct.
- **A separate spec for each piece of guidance**  
  rejected: guidance is not a decision, and a spec per guidance item bloats the decision corpus and forces the full spec skeleton on advice.
- **A dedicated docs directory instead of skills**  
  rejected: a docs directory is loaded wholesale and carries no on-demand trigger; a skill's `description` selects it for the task at hand.
- **Normative rules inside a skill**  
  rejected: an obligation a spec owns stays in the spec; a skill that restates it drifts and creates a second authority.
- **Vendoring an existing harness's skills**  
  rejected: those skills encode that harness's own conventions and gates; this project borrows the mechanism, not the corpus.
- **No skills mechanism**  
  rejected: reusable guidance then has no home, and each agent re-derives it for every task.
- **Project-local frontmatter rules instead of conformance**  
  rejected: a second, partial copy of the format drifts from the specification and creates a competing authority; the project adopts the specification by reference instead.
- **Following the latest specification with no anchor**  
  rejected: the specification is unversioned, so an external edit would change the project's obligations without a spec change; pinning a commit keeps adoption a deliberate decision.
