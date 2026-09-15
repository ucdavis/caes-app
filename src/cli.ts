#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Command, CommanderError } from 'commander';

import { CLI_NAME, CLI_VERSION, DEFAULT_MANIFEST_PATH } from './constants.js';
import { CommandError, isCommandError } from './errors.js';
import { renderJsonPreview, renderHumanPreview, type PreviewPlan } from './preview.js';
import { redactValue } from './redaction.js';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export interface InitOptions {
  dryRun: boolean;
  yes: boolean;
  json: boolean;
  manifest: string;
  localOnly: boolean;
  noGit: boolean;
}

type CommanderMvpOptions = Partial<InitOptions> & {
  git?: boolean;
};

export interface InitInvocation {
  targetDir: string;
  options: InitOptions;
}

type CommandErrorWithContext = CommandError & {
  cliOptions?: InitOptions;
  preview?: PreviewPlan;
};

export function createProgram(io: CliIo): Command {
  const program = new Command();

  program.name(CLI_NAME)
    .description('CLI utility for managing CAES apps')
    .version(CLI_VERSION)
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: io.stdout,
      writeErr: io.stderr,
    });

  addMvpOptions(program);

  const initCommand = program
    .command('init')
    .description('create a new app from the trusted CAES web app template')
    .argument('[target-dir]', 'target directory', '.');
  addMvpOptions(initCommand);
  initCommand.action((targetDir: string) => {
    const options = collectMvpOptions(initCommand);
    try {
      validateInitOptions(options);
      throw notImplemented(targetDir, options);
    } catch (error) {
      if (isCommandError(error)) {
        Object.assign(error, { cliOptions: options });
      }
      throw error;
    }
  });

  return program;
}

export async function runCli(argv: readonly string[], io: CliIo = defaultIo): Promise<number> {
  const program = createProgram(io);

  try {
    await program.parseAsync([...argv], { from: 'node' });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }

    if (isCommandError(error)) {
      emitCommandError(error, io, getErrorOptions(error, program));
      return error.exitCode;
    }

    const fallback = error instanceof Error ? error.message : String(error);
    emitCommandError(
      new CommandError(fallback, {
        code: 'not-implemented',
        exitCode: 1,
      }),
      io,
      normalizeInitOptions(program.opts<CommanderMvpOptions>()),
    );
    return 1;
  }
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  process.exitCode = await runCli(argv);
}

function addMvpOptions(command: Command): Command {
  return command
    .option('--dry-run', 'build and print the preview plan without applying it')
    .option('--yes', 'skip non-secret confirmations')
    .option('--json', 'emit machine-readable output with sensitive values redacted')
    .option('--manifest <path>', 'read/write a manifest path other than .caes-app.json', DEFAULT_MANIFEST_PATH)
    .option('--local-only', 'perform no GitHub or Azure mutations')
    .option('--no-git', 'with --local-only, skip git initialization');
}

function collectMvpOptions(command: Command): InitOptions {
  const parentOptions = command.parent?.opts<CommanderMvpOptions>() ?? {};
  const localOptions = command.opts<CommanderMvpOptions>();
  const merged: CommanderMvpOptions = { ...parentOptions };

  for (const key of ['dryRun', 'yes', 'json', 'manifest', 'localOnly', 'git', 'noGit'] as const) {
    const source = command.getOptionValueSource(key);
    if (source && source !== 'default') {
      merged[key] = localOptions[key] as never;
    }
  }

  return normalizeInitOptions(merged);
}

function normalizeInitOptions(options: CommanderMvpOptions): InitOptions {
  return {
    dryRun: Boolean(options.dryRun),
    yes: Boolean(options.yes),
    json: Boolean(options.json),
    manifest: options.manifest ?? DEFAULT_MANIFEST_PATH,
    localOnly: Boolean(options.localOnly),
    noGit: Boolean(options.noGit) || options.git === false,
  };
}

function validateInitOptions(options: InitOptions): void {
  if (options.noGit && !options.localOnly) {
    throw new CommandError('--no-git is only valid with --local-only.', {
      code: 'invalid-options',
      exitCode: 2,
    });
  }
}

function notImplemented(targetDir: string, options: InitOptions): CommandError {
  const preview = buildNotImplementedPreview({ targetDir, options });
  const error = new CommandError('caes-app init is not implemented until Phase 2.', {
    code: 'not-implemented',
    exitCode: 1,
  });
  Object.assign(error, { preview });
  return error;
}

function buildNotImplementedPreview(invocation: InitInvocation): PreviewPlan {
  return {
    command: 'init',
    summary: 'Phase 1 parses and validates init options; Phase 2 will implement template initialization.',
    steps: [
      {
        id: 'init.phase-2-placeholder',
        type: 'manual-prompt',
        target: invocation.targetDir,
        action: 'implement Phase 2 init behavior before applying mutations',
        source: 'caes-app Phase 1 CLI shell',
        state: 'skipped',
        confirmationScope: { kind: 'none' },
        preview: {
          status: 'not-implemented',
          message: 'caes-app init is not implemented until Phase 2.',
          targetDir: invocation.targetDir,
          options: invocation.options,
          previewOnly: invocation.options.json && !invocation.options.yes,
        },
      },
    ],
  };
}

function getErrorOptions(error: CommandError, program: Command): InitOptions {
  return (error as CommandErrorWithContext).cliOptions ?? normalizeInitOptions(program.opts<CommanderMvpOptions>());
}

function emitCommandError(error: CommandError, io: CliIo, options: InitOptions): void {
  const maybePreview = (error as CommandErrorWithContext).preview;
  if (options.json) {
    const payload = maybePreview
      ? {
          kind: 'result',
          status: 'error',
          error: {
            code: error.code,
            message: error.message,
          },
          preview: renderJsonPreview(maybePreview),
        }
      : {
          kind: 'error',
          error: {
            code: error.code,
            message: error.message,
          },
        };
    io.stdout(`${JSON.stringify(redactValue(payload), null, 2)}\n`);
    return;
  }

  if (maybePreview) {
    io.stdout(renderHumanPreview(maybePreview));
  }
  io.stderr(`${error.message}\n`);
}

const defaultIo: CliIo = {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
};

function isEntryPoint(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  void main();
}
