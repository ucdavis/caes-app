// Shared offline fixture for integration tests and packed-binary smoke tests.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export async function createTemplateFixture(directory) {
  const files = JSON.parse(await readFile(new URL('../tests/fixtures/template.json', import.meta.url), 'utf8'));
  const repo = join(directory, 'template.git');
  const init = spawnSync('git', ['-c', 'init.templateDir=', 'init', '--bare', '--initial-branch=main', repo], { encoding: 'utf8', timeout: 30_000 });
  if (init.status !== 0) throw new Error('Could not create fixture repository.');
  const chunks = [];
  const entries = Object.entries(files);
  entries.push(['asset.bin', Buffer.from([0, 1, 255, 13, 10, 128])]);
  for (let index = 0; index < entries.length; index++) {
    const data = Buffer.from(entries[index][1]);
    chunks.push(Buffer.from(`blob\nmark :${index + 1}\ndata ${data.length}\n`), data, Buffer.from('\n'));
  }
  chunks.push(Buffer.from('commit refs/heads/main\ncommitter Fixture <fixture@example.test> 1000000000 +0000\ndata 8\nfixture\n\n'));
  entries.forEach(([name], index) => chunks.push(Buffer.from(`M ${name.endsWith('.sh') ? '100755' : '100644'} :${index + 1} ${name}\n`)));
  chunks.push(Buffer.from('\ndone\n'));
  const imported = spawnSync('git', ['-C', repo, 'fast-import', '--quiet'], { input: Buffer.concat(chunks), encoding: 'utf8', timeout: 30_000 });
  if (imported.status !== 0) throw new Error(`Fixture import failed: ${imported.stderr}`);
  const revision = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 30_000 });
  if (revision.status !== 0) throw new Error('Could not resolve fixture commit.');
  const sha = revision.stdout.trim();
  // Pass only to child processes; never write a user's Git configuration.
  const gitEnv = {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `url.${pathToFileURL(repo).href}.insteadOf`,
    GIT_CONFIG_VALUE_0: 'https://github.com/ucdavis/web-app-template.git',
  };
  return { repo, sha, gitEnv };
}
