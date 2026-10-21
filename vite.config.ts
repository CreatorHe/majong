import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// The authored game stays in dist/. Build output goes into ignored subdirectories.
export default defineConfig({
  publicDir: '.runtime/assets',
  plugins: [
    cloudflare({
      viteEnvironment: { name: 'server' },
      inspectorPort: false,
      config: {
        name: 'jade-run',
        main: './worker/index.js',
        compatibility_date: '2026-05-15',
        compatibility_flags: ['nodejs_compat'],
        assets: { binding: 'ASSETS', run_worker_first: ['/api/*'] },
        d1_databases: [{
          binding: 'DB',
          database_name: 'jade-run',
          database_id: process.env.CLOUDFLARE_D1_DATABASE_ID || '00000000-0000-4000-8000-000000000000',
        }],
      },
    }),
  ],
  environments: {
    client: { build: { outDir: 'dist/client', emptyOutDir: true } },
    server: { build: { outDir: 'dist/server', emptyOutDir: true } },
  },
});
