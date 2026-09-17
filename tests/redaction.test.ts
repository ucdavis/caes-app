import { describe, expect, it } from 'vitest';

import { isSensitiveKey, redactCommandArgs, redactDiagnostic, redactValue } from '../src/redaction.js';

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

describe('diagnostic redaction', () => {
  it.each(['--token', '--password', '--pat', '--github-pat', '--githubPAT'])(
    'redacts inline and separate values for %s', (flag) => {
      expect(redactDiagnostic(`unknown option '${flag}=sensitive-value'`, [`${flag}=sensitive-value`]))
        .toBe(`unknown option '${flag}=[REDACTED]'`);
      expect(redactDiagnostic('invalid value: sensitive-value', [flag, 'sensitive-value']))
        .toBe('invalid value: [REDACTED]');
    },
  );

  it.each(['two words', 'say "hello" and \'goodbye\'', 'part=another=value', '.*+?^${}()|[]\\', '$& $1 $$', 'line\nbreak'])(
    'treats the value %j literally', (value) => {
      const args = Object.freeze([`--password=${value}`, '--token', value]);
      expect(redactDiagnostic(`unknown '--password=${value}'; value '${value}'`, args))
        .toBe("unknown '--password=[REDACTED]'; value '[REDACTED]'");
      expect(args).toEqual([`--password=${value}`, '--token', value]);
    },
  );

  it('redacts repeated and overlapping tokens longest first', () => {
    expect(redactDiagnostic('abcdef abc abcdef --token=ab --token=a', [
      '--password', 'abc', '--secret', 'abcdef', '--token=a', '--token=ab',
    ])).toBe('[REDACTED] [REDACTED] [REDACTED] --token=[REDACTED] --token=[REDACTED]');
  });

  it('does not rescan replacements or interpret replacement characters', () => {
    expect(redactDiagnostic('actual REDACTED --client$&-secret=value', [
      '--token', 'REDACTED', '--password', 'actual', '--client$&-secret=value',
    ])).toBe('[REDACTED] [REDACTED] --client$&-secret=[REDACTED]');
  });

  it('fully redacts a token also used as a separate sensitive value', () => {
    expect(redactDiagnostic('--token=value', ['--password', '--token=value', '--token=value']))
      .toBe('[REDACTED]');
  });

  it('preserves ordinary diagnostics and handles empty arguments', () => {
    const message = "unknown option '--patch=data'";
    expect(redactDiagnostic(message, ['--patch=data', '--path', 'somewhere'])).toBe(message);
    expect(redactDiagnostic(message, ['--password', ''])).toBe(message);
    expect(redactDiagnostic(message, [])).toBe(message);
    expect(redactDiagnostic("unknown option '--password='", ['--password=']))
      .toBe("unknown option '--password=[REDACTED]'");
  });
});
