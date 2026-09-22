---
status: implemented
type: process
---

# Spec 9 - Release and Distribution

## Summary

This spec fixes how a `Steam App Verlock` version is released and delivered: the version source, the tag that triggers a release, the `.star` artifact a release carries, the release notes, and the deferred path to the Millennium plugin center.

## Motivation

A release must be reproducible and reviewable: without one version source, a tag and a manifest drift apart; without one build command, a maintainer ships a debug artifact; without a recorded artifact and notes, a user cannot verify what they download.

The plugin center adds a second delivery path with its own pinned-commit review, so the release process must state how the two relate. This spec records both so a release stays one tag and the plugin-center submission is a documented later step.

## Design

### Version Source

`millennium.toml` `[plugin].version` is the version source. `package.json` `version` mirrors it.

A release tag is `v<major>.<minor>.<patch>`, for example `v0.1.0`, and the tag without its leading `v` must equal both versions. `.github/scripts/check-release-version.ts` reads the tag, `millennium.toml`, and `package.json`, and fails the release job on any mismatch.

A version bump and the release-notes change land in the pull request that precedes the tag; the tag itself is the only release trigger.

### Release Workflow

GitHub Actions runs `.github/workflows/release.yml` on a push of a tag matching `v*.*.*`. The workflow declares `permissions: contents: write` and a `concurrency` group keyed on `github.ref` that does not cancel an in-progress run.

Its `verify` job calls `.github/workflows/verification.yml` through `workflow_call`, so a release runs the same format, lint, type, and test checks as a pull request ([Spec 1](001_toolchain.md#git-hooks-and-continuous-integration), [Spec 5](005_testing-strategy.md)). Its `release` job then:

- checks the tag against the version source;
- builds the artifact with `bun run build:release`, which runs `starlight pack --release -o dist` through `scripts/build-release.ts`;
- verifies the artifact with `starlight verify`;
- creates the GitHub release, with `dist/steamapp-verlock.star` as its only asset.

### Artifact

The release asset is the `.star` archive that `starlight pack --release` produces. Starlight writes it to `dist/<plugin-id>.star`, which is `dist/steamapp-verlock.star`; `dist/` stays untracked. The archive is unsigned.

Starlight signs an archive only when `STARLIGHT_SIGNING_KEY` is set, and a maintainer-generated key cannot produce a valid signature: both `starlight verify` and Millennium's `src/engine/star_parser.cc` check the signature against the fixed `STARLIGHT_PUBLIC_KEY`, so the release stays unsigned until the Millennium project supplies a signing key.

A user installs the archive by placing it in Millennium's `plugins` directory and restarting Steam; the plugin store installs the same archive through its plugin ID.

### Release Notes

`.github/release-template.md` is the release-description template. It carries the placeholders `{{VERSION}}`, `{{DATE}}`, `{{ARTIFACT}}`, `{{PLUGIN_ID}}`, `{{SHA256}}`, and `{{CHANGELOG}}`, with the sections `Highlights`, `Install`, `Changes`, `Verification`, and `Known Limitations`.

`.github/scripts/render-release-notes.ts` fills the placeholders: it computes the artifact's SHA-256, reads the plugin ID from `millennium.toml`, and requests the changelog from GitHub's `releases/generate-notes` endpoint.

`.github/release.yml` maps merged pull-request labels to the changelog categories — `breaking`; `enhancement` or `feature`; `bug` or `fix`; then every remaining pull request ([Spec 3](003_collaboration-conventions.md#issues)).

### Plugin Center Submission

The Millennium plugin center at `steambrew.app/plugins` serves plugins from `SteamClientHomebrew/PluginDatabase`, which holds each plugin as a git submodule pinned to one commit. Submitting the plugin is a pull request to that repository that adds `https://github.com/jks15satoshi/steamapp-verlock-millennium` as a submodule under `plugins/`. The database builds the pinned commit, not a GitHub release asset.

The plugin center is deferred: no submission pull request is opened at this stage. Its build pipeline expects a `plugin.json` file and a `.millennium` bundle in the plugin repository, and this repository ships neither because `millennium.toml` is the plugin's only build manifest and starlight places the compiled frontend inside the `.star`.

Enabling the submission therefore requires a plugin-center-ready layout — at minimum a `plugin.json` carrying `name`, `common_name`, `description`, `version`, `useBackend`, and `backendType`, plus a build that emits the layout the pipeline packages.

This spec records the path so the later change treats it as a known decision rather than new research.

## Alternatives Considered

- **A release from every push to `master`**  
  rejected: a release is a versioned, user-facing artifact, so it needs a deliberate tag; a continuous release would decouple the artifact from a reviewed version.
- **Versioning from `package.json`**  
  rejected: `millennium.toml` is the manifest starlight compiles into the plugin's metadata, so its `[plugin].version` is the version a user sees; `package.json` stays a mirror.
- **A signed release artifact**  
  rejected: a signature verifies against the fixed `STARLIGHT_PUBLIC_KEY` in `starlight/src/verify.rs` and `src/engine/star_parser.cc`, so a signature from a maintainer-generated key fails verification and leaves the archive uninstallable; the release stays unsigned and the published SHA-256 carries integrity until the Millennium project supplies a signing key.
- **A hand-written release body**  
  rejected: a hand-written body would restate the pull-request history and drift from it; the template fixes the sections while the generated changelog supplies the changes.
- **Running the checks inside the release workflow**  
  rejected: a second copy of the format, lint, type, and test steps would drift from `verification.yml`; `workflow_call` reuses the one definition.
- **Submitting to the plugin center in this change**  
  rejected: the submission is a separate, audited pull request to another repository and needs the plugin-center-ready layout above; folding it into the release change mixes an external review with the release mechanics.
