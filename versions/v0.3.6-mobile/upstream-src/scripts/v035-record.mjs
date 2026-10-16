import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(process.env.BRIDGE_CODE_ROOT ?? '.');
const tag = process.env.BRIDGE_V035_TAG ?? 'baseline';
const outfile = resolve(`artifacts/v035-recorder-${tag}.mjs`);
await build({ entryPoints: ['scripts/v035-record.ts'], outfile, bundle: true, platform: 'node', target: 'node20', format: 'esm',
  plugins: [{ name: 'freeze-code-root', setup(b) {
    b.onResolve({ filter: /^\.\.\/src\// }, args => {
      const path = resolve(root, 'src', args.path.slice('../src/'.length));
      if (existsSync(path + '.ts')) return { path: path + '.ts' };
      return undefined;
    });
  } }] });
await import(new URL(`../artifacts/v035-recorder-${tag}.mjs?run=${Date.now()}`, import.meta.url));
