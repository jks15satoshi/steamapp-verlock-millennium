---
status: active
type: process
---

# Spec 3 - Collaboration Conventions

## Summary

This spec fixes how a change enters and lands in `Steam App Verlock`: its commit message, its branch, the issue that requests it, and the pull request that delivers it. It binds the maintainer — the person or agent responsible for project decisions.

It also fixes which document owns which part of the convention, and it states the conventions as recommendations, with one gated exception: the `feature` spec status.

## Motivation

Two kinds of maintainer make changes to `Steam App Verlock`: a human, and an agent that acts for one. Both commit, open issues, and open pull requests.

Without one convention the history reads inconsistently, an issue arrives without the information a reviewer needs, and no reader can tell which change is ready to merge. One written convention, recorded in one home and applied by review, keeps the surface uniform and the review predictable.

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
| `.github/scripts/verify-spec-status.ts` | The spec-status check | Implements the gate this spec names |

The onboarding guide may restate this spec's commands and summarize its flow, but it states no rule of its own.

When one of these documents disagrees with this spec, this spec prevails, and the maintainer corrects the document in the same change.

### Language

A commit message on `master` should be English. The repository forbids a force-push to `master`, and the owner controls every merge, so the owner keeps the permanent history English — writing the commit message at merge and editing it when a pull request title is in another language. A local commit message, a pull request title, and a pull request body may be in any language.

### Commit Messages

A commit message should follow [Conventional Commits](https://www.conventionalcommits.org/): a header that names a type and an optional scope, in that order, before a subject. The header is the message's first line; the subject is the text after the colon; the body is the text after a blank line; the footer is the trailing lines that carry metadata.

The header is:

```text
<type>(<scope>): <subject>
```

The `<scope>` is optional, so `<type>: <subject>` is also valid. A `!` placed before the `:` marks a breaking change. The header should carry no emoji prefix; the type word names the change's type.

The type should be one value from this closed set:

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

The scope, when present, should be lowercase kebab-case and should name the area the commit affects. It should use the vocabulary `backend`, `frontend`, `specs`, `skills`, `ci`, `build`, `deps`, `docs`, or `release`; a commit that spans areas should name the dominant one or omit the scope.

The subject should start with a lowercase letter or digit and should carry no trailing period. It should use the imperative mood. This spec sets no header length limit; a maintainer should keep the subject short.

The body is optional; when present, a blank line should separate it from the header. It should be an unordered list of highlights — one highlight per `-` item, where a highlight states the reason for the change or an accepted trade-off — and should not restate the diff. Body text should wrap at 72 columns.

The footer is optional. It may carry `BREAKING CHANGE: <description>`, `Co-authored-by: <name>`, or `Refs #<issue>`. A closing reference such as `Fixes #<issue>` should belong to the pull request, not the commit. An AI or generation-tool attribution should not appear in a commit footer.

One commit should carry one logical change, and the maintainer should split independent changes into separate commits. This convention does not check a merge commit or a commit created during an in-progress rebase or merge. This convention accepts Git's generated `Revert "<subject>"` header in place of a `revert` header.

### Branch Names

A branch name should be `<type>/<slug>`. The `<type>` should be one value from the commit type set above, and the `<slug>` a short lowercase kebab-case description. Example: `feat/app-verlock`. The default branch (`master` or `main`) and an automation branch (`dependabot/*` or `renovate/*`) are exempt.

### Issues

An issue should use one of three forms: `Bug`, `Feature`, or `Task`. The `Bug` form asks for the reproduction, the current behavior, the expected behavior, and the environment. The `Feature` form asks for the motivation and the expected behavior. The `Task` form asks for a summary and the deliverables. An issue title should be a plain description with no type prefix.

Each form may carry an optional `Related` section that links a related issue or pull request as `Related #<issue>` or `Refs #<issue>`.

The repository's default labels classify an issue: a `Bug` carries `bug`, a `Feature` carries `enhancement`, and a `Task` carries no label. The custom taxonomy is deferred (see [Alternatives Considered](#alternatives-considered)).

### Pull Requests

A pull request title should be a commit header in the grammar of [Commit Messages](#commit-messages); the owner writes the English commit message at merge. A Git-generated merge header such as `Merge branch 'main'` is not a commit header.

The body should follow the repository template, with two required sections and one optional section:

- `Motivation` states the problem and carries a closing reference (`Fixes #<issue>`, `Closes #<issue>`, or `Resolves #<issue>`) or an informational reference (`Related #<issue>` or `Refs #<issue>`).
- `Changes` states the public-interface change and the behavior change, or `None`.
- `Testing` is optional; when present, it lists only the testing no automated gate (a check the repository runs mechanically) covers, such as the manual end-to-end testing [Spec 5](005_testing-strategy.md#test-layers) keeps outside those gates, with each method and its proof inside a `details` element.

A bug-fix pull request should reference at least one issue in this repository; another pull request may omit the reference. A non-trivial change should reference the spec that owns it ([Spec 0](000_metaspec.md#when-to-create-a-spec)) or state why the change is exempt. A pull request should stay a draft until its checks and evidence are ready, and the maintainer should split independent changes into separate pull requests.

A reviewer should refuse a change that adds an abstraction, a copy, or a schema no consumer reads, duplicates an existing mechanism, ships a test that cannot fail, or states a path, field, or default the code does not carry. The `code-review` skill states the evidence that judgment rests on, and the pull request's `Changes` comment points the author to it.

A pull request carries an `active` `feature` spec only while it is a draft ([Spec 0](000_metaspec.md#statuses)). A ready-for-review pull request that contains an `active` `feature` spec is refused; the check belongs to [Spec 1](001_toolchain.md) and is implemented by `.github/scripts/verify-spec-status.ts`.

### Enforcement

This spec's conventions are recommendations, with one gate: the `spec-status` check on a pull request's `feature` spec status (see [Pull Requests](#pull-requests)). A stale `feature` spec `status` is a lifecycle fact review catches late, so it earns a check; every other convention here stays under review. The repository runs no other mechanical gate on a commit message, a branch name, an issue, or a pull request.

[Spec 1](001_toolchain.md) owns the gate mechanics — the `pre-commit` hook, the `verification` workflow, and the `spec-status` workflow — which check code formatting, lint, types, tests, and the `feature` spec status.

## Alternatives Considered

- **Native GitHub Issue Types**  
  Rejected: GitHub exposes Issue Types to organization-owned repositories, and this repository belongs to a user account, so the taxonomy cannot be relied on; the repository uses default labels instead.
- **A custom `kind/*` and `area/*` taxonomy now**  
  Deferred: for this project's size the default labels are sufficient.
- **A mandatory issue reference in the commit**  
  Rejected: the pull request owns the closing reference.
- **Keeping `CONTRIBUTING.md` strictly navigation-only**  
  Rejected: a contributor arrives without a runnable quickstart and must assemble the steps from four documents; a bounded onboarding guide that restates commands and defers to this spec keeps one rule home without that cost.
- **Keeping a mechanical format gate**  
  Rejected: the owner controls every merge and the history is short, so review is the cheaper enforcement; a pull request title gate would also force English titles and contradict the multilingual allowance.
- **Adopting the common-devx issue and pull request conventions**  
  Source: the `issue-creation`, `pull-merge-request-creation`, and `commit-message-creation` skills in [KemingHe/common-devx](https://github.com/KemingHe/common-devx). The optional `Related` issue section is adopted. Rejected: a `type(scope):` issue title prefix, because the issue title stays a plain description and the default label already names the type; an `Impact` section and a `Notes` section on a pull request, because `Changes` already states the public-interface change and the behavior change; a `Proposed Solution` section and an `Alternatives Considered` section on a feature issue, because those decisions belong to the spec's `## Design` and `## Alternatives Considered`; and a 50-character title cap, because the header rule declines to set a length limit.
- **The `Summary` section of the `Bug` issue form**  
  Rejected: it restates `Current Behavior`; the affected party moves into `Current Behavior`.
