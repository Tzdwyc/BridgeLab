import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
mkdirSync('artifacts', { recursive: true });
await build({ entryPoints: ['scripts/record-auctions.ts'], outfile: 'artifacts/auction-recorder.mjs',
  bundle: true, platform: 'node', target: 'node20', format: 'esm' });
await import('../artifacts/auction-recorder.mjs?run=' + Date.now());
