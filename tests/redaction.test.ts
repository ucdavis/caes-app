import { describe, expect, it } from 'vitest';

import { isSensitiveKey, redactCommandArgs, redactValue } from '../src/redaction.js';

describe('PAT redaction', () => {
  it.each(['PAT', 'pat', 'GITHUB_PAT', 'githubPat', 'githubPAT', 'github-pat', 'github.pat', 'PATValue', '--pat'])(
    'redacts the complete PAT token in %s', (key) => {
      expect(isSensitiveKey(key)).toBe(true);
      expect(redactValue({ [key]: 'sensitive-value' })).toEqual({ [key]: '[REDACTED]' });
    },
  );

  it.each(['path', 'patch', 'compatibility', 'dispatch', 'Path', 'PATCH', 'filePath'])(
    'preserves ordinary key %s', (key) => {
      expect(isSensitiveKey(key)).toBe(false);
      expect(redactValue({ [key]: 'ordinary-value' })).toEqual({ [key]: 'ordinary-value' });
    },
  );

  it('redacts PAT flags while retaining ordinary path flags', () => {
    expect(redactCommandArgs([
      '--pat', 'first-secret', '--github-pat=second-secret', '--path', 'my path', '--patch=data',
    ])).toEqual(['--pat', '[REDACTED]', '--github-pat=[REDACTED]', '--path', 'my path', '--patch=data']);
  });

  it.each(['Password', 'clientSecret', 'accessToken', 'privateKey', 'private_key', 'ConnectionStrings',
    'DB_CONNECTION', 'OTEL_EXPORTER_OTLP_HEADERS', 'SMTP_PASSWORD'])(
    'retains redaction for %s', (key) => {
      expect(redactValue({ [key]: 'sensitive-value' })).toEqual({ [key]: '[REDACTED]' });
    },
  );
});
