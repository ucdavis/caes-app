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

export interface HumanPreviewOptions {
  verbose?: boolean;
  targetDir?: string;
  /** Created/updated steps are completed work when rendering an apply failure. */
  applied?: boolean;
  failure?: { stepId: string; message: string };
}

export function renderHumanPreview(plan: PreviewPlan, options: HumanPreviewOptions = {}): string {
  if (options.verbose) return renderVerbosePreview(plan);
  const steps = plan.steps.map(sanitizePreviewStep);
  const files = steps.filter(isFileStep);
  const grouped = files.filter((step) => isPlainCopy(step) &&
    (step.state === 'created' || (options.applied && step.state === 'pending')));
  const groupedIds = new Set(grouped.map((step) => step.id));
  const visible = files.filter((step) => step.state !== 'skipped' && !groupedIds.has(step.id));
  const count = (items: PreviewStep[], state: PreviewStepState) => items.filter((step) => step.state === state).length;
  const lines = [`${singleLine(plan.command)}: ${singleLine(plan.summary)}`];
  if (options.targetDir) lines.push(`Target: ${singleLine(options.targetDir)}`);
  if (grouped.length) {
    const copies = count(grouped, 'created');
    lines.push('', options.applied
      ? `Template files: ${copies} copied; ${count(grouped, 'pending')} pending (without customization)`
      : `Template files: ${copies} to copy without customization`);
  }
  if (visible.length) lines.push('', 'File changes:', ...renderFileTree(visible, options));
  for (const step of steps.filter((item) => !isFileStep(item))) {
    if (step.state === 'conflict' || step.state === 'failed') {
      lines.push(`${singleLine(step.id)}: ${stepDescription(step, options)}`);
    } else if (step.id === 'git.init') {
      const description = step.state === 'skipped'
        ? step.preview.reason === '--no-git' ? 'Skip initialization (--no-git)' : 'Preserve existing repository'
        : step.state === 'created' ? options.applied ? 'Initialized repository on main' : 'Initialize repository on main'
        : `${step.state}: initialize repository on main`;
      lines.push(`Git: ${description}`);
    } else if (step.id === 'manual.auth') {
      lines.push('Setup: Runtime readiness is unverified; local configuration may need completion.');
    } else {
      lines.push(`${singleLine(step.id)}: [${step.state}] ${singleLine(step.action)} -> ${singleLine(step.target)}`);
    }
  }
  const totals = [
    `${count(files, 'created')} ${options.applied ? 'added' : 'to add'}`,
    `${count(files, 'updated')} ${options.applied ? 'modified' : 'to modify'}`,
    `${count(files, 'skipped')} skipped`,
  ];
  for (const state of ['pending', 'present-unknown', 'conflict', 'failed'] as const) {
    if (count(files, state)) totals.push(`${count(files, state)} ${state}`);
  }
  lines.push(`Files: ${totals.join('; ')}`,
    `Issues: ${count(steps, 'conflict')} conflicts; ${count(steps, 'failed')} failures`);
  if (visible.length) {
    lines.push(options.applied ? '[A] Added  [M] Modified  [!] Issue  [P] Pending  [?] Present, unknown' :
      '[A] Add  [M] Modify  [!] Issue  [P] Pending  [?] Present, unknown');
  }
  lines.push('Use --verbose for the full preview.');
  return `${lines.join('\n')}\n`;
}

function singleLine(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, (character) => `\\x${character.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

function isFileStep(step: PreviewStep): boolean {
  return step.type === 'file-write' || step.type === 'json-patch';
}

function isPlainCopy(step: PreviewStep): boolean {
  return Object.keys(step.preview).length === 1 && typeof step.preview.bytes === 'number';
}

function customizationDescription(step: PreviewStep): string {
  if ('templateSource' in step.preview && 'appId' in step.preview) return 'App settings and template revision';
  if (step.id === 'server/.env') {
    return step.state === 'created' ? 'Initialize local settings' :
      'assignment' in step.preview ? 'Auth client ID' : 'Local settings';
  }
  const changes = step.preview.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return isPlainCopy(step) ? 'Template file' : 'Configuration changes';
  }
  const descriptions = Object.keys(changes).sort().map((key) => {
    if (/^(client\/)?package(-lock)?\.json$/.test(step.id)) {
      if (key === 'name' || key === 'packages..name') return 'Package name';
      if (key.startsWith('scripts.db:')) return 'Database project name';
      if (key.startsWith('scripts.start:client:')) return 'Server port';
    }
    if (key === 'Smtp.FromName' || key === 'Notification.DefaultAppName') return 'Display name';
    if (key === 'Notification.BaseUrl') return 'Client port';
    if (key === 'ConnectionStrings.DefaultConnection' || key === 'SQL host port') return 'Database port';
    if (/^profiles\.[^.]+\.applicationUrl$/.test(key)) return 'Server port';
    if (step.id === '.devcontainer/devcontainer.json') {
      if (key === 'name') return 'Display name';
      if (key === 'containerEnv.ASPNETCORE_URLS') return 'Server port';
      if (/^(forwardPorts|portsAttributes)(\.|$)/.test(key)) return 'Development-container port configuration';
    }
    if (step.id === 'client/vite.config.ts') {
      if (key === 'server.port') return 'Client port';
      if (key === 'backend fallback') return 'Backend URL';
    }
    if (key === 'SpaProxyServerUrl') return 'Client port';
    return 'Configuration changes';
  });
  return [...new Set(descriptions)].join('; ') || 'Configuration changes';
}

function stepDescription(step: PreviewStep, options: HumanPreviewOptions): string {
  const codes: Record<PreviewStepState, string> = {
    created: 'A', updated: 'M', skipped: 'S', conflict: '!', failed: '!', pending: 'P', 'present-unknown': '?',
  };
  if (step.state === 'conflict' || step.state === 'failed') {
    const reason = options.failure?.stepId === step.id ? options.failure.message : step.preview.message;
    return `[!] ${step.state === 'conflict' ? 'Conflict' : 'Failed'}: ${singleLine(typeof reason === 'string' ? reason : step.action)}`;
  }
  return `[${codes[step.state]}] ${customizationDescription(step)}`;
}

function renderFileTree(steps: PreviewStep[], options: HumanPreviewOptions): string[] {
  interface TreeNode { children: Map<string, TreeNode>; step?: PreviewStep }
  const root: TreeNode = { children: new Map() };
  for (const step of steps) {
    let node = root;
    for (const part of step.id.split('/')) {
      if (!node.children.has(part)) node.children.set(part, { children: new Map() });
      node = node.children.get(part)!;
    }
    node.step = step;
  }
  const rows: { path: string; description?: string }[] = [];
  const walk = (node: TreeNode, prefix: string) => {
    const entries = [...node.children.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    entries.forEach(([name, child], index) => {
      const last = index === entries.length - 1;
      rows.push({ path: `${prefix}${last ? '`-- ' : '|-- '}${singleLine(name)}${child.children.size ? '/' : ''}`,
        ...(child.step ? { description: stepDescription(child.step, options) } : {}) });
      walk(child, `${prefix}${last ? '    ' : '|   '}`);
    });
  };
  walk(root, '');
  const width = Math.max(...rows.map((row) => row.path.length));
  return rows.map((row) => row.description ? `${row.path.padEnd(width)} ${row.description}` : row.path);
}

function renderVerbosePreview(plan: PreviewPlan): string {
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
