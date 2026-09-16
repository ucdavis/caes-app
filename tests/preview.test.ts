import { describe, expect, it } from 'vitest';

import {
  exitCodeForPlan,
  groupStepsByConfirmationScope,
  renderHumanPreview,
  renderJsonPreview,
  type PreviewPlan,
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
    for (const output of [JSON.stringify(json), renderHumanPreview(commandPlan)]) {
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
    for (const output of [JSON.stringify(json), renderHumanPreview(patchPlan)]) {
      expect(output).toContain('server/appsettings.json');
      expect(output).toContain('Demo');
      expect(output).not.toContain('nested-secret');
    }
  });

  it('renders human previews with redaction', () => {
    const human = renderHumanPreview(plan);

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
});
