// ---------------------------------------------------------------------------
// If.mjs — conditional rendering primitive
//
// Two calling conventions (dual-mode dispatcher, see `If` at the bottom):
//
// 1) Low-level:  If(condition, thenChild, elseChild, options?)
//   - condition:  () => boolean
//   - thenChild:  pre-built Node OR component instance descriptor
//   - elseChild:  pre-built Node OR component instance descriptor (optional)
//   - options.tagName: string — wrapper element tag, default 'span'
//
// 2) JSX props:  <If when={cond} fallback={elseNode} tagName="tbody">
//                  {thenNode}
//                </If>
//   - props.when:      () => boolean | Signal<boolean> | boolean —
//                      normalized like a regular reactive prop when routed
//                      through JSX/createElement, then coerced via
//                      `toAccessor` (see runtime.mjs).
//   - props.fallback:  same role as `elseChild` above (optional). Declared
//                      as a RAW_PROPS key so a literal Node/Fragment/
//                      component instance is never signal-wrapped.
//   - props.tagName:   same as options.tagName above; also a RAW_PROPS key
//                      (a literal string, not a reactive value).
//   - any other prop (class, $ref, style, onClick, data-*, …): forwarded to
//                      the wrapper element via `applyProps` — same behavior
//                      as a regular DOM element's props (static values,
//                      plain functions, and signals are all supported).
//   - props.children (or, for direct calls bypassing componentInstance, the
//                      2nd positional argument): thenChild, or an array
//                      whose first element is thenChild. `If` is called
//                      exactly like any other function component via
//                      componentInstance — `fn(props)`, one argument, with
//                      `children` merged in as `props.children`.
//   `If` declares `RAW_PROPS = (key) => key !== 'when'`, so every prop
//   except `when` bypasses normalizeProps, while `when` keeps normal
//   reactive normalization.
//
// Ownership model (fixes the v2 clearContainer bug):
//   - Pre-built Node (passed in directly): BORROWED — only detach on branch
//     switch, never cleanupTree. This preserves _disposers so reactive attrs
//     keep working across multiple toggles.
//   - Component instance ($constructor result): OWNED — full cleanupTree on
//     deactivation, fresh $constructor call on re-activation.
//
// A pre-built Fragment is treated as borrowed (its already-live children are
// detached without cleanupTree, matching the borrowed-Node contract above).
// Because inserting a Fragment empties it, a borrowed Fragment's children are
// extracted into a stable node array ONCE, up front (not on every toggle),
// and that same array is reused across all activations; a component instance
// whose render result is a Fragment is owned (each of the fragment's
// children is torn down via cleanupTree, matching the owned contract, and a
// fresh Fragment is produced by $constructor() on every re-activation). See
// resolveRenderedNodes/removeRenderedNodes in createElement.mjs.
//
// Imports: component.mjs, createElement.mjs, lifecycle.mjs, @esmj/signals
// ---------------------------------------------------------------------------

import { computed, effect, untrack } from '@esmj/signals';
import { isComponentInstance } from './componentInstance.mjs';
import {
  applyProps,
  removeRenderedNodes,
  resolveRenderedNodes,
} from './createElement.mjs';
import { runMountHooks } from './lifecycle.mjs';
import {
  addDisposer,
  createReconciliationContainer,
  RAW_PROPS,
  resolveChild,
  toAccessor,
} from './runtime.mjs';

/**
 * Conditional rendering primitive — renders one of two branches based on a
 * reactive condition, with full DOM lifecycle management.
 *
 * Ownership model:
 * - Pre-built `Node` or `Fragment` (passed directly): **borrowed** — only
 *   detached on branch switch, never torn down. Reactive attributes and
 *   disposers are preserved across multiple toggles.
 * - Component instance (descriptor returned by a component function): **owned**
 *   — fully torn down (`cleanupTree`) on deactivation and re-constructed on
 *   re-activation. `onMount`/`onUnmount` hooks fire accordingly.
 *
 * @template {Node|import('./componentInstance.mjs').ComponentInstance} T
 * @param {() => boolean} condition  Reactive predicate; re-evaluated on every
 *   signal change it depends on.
 * @param {T} thenChild  Branch rendered when `condition` is truthy.
 * @param {T} [elseChild]  Branch rendered when `condition` is falsy (optional).
 * @param {{ tagName?: string, [key: string]: * }} [options]  Optional settings.
 *   `tagName` sets the wrapper element's tag (default `'span'`) — use this
 *   when the default `<span>` would violate the parent's content model
 *   (e.g. `{ tagName: 'tbody' }` inside a `<table>`). Note: no tag choice
 *   fixes `<ul>`/`<ol>`/`<select>` parents, which only accept their specific
 *   item tag as a direct child regardless of wrapper tag — see README. Any
 *   other key (`class`, `$ref`, `style`, `onClick`, `data-*`, …) is applied
 *   to the wrapper element via the same `applyProps` logic used for regular
 *   DOM elements (i.e. it follows `createElement`'s per-prop handling rules).
 * @returns {HTMLElement}  The wrapper element. Only the default/fallback
 *   `<span>` gets `display:contents` (to stay transparent to CSS layout); an
 *   explicitly chosen `tagName` keeps its normal display since it's assumed
 *   to already be valid for its context (e.g. `'tbody'` in a `<table>`).
 */
function IfImpl(condition, thenChild, elseChild, options) {
  const { tagName = 'span', ...containerProps } = options ?? {};
  // display:contents (applied only to the default <span>, see
  // createReconciliationContainer) makes the wrapper invisible to CSS
  // layout while its children participate in the parent's layout normally.
  const container = createReconciliationContainer(tagName, 'data-if');

  if (containerProps.id) container.setAttribute('id', containerProps.id);
  applyProps(container, containerProps);

  // Borrowed branches (anything that is not a component instance — a plain
  // Node, a pre-built Fragment, or a primitive) are resolved to their live
  // node(s) exactly ONCE, up front, and that same node array is reused on
  // every activation. This matters for Fragments in particular: inserting a
  // DocumentFragment anywhere empties it, so re-reading `resolveRenderedNodes`
  // from the *original* Fragment reference on a later toggle would find it
  // already empty. Component-instance branches are intentionally NOT
  // resolved here — they get a fresh $constructor() call on every
  // activation (owned/full-remount contract).
  const thenOwned = isComponentInstance(thenChild);
  const elseOwned = elseChild != null && isComponentInstance(elseChild);
  const thenBorrowedNodes =
    thenChild != null && !thenOwned
      ? resolveRenderedNodes(thenChild).nodes
      : null;
  const elseBorrowedNodes =
    elseChild != null && !elseOwned
      ? resolveRenderedNodes(elseChild).nodes
      : null;

  let currentBranch = null; // 'then' | 'else' | null
  let currentNodes = []; // the DOM node(s) currently active in this container
  let currentOwned = false; // true → we own them and must cleanupTree on switch

  const conditionComputed = computed(() => !!condition());

  const dispose = effect(() => {
    const result = conditionComputed.get();
    const newBranch = result ? 'then' : 'else';

    if (newBranch === currentBranch) return;
    currentBranch = newBranch;

    // Deactivate the current branch
    if (currentNodes.length) {
      removeRenderedNodes(currentNodes, currentOwned);
      currentNodes = [];
      currentOwned = false;
    }

    // Activate the new branch
    const child = result ? thenChild : elseChild;
    if (child == null) return;

    const owned = result ? thenOwned : elseOwned;

    // Wrap DOM construction in untrack so signals read during $constructor
    // do not accidentally become dependencies of this effect.
    untrack(() => {
      let nodes;
      let instance = null;

      if (owned) {
        ({ nodes, instance } = resolveRenderedNodes(child));
      } else {
        nodes = result ? thenBorrowedNodes : elseBorrowedNodes;
      }

      if (nodes.length) {
        container.append(...nodes);
      }

      currentNodes = nodes;
      currentOwned = owned;

      if (instance) {
        queueMicrotask(() => runMountHooks(instance));
      }
    });
  });

  addDisposer(container, dispose);

  return container;
}

/**
 * Conditional rendering primitive — dual-mode dispatcher.
 *
 * Supports two calling conventions:
 *
 * 1) **Low-level** (unchanged, backward compatible):
 *    `If(condition, thenChild, elseChild, options?)` — see `IfImpl` above
 *    for full parameter docs.
 *
 * 2) **JSX props**: `If(props)`, e.g.
 *    ```jsx
 *    <If when={() => isLoggedIn.get()} fallback={<LoginForm/>} tagName="tbody">
 *      <Dashboard/>
 *    </If>
 *    ```
 *    Called through componentInstance exactly like any other function
 *    component — a single `props` argument, with `children` merged in as
 *    `props.children` (never signal-wrapped, same as any other component).
 *
 *    - `props.when` — `() => boolean`, a signal (`{ get() }`), or a static
 *      boolean; coerced via `toAccessor`.
 *    - `props.fallback` — same role as `elseChild` above (optional).
 *    - `props.tagName` — same as `options.tagName` above.
 *    - Any other prop (`class`, `$ref`, `style`, `onClick`, `data-*`, …) is
 *      forwarded to the wrapper element, exactly like a regular DOM
 *      element's props — static values, functions, and signals all work.
 *    - `props.children` — `thenChild`, or an array whose first element is
 *      `thenChild`. A second positional argument is also accepted as a
 *      fallback, for direct calls that bypass componentInstance (e.g.
 *      `If({ when }, thenEl)`).
 *
 *    `If` declares `RAW_PROPS = (key) => key !== 'when'` (see
 *    `runtime.mjs`) so every prop except `when` bypasses `normalizeProps` —
 *    a literal Node/Fragment/component instance `fallback`, a literal
 *    `tagName` string, and arbitrary wrapper props (`class`, `$ref`,
 *    `onClick`, …) all reach `applyProps`/consumers in their original
 *    shape. `when` is the only key normalized like a regular reactive prop
 *    when routed through JSX.
 *
 * @param {Function | { when: *, fallback?: *, tagName?: string, children?: *, [key: string]: * }} conditionOrProps
 * @param {*} [thenChildOrChildren]
 * @param {*} [elseChild]
 * @param {{ tagName?: string, [key: string]: * }} [options]
 * @returns {HTMLElement}
 */
export function If(conditionOrProps, thenChildOrChildren, elseChild, options) {
  if (typeof conditionOrProps === 'function') {
    return IfImpl(conditionOrProps, thenChildOrChildren, elseChild, options);
  }

  const { when, fallback, tagName, children, ...containerProps } =
    conditionOrProps ?? {};
  const condition = toAccessor(when);
  const resolvedThenChild = resolveChild(
    conditionOrProps ?? {},
    thenChildOrChildren,
  );

  return IfImpl(condition, resolvedThenChild, fallback, {
    ...containerProps,
    tagName,
  });
}

If[RAW_PROPS] = (key) => key !== 'when';
