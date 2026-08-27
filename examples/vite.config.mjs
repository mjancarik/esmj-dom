// ---------------------------------------------------------------------------
// examples/vite.config.mjs — enables JSX for the examples/ demo.
//
// jsxImportSource is a relative path here ("../src") so the demo can run
// against the *local, unbuilt* source during development without needing to
// `npm run build` or install the package from a registry first. Vite/esbuild
// simply appends "/jsx-runtime" (or "/jsx-dev-runtime" in dev) to this value
// and resolves the result as an import specifier relative to each JSX file —
// e.g. from examples/index.jsx this resolves to ../src/jsx-runtime.mjs.
//
// A real consumer of the published package would instead set:
//   jsxImportSource: "@esmj/dom"
// in their own tsconfig.json ("jsx": "react-jsx") and/or bundler config.
// ---------------------------------------------------------------------------

import { defineConfig } from 'vite';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: '../src',
  },
});
