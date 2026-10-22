import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'link-miniapp-package-'));
// npm passes its CLI path to scripts; fall back to PATH for direct invocation.
// Always create and install the archive, including during npm publish --dry-run.
const npm = (args, cwd = root) => process.env.npm_execpath
  ? execFileSync(process.execPath, [process.env.npm_execpath, ...args, '--dry-run=false'], { cwd, encoding: 'utf8' })
  : execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [...args, '--dry-run=false'], { cwd, encoding: 'utf8' });
try {
  const [archive] = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary]));
  assert.deepEqual(archive.files.map(file => file.path).sort(), [
    'CHANGELOG.md', 'LICENSE', 'README.md', 'browser-host.d.ts', 'browser-host.js',
    'index.d.ts', 'index.js', 'package.json',
  ].sort());
  const consumer = join(temporary, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  npm(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', join(temporary, archive.filename)], consumer);
  const installed = JSON.parse(await readFile(join(consumer, 'node_modules/@link-apps/miniapp/package.json'), 'utf8'));
  assert.notEqual(installed.private, true);
  assert.equal(installed.name, '@link-apps/miniapp');
  assert.equal(installed.dependencies, undefined);
  await copyFile(join(root, 'test/package-consumer.mjs'), join(consumer, 'consumer.mjs'));
  await copyFile(join(root, 'test/types.mts'), join(consumer, 'types.mts'));
  execFileSync(process.execPath, [join(consumer, 'consumer.mjs')], { cwd: consumer, stdio: 'inherit' });
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--target', 'ES2022', '--lib', 'ES2022,DOM',
    '--module', 'NodeNext', '--moduleResolution', 'NodeNext', 'types.mts'], { cwd: consumer, stdio: 'inherit' });
  console.log(`Package verified: ${archive.filename} (${archive.files.length} files, ${archive.size} bytes)`);
} finally { await rm(temporary, { recursive: true, force: true }); }
