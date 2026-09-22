---
name: spec-prose-style
description: Reviews or writes prose in Spec documents under .agents/specs/; advisory style guidance for clarity, tone, structure, and writing for a human reader, subordinate to the Prose Rules in Spec 0.
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
- **Put a list item's explanation on its own line.** End the lead with two trailing spaces, drop the em dash, and place the explanation on the next indented line, capitalizing its first letter unless it opens with code.

## Human-Readable Prose

[Spec 0](../../specs/000_metaspec.md#prose-rules) owns the normative rules for substance, claim fidelity, and plain statement. The advice below keeps spec prose reading like a person wrote it for one reader.

- **Use as many items as the meaning needs.** Give three examples only when the meaning has three parts; otherwise merge them or develop the strongest one.
- **Vary sentence openings.** Merge consecutive sentences that share their subject and verb shape.
- **Connect clauses with a period, comma, colon, or parentheses.** Reserve the dash for a deliberate choice; the corpus uses em dashes at its own rate.
- **Choose the plain word** over model-worn vocabulary such as "delve", "testament", "landscape", "showcase", "pivotal", "meticulous", "vibrant", and "enhance". A formal word outside that list is fine.
- **Let the heading carry the point.** Start a section with its content, not a sentence that repeats the heading.
- **Describe the current behavior**, not the version it replaced; change history belongs to change logs and release notes.
- **Keep headings in Title Case** ([Title Format](../../specs/000_metaspec.md#title-format) owns the rule) and use no emojis or decorative arrows.

## Workflow

1. Read the [Spec 0 Prose Rules](../../specs/000_metaspec.md#prose-rules) before editing.
2. Draft the change.
3. Apply the Style Advice and Human-Readable Prose sections above.
4. Re-read the result against Spec 0 and the surrounding Specs, and drop any advice that made a sentence less clear.
