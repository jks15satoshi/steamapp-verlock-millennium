---
status: active
type: process
---

# Spec 0 - Meta-specification of Steam App Verlock

## Summary

A Spec is a numbered Markdown document that records a significant decision or planned change: the motivation, the design, and the alternatives that lost. This spec defines the Spec process itself — metadata, statuses, types, naming and numbering, when a spec is required, and the document skeleton every spec follows. It also defines the prose rules every spec's text follows (see [Prose Rules](#prose-rules)) and the factual-currency rule that keeps the corpus truthful as the code beneath it moves (see [When to Create a Spec](#when-to-create-a-spec)).

## Motivation

Code shows what changed; it cannot carry why, or what was given up. Without a written record, decisions get re-litigated and rejected ideas return in new clothes. A uniform, numbered, lightweight spec format preserves rationale, keeps the decision inventory browsable, and stays predictable enough for both humans and agents to write and maintain.

## Design

A Spec is a Markdown file under `.agents/specs/`. Each spec covers exactly one topic; the author — the person or agent who writes the spec — splits unrelated changes into separate specs. The sections below define the metadata, statuses, types, naming, numbering, creation rules, and document skeleton that every spec follows, plus the prose rules every spec's text follows. Rules in this spec that a machine can check could later be gated by a tooling spec; until one exists, every rule here is review-enforced.

## Spec Metadata

Every spec opens with a YAML frontmatter block carrying its metadata.

Required keys:

| Key | Value |
|---|---|
| `status` | The spec status; one of the four values defined in [Statuses](#statuses). |
| `type` | The spec type; one of the three values defined in [Types](#types). |

Optional keys:

| Key | Value |
|---|---|
| `superseded-by` | The number of the successor spec that replaced this one. **Required when — and only when — `status` is `superseded`** (see [Statuses](#statuses)). Written as a bare number with no leading zeros and no `Spec` prefix (e.g. `superseded-by: 1`). The key names at most one successor — a spec split into several successors names the one that carries the core decision, and the body cross-references the rest. |

Example:

```yaml
---
status: active
type: process
---
```

## Statuses

Every spec carries exactly one status:

| Status | Meaning |
|---|---|
| `active` | The content may be updated at any time; the proposed functionality is not yet implemented or is only partially implemented. |
| `implemented` | The functionality is fully implemented and the code committed. The decision is frozen; recorded facts are not: a later change that moves a file, renames a package, or changes a key or default updates the spec's factual statements in the same change — facts only, never the decision itself. |
| `rejected` | The spec was declined or withdrawn and is not implemented. See [Rejected Specs](#rejected-specs). |
| `superseded` | The spec was replaced by a successor and is never deleted, for the same retention reasons as a rejected one (see [Rejected Specs](#rejected-specs)); `superseded-by` is required. |

Status changes: a spec is ordinarily created `active`. A spec whose implementation ships in the same change that creates it may be created directly as `implemented`, and a spec declined from the outset may be created directly as `rejected` (see [Rejected Specs](#rejected-specs)).

An `active` `feature` spec may be carried by a draft pull request; when the maintainer marks that pull request ready for review, the `feature` spec it carries must be `implemented`. A declined or withdrawn spec becomes `rejected`; a replaced spec becomes `superseded`. If a shipped implementation proves incomplete, the spec moves back to `active` until the gap closes.

Changing a decision an `implemented` spec records means writing a new spec and marking the old one `superseded` — the recorded decision's substance is frozen and cannot be edited in place.

The status set is closed: adding a status requires amending this spec (Spec 0).

## Types

The type classifies the nature of a spec — what it delivers. The set is closed: adding a type requires amending this spec (Spec 0).

| Type | Covers | Lifecycle Expectation |
|---|---|---|
| `feature` | Adding, changing, or removing user- or model-facing capabilities or behavior of the shipped product | Expected to eventually reach `implemented` |
| `process` | Workflows, conventions, tooling, and the Spec process itself (meta) | May remain `active` as a living document |
| `informational` | Design decision records, guidelines, or explanations that do not propose an implementation | May remain `active` as a living document |

Discriminator — ask "what does this spec deliver?": a product capability is `feature`; a process or convention is `process`; pure information is `informational`. A change that spans types takes the type of its primary deliverable; if its parts are each non-trivial on their own (see [When to Create a Spec](#when-to-create-a-spec)), split it into one spec per type.

Edge cases:

- A bug fix that merely restores intended behavior usually needs no spec at all; one that changes intended behavior is a `feature` spec.
- Removing a capability is a `feature` spec — "feature" here means a change to the capability surface.

Spec 0 itself is `type: process`.

## File Naming

Spec files are named `<NNN>_<slug>.md`:

- `<NNN>` is the spec number, zero-padded to three digits (e.g. `001`).
- `<slug>` is the topic slug: lowercase kebab-case, in as few words as possible without sacrificing clarity or introducing ambiguity.

The slug may be renamed for clearer wording. A spec's number may be changed until the spec is committed to git (recorded in the repository's history); once committed, the number must not be modified. A rename or a renumber updates the file name and every inbound relative link in the repository in the same change (see [Cross-References](#cross-references)).

Example: `001_context-compression.md`.

## Title Format

The first heading of the body is exactly:

```markdown
# Spec <N> - <Title>
```

- `<N>` is the spec number with no leading zeros (e.g. `Spec 1`).
- `<Title>` uses Title Case and may differ from the slug text.

Example: `# Spec 1 - Context Compression`.

## Numbering

- A new spec takes the greatest number currently in use plus one.
- A spec's number may be changed before the spec is committed to git; once committed, the number must not be modified.
- A committed number is never released and never reused — it stays bound to its spec even if that spec is rejected (see [Rejected Specs](#rejected-specs)).
- Because a committed number is permanent, numbers are issued strictly: a spec is created only when the change genuinely requires one under [When to Create a Spec](#when-to-create-a-spec) — a number given to an unnecessary spec is occupied forever.
- `000` is reserved for this spec.

## When to Create a Spec

A spec is required for every non-trivial change. A change is non-trivial when it:

- alters user- or model-facing behavior;
- alters architecture or a contract shared across files, packages, or components;
- alters process, tooling, or CI workflows;
- alters testing strategy;
- alters an on-disk, wire, or configuration format; or
- records any decision a maintainer — the person or agent responsible for project decisions — could reasonably revisit later.

Exempt: purely mechanical or local edits with no change to behavior, contracts, structure, process, or rationale (typo fixes, behavior-preserving refactors, dependency bumps).

Factual currency: a spec's recorded facts stay current whatever its status — `rejected` and `superseded` included. Exemption from the spec requirement never exempts from factual currency: a change that only updates facts an existing spec records — paths, names, keys, defaults, links — updates those facts in the same change and creates no spec.

Timing:

- Substantial work that benefits from review: create the spec first (`status: active`), implement once the design is settled.
- A decision already made, or a small non-trivial change: create the spec in the same change that implements it. Such a spec may be created directly as `implemented`.

Before creating a spec, search the existing specs:

- If an `active` spec already owns the decision, update that spec instead of creating a duplicate.
- If the new decision replaces a decision an `implemented` spec records, create a new spec and mark the old one `superseded` (with `superseded-by`).
- If a `rejected` spec covers the same topic, reference it and explain why its rejection rationale no longer applies.

## Document Skeleton

Every spec body follows one skeleton. Beyond the fixed sections, a spec may add bespoke sections — level-2 sections specific to its topic. The four fixed sections are exactly these, in this order, at heading level 2:

```markdown
## Summary

## Motivation

## Design

…optional bespoke sections…

## Alternatives Considered
```

Rules:

- The text, order, and level of the four fixed sections never change.
- Bespoke level-2 sections (schemas, protocols, migration steps, `## Consequences`, ...) may be inserted only between `## Design` and `## Alternatives Considered` — except `## Rejection Rationale`, which a rejected spec places immediately after `## Summary`.
- Level-3 and deeper headings are free-form anywhere.
- All headings — the `# Spec <N> - <Title>` title and every section heading — use Title Case.
- Section contents:
  - `## Summary` — a brief, precise description of the spec.
  - `## Motivation` — the problem: what it is and why it needs solving; written to stand without the solution.
  - `## Design` — the design itself. When `status` is `implemented`, this section speaks in the present tense about shipped reality, not future plans. Transitioning to `implemented` rewrites plan-speak out: design-time bespoke sections (plans, migration steps, acceptance criteria) become present-tense facts or are removed.
  - `## Alternatives Considered` — mandatory. Each genuine alternative and why it lost. Alternatives are recorded, never invented.

A rejected spec additionally requires `## Rejection Rationale`; see [Rejected Specs](#rejected-specs). Rules for spec prose live in [Prose Rules](#prose-rules).

### Feature Narrative

A `feature` spec should present its design along the narrative: design mechanism, implementation plan, potential risks. The design mechanism tells how the change works — the concrete machinery and principles the implementation relies on. The implementation plan tells what the change builds — the files the change could add or touch, the interface definitions the change could introduce. The potential risks tell what the change could cost — the problems the implementation could introduce and, if any exist, the preventive measures the design could take against each. The narrative is a recommendation only: it fixes no structure, and each element is provided to the extent possible. The design mechanism states how the change works; it does not enumerate the interface inventory — the methods, functions, and signatures the change implements. That inventory belongs to the implementation plan, for a single-layer spec and a layered one alike.

### Layered Feature Specs

A `feature` spec whose implementation spans more than one layer organizes its mechanism by layer. A layer is a runtime, language, or ownership boundary inside the feature — for this project, the Steam React frontend and the Millennium Lua backend. The rule fixes where a statement lives, not what the spec must cover.

- `## Design` carries the decision and the end-to-end behavior: the cross-layer mechanism, the scope, and the order in which each operation crosses the boundary. It does not restate what a single layer does internally.
- Each layer's mechanism lives in its own bespoke level-2 section, named for the layer (`## Backend`, `## Frontend`), placed after `## Design` by the bespoke-section rule.
- The cross-layer interface lives in one bespoke section (`## Bridge`); each layer section references it and does not restate the payloads.
- A layer section carries mechanism only, not the interface inventory (see [Feature Narrative](#feature-narrative)).
- A spec that spans one layer keeps its mechanism in `## Design` and adds no layer section.

### Alternative Provenance

An alternative is genuine when it was a viable option and the decision established why it lost. A viable option is one the maintainer could reasonably have chosen. The decision establishes why an option lost when the maintainer stated the reason, or when the author stated the trade-off while presenting the option and the maintainer's choice endorsed that statement.

An option that is merely enumerated — for example, an unselected option in a recommendation prompt (a question that presents several options and recommends one) — is not an alternative until the decision establishes why it lost. The author never supplies that reason on the maintainer's behalf after the choice is made.

When no genuine alternative was considered, `## Alternatives Considered` states `No genuine alternative was considered.` rather than recording an alternative.

## Prose Rules

The rules below govern all spec prose — text written for humans to read on a first pass and for agents to parse and check mechanically. They govern the spec corpus only; documents outside it follow their own conventions. A skill named `spec-prose-style` — a reusable instruction document that an agent loads on demand — provides advisory style guidance for spec prose; it states no rules and is subordinate to this section (see [Spec 2](002_agent-skills.md)).

### Prose Precision

Spec prose names the exact actor, action, field, file, or failure condition each statement relies on — prefer the narrow term (a field set, a schema, a validation point) over a vague one ("contract", "layer", "module"). A statement whose job is coverage, such as a criterion or an enumeration, may stay deliberately broad. What is deliberately undecided is stated as undecided and given a planned home.

### Substance

Every sentence a spec keeps adds information the reader did not already have. Spec prose states its point directly and gives each sentence a fact or a claim to carry. A sentence that frames the point without adding to it — a run-up (text that announces the point instead of making it), a contrast against a belief the reader does not hold, or a restatement of the sentence before it — is removed rather than reworded. A short paragraph that carries one new fact may stand alone.

### Claim Fidelity

Every name, number, date, quote, citation, path, key, default, and claim in spec prose traces to the code, a cited source, or the maintainer. Spec prose records only what one of those supplies. When a needed detail is missing, the author omits it or asks the maintainer for it rather than guessing. This rule generalizes the recorded-never-invented requirement that [Alternative Provenance](#alternative-provenance) applies to alternatives.

### Plain Statement

Spec prose uses the plain word and states facts in the direct declarative. It keeps an ordinary fact ordinary: the fact's significance stays as the source gives it, the subject is described rather than praised in sales language, a source is named rather than borrowed as unnamed authority, and a relationship is named rather than left as a vague association. The verbs `is`, `are`, and `has` are preferred over longer substitutes such as `serves as`, `features`, and `boasts`.

### Term Order

A term must not be referenced before it is explained, unless its meaning is obvious. An explanation is whatever lets a first-time reader say what the term denotes at the moment it is referenced: an inline definition ("a Spec is a numbered Markdown document ..."), a defining sentence earlier in the document, or the section that introduces the term. A reference to one of the document's own section headings is navigation, not a term reference.

A term's meaning is obvious when it is an ordinary English word used in its common dictionary sense ("file", "number", "corpus"), or a universal industry term with a single, stable meaning ("Markdown", "YAML frontmatter", "kebab-case"). Everything else is not obvious: project coinages ("slug", "bespoke section", "factual currency"), ordinary words used in a narrowed sense, and terms whose meaning lives in another spec.

When in doubt, explain — a one-clause gloss costs less than a misread document.

### Explicit Over Implicit

A statement carries everything its reader needs: the default when one exists, the actor responsible, and the conditions under which it applies. A pronoun's referent is never in doubt — repeat the noun when "it" or "this" could bind to more than one antecedent. Prose precision chooses the narrow noun; this rule forbids leaving the noun — or the condition — out.

### Modal Verbs

Modal verbs carry three registers: "must" and "never" state obligations, "should" states a recommendation whose violation needs a reason, and "may" states permission. All lowercase. Statements of fact use plain declaratives ("is", "stays") where possible; "can" and "cannot" state ability, and "would" and "could" state hypothesis. No other modal verbs appear, so obligation and description stay distinguishable.

### Backticked Identifiers

Identifiers — file names, frontmatter keys, status and type values, slugs, commands — are wrapped in backticks (`status`, `implemented`). Backticks separate the corpus's vocabulary from ordinary prose for the reader's eye and give agents exact search anchors.

### Plain Markdown

Spec bodies use only basic Markdown: headings, paragraphs, lists, tables, fenced code blocks, links, and inline emphasis. Raw HTML and footnotes are never used, and lists nest no deeper than two levels. The corpus stays parseable by simple tools, and its diffs stay line-oriented.

## Rejected Specs

Retention: a rejected spec is never deleted. Its committed number is never released or reused (see [Numbering](#numbering)), so deleting it would free nothing — and the kept record stops the rejected idea from returning in new clothes. A rejected spec still satisfies every requirement of this spec — metadata, skeleton, the [prose rules](#prose-rules), factual currency, and the rejection rationale below.

Rejection rationale: a rejected spec carries one additional required section, `## Rejection Rationale`, placed immediately after `## Summary`:

```markdown
## Summary

## Rejection Rationale

## Motivation

…
```

- Required content: why the spec was rejected.
- Recommended, not required: the conditions under which the idea could be reconsidered.

The section is added when the spec transitions to `rejected`, or when the spec is created as `rejected`.

## Cross-References

References between specs use relative Markdown links whose link text includes the spec number — e.g. `[Spec 1](001_context-compression.md)` — never bare numbers or bare prose, so references stay mechanically checkable and a renamed link target can still be located by its spec number. A self-reference within a document may use the bare `Spec N` form. A successor spec references the spec it supersedes; the superseded spec's `superseded-by` key points forward.

## Alternatives Considered

Shorthand used below: **DSH** — the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), an open-source agent harness whose document-management approach and convention rules are selectively borrowed; **PEP** — the [Python Enhancement Proposals](https://peps.python.org/), whose proposal format and writing structure are borrowed.

- **Path-encoded metadata (DSH-style)**  
  Status and class as folders with a `Status:` line instead of frontmatter. Rejected: specs are numbered, flat, and frontmatter-driven — one metadata source, trivially parsable, with no file moves when status changes.
- **RFC 822-style preamble (PEP-style)**  
  Rejected: YAML frontmatter is more machine-friendly.
- **Component tags in metadata**  
  Rejected: the type already carries the classification signal, and dropping tags keeps the metadata minimal for a small spec inventory.
- **Release-and-reuse numbering**  
  The rule this spec once adopted: delete non-retained rejected specs, release their numbers, and allow reuse by explicit choice. Rejected: a released number that is never reused makes the deletion meaningless; keeping every rejected spec preserves its rationale and forces strict issuance (see [Rejected Specs](#rejected-specs)).
- **Absolute number immutability**  
  The rule this spec once adopted: a spec's number never changes from creation. Rejected: before commit a spec is a locally visible draft only, so renumbering it to match the actual order is acceptable, and the commit boundary alone keeps committed numbers stable.
- **Two-type or four-type value sets**  
  Two types (folding `informational` into `process`) lose the "record only, no action" signal; four types (adding `bug-fix`) add a category whose boundary `feature` already covers.
- **Structured relationship metadata**  
  A `related` frontmatter key marking loosely related specs, a fixed "Related Specs" skeleton section, or a `depends-on` key with cascade rules (no cycles, update-on-supersede, revisit-on-rejection). Rejected: relationship metadata carries no lifecycle consequence and degenerates into an unmaintained link pile. Dependents of a spec are derivable by searching the corpus, and narrative links in body prose carry the rationale with less upkeep and keep the skeleton light.
- **A list-valued `superseded-by` key**  
  Naming several successors when a spec is split. Rejected: one successor key plus narrative cross-references covers the split case without complicating the metadata schema.
- **Status name `final`**  
  The status for "fully implemented and committed" was first named `final` and renamed to `implemented`. Rejected `final`: it reads as finished-and-frozen, which conflicts with the factual-currency contract (the decision freezes while recorded facts stay current); `implemented` states shipped reality and matches the DSH lifecycle vocabulary.
- **Splitting `active` into `draft` and `accepted`**  
  Rejected: the timing rule (see [When to Create a Spec](#when-to-create-a-spec)) already covers both create-first and create-with-implementation work, and splitting one status into two adds a transition to police without changing any obligation.
- **Frozen `implemented` content (PEP-style)**  
  Rejected: frozen content lets recorded facts rot silently as code moves on; the adopted contract freezes the decision while keeping recorded facts current (see [Statuses](#statuses)).
- **Strict explain-before-reference with no obviousness exception**  
  Rejected: forcing a definition for ordinary words and universal industry terms buries prose in noise; the exception is bounded by a concrete two-case test, so it cannot swallow the rule.
- **Leaving "obvious" undefined**  
  Rejected: an undefined exception is a loophole that swallows the rule.
- **A separate prose-rules spec**  
  Rejected: the corpus's prose rules live with its other rules in this spec; a second meta document splits one rulebook and forces every author to consult two documents.
- **Full Markdown latitude**  
  Raw HTML, footnotes, and deeper list nesting. Rejected: anything beyond the basic constructs defeats simple mechanical parsing and muddies line-oriented diffs, for expressiveness the corpus does not need (see [Plain Markdown](#plain-markdown)).
- **Auto-promoting an unselected option in a recommendation prompt**  
  Rejected: an option's presence in a prompt does not establish that the decision weighed it or why it lost; recording it with a guessed reason fabricates a comparison (see [Alternative Provenance](#alternative-provenance)).
- **Requiring a non-empty `## Alternatives Considered`**  
  Rejected: it forces the author to invent content for a mandatory section; the fixed "no alternative" sentence records the gap itself.
- **DSH-style HTML comment markers for an unrecorded alternative**  
  Rejected: the [Plain Markdown](#plain-markdown) rule forbids raw HTML, and a fixed plain-text sentence carries the same meaning.
- **Leaving "genuine" undefined**  
  Rejected: an undefined qualifier is a loophole that swallows the rule, the same defect as the rejected undefined "obvious".
- **One spec per layer for a layered feature**  
  Rejected: the layers implement one topic, so a split multiplies permanent numbers and turns a single decision into cross-Spec links; [Layered Feature Specs](#layered-feature-specs) keeps one spec and gives each layer a section.
- **Author discretion over a layered spec's layout**  
  The rule this spec once implied. Rejected: without a fixed axis, a long feature spec interleaves its layers paragraph by paragraph, and the reader must reconstruct which layer owns each statement.
- **A per-operation layer template inside `## Design`**  
  A `Backend`/`Frontend` pair of paragraphs under every operation. Rejected: it repeats the cross-layer seam at each operation and still leaves layer internals without one home.
- **The interface inventory in the layer design sections**  
  The layout where each layer's function list sits in its layer section. Rejected: the design mechanism then restates method definitions the implementation plan already owns, and the design grows a code inventory that [Feature Narrative](#feature-narrative) assigns to the implementation plan.
- **The [Humanizer](https://github.com/blader/humanizer) skill's full pattern catalog as spec rules**  
  Importing all 25 patterns, including its word lists, dash ban, and formatting rules. Rejected: it bloats the decision corpus and turns advisory style into obligations, so the pattern-level guidance lives in the `spec-prose-style` skill instead (see [Prose Rules](#prose-rules)).
- **Anti-AI prose guidance in the skill only**  
  Rejected: the core obligations — every sentence adds information, no invented fact, plain statement — belong in the decision corpus, not in guidance a skill may omit.
- **Adopting the Humanizer em-dash ban**  
  Rejected: the spec corpus is the project's voice sample and uses em dashes, so only the principle against a dash as a universal connector is adopted and the existing dashes stay.
- **A separate project-wide writing-standard spec**  
  Rejected: the prose rules govern the spec corpus only (see [Prose Rules](#prose-rules)), so a second spec would either duplicate that scope or impose obligations on prose no decision covers.
