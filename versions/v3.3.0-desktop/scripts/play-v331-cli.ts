import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const output = resolve('artifacts/v331-play/benchmark/runtime/main.mjs');
mkdirSync(resolve('artifacts/v331-play/benchmark/runtime'), { recursive: true });
await build({ entryPoints: ['scripts/play-v331-benchmark.ts'], outfile: output,
  bundle: true, platform: 'node', target: 'node24', format: 'esm', external: ['esbuild'],
  define: { 'import.meta.env.BASE_URL': '"/"' } });
const main = await import(pathToFileURL(output).href + '?run=' + Date.now());
if(process.argv[2]==='build-only')console.log('Harness build passed; no policy table executed.');
else await main.main(process.argv.slice(2));
