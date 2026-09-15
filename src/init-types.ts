import type { CaesAppManifest } from './manifest.js';
import type { PreviewStep } from './preview.js';

export interface ResolvedInitInputs {
  appId: string;
  displayName: string;
  ports: { server: number; client: number; database: number };
  authClientId?: string;
}

export interface InitResult {
  kind: 'result';
  command: 'init';
  status: 'success' | 'cancelled' | 'failure';
  scaffoldingCompleted: boolean;
  runtimeReadiness: 'unverified';
  steps: PreviewStep[];
  nextSteps: string[];
  error?: { code: string; message: string };
}

export interface TemplateFile { content: Buffer; mode: number }
export interface TemplateSnapshot {
  source: CaesAppManifest['templateSource'];
  files: Map<string, TemplateFile>;
  cleanup: () => Promise<void>;
}

export interface GitResult { stdout: string; exitCode: number }
export type GitRunner = (args: string[], cwd?: string, input?: string) => Promise<GitResult>;
export interface InitDependencies {
  git: GitRunner;
  fetchTemplate: (source?: CaesAppManifest['templateSource']) => Promise<TemplateSnapshot>;
  interactive: boolean;
  input: (message: string, defaultValue?: string) => Promise<string>;
  confirm: (message: string) => Promise<boolean>;
}
