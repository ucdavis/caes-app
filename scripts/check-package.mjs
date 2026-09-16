import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const tempRoot = process.platform === 'darwin' ? '/private/tmp' : tmpdir();
const tempDir = await mkdtemp(join(tempRoot, 'caes-app-pack-check-'));

try {
  if (packageJson.bin?.['caes-app'] !== './dist/cli.js') {
    throw new Error('package.json must expose bin.caes-app as ./dist/cli.js.');
  }

  const binPath = new URL('../dist/cli.js', import.meta.url);
  const binText = await readFile(binPath, 'utf8');
  if (!binText.startsWith('#!/usr/bin/env node')) {
    throw new Error('dist/cli.js must start with an executable node shebang.');
  }

  const binStat = await stat(binPath);
  if (process.platform !== 'win32' && (binStat.mode & 0o111) === 0) {
    throw new Error('dist/cli.js must be executable.');
  }

  const cacheDir = join(tempDir, 'npm-cache');
  const { stdout } = await execa('npm', ['pack', '--dry-run', '--json', '--cache', cacheDir], {
    env: {
      NPM_CONFIG_CACHE: cacheDir,
    },
  });
  const [pack] = JSON.parse(stdout);
  const files = new Set(pack.files.map((file) => file.path));

  for (const expected of ['package.json', 'README.md', 'LICENSE', 'dist/cli.js', 'dist/cli.d.ts']) {
    if (!files.has(expected)) {
      throw new Error(`Packed package is missing ${expected}.`);
    }
  }

  for (const forbidden of ['src/cli.ts', 'tests/cli.test.ts', 'tsconfig.json', 'vitest.config.ts']) {
    if (files.has(forbidden)) {
      throw new Error(`Packed package should not include ${forbidden}.`);
    }
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
