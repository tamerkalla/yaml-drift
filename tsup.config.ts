import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: false,
    clean: true,
    target: 'node20',
    outExtension({ format }) {
      return { js: format === 'cjs' ? '.cjs' : '.js' };
    },
  },
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: false,
    clean: false,
    target: 'node20',
  },
]);
