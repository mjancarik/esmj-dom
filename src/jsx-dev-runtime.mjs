// ---------------------------------------------------------------------------
// jsx-dev-runtime.mjs — entry point for the *automatic* JSX transform in
// development mode (`"jsxImportSource": "@esmj/dom"` with dev-time tooling
// that imports from `<jsxImportSource>/jsx-dev-runtime` instead of
// `/jsx-runtime`, e.g. Babel's `development: true` or Vite dev builds).
//
// Imports: createElement.mjs
// Exports: jsxDEV, Fragment
// ---------------------------------------------------------------------------

import { createElement, Fragment } from './createElement.mjs';

/**
 * Automatic-runtime dev factory. Behaves identically to `jsx`/`jsxs` from
 * `jsx-runtime.mjs` — the extra development-only arguments (source location,
 * `this` context, static-children flag) are accepted for API compatibility
 * but not used, since `@esmj/dom` has no dev-only JSX warnings to emit.
 *
 * @param {string | Function | typeof Fragment} type
 * @param {Record<string, *>} props
 * @param {string | number | undefined} _key  See jsx-runtime.mjs — accepted, ignored.
 * @param {boolean} [_isStaticChildren]  Ignored.
 * @param {object} [_source]  Ignored.
 * @param {*} [_self]  Ignored.
 */
export function jsxDEV(type, props, _key, _isStaticChildren, _source, _self) {
  const { children, ...rest } = props ?? {};
  return createElement(type, rest, children);
}

export { Fragment };
