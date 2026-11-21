import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const hduTarget = process.env.HDU_HELPER_URL ?? 'http://127.0.0.1:8000';
const hduProxy = {
  target: hduTarget,
  changeOrigin: true,
  configure(proxy: { on: (event: 'proxyReq', handler: (request: { setHeader: (name: string, value: string) => void }) => void) => void }) {
    proxy.on('proxyReq', (request) => {
      request.setHeader('origin', new URL(hduTarget).origin);
      request.setHeader('sec-fetch-site', 'same-origin');
    });
  },
};

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ['ical.js', 'd3-geo', 'topojson-client'] },
  server: { host: '127.0.0.1', watch: { ignored: ['**/.tmp-edge*/**', '**/*.tmpdir/**', '**/tools/**', '**/test-results/**', '**/local-sync/data/**'] }, proxy: { '/web': hduProxy, '/api': 'http://127.0.0.1:18787' } },
  preview: { proxy: { '/web': hduProxy, '/api': 'http://127.0.0.1:18787' } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
