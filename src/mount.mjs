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

  container.innerHTML = '';

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
