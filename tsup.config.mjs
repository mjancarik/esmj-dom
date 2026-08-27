import { defineConfig } from 'tsup';

export default [
  defineConfig({
    entry: ['src/index.mjs', 'src/jsx-runtime.mjs', 'src/jsx-dev-runtime.mjs'],
    clean: true,
    minify: true,
    target: 'es2022',
    format: ['esm', 'cjs'],
    treeshake: true,
    shims: false,
    dts: true,
    outExtension({ format }) {
      return {
        js: format === 'cjs' ? '.cjs' : '.mjs',
      };
    },
  }),
];
