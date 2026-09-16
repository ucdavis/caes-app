import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { createTemplateFixture } from './init-fixture.mjs';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const tempRoot = process.platform === 'darwin' ? '/private/tmp' : tmpdir();
const tempDir = await mkdtemp(join(tempRoot, 'caes-app smoke '));
const cacheDir = join(tempDir, 'npm-cache');

try {
  const npm = (args, cwd = tempDir) => execa('npm', [...args, '--cache', cacheDir], {
    cwd, env: { NPM_CONFIG_CACHE: cacheDir }, timeout: 120_000,
  });
  console.error('smoke:npx: packing tarball');
  const packed = await npm(['pack', '--json', '--pack-destination', tempDir], sourceRoot);
  const [{ filename }] = JSON.parse(packed.stdout);
  const tarball = join(tempDir, filename);

  console.error('smoke:npx: creating temp install project');
  // An explicit name permits a temporary directory containing spaces.
  await writeFile(join(tempDir, 'package.json'), JSON.stringify({ name: 'caes-app-smoke', private: true }));
  console.error('smoke:npx: installing packed tarball');
  await npm(['install', '--no-audit', '--no-fund', '--ignore-scripts', '--fetch-retries=1',
    '--fetch-retry-mintimeout=1000', '--fetch-retry-maxtimeout=5000', tarball]);

  const fixtureDirectory = join(tempDir, 'local fixture');
  await mkdir(fixtureDirectory);
  const fixture = await createTemplateFixture(fixtureDirectory);
  const bin = join(tempDir, 'node_modules', '.bin', process.platform === 'win32' ? 'caes-app.cmd' : 'caes-app');
  const invocations = [
    { name: 'installed bin', command: bin, prefix: [] },
    { name: 'npm exec', command: 'npm', prefix: ['exec', '--offline', '--', 'caes-app'] },
  ];

  console.error('smoke:npx: checking installed bin and offline npm exec');
  for (const invocation of invocations) {
    async function run(args, expectedStatus) {
      const result = await execa(invocation.command, [...invocation.prefix, ...args], {
        cwd: tempDir,
        env: {
          ...fixture.gitEnv, NPM_CONFIG_CACHE: cacheDir,
          // A parent `npm exec --package=...` must not select extra packages here.
          npm_config_package: undefined, NPM_CONFIG_PACKAGE: undefined,
        },
        reject: false, timeout: 30_000,
      });
      assert.equal(result.exitCode, expectedStatus,
        `${invocation.name} ${args.join(' ')}: ${result.stderr || result.shortMessage}`);
      return result;
    }

    const help = await run(['--help'], 0);
    assert.match(help.stdout, /Usage: caes-app/);
    assert.match(help.stdout, /init \[options\] \[target-dir\]/);
    assert.equal(help.stderr, '');
    const versionResult = await run(['--version'], 0);
    assert.equal(versionResult.stdout.trim(), version);
    assert.equal(versionResult.stderr, '');
    const initHelp = await run(['init', '--help'], 0);
    assert.match(initHelp.stdout, /Usage: caes-app init/);
    assert.equal(initHelp.stderr, '');

    const invalid = await run(['init', '--no-git'], 2);
    assert.equal(invalid.stdout, '');
    assert.match(invalid.stderr, /--no-git is only valid with --local-only/);

    for (const noGit of [true, false]) {
      const target = join(tempDir, `${invocation.name} app ${noGit ? 'without' : 'with'} git`);
      const args = ['init', target, '--json', '--local-only', '--manifest', 'metadata/app.json',
        '--display-name', 'Demo & Research', ...(noGit ? ['--no-git'] : [])];
      const preview = await run([...args, '--dry-run'], 0);
      assert.equal(preview.stderr, '');
      const payload = JSON.parse(preview.stdout);
      assert.equal(payload.kind, 'preview');
      assert.equal(payload.hasConflicts, false);
      assert.equal(payload.steps.find(step => step.id === 'server/.env').state, 'created');
      assert.ok(payload.summary.includes(fixture.sha));
      await assert.rejects(stat(target), { code: 'ENOENT' });

      const applied = await run([...args, '--yes'], 0);
      const result = JSON.parse(applied.stdout);
      assert.equal(result.status, 'success');
      assert.equal(result.scaffoldingCompleted, true);
      assert.equal(result.runtimeReadiness, 'unverified');
      assert.ok(result.steps.every(step => !step.id.includes('\\')));
      const manifest = JSON.parse(await readFile(join(target, 'metadata/app.json'), 'utf8'));
      assert.equal(manifest.templateSource.resolvedCommitSha, fixture.sha);
      assert.equal(manifest.displayName, 'Demo & Research');
      const envPath = join(target, 'server/.env');
      const dotenv = await readFile(envPath, 'utf8');
      assert.ok(dotenv.includes('Auth__ClientId="<client-guid>"'));
      assert.ok(dotenv.includes(`OTEL_SERVICE_NAME="${manifest.appId}"`));
      assert.ok(dotenv.includes('Smtp__Password="<smtp_password>"'));
      if (process.platform !== 'win32') assert.equal((await stat(envPath)).mode & 0o777, 0o600);
      assert.ok(!applied.stdout.includes('LocalDev123!'));
      if (noGit) await assert.rejects(stat(join(target, '.git')), { code: 'ENOENT' });
      else {
        assert.ok((await stat(join(target, '.git'))).isDirectory());
        await assert.rejects(stat(join(target, '.git/index')), { code: 'ENOENT' });
      }
      const resumed = await run([...args, '--yes'], 0);
      assert.ok(JSON.parse(resumed.stdout).steps.every(step => step.state === 'skipped'));
      assert.equal(await readFile(envPath, 'utf8'), dotenv);
    }
    console.error(`smoke:npx: ${invocation.name} assertions passed`);
  }
} finally {
  await rm(tempDir, { recursive: true, force: true, maxRetries: 3 });
}
