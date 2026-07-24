// ---------------------------------------------------------------------------
// Each.mjs — keyed list rendering with reactive item signals
//
// API: Each(itemsAccessor, keyFn, renderFn)
//   - itemsAccessor: () => Item[]
//   - keyFn:         (item: Item, index: number) => string | number
//   - renderFn:      (itemSignal: Signal<Item>, index: number) => Node
//
// Reactive item pattern (Solid.js For):
//   Each item gets its own Signal<Item>. When the items array is updated:
//     - Existing key → signal.set(newItem) — in-place reactive update,
//       no remount, onMount/onUnmount do NOT fire.
//     - New key      → fresh signal + fresh DOM via renderFn.
//     - Removed key  → cleanupTree + DOM removal.
//
//   renderFn receives a read-only signal { get() } — no .set().
//   Access item fields reactively: `() => item.get().text`.
//
// Imports: component.mjs, lifecycle.mjs, @esmj/signals, easy-uid
// ---------------------------------------------------------------------------

import { computed, createSignal, effect } from '@esmj/signals';
import uid from 'easy-uid';

import { isComponentInstance } from './componentInstance.mjs';
import { cleanupTree, runMountHooks } from './lifecycle.mjs';
import {
  addDisposer,
  deepEqual,
  getInternalContext,
  withContext,
} from './runtime.mjs';

/**
 * Keyed list rendering primitive with reactive per-item signals.
 *
 * Each item in the list gets its own `Signal<Item>`. On every update:
 * - **Existing key** → `itemSignal.set(newItem)` — in-place reactive update;
 *   no DOM reconstruction, `onMount`/`onUnmount` do **not** fire.
 * - **New key** → fresh signal + fresh DOM element via `renderFn`;
 *   `onMount` fires after the microtask queue drains.
 * - **Removed key** → `cleanupTree` + DOM removal; `onUnmount` fires.
 *
 * `renderFn` receives a **read-only** signal `{ get() }` — calling `.set()`
 * is a no-op. Access item fields reactively: `() => item.get().text`.
 *
 * @template Item
 * @param {() => Item[]} itemsAccessor  Reactive accessor returning the current
 *   array of items.
 * @param {(item: Item, index: number) => string|number} keyFn  Returns a
 *   stable unique key for each item. Must be unique within the list.
 * @param {(itemSignal: { get(): Item }, index: number) => Node} renderFn
 *   Called once per new key to produce a DOM node for that item.
 * @returns {HTMLSpanElement}  A `display:contents` wrapper that is transparent
 *   to CSS layout.
 */
export function Each(itemsAccessor, keyFn, renderFn) {
  const container = document.createElement('span');
  container.style.display = 'contents';
  container.setAttribute('data-each', uid());

  // Capture the component context active when Each() is constructed (i.e. the
  // parent component's context). Newly-created children inside the reactive
  // effect must inherit this context — but at effect re-run time the global
  // context is null, so we restore it manually around renderFn calls.
  const capturedContext = getInternalContext();

  // currentEntries: Array<{ key, element: Node | null }>
  let currentEntries = [];

  // Per-key item signals. Kept alive as long as the key is in the list.
  const itemSignalMap = new Map();

  // Wrap itemsAccessor in computed so the reconciliation effect only re-runs
  // when the array itself changes, not on every unrelated signal update.
  const itemsComputed = computed(() => itemsAccessor());

  const dispose = effect(() => {
    const items = itemsComputed.get();
    //const items = itemsAccessor();

    const newKeys = items.map((item, index) => keyFn(item, index));
    const oldMap = new Map(currentEntries.map((e) => [e.key, e]));

    const newEntries = [];

    for (let i = 0; i < items.length; i++) {
      const key = newKeys[i];
      const item = items[i];
      const existing = oldMap.get(key);

      if (existing) {
        // Existing key: push updated value into the item signal.
        // Any reactive expressions inside the rendered element (e.g. `() => item().text`)
        // will update automatically — no DOM reconstruction needed.
        itemSignalMap.get(key).set(item);
        newEntries.push(existing);
        oldMap.delete(key);
      } else {
        // New key: create a fresh item signal and render a new element.
        const itemSignal = createSignal(item, { equals: deepEqual });
        itemSignalMap.set(key, itemSignal);

        const readonlySignal = { ...itemSignal, set() {} };
        const entry = { key, element: null };

        //untrack(() => {
        let child;
        withContext(capturedContext, () => {
          child = renderFn(readonlySignal, i);

          if (child instanceof Node) {
            entry.element = child;
          } else if (isComponentInstance(child)) {
            const element = child.$constructor();
            entry.element = element instanceof Node ? element : null;
            queueMicrotask(() => runMountHooks(child));
          }
        });
        //});

        newEntries.push(entry);
      }
    }

    // Remove entries whose keys are no longer present.
    // cleanupTree handles both element _disposers and component lifecycle —
    // no need for redundant explicit runUnmountHooks / disposeComponent calls.
    for (const [key, entry] of oldMap) {
      if (entry.element) {
        cleanupTree(entry.element);
        entry.element.remove();
      }
      itemSignalMap.delete(key);
    }

    // Reorder DOM children to match the new order using minimal moves.
    const currentChildren = container.childNodes;
    for (let i = 0; i < newEntries.length; i++) {
      const entry = newEntries[i];
      if (!entry.element) continue;

      const currentChild = currentChildren[i];
      if (currentChild !== entry.element) {
        container.insertBefore(entry.element, currentChild || null);
      }
    }

    currentEntries = newEntries;
  });

  addDisposer(container, dispose);

  return container;
}
