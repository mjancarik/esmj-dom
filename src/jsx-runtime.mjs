// ---------------------------------------------------------------------------
// jsx-runtime.mjs — entry point for TypeScript/Babel/esbuild's *automatic*
// JSX transform (`"jsx": "react-jsx"` + `jsxImportSource: "@esmj/dom"`).
//
// Imports: createElement.mjs
// Exports: jsx, jsxs, Fragment
// ---------------------------------------------------------------------------

import { createElement, Fragment } from './createElement.mjs';

/**
 * Shared implementation for `jsx` / `jsxs`. The automatic transform places
 * children directly on `props.children` (a single value for `jsx`, always an
 * array for `jsxs`) instead of passing them as extra positional arguments, so
 * we pull `children` out of `props` and forward it as createElement's third
 * positional argument.
 */
function jsxToElement(type, props) {
  const { children, ...rest } = props ?? {};
  return createElement(type, rest, children);
}

/**
 * Automatic-runtime factory used for elements with zero or one child.
 *
 * @param {string | Function | typeof Fragment} type
 * @param {Record<string, *>} props
 * @param {string | number | undefined} _key  Development/reconciliation key
 *   from the JSX transform. `@esmj/dom`'s own `For()` primitive handles
 *   keyed list reconciliation explicitly, so this is accepted but ignored.
 */
export function jsx(type, props, _key) {
  return jsxToElement(type, props);
}

/**
 * Automatic-runtime factory used for elements with multiple (static) children.
 * Identical behavior to `jsx` — `@esmj/dom`'s `createElement` already accepts
 * an array as its children argument.
 *
 * @param {string | Function | typeof Fragment} type
 * @param {Record<string, *>} props
 * @param {string | number | undefined} _key  See `jsx` — accepted, ignored.
 */
export function jsxs(type, props, _key) {
  return jsxToElement(type, props);
}

export { Fragment };
