#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" == "Darwin" ]]; then
  temp_root="/private/tmp"
else
  temp_root="${TMPDIR:-/tmp}"
fi

temp_dir="$(mktemp -d "$temp_root/caes-app-smoke.XXXXXX")"
cache_dir="$temp_dir/npm-cache"
trap 'rm -rf "$temp_dir"' EXIT

echo "smoke:npx: packing tarball" >&2
npm pack --json --pack-destination "$temp_dir" --cache "$cache_dir" >/dev/null

package_file="$(node -p "require('./package.json').name + '-' + require('./package.json').version + '.tgz'")"
tarball="$temp_dir/$package_file"

echo "smoke:npx: creating temp install project" >&2
(
  cd "$temp_dir"
  npm init --yes --cache "$cache_dir" >/dev/null
)

echo "smoke:npx: installing packed tarball" >&2
(
  cd "$temp_dir"
  npm install --no-audit --no-fund --ignore-scripts --fetch-retries=1 --fetch-retry-mintimeout=1000 --fetch-retry-maxtimeout=5000 "$tarball" --cache "$cache_dir" >/dev/null
)

expected_version="$(node -p "require('./package.json').version")"

echo "smoke:npx: checking installed bin and offline npm exec" >&2
node --input-type=module - "$temp_dir" "$expected_version" "$PWD" <<'JS'
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, delimiter } from 'node:path';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const [tempDir, version, sourceRoot] = process.argv.slice(2);
const { createTemplateFixture } = await import(pathToFileURL(join(sourceRoot, 'scripts/init-fixture.mjs')).href);
const fixtureDirectory = join(tempDir, 'fixture');
await mkdir(fixtureDirectory);
const fixture = await createTemplateFixture(fixtureDirectory);
const bin = join(tempDir, 'node_modules', '.bin', 'caes-app');
const invocations = [
  { name: 'installed bin', command: bin, prefix: [] },
  { name: 'npm exec', command: 'npm', prefix: ['exec', '--offline', '--', 'caes-app'] },
];

for (const invocation of invocations) {
  function run(args, expectedStatus) {
    const result = spawnSync(invocation.command, [...invocation.prefix, ...args], {
      cwd: tempDir,
      env: { ...process.env, PATH: fixture.shimDir + delimiter + process.env.PATH, NPM_CONFIG_CACHE: join(tempDir, 'npm-cache') },
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, expectedStatus,
      `${invocation.name} ${args.join(' ')}: ${result.stderr}`);
    return result;
  }

  const help = run(['--help'], 0);
  assert.match(help.stdout, /Usage: caes-app/);
  assert.match(help.stdout, /init \[options\] \[target-dir\]/);
  assert.equal(help.stderr, '');
  const versionResult = run(['--version'], 0);
  assert.equal(versionResult.stdout.trim(), version);
  assert.equal(versionResult.stderr, '');
  const initHelp = run(['init', '--help'], 0);
  assert.match(initHelp.stdout, /Usage: caes-app init/);
  assert.equal(initHelp.stderr, '');

  const invalid = run(['init', '--no-git'], 2);
  assert.equal(invalid.stdout, '');
  assert.match(invalid.stderr, /--no-git is only valid with --local-only/);

  const target = join(tempDir, invocation.name === 'installed bin' ? 'bin-app' : 'exec-app');
  const preview = run(['init', target, '--dry-run', '--json', '--local-only', '--no-git'], 0);
  assert.equal(preview.stderr, '');
  const payload = JSON.parse(preview.stdout);
  assert.equal(payload.kind, 'preview');
  assert.equal(payload.hasConflicts, false);
  assert.equal(payload.steps.find(step => step.id === 'server/.env').state, 'created');
  assert.ok(payload.summary.includes(fixture.sha));
  await assert.rejects(stat(target), { code: 'ENOENT' });
  const applied = run(['init', target, '--yes', '--json', '--local-only', '--no-git'], 0);
  const result = JSON.parse(applied.stdout);
  assert.equal(result.status, 'success');
  assert.equal(result.scaffoldingCompleted, true);
  assert.equal(result.runtimeReadiness, 'unverified');
  const manifest = JSON.parse(await readFile(join(target, '.caes-app.json'), 'utf8'));
  assert.equal(manifest.templateSource.resolvedCommitSha, fixture.sha);
  const envPath = join(target, 'server/.env');
  const dotenv = await readFile(envPath, 'utf8');
  assert.ok(dotenv.includes('Auth__ClientId="<client-guid>"'));
  assert.ok(dotenv.includes(`OTEL_SERVICE_NAME="${manifest.appId}"`));
  assert.ok(dotenv.includes('Smtp__Password="<smtp_password>"'));
  assert.equal((await stat(envPath)).mode & 0o777, 0o600);
  assert.ok(!applied.stdout.includes('LocalDev123!'));
  await assert.rejects(stat(join(target, '.git')), { code: 'ENOENT' });
  const resumed = run(['init', target, '--yes', '--json', '--local-only', '--no-git'], 0);
  assert.ok(JSON.parse(resumed.stdout).steps.every(step => step.state === 'skipped'));
  assert.equal(await readFile(envPath, 'utf8'), dotenv);
  console.error(`smoke:npx: ${invocation.name} assertions passed`);
}
JS
