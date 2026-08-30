import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';

type RuntimeEnvironment = Record<string, string | undefined>;

export function resolveApiOrigin(environment: RuntimeEnvironment) {
  const explicitOrigin = environment.VITE_API_ORIGIN?.trim();
  if (explicitOrigin) return explicitOrigin.replace(/\/+$/, '');
  return `http://127.0.0.1:${environment.PORT?.trim() || '4546'}`;
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: true,
      proxy: {
        '/api': resolveApiOrigin(environment),
      },
    },
    preview: {
      host: '127.0.0.1',
      port: 5174,
      strictPort: true,
    },
    test: {
      environment: 'node',
      setupFiles: ['./tests/setup.ts'],
      css: true,
    },
  };
});
