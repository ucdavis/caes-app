#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Command, CommanderError } from 'commander';

import { CLI_NAME, CLI_VERSION, DEFAULT_MANIFEST_PATH } from './constants.js';
import { CommandError, isCommandError } from './errors.js';
import { renderJsonPreview, renderHumanPreview, type PreviewPlan } from './preview.js';
import { redactDiagnostic, redactValue } from './redaction.js';
import { initialize } from './init.js';
import type { InitDependencies } from './init-types.js';

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
  appId?: string;
  displayName?: string;
  serverPort?: string;
  clientPort?: string;
  databasePort?: string;
  authClientId?: string;
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

export function createProgram(io: CliIo, dependencies: Partial<InitDependencies> = {}): Command {
  const program = new Command();

  program.name(CLI_NAME)
    .description('CLI utility for managing CAES apps')
    .version(CLI_VERSION)
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: io.stdout,
      writeErr: (text) => { if (!isJsonMode(program)) io.stderr(text); },
      outputError: (text, write) => write(redactDiagnostic(text, parserArgs(program))),
    });

  addMvpOptions(program);

  const initCommand = program
    .command('init')
    .description('create a new app from the trusted CAES web app template')
    .argument('[target-dir]', 'target directory', '.');
  addMvpOptions(initCommand)
    .option('--app-id <id>', 'lowercase app identifier (defaults to target directory name)')
    .option('--display-name <name>', 'human-readable application name')
    .option('--server-port <port>', 'local HTTP server port')
    .option('--client-port <port>', 'local Vite port')
    .option('--database-port <port>', 'local SQL host port')
    .option('--auth-client-id <guid>', 'existing user sign-in application ID; stored only in server/.env');
  initCommand.action(async (targetDir: string) => {
    const options = collectMvpOptions(initCommand);
    try {
      validateInitOptions(options);
      await initialize({ targetDir, options }, io, dependencies);
    } catch (error) {
      if (isCommandError(error)) {
        Object.assign(error, { cliOptions: options });
      }
      throw error;
    }
  });

  return program;
}

export async function runCli(argv: readonly string[], io: CliIo = defaultIo, dependencies: Partial<InitDependencies> = {}): Promise<number> {
  const program = createProgram(io, dependencies);

  try {
    await program.parseAsync([...argv], { from: 'node' });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode !== 0 && isJsonMode(program)) {
        emitCommandError(new CommandError(redactDiagnostic(error.message, parserArgs(program)), {
          code: 'invalid-options', exitCode: error.exitCode,
        }), io, normalizeInitOptions({ json: true }));
      }
      return error.exitCode;
    }

    if (isCommandError(error)) {
      if (!(error as CommandError & { emitted?: boolean }).emitted) emitCommandError(error, io, getErrorOptions(error, program));
      return error.exitCode;
    }

    const fallback = 'Command could not complete. Check filesystem permissions and Git access, then retry.';
    emitCommandError(
      new CommandError(fallback, {
        code: 'execution-failed',
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
    .option('--no-git', 'with --local-only, skip target git initialization (Git is still required for retrieval)');
}

function collectMvpOptions(command: Command): InitOptions {
  const parentOptions = command.parent?.opts<CommanderMvpOptions>() ?? {};
  const localOptions = command.opts<CommanderMvpOptions>();
  const merged: CommanderMvpOptions = { ...parentOptions };

  for (const key of ['dryRun', 'yes', 'json', 'manifest', 'localOnly', 'git', 'noGit', 'appId', 'displayName', 'serverPort', 'clientPort', 'databasePort', 'authClientId'] as const) {
    const source = command.getOptionValueSource(key);
    if (source && source !== 'default') {
      merged[key] = localOptions[key] as never;
    }
  }

  return normalizeInitOptions(merged);
}

function normalizeInitOptions(options: CommanderMvpOptions): InitOptions {
  return {
    ...Object.fromEntries(['appId', 'displayName', 'serverPort', 'clientPort', 'databasePort', 'authClientId']
      .filter((key) => options[key as keyof InitOptions] !== undefined)
      .map((key) => [key, options[key as keyof InitOptions]])),
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
  if (!options.localOnly) {
    throw new CommandError('GitHub repository creation arrives in Phase 3. Use --local-only for local initialization.', { code: 'not-implemented', exitCode: 1 });
  }
}

function getErrorOptions(error: CommandError, program: Command): InitOptions {
  return (error as CommandErrorWithContext).cliOptions ?? normalizeInitOptions(program.opts<CommanderMvpOptions>());
}

function parserArgs(program: Command): readonly string[] {
  // Commander 15 stores the original invocation here before parsing, but omits
  // rawArgs from its types. Keep access isolated and cover both parse modes.
  return (program as Command & { rawArgs: readonly string[] }).rawArgs;
}

function isJsonMode(program: Command): boolean {
  return Boolean(program.opts<CommanderMvpOptions>().json ||
    program.commands.find((command) => command.name() === 'init')?.opts<CommanderMvpOptions>().json);
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
