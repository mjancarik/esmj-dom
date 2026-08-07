// ---------------------------------------------------------------------------
// mount.mjs — top-level entry point to render into a DOM container
//
// Imports: component.mjs, lifecycle.mjs
// ---------------------------------------------------------------------------

import {
  isComponentInstance,
  mountComponentInstance,
} from './componentInstance.mjs';
import { cleanupTree } from './lifecycle.mjs';

/**
 * Render `rootChild` into `container`.
 *
 * On every call the container is fully torn down first:
 * - Signal effects stored directly on the container (e.g. from reactive
 *   children created via `createReactiveNode`) are disposed.
 * - All descendant component trees have their `onUnmount` hooks and signal
 *   effect disposers run via `cleanupTree`.
 *
 * This makes `mount` safe to call multiple times on the same container
 * (e.g. on client-side route changes) without leaking zombie effects.
 *
 * @param {string | Element} container  CSS selector or DOM element.
 * @param {*} rootChild                 Component instance, Node, or string.
 */
export function mount(container, rootChild) {
  if (typeof container === 'string') {
    container = document.querySelector(container);
  }
  if (!container) {
    throw new Error('mount: container not found');
  }

  const isFragment = container instanceof DocumentFragment;

  if (!isFragment) {
    // cleanupTree disposes signal effects stored on the container itself
    // (e.g. from createReactiveNode) as well as all descendant component
    // trees. This is more thorough than iterating only direct children,
    // which missed container-level disposers and caused zombie effects on
    // remount.
    cleanupTree(container);
    container.innerHTML = '';
  }

  if (isComponentInstance(rootChild)) {
    mountComponentInstance(container, rootChild);
  } else if (rootChild instanceof Node) {
    container.appendChild(rootChild);
  } else {
    container.appendChild(document.createTextNode(String(rootChild)));
  }
}

/**
 * Tear down the component tree inside `container` and clear its DOM.
 *
 * Runs all `onUnmount` hooks and disposes signal effects for every component
 * in the tree, then empties the container element. This is the symmetric
 * inverse of `mount`.
 *
 * @param {string | Element} container  CSS selector or DOM element.
 */
export function unmount(container) {
  if (typeof container === 'string') {
    container = document.querySelector(container);
  }
  if (!container) {
    throw new Error('unmount: container not found');
  }

  cleanupTree(container);
  container.innerHTML = '';
}
