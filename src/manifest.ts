import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

import { MANIFEST_SCHEMA_VERSION } from './constants.js';
import { CommandError } from './errors.js';
import { parseJsonObject, serializeJsonObject } from './json-edit.js';

const templateSourceSchema = z
  .object({
    repository: z.string().min(1),
    defaultBranch: z.string().min(1),
    resolvedCommitSha: z.string().min(7),
  })
  .passthrough();

const portsSchema = z
  .object({
    server: z.number().int().min(1).max(65535),
    client: z.number().int().min(1).max(65535),
    database: z.number().int().min(1).max(65535).optional(),
  })
  .passthrough();

const githubSchema = z
  .object({
    owner: z.string().min(1).optional(),
    repo: z.string().min(1).optional(),
    visibility: z.enum(['public', 'private', 'internal']).optional(),
    defaultBranch: z.string().min(1).optional(),
    environments: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

export const manifestSchema = z
  .object({
    schemaVersion: z.literal(MANIFEST_SCHEMA_VERSION),
    appId: z.string().min(1),
    displayName: z.string().min(1),
    templateSource: templateSourceSchema,
    ports: portsSchema,
    github: githubSchema.optional(),
  })
  .passthrough();

export type CaesAppManifest = z.infer<typeof manifestSchema>;

export async function readManifestFile(filePath: string): Promise<CaesAppManifest> {
  const text = await readFile(filePath, 'utf8');
  return parseManifest(text, filePath);
}

export function parseManifest(text: string, filePath = '.caes-app.json'): CaesAppManifest {
  const parsed = parseJsonObject(text, filePath).value;
  const schemaVersion = parsed.schemaVersion;

  if (typeof schemaVersion === 'number' && schemaVersion > MANIFEST_SCHEMA_VERSION) {
    throw new CommandError(
      `${filePath} uses schemaVersion ${schemaVersion}; upgrade caes-app before rewriting this manifest.`,
      {
        code: 'future-manifest-schema',
        exitCode: 2,
      },
    );
  }

  const result = manifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new CommandError(`${filePath} is not a valid caes-app manifest: ${z.prettifyError(result.error)}`, {
      code: 'invalid-manifest',
      exitCode: 2,
    });
  }

  return result.data;
}

export async function writeManifestFile(filePath: string, manifest: CaesAppManifest): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, serializeManifest(manifest), 'utf8');
}

export function serializeManifest(manifest: CaesAppManifest): string {
  return serializeJsonObject(manifest);
}
