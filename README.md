# caes-app

Create a local CAES app from the current default branch of
[`ucdavis/web-app-template`](https://github.com/ucdavis/web-app-template).
Requires Node **24.0+**, Git, and access to the template repository.
On Windows, use native Windows Node/npm and Git for Windows, with `git` on
`PATH`. Git Bash is supported; the multiline examples below use Bash syntax.
The npm verification scripts also run from PowerShell or Command Prompt.

## Initialize an app

```bash
# Interactive inputs, preview, then confirmation
npx caes-app init my-app --local-only

# Preview without writing to the target
npx caes-app init my-app --local-only --dry-run

# Full per-file preview, including redacted change details
npx caes-app init my-app --local-only --dry-run --verbose

# Reproducible, noninteractive initialization
npx caes-app init my-app --local-only --yes \
  --app-id my-app --display-name "My App" \
  --server-port 6165 --client-port 6173 --database-port 15333

# Optional existing user sign-in application ID (a nonzero GUID)
npx caes-app init my-app --local-only --yes \
  --auth-client-id 12345678-1234-1234-1234-123456789abc
```

Phase 2 requires `--local-only`. GitHub repository creation arrives in Phase 3.
The target defaults to the current directory and must be absent, empty, or contain
a matching manifest from a previous initialization.

The CLI resolves the template's default branch to an exact commit before preview,
fetches that revision into temporary storage, and records its provenance in
committable `.caes-app.json` metadata. There is no custom template or revision flag.
It customizes package identity, display-name configuration, local database project
naming, and port wiring. Sample features, frontend branding, and .NET project names
remain in place.

## Options

| Option | Behavior |
| --- | --- |
| `--app-id <id>` | Lowercase, letter-led ID using letters, digits and single hyphens; defaults to the target basename. |
| `--display-name <name>` | Human-readable name; defaults to title-cased words from the app ID. |
| `--server-port`, `--client-port`, `--database-port` | Distinct integer ports from 1–65535; defaults come from the template (currently 5165, 5173, 14333). Database port is the host SQL port. |
| `--auth-client-id <guid>` | Write an existing user sign-in application ID only to git-ignored `server/.env`. |
| `--manifest <path>` | Alternate metadata file inside the target; relative paths are target-relative. Supply the same path on reruns. |
| `--no-git` | Skip initialization of the generated repository. Git is still required to retrieve the template. |
| `--yes` | Use flags/defaults and apply without prompts. |
| `--dry-run` | Preview only, even with `--yes`. Temporary template retrieval still occurs. |
| `--json` | Noninteractive JSON preview; add `--yes` to apply. |
| `--verbose` | Show every preview step, including skipped files, metadata, and redacted change details. Does not affect JSON output. |

Human previews group ordinary template copies into a count and show customized
files in an ASCII directory tree, with one line per file. Descriptions such as
“Package name; database port” identify the changes without displaying values.
`[A]` means add, `[M]` modify, and `[!]` a conflict or failure. Skipped files are
counted rather than listed. Conflicts and failures always show their reasons.
After an application failure, counts distinguish completed files from pending
work (`[P]`); `[?]` marks a file whose existing state is unknown.

Use `--verbose` before or after `init` for the full preview, including before/after
details where available. Sensitive values remain redacted in compact, verbose,
and JSON output; full local `.env` contents are never displayed.

Local files and Git initialization share one confirmation. New repositories use
`main`, with no remote, staged files, or commits. An existing repository rooted at
the target is preserved. Init does not install dependencies or start the app.

Manifest paths must not collide with template files or `server/.env`, including
containing or being nested beneath those files. These checks ignore letter case
on every platform so that metadata paths remain portable.

## Resume and results

Rerun the same command to complete an interrupted initialization. The CLI uses the
manifest's original commit and settings, restores missing files, completes safe
managed edits, and skips matching files. Unrelated developer edits and unknown
manifest fields are preserved. Conflicting managed values stop application; changing
identity or ports and upgrading the template are outside this phase.
LF and CRLF line endings are accepted in managed configuration; existing line
endings and formatting are preserved when updating the Docker Compose port.

All destination checks complete before application. Files changed after preview
cause a conflict. File replacements are atomic individually; the whole operation
is not a filesystem transaction. If an operation fails, completed work remains
alongside the manifest for a resumable run.

JSON previews use `kind: "preview"` with steps and `hasConflicts`. Preflight errors
use a structured error, including a preview when available. Apply results use
`kind: "result"`, `status: "success" | "cancelled" | "failure"`, per-step outcomes,
`scaffoldingCompleted`, `runtimeReadiness: "unverified"`, and `nextSteps`.
File step IDs always use `/` separators; their `target` paths use the host's
native filesystem format.
Exit codes are **0** for success/preview/declined confirmation, **2** for invalid
inputs or conflicts, and **1** for execution failures or unavailable Phase 3 mode.

## Local sign-in setup

Initialization always creates a missing `server/.env` from the resolved template's
`server/.env.example`, with owner-only permissions (`0600`) on POSIX systems.
On Windows, files inherit directory access-control permissions (ACLs); the CLI
does not change those ACLs or guarantee owner-only access. Use a directory with
appropriate access restrictions for local configuration.
It fills in the app's telemetry
identity, display name, development database connection, notification URL, and any
supplied auth client ID. Other example defaults, comments, and placeholders remain
in place; configure the remaining auth, telemetry, and SMTP values before using
those services. A missing example is a conflict when `.env` needs to be created.

An existing `.env` is preserved byte-for-byte when auth is omitted, without
backfilling settings. An explicit `--auth-client-id` edits only `Auth__ClientId`;
duplicate or ambiguous auth assignments then become conflicts. Tracked dotenv
files, unsafe destinations, and missing ignore coverage are conflicts even when
auth is omitted. The ID is never copied into the manifest or committed app
settings. Dotenv contents and connection strings are not printed.

Generated values use the template's DotEnv.Core literal syntax. Values containing
boundary quotes, whitespace followed by `#`, `${…}`, or control characters cannot
be safely represented by that parser and cause a conflict before any writes;
ordinary internal quotes, backslashes, dollar signs, and Unicode are preserved.

Successful scaffolding does **not** establish runtime readiness. The output lists
manual Microsoft Entra sign-in setup and callback URLs for the configured ports and
IIS Express settings. Use the **user sign-in app registration**, not a GitHub
deployment managed identity. Configuration precedence is base app settings,
environment-specific app settings, `.env`, `.env.<environment>`, then process
environment variables; later sources win and can change the effective callback URL.

## Development and verification

```bash
npm ci
npm test
npm run typecheck
npm run build
npm run pack:check
npm run smoke:npx
```

Integration and packed-binary smoke tests use an offline local Git fixture, with
no GitHub or Azure mutations. Packed smoke tests install into a temporary npm
project; run them outside the Codex sandbox because nested npm installation can
hang there. No .NET execution or migration changes are needed for CLI verification.

The smoke test uses Node and exercises the installed package launcher (`.cmd` on
Windows) and `npm exec --offline`, including paths with spaces, alternate manifests,
Git initialization, and resumable runs. Template requests are redirected to a local
fixture using child-process Git configuration; user Git settings are unchanged.
Dependency installation still requires npm registry access.

Windows file-symlink tests require Developer Mode or symbolic-link privileges.
When those privileges are unavailable locally, only the affected tests are skipped
with an explanation. Direct-entry tests still run. In CI, missing symlink privileges
fail the checks instead of skipping coverage.

GitHub Actions runs typechecking, tests, package verification, and packed smoke tests
on Windows, macOS, and Linux with Node 24.x, for pull requests and pushes
to `main`. Passing macOS checks alone does not establish Windows compatibility;
the Windows jobs must pass as well.
