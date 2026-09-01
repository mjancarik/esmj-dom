// ---------------------------------------------------------------------------
// For.mjs — keyed list rendering with reactive item signals
//
// Two calling conventions (dual-mode dispatcher, see `For` at the bottom):
//
// 1) Low-level:    For(itemsAccessor, keyFn, renderFn, options?)
//   - itemsAccessor: () => Item[]
//   - keyFn:         (item: Item, index: number) => string | number
//   - renderFn:      (itemSignal: Signal<Item>, index: number) => Node
//   - options.equals:  (prev: Item, next: Item) => boolean — default deepEqual
//   - options.tagName: string — wrapper element tag, default 'span'
//
// 2) JSX props:    <For each={items} keyFn={keyFn} tagName="tbody" equals={...}>
//                    {(itemSignal, index) => <tr>...</tr>}
//                  </For>
//   - props.each:    () => Item[] | Signal<Item[]> | Item[] — normalized like
//                    a regular reactive prop when routed through JSX/
//                    createElement (wrapped in computed()/createSignal() as
//                    needed), then coerced via `toAccessor` (see
//                    runtime.mjs). Passing it a plain function/signal
//                    directly (low-level or bypassing componentInstance)
//                    also works — `toAccessor` handles all shapes. Named
//                    `each` (not `items`) so the low-level positional API
//                    (`itemsAccessor`) and the JSX prop share the same
//                    reactive-source concept — reads naturally as
//                    `<For each={items}>`, without the `Each each={...}`
//                    stutter the old component name had.
//   - props.keyFn:   (item: Item, index: number) => string | number —
//                    REQUIRED, throws if missing. Named `keyFn` (not `key`)
//                    because `key` is a reserved JSX attribute — every JSX
//                    transform (Babel/esbuild/SWC/TS) strips a literal
//                    `key={...}` attribute out of `props` before the
//                    component ever sees it, passing it as a separate
//                    positional argument instead. Declared as a RAW_PROPS
//                    key so it stays a plain callback, never wrapped in
//                    computed().
//   - props.equals / props.tagName: same as options above; also RAW_PROPS
//                    keys (equals is a plain multi-arg comparator, tagName
//                    is a literal string — neither should be signal-wrapped).
//   - any other prop (class, $ref, style, onClick, data-*, …): forwarded to
//                    the wrapper element via `applyProps` — same behavior as
//                    a regular DOM element's props (static values, plain
//                    functions, and signals are all supported).
//   - props.children (or, for direct calls bypassing componentInstance, the
//                    2nd positional argument): renderFn (a single function),
//                    or an array whose first element is renderFn. `For` is
//                    called exactly like any other function component via
//                    componentInstance — `fn(props)`, one argument, with
//                    `children` merged in as `props.children`.
//   `For` declares `RAW_PROPS = (key) => key !== 'each'`, so every prop
//   except `each` is passed through untouched — no `keepLiteral()` needed,
//   and arbitrary wrapper props reach `applyProps` in their original shape.
//   `each` keeps normal reactive-prop normalization.
//
// Reactive item pattern (Solid.js For):
//   Each item gets its own Signal<Item>. When the items array is updated:
//     - Existing key → signal.set(newItem) — in-place reactive update,
//       no remount, onMount/onUnmount do NOT fire. Whether this actually
//       notifies subscribers depends on options.equals (see below).
//     - New key      → fresh signal + fresh DOM via renderFn.
//     - Removed key  → cleanupTree + DOM removal.
//
//   renderFn receives a read-only signal { get() } — no .set().
//   Access item fields reactively: `() => item.get().text`.
//   renderFn may also return a Fragment — each of its children is tracked
//   and reordered/removed as a group. See resolveRenderedNodes in
//   createElement.mjs.
//
//   options.equals defaults to deepEqual, which skips notifying subscribers
//   when a replacement item is structurally identical to the previous one.
//   That's usually desirable, but it breaks contenteditable/DOM-ahead-of-model
//   UIs: if the DOM has diverged from the model (e.g. mid-edit) and a
//   programmatic update "corrects" the model to a value that is deep-equal to
//   what it already held, reactive DOM bindings (e.g. $dangerouslySetInnerHTML)
//   never re-run and the stale DOM is left in place. Pass a reference-identity
//   equals (`(a, b) => a === b`) to force every new item object through to
//   subscribers. Contract: consumers using a custom equals must assign a new
//   object reference at changed indices — unchanged indices may keep the same
//   reference to avoid redundant updates.
//
// Imports: component.mjs, createElement.mjs, @esmj/signals
// ---------------------------------------------------------------------------

import { computed, createSignal, effect } from '@esmj/signals';

import {
  applyProps,
  removeRenderedNodes,
  resolveRenderedNodes,
} from './createElement.mjs';
import { runMountHooks } from './lifecycle.mjs';
import {
  addDisposer,
  createControlFlowContainer,
  deepEqual,
  getInternalContext,
  RAW_PROPS,
  resolveChild,
  toAccessor,
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
 * By default, existing-key updates use structural (`deepEqual`) equality for
 * the per-item signal, so a replacement item that is deep-equal to the
 * previous one does **not** notify subscribers — no-op for static lists.
 * Pass `options.equals` to override this, e.g. reference identity
 * (`(a, b) => a === b`) for contenteditable/DOM-ahead-of-model UIs, where a
 * model "correction" that happens to match a prior deep-equal snapshot must
 * still force reactive DOM bindings to re-run. Contract: consumers relying on
 * a custom `equals` must assign a **new object reference** at changed indices
 * for the signal to notify — unchanged indices may keep the same reference.
 *
 * @template Item
 * @param {() => Item[]} itemsAccessor  Reactive accessor returning the current
 *   array of items. A non-array return value (e.g. `undefined` from a
 *   misconfigured `each` prop) is treated as an empty list rather than
 *   throwing.
 * @param {(item: Item, index: number) => string|number} keyFn  Returns a
 *   stable unique key for each item. Must be unique within the list.
 * @param {(itemSignal: { get(): Item }, index: number) => Node} renderFn
 *   Called once per new key to produce a DOM node for that item.
 * @param {{ equals?: (prev: Item, next: Item) => boolean, tagName?: string, [key: string]: * }} [options]
 *   Optional settings. `equals` controls the per-item signal's equality check
 *   on existing-key updates; defaults to `deepEqual`. `tagName` sets the
 *   wrapper element's tag (default `'span'`) — use this when the default
 *   `<span>` would violate the parent's content model (e.g. `{ tagName:
 *   'tbody' }` inside a `<table>`). Note: no tag choice fixes `<ul>`/`<ol>`/
 *   `<select>` parents, which only accept their specific item tag as a
 *   direct child regardless of wrapper tag — see README. Any other key
 *   (`class`, `$ref`, `style`, `onClick`, `data-*`, …) is applied to the
 *   wrapper element via the same `applyProps` logic used for regular DOM
 *   elements — static values, functions, and signals are all supported.
 * @returns {HTMLElement}  The wrapper element. Only the default/fallback
 *   `<span>` gets `display:contents` (to stay transparent to CSS layout); an
 *   explicitly chosen `tagName` keeps its normal display since it's assumed
 *   to already be valid for its context (e.g. `'tbody'` in a `<table>`).
 */
function ForImpl(itemsAccessor, keyFn, renderFn, options) {
  const {
    equals = deepEqual,
    tagName = 'span',
    ...containerProps
  } = options ?? {};
  const container = createControlFlowContainer(
    tagName,
    'data-for',
    containerProps,
  );
  applyProps(container, containerProps);

  // Capture the component context active when For() is constructed (i.e. the
  // parent component's context). Newly-created children inside the reactive
  // effect must inherit this context — but at effect re-run time the global
  // context is null, so we restore it manually around renderFn calls.
  const capturedContext = getInternalContext();

  // currentEntries: Array<{ key, nodes: Node[] }>
  let currentEntries = [];

  // Per-key item signals. Kept alive as long as the key is in the list.
  const itemSignalMap = new Map();

  // Wrap itemsAccessor in computed so the reconciliation effect only re-runs
  // when the array itself changes, not on every unrelated signal update.
  const itemsComputed = computed(() => itemsAccessor());

  const dispose = effect(() => {
    const rawItems = itemsComputed.get();
    const items = Array.isArray(rawItems) ? rawItems : [];
    const uniqueItems = [];
    const newKeys = [];
    const seenKeys = new Set();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const key = keyFn(item, i);
      if (seenKeys.has(key)) {
        console.error(
          `For: duplicate key "${String(key)}" detected; ignoring later item at index ${i}`,
        );
        continue;
      }
      seenKeys.add(key);
      uniqueItems.push(item);
      newKeys.push(key);
    }
    const oldMap = new Map(currentEntries.map((e) => [e.key, e]));

    const newEntries = [];

    for (let i = 0; i < uniqueItems.length; i++) {
      const key = newKeys[i];
      const item = uniqueItems[i];
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
        const itemSignal = createSignal(item, { equals });
        itemSignalMap.set(key, itemSignal);

        const readonlySignal = { ...itemSignal, set() {} };
        const entry = { key, nodes: [] };

        withContext(capturedContext, () => {
          const child = renderFn(readonlySignal, i);
          const { nodes, instance } = resolveRenderedNodes(child);
          entry.nodes = nodes;
          if (instance) {
            queueMicrotask(() => runMountHooks(instance));
          }
        });

        newEntries.push(entry);
      }
    }

    // Remove entries whose keys are no longer present.
    // removeRenderedNodes handles both element disposers and component
    // lifecycle (owned = true) — no need for redundant explicit
    // runUnmountHooks / disposeComponent calls.
    for (const [key, entry] of oldMap) {
      removeRenderedNodes(entry.nodes);
      itemSignalMap.delete(key);
    }

    // Reorder DOM children to match the new order using minimal moves.
    // Walk backwards, tracking the node each entry's nodes must precede, so
    // multi-node entries (Fragment results) are kept together as a block
    // without relying on fixed child-index positions.
    let nextNode = null;
    for (let i = newEntries.length - 1; i >= 0; i--) {
      const nodes = newEntries[i].nodes;
      for (let j = nodes.length - 1; j >= 0; j--) {
        const node = nodes[j];
        if (node.parentNode !== container || node.nextSibling !== nextNode) {
          container.insertBefore(node, nextNode);
        }
        nextNode = node;
      }
    }

    currentEntries = newEntries;
  });

  addDisposer(container, dispose);

  return container;
}

/**
 * Keyed list rendering primitive — dual-mode dispatcher.
 *
 * Supports two calling conventions:
 *
 * 1) **Low-level** (unchanged, backward compatible):
 *    `For(itemsAccessor, keyFn, renderFn, options?)` — see `ForImpl` above
 *    for full parameter docs.
 *
 * 2) **JSX props**: `For(props)`, e.g.
 *    ```jsx
 *    <For each={items} keyFn={(item) => item.id} tagName="tbody">
 *      {(itemSignal, index) => <tr>...</tr>}
 *    </For>
 *    ```
 *    Called through componentInstance exactly like any other function
 *    component — a single `props` argument, with `children` merged in as
 *    `props.children` (never signal-wrapped, same as any other component).
 *
 *    - `props.each` — `() => Item[]`, a signal (`{ get() }`), or a static
 *      array; coerced via `toAccessor`.
 *    - `props.keyFn` — **required**; same contract as `keyFn` above. Throws
 *      if omitted. Named `keyFn` (not `key`) because `key` is a reserved
 *      JSX attribute stripped out of `props` by every JSX transform before
 *      the component ever sees it.
 *    - `props.equals` / `props.tagName` — same as `options.equals` /
 *      `options.tagName` above.
 *    - Any other prop (`class`, `$ref`, `style`, `onClick`, `data-*`, …) is
 *      forwarded to the wrapper element, exactly like a regular DOM
 *      element's props — static values, functions, and signals all work.
 *    - `props.children` — `renderFn`, or an array whose first element is
 *      `renderFn` (JSX passes a single child as either shape depending on
 *      the transform used). A second positional argument is also accepted
 *      as a fallback, for direct calls that bypass componentInstance (e.g.
 *      `For({ each, keyFn }, renderFn)`).
 *
 *    `For` declares `RAW_PROPS = (key) => key !== 'each'` (see
 *    `runtime.mjs`) so every prop except `each` bypasses `normalizeProps` —
 *    `keyFn`/`equals` remain plain functions, `tagName` remains a plain
 *    string, and arbitrary wrapper props (`class`, `$ref`, `onClick`, …)
 *    reach `applyProps` in their original shape (static/function/signal)
 *    so they behave exactly as they would on a regular element. `each` is
 *    the only key normalized like a regular reactive prop when routed
 *    through JSX.
 *
 * @param {Function | { each: *, keyFn: Function, equals?: Function, tagName?: string, children?: *, [key: string]: * }} itemsAccessorOrProps
 * @param {Function | Function[] | *} [keyFnOrChildren]
 * @param {Function} [renderFn]
 * @param {{ equals?: Function, tagName?: string, [key: string]: * }} [options]
 * @returns {HTMLElement}
 */
export function For(itemsAccessorOrProps, keyFnOrChildren, renderFn, options) {
  if (typeof itemsAccessorOrProps === 'function') {
    return ForImpl(itemsAccessorOrProps, keyFnOrChildren, renderFn, options);
  }

  const { each, keyFn, equals, tagName, children, ...containerProps } =
    itemsAccessorOrProps ?? {};

  if (typeof keyFn !== 'function') {
    throw new Error('For: "keyFn" prop is required and must be a function');
  }

  const itemsAccessor = toAccessor(each);
  const resolvedRenderFn = resolveChild(
    itemsAccessorOrProps ?? {},
    keyFnOrChildren,
  );

  return ForImpl(itemsAccessor, keyFn, resolvedRenderFn, {
    ...containerProps,
    equals,
    tagName,
  });
}

For[RAW_PROPS] = (key) => key !== 'each';
