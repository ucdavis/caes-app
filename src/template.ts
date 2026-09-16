import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import { CommandError } from './errors.js';
import type { CaesAppManifest } from './manifest.js';
import type { GitRunner, TemplateFile, TemplateSnapshot } from './init-types.js';

export const TEMPLATE_REPOSITORY = 'ucdavis/web-app-template';
export const TEMPLATE_URL = `https://github.com/${TEMPLATE_REPOSITORY}.git`;
export const requiredTemplateFiles = [
  'package.json', 'package-lock.json', 'app.sln', 'README.customization.md', '.gitignore',
  'client/package.json', 'client/package-lock.json', 'client/vite.config.ts',
  'server/appsettings.json', 'server/appsettings.Development.json', 'server/server.csproj',
  'server/Properties/launchSettings.json', '.devcontainer/devcontainer.json', '.devcontainer/docker-compose.yml',
];

export const runGit: GitRunner = async (args, cwd, input) => {
  try {
    const result = await execa('git', args, {
      ...(cwd ? { cwd } : {}), ...(input === undefined ? {} : { input }),
      reject: false, timeout: 120_000,
      env: { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_DIR: undefined,
        GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined, GIT_COMMON_DIR: undefined },
    });
    if (result.failed && result.exitCode === undefined) throw new Error();
    return { stdout: result.stdout, exitCode: result.exitCode ?? 1 };
  } catch {
    throw new CommandError('Git could not run or timed out. Check Git installation and network access, then retry.', {
      code: 'execution-failed',
    });
  }
};

export async function requireGit(git: GitRunner, args: string[], cwd?: string): Promise<string> {
  const result = await git(args, cwd);
  if (result.exitCode !== 0) throw new CommandError(
    'Git operation failed. Check repository access and Git configuration, then retry. No command output was disclosed.',
    { code: 'execution-failed' },
  );
  return result.stdout;
}

export function validateSource(source: CaesAppManifest['templateSource']): void {
  if (source.repository !== TEMPLATE_REPOSITORY || !source.defaultBranch ||
      !/^[a-f0-9]{40}$/.test(source.resolvedCommitSha)) {
    throw new CommandError('Manifest template source must identify the trusted repository and a full commit SHA.', {
      code: 'conflict', exitCode: 2,
    });
  }
}

// The URL is fixed in production. Tests substitute a local Git repository through the runner.
export async function fetchTemplate(git: GitRunner = runGit, recorded?: CaesAppManifest['templateSource']): Promise<TemplateSnapshot> {
  let source = recorded;
  if (source) validateSource(source);
  else {
    const remote = await requireGit(git, ['ls-remote', '--symref', TEMPLATE_URL, 'HEAD']);
    const branch = remote.match(/^ref: refs\/heads\/(.+)\tHEAD$/m)?.[1];
    const sha = remote.match(/^([a-f0-9]{40})\tHEAD$/m)?.[1];
    if (!branch || !sha) throw new CommandError('Could not resolve the template default branch and commit.', { code: 'template-error' });
    source = { repository: TEMPLATE_REPOSITORY, defaultBranch: branch, resolvedCommitSha: sha };
  }
  const directory = await mkdtemp(join(tmpdir(), 'caes-app-source-'));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    await requireGit(git, ['-c', 'init.templateDir=', 'init', '--quiet', '--initial-branch=main'], directory);
    await requireGit(git, ['fetch', '--quiet', '--depth=1', TEMPLATE_URL, source.resolvedCommitSha], directory);
    const fetched = (await requireGit(git, ['rev-parse', 'FETCH_HEAD^{commit}'], directory)).trim();
    if (fetched !== source.resolvedCommitSha) throw new CommandError('Fetched template commit differs from the resolved commit.', { code: 'template-error' });
    const tree = await requireGit(git, ['ls-tree', '-rz', '--full-tree', fetched], directory);
    const entries = tree.split('\0').filter(Boolean).map((entry) => {
      const match = entry.match(/^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/);
      if (!match || !['100644', '100755'].includes(match[1]!) || match[2] !== 'blob') {
        throw new CommandError('Template contains an unsupported symlink, submodule, or tree entry.', { code: 'template-error' });
      }
      const name = match[4]!;
      if (name.split('/').some((part) => !part || part === '..' || part.toLowerCase() === '.git') || name.includes('\\')) {
        throw new CommandError('Template contains an unsafe file path.', { code: 'template-error' });
      }
      return { name, mode: match[1] === '100755' ? 0o755 : 0o644 };
    });
    await requireGit(git, ['-c', 'core.autocrlf=false', 'checkout', '--quiet', '--detach', fetched], directory);
    const authIgnored = await git(['-c', 'core.excludesFile=/dev/null', 'check-ignore', '--no-index', '--quiet', '--', 'server/.env'], directory);
    if (authIgnored.exitCode !== 0) throw new CommandError('Template .gitignore must cover server/.env.', { code: 'template-error', exitCode: 2 });
    const ignored = await git(['-c', 'core.excludesFile=/dev/null', 'check-ignore', '--no-index', '-z', '--stdin'], directory,
      entries.map((entry) => entry.name).join('\0') + '\0');
    if (ignored.exitCode > 1) throw new CommandError('Could not evaluate template ignore rules.', { code: 'template-error' });
    const excluded = new Set(ignored.stdout.split('\0'));
    const files = new Map<string, TemplateFile>();
    for (const { name, mode } of entries) {
      if (excluded.has(name) || name.split('/').some((part) => /^(node_modules|bin|obj|publish|dist|\.git)$/i.test(part))) continue;
      files.set(name, { content: await readFile(join(directory, name)), mode });
    }
    for (const file of requiredTemplateFiles) {
      if (!files.has(file)) throw new CommandError(`Template is missing required file ${file}.`, { code: 'template-error', exitCode: 2 });
    }
    return { source, files, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
