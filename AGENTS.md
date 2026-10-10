# Agent guide

## Project
- `@esmj/dom`: small reactive DOM library; no virtual DOM.
- JavaScript ESM (`.mjs`), JSDoc types, reactivity via `@esmj/signals`.
- `src/index.mjs`: public exports. Other `src/` modules implement DOM creation,
  components, lifecycle, control flow, and JSX runtimes.
- `src/__tests__/`: Node test runner + jsdom; `examples/`: Vite JSX demo.
- Edit source, not generated `dist/`. See `README.md` for API contracts.

## Changes
- Keep changes focused; preserve public APIs and ownership/cleanup semantics.
- Follow existing style: two spaces, single quotes, semicolons; Biome config.
- Add regression tests for fixes; update README for public API changes.
- Read only relevant files; report changes and validation briefly.
- Do not commit, version, publish, or push unless requested.

## Tasks (run from repository root)
- Install dependencies if needed: `npm install`.
- Validate code changes: `npm run agent:verify` (tests, lint, library/demo builds).
  Stops on the first failure; fix it before rerunning.
- Targeted tests: `npm run agent:test:file -- src/__tests__/Show.test.mjs`
  (replace filename; multiple files allowed).
- Individual checks: `npm run agent:test`, `npm run agent:lint`,
  `npm run agent:build`.
- Safe formatting fixes: `npm run agent:format` (file paths after `--` optional).
  Review edits; avoid unsafe `lint:fix`.
- Validate JSX/demo changes: `npm run agent:build:examples`.
- Report failures; never claim unrun checks passed.