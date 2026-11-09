import { build } from 'esbuild';
await build({ entryPoints: ['scripts/replay-chat-contexts.ts'], outfile: 'artifacts/chat-context-replay.mjs',
  bundle: true, platform: 'node', target: 'node20', format: 'esm' });
await import('../artifacts/chat-context-replay.mjs?run=' + Date.now());
