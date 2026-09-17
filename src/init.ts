import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { input, confirm } from '@inquirer/prompts';
import { z } from 'zod';
import type { CliIo, InitInvocation, InitOptions } from './cli.js';
import { CommandError } from './errors.js';
import { parseManifest, serializeManifest, type CaesAppManifest } from './manifest.js';
import { hasConflicts, renderHumanPreview, renderJsonPreview, sanitizePreviewStep, type PreviewPlan, type PreviewStep } from './preview.js';
import { redactValue } from './redaction.js';
import { authInstructions, createLocalEnv, customizeFile, patchAuth, templateDefaults } from './init-patches.js';
import { fetchTemplate, requireGit, runGit, validateSource } from './template.js';
import type { InitDependencies, InitResult, ResolvedInitInputs, TemplateFile } from './init-types.js';

const inputSchema = z.object({
  appId: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(207),
  displayName: z.string().trim().min(1).refine((value) => !/[\x00-\x1f\x7f]/.test(value)),
  ports: z.object({ server: z.number().int().min(1).max(65535), client: z.number().int().min(1).max(65535), database: z.number().int().min(1).max(65535) }),
  authClientId: z.string().regex(/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i)
    .refine((value) => value !== '00000000-0000-0000-0000-000000000000').optional(),
});

export function validateInputs(value: ResolvedInitInputs): ResolvedInitInputs {
  const result = inputSchema.safeParse(value);
  if (!result.success) {
    const areas = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new CommandError(`Invalid init inputs: ${areas.join(', ')}. Use a lowercase app ID, nonblank display name, ports 1–65535, and a nonzero GUID auth client ID.`, { code: 'invalid-options', exitCode: 2 });
  }
  if (new Set(Object.values(result.data.ports)).size !== 3) throw new CommandError('Client, server, and database ports must be distinct.', { code: 'invalid-options', exitCode: 2 });
  const { authClientId, ...validated } = result.data;
  return { ...validated, ...(authClientId === undefined ? {} : { authClientId }) };
}

export async function collectInputs(options: InitOptions, target: string, defaults: ResolvedInitInputs['ports'], manifest: CaesAppManifest | undefined, deps: Pick<InitDependencies, 'interactive' | 'input'>): Promise<ResolvedInitInputs> {
  const slug = basename(target).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let appId = options.appId ?? manifest?.appId ?? slug;
  const prompting = deps.interactive && !options.json && !options.yes;
  if (prompting && !options.appId && !manifest) appId = await deps.input('App ID', appId);
  let displayName = options.displayName ?? manifest?.displayName ?? appId.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  if (prompting && !options.displayName && !manifest) displayName = await deps.input('Display name', displayName);
  const savedPorts = { server: manifest?.ports.server ?? defaults.server, client: manifest?.ports.client ?? defaults.client,
    database: manifest?.ports.database ?? defaults.database };
  const ports = { ...savedPorts };
  for (const [name, flag] of [['server', 'serverPort'], ['client', 'clientPort'], ['database', 'databasePort']] as const) {
    if (options[flag] !== undefined) ports[name] = Number(options[flag]);
    else if (prompting && !manifest) ports[name] = Number(await deps.input(`${name} port`, String(ports[name])));
  }
  let authClientId = options.authClientId;
  if (prompting && authClientId === undefined) {
    authClientId = (await deps.input('Existing user sign-in Application (client) ID (optional; leave blank to keep existing auth or use a placeholder in a new server/.env)')).trim() || undefined;
  }
  const resolved = validateInputs({ appId, displayName, ports, ...(authClientId === undefined ? {} : { authClientId }) });
  if (manifest && (manifest.appId !== resolved.appId || manifest.displayName !== resolved.displayName ||
      !isDeepStrictEqual(savedPorts, resolved.ports))) {
    throw new CommandError('Existing manifest identity and ports must match. Reconfiguration is not supported; omit changed inputs to resume.', { code: 'conflict', exitCode: 2 });
  }
  return resolved;
}

export function manifestDestination(target: string, manifest: string): string {
  const destination = resolve(target, manifest);
  const rel = relative(target, destination);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || rel.split(sep).some((part) => part.toLowerCase() === '.git')) {
    throw new CommandError('--manifest must name a file inside the target directory, outside .git.', { code: 'invalid-options', exitCode: 2 });
  }
  return destination;
}

interface FileState { content: Buffer; mode: number }
interface WriteOperation { path: string; before: FileState | undefined; after: Buffer; mode: number; step: PreviewStep }

function conflict(message: string): CommandError { return new CommandError(message, { code: 'conflict', exitCode: 2 }); }
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }

// Inspect each existing path component without following target-owned symlinks.
async function inspect(root: string, path: string): Promise<FileState | undefined> {
  const parts = relative(root, path).split(sep).filter(Boolean);
  let cursor = root;
  for (let index = -1; index < parts.length; index++) {
    if (index >= 0) cursor = join(cursor, parts[index]!);
    let stat;
    try { stat = await lstat(cursor); } catch (error) { if (missing(error)) return undefined; throw error; }
    if (stat.isSymbolicLink()) throw conflict(`Unsafe symlink destination: ${cursor}. Use a regular directory/file.`);
    if (index < parts.length - 1 || path === root) {
      if (!stat.isDirectory()) throw conflict(`Expected a directory at ${cursor}.`);
    } else {
      if (!stat.isFile()) throw conflict(`Expected a regular file at ${cursor}.`);
      return { content: await readFile(cursor), mode: stat.mode & 0o777 };
    }
  }
  return undefined;
}

async function rootListing(target: string): Promise<string[]> {
  await inspect(target, target);
  try { return (await readdir(target)).sort(); } catch (error) { if (missing(error)) return []; throw error; }
}

function step(id: string, type: PreviewStep['type'], target: string, state: PreviewStep['state'], preview: Record<string, unknown>): PreviewStep {
  return { id, type, target, state, action: state === 'conflict' ? 'resolve conflict' : state === 'skipped' ? 'preserve' : 'write',
    source: 'trusted template / resolved init inputs', confirmationScope: { kind: 'mvp-file-edits' }, preview };
}

async function ignoredAuth(target: string, files: Map<string, TemplateFile>, git: InitDependencies['git'], verifyActual = false): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'caes-app-ignore-'));
  try {
    await requireGit(git, ['-c', 'init.templateDir=', 'init', '--quiet', '--initial-branch=main'], scratch);
    for (const name of ['.gitignore', 'server/.gitignore']) {
      const existing = await inspect(target, join(target, name));
      const content = existing?.content ?? files.get(name)?.content;
      if (content) { await mkdir(dirname(join(scratch, name)), { recursive: true }); await writeFile(join(scratch, name), content); }
    }
    await mkdir(join(scratch, 'server'), { recursive: true });
    const ignored = await git(['-c', 'core.excludesFile=/dev/null', 'check-ignore', '--no-index', '--quiet', '--', 'server/.env'], scratch);
    if (ignored.exitCode !== 0) throw conflict('server/.env must be ignored by project .gitignore rules before initializing local configuration.');
    // Also respect a containing repository, even when this is not its root.
    const exists = await lstat(target).then(() => true, (error: unknown) => { if (missing(error)) return false; throw error; });
    const repo = exists ? await git(['rev-parse', '--show-toplevel'], target) : { exitCode: 128, stdout: '' };
    if (repo.exitCode === 0) {
      const tracked = await git(['ls-files', '--error-unmatch', '--', 'server/.env'], target);
      if (tracked.exitCode === 0) throw conflict('server/.env is tracked by Git. Untrack it before initializing local configuration.');
      if (tracked.exitCode !== 1) throw conflict('Could not verify that server/.env is untracked.');
      if (verifyActual) {
        const actual = await git(['check-ignore', '--no-index', '--quiet', '--', 'server/.env'], target);
        if (actual.exitCode !== 0) throw conflict('Git does not ignore server/.env in the destination repository.');
      }
    }
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

async function atomicWrite(operation: WriteOperation): Promise<void> {
  await mkdir(dirname(operation.path), { recursive: true });
  const temporary = join(dirname(operation.path), `.caes-app-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, operation.after, { flag: 'wx', mode: operation.mode });
    await rename(temporary, operation.path);
  } finally { await rm(temporary, { force: true }); }
}

export async function initialize(invocation: InitInvocation, io: CliIo, injected: Partial<InitDependencies> = {}): Promise<void> {
  const git = injected.git ?? runGit;
  const deps: InitDependencies = {
    git, fetchTemplate: (source) => fetchTemplate(git, source),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    input: (message, defaultValue) => input({ message, ...(defaultValue === undefined ? {} : { default: defaultValue }) }),
    confirm: (message) => confirm({ message, default: false }), ...injected,
  };
  const { options } = invocation;
  const target = resolve(invocation.targetDir);
  const previewOptions = { verbose: Boolean(options.verbose), targetDir: target };
  const plan: PreviewPlan = { command: 'init', summary: `Initialize ${target}`, steps: [] };
  let cleanup: (() => Promise<void>) | undefined;
  let applying = false;
  let activeStep: PreviewStep | undefined;
  let nextSteps: string[] = [];
  const emitResult = (status: InitResult['status'], error?: CommandError) => {
    const result: InitResult = { kind: 'result', command: 'init', status, scaffoldingCompleted: status === 'success',
      runtimeReadiness: 'unverified', steps: plan.steps.map(sanitizePreviewStep), nextSteps,
      ...(error ? { error: { code: error.code, message: error.message } } : {}) };
    if (options.json) io.stdout(`${JSON.stringify(redactValue(result), null, 2)}\n`);
    else {
      io.stdout(status === 'success' ? 'Scaffolding completed. Runtime readiness is unverified.\n' : status === 'cancelled' ? 'Initialization cancelled; no changes applied.\n' : 'Initialization failed; completed steps remain available for a resumable run.\n');
      if (status === 'failure') io.stdout(renderHumanPreview(plan, { ...previewOptions, applied: true,
        ...(activeStep && error ? { failure: { stepId: activeStep.id, message: error.message } } : {}) }));
      if (error) io.stderr(`${error.message}\n`);
      if (status === 'success') io.stdout(nextSteps.map((line) => `- ${line}`).join('\n') + '\n');
    }
  };
  try {
    const manifestPath = manifestDestination(target, options.manifest);
    const listing = await rootListing(target);
    const existingManifest = await inspect(target, manifestPath);
    const recorded = existingManifest ? parseManifest(existingManifest.content.toString(), manifestPath) : undefined;
    if (listing.length && !recorded) throw conflict('Target directory is not empty and has no matching manifest. Choose an empty directory or the correct --manifest path.');
    if (recorded) validateSource(recorded.templateSource);
    const template = await deps.fetchTemplate(recorded?.templateSource);
    cleanup = template.cleanup;
    validateSource(template.source);
    const defaults = templateDefaults(template.files);
    const config = await collectInputs(options, target, defaults, recorded, deps);
    const manifest: CaesAppManifest = recorded ?? { schemaVersion: 1, appId: config.appId, displayName: config.displayName, ports: config.ports, templateSource: template.source };
    // Reserve case-insensitive names on every host so manifests remain portable.
    const manifestRelative = relative(target, manifestPath).split(sep).join('/').toLowerCase();
    if ([...template.files.keys(), 'server/.env'].some((file) => {
      const name = file.toLowerCase();
      return name === manifestRelative || name.startsWith(`${manifestRelative}/`) || manifestRelative.startsWith(`${name}/`);
    })) {
      throw conflict('Manifest path collides with template content or the local auth file. Choose a separate metadata file.');
    }
    plan.summary = `Initialize ${config.displayName} (${config.appId}) from ${template.source.defaultBranch}@${template.source.resolvedCommitSha}`;
    const operations: WriteOperation[] = [];
    const inspected = new Map<string, FileState | undefined>();
    const addWrite = (path: string, before: FileState | undefined, after: Buffer, mode: number, type: PreviewStep['type'], preview: Record<string, unknown>) => {
      const state = before?.content.equals(after) ? 'skipped' : before ? 'updated' : 'created';
      const item = step(relative(target, path).split(sep).join('/'), type, path, state, preview);
      plan.steps.push(item);
      inspected.set(path, before);
      if (state !== 'skipped') operations.push({ path, before, after, mode: before?.mode ?? mode, step: item });
    };
    addWrite(manifestPath, existingManifest, existingManifest?.content ?? Buffer.from(serializeManifest(manifest)), 0o644, 'file-write',
      { appId: config.appId, displayName: config.displayName, ports: config.ports, templateSource: template.source });
    const finalFiles = new Map<string, TemplateFile>();
    for (const [name, file] of template.files) {
      const destination = join(target, name);
      try {
        const before = await inspect(target, destination);
        const patch = customizeFile(name, file.content, before?.content ?? file.content, config);
        finalFiles.set(name, { ...file, content: patch.content });
        addWrite(destination, before, patch.content, file.mode, name.endsWith('.json') ? 'json-patch' : 'file-write',
          Object.keys(patch.changes).length ? { changes: patch.changes } : { bytes: patch.content.length });
      } catch (error) {
        if (!(error instanceof CommandError)) throw error;
        plan.steps.push(step(name, 'file-write', destination, 'conflict', { message: error.message }));
      }
    }
    if (!hasConflicts(plan)) nextSteps = authInstructions(config, finalFiles);
    {
      const authPath = join(target, 'server/.env');
      try {
        await ignoredAuth(target, template.files, git);
        const before = await inspect(target, authPath);
        const content = before
          ? config.authClientId ? Buffer.from(patchAuth(before.content.toString(), config.authClientId)) : before.content
          : createLocalEnv(template.files.get('server/.env.example')?.content, finalFiles, config);
        addWrite(authPath, before, content, 0o600, 'file-write', config.authClientId
          ? { assignment: { Auth__ClientId: config.authClientId } }
          : { reason: before ? 'preserve existing local configuration' : 'template example with known local settings and remaining placeholders' });
      } catch (error) {
        if (!(error instanceof CommandError)) throw error;
        plan.steps.push(step('server/.env', 'file-write', authPath, 'conflict', { message: error.message }));
      }
    }
    let gitRoot = '';
    if (listing.length) {
      const rootResult = await git(['rev-parse', '--show-toplevel'], target);
      if (rootResult.exitCode === 0) gitRoot = rootResult.stdout.trim();
      else if (listing.includes('.git')) throw conflict('Existing .git metadata cannot be read; repair the repository before resuming.');
    }
    const rootedHere = gitRoot && await realpath(gitRoot) === await realpath(target);
    const gitStep = step('git.init', 'command', target, options.noGit || rootedHere ? 'skipped' : 'created',
      { reason: options.noGit ? '--no-git' : rootedHere ? 'existing repository at target' : 'new repository on main' });
    gitStep.action = gitStep.state === 'skipped' ? 'preserve Git state' : 'initialize Git';
    gitStep.command = { command: 'git', args: ['-c', 'init.templateDir=', 'init', '--initial-branch=main', target] };
    plan.steps.push(gitStep);
    plan.steps.push({ ...step('manual.auth', 'manual-prompt', target, 'skipped', { runtimeReadiness: 'unverified', nextSteps }), confirmationScope: { kind: 'none' } });
    // All source bytes are now held in the plan; release retrieval storage before
    // waiting for confirmation or emitting a successful response.
    await cleanup();
    cleanup = undefined;
    if (hasConflicts(plan)) throw conflict('Init has conflicts. Resolve the listed issues and retry; no changes were applied.');
    if (options.dryRun || (options.json && !options.yes)) {
      io.stdout(options.json ? `${JSON.stringify(renderJsonPreview(plan), null, 2)}\n` : renderHumanPreview(plan, previewOptions));
      return;
    }
    if (!options.json) io.stdout(renderHumanPreview(plan, previewOptions));
    if (!options.yes) {
      if (!deps.interactive) throw new CommandError('Noninteractive initialization requires --yes to apply or --dry-run to preview.', { code: 'invalid-options', exitCode: 2 });
      if (!await deps.confirm('Apply all listed local changes?')) { emitResult('cancelled'); return; }
    }
    if (!isDeepStrictEqual(await rootListing(target), listing)) throw conflict('Target directory changed after preview. Run init again to review the new state.');
    for (const [path, before] of inspected) {
      const now = await inspect(target, path);
      if (!isDeepStrictEqual(now, before)) throw conflict(`File changed after preview: ${path}. Run init again.`);
    }
    await ignoredAuth(target, template.files, git);
    for (const operation of operations) operation.step.state = 'pending';
    if (gitStep.state === 'created') gitStep.state = 'pending';
    applying = true;
    for (const operation of operations) {
      activeStep = operation.step;
      if (!isDeepStrictEqual(await inspect(target, operation.path), operation.before)) throw conflict(`File changed during apply: ${operation.path}. Run init again.`);
      if (operation.path === join(target, 'server/.env')) await ignoredAuth(target, template.files, git, true);
      await atomicWrite(operation);
      operation.step.state = operation.before ? 'updated' : 'created';
    }
    if (gitStep.state === 'pending') {
      activeStep = gitStep;
      await inspect(target, target);
      const gitAppeared = await lstat(join(target, '.git')).then(() => true, (error: unknown) => { if (missing(error)) return false; throw error; });
      if (gitAppeared) throw conflict('Git metadata appeared during initialization. Rerun to inspect and preserve the existing repository.');
      await requireGit(git, ['-c', 'init.templateDir=', 'init', '--quiet', '--initial-branch=main'], target);
      gitStep.state = 'created';
    }
    activeStep = undefined;
    emitResult('success');
  } catch (error) {
    if (!applying && error instanceof Error && ['ExitPromptError', 'AbortPromptError'].includes(error.name)) { emitResult('cancelled'); return; }
    const failure = error instanceof CommandError ? error : new CommandError('Initialization could not complete. Check filesystem permissions and Git access, then retry.', { code: 'execution-failed' });
    if (applying) {
      if (activeStep) activeStep.state = 'failed';
      emitResult('failure', failure);
      Object.assign(failure, { emitted: true });
    } else {
      if (!hasConflicts(plan)) plan.steps.push(step('init.validation', 'manual-prompt', target, failure.exitCode === 2 ? 'conflict' : 'failed', { message: failure.message }));
      Object.assign(failure, { preview: plan, previewOptions });
    }
    throw failure;
  } finally { await cleanup?.(); }
}
