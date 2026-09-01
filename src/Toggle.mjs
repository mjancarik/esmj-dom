// ---------------------------------------------------------------------------
// Toggle.mjs — JSX wrapper around Show's CSS-based conditional visibility
//
// JSX-only, single calling convention:
//   <Toggle when={condition}>{child}</Toggle>
//
//   - props.when:  () => boolean | Signal<boolean> | boolean — normalized
//                  like a regular reactive prop when routed through JSX/
//                  createElement, then coerced via `toAccessor` (see
//                  runtime.mjs).
//   - props.children: the element to show/hide, or an array whose first
//                  element is that node. `Toggle` is called exactly like
//                  any other function component via componentInstance —
//                  `fn(props)`, one argument, with `children` merged in as
//                  `props.children`.
//
// Unlike other control-flow components (`For`/`If`), `Toggle` has no props
// that need to bypass `normalizeProps`'s signal/computed wrapping (`when` is
// meant to be normalized like any reactive prop), so it does NOT declare
// RAW_PROPS at all — an absent marker and an empty-array marker behave
// identically (see `normalizeProps` in runtime.mjs), so there is no need to
// declare one just for documentation purposes.
//
// Unlike `If`, the element is never removed from the DOM — see Show.mjs for
// full semantics (display toggle only, no teardown, no lifecycle hooks).
//
// Imports: Show.mjs, runtime.mjs
// ---------------------------------------------------------------------------

import { resolveChild, toAccessor } from './runtime.mjs';
import { Show } from './Show.mjs';

/**
 * CSS-based conditional visibility — JSX wrapper around `Show`.
 *
 * ```jsx
 * <Toggle when={() => showPanel.get()}>
 *   <aside class="panel">Sidebar content</aside>
 * </Toggle>
 * ```
 *
 * The child **stays in the DOM** while visibility changes — no teardown and
 * no lifecycle hooks on show/hide toggles. Use [`If`](./If.mjs) for full
 * teardown semantics.
 *
 * @param {{ when: (() => boolean) | { get(): boolean } | boolean, children?: * }} [props]
 *   `when` is coerced into a reactive accessor via `toAccessor`. `children`
 *   is the child to show or hide (or an array whose first element is that
 *   child — matches the shape JSX passes for a single child).
 * @param {Node|import('./componentInstance.mjs').ComponentInstance|string|Array} [fallbackChildren]
 *   Fallback for direct calls that bypass componentInstance (e.g.
 *   `Toggle({ when }, el)`); ignored when `props.children` is present.
 * @returns {Node}  The (possibly wrapped) child node — see `Show`.
 */
export function Toggle(props, fallbackChildren) {
  const resolvedProps = props ?? {};
  const condition = toAccessor(resolvedProps.when);
  const child = resolveChild(resolvedProps, fallbackChildren);

  return Show(condition, child);
}
