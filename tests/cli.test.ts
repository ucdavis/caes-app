import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CLI_VERSION } from '../src/constants.js';
import { createProgram, runCli } from '../src/cli.js';
import { createTestSymlink } from './symlink-support.js';

async function invoke(args: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await runCli(['node', 'caes-app', ...args], {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });

  return { code, stdout, stderr };
}

describe('cli', () => {
  it('prints root help', async () => {
    const result = await invoke(['--help']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: caes-app');
    expect(result.stdout).toContain('init [options] [target-dir]');
  });

  it('prints version', async () => {
    const result = await invoke(['--version']);

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(CLI_VERSION);
  });

  it('prints init help', async () => {
    const result = await invoke(['init', '--help']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: caes-app init');
  });

  it.each([
    ['--json', 'init', '--unknown-option'],
    ['init', '--json', '--unknown-option'],
    ['init', '--unknown-option', '--json'],
    ['--json', 'init', '--server-port'],
    ['init', '--json', '--server-port'],
    ['init', '--server-port', '--json'],
    ['--json', 'init', 'one', 'two'],
    ['init', '--json', 'one', 'two'],
    ['--json', '--unknown-option'],
    ['--json', '--manifest'],
  ])('emits exactly one JSON parse error for %j', async (...args) => {
    const result = await invoke(args);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      kind: 'error', error: { code: 'invalid-options', message: expect.any(String) },
    });
    expect(JSON.parse(result.stdout).error.message).toMatch(/unknown option|argument missing|too many arguments/);
  });

  it('suppresses Commander output when JSON is parsed on the init command', async () => {
    let stderr = '';
    const program = createProgram({ stdout: () => {}, stderr: (text) => { stderr += text; } });
    program.enablePositionalOptions();
    await expect(program.parseAsync(['init', '--json', '--unknown-option'], { from: 'user' }))
      .rejects.toMatchObject({ code: 'commander.unknownOption', exitCode: 1 });
    expect(program.opts().json).toBeUndefined();
    expect(program.commands[0]!.opts().json).toBe(true);
    expect(stderr).toBe('');
  });

  describe.each([false, true])('parser argument redaction (JSON=%s)', (json) => {
    it.each(['--token', '--password', '--github-pat'])(
      'redacts inline values for %s', async (flag) => {
        const secret = 'EXAMPLE_SECRET with "quotes" = .*+$&';
        const result = await invoke(['init', ...(json ? ['--json'] : []), `${flag}=${secret}`]);
        expect(result.code).toBe(1);
        expect(result.stdout + result.stderr).not.toContain(secret);
        const message = `error: unknown option '${flag}=[REDACTED]'`;
        if (json) {
          expect(result.stderr).toBe('');
          expect(JSON.parse(result.stdout)).toEqual({
            kind: 'error', error: { code: 'invalid-options', message },
          });
        } else {
          expect(result.stdout).toBe('');
          expect(result.stderr).toContain(message);
          expect(result.stderr).toContain('Usage: caes-app init');
        }
      },
    );

    it('keeps separate sensitive values out of diagnostics', async () => {
      const result = await invoke([...(json ? ['--json'] : []), '--token', 'EXAMPLE_SECRET']);
      expect(result.code).toBe(1);
      expect(result.stdout + result.stderr).not.toContain('EXAMPLE_SECRET');
      if (json) {
        expect(result.stderr).toBe('');
        expect(JSON.parse(result.stdout)).toMatchObject({
          kind: 'error', error: { code: 'invalid-options', message: expect.stringContaining("unknown option '--token'") },
        });
      } else {
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain("unknown option '--token'");
        expect(result.stderr).toContain('Usage: caes-app');
      }
    });
  });

  it('redacts root diagnostics with JSON after the sensitive option', async () => {
    const result = await invoke(['--token=EXAMPLE_SECRET', '--json']);
    expect(result.code).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      kind: 'error', error: { code: 'invalid-options', message: "error: unknown option '--token=[REDACTED]'" },
    });
  });

  it('redacts direct program errors parsed from user arguments', async () => {
    let stderr = '';
    const program = createProgram({ stdout: () => {}, stderr: (text) => { stderr += text; } });
    await expect(program.parseAsync(['init', '--token=EXAMPLE_SECRET'], { from: 'user' }))
      .rejects.toMatchObject({ code: 'commander.unknownOption', exitCode: 1 });
    expect(stderr).toContain("unknown option '--token=[REDACTED]'");
    expect(stderr).not.toContain('EXAMPLE_SECRET');
  });

  it('leaves generated usage text unchanged when it contains a sensitive value', async () => {
    const help = await invoke(['init', '--help']);
    const result = await invoke(['init', '--token', 'app']);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(help.stdout);
  });

  it.each([
    ['init', '--unknown-option'],
    ['init', '--server-port'],
    ['init', 'one', 'two'],
    ['--manifest', '--json', 'init', '--unknown-option'],
    ['init', '--', '--json', 'extra'],
  ])('retains human parse errors for %j', async (...args) => {
    const result = await invoke(args);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('error:');
    expect(result.stderr).toContain('Usage:');
  });

  it.each([
    { args: ['--json', '--help'], output: 'Usage: caes-app' },
    { args: ['--json', 'init', '--help'], output: 'Usage: caes-app init' },
    { args: ['init', '--json', '--help'], output: 'Usage: caes-app init' },
    { args: ['--json', '--version'], output: CLI_VERSION },
  ])('preserves successful help/version output for $args', async ({ args, output }) => {
    const result = await invoke(args);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(output);
    expect(result.stdout).not.toContain('"kind": "error"');
  });

  it('rejects --no-git without --local-only', async () => {
    const result = await invoke(['--no-git', 'init', 'demo']);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--no-git is only valid with --local-only');
  });

  it('reserves GitHub repository creation for Phase 3', async () => {
    const result = await invoke(['--json', 'init', 'demo-app']);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      kind: 'error', error: { code: 'not-implemented' },
    });
    expect(result.stdout).toContain('Phase 3');
    expect(result.stderr).toBe('');
  });

});

describe('CLI entry point', () => {
  const cliUrl = new URL('../src/cli.ts', import.meta.url);
  const cliPath = fileURLToPath(cliUrl);
  const tsxLoader = import.meta.resolve('tsx');
  let directory: string;
  let linkPath: string;
  let symlinksAvailable: boolean;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'caes-app-entry-'));
    linkPath = join(directory, 'caes-app.ts');
    symlinksAvailable = await createTestSymlink(cliPath, linkPath);
  });

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  const entryCases = [
    { args: ['--version'], status: 0, stdout: `${CLI_VERSION}\n`, stderr: '' },
    { args: ['--help'], status: 0, stdout: 'Usage: caes-app', stderr: '' },
    { args: ['init', '--no-git'], status: 2, stdout: '', stderr: '--no-git is only valid with --local-only.' },
    { args: ['init', '--json'], status: 1, stdout: '"not-implemented"', stderr: '' },
  ];

  it.each(entryCases)('runs the direct entry point for $args', ({ args, status, stdout, stderr }) => {
    const direct = spawnSync(process.execPath, ['--import', tsxLoader, cliPath, ...args], { encoding: 'utf8' });
    expect(direct.error).toBeUndefined();
    expect(direct.status).toBe(status);
    expect(direct.stdout).toContain(stdout);
    expect(direct.stderr).toContain(stderr);
  });

  it.for(entryCases)('runs the symlink entry point for $args', ({ args }, context) => {
    if (!symlinksAvailable) context.skip('Windows file symlinks require Developer Mode or symbolic-link privileges.');
    const direct = spawnSync(process.execPath, ['--import', tsxLoader, cliPath, ...args], { encoding: 'utf8' });
    const linked = spawnSync(process.execPath, ['--import', tsxLoader, linkPath, ...args], { encoding: 'utf8' });
    expect(direct.error).toBeUndefined();
    expect(linked.error).toBeUndefined();
    expect({ status: linked.status, stdout: linked.stdout, stderr: linked.stderr }).toEqual({
      status: direct.status, stdout: direct.stdout, stderr: direct.stderr,
    });
  });

  it.each(['existing', 'missing', 'unresolvable'])('imports without executing with %s argv[1]', (mode) => {
    const argvSetup = mode === 'existing'
      ? `process.argv[1] = ${JSON.stringify(fileURLToPath(import.meta.url))};`
      : mode === 'missing'
        ? 'delete process.argv[1];'
        : `process.argv[1] = ${JSON.stringify(join(directory, 'does-not-exist'))};`;
    const result = spawnSync(process.execPath, [
      '--import', tsxLoader, '--input-type=module', '--eval',
      `${argvSetup} await import(${JSON.stringify(cliUrl.href)}); console.log('imported');`,
    ], { encoding: 'utf8' });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('imported\n');
    expect(result.stderr).toBe('');
  });
});
