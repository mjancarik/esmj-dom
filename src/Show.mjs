// ---------------------------------------------------------------------------
// Show.mjs — CSS-based conditional visibility
//
// Show(condition, child) toggles element.style.display between '' and 'none'.
// Unlike If, the element is NEVER removed from the DOM — useful when you want
// to preserve state or avoid remounting cost.
//
// Complement: use If when you want full DOM teardown + lifecycle hooks to fire.
//
// Imports: component.mjs, lifecycle.mjs, @esmj/signals
// ---------------------------------------------------------------------------

import { computed, effect } from '@esmj/signals';

import { isComponentInstance } from './componentInstance.mjs';
import { runMountHooks } from './lifecycle.mjs';
import { addDisposer } from './runtime.mjs';

/**
 * CSS-based conditional visibility — toggles `element.style.display` between
 * `''` (visible) and `'none'` (hidden) based on a reactive condition.
 *
 * Unlike `If`, the element is **never removed from the DOM**. This preserves
 * internal state and avoids remounting cost, but means lifecycle hooks
 * (`onMount`/`onUnmount`) do **not** fire on visibility changes.
 *
 * Use `If` when you need full DOM teardown and lifecycle hooks to fire.
 *
 * @param {() => boolean} condition  Reactive predicate; re-evaluated on every
 *   signal change it depends on.
 * @param {Node|import('./componentInstance.mjs').ComponentInstance|string} child
 *   The child to show or hide. Component instances are constructed immediately;
 *   strings are wrapped in a `Text` node.
 * @returns {Node}  The (possibly wrapped) child node.
 */
export function Show(condition, child) {
  let element = null;

  if (isComponentInstance(child)) {
    element = child.$constructor();
    queueMicrotask(() => runMountHooks(child));
  } else if (child instanceof Node) {
    element = child;
  } else {
    element = document.createTextNode(String(child));
  }

  if (element instanceof HTMLElement) {
    const conditionComputed = computed(() => !!condition());
    const dispose = effect(() => {
      element.style.display = conditionComputed.get() ? '' : 'none';
    });
    addDisposer(element, dispose);
  }

  return element;
}
