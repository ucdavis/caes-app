import { CommandError } from './errors.js';
import type { JsonObject, JsonValue } from './redaction.js';

export type JsonPath = readonly (string | number)[];

export interface ParsedJsonObject {
  value: JsonObject;
  indent: string;
  lineEnding: '\n' | '\r\n';
}

export interface JsonEditResult {
  value: JsonObject;
  changed: boolean;
}

export function parseJsonObject(text: string, filePath = 'JSON file'): ParsedJsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CommandError(`${filePath} contains invalid JSON: ${message}`, {
      code: 'invalid-json',
      exitCode: 2,
    });
  }

  if (!isJsonObject(parsed)) {
    throw new CommandError(`${filePath} must contain a JSON object at the root.`, {
      code: 'invalid-json',
      exitCode: 2,
    });
  }

  return {
    value: parsed,
    indent: detectIndent(text),
    lineEnding: text.includes('\r\n') ? '\r\n' : '\n',
  };
}

export function serializeJsonObject(
  value: JsonObject,
  options: { indent?: string; lineEnding?: '\n' | '\r\n' } = {},
): string {
  const indent = options.indent ?? '  ';
  const lineEnding = options.lineEnding ?? '\n';
  return `${JSON.stringify(value, null, indent).replace(/\n/g, lineEnding)}${lineEnding}`;
}

export function setJsonPath(
  value: JsonObject,
  path: JsonPath,
  nextValue: JsonValue,
  options: { createMissing?: boolean } = {},
): JsonEditResult {
  if (path.length === 0) {
    if (!isJsonObject(nextValue)) {
      throw new CommandError('Root JSON replacement must be an object.', {
        code: 'invalid-json',
        exitCode: 2,
      });
    }

    return { value: nextValue, changed: !jsonEquals(value, nextValue) };
  }

  const clone = structuredClone(value) as JsonObject;
  let current: JsonObject | JsonValue[] = clone;

  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    const nextSegment = path[index + 1];
    if (segment === undefined || nextSegment === undefined) {
      throw new CommandError('JSON path contains an empty segment.', {
        code: 'invalid-json',
        exitCode: 2,
      });
    }

    const existing: JsonValue = Object.hasOwn(current, segment) ? current[segment as never] : undefined;
    if (existing === undefined) {
      if (!options.createMissing) {
        throw new CommandError(`JSON path '${formatPath(path)}' is missing '${String(segment)}'.`, {
          code: 'invalid-json',
          exitCode: 2,
        });
      }

      const container = typeof nextSegment === 'number' ? [] : {};
      setOwnValue(current, segment, container);
      current = container as JsonObject | JsonValue[];
      continue;
    }

    if (!isContainer(existing)) {
      throw new CommandError(`JSON path '${formatPath(path)}' cannot pass through '${String(segment)}'.`, {
        code: 'invalid-json',
        exitCode: 2,
      });
    }

    current = existing;
  }

  const leaf = path.at(-1);
  if (leaf === undefined) {
    throw new CommandError('JSON path contains an empty leaf.', {
      code: 'invalid-json',
      exitCode: 2,
    });
  }

  const previous = Object.hasOwn(current, leaf) ? current[leaf as never] : undefined;
  if (jsonEquals(previous, nextValue)) {
    return { value, changed: false };
  }

  setOwnValue(current, leaf, nextValue);
  return { value: clone, changed: true };
}

function setOwnValue(container: JsonObject | JsonValue[], key: string | number, value: JsonValue): void {
  // Bypass inherited setters while preserving existing descriptors (including array length).
  Object.defineProperty(container, key, Object.hasOwn(container, key)
    ? { value }
    : { value, enumerable: true, writable: true, configurable: true });
}

function detectIndent(text: string): string {
  const match = text.match(/^[\t ]+(?="[^"]+":)/m);
  return match?.[0] ?? '  ';
}

function formatPath(path: JsonPath): string {
  return path.map(String).join('.');
}

function jsonEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContainer(value: unknown): value is JsonObject | JsonValue[] {
  return typeof value === 'object' && value !== null;
}
