import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version?: string;
};
const sdkBuildVersion = packageJson.version || '0.0.0';

export default defineConfig({
  define: {
    __EXOCOR_SDK_VERSION__: JSON.stringify(sdkBuildVersion)
  },
  build: {
    emptyOutDir: false,
    outDir: 'dist/server',
    lib: {
      entry: 'src/server/index.ts',
      name: 'ExocorServer',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs')
    },
    rollupOptions: {
      external: ['@anthropic-ai/sdk']
    }
  }
});
