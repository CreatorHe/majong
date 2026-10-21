import { spawn } from 'node:child_process';

if (!process.env.CLOUDFLARE_D1_DATABASE_ID) {
  throw new Error('Set CLOUDFLARE_D1_DATABASE_ID to your Cloudflare D1 database ID before deploying.');
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

await run(process.execPath, ['scripts/build-analytics.mjs']);
const wrangler = './node_modules/wrangler/bin/wrangler.js';
const config = 'dist/server/wrangler.json';
await run(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'DB', '--remote', '--config', config]);
await run(process.execPath, [wrangler, 'deploy', '--config', config]);
