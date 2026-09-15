import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CLI_VERSION } from '../src/constants.js';
import { runCli } from '../src/cli.js';

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

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'caes-app-entry-'));
    linkPath = join(directory, 'caes-app.ts');
    await symlink(cliPath, linkPath);
  });

  afterAll(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it.each([
    { args: ['--version'], status: 0, stdout: `${CLI_VERSION}\n`, stderr: '' },
    { args: ['--help'], status: 0, stdout: 'Usage: caes-app', stderr: '' },
    { args: ['init', '--no-git'], status: 2, stdout: '', stderr: '--no-git is only valid with --local-only.' },
    { args: ['init', '--json'], status: 1, stdout: '"not-implemented"', stderr: '' },
  ])('runs direct and symlink entry points for $args', ({ args, status, stdout, stderr }) => {
    const direct = spawnSync(process.execPath, ['--import', tsxLoader, cliPath, ...args], { encoding: 'utf8' });
    const linked = spawnSync(process.execPath, ['--import', tsxLoader, linkPath, ...args], { encoding: 'utf8' });

    expect(direct.error).toBeUndefined();
    expect(linked.error).toBeUndefined();
    expect(direct.status).toBe(status);
    expect(direct.stdout).toContain(stdout);
    expect(direct.stderr).toContain(stderr);
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
