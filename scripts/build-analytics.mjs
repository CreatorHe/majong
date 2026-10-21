import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const assets = '.runtime/assets';
await rm(assets, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
for (const file of await readdir('dist')) {
  if (['client', 'server'].includes(file) || file.startsWith('.')) continue;
  await cp(`dist/${file}`, `${assets}/${file}`, { recursive: true });
}
const original = await readFile('dist/index.html', 'utf8');
if (!original.includes('</body>')) throw new Error('Game entry has no closing body');
const entry = original.replace('</body>', '  <script type="module" src="/analytics/boot.js"></script>\n</body>');
await writeFile(`${assets}/index.html`, entry);

await new Promise((resolveRun, reject) => {
  const child = spawn(process.execPath, ['--import', './scripts/local-env.mjs', './node_modules/vite/bin/vite.js', 'build'], { stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolveRun() : reject(new Error(`Vite build failed (${code})`)));
});

// Keep the migration path valid from the generated Worker configuration.
const configPath = 'dist/server/wrangler.json';
const config = JSON.parse(await readFile(configPath, 'utf8'));
for (const database of config.d1_databases ?? []) database.migrations_dir = '../../drizzle';
await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
for (const required of ['dist/server/index.js', 'dist/client/index.html', 'dist/client/analytics/index.html']) {
  await readFile(required);
}
if (await readFile('dist/index.html', 'utf8') !== original) throw new Error('Game entry changed during build; rebuild against the latest source');
console.log(`Built analytics Worker and preserved game assets at ${resolve('dist/client')}`);
