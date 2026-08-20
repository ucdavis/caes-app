# `caes-app` CLI V1 Plan

## Summary

Build `caes-app` as a Node 22+ / TypeScript CLI published with a `caes-app` binary, usable through `npx caes-app init`. V1 should focus on a strong initializer for new apps based on `ucdavis/web-app-template`, with a wizard that previews all file, GitHub, and Azure changes before applying them.

Default posture: automate foundation setup, make cloud operations safe to resume after partial failure, avoid sample-code cleanup in `init`.

## Implementation Phases

Track progress at the phase and major-deliverable level. Keep the detailed sections below as the design contract for what each phase must satisfy.

### Phase 1: Template Deployment Settings Contract

- [ ] Add `infrastructure/azure/deployment-settings.json` to `ucdavis/web-app-template`.
- [ ] Add `scripts/sync-deployment-settings.mjs` and package scripts `deployment-settings:sync` and `deployment-settings:check`.
- [ ] Add generated-region markers across workflow, Bicep, deploy script, and customization docs.
- [ ] Populate the initial contract from existing deploy variables/secrets.
- [ ] Verify sync output preserves current deployment behavior.

Implementation notes:

- _Record brief implementation-only decisions, discoveries, or follow-up context here as this phase is completed._

### Phase 2: CLI Foundation

- [ ] Scaffold the Node 22+ / TypeScript package, ESM build, `caes-app` binary, and test tooling.
- [ ] Add command-wide option parsing and command shell for `init`, `github env init`, `app-setting add`, `azure oidc bootstrap`, `azure auth-app`, and `doctor`.
- [ ] Implement manifest schema reading/writing with unknown-field preservation and future-schema rejection.
- [ ] Implement typed preview plan steps, confirmation scopes, idempotency states, JSON output, and redaction.
- [ ] Add structured JSON editing utilities for project config files.

Implementation notes:

- _Record brief implementation-only decisions, discoveries, or follow-up context here as this phase is completed._

### Phase 3: Initializer and Local Template Customization

- [ ] Implement `caes-app init [target-dir]` wizard input mapping and validation.
- [ ] Implement template compatibility checks and template source commit recording.
- [ ] Implement `--dry-run`, `--json`, `--manifest`, `--local-only`, and `--no-git` behavior for init.
- [ ] Write non-secret `.caes-app.json` metadata.
- [ ] Apply local file/config patches without sample-code cleanup.

Implementation notes:

- _Record brief implementation-only decisions, discoveries, or follow-up context here as this phase is completed._

### Phase 4: Deployment Settings Automation

- [ ] Implement the deployment settings contract reader and generated deploy surface validation.
- [ ] Implement `caes-app app-setting add <app-setting-name>`.
- [ ] Edit only `infrastructure/azure/deployment-settings.json` directly for setting additions.
- [ ] Invoke the template sync tool to update generated workflow, Bicep, script, and documentation regions.
- [ ] Preview contract, generated file, and GitHub environment variable/secret changes before applying.

Implementation notes:

- _Record brief implementation-only decisions, discoveries, or follow-up context here as this phase is completed._

### Phase 5: GitHub, Azure, Auth, and Doctor

- [ ] Implement `caes-app github env init`.
- [ ] Implement `caes-app azure oidc bootstrap`.
- [ ] Implement `caes-app azure auth-app`.
- [ ] Implement read-only `caes-app doctor`.
- [ ] Complete retry/resume behavior for GitHub, Azure, Entra, variables, and unreadable secrets.

Implementation notes:

- _Record brief implementation-only decisions, discoveries, or follow-up context here as this phase is completed._

## Command Shape

- Command-wide options:
  - `--dry-run`: build and print the preview plan without applying it.
  - `--yes`: skip non-secret confirmations while still requiring explicit secret replacement intent.
  - `--json`: emit machine-readable preview/results with all sensitive values redacted.
  - `--manifest <path>`: read/write a manifest path other than `.caes-app.json`.
  - `--env test|prod`: scope environment-aware commands to one environment.
  - `--replace-secret <name>`: allow a named unreadable GitHub secret to be replaced.
  - `--local-only`: perform no GitHub or Azure operations.
- `caes-app init [target-dir]`
  - Creates a new app from `ucdavis/web-app-template`.
  - Prefers `gh repo create --template ucdavis/web-app-template --clone` when creating a GitHub repo.
  - Collects app name, display name, GitHub owner/repo, visibility, dev ports, Azure subscription/location, `test`/`prod` resource group names, auth defaults, notification defaults, and optional SMTP/OTLP values.
  - Creates a committable non-secret `.caes-app.json` manifest in the generated app.
  - Updates template identity/config files and optionally creates GitHub environments.
  - Supports `--local-only` to avoid all `gh` and Azure work while still copying/downloading the template, applying local file patches, writing `.caes-app.json`, and initializing git by default.
  - Supports `--no-git` with `--local-only` to skip git initialization.
  - Excludes copied/generated artifacts like `node_modules`, `bin`, `obj`, `publish`, and ignored local files.
- `caes-app github env init`
  - Creates/updates GitHub environments `test` and `prod`.
  - Sets non-secret GitHub environment variables from `.caes-app.json`, selected `appsettings.json` values, and the template deployment settings contract.
  - Prompts for individual secrets like `SQL_ADMIN_PASSWORD`, `SMTP_PASSWORD`, `OTEL_EXPORTER_OTLP_HEADERS`, and `DB_CONNECTION`.
  - Treats existing GitHub secrets as present but unreadable; replacement requires explicit confirmation or a replacement flag.
- `caes-app app-setting add <app-setting-name>`
  - Adds a runtime App Service setting to the generated app's template deployment settings contract.
  - Defaults the GitHub source name from the App Service setting name, normalized to upper snake case.
  - Prompts for classification as a GitHub environment variable or secret, value type `string`, `int`, or `bool`, description, required/optional status, and whether the setting participates in Bicep infrastructure deployment.
  - Updates only `infrastructure/azure/deployment-settings.json` directly, then invokes the template-provided sync tool to update generated workflow, Bicep, script, and documentation regions.
  - Previews all contract, generated file, and GitHub environment variable/secret changes before applying.
- `caes-app azure oidc bootstrap`
  - Runs the template's `infrastructure/azure/github-oidc.bicep` per environment.
  - Reads deployment outputs and writes `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, and `RESOURCE_GROUP` into matching GitHub environments.
- `caes-app azure auth-app`
  - Creates or updates the user sign-in Entra app registration.
  - Manages redirect URIs for local dev, IIS Express, App Service hostnames, and custom domains.
  - Writes resulting auth values to app config/GitHub environment variables after confirmation.
- `caes-app doctor`
  - Validates local prerequisites: Node, npm, git, GitHub CLI auth, Azure CLI auth, .NET SDK presence, expected repo files, Bicep buildability, and required GitHub env vars/secrets.
  - Reports pass/warn/fail statuses with remediation hints, never secret values.

## CLI Technical Stack

- Use TypeScript with ESM on Node 22+.
- Use `commander` for command routing and option parsing.
- Use `@inquirer/prompts` for interactive wizard prompts.
- Use `zod` for manifest, config, and user input validation.
- Use `execa` for local `git`, `gh`, and `az` command execution.
- Use structured JSON editing for `package.json`, `appsettings*.json`, `launchSettings.json`, and `.devcontainer/devcontainer.json`.
- Use `tsx` for development, `tsup` for builds, and `vitest` for tests.

## Template Compatibility Contract

V1 targets `ucdavis/web-app-template` and should treat the template as an external dependency with an explicit compatibility check.

- Supported sources:
  - Default source is `ucdavis/web-app-template` at the selected branch/tag/ref, resolved to a commit SHA before mutation.
  - Generated apps record both the requested ref and resolved commit SHA in `.caes-app.json`.
  - Future template refs are allowed only when required files pass compatibility checks.
- Required template files:
  - Root files: `package.json`, `app.sln`, `README.customization.md`, and `.github/workflows/ci-cd.yml`.
  - Client files: `client/package.json`, `client/vite.config.ts`, and `client/package-lock.json`.
  - Server files: `server/appsettings.json`, `server/appsettings.Development.json`, `server/server.csproj`, and `server/Properties/launchSettings.json`.
  - Dev container files: `.devcontainer/devcontainer.json` and `.devcontainer/docker-compose.yml`.
  - Azure files: `infrastructure/azure/main.bicep`, `infrastructure/azure/github-oidc.bicep`, `infrastructure/azure/bicepconfig.json`, and `infrastructure/azure/deploy.sh`.
  - Deployment settings contract: `infrastructure/azure/deployment-settings.json`, used as the source of truth for GitHub environment variables, GitHub environment secrets, Bicep parameters, and Azure App Service app settings.
  - Template sync tool: `scripts/sync-deployment-settings.mjs`, plus package scripts `deployment-settings:sync` and `deployment-settings:check`.
  - Generated deploy surfaces: `.github/workflows/deploy-azure-appservice.yml`, `.github/workflows/ci-cd.yml`, `infrastructure/azure/main.bicep`, `infrastructure/azure/modules/compute.bicep`, `infrastructure/azure/deploy.sh`, and `README.customization.md`.
- Compatibility behavior:
  - Missing required files or unrecognized workflow/config shape becomes a preview `conflict` before any mutation.
  - Missing generated-region markers or an unsupported deployment settings contract schema becomes a preview `conflict`; the CLI must not guess where to insert workflow, Bicep, script, or documentation changes.
  - `doctor` reports template compatibility as pass/warn/fail with remediation text.
  - The CLI may preserve unknown template content, but must not guess at renamed workflow variables, Bicep parameters, or auth settings.

## Manifest Schema

`.caes-app.json` is committable, non-secret project metadata.

- Required fields:
  - `schemaVersion`: CLI manifest schema version.
  - `appId`: stable app identifier used for generated names and config.
  - `displayName`: human-readable app name.
  - `templateSource`: source template identity, including `repository`, selected branch/tag/ref, and resolved commit SHA.
  - `environments`: environment definitions such as `test` and `prod`.
  - `ports`: local development ports.
- Optional fields: `github`, `azure`, `auth`, `notifications`, and `observability`.
- Non-secret resource handles to record when known:
  - GitHub owner/repo, repo visibility, default branch, and environment names.
  - Azure subscription ID, tenant ID, location, resource group names, and repeatable OIDC bootstrap deployment names.
  - Deployment identity client IDs/principal IDs returned by `github-oidc.bicep`.
  - User sign-in Entra app object/client IDs, tenant/domain, callback path, and redirect URIs.
  - Template repository, requested ref, resolved commit SHA, and CLI schema version.
- Schema behavior:
  - Preserve unknown fields when reading and writing so future CLI versions can add metadata safely.
  - Reject unsupported future `schemaVersion` values with an upgrade message instead of rewriting the file.
  - Local-only manifests may omit or leave unset cloud sections until later `github` or `azure` commands populate them.
- Never store secrets, connection strings, passwords, PATs, private keys, OIDC credentials, SMTP passwords, OTLP headers, or per-developer local overrides.

## Validation Before Preview

- Validate app IDs, GitHub owner/repo names, environment names, localhost ports, redirect URIs, and duplicate port conflicts before generating the preview plan.
- Group validation failures by input area and include actionable remediation text.
- Do not pre-validate generated Azure resource names beyond obvious empty/invalid inputs; the Bicep deployment intentionally uses automatic name disambiguation suffixes.
- Preview generated values before mutation, including app IDs, package/repo names, local ports, resource group names, deployment names, callback URLs, and GitHub environment names.

## Preview Plan Structure

All mutating operations are represented as previewable plan steps before execution.

- Step types:
  - `file-write`: create or overwrite a file.
  - `json-patch`: structured edit to JSON files such as `package.json`, `appsettings*.json`, `launchSettings.json`, and `.devcontainer/devcontainer.json`.
  - `command`: local command such as `git init`.
  - `github-variable`: create or update a readable GitHub environment variable.
  - `github-secret`: create or replace an unreadable GitHub environment secret.
  - `azure-deployment`: run an Azure deployment and consume outputs.
  - `entra-app`: create or update a user sign-in Entra app registration.
  - `manual-prompt`: user decision needed before continuing.
- Every step records target, action, source, redacted preview, idempotency status, and confirmation scope.
- Step states are `pending`, `created`, `updated`, `skipped`, `present-unknown`, `conflict`, and `failed`.
- Confirmation granularity:
  - File edits are confirmed together.
  - GitHub environment variables are confirmed by environment.
  - Azure deployments are confirmed by environment.
  - Secret replacements are confirmed individually.
- Redaction rules:
  - Never print secret values in preview, logs, errors, or command text.
  - Show only presence, source, and status for sensitive values.
  - Redact sensitive command arguments before display.
  - Use the same redaction layer for preview rendering, JSON output, command logging, error messages, and tests.

## Idempotency and Resume Behavior

- Re-runs must detect existing GitHub repos, GitHub environments, GitHub variables, GitHub secrets, Azure resource groups, Azure deployments, deployment outputs, and Entra app registrations.
- Safe matches become `skip` or `update` steps; unsafe mismatches become explicit `conflict` steps in preview.
- Preview output must explain whether each cloud step will create, update, skip, replace, or stop on conflict.
- GitHub secrets are never read back after creation. Existing secrets are classified as `present unknown`; replacement requires an explicit confirmation or replacement flag.
- Azure OIDC bootstrap steps must use deterministic deployment names recorded in the manifest so reruns can find prior deployments and reuse compatible outputs when safe.
- Entra app registration updates should match on recorded manifest metadata where available; missing or ambiguous matches become conflicts instead of guessing.
- Entra redirect URI updates are additive: preserve existing URIs, add missing expected URIs, and preview removals only if a future command explicitly supports cleanup.

## Secret and Variable Classification

| Value | Storage/classification | CLI behavior |
| --- | --- | --- |
| `appId`, `displayName`, `ports`, environment names | Manifest fields | Written to `.caes-app.json` and safe to display. |
| GitHub owner/repo, repo visibility | Manifest fields and GitHub settings | Safe to display; existing mismatches become preview conflicts. |
| Azure subscription, tenant, location, resource group names | Manifest fields and GitHub environment variables | Safe to display; selected subscription is verified by `doctor`. |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `RESOURCE_GROUP` | Azure deployment outputs and GitHub environment variables | Safe to display as identifiers; sourced from deployment outputs. |
| Auth client/app IDs and redirect URIs | Manifest/config fields and GitHub environment variables | Safe to display; managed through `azure auth-app`. |
| `SQL_ADMIN_PASSWORD`, `SMTP_PASSWORD`, `OTEL_EXPORTER_OTLP_HEADERS`, `DB_CONNECTION` | GitHub environment secrets or prompt-only secrets | Never stored in manifest or printed. Existing GitHub values are `present unknown`. |
| Local per-developer overrides | Local config only outside manifest | Never written to `.caes-app.json` or GitHub by default. |

Unreadable GitHub secrets use these states: `missing`, `present unknown`, `replace requested`, or `conflict requires prompt`.

GitHub environment variables and secrets should be derived from `infrastructure/azure/deployment-settings.json` first, with `.github/workflows/deploy-azure-appservice.yml`, `.github/workflows/ci-cd.yml`, `appsettings.json`, `main.bicep`, and `deploy.sh` used as generated-output validation sources. This keeps `doctor`, `github env init`, and `app-setting add` aligned with the contract that drives the deployment surfaces.

## Deployment Settings Contract

This plan includes modifying `web-app-template` to add a machine-readable deployment settings contract before `caes-app` implements setting automation. The template contract should be implemented before the CLI depends on it. The contract is the only file `caes-app` edits directly for deployment setting additions; generated deploy surfaces are owned by the template sync tool.

- Add contract file: `infrastructure/azure/deployment-settings.json`.
- Add template sync tool: `scripts/sync-deployment-settings.mjs`.
- Add template package scripts:
  - `deployment-settings:sync`: rewrites generated regions from the contract.
  - `deployment-settings:check`: validates the contract and fails if generated regions are stale.
- Add generated regions to `.github/workflows/deploy-azure-appservice.yml`, `.github/workflows/ci-cd.yml`, `infrastructure/azure/main.bicep`, `infrastructure/azure/modules/compute.bicep`, `infrastructure/azure/deploy.sh`, and `README.customization.md`.
- Each setting definition includes GitHub source name, App Service setting name, classification (`variable` or `secret`), value type (`string`, `int`, or `bool`), description, required/optional status, and whether it participates in Bicep infrastructure deployment.
- Runtime-only settings are applied through App Service app settings without custom Azure resource changes.
- Settings that change Azure resource shape still require intentional Bicep code changes; `caes-app` must not infer or generate new resource topology from a runtime setting request.
- Reusable GitHub workflows must keep individual named secrets instead of `secrets: inherit` so secret exposure remains auditable.

## Doctor Checks

`caes-app doctor` should be read-only and report actionable pass/warn/fail results for:

- Required tools and versions: Node, npm, git, `gh`, `az`, .NET SDK, and Bicep availability.
- Auth state: GitHub CLI account, Azure CLI account, selected Azure subscription, and tenant.
- GitHub access: target owner/repo visibility, repo existence, environment access, and readable environment variable presence/value matches where known.
- Secret readiness: whether required GitHub secrets are missing or present unknown, without exposing values.
- Template expectations: required files and folders from `ucdavis/web-app-template`, including Azure Bicep files and expected config files.
- Deployment settings contract readiness: schema version support, generated-region marker presence, package script availability, and `deployment-settings:check` success.
- Manifest validity: schema version, required fields, local-only cloud omissions, and unknown-field preservation compatibility.
- Environment readiness: required env vars/secrets by environment, derived from the deployment settings contract, with remediation hints for missing values.
- Azure readiness: selected subscription/tenant matches the manifest, resource groups exist or are expected to be created, OIDC bootstrap deployments can be found by recorded name, and Bicep files build.
- Runtime configuration readiness: auth, notification, SMTP, and OTLP settings are present enough for the selected scenario without exposing values.
- Output format: concise human output by default and redacted structured results with `--json`.

## Testing

- Unit-test manifest validation, wizard-to-config mapping, unknown-field preservation, future schema rejection, local-only manifest shape, template source commit recording, GitHub variable classification, Azure OIDC output parsing, and JSON file patching.
- Unit-test classification and redaction behavior for all variables and secrets, including unreadable GitHub secrets.
- Unit-test template compatibility checks, deployment settings contract parsing, generated deploy surface validation, generated-value previewing, command-wide flags, and deterministic Azure OIDC deployment naming.
- Unit-test `app-setting add` for name normalization, duplicate detection, variable/secret classification, type validation, runtime-only settings, Bicep-participating settings, redaction, preview generation, and missing-marker conflicts.
- Integration-test `init` against a temp directory using mocked `gh`, `git`, and `az` executables.
- Integration-test `app-setting add` against a temp generated app by updating `deployment-settings.json`, invoking the template sync tool, and previewing generated file plus GitHub environment variable/secret changes.
- Integration-test retry/resume paths with mocked existing repo, existing environments, existing variables, present secrets, Azure deployment outputs, and Entra app matches/conflicts.
- Snapshot-test preview plans for create, update, skip, `present-unknown`, conflict, secret replacement, local-only, `--no-git`, `--json`, and additive redirect URI scenarios.
- Release-test packed tarball contents, executable shebang, and `npx` smoke execution from `npm pack`.
- For `web-app-template`, add checks that existing settings round-trip through `deployment-settings:sync`, `deployment-settings:check` catches stale generated regions, and Bicep builds still pass for `main.bicep` and `github-oidc.bicep`.
- Run `npm test`, `npm run build`, `npm pack`, inspect packed files, verify the `bin` entry and shebang, smoke-test `npx` from the packed tarball, and run dry-run `caes-app init --dry-run` and `caes-app app-setting add --dry-run` scenarios before release.
- Run all `dotnet` commands outside the Codex sandbox.

## Assumptions

- V1 optimizes for initialization first; cloud maintenance commands can be added behind the same command framework.
- Default template source is GitHub: `ucdavis/web-app-template`.
- GitHub/Azure changes use "confirm then apply" behavior by default, with `--dry-run` available.
- Existing generated apps without `deployment-settings.json` remain init-compatible, but `app-setting add` requires the new deployment settings contract.
- `init` performs foundation customization only; sample route/controller cleanup becomes a later command.
- The plan remains a concise implementation plan, not a full JSON Schema document.
- The CLI must not stage or alter the git index of the repo it is targeting.
- The template contract PR should be merged, or at least stable enough to pin by commit, before stacked `caes-app` PRs depend on it.
