---
status: active
type: process
---

# Spec 3 - Collaboration Conventions

## Summary

This spec fixes how a change enters and lands in `Steam App Verlock`: its commit message, its branch, the issue that requests it, the pull request that delivers it, and the approval rule that admits it. It binds the maintainer — the person or agent responsible for project decisions. It also fixes which document owns which part of the convention, and it places the mechanically checkable rules under the gates of [Spec 1](001_toolchain.md), the checks that block a change.

## Motivation

Two kinds of maintainer make changes to `Steam App Verlock`: a human, and an agent that acts for one. Both commit, open issues, and open pull requests. Without one convention the history reads inconsistently, an issue arrives without the information a reviewer needs, and no reader can tell which change is ready to merge. One written convention, recorded in one home and enforced where a check is cheap, keeps the surface uniform and the review predictable.

## Design

The convention applies to every change that reaches the repository. [Spec 0](000_metaspec.md#when-to-create-a-spec) owns when a change requires a spec; this spec owns how the change's commit, branch, issue, and pull request read, and how a maintainer reviews them.

### Audience and Parity

A maintainer is the person or agent responsible for a project decision. Every rule below names the maintainer as its actor; it binds a human maintainer and an agent that acts for one equally. An agent carries the same commit, branch, issue, pull request, and review obligations as a human.

### Document Roles

One fact has one home. This spec owns every rule, together with the rationale for each. The other documents either navigate to this spec or implement it; none states a rule of its own.

| Document | Role | Authority |
|---|---|---|
| `003_collaboration-conventions.md` | The rules and their rationale | Owns every rule |
| `CONTRIBUTING.md` | Onboarding guide for a human contributor | Owns no rule; may restate commands and summarize the flow, and links here |
| `AGENTS.md` | The entry an agent reads on load | States no rule; links here and [Spec 0](000_metaspec.md) |
| `.github/ISSUE_TEMPLATE/*`, `.github/pull_request_template.md` | The issue and pull request forms | Implement the forms this spec defines |
| `scripts/verify-commit-message.ts`, `scripts/verify-pr-conventions.ts` | The checks | Implement the checks this spec names |

A document whose authority is `Owns no rule` may restate a command or summarize the flow for a human reader, but it must not introduce an obligation this spec does not state.

When one of these documents disagrees with this spec, this spec prevails, and the maintainer corrects the document in the same change.

### Commit Messages

A commit message follows [Conventional Commits](https://www.conventionalcommits.org/): a header that names a type and an optional scope, in that order, before a subject. The header is the message's first line; the subject is the text after the colon; the body is the text after a blank line; the footer is the trailing lines that carry metadata.

The header is:

```text
<type>(<scope>): <subject>
```

The `<scope>` is optional, so `<type>: <subject>` is also valid. A `!` placed before the `:` marks a breaking change. The header carries no emoji prefix; the type word names the change's type.

The type is one value from this closed set:

| Type | Use |
|---|---|
| `feat` | Add or intentionally change behavior |
| `fix` | Correct incorrect behavior |
| `perf` | Improve performance without changing behavior |
| `refactor` | Restructure without changing behavior |
| `docs` | Documentation |
| `test` | Tests or test infrastructure |
| `build` | The build system or a compiled artifact |
| `ci` | Continuous integration |
| `chore` | Maintenance that fits no other type |
| `release` | A version release |
| `revert` | A revert of an earlier commit |

The scope, when present, is lowercase kebab-case and names the area the commit affects. The recommended vocabulary is `backend`, `frontend`, `specs`, `skills`, `ci`, `build`, `deps`, `docs`, and `release`; a commit that spans areas either names the dominant one or omits the scope.

The subject starts with a lowercase letter or digit, uses the imperative mood, and carries no trailing period. This spec sets no header length limit; a maintainer should keep the subject short.

The body is optional. A blank line separates it from the header. The body states why the change is made and the trade-off it accepts, and it does not restate the diff. Body text wraps at 72 columns.

The footer is optional. It may carry `BREAKING CHANGE: <description>`, `Co-authored-by: <name>`, or `Refs #<issue>`. A closing reference such as `Fixes #<issue>` belongs to the pull request, not the commit. An AI or generation-tool attribution never appears in a commit footer.

One commit carries one logical change; the maintainer splits independent changes into separate commits. This convention does not check a merge commit or a commit created during an in-progress rebase or merge. This convention accepts Git's generated `Revert "<subject>"` header in place of a `revert` header.

### Branch Names

A branch name is `<type>/<slug>`. The `<type>` is one value from the commit type set above, and the `<slug>` is a short lowercase kebab-case description. Example: `feat/app-verlock`.

### Issues

An issue uses one of three forms: `Bug`, `Feature`, or `Task`. The `Bug` form asks for a summary, reproducible steps, the current behavior, the expected behavior, and the environment. The `Feature` form asks for the motivation and the expected behavior. The `Task` form asks for a summary and the deliverables. An issue title is a plain description with no type prefix.

The repository's default labels classify an issue: a `Bug` carries `bug`, a `Feature` carries `enhancement`, and a `Task` carries no label at this stage. The repository keeps the default labels at this stage; the custom taxonomy is deferred (see [Alternatives Considered](#alternatives-considered)).

### Pull Requests

A pull request title is a commit header in the grammar of [Commit Messages](#commit-messages), because a merge or squash uses it as the resulting commit's header. A Git-generated merge header such as `Merge branch 'main'` does not satisfy the pull request title requirement.

The body follows the repository template, with three sections:

- `Motivation` states the problem and carries a closing reference (`Fixes #<issue>`, `Closes #<issue>`, or `Resolves #<issue>`) or an informational reference (`Related #<issue>` or `Refs #<issue>`).
- `Changes` states the public-interface change and the behavior change, or `None`.
- `Testing` lists each test method with its proof inside a `details` element.

A non-draft pull request references at least one issue in this repository. A non-trivial change references the spec that owns it ([Spec 0](000_metaspec.md#when-to-create-a-spec)) or states why the change is exempt. A pull request stays a draft until its checks and evidence are ready, and the maintainer splits independent changes into separate pull requests.

Another maintainer must approve a pull request before it merges. The author — human or agent — must never approve or merge it, and an agent must never approve or merge a pull request.

### Enforcement

The mechanically checkable rules run as gates. The local `commit-msg` hook checks a commit message's header, scope, subject, body separation, and attribution with `scripts/verify-commit-message.ts`; the hook skips a merge commit and a commit created during an in-progress rebase or merge. The `conventions` workflow checks a non-draft pull request's title, its issue reference, and its required template sections with `scripts/verify-pr-conventions.ts`; the issue-reference check matches the reference pattern and does not call the GitHub API. The issue label rule is not gated at this stage. [Spec 1](001_toolchain.md) owns the hook and workflow mechanics.

## Alternatives Considered

- **Native GitHub Issue Types** — rejected: GitHub exposes Issue Types to organization-owned repositories, and this repository belongs to a user account, so the taxonomy cannot be relied on; the repository uses default labels instead.
- **A custom `kind/*` and `area/*` taxonomy now** — deferred: for this project's size the default labels are sufficient.
- **A mandatory issue reference in the commit** — rejected: the pull request owns the closing reference.
- **Keeping `CONTRIBUTING.md` strictly navigation-only** — rejected: a contributor arrives without a runnable quickstart and must assemble the steps from four documents; a bounded onboarding guide that restates commands and defers to this spec keeps one rule home without that cost.
- **Allowing self-merge** — rejected: a second maintainer's approval is the review; an agent must never self-merge.
