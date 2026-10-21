import { spawn } from 'node:child_process';

async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Preview step failed (${code})`)));
  });
}
await run(['scripts/build-analytics.mjs']);
const wrangler = ['--import', './scripts/local-env.mjs', './node_modules/wrangler/bin/wrangler.js'];
await run([...wrangler, 'd1', 'migrations', 'apply', 'DB', '--local', '--config', 'dist/server/wrangler.json', '--persist-to', '.wrangler/state']);
await run([...wrangler, 'dev', '--local', '--config', 'dist/server/wrangler.json', '--persist-to', '.wrangler/state', '--ip', '127.0.0.1', '--port', '4175', '--inspector-port', '0']);
