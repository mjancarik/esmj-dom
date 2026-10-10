import { defineConfig } from 'tsup';

export default [
  defineConfig({
    entry: ['src/index.mjs', 'src/jsx-runtime.mjs', 'src/jsx-dev-runtime.mjs'],
    clean: true,
    minify: true,
    target: 'es2022',
    // Only opt-in private fields may be renamed. Public component descriptors,
    // user props, signal methods, and DOM APIs must retain their property names.
    esbuildOptions(options) {
      options.mangleProps = /^_[a-zA-Z]/;
    },
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
