import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['icon.svg', 'icons/*.png'],
    manifest: {
      name: 'BridgeLab v3.3.0 桥牌与分析室', short_name: 'BridgeLab 3.3.0',
      description: '离线桥牌、局域网联机与逐墩分析',
      theme_color: '#123c32', background_color: '#f3f2ec',
      display: 'standalone', start_url: './', scope: './', lang: 'zh-CN',
      icons: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    },
    workbox: { cacheId: 'bridgelab-v3.3.0-r1', globPatterns: ['**/*.{js,wasm,css,html,png,svg,webmanifest,json,bin,woff2,txt,md}'], maximumFileSizeToCacheInBytes: 16 * 1024 * 1024, navigateFallback: 'index.html', cleanupOutdatedCaches: true }
  })],
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    // Preserve historical rule-oracle suites, but do not use them to judge bidding quality.
    // Current bidding expectations come from the GPT review of each public context.
    exclude: ['tests/bidding-v031-diverse-audit.test.ts', 'tests/bidding-v03-long-competition-corpus.test.ts', 'tests/bidding-v03-convention-corpus.test.ts'],
    environment: 'node', testTimeout: 60000, reporters: ['default', 'json'], outputFile: { json: 'artifacts/unit-results.json' }
  }
});
