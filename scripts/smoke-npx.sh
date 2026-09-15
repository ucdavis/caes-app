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
node --input-type=module - "$temp_dir" "$expected_version" <<'JS'
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const [tempDir, version] = process.argv.slice(2);
const bin = join(tempDir, 'node_modules', '.bin', 'caes-app');
const invocations = [
  { name: 'installed bin', command: bin, prefix: [] },
  { name: 'npm exec', command: 'npm', prefix: ['exec', '--offline', '--', 'caes-app'] },
];

for (const invocation of invocations) {
  function run(args, expectedStatus) {
    const result = spawnSync(invocation.command, [...invocation.prefix, ...args], {
      cwd: tempDir,
      env: { ...process.env, NPM_CONFIG_CACHE: join(tempDir, 'npm-cache') },
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

  const placeholder = run(['init', 'demo-app', '--dry-run', '--json', '--local-only', '--no-git'], 1);
  assert.equal(placeholder.stderr, '');
  const payload = JSON.parse(placeholder.stdout);
  assert.equal(payload.kind, 'result');
  assert.equal(payload.status, 'error');
  assert.equal(payload.error.code, 'not-implemented');
  assert.equal(payload.preview.kind, 'preview');
  assert.equal(payload.preview.steps[0].preview.targetDir, 'demo-app');
  assert.equal(payload.preview.steps[0].preview.options.dryRun, true);
  assert.equal(payload.preview.steps[0].preview.options.noGit, true);
  console.error(`smoke:npx: ${invocation.name} assertions passed`);
}
JS
