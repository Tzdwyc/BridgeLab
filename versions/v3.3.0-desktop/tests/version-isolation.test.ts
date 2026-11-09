import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CACHE_KEY } from '../src/analysis/client';
import { ARCHIVE_KEY, WORKSPACE_KEY } from '../src/analysis/persistence';
import { DEAL_LIBRARY_KEY } from '../src/deal-editor/model';
import { STORAGE_KEY } from '../src/persistence/session';

const text = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('v3.2.4 delivery identity and compatible storage', () => {
  it('retains the compatible v3.6 browser storage namespaces', () => {
    expect(STORAGE_KEY).toBe('bridgelab.session.v3.6');
    expect(CACHE_KEY).toBe('bridgelab.analysis.cache.v3.6');
    expect(WORKSPACE_KEY).toBe('bridgelab.analysis.workspace.v3.6');
    expect(ARCHIVE_KEY).toBe('bridgelab.analysis.archive.v3.6');
    expect(DEAL_LIBRARY_KEY).toBe('bridgelab.deal-editor.library.v3.6');
    expect(new Set([STORAGE_KEY, CACHE_KEY, WORKSPACE_KEY, ARCHIVE_KEY, DEAL_LIBRARY_KEY])).toHaveProperty('size', 5);
  });

  it('keeps package, server, launcher, PWA and release labels on v3.2.4', () => {
    const pkg = JSON.parse(text('../package.json')) as { version: string };
    expect(pkg.version).toBe('3.2.4');
    expect(text('../scripts/serve.mjs')).toContain('BRIDGELAB_PORT || 5215');
    expect(text('../启动BridgeLab-v3.2.4.cmd')).toContain('scripts\\start-desktop.mjs');
    const launcher = text('../scripts/start-desktop.mjs');
    expect(launcher).toContain('BRIDGELAB_PORT || 5215');
    expect(launcher).toContain('http://127.0.0.1:');
    expect(launcher).toContain("version:'3.2.4'");
    expect(text('../vite.config.ts')).toContain("cacheId: 'bridgelab-v3.2.4-r1'");
    expect(text('../vite.config.ts')).toContain("registerType: 'autoUpdate'");
    const packager = text('../scripts/package-release.py');
    expect(packager).toContain('BridgeLab-v3.2.4-desktop.zip');
    expect(packager).toContain("version='3.2.4'");
  });
});
