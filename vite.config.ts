import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version?: string;
};
const sdkBuildVersion = packageJson.version || '0.0.0';

export default defineConfig({
  define: {
    __EXOCOR_SDK_VERSION__: JSON.stringify(sdkBuildVersion)
  },
  plugins: [react()],
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'src/index.ts',
      name: 'ExocorSDK',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.esm.js' : 'index.js')
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@anthropic-ai/sdk',
        '@mediapipe/tasks-vision'
      ]
    }
  },
  test: {
    environment: 'jsdom',
    globals: true
  }
});
