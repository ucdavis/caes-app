# `caes-app` Roadmap and V1 Init MVP Plan

## Summary

Build `caes-app` as a Node 22+ / TypeScript CLI published with a `caes-app` binary, usable through `npx caes-app init`.

The V1 Init MVP is intentionally narrow: create/customize a new app from the default branch of `ucdavis/web-app-template`, optionally create and clone the GitHub repo from that template, write a non-secret manifest, preview all mutations before applying them, and record the template source default branch and resolved commit SHA. GitHub environments/secrets, Azure OIDC, Entra auth app management, deployment settings automation, `app-setting add`, and full `doctor` behavior are post-MVP roadmap features.

Default posture: automate foundation setup, make every mutation previewable, keep secrets out of persisted project metadata, and avoid sample-code cleanup in `init`.

## Implementation Roadmap

Track progress at the phase and major-deliverable level. Keep the detailed sections below as the design contract for what each phase must satisfy.

### Phase 1: V1 Init MVP - CLI Foundation

- [x] Scaffold the Node 22+ / TypeScript package, ESM build, `caes-app` binary, and test tooling.
- [x] Add command-wide option parsing and the MVP command shell for `init`.
- [x] Implement manifest schema reading/writing with unknown-field preservation and future-schema rejection.
- [x] Implement typed preview plan steps, confirmation scopes, idempotency states, JSON output, and redaction.
- [x] Add structured JSON editing utilities for project config files.
- [x] Add release checks for package contents, executable shebang, `bin` entry, and packed `npx` smoke execution.

Implementation notes:

- Implemented with npm, ESM TypeScript, Node `>=22.13.0`, `commander`, `@inquirer/prompts`, `zod`, `execa`, `tsx`, `tsup`, and `vitest`.
- `init` intentionally stops after parsing and validation with a Phase 2 not-implemented preview/result.
- Packed smoke tests that install the tarball from a fresh npm cache require running outside the Codex sandbox because sandbox DNS blocks registry fetches and can make nested npm flows appear hung.

### Phase 2: V1 Init MVP - Local Template Initialization

- [ ] Implement `caes-app init [target-dir]` wizard input mapping and validation.
- [ ] Implement `--dry-run`, `--yes`, `--json`, `--manifest`, `--local-only`, and `--no-git` behavior for init.
- [ ] Resolve the template default branch to a commit SHA before mutation and record both values.
- [ ] For local-only mode, copy/download the trusted `ucdavis/web-app-template` default branch and exclude generated/local artifacts such as `node_modules`, `bin`, `obj`, `publish`, and ignored files.
- [ ] Apply local file/config patches without sample-code cleanup.
- [ ] Write committable, non-secret `.caes-app.json` metadata.
- [ ] In local-only mode, initialize local git by default; support `--no-git` only with `--local-only`.

Implementation notes:

- _Record brief implementation-only decisions, discoveries, or follow-up context here as this phase is completed._

### Phase 3: V1 Init MVP - GitHub Repository Creation

- [ ] Implement the init path that creates and clones a GitHub repo from the default branch of `ucdavis/web-app-template`.
- [ ] Use `gh repo create --template ucdavis/web-app-template` to create the remote repo, then `git clone` the new repo into the exact `target-dir`.
- [ ] Preview GitHub repo create/clone operations before applying them.
- [ ] Apply local file/config patches inside the cloned project repo.
- [ ] Leave generated customization changes uncommitted; do not stage, commit, or push from `init`.
- [ ] Record GitHub owner/repo, repo visibility, project repo default branch, template default branch, and resolved template commit SHA in the manifest.

Implementation notes:

- _Record brief implementation-only decisions, discoveries, or follow-up context here as this phase is completed._

### Phase 4: Post-MVP - GitHub Environments and Secrets

- [ ] Add command shell and implementation for `caes-app github env init`.
- [ ] Add `--env test|prod` for environment-scoped commands.
- [ ] Add environment-scoped secret replacement flags, including `--replace-secret <environment>:<name>` or an equivalent explicit environment-aware form.
- [ ] Create/update GitHub environments `test` and `prod`.
- [ ] Set non-secret GitHub environment variables from `.caes-app.json`, selected app config, and later deployment settings contract data.
- [ ] Prompt for individual secrets such as `SQL_ADMIN_PASSWORD`, `SMTP_PASSWORD`, `OTEL_EXPORTER_OTLP_HEADERS`, and `DB_CONNECTION`.
- [ ] Treat existing GitHub secrets as present but unreadable; replacement requires explicit per-secret, per-environment intent.

Implementation notes:

- _Record brief implementation-only decisions, discoveries, or follow-up context here as this phase is completed._

### Phase 5: Post-MVP - Azure OIDC and Entra Auth

- [ ] Add command shell and implementation for `caes-app azure oidc bootstrap`.
- [ ] Run the template's `infrastructure/azure/github-oidc.bicep` per environment.
- [ ] Require Azure CLI auth, selected subscription/tenant match, and sufficient permissions before OIDC bootstrap.
- [ ] Read deployment outputs and write `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, and `RESOURCE_GROUP` into matching GitHub environments after confirmation.
- [ ] Add command shell and implementation for `caes-app azure auth-app`.
- [ ] Require Microsoft Graph/app-registration permissions before Entra app creation or update.
- [ ] Manage redirect URIs for local dev, IIS Express, App Service hostnames, and custom domains.
- [ ] Add App Service hostname redirect URIs only after the hostname source exists; add custom domains only when supplied or discoverable.
- [ ] Preserve existing redirect URIs and make updates additive.

Implementation notes:

- _Record brief implementation-only decisions, discoveries, or follow-up context here as this phase is completed._

### Phase 6: Post-MVP - Deployment Settings and App Setting Automation

- [ ] Verify the trusted template includes required deployment settings files, generated-region markers, and package scripts.
- [ ] Run `npm run deployment-settings:check` before relying on the template's generated deploy surfaces.
- [ ] Read and resolve `deployment-settings-defaults.json` plus the app-owned `deployment-settings.json` overlay before `github env init`, `doctor`, or `app-setting add` uses settings.
- [ ] Implement the deployment settings contract reader and generated deploy surface validation against the resolved settings.
- [ ] Implement `caes-app app-setting add <app-setting-name>`.
- [ ] Edit only the app-owned `infrastructure/azure/deployment-settings.json` overlay directly for setting additions.
- [ ] Invoke `npm run deployment-settings:sync` to update generated workflow and deploy script regions.
- [ ] Preview overlay, generated file, and GitHub environment variable/secret changes before applying.

Implementation notes:

- _Record brief implementation-only decisions, discoveries, or follow-up context here as this phase is completed._

### Phase 7: Post-MVP - Doctor, Retry/Resume, and Release Hardening

- [ ] Implement read-only `caes-app doctor`.
- [ ] Complete retry/resume behavior for GitHub, Azure, Entra, variables, and unreadable secrets.
- [ ] Add deeper template, manifest, GitHub, Azure, runtime configuration, and deployment settings checks.
- [ ] Harden JSON output, conflict exit codes, and redacted error reporting across all commands.
- [ ] Finalize release documentation for MVP and post-MVP feature expectations.

Implementation notes:

- _Record brief implementation-only decisions, discoveries, or follow-up context here as this phase is completed._

## Command Shape

- MVP command-wide options:
  - `--dry-run`: build and print the preview plan without applying it.
  - `--yes`: skip non-secret confirmations.
  - `--json`: emit machine-readable preview/results with all sensitive values redacted.
  - `--manifest <path>`: read/write a manifest path other than `.caes-app.json`.
  - `--local-only`: perform no `gh` mutations and no Azure mutations.
  - `--no-git`: with `--local-only`, skip git initialization.
- Post-MVP command-wide options:
  - `--env test|prod`: scope environment-aware commands to one environment.
  - `--replace-secret <environment>:<name>`: allow a named unreadable GitHub secret to be replaced in a specific environment.
- `--json` behavior:
  - `--json` without `--yes` is preview-only and non-interactive.
  - `--json --yes` applies the previewed plan non-interactively when there are no conflicts.
  - `--dry-run --json` emits a redacted preview plan.
  - Preview conflicts in JSON mode use a nonzero exit code.
  - The same redaction layer is used for human preview, JSON output, command logging, thrown errors, and tests.
- `caes-app init [target-dir]`:
  - Creates a new app from the trusted default branch of `ucdavis/web-app-template`.
  - In GitHub repo mode, creates a new GitHub repo from the template with `gh repo create --template ucdavis/web-app-template`, clones that new project repo into the exact `target-dir` with `git clone`, applies local customization patches inside the clone, and does not run a separate `git init`.
  - In local-only mode, copies/downloads the template default branch directly into `target-dir`, applies local customization patches, writes `.caes-app.json`, and initializes git by default.
  - Collects app name, display name, GitHub owner/repo, visibility, and dev ports.
  - Creates a committable non-secret `.caes-app.json` manifest in the generated app.
  - Updates template identity/config files.
  - Leaves local customization changes uncommitted so the developer can review generated files and choose what to stage and commit.
  - Supports `--local-only` to avoid all `gh` mutations and Azure mutations while still resolving, copying, or downloading the trusted template source, applying local file patches, writing `.caes-app.json`, recording the template default branch commit SHA, and initializing git by default.
  - Supports `--no-git` only with `--local-only` to skip git initialization.
  - Excludes copied/generated artifacts like `node_modules`, `bin`, `obj`, `publish`, and ignored local files.
  - In GitHub repo mode, `target-dir` is the clone destination and must not already contain unrelated files.
  - In local-only mode, `target-dir` must be absent or empty unless it contains a matching `.caes-app.json` for a resumable run.
  - Existing non-empty target directories without a matching manifest become preview `conflict` steps.
- Post-MVP commands:
  - `caes-app github env init`: creates/updates GitHub environments, variables, and secrets.
  - `caes-app azure oidc bootstrap`: deploys OIDC infrastructure and writes GitHub environment variables.
  - `caes-app azure auth-app`: creates/updates the user sign-in Entra app registration and related config.
  - `caes-app app-setting add <app-setting-name>`: adds a runtime App Service setting through the deployment settings contract.
  - `caes-app doctor`: performs read-only local, GitHub, Azure, template, manifest, and runtime readiness checks.

## CLI Technical Stack

- Use TypeScript with ESM on Node 22+.
- Use `commander` for command routing and option parsing.
- Use `@inquirer/prompts` for interactive wizard prompts.
- Use `zod` for manifest, config, and user input validation.
- Use `execa` for local `git`, `gh`, and `az` command execution.
- Use structured JSON editing for `package.json`, `appsettings*.json`, `launchSettings.json`, and `.devcontainer/devcontainer.json`.
- Use `tsx` for development, `tsup` for builds, and `vitest` for tests.

## Template Source, Trust, and Compatibility

`caes-app` is a team-specific CLI for team-owned templates and apps. V1 targets the trusted default branch of `ucdavis/web-app-template`.

- Trust model:
  - Running template-provided tooling is acceptable for the trusted `ucdavis/web-app-template` default branch.
  - The CLI records the template default branch and resolved commit SHA for traceability.
  - The CLI still fails on missing expected files, unsupported manifest schema versions, or missing generated-region markers for features that require them.
  - No sandboxed sync-runner architecture is required for V1 or the planned post-MVP deployment settings work.
- MVP template source behavior:
  - Default source is `ucdavis/web-app-template` at its default branch.
  - Resolve the template default branch to a commit SHA before mutation.
  - Generated apps record `templateSource.repository`, `templateSource.defaultBranch`, and `templateSource.resolvedCommitSha` in `.caes-app.json`.
  - V1 does not support choosing a template branch, tag, or commit.
- Compatibility scope:
  - Managed automation requires a `caes-app` generated app with a valid `.caes-app.json`.
  - Template compatibility checks apply to the source template used by `init` and to later managed projects that contain the required contract files.
  - Existing apps created from `web-app-template` before `caes-app` are unsupported for automation unless manually migrated by a future, separate migration feature.
- MVP required template files:
  - Root files: `package.json`, `app.sln`, and `README.customization.md`.
  - Client files: `client/package.json`, `client/vite.config.ts`, and `client/package-lock.json`.
  - Server files: `server/appsettings.json`, `server/appsettings.Development.json`, `server/server.csproj`, and `server/Properties/launchSettings.json`.
  - Dev container files: `.devcontainer/devcontainer.json` and `.devcontainer/docker-compose.yml`.
  - Azure files may be copied as template content, but MVP `init` does not automate Azure deployment.
- Post-MVP required template files for deployment automation:
  - `.github/workflows/deploy-azure-appservice.yml`, `.github/workflows/ci-cd.yml`, `infrastructure/azure/main.bicep`, `infrastructure/azure/modules/compute.bicep`, `infrastructure/azure/github-oidc.bicep`, `infrastructure/azure/bicepconfig.json`, and `infrastructure/azure/deploy.sh`.
  - `infrastructure/azure/deployment-settings-defaults.json`, `infrastructure/azure/deployment-settings.json`, and `infrastructure/azure/deployment-settings.schema.json`.
  - Package scripts `deployment-settings:sync` and `deployment-settings:check`, currently backed by `scripts/sync-deployment-settings.mts`.

## Manifest Schema

`.caes-app.json` is committable, non-secret project metadata.

- Required fields for MVP:
  - `schemaVersion`: CLI manifest schema version.
  - `appId`: stable app identifier used for generated names and config.
  - `displayName`: human-readable app name.
  - `templateSource`: source template identity, including `repository`, `defaultBranch`, and `resolvedCommitSha`.
  - `ports`: local development ports.
- Optional MVP fields:
  - `github`: owner/repo, repo visibility, default branch, and environment names when known.
- Post-MVP optional fields:
  - `azure`, `auth`, `notifications`, `observability`, and expanded `environments`.
- Non-secret resource handles to record when known:
  - GitHub owner/repo, repo visibility, default branch, and environment names.
  - Azure subscription ID, tenant ID, location, resource group names, and repeatable OIDC bootstrap deployment names.
  - Deployment identity client IDs/principal IDs returned by `github-oidc.bicep`.
  - User sign-in Entra app object/client IDs, tenant/domain, callback path, and redirect URIs.
  - Template repository, default branch, resolved commit SHA, and CLI schema version.
- Schema behavior:
  - Preserve unknown fields when reading and writing so future CLI versions can add metadata safely.
  - Reject unsupported future `schemaVersion` values with an upgrade message instead of rewriting the file.
  - Local-only manifests may omit or leave unset cloud sections until later GitHub or Azure commands populate them.
- Never store secrets, connection strings, passwords, PATs, private keys, OIDC credentials, SMTP passwords, OTLP headers, or per-developer local overrides.

## Validation Before Preview

- Validate app IDs, GitHub owner/repo names, localhost ports, duplicate port conflicts, and target directory state before generating the MVP preview plan.
- Group validation failures by input area and include actionable remediation text.
- Preview generated values before mutation, including app IDs, package/repo names, local ports, GitHub owner/repo, repo visibility, project repo default branch, template default branch, and resolved template commit SHA.
- Do not pre-validate generated Azure resource names in MVP because MVP does not perform Azure deployment.

## Preview Plan Structure

All mutating operations are represented as previewable plan steps before execution.

- Step types:
  - `file-write`: create or overwrite a file.
  - `json-patch`: structured edit to JSON files such as `package.json`, `appsettings*.json`, `launchSettings.json`, and `.devcontainer/devcontainer.json`.
  - `command`: local command such as `git init`.
  - `github-repo`: create and/or clone a GitHub repository.
  - `github-variable`: post-MVP create or update of a readable GitHub environment variable.
  - `github-secret`: post-MVP create or replace of an unreadable GitHub environment secret.
  - `azure-deployment`: post-MVP Azure deployment and output consumption.
  - `entra-app`: post-MVP Entra app create/update.
  - `manual-prompt`: user decision needed before continuing.
- Every step records target, action, source, redacted preview, idempotency status, and confirmation scope.
- Step states are `pending`, `created`, `updated`, `skipped`, `present-unknown`, `conflict`, and `failed`.
- Confirmation granularity:
  - MVP file edits are confirmed together.
  - MVP GitHub repo creation is confirmed separately from file edits.
  - Post-MVP GitHub environment variables are confirmed by environment.
  - Post-MVP Azure deployments are confirmed by environment.
  - Post-MVP secret replacements are confirmed individually and environment-scoped.
- Redaction rules:
  - Never print secret values in preview, logs, JSON output, errors, command rendering, or test snapshots.
  - Show only presence, source, and status for sensitive values.
  - Redact sensitive command arguments before display.
  - Secret-bearing `gh` and `az` operations must avoid exposing values in argv or shell command text; use stdin, environment variables, temp files with cleanup, or APIs where supported.

## Idempotency and Resume Behavior

- MVP re-runs must detect existing target directories, local git state, GitHub repos, cloned repos, manifest files, and template source metadata.
- GitHub repo mode treats `target-dir` as the clone destination; existing unrelated files or a mismatched manifest become `conflict` steps.
- GitHub repo mode must honor `target-dir` exactly by cloning explicitly into that path instead of relying on `gh repo create --clone` defaults.
- Local-only mode can create a missing target directory, use an empty directory, or resume from a matching `.caes-app.json`; existing non-empty directories without a matching manifest become `conflict` steps.
- Safe matches become `skipped` or `updated` steps; unsafe mismatches become explicit `conflict` steps in preview.
- Preview output must explain whether each MVP step will be created, updated, skipped, or stopped on conflict.
- Post-MVP re-runs must detect GitHub environments, GitHub variables, GitHub secrets, Azure resource groups, Azure deployments, deployment outputs, and Entra app registrations.
- GitHub secrets are never read back after creation. Existing secrets are classified as `present-unknown`; replacement requires explicit environment-scoped confirmation or replacement flag.
- Azure OIDC bootstrap steps must use deterministic deployment names recorded in the manifest so reruns can find prior deployments and reuse compatible outputs when safe.
- Entra app registration updates should match on recorded manifest metadata where available; missing or ambiguous matches become conflicts instead of guessing.
- Entra redirect URI updates are additive: preserve existing URIs, add missing expected URIs, and preview removals only if a future command explicitly supports cleanup.

## Secret and Variable Classification

| Value | Storage/classification | CLI behavior |
| --- | --- | --- |
| `appId`, `displayName`, `ports` | Manifest fields | Written to `.caes-app.json` and safe to display. |
| GitHub owner/repo, repo visibility, default branch | Manifest fields and GitHub settings | Safe to display; existing mismatches become preview conflicts. |
| Environment names | Manifest fields | Safe to display; used by post-MVP GitHub/Azure commands. |
| Azure subscription, tenant, location, resource group names | Post-MVP manifest fields and GitHub environment variables | Safe to display; selected subscription is verified by post-MVP `doctor`. |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `RESOURCE_GROUP` | Post-MVP Azure deployment outputs and GitHub environment variables | Safe to display as identifiers; sourced from deployment outputs. |
| Auth client/app IDs and redirect URIs | Post-MVP manifest/config fields and GitHub environment variables | Safe to display; managed through `azure auth-app`. |
| `SQL_ADMIN_PASSWORD`, `SMTP_PASSWORD`, `OTEL_EXPORTER_OTLP_HEADERS`, `DB_CONNECTION` | Post-MVP GitHub environment secrets or prompt-only secrets | Never stored in manifest or printed. Existing GitHub values are `present-unknown`. |
| Local per-developer overrides | Local config only outside manifest | Never written to `.caes-app.json` or GitHub by default. |

Unreadable GitHub secrets use these states: `missing`, `present-unknown`, `replace-requested`, or `conflict`.

## Deployment Settings Contract

Deployment settings automation is post-MVP. The trusted template now provides the authoritative settings sync interface, and `caes-app` should consume and validate that interface instead of owning generated deployment surfaces directly. The app-owned overlay is the only deployment settings file `caes-app` edits directly for setting additions; generated deploy surfaces are owned by the trusted template sync tool.

- Template-owned defaults live in `infrastructure/azure/deployment-settings-defaults.json`.
- App-owned changes live in `infrastructure/azure/deployment-settings.json`, with root fields `version`, `disabled`, `overrides`, and `additions`.
- The local schema `infrastructure/azure/deployment-settings.schema.json` documents both the defaults catalog and overlay shapes.
- Package scripts are the stable CLI integration points:
  - `deployment-settings:sync`: rewrites generated regions from resolved defaults plus overlay data.
  - `deployment-settings:check`: validates settings and fails if generated regions are stale.
- The current sync-generated targets are `.github/workflows/deploy-azure-appservice.yml`, `.github/workflows/ci-cd.yml`, and `infrastructure/azure/deploy.sh`.
- Built-in settings are disabled by listing their `githubName` values in `disabled`.
- Built-in settings are overridden through `overrides`, keyed by `githubName`, with only supported runtime metadata fields changed.
- New runtime App Service settings are appended to `additions` with `githubName`, `appServiceName`, `classification`, `valueType`, `description`, and optional `id`, `requiredWhen`, `emitWhen`, and `defaultValue`.
- `caes-app app-setting add <app-setting-name>` adds runtime-only entries to `additions`, invokes `npm run deployment-settings:sync`, and previews both overlay and generated target diffs before applying.
- Runtime-only settings are applied through App Service app settings without custom Azure resource changes.
- Settings that change Azure resource shape still require intentional Bicep code changes; `caes-app` must not infer or generate new resource topology from a runtime setting request.
- Reusable GitHub workflows must keep individual named secrets instead of `secrets: inherit` so secret exposure remains auditable.

## Doctor Checks

`caes-app doctor` is post-MVP. It should be read-only and report actionable pass/warn/fail results for:

- Required tools and versions: Node, npm, git, `gh`, `az`, .NET SDK, and Bicep availability.
- Auth state: GitHub CLI account, Azure CLI account, selected Azure subscription, and tenant.
- GitHub access: target owner/repo visibility, repo existence, environment access, and readable environment variable presence/value matches where known.
- Secret readiness: whether required GitHub secrets are missing or `present-unknown`, without exposing values.
- Template expectations: required files and folders from `ucdavis/web-app-template`, including Azure Bicep files and expected config files.
- Deployment settings contract readiness: schema version support, generated-region marker presence, package script availability, and `deployment-settings:check` success.
- Manifest validity: schema version, required fields, supported managed-project shape, and unknown-field preservation compatibility.
- Environment readiness: required env vars/secrets by environment, derived from the deployment settings contract, with remediation hints for missing values.
- Azure readiness: selected subscription/tenant matches the manifest, resource groups exist or are expected to be created, OIDC bootstrap deployments can be found by recorded name, and Bicep files build.
- Runtime configuration readiness: auth, notification, SMTP, and OTLP settings are present enough for the selected scenario without exposing values.
- Output format: concise human output by default and redacted structured results with `--json`.

## Testing

### MVP Tests

- Unit-test package config, command-wide MVP flags, manifest validation, unknown-field preservation, future schema rejection, local-only manifest shape, and JSON file patching.
- Unit-test wizard-to-config mapping, input validation, generated-value previewing, default-branch-only template source recording, and redaction behavior.
- Unit-test preview plan states and confirmation scopes for file edits, local git, GitHub repo creation, target directory conflicts/resume, `--dry-run`, `--json`, `--json --yes`, `--local-only`, and `--no-git`.
- Integration-test `init` against a temp directory using mocked `gh` and `git` executables.
- Integration-test GitHub repo preview/create/clone flow and clone destination behavior with mocked `gh`.
- Integration-test local-only default branch copy/download behavior.
- Snapshot-test preview plans for create, update, `skipped`, conflict, target directory resume, local-only, `--no-git`, `--json`, and `--json --yes` scenarios.
- Release-test packed tarball contents, executable shebang, and `npx` smoke execution from `npm pack`.
- Run `npm test`, `npm run build`, `npm pack`, inspect packed files, verify the `bin` entry and shebang, smoke-test `npx` from the packed tarball, and run dry-run `caes-app init --dry-run` before MVP release.

### Post-MVP Tests

- Unit-test GitHub variable classification and unreadable GitHub secret behavior.
- Unit-test Azure OIDC output parsing, deterministic Azure OIDC deployment naming, Entra app matching/conflicts, additive redirect URI behavior, and Azure/Entra permission preflight handling.
- Unit-test deployment settings contract parsing, generated deploy surface validation, `app-setting add` name normalization, duplicate detection, variable/secret classification, type validation, runtime-only settings, Bicep-participating settings, redaction, preview generation, and missing-marker conflicts.
- Integration-test `app-setting add` against a temp generated app by updating `deployment-settings.json`, invoking the trusted template sync tool, and previewing generated file plus GitHub environment variable/secret changes.
- Integration-test retry/resume paths with mocked existing repo, existing environments, existing variables, present secrets, Azure deployment outputs, and Entra app matches/conflicts.
- Snapshot-test preview plans for `present-unknown`, secret replacement, Azure deployment, Entra updates, deployment settings changes, and additive redirect URI scenarios.
- For `web-app-template`, add checks that existing settings round-trip through `deployment-settings:sync`, `deployment-settings:check` catches stale generated regions, and Bicep builds still pass for `main.bicep` and `github-oidc.bicep`.
- Add explicit tests that secret values never appear in spawned command display strings, logs, JSON output, errors, or snapshots.
- Run all `dotnet` commands outside the Codex sandbox.

## Assumptions

- V1 MVP boundary is init plus optional GitHub repo creation/cloning.
- GitHub environments, GitHub secrets, Azure, Entra, deployment settings automation, `app-setting add`, and full `doctor` are post-MVP.
- Default template source is the trusted default branch of GitHub repo `ucdavis/web-app-template`.
- V1 does not support choosing a template branch, tag, or commit.
- Local-only mode still records the template default branch commit SHA for traceability.
- Local-only mode performs no `gh` mutations but may still perform non-mutating template source resolution, copy, or download steps needed for traceability.
- The GitHub template creation path creates the remote with `gh repo create --template`, then clones explicitly so `target-dir` is honored exactly.
- Pre-`caes-app` generated apps are not automation-compatible in this plan.
- The trusted-template model is acceptable for this team-specific tool; no sandboxed execution architecture is needed for template sync scripts.
- GitHub/Azure changes use "confirm then apply" behavior by default, with `--dry-run` available.
- `init` performs foundation customization only; sample route/controller cleanup becomes a later command.
- `init` must not stage, commit, push, or otherwise alter the git index of the generated app; generated customization files may remain uncommitted for developer review.
- No migrations are created or modified by this planning update.
