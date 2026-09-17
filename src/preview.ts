import { redactCommand, redactCommandArgs, redactValue, type JsonObject } from './redaction.js';

export const previewStepTypes = [
  'file-write',
  'json-patch',
  'command',
  'github-repo',
  'github-variable',
  'github-secret',
  'azure-deployment',
  'entra-app',
  'manual-prompt',
] as const;

export const previewStepStates = [
  'pending',
  'created',
  'updated',
  'skipped',
  'present-unknown',
  'conflict',
  'failed',
] as const;

export const confirmationScopes = [
  'none',
  'mvp-file-edits',
  'mvp-github-repo',
  'github-environment',
  'azure-environment',
  'github-secret',
] as const;

export type PreviewStepType = (typeof previewStepTypes)[number];
export type PreviewStepState = (typeof previewStepStates)[number];
export type ConfirmationScopeKind = (typeof confirmationScopes)[number];

export interface ConfirmationScope {
  kind: ConfirmationScopeKind;
  environment?: string;
  name?: string;
}

export interface PreviewCommand {
  command: string;
  args?: string[];
  rendered?: string;
}

export interface PreviewStep {
  id: string;
  type: PreviewStepType;
  target: string;
  action: string;
  source: string;
  preview: JsonObject;
  state: PreviewStepState;
  confirmationScope: ConfirmationScope;
  command?: PreviewCommand;
}

export interface PreviewPlan {
  command: string;
  summary: string;
  steps: PreviewStep[];
}

export interface JsonPreviewEnvelope {
  kind: 'preview';
  command: string;
  summary: string;
  hasConflicts: boolean;
  exitCode: number;
  steps: PreviewStep[];
}

export function sanitizePreviewStep(step: PreviewStep): PreviewStep {
  const command = step.command
    ? {
        command: step.command.command,
        ...(step.command.args ? { args: redactCommandArgs(step.command.args) } : {}),
        rendered: redactCommand(step.command.command, step.command.args),
      }
    : undefined;

  return {
    ...step,
    preview: redactValue(step.preview) as JsonObject,
    ...(command ? { command } : {}),
  };
}

export function renderJsonPreview(plan: PreviewPlan): JsonPreviewEnvelope {
  return {
    kind: 'preview',
    command: plan.command,
    summary: plan.summary,
    hasConflicts: hasConflicts(plan),
    exitCode: exitCodeForPlan(plan),
    steps: plan.steps.map(sanitizePreviewStep),
  };
}

export function renderHumanPreview(plan: PreviewPlan): string {
  const lines = [`${plan.command}: ${plan.summary}`];

  for (const step of plan.steps.map(sanitizePreviewStep)) {
    lines.push(`- [${step.state}] ${step.type} ${step.action} -> ${step.target}`);
    lines.push(`  source: ${step.source}`);
    lines.push(`  confirmation: ${formatConfirmationScope(step.confirmationScope)}`);
    if (step.command) {
      lines.push(`  command: ${redactCommand(step.command.command, step.command.args)}`);
    }
    lines.push(`  preview: ${JSON.stringify(step.preview)}`);
  }

  return `${lines.join('\n')}\n`;
}

export function hasConflicts(plan: PreviewPlan): boolean {
  return plan.steps.some((step) => step.state === 'conflict');
}

export function exitCodeForPlan(plan: PreviewPlan): number {
  if (plan.steps.some((step) => step.state === 'failed')) {
    return 1;
  }

  if (hasConflicts(plan)) {
    return 2;
  }

  return 0;
}

export function groupStepsByConfirmationScope(steps: readonly PreviewStep[]): Map<string, PreviewStep[]> {
  const grouped = new Map<string, PreviewStep[]>();
  for (const step of steps) {
    const key = formatConfirmationScope(step.confirmationScope);
    grouped.set(key, [...(grouped.get(key) ?? []), step]);
  }

  return grouped;
}

function formatConfirmationScope(scope: ConfirmationScope): string {
  if (scope.environment && scope.name) {
    return `${scope.kind}:${scope.environment}:${scope.name}`;
  }

  if (scope.environment) {
    return `${scope.kind}:${scope.environment}`;
  }

  return scope.kind;
}
