---
name: spec-prose-style
description: Reviews or writes prose in Spec documents under .agents/specs/; advisory style guidance for clarity, tone, and structure, subordinate to the Prose Rules in Spec 0.
---

# Spec Prose Style

[Spec 0](../../specs/000_metaspec.md#prose-rules) owns the Prose Rules for Spec prose; see [Spec 2](../../specs/002_agent-skills.md#authority-boundary) for how a skill relates to a Spec.

## Scope

Apply this skill to the body text of Spec documents under `.agents/specs/`. This skill does not cover code comments, README files, or other prose.

## Style Advice

- **Open with the point.** State the rule or fact first and the qualification after; a reader can stop once the point lands.
- **Prefer active voice.** Passive voice hides who does what; reserve it for the case where the actor is genuinely unknown or irrelevant.
- **Keep one idea per paragraph.** Split a paragraph that carries two rules, or a rule plus a parenthetical aside.
- **Prefer concrete verbs over noun-heavy phrasing.** "The backend rewrites the field" reads faster than "the field is subject to a rewrite by the backend".
- **Use one term for one concept.** Repeating a term keeps the reader from pausing over a synonym that might carry a different meaning.
- **Keep the tone neutral and declarative.** Do not address the reader directly or ask rhetorical questions; Spec prose states, it does not persuade.
- **Ground an abstract statement with a one-sentence example.** When a statement is hard to picture, follow it with an example of one sentence.
- **Lead each `## Alternatives Considered` entry with a bold name and state why it lost in one sentence.** A reader scans the bold lead and skips the entries that do not apply.
- **Offer viable options and name the difference.** When a decision needs the maintainer's choice, present two or three viable options, recommend one, and state the factual or structural difference; skip inferior distractors, so the reasons are on the record when the choice is made (see [Alternative Provenance](../../specs/000_metaspec.md#alternative-provenance)).
- **Prefer an honest gap to a plausible guess.** A rejection reason the decision did not establish is fabrication even when it sounds convincing; [Alternative Provenance](../../specs/000_metaspec.md#alternative-provenance) owns the wording for the gap.
- **Reserve emphasis for the clause that changes behavior.** Emphasis on every other clause leaves nothing standing out.
- **Use a table for a set of parallel items and a paragraph for a chain of reasoning.** A table flattens reasoning that a reader must follow in order.

## Workflow

1. Read the [Spec 0 Prose Rules](../../specs/000_metaspec.md#prose-rules) before editing.
2. Draft the change.
3. Apply the Style Advice above.
4. Re-read the result against Spec 0 and the surrounding Specs, and drop any advice that made a sentence less clear.
