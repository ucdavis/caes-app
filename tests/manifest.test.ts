import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseManifest, readManifestFile, serializeManifest, writeManifestFile } from '../src/manifest.js';

const validManifest = {
  schemaVersion: 1,
  appId: 'demo-app',
  displayName: 'Demo App',
  templateSource: {
    repository: 'ucdavis/web-app-template',
    defaultBranch: 'main',
    resolvedCommitSha: 'abcdef1234567890',
  },
  ports: {
    server: 5165,
    client: 5173,
  },
} as const;

describe('manifest', () => {
  it('parses and preserves unknown fields', () => {
    const manifest = parseManifest(
      JSON.stringify({
        ...validManifest,
        futureSection: {
          enabled: true,
        },
      }),
    );

    expect(manifest.futureSection).toEqual({ enabled: true });
    expect(serializeManifest(manifest)).toContain('"futureSection"');
  });

  it('rejects future schema versions before rewriting', () => {
    expect(() =>
      parseManifest(
        JSON.stringify({
          ...validManifest,
          schemaVersion: 999,
        }),
      ),
    ).toThrow(/upgrade caes-app/);
  });

  it('reports invalid manifest data', () => {
    expect(() =>
      parseManifest(
        JSON.stringify({
          ...validManifest,
          ports: {
            server: 70000,
            client: 5173,
          },
        }),
      ),
    ).toThrow(/not a valid caes-app manifest/);
  });

  it('reads and writes stable pretty JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'caes-app-manifest-'));
    const manifestPath = join(dir, '.caes-app.json');

    await writeManifestFile(manifestPath, validManifest);
    const text = await readFile(manifestPath, 'utf8');
    const manifest = await readManifestFile(manifestPath);

    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('  "schemaVersion": 1');
    expect(manifest).toEqual(validManifest);
  });

  it('surfaces invalid JSON with the manifest path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'caes-app-invalid-manifest-'));
    const manifestPath = join(dir, '.caes-app.json');
    await writeFile(manifestPath, '{');

    await expect(readManifestFile(manifestPath)).rejects.toThrow(manifestPath);
  });
});
