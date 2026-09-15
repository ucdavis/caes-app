export type CommandErrorCode =
  | 'invalid-options'
  | 'invalid-json'
  | 'invalid-manifest'
  | 'future-manifest-schema'
  | 'conflict'
  | 'template-error'
  | 'execution-failed'
  | 'not-implemented';

export class CommandError extends Error {
  readonly code: CommandErrorCode;
  readonly exitCode: number;

  constructor(message: string, options: { code: CommandErrorCode; exitCode?: number }) {
    super(message);
    this.name = 'CommandError';
    this.code = options.code;
    this.exitCode = options.exitCode ?? 1;
  }
}

export function isCommandError(error: unknown): error is CommandError {
  return error instanceof CommandError;
}
