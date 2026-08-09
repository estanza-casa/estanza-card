import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

import packageJson from './package.json' with { type: 'json' };

const cardEntry = fileURLToPath(new URL('./src/card.ts', import.meta.url));

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __CARD_VERSION__: JSON.stringify(packageJson.version),
  },
  resolve: {
    dedupe: [
      '@react-three/drei',
      '@react-three/fiber',
      'react',
      'react-dom',
      'three',
    ],
  },
  build: {
    target: 'es2022',
    emptyOutDir: true,
    minify: true,
    lib: {
      entry: cardEntry,
      formats: ['es'],
      fileName: () => 'estanza-card.js',
    },
    rollupOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.spec.ts'],
    server: {
      deps: {
        inline: ['three', '@react-three/fiber', '@react-three/drei'],
      },
    },
  },
});
