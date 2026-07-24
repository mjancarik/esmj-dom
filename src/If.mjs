// ---------------------------------------------------------------------------
// If.mjs — conditional rendering primitive
//
// API (v2 style): If(condition, thenChild, elseChild)
//   - condition:  () => boolean
//   - thenChild:  pre-built Node OR component instance descriptor
//   - elseChild:  pre-built Node OR component instance descriptor (optional)
//
// Ownership model (fixes the v2 clearContainer bug):
//   - Pre-built Node (passed in directly): BORROWED — only detach on branch
//     switch, never cleanupTree. This preserves _disposers so reactive attrs
//     keep working across multiple toggles.
//   - Component instance ($constructor result): OWNED — full cleanupTree on
//     deactivation, fresh $constructor call on re-activation.
//
// Imports: component.mjs, lifecycle.mjs, @esmj/signals, easy-uid
// ---------------------------------------------------------------------------

import { computed, effect, untrack } from '@esmj/signals';
import uid from 'easy-uid';
import { isComponentInstance } from './componentInstance.mjs';
import { cleanupTree, runMountHooks } from './lifecycle.mjs';
import { addDisposer } from './runtime.mjs';

/**
 * Conditional rendering primitive — renders one of two branches based on a
 * reactive condition, with full DOM lifecycle management.
 *
 * Ownership model:
 * - Pre-built `Node` (passed directly): **borrowed** — only detached on branch
 *   switch, never torn down. Reactive attributes and disposers are preserved
 *   across multiple toggles.
 * - Component instance (descriptor returned by a component function): **owned**
 *   — fully torn down (`cleanupTree`) on deactivation and re-constructed on
 *   re-activation. `onMount`/`onUnmount` hooks fire accordingly.
 *
 * @template {Node|import('./componentInstance.mjs').ComponentInstance} T
 * @param {() => boolean} condition  Reactive predicate; re-evaluated on every
 *   signal change it depends on.
 * @param {T} thenChild  Branch rendered when `condition` is truthy.
 * @param {T} [elseChild]  Branch rendered when `condition` is falsy (optional).
 * @returns {HTMLSpanElement}  A `display:contents` wrapper that is transparent
 *   to CSS layout.
 */
export function If(condition, thenChild, elseChild) {
  // display:contents makes the wrapper invisible to CSS layout while its
  // children participate in the parent's layout normally.
  const container = document.createElement('span');
  container.style.display = 'contents';
  container.setAttribute('data-if', uid());

  let currentBranch = null; // 'then' | 'else' | null
  let currentElement = null; // the DOM node currently active in this container
  let currentOwned = false; // true → we own it and must cleanupTree on switch

  const conditionComputed = computed(() => !!condition());

  const dispose = effect(() => {
    const result = conditionComputed.get();
    const newBranch = result ? 'then' : 'else';

    if (newBranch === currentBranch) return;
    currentBranch = newBranch;

    // Deactivate the current branch
    if (currentElement) {
      if (currentOwned) {
        // Component instance result: fully teardown (unmount hooks + disposers)
        cleanupTree(currentElement);
      }
      // In both cases remove from DOM
      currentElement.remove();
      currentElement = null;
      currentOwned = false;
    }

    // Activate the new branch
    const child = result ? thenChild : elseChild;
    if (child == null) return;

    // Wrap DOM construction in untrack so signals read during $constructor
    // do not accidentally become dependencies of this effect.
    untrack(() => {
      if (isComponentInstance(child)) {
        // Owned: create fresh DOM + run lifecycle
        const el = child.$constructor();
        if (el instanceof Node) {
          container.appendChild(el);
          currentElement = el;
          currentOwned = true;
        }
        queueMicrotask(() => runMountHooks(child));
      } else if (child instanceof Node) {
        // Borrowed: just re-attach, keep _disposers intact
        container.appendChild(child);
        currentElement = child;
        currentOwned = false;
      }
    });
  });

  addDisposer(container, dispose);

  return container;
}
