# `caes-app` Roadmap and V1 Init MVP Plan

## Summary

Build `caes-app` as a Node 24+ / TypeScript CLI published with a `caes-app` binary, usable through `npx caes-app init`.

The V1 Init MVP is intentionally narrow: create/customize a new app from the default branch of `ucdavis/web-app-template`, optionally create and clone the GitHub repo from that template, write a non-secret manifest, preview all mutations before applying them, and record the template source default branch and resolved commit SHA. GitHub environments/secrets, Azure OIDC, Entra auth app management, deployment settings automation, `app-setting add`, and full `doctor` behavior are post-MVP roadmap features.

Default posture: automate foundation setup, make every mutation previewable, keep secrets out of persisted project metadata, and avoid sample-code cleanup in `init`.

Template compatibility reviewed against `ucdavis/web-app-template` commit `bd1e761` on September 15, 2026. This is a review baseline, not a pinned template source; init still resolves the current default branch. MVP init may configure an existing user sign-in client ID locally, while Entra app registration management remains post-MVP.

## Implementation Roadmap

Track progress at the phase and major-deliverable level. Keep the detailed sections below as the design contract for what each phase must satisfy.

### Phase 1: V1 Init MVP - CLI Foundation

- [x] Scaffold the Node 24+ / TypeScript package, ESM build, `caes-app` binary, and test tooling.
- [x] Add command-wide option parsing and the MVP command shell for `init`.
- [x] Implement manifest schema reading/writing with unknown-field preservation and future-schema rejection.
- [x] Implement typed preview plan steps, confirmation scopes, idempotency states, JSON output, and redaction.
- [x] Add structured JSON editing utilities for project config files.
- [x] Add release checks for package contents, executable shebang, `bin` entry, and packed `npx` smoke execution.

Implementation notes:

- Implemented with npm, ESM TypeScript, Node `>=24.0.0`, `commander`, `@inquirer/prompts`, `zod`, `execa`, `tsx`, `tsup`, and `vitest`.
- At completion of Phase 1, `init` stopped after parsing and validation; Phase 2 now implements the local-only path.
- Packed smoke tests that install the tarball from a fresh npm cache require running outside the Codex sandbox because sandbox DNS blocks registry fetches and can make nested npm flows appear hung.

### Phase 2: V1 Init MVP - Local Template Initialization

- [x] Implement `caes-app init [target-dir]` wizard input mapping and validation.
- [x] Implement `--dry-run`, `--yes`, `--json`, `--manifest`, `--local-only`, and `--no-git` behavior for init.
- [x] Resolve the template default branch to a commit SHA before mutation and record both values.
- [x] For local-only mode, copy/download the trusted `ucdavis/web-app-template` default branch and exclude generated/local artifacts such as `node_modules`, `bin`, `obj`, `publish`, and ignored files.
- [x] Apply local file/config patches without sample-code cleanup.
- [x] Always create missing git-ignored `server/.env` from the pinned template example with resolved local settings and remaining placeholders. Accept optional `--auth-client-id <guid>` input and an interactive prompt; preserve existing dotenv contents except for explicit auth updates.
- [x] Provide manual auth setup instructions and redirect URIs derived from the final local configuration; distinguish completed scaffolding from runtime readiness in human and JSON output.
- [x] Write committable, non-secret `.caes-app.json` metadata.
- [x] In local-only mode, initialize local git by default; support `--no-git` only with `--local-only`.

Implementation notes:

- Phase 2 requires `--local-only`; default GitHub creation remains reserved for Phase 3.
- Git retrieves the resolved default-branch commit into disposable storage, even with `--no-git`. Only tracked, non-ignored source files are copied; Git metadata and generated artifacts are excluded.
- Local inputs have flags and wizard prompts. `--yes` accepts supplied values/defaults without prompting; JSON is always noninteractive.
- Reruns retain the recorded commit, identity, and ports. Managed values use source/generated comparisons; missing files can be restored while unrelated edits and unknown metadata survive.
- Relative manifest paths are target-relative and must stay inside the target. The manifest is written first to support retries after partial application; each file replacement is atomic.
- Local initialization uses `main` without staging, commits, or remotes. Auth changes require project ignore coverage and an untracked destination.
- Offline Git fixtures cover retrieval, initialization, conflicts, auth, resume, and installed-bin/npm-exec smoke execution.

### Phase 3: V1 Init MVP - GitHub Repository Creation

- [ ] Add lightweight prerequisite checks to both init modes: Git availability/template access for local-only; Git plus `gh` availability, GitHub authentication, and intended account/owner context for GitHub mode. Include actionable errors and a short README setup section.
- [ ] Implement the init path that creates and clones a GitHub repo from the default branch of `ucdavis/web-app-template`.
- [ ] Add GitHub-only `--repo`, `--visibility public|private`, and `--resume-existing` inputs. Default new repositories to owner 'ucdavis', app ID, and public visibility; use manifest values on reruns. Scope GitHub initialization to `github.com`.
- [ ] Use `gh repo create --template ucdavis/web-app-template` to create the remote repo, then `git clone` the new repo into the exact `target-dir`.
- [ ] Account for Git clone authentication separately from `gh` authentication. If cloning fails after remote creation, report the repo URL and exact `--resume-existing` command; support recovery into an absent/empty target or from a matching completed, uncustomized clone without a manifest.
- [ ] Preview the complete create/clone/customization plan, including account and destination, and collect both repository and file-edit confirmations before mutations.
- [ ] Verify cloned committed content against the previewed template snapshot before initial customization; stop on mismatch with manual recovery instructions.
- [ ] Write the manifest after clone verification and before applying local file/config patches inside the cloned project repo. Report create, clone, and customization outcomes separately on partial failure.
- [ ] Permit clone's initial checkout/index creation, then leave generated customization changes unstaged and uncommitted. Preserve developer work and staged changes on supported reruns; do not push.
- [ ] Record GitHub owner/repo, repo visibility, project repo default branch, template default branch, and resolved template commit SHA in the manifest.

Implementation notes:

- _Record brief implementation-only decisions, discoveries, or follow-up context here as this phase is completed._

### Phase 4: Post-MVP - GitHub Environments and Secrets

- [ ] Add command shell and implementation for `caes-app github env init`.
- [ ] Reuse prerequisite checks for `gh` authentication and relevant repository/environment access; require npm when invoking deployment settings scripts.
- [ ] Add `--env test|prod` for environment-scoped commands.
- [ ] Add environment-scoped secret replacement flags, including `--replace-secret <environment>:<name>` or an equivalent explicit environment-aware form.
- [ ] Create/update GitHub environments `test` and `prod`.
- [ ] Verify required deployment settings files, generated-region markers, and package scripts, and run `npm run deployment-settings:check` before relying on generated surfaces.
- [ ] Implement deployment settings contract reading, defaults/overlay resolution, and generated-surface validation before GitHub environment setup consumes settings; reuse this reader in Phases 6 and 7.
- [ ] Set non-secret GitHub environment variables from `.caes-app.json`, selected project app config, and resolved deployment settings; do not automatically import local `.env` overrides.
- [ ] Prompt for individual secrets such as `SQL_ADMIN_PASSWORD`, `SMTP_PASSWORD`, `OTEL_EXPORTER_OTLP_HEADERS`, and `DB_CONNECTION`.
- [ ] Treat existing GitHub secrets as present but unreadable; replacement requires explicit per-secret, per-environment intent.
- [ ] Explain that environment variable/secret changes require rerunning Configure Azure before they affect the app; do not automatically dispatch workflows.

Implementation notes:

- _Record brief implementation-only decisions, discoveries, or follow-up context here as this phase is completed._

### Phase 5: Post-MVP - Azure OIDC and Entra Auth

- [ ] Add command shell and implementation for `caes-app azure oidc bootstrap`.
- [ ] Add command-scoped checks for Azure CLI availability/authentication and Bicep availability where used; check GitHub prerequisites before Azure mutations when the operation also writes GitHub environment variables.
- [ ] Run the template's subscription-scoped `infrastructure/azure/github-oidc.bicep` per environment to create the application resource group, user-assigned managed identity, and environment-scoped federated credential.
- [ ] Require Azure CLI auth, selected subscription/tenant match, resource-group/managed-identity creation permissions, and role-assignment permissions at both the application resource group and shared App Service plan scopes for the default RBAC-enabled bootstrap.
- [ ] Resolve and validate the existing shared App Service plan, requiring paired overrides and the same plan selection for bootstrap and Configure Azure.
- [ ] Read deployment outputs and write `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, and `RESOURCE_GROUP` into matching GitHub environments after confirmation.
- [ ] Record managed identity and role-assignment outputs, and write matching `WEB_PLAN_NAME` / `WEB_PLAN_RESOURCE_GROUP` variables when overriding template defaults.
- [ ] Add command shell and implementation for `caes-app azure auth-app`.
- [ ] Require Microsoft Graph/app-registration permissions before Entra app creation or update.
- [ ] Manage redirect URIs for local dev, IIS Express, App Service hostnames, and custom domains.
- [ ] Add App Service hostname redirect URIs only after the hostname source exists; add custom domains only when supplied or discoverable.
- [ ] Preserve existing redirect URIs and make updates additive.

Implementation notes:

- _Record brief implementation-only decisions, discoveries, or follow-up context here as this phase is completed._

### Phase 6: Post-MVP - Deployment Settings and App Setting Automation

- [ ] Reuse Phase 4 contract reading and validation, including `deployment-settings:check`, before editing settings.
- [ ] Implement `caes-app app-setting add <app-setting-name>`.
- [ ] Edit only the app-owned `infrastructure/azure/deployment-settings.json` overlay directly for setting additions.
- [ ] Invoke `npm run deployment-settings:sync` to update generated Configure Azure workflow and local deploy script regions.
- [ ] Preview overlay, generated file, and GitHub environment variable/secret changes before applying.
- [ ] Explain that Configure Azure must run again to apply changed settings; a routine package deployment does not apply them and the CLI does not dispatch workflows automatically.

Implementation notes:

- _Record brief implementation-only decisions, discoveries, or follow-up context here as this phase is completed._

### Phase 7: Post-MVP - Doctor, Retry/Resume, and Release Hardening

- [ ] Implement read-only `caes-app doctor`, reusing the lightweight prerequisite checks already shipped with individual commands.
- [ ] Harden broader retry/resume behavior for GitHub, Azure, Entra, variables, and unreadable secrets; basic GitHub init recovery already ships in Phase 3.
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
  - Accepts GitHub-only `--owner <owner>`, `--repo <name>`, and `--visibility public|private`. New-run defaults are the effective authenticated account, app ID, and public visibility. Existing manifest values supply defaults on reruns; supplied mismatches become conflicts. GitHub initialization targets only `github.com`.
  - Accepts GitHub-only `--resume-existing` to explicitly reuse a selected existing remote when no local manifest is available. Normal matching-manifest reruns do not require the flag. Reject all four GitHub-specific options with `--local-only`.
  - Accepts init-specific `--auth-client-id <guid>` and an optional interactive prompt for an existing user sign-in application ID; noninteractive runs may omit it.
  - Creates a committable non-secret `.caes-app.json` manifest in the generated app.
  - Updates template identity/config files.
  - Permits clone's initial checkout/index creation, then leaves local customization changes unstaged and uncommitted so the developer can review generated files and choose what to stage and commit. Supported reruns preserve existing developer work and staged changes; init does not push.
  - Supports `--local-only` to avoid all `gh` mutations and Azure mutations while still resolving, copying, or downloading the trusted template source, applying local file patches, writing `.caes-app.json`, recording the template default branch commit SHA, and initializing git by default.
  - Supports `--no-git` only with `--local-only` to skip git initialization.
  - Local-only copying excludes generated artifacts like `node_modules`, `bin`, `obj`, `publish`, and ignored local files. GitHub mode clones repository content without an artifact cleanup pass.
  - In GitHub repo mode, `target-dir` is the clone destination and must not already contain unrelated files.
  - In local-only mode, `target-dir` must be absent or empty unless it contains a matching `.caes-app.json` for a resumable run.
  - Existing non-empty target directories without a matching manifest become preview `conflict` steps, except for an explicitly requested `--resume-existing` recovery from a matching completed, uncustomized clone as described below.
- Post-MVP commands:
  - `caes-app github env init`: creates/updates GitHub environments, variables, and secrets using resolved deployment settings and project configuration, without automatically uploading local overrides.
  - `caes-app azure oidc bootstrap`: deploys a user-assigned managed identity, federated credential, and deployment RBAC, then writes matching GitHub environment variables.
  - `caes-app azure auth-app`: creates/updates the user sign-in Entra app registration and related config.
  - `caes-app app-setting add <app-setting-name>`: adds a runtime App Service setting through the deployment settings contract and reports the required Configure Azure follow-up.
  - `caes-app doctor`: performs read-only local, GitHub, Azure, template, manifest, and runtime readiness checks.

### MVP Local Auth Configuration

- A supplied client ID fills or updates `Auth__ClientId` in `server/.env`; validate it as a nonzero GUID. Leave the committed `Auth:ClientId` placeholder unchanged and do not write the local override into `.caes-app.json`.
- Create a missing `.env` from the resolved template revision's `server/.env.example` with mode `0600`; missing examples conflict before application. Fill telemetry service name/namespace from app ID, SMTP/notification names from display name, notification URL from the client port, and DB_CONNECTION from customized development settings. Retain all other defaults, placeholders, comments, ordering, and line endings. Preserve an existing `.env` byte-for-byte when auth is omitted, without backfilling; an explicitly supplied ID updates only its assignment. Identical contents are `skipped`; ambiguous auth edits conflict. Use DotEnv.Core-compatible literals and reject unrepresentable values without exposing their contents.
- Verify that the destination is git-ignored and, when Git exists, untracked even when auth is omitted. Unsafe destinations become preview conflicts. Always include the dotenv operation in previews and recheck destinations after confirmation; dry runs remain read-only.
- Show only operation status, safe creation/preservation metadata, and an explicitly supplied auth assignment in previews. Never display full `.env` contents in human output, JSON, logs, or errors.
- Explain the template's configuration order: base app settings, environment-specific app settings, `.env`, `.env.<environment>`, then process environment variables, with later sources winning. Do not modify the higher-precedence local sources.
- Include manual sign-in setup instructions and callback URLs derived from the final client/server ports, callback path, and IIS Express configuration. The supplied ID must belong to the user sign-in app registration, not the GitHub deployment managed identity.
- Successful init means scaffolding completed. Report remaining manual auth setup in both human and JSON output without failing init or claiming runtime readiness. Creating or updating the Entra registration remains post-MVP.

## CLI Technical Stack

- Use TypeScript with ESM on Node 24+.
- Use `commander` for command routing and option parsing.
- Use `@inquirer/prompts` for interactive wizard prompts.
- Use `zod` for manifest, config, and user input validation.
- Use `execa` for local `git`, `gh`, and `az` command execution.
- Use structured JSON editing for `package.json`, `appsettings*.json`, `launchSettings.json`, and `.devcontainer/devcontainer.json`.
- Use a targeted, content-preserving assignment edit for the optional local auth value in `server/.env`; do not treat dotenv files as JSON or expose their full contents.
- Use `tsx` for development, `tsup` for builds, and `vitest` for tests.

## Tool Prerequisites and Setup Support

Developers are responsible for installing and authenticating prerequisite tools. Each command performs lightweight checks for only the tools and account context it requires before project or cloud mutations. Basic checks ship with the commands that need them; full `doctor` diagnostics remain post-MVP.

| Operation | Required checks |
| --- | --- |
| Local-only init | Git availability and template access, including with `--no-git` because retrieval still uses Git. No `gh` or Azure requirement. |
| GitHub init | Git and `gh` availability, working GitHub authentication, intended account/owner, and template access. Git clone credentials must also work for the chosen transport. |
| GitHub environment setup | `gh` authentication and relevant repository/environment access; npm for deployment settings scripts. |
| Azure operations | `az` authentication and intended subscription/tenant; Bicep where used. Also check `gh` when the operation writes GitHub settings. |
| Deployment settings edits | npm for template check/sync scripts; GitHub prerequisites only when updating GitHub settings. |
| Build/run diagnostics | .NET SDK, Docker, and other runtime tools only for the scenario being checked. Their absence does not block init. |

- Check executable availability early, preferably before lengthy wizard prompts; validate account/resource context once the necessary inputs are known. Read-only checks also apply to previews that depend on those tools or services.
- GitHub init checks the effective authenticated identity and explicitly targets `github.com`. Run Git and `gh` subprocesses noninteractively; user prompts belong to the CLI wizard and confirmation flow.
- Report missing tools, unsupported required capabilities, authentication failures, access denial, and network failures distinctly where reliably identifiable. Include a concrete remediation command or official setup link, preserve redaction, and return a nonzero exit code with structured errors in JSON mode. Do not mislabel an uncertain failure as a login problem.
- Keep one short README prerequisites section with official installation links and manual setup commands such as `gh auth login` and `az login`. Document minimum versions only where required by features the CLI uses, in addition to the Node runtime requirement.
- Treat GitHub API authentication and Git transport authentication separately. Suggest `gh auth setup-git` when appropriate for HTTPS credential setup; respect existing Git/SSH configuration. If creation succeeds but cloning fails, identify the created repo and explain how to repair credentials and retry.
- Verify Azure subscription/tenant against resolved inputs and recorded metadata before mutation; successful login alone does not establish the intended target. Show the target in the preview and pass explicit subscription scope where supported rather than silently switching the user's default.
- Authentication checks do not prove every operation is authorized. Use relevant read-only access checks where practical and handle later authorization failures with actionable errors; do not build a general permission-analysis system.
- Do not automatically install or upgrade tools, launch login flows, manage credentials, or change global Git/Azure configuration. Setup assistance consists of documentation and actionable diagnostics.
- Keep checks as small reusable helpers alongside command execution; reuse them in `doctor` rather than introducing a separate prerequisite framework.

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
  - GitHub template creation cannot request that SHA. Before initial customization, compare the cloned repository's committed content with the previewed template snapshot using Git content rather than checkout bytes, so line-ending conversion does not cause false mismatches. Do not compare project and template commit SHAs, since template generation creates a new project commit.
  - A content mismatch stops customization and manifest creation, leaves the created repository in place, and reports manual recovery instructions. Never silently record unverified template provenance. Manifest-based reruns retain their recorded template revision and use the existing managed-file resume behavior.
  - Generated apps record `templateSource.repository`, `templateSource.defaultBranch`, and `templateSource.resolvedCommitSha` in `.caes-app.json`.
  - V1 does not support choosing a template branch, tag, or commit.
- Compatibility scope:
  - Managed automation requires a `caes-app` generated app with a valid `.caes-app.json`.
  - Template compatibility checks apply to the source template used by `init` and to later managed projects that contain the required contract files.
  - Existing apps created from `web-app-template` before `caes-app` are unsupported for automation unless manually migrated by a future, separate migration feature.
- MVP required template files:
  - Root files: `package.json`, `app.sln`, `README.customization.md`, and `.gitignore` with coverage for `server/.env`.
  - Client files: `client/package.json`, `client/vite.config.ts`, and `client/package-lock.json`.
  - Server files: `server/appsettings.json`, `server/appsettings.Development.json`, `server/server.csproj`, and `server/Properties/launchSettings.json`.
  - Dev container files: `.devcontainer/devcontainer.json` and `.devcontainer/docker-compose.yml`.
  - Azure files may be copied as template content, but MVP `init` does not automate Azure deployment.
- Post-MVP required template files for deployment automation:
  - Workflows: `.github/workflows/configure-azure.yml`, `.github/workflows/deploy-azure-appservice.yml`, and `.github/workflows/ci-cd.yml`. Only Configure Azure has sync-generated settings regions.
  - Infrastructure: `infrastructure/azure/main.bicep`, `infrastructure/azure/github-oidc.bicep`, `infrastructure/azure/deploy.sh`, and their modules, including `compute.bicep`, `sql.bicep`, `deployment-identity.bicep`, `role-assignment.bicep`, and `web-plan-role-assignment.bicep` under `infrastructure/azure/modules/`.
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
  - Per-environment shared App Service plan name/resource group and actual web app location, which may differ from the location of other regional resources.
  - Managed deployment identity name, client/principal IDs, federated credential subject, and resource-group/shared-plan role-assignment IDs returned by `github-oidc.bicep`.
  - User sign-in Entra app object/client IDs, tenant/domain, callback path, and redirect URIs.
  - Template repository, default branch, resolved commit SHA, and CLI schema version.
- Schema behavior:
  - Phase 3 uses the existing manifest schema without a version change or a separate recovery-state schema.
  - Preserve unknown fields when reading and writing so future CLI versions can add metadata safely.
  - Reject unsupported future `schemaVersion` values with an upgrade message instead of rewriting the file.
  - Local-only manifests may omit or leave unset cloud sections until later GitHub or Azure commands populate them.
- The optional MVP `--auth-client-id` value is a per-developer local override, not manifest metadata; managed project auth identifiers are recorded only by later auth management commands. This roadmap refresh does not change the manifest schema version.
- Never store secrets, connection strings, passwords, PATs, private keys, OIDC credentials, SMTP passwords, OTLP headers, or per-developer local overrides.

## Validation Before Preview

- Run the command-scoped prerequisite checks described above before relying on external tools for preview generation or applying project/cloud mutations.
- Validate app IDs, GitHub owner/repo names, localhost ports, duplicate port conflicts, target directory state, and any supplied auth client ID and `.env` destination before generating the MVP preview plan. Validate repository names separately from app IDs, and restrict GitHub init visibility inputs to public/private.
- Group validation failures by input area and include actionable remediation text.
- Preview generated values before mutation, including app IDs, package/repo names, local ports, effective authenticated GitHub account, owner/repo, repo visibility, exact target directory, template default branch, and resolved template commit SHA. Make the account, destination, and visibility prominent.
- New-project previews assume the team's established default branch, `main`; record the actual project default branch after creation. Do not add branch-policy checks, branch enforcement, or workflow rewriting.
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
  - Build the complete GitHub init preview and collect both confirmations before any project or remote mutation. Declining either applies no changes. `--yes` skips both confirmations; `--dry-run` and JSON preview-only behavior remain unchanged.
  - Post-MVP GitHub environment variables are confirmed by environment.
  - Post-MVP Azure deployments are confirmed by environment.
  - Post-MVP secret replacements are confirmed individually and environment-scoped.
- GitHub init results distinguish repository creation, cloning, and customization outcomes in human and JSON output. After a partial failure, identify completed work and recovery instructions; do not claim that no changes were applied.
- Redaction rules:
  - Never print secret values in preview, logs, JSON output, errors, command rendering, or test snapshots.
  - Show only presence, source, and status for sensitive values.
  - For local auth edits, preview only the targeted `Auth__ClientId` assignment and status; never include full `.env` contents or unrelated values, even when the client ID itself is non-secret.
  - Redact sensitive command arguments before display.
  - Secret-bearing `gh` and `az` operations must avoid exposing values in argv or shell command text; use stdin, environment variables, temp files with cleanup, or APIs where supported.

## Idempotency and Resume Behavior

- MVP re-runs must detect existing target directories, local git state, GitHub repos, cloned repos, manifest files, and template source metadata.
- GitHub repo mode treats `target-dir` as the clone destination; existing unrelated files or a mismatched manifest become `conflict` steps.
- GitHub repo mode must honor `target-dir` exactly by cloning explicitly into that path instead of relying on `gh repo create --clone` defaults.
- Without a local manifest, an existing remote requires explicit `--resume-existing`; do not silently adopt it. The flag may clone the selected repo into an absent/empty target or continue from a completed, uncustomized clone whose repository root is the target, whose `origin` matches the selected GitHub repo, and whose committed content matches the resolved template snapshot. Incomplete or ambiguous checkouts stop with manual recovery instructions.
- After remote creation succeeds but cloning fails, report the created repo URL and an exact retry command using `--resume-existing`, carrying forward the target, selected manifest path, and non-secret initialization inputs. Recovery does not create another remote. If no manifest exists, resolve and verify the template snapshot again rather than inventing lost provenance.
- In GitHub mode, write the manifest after clone verification and before customization writes. Matching-manifest reruns retain recorded template/settings values and resume without `--resume-existing`, preserving developer work and staged changes; unsafe managed-value conflicts still stop application.
- Phase 3 supports this basic GitHub init recovery without recovery journals, rollback, automatic cleanup, arbitrary repository adoption, or local-only-to-GitHub conversion. Broader recovery hardening remains in Phase 7.
- Local-only mode can create a missing target directory, use an empty directory, or resume from a matching `.caes-app.json`; existing non-empty directories without a matching manifest become `conflict` steps.
- Safe matches become `skipped` or `updated` steps; unsafe mismatches become explicit `conflict` steps in preview.
- Preview output must explain whether each MVP step will be created, updated, skipped, or stopped on conflict.
- Post-MVP re-runs must detect GitHub environments, GitHub variables, GitHub secrets, Azure resource groups, Azure deployments, deployment outputs, and Entra app registrations.
- GitHub secrets are never read back after creation. Existing secrets are classified as `present-unknown`; replacement requires explicit environment-scoped confirmation or replacement flag.
- Azure OIDC bootstrap steps must use deterministic deployment names recorded in the manifest so reruns can find prior deployments and reuse compatible outputs when safe.
- Before reusing bootstrap outputs, verify the current subscription, tenant, repository, GitHub environment, application resource group, managed identity, federated subject, and shared-plan selection. Changed inputs or missing identities/assignments require a new preview; deployment-name matches alone do not establish readiness.
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
| Managed identity name/principal ID and role-assignment IDs | Post-MVP manifest fields | Safe to display; used for bootstrap verification and resume. |
| `WEB_PLAN_NAME`, `WEB_PLAN_RESOURCE_GROUP` | Post-MVP environment metadata and GitHub environment variables | Safe to display; paired overrides must match bootstrap and configuration. |
| Auth client/app IDs and redirect URIs | Post-MVP manifest/config fields and GitHub environment variables | Safe to display; managed through `azure auth-app`. |
| MVP `--auth-client-id` / local `Auth__ClientId` | Git-ignored `server/.env` only | Non-secret and safe to preview as a targeted assignment; never automatically copied to the manifest or GitHub. |
| `SQL_ADMIN_PASSWORD`, `SMTP_PASSWORD`, `OTEL_EXPORTER_OTLP_HEADERS`, `DB_CONNECTION` | Post-MVP GitHub environment secrets or prompt-only secrets | Never stored in manifest or printed. Existing GitHub values are `present-unknown`. |
| Local per-developer overrides | Local config only outside manifest | Never written to `.caes-app.json` or GitHub by default. |

Unreadable GitHub secrets use these states: `missing`, `present-unknown`, `replace-requested`, or `conflict`.

## Azure Configuration and Deployment Lifecycle

- Before the first package deployment, create/configure the GitHub environment and user sign-in settings, run the OIDC bootstrap, run the manual Configure Azure workflow, add the resulting App Service hostname's callback URI to the user sign-in registration, and then deploy the app package. Bootstrap supplies the Azure identity/resource-group variables needed by Configure Azure.
- Configure Azure verifies the application resource group exists, applies Bicep infrastructure, and applies runtime App Service settings using individual variables and secrets from the selected GitHub environment. OIDC bootstrap creates the resource group; Configure Azure does not.
- Routine CI/CD package deployments use existing infrastructure and configuration. Run Configure Azure again after Bicep, deployment settings, or GitHub environment variables/secrets change; wait for it to finish before deploying the package. CLI commands report this follow-up without dispatching workflows automatically.
- OIDC bootstrap creates a user-assigned managed identity and environment-scoped GitHub federated credential. By default it grants Contributor on the application resource group and Website Contributor on the exact shared App Service plan. Microsoft Graph/app-registration permissions are required for `azure auth-app`, not this managed-identity bootstrap.
- Consume outputs only after `deploymentGuardPassed=true`; record `deploymentIdentityName`, `clientId`, `principalId`, `federatedCredentialSubject`, `resourceGroupName`, `subscriptionId`, `tenantId`, `roleAssignmentId`, and `webPlanRoleAssignmentId`. If RBAC is explicitly disabled with `assignRbac=false`, report outstanding manual assignments instead of declaring deployment readiness.
- Existing shared plans are required in the selected subscription. At the reviewed template revision, defaults are `DefaultPlan2` in `Default-Web-WestUS` for `test` and `Nibbler` in `service-plans-linux` for `prod`. Use template defaults unless both `WEB_PLAN_NAME` and `WEB_PLAN_RESOURCE_GROUP` are supplied; a partial override is a conflict. Use the same resolved pair for bootstrap parameters and Configure Azure variables.
- Preflight must verify plan existence and bootstrap operator permissions to create the application resource group/managed identity and assign roles at both required scopes. The web app uses the shared plan's region; `AZURE_LOCATION` controls other regional resources, not the web app location.
- The local `deploy.sh` remains a combined infrastructure/settings/package path with `DEPLOY_INFRA` modes; the GitHub workflow split does not remove those local modes.

## Deployment Settings Contract

Deployment settings automation is post-MVP. The trusted template now provides the authoritative settings sync interface, and `caes-app` should consume and validate that interface instead of owning generated deployment surfaces directly. The app-owned overlay is the only deployment settings file `caes-app` edits directly for setting additions; generated deploy surfaces are owned by the trusted template sync tool.

- Template-owned defaults live in `infrastructure/azure/deployment-settings-defaults.json`.
- App-owned changes live in `infrastructure/azure/deployment-settings.json`, with root fields `version`, `disabled`, `overrides`, and `additions`.
- The local schema `infrastructure/azure/deployment-settings.schema.json` documents both the defaults catalog and overlay shapes.
- Package scripts are the stable CLI integration points:
  - `deployment-settings:sync`: rewrites generated regions from resolved defaults plus overlay data.
  - `deployment-settings:check`: validates settings and fails if generated regions are stale.
- Phase 4 resolves defaults plus overlay and validates generated surfaces before environment setup; Phase 6 and doctor reuse that reader.
- The current sync-generated targets are `.github/workflows/configure-azure.yml` and `infrastructure/azure/deploy.sh`. CI/CD and the package deployment workflow do not contain generated settings regions.
- Built-in settings are disabled by listing their `githubName` values in `disabled`.
- Built-in settings are overridden through `overrides`, keyed by `githubName`, with only supported runtime metadata fields changed.
- New runtime App Service settings are appended to `additions` with `githubName`, `appServiceName`, `classification`, `valueType`, `description`, and optional `id`, `requiredWhen`, `emitWhen`, and `defaultValue`.
- `requiredWhen` is context-specific: `always` applies to Configure Azure and every local deployment; `deploy_infra` applies to Configure Azure and local infrastructure deployments; `existing_infra` applies only to local existing-infrastructure deployments; `never` is optional. These checks do not describe routine GitHub package-deployment requirements.
- `caes-app app-setting add <app-setting-name>` adds runtime-only entries to `additions`, invokes `npm run deployment-settings:sync`, and previews both overlay and generated target diffs before applying.
- Runtime-only settings are applied through App Service app settings by Configure Azure or the local deploy script without custom Azure resource changes. Changing the overlay or GitHub environment alone does not apply settings to a running app.
- Settings that change Azure resource shape still require intentional Bicep code changes; `caes-app` must not infer or generate new resource topology from a runtime setting request.
- Configure Azure reads individual named environment secrets directly. Do not add runtime secret forwarding or `secrets: inherit` to the reusable package deployment workflow.

## Doctor Checks

`caes-app doctor` is post-MVP. It reuses command prerequisite checks and adds deeper diagnostics; users do not need to run it before ordinary commands. Scope readiness results to the relevant scenario so unused optional tools are not reported as blocking failures. It should be read-only and report actionable pass/warn/fail results for:

- Required tools and versions for the scenario: Node, npm, git, `gh`, `az`, .NET SDK, Docker, and Bicep availability as applicable.
- Auth state: GitHub CLI account, Azure CLI account, selected Azure subscription, and tenant.
- GitHub access: target owner/repo visibility, repo existence, environment access, and readable environment variable presence/value matches where known.
- Secret readiness: whether required GitHub secrets are missing or `present-unknown`, without exposing values.
- Template expectations: required files and folders from `ucdavis/web-app-template`, including Azure Bicep files and expected config files.
- Deployment settings contract readiness: schema version support, generated-region marker presence, package script availability, and `deployment-settings:check` success.
- Manifest validity: schema version, required fields, supported managed-project shape, and unknown-field preservation compatibility.
- Environment readiness: required env vars/secrets by environment and configuration/local-deployment context, including resolved contract settings and hand-authored infrastructure inputs, with remediation hints for missing values. Report the required Configure Azure follow-up after changes.
- Azure readiness: selected subscription/tenant matches the manifest, application resource groups and selected shared plans exist, managed identity/federation/RBAC match current bootstrap inputs at both scopes, deployments can be found by recorded name, and Bicep files build. Check consistent shared-plan selection and distinguish the web app's plan-derived region from other resource locations.
- Runtime configuration readiness: auth, notification, SMTP, and OTLP settings are present enough for the selected scenario without exposing values. Check effective auth independently of catalog validation: `AUTH_CLIENT_ID` is optional in the reviewed catalog, but the server rejects a missing or placeholder `Auth:ClientId`.
- Distinguish local configuration readiness, including `.env` precedence, from cloud configuration applied to App Service. A valid local client ID or configured GitHub variable does not by itself establish cloud runtime readiness. Never automatically upload local overrides.
- Output format: concise human output by default and redacted structured results with `--json`.

## Testing

The following describes implementation/release coverage. Phase 1 and Phase 2 include automated CLI, filesystem, template retrieval, and packed-binary checks; later-phase scenarios remain roadmap coverage.

### MVP Tests

- Unit-test package config, command-wide MVP flags, manifest validation, unknown-field preservation, future schema rejection, local-only manifest shape, and JSON file patching.
- Unit-test wizard-to-config mapping, optional auth input/omission and validation, targeted `.env` preservation/idempotency/conflicts, configured-port callback instructions, generated-value previewing, default-branch-only template source recording, and redaction of unrelated local values.
- Unit-test preview plan states and confirmation scopes for file edits, local git, GitHub repo creation, target directory conflicts/resume, `--dry-run`, `--json`, `--json --yes`, `--local-only`, and `--no-git`.
- Test GitHub input defaults (effective account, app ID, public visibility), explicit private visibility and owner/repo overrides, manifest defaults on reruns, separate repository-name validation, and rejection of GitHub-specific options with `--local-only`.
- Integration-test `init` against a temp directory using mocked `gh` and `git` executables.
- Test missing Git/`gh`, failed authentication, and actionable redacted human/JSON errors before mutations. Verify local-only init does not require `gh`, `az`, .NET, or Docker, and that `--no-git` still requires Git for retrieval.
- Integration-test GitHub repo preview/create/clone/customize flow and exact clone destination with mocked `gh`. Verify preview-only runs and either confirmation being declined cause no project or remote mutations.
- Test successful remote creation followed by clone authentication failure, repo URL/retry instructions in human and JSON output, and explicit recovery without duplicate remote creation.
- Test `--resume-existing` with an absent/empty target and a matching completed clone without a manifest; reject incomplete or mismatched targets with manual instructions. Verify normal manifest-based reruns require no recovery flag.
- Test template-content mismatch stops initial customization and manifest creation while preserving the remote, and checkout line-ending conversion does not cause a false mismatch.
- Verify customization remains unstaged/uncommitted after clone's initial checkout and supported reruns preserve staged and unstaged developer changes without pushing.
- Integration-test local-only default branch copy/download behavior.
- Snapshot-test preview plans for create, update, `skipped`, conflict, target directory resume, local-only, `--no-git`, `--json`, and `--json --yes` scenarios.
- Release-test packed tarball contents, executable shebang, and `npx` smoke execution from `npm pack`.
- Run `npm test`, `npm run build`, `npm pack`, inspect packed files, verify the `bin` entry and shebang, smoke-test `npx` from the packed tarball, and run dry-run `caes-app init --dry-run` before MVP release.

### Post-MVP Tests

- Test command-scoped missing tools, authentication/access failures, Azure subscription/tenant mismatches, and shared `doctor` diagnostics without invoking installers, login flows, or global configuration changes.
- Unit-test GitHub variable classification and unreadable GitHub secret behavior.
- Unit-test managed-identity OIDC output parsing, deterministic deployment naming, paired shared-plan overrides and consistent selection, Entra app matching/conflicts, additive redirect URI behavior, and permission preflight at both Azure RBAC scopes separately from Graph permissions.
- Unit-test deployment settings contract parsing in Phase 4, Configure Azure/local-script generated surface validation, context-specific `requiredWhen` semantics, independent effective-auth readiness checks, `app-setting add` name normalization, duplicate detection, variable/secret classification, type validation, runtime-only settings, Bicep-participating settings, redaction, preview generation, and missing-marker conflicts.
- Integration-test `app-setting add` against a temp generated app by updating `deployment-settings.json`, invoking the trusted template sync tool, and previewing generated file plus GitHub environment variable/secret changes.
- Integration-test retry/resume paths with mocked existing repo, existing environments, existing variables, present secrets, managed-identity deployment outputs, changed bootstrap/shared-plan inputs, and Entra app matches/conflicts.
- Snapshot-test preview plans for `present-unknown`, secret replacement, Azure deployment, Entra updates, deployment settings changes, and additive redirect URI scenarios.
- For `web-app-template`, add checks that existing settings round-trip through `deployment-settings:sync`, `deployment-settings:check` catches stale generated regions, and Bicep builds still pass for `main.bicep` and `github-oidc.bicep`.
- Add explicit tests that secret values never appear in spawned command display strings, logs, JSON output, errors, or snapshots.
- Run all `dotnet` commands outside the Codex sandbox.

## Assumptions

- V1 MVP boundary is init plus optional GitHub repo creation/cloning.
- Developers install and authenticate their own tools. Lightweight command-scoped prerequisite checks and actionable setup guidance are included as each command ships; automatic tool installation/login and a separate setup framework are out of scope.
- MVP init always creates a missing git-ignored `server/.env` from the pinned example with known settings and remaining placeholders. An explicitly supplied sign-in client ID fills or updates only the auth assignment; omission preserves existing dotenv files and provides manual setup instructions. Scaffolding success does not imply runtime readiness.
- GitHub environments, GitHub secrets, Azure, Entra, deployment settings automation, `app-setting add`, and full `doctor` are post-MVP.
- Default template source is the trusted default branch of GitHub repo `ucdavis/web-app-template`.
- V1 does not support choosing a template branch, tag, or commit.
- Local-only mode still records the template default branch commit SHA for traceability.
- Local-only mode performs no `gh` mutations but may still perform non-mutating template source resolution, copy, or download steps needed for traceability.
- The GitHub template creation path creates the remote with `gh repo create --template`, then clones explicitly so `target-dir` is honored exactly.
- Phase 3 targets the small team's `github.com` workflow: new repos default to public visibility, the effective authenticated owner, and the app ID as repo name. `main` is the established default branch; record the actual branch without adding branch-policy machinery.
- GitHub init uses explicit, limited recovery and actionable manual instructions. Recovery journals, rollback, automatic cleanup, arbitrary repository adoption, and local-only-to-GitHub conversion are outside Phase 3.
- Pre-`caes-app` generated apps are not automation-compatible in this plan.
- The trusted-template model is acceptable for this team-specific tool; no sandboxed execution architecture is needed for template sync scripts.
- Phase 4 provides deployment settings reading/validation; Phase 6 adds setting edits and sync. Configure Azure applies cloud settings separately from routine package deployment, and CLI commands do not automatically dispatch workflows.
- Azure deployments use existing shared plans, and managed-identity bootstrap and configuration must agree on the environment's plan selection. User sign-in registration management is separate from GitHub OIDC bootstrap.
- GitHub/Azure changes use "confirm then apply" behavior by default, with `--dry-run` available.
- `init` performs foundation customization only; sample route/controller cleanup becomes a later command.
- GitHub init permits clone's initial checkout and index creation. After that, init must not stage, commit, push, or otherwise alter the generated app's index; customization remains unstaged/uncommitted for developer review, and supported reruns preserve existing developer work and staged changes.
- Phase 2 implements the local CLI and its tests. It does not edit template repositories, generate migrations, perform cloud mutations, or stage/commit generated applications.
