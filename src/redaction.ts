import { REDACTED } from './constants.js';

const SENSITIVE_KEY_PARTS = [
  'secret',
  'password',
  'token',
  'privatekey',
  'private_key',
  'connectionstring',
  'connectionstrings',
  'db_connection',
  'otlp_headers',
  'otel_exporter_otlp_headers',
  'smtp_password',
];

const SENSITIVE_FLAGS = new Set([
  '--password',
  '--secret',
  '--token',
  '--pat',
  '--connection-string',
  '--db-connection',
]);

export type JsonValue = unknown;
export type JsonObject = Record<string, unknown>;

export function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
  const tokens = key
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  return tokens.includes('pat') || SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
}

export function redactValue<T>(value: T, path: readonly string[] = []): T | typeof REDACTED {
  const currentKey = path.at(-1);
  if (currentKey && isSensitiveKey(currentKey) && value !== undefined && value !== null) {
    return REDACTED;
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => redactValue(item, [...path, String(index)])) as T;
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, redactValue(child, [...path, key])]),
    ) as T;
  }

  return value;
}

export function redactCommandArgs(args: readonly string[]): string[] {
  const redacted: string[] = [];
  let redactNext = false;

  for (const arg of args) {
    if (redactNext) {
      redacted.push(REDACTED);
      redactNext = false;
      continue;
    }

    const equalsIndex = arg.indexOf('=');
    if (equalsIndex > 0) {
      const flag = arg.slice(0, equalsIndex);
      if (SENSITIVE_FLAGS.has(flag) || isSensitiveKey(flag)) {
        redacted.push(`${flag}=${REDACTED}`);
        continue;
      }
    }

    if (arg.startsWith('--') && (SENSITIVE_FLAGS.has(arg) || isSensitiveKey(arg))) {
      redacted.push(arg);
      redactNext = true;
      continue;
    }

    redacted.push(arg);
  }

  return redacted;
}

export function redactCommand(command: string, args: readonly string[] = []): string {
  return [command, ...redactCommandArgs(args)].join(' ');
}

export function redactDiagnostic(message: string, args: readonly string[]): string {
  const redacted = redactCommandArgs(args);
  const replacements = new Map<string, string>();
  args.forEach((arg, index) => {
    const replacement = redacted[index]!;
    if (arg && arg !== replacement && (!replacements.has(arg) || replacement === REDACTED)) {
      replacements.set(arg, replacement);
    }
  });
  if (!replacements.size) return message;

  // Match whole argument tokens literally, longest first, without rescanning
  // replacements (which may themselves contain sensitive token text).
  const pattern = [...replacements.keys()]
    .sort((left, right) => right.length - left.length)
    .map((arg) => arg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return message.replace(new RegExp(pattern, 'g'), (match) => replacements.get(match)!);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
