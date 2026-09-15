// Shared offline fixture for integration tests and packed-binary smoke tests.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export async function createTemplateFixture(directory) {
  const files = JSON.parse(await readFile(new URL('../tests/fixtures/template.json', import.meta.url), 'utf8'));
  const repo = join(directory, 'template.git');
  const init = spawnSync('git', ['-c', 'init.templateDir=', 'init', '--bare', '--initial-branch=main', repo], { encoding: 'utf8' });
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
  const imported = spawnSync('git', ['-C', repo, 'fast-import', '--quiet'], { input: Buffer.concat(chunks), encoding: 'utf8' });
  if (imported.status !== 0) throw new Error(`Fixture import failed: ${imported.stderr}`);
  const shimDir = join(directory, 'bin');
  await mkdir(shimDir, { recursive: true });
  const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  const shim = `#!${process.execPath}\nimport { spawnSync } from 'node:child_process';\nconst args = process.argv.slice(2).map(arg => arg === 'https://github.com/ucdavis/web-app-template.git' ? ${JSON.stringify(repo)} : arg);\nconst result = spawnSync(${JSON.stringify(realGit)}, args, {stdio: 'inherit'});\nprocess.exit(result.status ?? 1);\n`;
  // .mjs implementation plus shell-free CommonJS launcher works with PATH lookup.
  await writeFile(join(shimDir, 'git.mjs'), shim);
  await writeFile(join(shimDir, 'git'), `#!${process.execPath}\nimport(${JSON.stringify(join(shimDir, 'git.mjs'))});\n`, { mode: 0o755 });
  const sha = spawnSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
  return { repo, shimDir, sha };
}
