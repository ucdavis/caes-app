import { mkdtemp, readFile, writeFile, rm, mkdir, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTemplateFixture } from '../scripts/init-fixture.mjs';
import { runCli, type InitOptions } from '../src/cli.js';
import { collectInputs, manifestDestination, validateInputs } from '../src/init.js';
import { createLocalEnv, customizeFile, patchAuth } from '../src/init-patches.js';
import { fetchTemplate, runGit, TEMPLATE_URL } from '../src/template.js';
import type { GitRunner, InitDependencies, ResolvedInitInputs } from '../src/init-types.js';
import { createTestSymlink } from './symlink-support.js';

const config: ResolvedInitInputs = { appId: 'demo-app', displayName: 'Demo App', ports: { server: 6165, client: 6173, database: 15333 } };
const templatePorts = { server: 5165, client: 5173, database: 14333 };
const clientId = '12345678-1234-1234-1234-123456789abc';
const options: InitOptions = { localOnly: true, noGit: true, json: true, yes: true, dryRun: false, manifest: '.caes-app.json' };
const fixtureFiles = JSON.parse(await readFile(new URL('./fixtures/template.json', import.meta.url), 'utf8')) as Record<string, string>;
const legacyContainer = await readFile(new URL('./fixtures/devcontainer-legacy.json', import.meta.url));
const example = fixtureFiles['server/.env.example']!;
const envFiles = new Map([['server/appsettings.Development.json', {
  content: Buffer.from(JSON.stringify({ ConnectionStrings: { DefaultConnection: 'Server=localhost,15333;Password=private;' } })), mode: 0o644,
}]]);

describe('input and auth editing', () => {
  it.each([
    { ...config, appId: '../bad' }, { ...config, displayName: ' ' },
    { ...config, ports: { ...config.ports, server: 70000 } },
    { ...config, ports: { ...config.ports, server: config.ports.client } },
    { ...config, authClientId: '00000000-0000-0000-0000-000000000000' }, { ...config, authClientId: 'bad' },
  ])('rejects invalid input %#', (value) => expect(() => validateInputs(value)).toThrow());

  it('maps wizard inputs and respects explicit flags', async () => {
    const answers = ['Demo Name', '6165', '6173', '15333', clientId];
    const result = await collectInputs({ ...options, json: false, yes: false, appId: 'chosen' }, '/apps/default', config.ports, undefined,
      { interactive: true, input: async () => answers.shift()! });
    expect(result).toEqual({ appId: 'chosen', displayName: 'Demo Name', ports: config.ports, authClientId: clientId });
    expect(answers).toEqual([]);
  });

  it('resolves manifest paths inside the target', () => {
    const target = resolve('apps/demo');
    expect(manifestDestination(target, 'config/manifest.json')).toBe(join(target, 'config/manifest.json'));
    for (const path of ['../outside', '.', '.git/config']) expect(() => manifestDestination(target, path)).toThrow();
  });

  it.each([
    { eol: '\n', port: 14333 }, { eol: '\r\n', port: 14333 },
    { eol: '\n', port: 15333 }, { eol: '\r\n', port: 15333 },
  ])('patches only the Compose port and preserves formatting ($port, $eol)', ({ eol, port }) => {
    const name = '.devcontainer/docker-compose.yml';
    const source = Buffer.from(fixtureFiles[name]!);
    const current = fixtureFiles[name]!.replace(/\r?\n/g, eol)
      .replace(/^[\t ]*- "14333:1433"/m, '\t  -  "14333:1433"\t ');
    const inputs = { ...config, ports: { ...config.ports, database: port } };
    const patched = customizeFile(name, source, Buffer.from(current), inputs, templatePorts);
    expect(patched.content.toString()).toBe(current.replace('14333:1433', `${port}:1433`));
    const resumed = customizeFile(name, source, patched.content, inputs, templatePorts);
    expect(resumed.content).toEqual(patched.content);
    expect(resumed.changes).toEqual({});
    const conflicting = Buffer.from(current.replace('14333:1433', '19999:1433'));
    expect(() => customizeFile(name, source, conflicting, inputs, templatePorts)).toThrow(/managed configuration/);
  });

  it('preserves dotenv comments, secrets and CRLF, and skips identical IDs', () => {
    const text = '# keep\r\nPASSWORD=super-private\r\nexport Auth__ClientId = "old" # comment\r\nTAIL=value\r\n';
    const updated = patchAuth(text, clientId);
    expect(updated).toBe(`# keep\r\nPASSWORD=super-private\r\nexport Auth__ClientId = ${clientId} # comment\r\nTAIL=value\r\n`);
    expect(patchAuth(updated, clientId)).toBe(updated);
    expect(patchAuth('OTHER=value', clientId)).toBe(`OTHER=value\nAuth__ClientId=${clientId}\n`);
  });

  it.each(['Auth__ClientId=a\nAuth__ClientId=b\n', 'Auth__ClientId="unterminated\n', 'Auth__ClientId value\n'])('rejects ambiguous auth without leaking contents', (text) => {
    expect(() => patchAuth(text, clientId)).toThrow(/server\/\.env/);
  });

  it('customizes the full example while retaining comments, placeholders, and CRLF', () => {
    const source = example.replaceAll('\n', '\r\n').replace('OTEL_SERVICE_NAME=', 'export OTEL_SERVICE_NAME = ')
      .replace('"<service_name>"', '"<service_name>" # service comment');
    const result = createLocalEnv(Buffer.from(source), envFiles, config).toString();
    expect(result).toBe(source
      .replace('<service_name>', 'demo-app').replace('<service_namespace>', 'demo-app')
      .replaceAll('<app_display_name>', 'Demo App').replace('http://localhost:5173', 'http://localhost:6173')
      .replace(/DB_CONNECTION="[^"]*"/, 'DB_CONNECTION="Server=localhost,15333;Password=private;"'));
    expect(result).toContain('Auth__ClientId="<client-guid>"');
    expect(createLocalEnv(Buffer.from(source), envFiles, { ...config, authClientId: clientId }).toString())
      .toBe(patchAuth(result, clientId));
  });

  it.each([
    ['CAES "Research" Team', '\'CAES "Research" Team\''],
    ["Dean's Office", '"Dean\'s Office"'],
    ['CAES "Research" & Dean\'s Team', '"CAES "Research" & Dean\'s Team"'],
    ['CAES C:\\new\\tools $5#tag', '"CAES C:\\new\\tools $5#tag"'],
    ['Équipe = Sciences', '"Équipe = Sciences"'],
  ])('preserves literal display-name characters for the server parser: %s', (displayName, encoded) => {
    const result = createLocalEnv(Buffer.from(example), envFiles, { ...config, displayName }).toString();
    expect(result).toContain(`Smtp__FromName=${encoded}\n`);
    expect(result).toContain(`Notification__DefaultAppName=${encoded}\n`);
  });

  it.each(['"boundary', "boundary'", 'unsafe #comment', '${PRIVATE_VALUE}', 'bad\nvalue'])('rejects unrepresentable values without leaking them: %s', (displayName) => {
    expect(() => createLocalEnv(Buffer.from(example), envFiles, { ...config, displayName })).toThrow(/Cannot safely encode Smtp__FromName/);
    try { createLocalEnv(Buffer.from(example), envFiles, { ...config, displayName }); }
    catch (error) { expect(String(error)).not.toContain(displayName); }
  });

  it('rejects missing examples and ambiguous managed assignments', () => {
    expect(() => createLocalEnv(undefined, envFiles, config)).toThrow(/missing server\/\.env.example/);
    for (const text of ['DB_CONNECTION=a\nDB_CONNECTION=b\n', 'Smtp__FromName="unterminated\n']) {
      expect(() => createLocalEnv(Buffer.from(text), envFiles, config)).toThrow(/server\/\.env.example/);
    }
  });
});

describe('local init integration', () => {
  let directory: string;
  let fixture: Awaited<ReturnType<typeof createTemplateFixture>>;
  let git: GitRunner;
  let sequence = 0;
  const calls: string[][] = [];
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'caes-app-init-test-'));
    fixture = await createTemplateFixture(directory);
    git = async (args, cwd, input) => {
      calls.push(args);
      return runGit(args.map((arg) => arg === TEMPLATE_URL ? fixture.repo : arg), cwd, input);
    };
  });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  async function invoke(args: string[] = [], deps: Partial<InitDependencies> = {}, destination?: string) {
    const target = destination ?? join(directory, `demo-${++sequence}`);
    let stdout = ''; let stderr = '';
    const code = await runCli(['node', 'caes-app', 'init', target, '--local-only', '--json', ...args], {
      stdout: (text) => { stdout += text; }, stderr: (text) => { stderr += text; },
    }, { git, interactive: false, ...deps });
    return { target, stdout, stderr, code, payload: JSON.parse(stdout) };
  }

  async function invokeHuman(args: string[] = [], deps: Partial<InitDependencies> = {}, destination?: string, rootArgs: string[] = []) {
    const target = destination ?? join(directory, `demo-${++sequence}`);
    let stdout = ''; let stderr = '';
    const code = await runCli(['node', 'caes-app', ...rootArgs, 'init', target, '--local-only', ...args], {
      stdout: (text) => { stdout += text; }, stderr: (text) => { stderr += text; },
    }, { git, interactive: false, ...deps });
    return { target, stdout, stderr, code };
  }

  const devcontainerFile = '.devcontainer/devcontainer.json';

  it.each([
    { generation: 'current', custom: false }, { generation: 'current', custom: true },
    { generation: 'legacy', custom: false }, { generation: 'legacy', custom: true },
  ])('initializes and resumes $generation devcontainers (custom ports=$custom)', async ({ generation, custom }) => {
    const deps: Partial<InitDependencies> = { fetchTemplate: async (source) => {
      const snapshot = await fetchTemplate(git, source);
      if (generation === 'legacy') snapshot.files.set(devcontainerFile, { content: legacyContainer, mode: 0o644 });
      return snapshot;
    } };
    const ports = custom ? config.ports : templatePorts;
    const args = ['--yes', '--no-git', ...(custom ? ['--server-port', '6165', '--client-port', '6173', '--database-port', '15333'] : [])];
    const first = await invoke(args, deps);
    expect(first.code, first.stdout).toBe(0);
    const path = join(first.target, devcontainerFile);
    const bytes = await readFile(path);
    const container = JSON.parse(bytes.toString());
    expect(container.forwardPorts).toEqual(generation === 'legacy' ? [ports.server] : [ports.server, ports.client]);
    expect(container.portsAttributes[ports.client]).toEqual({
      label: generation === 'legacy' ? `Vite Dev Server (Internal - Use ${ports.server})` : 'Web App (Vite)',
      onAutoForward: 'openBrowser',
    });
    expect(Object.keys(container.portsAttributes).sort()).toEqual(Object.values(ports).map(String).sort());
    const again = await invoke(['--yes', '--no-git'], deps, first.target);
    expect(again.code, again.stdout).toBe(0);
    expect(again.payload.steps.every((item: any) => item.state === 'skipped')).toBe(true);
    expect(await readFile(path)).toEqual(bytes);
  });

  it.each([
    { scenario: 'missing entry', file: devcontainerFile, setting: 'portsAttributes.5173' },
    { scenario: 'inconsistent URL', file: devcontainerFile, setting: 'containerEnv.ASPNETCORE_URLS' },
    { scenario: 'invalid JSON', file: devcontainerFile, setting: 'JSON object' },
    { scenario: 'invalid source port', file: 'client/vite.config.ts', setting: 'server.port' },
    { scenario: 'duplicate source ports', file: 'client/vite.config.ts', setting: 'server.port' },
    { scenario: 'inline duplicate port', file: 'client/vite.config.ts', setting: 'server.port' },
    { scenario: 'port expression', file: 'client/vite.config.ts', setting: 'server.port' },
    { scenario: 'multiline port expression', file: 'client/vite.config.ts', setting: 'server.port' },
  ])('reports template errors before any writes: $scenario', async ({ scenario, file, setting }) => {
    const deps: Partial<InitDependencies> = { fetchTemplate: async (source) => {
      const snapshot = await fetchTemplate(git, source);
      const original = snapshot.files.get(file)!;
      let content: string;
      if (scenario === 'invalid source port') content = original.content.toString().replace('port: 5173', 'port: 65536');
      else if (scenario === 'duplicate source ports') content = original.content.toString().replace('port: 5173', 'port: 5165');
      else if (scenario === 'inline duplicate port') content = original.content.toString().replace('port: 5173', 'port: 5173,\n    host: true, port: 9999');
      else if (scenario === 'port expression') content = original.content.toString().replace('port: 5173', 'port: 5173 + 1');
      else if (scenario === 'multiline port expression') content = original.content.toString().replace('port: 5173', 'port: 5173 // continued\n      + 1');
      else if (scenario === 'invalid JSON') content = '{"sentinel-secret":';
      else {
        const value = JSON.parse(original.content.toString());
        if (scenario === 'missing entry') delete value.portsAttributes['5173'];
        else value.containerEnv.ASPNETCORE_URLS = 'http://sentinel-secret:9999';
        content = JSON.stringify(value);
      }
      snapshot.files.set(file, { ...original, content: Buffer.from(content) });
      return snapshot;
    } };
    const result = await invoke(['--yes', '--no-git'], deps);
    expect(result.code).toBe(2);
    expect(result.payload.error).toMatchObject({ code: 'template-error', message: expect.stringContaining(setting) });
    expect(result.payload.preview).toMatchObject({ hasConflicts: false, exitCode: 2 });
    expect(result.payload.preview.steps.filter((item: any) => item.state === 'failed')).toEqual([
      expect.objectContaining({ id: file, target: join(result.target, file), state: 'failed' }),
    ]);
    expect(result.stdout).not.toMatch(/sentinel-secret|Restore the template/);
    await expect(stat(result.target)).rejects.toMatchObject({ code: 'ENOENT' });
    for (const verbose of [false, true]) {
      const human = await invokeHuman(['--yes', '--no-git', ...(verbose ? ['--verbose'] : [])], deps);
      expect(human.code).toBe(2);
      expect(human.stdout).toContain(verbose ? '[failed] file-write' : '[!] Failed:');
      expect(human.stdout + human.stderr).toContain(setting);
      expect(human.stdout + human.stderr).not.toMatch(/sentinel-secret|Restore the template/);
      await expect(stat(human.target)).rejects.toMatchObject({ code: 'ENOENT' });
    }
    // A resumed target must not receive planned repairs before the failure.
    const first = await invoke(['--yes', '--no-git']);
    const manifest = await readFile(join(first.target, '.caes-app.json'));
    const container = await readFile(join(first.target, devcontainerFile));
    await rm(join(first.target, 'app.sln'));
    const resumed = await invoke(['--yes', '--no-git'], deps, first.target);
    expect(resumed.payload.error.code).toBe('template-error');
    expect(await readFile(join(first.target, '.caes-app.json'))).toEqual(manifest);
    expect(await readFile(join(first.target, devcontainerFile))).toEqual(container);
    await expect(stat(join(first.target, 'app.sln'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps local devcontainer edits as conflicts with setting-specific diagnostics', async () => {
    const first = await invoke(['--yes', '--no-git']);
    const path = join(first.target, devcontainerFile);
    const current = JSON.parse(await readFile(path, 'utf8'));
    current.portsAttributes['5173'].label = 'sentinel-private-label';
    const bytes = JSON.stringify(current);
    await writeFile(path, bytes);
    const result = await invoke(['--yes', '--no-git'], {}, first.target);
    expect(result.payload.error.code).toBe('conflict');
    expect(result.payload.preview.steps.find((item: any) => item.id === devcontainerFile)).toMatchObject({
      state: 'conflict', preview: { message: expect.stringContaining('portsAttributes.5173.label') },
    });
    expect(result.stdout).not.toContain('sentinel-private-label');
    expect(await readFile(path, 'utf8')).toBe(bytes);
    const human = await invokeHuman(['--yes', '--no-git'], {}, first.target);
    expect(human.code).toBe(2);
    expect(human.stdout).toContain('[!] Conflict:');
    expect(human.stdout).toContain('portsAttributes.5173.label');
    expect(await readFile(path, 'utf8')).toBe(bytes);
  });

  it.each(['compact', 'root-verbose', 'init-verbose'])('renders a human dry run with %s options', async (mode) => {
    const result = await invokeHuman(['--dry-run', '--no-git', '--manifest', 'metadata/app.json',
      ...(mode === 'init-verbose' ? ['--verbose'] : [])], {}, undefined, mode === 'root-verbose' ? ['--verbose'] : []);
    expect(result.code, result.stderr).toBe(0);
    if (mode === 'compact') {
      expect(result.stdout).toContain(`Target: ${result.target}`);
      expect(result.stdout).toContain('|-- metadata/');
      expect(result.stdout).toContain('[A] App settings and template revision');
      expect(result.stdout).toContain('Template files:');
      expect(result.stdout).toContain('Git: Skip initialization (--no-git)');
      expect(result.stdout).not.toContain('  preview:');
    } else {
      expect(result.stdout).toContain('  preview:');
      expect(result.stdout).toContain('  confirmation:');
    }
    expect(result.stdout).not.toContain('LocalDev123!');
    await expect(stat(result.target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves JSON unchanged with --verbose', async () => {
    const first = await invoke();
    const verbose = await invoke(['--verbose'], {}, first.target);
    expect(verbose.code).toBe(first.code);
    expect(verbose.stdout).toBe(first.stdout);
  });

  it.each([false, true])('renders the preview before interactive confirmation (verbose=%s)', async (verbose) => {
    let confirmations = 0;
    const result = await invokeHuman(verbose ? ['--verbose'] : [], {
      interactive: true, input: async (_message, fallback) => fallback ?? '',
      confirm: async (message) => { expect(message).toBe('Apply all listed local changes?'); confirmations++; return false; },
    });
    expect(result.code).toBe(0);
    expect(confirmations).toBe(1);
    expect(result.stdout).toContain(verbose ? '  preview:' : 'File changes:');
    expect(result.stdout).toContain('Initialization cancelled');
    await expect(stat(result.target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([false, true])('renders preflight conflicts in the selected mode (verbose=%s)', async (verbose) => {
    const result = await invokeHuman(['--dry-run', ...(verbose ? ['--verbose'] : [])], {
      fetchTemplate: async (source) => {
        const template = await fetchTemplate(git, source);
        template.files.delete('server/.env.example');
        return template;
      },
    });
    expect(result.code).toBe(2);
    expect(result.stdout).toContain('missing server/.env.example');
    expect(result.stdout).toContain(verbose ? '[conflict] file-write' : '[!] Conflict:');
    if (!verbose) expect(result.stdout).toContain(`Target: ${result.target}`);
    await expect(stat(result.target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([false, true])('renders partial application failures in the selected mode (verbose=%s)', async (verbose) => {
    const target = join(directory, `demo-${++sequence}`);
    const result = await invokeHuman(['--yes', ...(verbose ? ['--verbose'] : [])], {
      git: async (args, cwd, input) => args.includes('init') && cwd === target
        ? { exitCode: 1, stdout: 'private-git-output' } : git(args, cwd, input),
    }, target);
    expect(result.code).toBe(1);
    const failureOutput = result.stdout.split('Initialization failed;')[1]!;
    expect(failureOutput).toContain(verbose ? '[failed] command' : 'git.init: [!] Failed:');
    if (!verbose) {
      expect(failureOutput).toMatch(/Files: \d+ added; 0 modified/);
      expect(failureOutput).not.toContain('to copy');
      expect(failureOutput).toContain('Issues: 0 conflicts; 1 failures');
    }
    expect(result.stdout + result.stderr).not.toContain('private-git-output');
  });

  it.each([false, true])('keeps unrelated dotenv values private in human previews (verbose=%s)', async (verbose) => {
    const first = await invoke(['--yes', '--no-git']);
    const path = join(first.target, 'server/.env');
    const before = `${await readFile(path, 'utf8')}\nPRIVATE=unrelated-env-secret\n`;
    await writeFile(path, before);
    const result = await invokeHuman(['--dry-run', '--auth-client-id', clientId, ...(verbose ? ['--verbose'] : [])], {}, first.target);
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('unrelated-env-secret');
    expect(result.stdout).not.toContain('LocalDev123!');
    expect(result.stdout).toContain(verbose ? 'Auth__ClientId' : '[M] Auth client ID');
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  it('previews without writing and exposes provenance, never copied secrets', async () => {
    const result = await invoke(['--no-git']);
    expect(result.code).toBe(0);
    expect(result.payload.kind).toBe('preview');
    expect(result.stdout).toContain(fixture.sha);
    expect(result.stdout).not.toContain('LocalDev123!');
    expect(result.stdout).not.toContain('never-copy-this');
    expect(result.payload.steps.find((item: any) => item.id === 'server/.env')).toMatchObject({ state: 'created' });
    expect(result.payload.steps.filter((item: any) => ['.caes-app.json', 'package.json', 'git.init', 'manual.auth'].includes(item.id))
      .map((item: any) => [item.id, item.state])).toMatchInlineSnapshot(`
        [
          [
            ".caes-app.json",
            "created",
          ],
          [
            "package.json",
            "created",
          ],
          [
            "git.init",
            "skipped",
          ],
          [
            "manual.auth",
            "skipped",
          ],
        ]
      `);
    await expect(stat(result.target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(calls.some((args) => args[0] === 'fetch' && args.at(-1) === fixture.sha)).toBe(true);
  });

  it('dry-run wins over --yes', async () => {
    const result = await invoke(['--yes', '--dry-run']);
    expect(result.payload.kind).toBe('preview');
    await expect(stat(result.target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([true, false])('resumes CRLF with spaces, alternate metadata and portable step IDs (noGit=%s)', async (noGit) => {
    const target = join(directory, `demo with spaces ${++sequence}`);
    const args = ['--manifest', 'metadata/app.json', '--database-port', '15333', ...(noGit ? ['--no-git'] : [])];
    const preview = await invoke(args, {}, target);
    expect(preview.code, preview.stdout).toBe(0);
    expect(preview.payload.steps.find((item: any) => item.id === 'server/.env')).toMatchObject({
      state: 'created', target: join(target, 'server/.env'),
    });
    const first = await invoke([...args, '--yes'], {}, target);
    expect(first.code, first.stdout).toBe(0);
    const composePath = join(target, '.devcontainer/docker-compose.yml');
    const crlf = (await readFile(composePath, 'utf8')).replace(/\r?\n/g, '\r\n');
    await writeFile(composePath, crlf);
    const resumed = await invoke([...args, '--yes'], {}, target);
    expect(resumed.code, resumed.stdout).toBe(0);
    expect(resumed.payload.steps.every((item: any) => item.state === 'skipped')).toBe(true);
    expect(await readFile(composePath, 'utf8')).toBe(crlf);
    const conflictText = crlf.replace('15333:1433', '19999:1433');
    await writeFile(composePath, conflictText);
    const conflict = await invoke([...args, '--yes'], {}, target);
    expect(conflict.code).toBe(2);
    expect(conflict.payload.preview.steps.find((item: any) => item.id === '.devcontainer/docker-compose.yml')).toMatchObject({
      state: 'conflict', target: composePath,
    });
    expect(await readFile(composePath, 'utf8')).toBe(conflictText);
    for (const steps of [preview.payload.steps, first.payload.steps, resumed.payload.steps, conflict.payload.preview.steps]) {
      expect(steps.every((item: any) => !item.id.includes('\\'))).toBe(true);
    }
  });

  it.each(['Package.json', 'server/.ENV', 'SERVER', '.DevContainer', 'PACKAGE.JSON/metadata.json', 'SERVER/.ENV/metadata.json', 'metadata/../Package.json'])(
    'rejects portable manifest collision %s before creating any files', async (manifest) => {
      for (const applyArgs of [[], ['--yes']]) {
        const target = join(directory, `collision-${++sequence}`);
        await mkdir(target);
        const result = await invoke(['--manifest', manifest, ...applyArgs], {}, target);
        expect(result.code, result.stdout).toBe(2);
        expect(result.payload.error.code).toBe('conflict');
        expect(result.payload.preview.hasConflicts).toBe(true);
        expect(await readdir(target)).toEqual([]);
      }
    },
  );

  it('applies foundation edits and optional auth without Git, preserving binaries and mode', async () => {
    const result = await invoke(['--yes', '--no-git', '--app-id', 'demo-app', '--display-name', 'Demo App', '--server-port', '6165', '--client-port', '6173', '--database-port', '15333', '--auth-client-id', clientId]);
    expect(result.code, result.stdout).toBe(0);
    expect(result.payload).toMatchObject({ status: 'success', scaffoldingCompleted: true, runtimeReadiness: 'unverified' });
    const json = async (name: string) => JSON.parse(await readFile(join(result.target, name), 'utf8'));
    const root = await json('package.json');
    expect(root.name).toBe('demo-app');
    expect(root.scripts['db:up']).toContain('-p demo-app_devcontainer');
    expect(root.scripts['start:client:debug']).toContain(':6165/health');
    expect((await json('client/package.json')).name).toBe('demo-app-client');
    expect((await json('client/package-lock.json')).packages[''].name).toBe('demo-app-client');
    expect((await json('package-lock.json')).packages[''].name).toBe('demo-app');
    const launch = await json('server/Properties/launchSettings.json');
    expect(launch.profiles.http.applicationUrl).toBe('http://0.0.0.0:6165');
    expect(launch.profiles['http-cli'].applicationUrl).toBe('http://0.0.0.0:6165');
    expect(launch.iisSettings.iisExpress.sslPort).toBe(44322);
    const dev = await json('server/appsettings.Development.json');
    expect(dev.Notification).toMatchObject({ BaseUrl: 'http://localhost:6173', DefaultAppName: 'Demo App' });
    expect(dev.ConnectionStrings.DefaultConnection).toContain('localhost,15333;');
    expect((await json('server/appsettings.json')).Auth.ClientId).toBe('<client-guid>');
    const container = await json('.devcontainer/devcontainer.json');
    expect(container.forwardPorts).toEqual([6165, 6173]);
    expect(Object.keys(container.portsAttributes).sort()).toEqual(['15333', '6165', '6173']);
    expect(container.containerEnv.DB_CONNECTION).toContain('sql,1433');
    const env = await readFile(join(result.target, 'server/.env'), 'utf8');
    expect(env).toContain(`Auth__ClientId=${clientId}\n`);
    expect(env).toContain('OTEL_SERVICE_NAME="demo-app"');
    expect(env).toContain('service.namespace=demo-app');
    expect(env).toContain(`DB_CONNECTION="${dev.ConnectionStrings.DefaultConnection}"`);
    expect(env).toContain('Notification__BaseUrl="http://localhost:6173"');
    expect(env).toContain('Notification__DefaultAppName="Demo App"');
    expect(env).toContain('Smtp__FromName="Demo App"');
    expect(env).toContain('Smtp__Password="<smtp_password>"');
    if (process.platform !== 'win32') expect((await stat(join(result.target, 'server/.env'))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(result.target, 'asset.bin'))).toEqual(Buffer.from([0, 1, 255, 13, 10, 128]));
    if (process.platform !== 'win32') expect((await stat(join(result.target, 'scripts/example.sh'))).mode & 0o111).not.toBe(0);
    for (const path of ['.git', 'node_modules', 'publish', 'server/bin']) await expect(stat(join(result.target, path))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.stringify(await json('.caes-app.json'))).not.toContain(clientId);
    for (const url of [':6173/signin-oidc', ':6165/signin-oidc', ':44322/signin-oidc']) expect(result.stdout).toContain(url);
    expect(result.stdout).not.toContain('LocalDev123!');
  });

  it('initializes an empty Git repository on main without staging or a remote', async () => {
    const result = await invoke(['--yes']);
    expect(result.code, result.stdout).toBe(0);
    expect((await git(['symbolic-ref', '--short', 'HEAD'], result.target)).stdout.trim()).toBe('main');
    expect((await git(['ls-files'], result.target)).stdout).toBe('');
    expect((await git(['remote'], result.target)).stdout).toBe('');
    await expect(stat(join(result.target, '.git/index'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(result.target, 'server/.env'), 'utf8')).toContain('Auth__ClientId="<client-guid>"');
    expect((await git(['check-ignore', '--quiet', 'server/.env'], result.target)).exitCode).toBe(0);
    const again = await invoke(['--yes'], {}, result.target);
    expect(again.code, again.stdout).toBe(0);
    expect(again.payload.steps.every((item: any) => item.state === 'skipped')).toBe(true);
  });

  it('resumes the recorded SHA, repairs missing files, and preserves unknown metadata and unrelated edits', async () => {
    const first = await invoke(['--yes', '--no-git', '--manifest', 'metadata/app.json']);
    const manifestPath = join(first.target, 'metadata/app.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.extra = { keep: true };
    manifest.ports.extraMetadata = 'preserved';
    await writeFile(manifestPath, JSON.stringify(manifest));
    const packagePath = join(first.target, 'package.json');
    const pkg = JSON.parse(await readFile(packagePath, 'utf8')); pkg.scripts.custom = 'keep me';
    await writeFile(packagePath, JSON.stringify(pkg));
    await rm(join(first.target, 'asset.bin'));
    const callCount = calls.length;
    const again = await invoke(['--yes', '--no-git', '--manifest', 'metadata/app.json'], {}, first.target);
    expect(again.code, again.stdout).toBe(0);
    expect(calls.slice(callCount).some((args) => args[0] === 'ls-remote')).toBe(false);
    expect(JSON.parse(await readFile(manifestPath, 'utf8')).extra).toEqual({ keep: true });
    expect(JSON.parse(await readFile(manifestPath, 'utf8')).ports.extraMetadata).toBe('preserved');
    expect(JSON.parse(await readFile(packagePath, 'utf8')).scripts.custom).toBe('keep me');
    expect((await stat(join(first.target, 'asset.bin'))).size).toBe(6);
  });

  it.each(['template', 'configured'])('resumes configured ports with developer edits at %s keys', async (state) => {
    const first = await invoke(['--yes', '--no-git', '--server-port', '6165', '--client-port', '6173', '--database-port', '15333']);
    expect(first.code, first.stdout).toBe(0);
    const path = join(first.target, '.devcontainer/devcontainer.json');
    const current = JSON.parse(await readFile(path, 'utf8'));
    if (state === 'template') current.portsAttributes = JSON.parse(fixtureFiles['.devcontainer/devcontainer.json']!).portsAttributes;
    const server = state === 'template' ? '5165' : '6165';
    const client = state === 'template' ? '5173' : '6173';
    const database = state === 'template' ? '14333' : '15333';
    current.portsAttributes[server].protocol = 'https';
    current.portsAttributes[client].onAutoForward = 'silent';
    delete current.portsAttributes[database].onAutoForward;
    await writeFile(path, JSON.stringify(current));

    const resumed = await invoke(['--yes', '--no-git'], {}, first.target);
    expect(resumed.code, resumed.stdout).toBe(0);
    const result = JSON.parse(await readFile(path, 'utf8'));
    expect(Object.keys(result.portsAttributes).sort()).toEqual(['15333', '6165', '6173']);
    expect(result.portsAttributes['6165'].protocol).toBe('https');
    expect(result.portsAttributes['6173']).toEqual({ label: 'Web App (Vite)', onAutoForward: 'silent' });
    expect(result.portsAttributes['15333']).toEqual({ label: 'SQL Server (Internal)' });
    const again = await invoke(['--yes', '--no-git'], {}, first.target);
    expect(again.code, again.stdout).toBe(0);
    expect(again.payload.steps.find((item: any) => item.id === '.devcontainer/devcontainer.json').state).toBe('skipped');
  });

  it('blocks unrelated targets, reconfiguration, and divergent managed values', async () => {
    const target = join(directory, `demo-${++sequence}`); await mkdir(target); await writeFile(join(target, 'keep.txt'), 'keep');
    expect((await invoke(['--yes'], {}, target)).code).toBe(2);
    expect(await readdir(target)).toEqual(['keep.txt']);
    const first = await invoke(['--yes', '--no-git']);
    expect((await invoke(['--yes', '--server-port', '6555'], {}, first.target)).code).toBe(2);
    const pkgPath = join(first.target, 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')); pkg.name = 'manual-name';
    await writeFile(pkgPath, JSON.stringify(pkg));
    const conflictResult = await invoke(['--yes'], {}, first.target);
    expect(conflictResult.code).toBe(2);
    expect(conflictResult.payload.preview.hasConflicts).toBe(true);
    expect(JSON.parse(await readFile(pkgPath, 'utf8')).name).toBe('manual-name');
  });

  it('rejects a manually changed port even when initialization used template defaults', async () => {
    const first = await invoke(['--yes', '--no-git']);
    const path = join(first.target, 'server/Properties/launchSettings.json');
    const launch = JSON.parse(await readFile(path, 'utf8'));
    launch.profiles.http.applicationUrl = 'http://localhost:9999';
    await writeFile(path, JSON.stringify(launch));
    const result = await invoke(['--yes', '--no-git'], {}, first.target);
    expect(result.code).toBe(2);
    expect(result.payload.preview.steps.find((item: any) => item.id === 'server/Properties/launchSettings.json').state).toBe('conflict');
  });

  it('preserves local connection credentials and completes original-template managed values', async () => {
    const first = await invoke(['--yes', '--no-git', '--database-port', '15333']);
    const path = join(first.target, 'server/appsettings.Development.json');
    const settings = JSON.parse(await readFile(path, 'utf8'));
    settings.ConnectionStrings.DefaultConnection = settings.ConnectionStrings.DefaultConnection
      .replace('LocalDev123!', 'sentinel-private-password').replace('15333', '14333');
    await writeFile(path, JSON.stringify(settings));
    const resumed = await invoke(['--yes', '--no-git'], {}, first.target);
    expect(resumed.code, resumed.stdout).toBe(0);
    expect(resumed.stdout).not.toContain('sentinel-private-password');
    const updated = JSON.parse(await readFile(path, 'utf8'));
    expect(updated.ConnectionStrings.DefaultConnection).toContain('localhost,15333;');
    expect(updated.ConnectionStrings.DefaultConnection).toContain('sentinel-private-password');
    const again = await invoke(['--yes', '--no-git'], {}, first.target);
    expect(again.code).toBe(0);
    expect(again.payload.steps.every((item: any) => item.state === 'skipped')).toBe(true);
  });

  it('keeps dotenv secret values out of conflict output and checks ignore coverage', async () => {
    const first = await invoke(['--yes', '--no-git']);
    const path = join(first.target, 'server/.env');
    await writeFile(path, 'PASSWORD=sentinel-secret\nAuth__ClientId=a\nAuth__ClientId=b\n');
    const duplicate = await invoke(['--yes', '--auth-client-id', clientId], {}, first.target);
    expect(duplicate.code).toBe(2);
    expect(duplicate.stdout).not.toContain('sentinel-secret');
    await writeFile(path, 'PASSWORD=sentinel-secret\n');
    await writeFile(join(first.target, '.gitignore'), '');
    expect((await invoke(['--yes', '--auth-client-id', clientId], {}, first.target)).code).toBe(2);
    expect(await readFile(path, 'utf8')).toBe('PASSWORD=sentinel-secret\n');
  });

  it.for([{ authArgs: [] }, { authArgs: ['--auth-client-id', clientId] }])('rejects symlink destinations without touching the referent ($authArgs)', async ({ authArgs }, context) => {
    const first = await invoke(['--yes', '--no-git']);
    const external = join(directory, 'outside.env'); await writeFile(external, 'outside');
    await rm(join(first.target, 'server/.env'));
    if (!await createTestSymlink(external, join(first.target, 'server/.env'))) {
      context.skip('Windows file symlinks require Developer Mode or symbolic-link privileges.');
    }
    const result = await invoke(['--yes', ...authArgs], {}, first.target);
    expect(result.code).toBe(2);
    expect(await readFile(external, 'utf8')).toBe('outside');
  });

  it('preserves omitted auth, and previews/applies only an explicitly supplied auth update', async () => {
    const first = await invoke(['--yes', '--auth-client-id', clientId]);
    expect(first.code, first.stdout).toBe(0);
    const envPath = join(first.target, 'server/.env');
    const contents = `# comment\r\nPASSWORD=sentinel-secret\r\nAuth__ClientId=${clientId}\r\n`;
    await writeFile(envPath, contents);
    const omitted = await invoke(['--yes'], {}, first.target);
    expect(omitted.code).toBe(0);
    expect(await readFile(envPath, 'utf8')).toBe(contents);
    const replacement = '87654321-1234-1234-1234-123456789abc';
    const preview = await invoke(['--auth-client-id', replacement], {}, first.target);
    expect(preview.code).toBe(0);
    expect(preview.payload.steps.find((item: any) => item.id === 'server/.env')).toMatchObject({ state: 'updated' });
    expect(preview.stdout).not.toContain('sentinel-secret');
    expect(await readFile(envPath, 'utf8')).toBe(contents);
    const applied = await invoke(['--yes', '--auth-client-id', replacement], {}, first.target);
    expect(applied.code).toBe(0);
    expect(await readFile(envPath, 'utf8')).toBe(contents.replace(clientId, replacement));
  });

  it('preserves existing dotenv bytes without backfilling absent assignments', async () => {
    const first = await invoke(['--yes', '--no-git']);
    const path = join(first.target, 'server/.env');
    // Even an empty file is an existing local configuration, not a request to regenerate.
    for (const contents of [Buffer.alloc(0), Buffer.from('# local\r\nPASSWORD=sentinel-secret\r\n'), Buffer.from([0xff, 0x0a])]) {
      await writeFile(path, contents);
      const resumed = await invoke(['--yes', '--no-git'], {}, first.target);
      expect(resumed.code, resumed.stdout).toBe(0);
      expect(resumed.payload.steps.find((item: any) => item.id === 'server/.env').state).toBe('skipped');
      expect(await readFile(path)).toEqual(contents);
      expect(resumed.stdout).not.toContain('sentinel-secret');
    }
  });

  it('recreates a deleted dotenv from the pinned example and customized development connection', async () => {
    const first = await invoke(['--yes', '--no-git', '--database-port', '15333']);
    const path = join(first.target, 'server/.env');
    await rm(path);
    // Local edits to the copied example must not become the source for new secrets files.
    await writeFile(join(first.target, 'server/.env.example'), 'PRIVATE_LOCAL_EXAMPLE=never-copy-this\n');
    const devPath = join(first.target, 'server/appsettings.Development.json');
    const dev = JSON.parse(await readFile(devPath, 'utf8'));
    dev.ConnectionStrings.DefaultConnection = dev.ConnectionStrings.DefaultConnection.replace('LocalDev123!', 'sentinel-private-password');
    await writeFile(devPath, JSON.stringify(dev));
    const resumed = await invoke(['--yes', '--no-git'], {}, first.target);
    expect(resumed.code, resumed.stdout).toBe(0);
    const env = await readFile(path, 'utf8');
    expect(env).toContain('Auth__ClientId="<client-guid>"');
    expect(env).toContain(`DB_CONNECTION="${dev.ConnectionStrings.DefaultConnection}"`);
    expect(env).not.toContain('PRIVATE_LOCAL_EXAMPLE');
    expect(resumed.stdout).not.toContain('sentinel-private-password');
    expect(resumed.stdout).not.toContain('never-copy-this');
  });

  it('requires an example only when creating dotenv and fails before any writes', async () => {
    const withoutExample: Partial<InitDependencies> = { fetchTemplate: async (source) => {
      const template = await fetchTemplate(git, source);
      template.files.delete('server/.env.example');
      return template;
    } };
    const absent = await invoke(['--yes', '--no-git'], withoutExample);
    expect(absent.code).toBe(2);
    expect(absent.stdout).toContain('missing server/.env.example');
    await expect(stat(absent.target)).rejects.toMatchObject({ code: 'ENOENT' });
    const first = await invoke(['--yes', '--no-git']);
    expect((await invoke(['--yes', '--no-git'], withoutExample, first.target)).code).toBe(0);
    await rm(join(first.target, 'server/.env'));
    const missing = await invoke(['--yes', '--no-git'], withoutExample, first.target);
    expect(missing.code).toBe(2);
    await expect(stat(join(first.target, 'server/.env'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('blocks missing ignore coverage without an auth input', async () => {
    const first = await invoke(['--yes', '--no-git']);
    const path = join(first.target, 'server/.env');
    const before = await readFile(path);
    await writeFile(join(first.target, '.gitignore'), '');
    const result = await invoke(['--yes', '--no-git'], {}, first.target);
    expect(result.code).toBe(2);
    expect(result.stdout).toContain('must be ignored');
    expect(await readFile(path)).toEqual(before);
  });

  it('detects dotenv changes after preview even without an auth input', async () => {
    const first = await invoke(['--yes', '--no-git']);
    let output = '';
    const code = await runCli(['node', 'caes-app', 'init', first.target, '--local-only', '--no-git'], {
      stdout: (text) => { output += text; }, stderr: (text) => { output += text; },
    }, { git, interactive: true, input: async () => '', confirm: async () => {
      await writeFile(join(first.target, 'server/.env'), 'PRIVATE=changed-during-preview\n');
      return true;
    } });
    expect(code).toBe(2);
    expect(output).toContain('File changed after preview');
    expect(output).not.toContain('changed-during-preview');
    expect(await readFile(join(first.target, 'server/.env'), 'utf8')).toBe('PRIVATE=changed-during-preview\n');
  });

  it.each([{ authArgs: [] }, { authArgs: ['--auth-client-id', clientId] }])('blocks tracked dotenv destinations without changing the index ($authArgs)', async ({ authArgs }) => {
    const first = await invoke(['--yes']);
    await writeFile(join(first.target, 'server/.env'), 'PASSWORD=sentinel-secret\n');
    // Simulate Git reporting a tracked local override; no test needs to stage it.
    const result = await invoke(['--yes', ...authArgs], { git: async (args, cwd, input) =>
      args[0] === 'ls-files' && args.includes('--error-unmatch') ? { exitCode: 0, stdout: 'server/.env' } : git(args, cwd, input),
    }, first.target);
    expect(result.code).toBe(2);
    expect(result.stdout).toContain('tracked by Git');
    expect(result.stdout).not.toContain('sentinel-secret');
    await expect(stat(join(first.target, '.git/index'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('restores missing ignore coverage before applying a supplied auth ID on resume', async () => {
    const first = await invoke(['--yes']);
    await rm(join(first.target, '.gitignore'));
    const resumed = await invoke(['--yes', '--auth-client-id', clientId], {}, first.target);
    expect(resumed.code, resumed.stdout).toBe(0);
    expect(await readFile(join(first.target, 'server/.env'), 'utf8')).toContain(`Auth__ClientId=${clientId}\n`);
    expect((await git(['check-ignore', '--quiet', 'server/.env'], first.target)).exitCode).toBe(0);
  });

  it('rejects future manifests and collisions before applying', async () => {
    const first = await invoke(['--yes', '--no-git']);
    const path = join(first.target, '.caes-app.json');
    const manifest = JSON.parse(await readFile(path, 'utf8')); manifest.schemaVersion = 999;
    await writeFile(path, JSON.stringify(manifest));
    const future = await invoke(['--yes'], {}, first.target);
    expect(future.code).toBe(2);
    expect(future.payload.error.code).toBe('future-manifest-schema');
    for (const path of ['package.json', 'package.json/manifest.json', 'server/.env', '.devcontainer']) {
      const result = await invoke(['--yes', '--manifest', path]);
      expect(result.code).toBe(2);
      await expect(stat(result.target)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('uses the empty target exactly and supports flags before init', async () => {
    const target = join(directory, `demo-${++sequence}`); await mkdir(target);
    let output = '';
    const code = await runCli(['node', 'caes-app', '--json', '--yes', '--local-only', '--no-git', '--manifest', 'state/project.json', 'init', target],
      { stdout: (text) => { output += text; }, stderr: () => {} }, { git, interactive: false });
    expect(code, output).toBe(0);
    expect(JSON.parse(await readFile(join(target, 'state/project.json'), 'utf8')).appId).toBe(basename(target));
    await expect(stat(join(target, '.git'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not prompt or apply a human noninteractive invocation without consent', async () => {
    const target = join(directory, `demo-${++sequence}`);
    let stdout = ''; let stderr = '';
    const code = await runCli(['node', 'caes-app', 'init', target, '--local-only'],
      { stdout: (text) => { stdout += text; }, stderr: (text) => { stderr += text; } },
      { git, interactive: false, input: async () => { throw new Error('should not prompt'); } });
    expect(code).toBe(2);
    expect(stderr).toContain('--yes');
    expect(stdout).not.toContain('LocalDev123!');
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rechecks files after confirmation and handles declined confirmation', async () => {
    const first = await invoke(['--yes', '--no-git']);
    let stdout = '';
    const code = await runCli(['node', 'caes-app', 'init', first.target, '--local-only', '--no-git'], { stdout: (text) => { stdout += text; }, stderr: () => {} }, {
      git, interactive: true, input: async () => '', confirm: async () => {
        await writeFile(join(first.target, 'package.json'), '{}'); return true;
      },
    });
    expect(code).toBe(2);
    expect(stdout).toContain('changed after preview');
    let cancelled = '';
    const target = join(directory, 'cancelled');
    const cancelCode = await runCli(['node', 'caes-app', 'init', target, '--local-only'], { stdout: (text) => { cancelled += text; }, stderr: () => {} }, {
      git, interactive: true, input: async (_message, fallback) => fallback ?? '', confirm: async () => false,
    });
    expect(cancelCode).toBe(0); expect(cancelled).toContain('cancelled');
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports a partial Git failure and resumes without recopying completed files', async () => {
    let failTarget = '';
    const result = await invoke(['--yes'], { git: async (args, cwd, input) => {
      if (args.includes('init') && cwd?.startsWith(join(directory, 'demo-'))) { failTarget = cwd; return { exitCode: 1, stdout: 'sensitive-error' }; }
      return git(args, cwd, input);
    } });
    expect(result.code).toBe(1);
    expect(result.payload).toMatchObject({ status: 'failure', scaffoldingCompleted: false });
    expect(result.payload.steps.find((item: any) => item.id === 'git.init').state).toBe('failed');
    expect(result.stdout).not.toContain('sensitive-error');
    const resumed = await invoke(['--yes'], {}, failTarget);
    expect(resumed.code, resumed.stdout).toBe(0);
  });

  it('excludes ignored/generated files during retrieval and cleans its temporary directory', async () => {
    const snapshot = await fetchTemplate(git);
    expect(snapshot.source.resolvedCommitSha).toBe(fixture.sha);
    expect(snapshot.files.has('server/.env')).toBe(false);
    expect(snapshot.files.has('server/.env.example')).toBe(true);
    expect(snapshot.files.has('node_modules/ignored.js')).toBe(false);
    await snapshot.cleanup();
  });

  it.each(['fetch', 'sha', 'symlink', 'submodule', 'missing-file'])('cleans failed template retrieval (%s)', async (failure) => {
    let temp = '';
    const failingGit: GitRunner = async (args, cwd, input) => {
      if (args.includes('init')) temp = cwd!;
      if (failure === 'fetch' && args[0] === 'fetch') return { stdout: 'do-not-disclose', exitCode: 1 };
      const result = await git(args, cwd, input);
      if (failure === 'sha' && args[0] === 'rev-parse') return { stdout: 'f'.repeat(40), exitCode: 0 };
      if (args[0] === 'ls-tree') {
        if (failure === 'symlink') return { stdout: `120000 blob ${'a'.repeat(40)}\tunsafe\0`, exitCode: 0 };
        if (failure === 'submodule') return { stdout: `160000 commit ${'a'.repeat(40)}\tunsafe\0`, exitCode: 0 };
        if (failure === 'missing-file') return { ...result, stdout: result.stdout.split('\0').filter((entry) => !entry.endsWith('\tapp.sln')).join('\0') };
      }
      return result;
    };
    await expect(fetchTemplate(failingGit)).rejects.toThrow();
    expect(temp).not.toBe('');
    await expect(stat(temp)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains the resolved commit when remote HEAD moves before the fetch', async () => {
    let lookedUp = false;
    const movingGit: GitRunner = async (args, cwd, input) => {
      if (args[0] === 'ls-remote') {
        lookedUp = true;
        return { stdout: `ref: refs/heads/previous-default\tHEAD\n${fixture.sha}\tHEAD\n`, exitCode: 0 };
      }
      if (args[0] === 'fetch') expect(args.at(-1)).toBe(fixture.sha);
      return git(args, cwd, input);
    };
    const snapshot = await fetchTemplate(movingGit);
    try {
      expect(lookedUp).toBe(true);
      expect(snapshot.source).toMatchObject({ defaultBranch: 'previous-default', resolvedCommitSha: fixture.sha });
    } finally { await snapshot.cleanup(); }
  });

  it('rejects incompatible source patch locations without disclosing config', async () => {
    expect(() => customizeFile('server/server.csproj', Buffer.from('<Project/>'), Buffer.from('<Project/>'), config, templatePorts)).toThrow();
    const secretJson = Buffer.from('{"ConnectionStrings":{"DefaultConnection":"sentinel-secret"},broken}');
    expect(() => customizeFile('server/appsettings.Development.json', secretJson, secretJson, config, templatePorts)).toThrow(/invalid JSON/);
    try { customizeFile('server/appsettings.Development.json', secretJson, secretJson, config, templatePorts); } catch (error) { expect(String(error)).not.toContain('sentinel-secret'); }
  });
});
