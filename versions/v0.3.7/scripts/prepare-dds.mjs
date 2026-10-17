import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const original = readFileSync(new URL('../node_modules/bridge-dds/dist/lib/dds.js', import.meta.url), 'utf8');
const needle = 'return moduleRtn;';
if (original.split(needle).length !== 2) throw new Error('Unexpected DDS loader; review the pinned dependency before preparing it');
// Only expose memory size for diagnostics. DDS code and embedded WASM are unchanged.
const patched = original.replace(needle, 'Module.getHeapBytes = () => wasmMemory.buffer.byteLength;\n  return moduleRtn;');
mkdirSync(new URL('../src/analysis/vendor/', import.meta.url), { recursive: true });
writeFileSync(new URL('../src/analysis/vendor/dds.mjs', import.meta.url), patched);
mkdirSync(new URL('../artifacts/', import.meta.url), { recursive: true });
const hash = value => createHash('sha256').update(value).digest('hex');
writeFileSync(new URL('../artifacts/dds-loader-provenance.json', import.meta.url), JSON.stringify({
  package: 'bridge-dds@1.4.0', license: 'Apache-2.0', upstream: 'https://github.com/bookchris/bridge-dds-js',
  originalSha256: hash(original), preparedSha256: hash(patched), patch: 'Expose wasmMemory.buffer.byteLength as getHeapBytes; embedded WASM unchanged'
}, null, 2));
console.log('DDS WASM loader prepared with memory diagnostics');
