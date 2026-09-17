import { describe, expect, it } from 'vitest';

import {
  exitCodeForPlan,
  groupStepsByConfirmationScope,
  renderHumanPreview,
  renderJsonPreview,
  type PreviewPlan,
  type PreviewStep,
} from '../src/preview.js';

const plan: PreviewPlan = {
  command: 'init',
  summary: 'preview generated changes',
  steps: [
    {
      id: 'settings',
      type: 'json-patch',
      target: 'server/appsettings.Development.json',
      action: 'update local settings',
      source: 'wizard input',
      state: 'updated',
      confirmationScope: { kind: 'mvp-file-edits' },
      preview: {
        Smtp: {
          Password: 'super-secret-password',
        },
        ConnectionStrings: {
          DefaultConnection: 'Server=example;Password=top-secret;',
        },
      },
    },
    {
      id: 'repo',
      type: 'github-repo',
      target: 'ucdavis/demo-app',
      action: 'create repository',
      source: 'GitHub CLI',
      state: 'conflict',
      confirmationScope: { kind: 'mvp-github-repo' },
      preview: {
        visibility: 'private',
      },
      command: {
        command: 'gh',
        args: ['secret', 'set', 'SMTP_PASSWORD', '--password', 'super-secret-password'],
      },
    },
  ],
};

describe('preview', () => {
  it('preserves argument boundaries while redacting command secrets', () => {
    const args = ['repo', 'create', 'demo', '--description', 'My demo app', '', '  spaced  ',
      'say "hello"', '--password', 'first secret', '--token=second secret'];
    const commandPlan = structuredClone(plan);
    commandPlan.steps[0]!.command = { command: 'gh', args };
    const json = renderJsonPreview(commandPlan);

    expect(json.steps[0]!.command?.args).toEqual([
      'repo', 'create', 'demo', '--description', 'My demo app', '', '  spaced  ',
      'say "hello"', '--password', '[REDACTED]', '--token=[REDACTED]',
    ]);
    expect(args).toContain('first secret');
    for (const output of [JSON.stringify(json), renderHumanPreview(commandPlan, { verbose: true })]) {
      expect(output).not.toContain('first secret');
      expect(output).not.toContain('second secret');
      expect(output).toContain('[REDACTED]');
    }
  });

  it('shows paths and patches while redacting nested secrets', () => {
    const patchPlan = structuredClone(plan);
    patchPlan.steps[0]!.preview = {
      path: 'server/appsettings.json',
      patch: { displayName: 'Demo', githubPat: 'nested-secret' },
      compatibility: true,
    };
    const json = renderJsonPreview(patchPlan);

    expect(json.steps[0]!.preview).toEqual({
      path: 'server/appsettings.json',
      patch: { displayName: 'Demo', githubPat: '[REDACTED]' },
      compatibility: true,
    });
    for (const output of [JSON.stringify(json), renderHumanPreview(patchPlan, { verbose: true })]) {
      expect(output).toContain('server/appsettings.json');
      expect(output).toContain('Demo');
      expect(output).not.toContain('nested-secret');
    }
  });

  it('renders human previews with redaction', () => {
    const human = renderHumanPreview(plan, { verbose: true });

    expect(human).toContain('[updated] json-patch');
    expect(human).toContain('[REDACTED]');
    expect(human).not.toContain('super-secret-password');
    expect(human).not.toContain('top-secret');
  });

  it('renders JSON previews with conflicts and redaction', () => {
    const json = renderJsonPreview(plan);

    expect(json.kind).toBe('preview');
    expect(json.hasConflicts).toBe(true);
    expect(json.exitCode).toBe(2);
    expect(JSON.stringify(json)).toContain('[REDACTED]');
    expect(JSON.stringify(json)).not.toContain('super-secret-password');
  });

  it('maps conflicts to nonzero exit codes', () => {
    expect(exitCodeForPlan(plan)).toBe(2);
  });

  it('groups steps by confirmation scope', () => {
    const grouped = groupStepsByConfirmationScope(plan.steps);

    expect(grouped.get('mvp-file-edits')).toHaveLength(1);
    expect(grouped.get('mvp-github-repo')).toHaveLength(1);
  });

  const file = (id: string, preview: PreviewStep['preview'], state: PreviewStep['state'] = 'created'): PreviewStep => ({
    id, type: 'file-write', target: `/apps/demo/${id}`, action: 'write', source: 'template',
    confirmationScope: { kind: 'mvp-file-edits' }, state, preview,
  });
  const compactPlan = (steps: PreviewStep[]): PreviewPlan => ({ command: 'init', summary: 'Demo', steps });

  it('renders a sorted tree with deduplicated descriptions and an alternate manifest', () => {
    const steps = [
      file('server/appsettings.json', { changes: { 'Smtp.FromName': { after: 'Private Name' }, 'Notification.DefaultAppName': { after: 'Private Name' } } }),
      file('metadata/app.json', { templateSource: {}, appId: 'demo' }),
      file('client/vite.config.ts', { changes: { 'server.port': { after: 6173 }, 'backend fallback': { after: 'url' } } }, 'updated'),
      file('server/.env', { assignment: { Auth__ClientId: 'client-guid' } }),
      file('ignored.txt', { bytes: 12 }, 'skipped'),
    ];
    const output = renderHumanPreview(compactPlan(steps), { targetDir: '/apps/demo' });
    expect(output).toBe([
      'init: Demo', 'Target: /apps/demo', '', 'File changes:',
      '|-- client/',
      '|   `-- vite.config.ts   [M] Backend URL; Client port',
      '|-- metadata/',
      '|   `-- app.json         [A] App settings and template revision',
      '`-- server/',
      '    |-- .env             [A] Initialize local settings',
      '    `-- appsettings.json [A] Display name',
      'Files: 3 to add; 1 to modify; 1 skipped', 'Issues: 0 conflicts; 0 failures',
      '[A] Add  [M] Modify  [!] Issue  [P] Pending  [?] Present, unknown',
      'Use --verbose for the full preview.', '',
    ].join('\n'));
    expect(renderHumanPreview(compactPlan([...steps].reverse()), { targetDir: '/apps/demo' })).toBe(output);
  });

  it('keeps bulk template copies constant in line count and summarizes an all-skipped rerun', () => {
    const copies = Array.from({ length: 500 }, (_, index) => file(`plain/${index}.txt`, { bytes: 10 }));
    const output = renderHumanPreview(compactPlan(copies));
    expect(output).toContain('Template files: 500 to copy without customization');
    expect(output).not.toContain('plain/');
    expect(output.split('\n')).toHaveLength(renderHumanPreview(compactPlan(copies.slice(0, 1))).split('\n').length);
    const skipped = renderHumanPreview(compactPlan(copies.map((step) => ({ ...step, state: 'skipped' }))));
    expect(skipped).toContain('Files: 0 to add; 0 to modify; 500 skipped');
    expect(skipped).not.toContain('File changes:');
  });

  it('always exposes issues and distinguishes completed, pending, and unknown files', () => {
    const output = renderHumanPreview(compactPlan([
      file('copied.txt', { bytes: 5 }),
      file('later.txt', { bytes: 5 }, 'pending'),
      file('settings.json', { changes: { name: {} } }, 'pending'),
      file('failed.txt', { bytes: 5 }, 'failed'),
      file('conflict.txt', { message: 'Full conflict reason' }, 'conflict'),
      file('unknown.txt', {}, 'present-unknown'),
      file('updated.txt', {}, 'updated'),
    ]), { applied: true, failure: { stepId: 'failed.txt', message: 'Full failure reason' } });
    expect(output).toContain('Template files: 1 copied; 1 pending (without customization)');
    expect(output).toContain('[P] Configuration changes');
    expect(output).toContain('[?] Configuration changes');
    expect(output).toContain('[!] Failed: Full failure reason');
    expect(output).toContain('[!] Conflict: Full conflict reason');
    expect(output).toContain('Files: 1 added; 1 modified; 0 skipped; 2 pending; 1 present-unknown; 1 conflict; 1 failed');
    expect(output).toContain('Issues: 1 conflicts; 1 failures');
    expect(output).not.toContain('to copy');
  });

  it.each([false, true])('does not disclose sensitive values (verbose=%s)', (verbose) => {
    const secretPlan = compactPlan([
      file('server/appsettings.Development.json', { changes: {
        'ConnectionStrings.DefaultConnection': { before: 'connection-secret', after: 'new-connection-secret' },
        Smtp: { Password: 'nested-secret' },
      } }),
      { ...file('command', {}), type: 'command', command: { command: 'gh', args: ['--token', 'command-secret'] } },
    ]);
    const output = renderHumanPreview(secretPlan, { verbose });
    for (const value of ['connection-secret', 'nested-secret', 'command-secret']) expect(output).not.toContain(value);
    if (verbose) expect(output).toContain('[REDACTED]');
    else expect(output).toContain('Database port');
  });

  it('uses descriptions only for unknown changes and escapes embedded line breaks', () => {
    const output = renderHumanPreview(compactPlan([
      file('new\nfile.json', { changes: { unknown: { before: 'old-value', after: 'new-value' } } }),
    ]));
    expect(output).toContain('new\\x0afile.json [A] Configuration changes');
    expect(output).not.toContain('old-value');
    expect(output).not.toContain('new-value');
  });
});
