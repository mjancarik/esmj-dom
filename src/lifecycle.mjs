// ---------------------------------------------------------------------------
// lifecycle.mjs — component lifecycle hooks and tree cleanup
//
// Imports: runtime.mjs, @esmj/signals.
// Exports (public): onMount, onUnmount, onEffect, afterRender
// Exports (internal): runMountHooks, runUnmountHooks, disposeComponent,
//                     addDisposer, cleanupTree
// ---------------------------------------------------------------------------

import { onFlush } from '@esmj/signals';

import {
  addToRegistry,
  disposersRegistry,
  getInternalContext,
  getNodeComponent,
  initNodeInternal,
  mountHooksRegistry,
  unmountHooksRegistry,
} from './runtime.mjs';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a callback to run after the current component is mounted into the
 * DOM. If the callback returns a function, that function is registered as an
 * unmount cleanup (equivalent to calling onUnmount with it).
 */
export function onMount(callback) {
  const ctx = getInternalContext();
  if (!ctx) {
    console.warn('onMount called outside of a component context');
    return;
  }
  addToRegistry(mountHooksRegistry, ctx.id, callback);
}

/**
 * Register a cleanup callback that runs when the current component is
 * unmounted. Alternative to returning a function from onMount.
 */
export function onUnmount(callback) {
  const ctx = getInternalContext();
  if (!ctx) {
    console.warn('onUnmount called outside of a component context');
    return;
  }
  addToRegistry(unmountHooksRegistry, ctx.id, callback);
}

/**
 * Register a signal-effect disposer scoped to the current component.
 * The disposer is called automatically when the component unmounts,
 * so there is no need to track it manually.
 */
export function onEffect(disposeFn) {
  const ctx = getInternalContext();
  if (!ctx) {
    console.warn('onEffect called outside of a component context');
    return;
  }
  addDisposer(ctx.id, disposeFn);
}

/**
 * Schedule a callback after all pending renders and any cascading reactive
 * updates have fully settled.
 *
 * Unlike onFlush — which fires after the very next flush cycle — afterRender
 * waits out the entire cascade. It works by hooking into the first flush with
 * onFlush, then deferring to a macrotask (setTimeout). Because all cascading
 * signal flushes are microtasks (queueMicrotask), they are guaranteed to drain
 * before any macrotask runs, so the callback always sees the final settled DOM.
 *
 * Safe to call anywhere: inside components, event handlers, or other
 * afterRender callbacks.
 */
export function afterRender(callback) {
  onFlush(() => {
    setTimeout(callback, 0);
  });
}

// ---------------------------------------------------------------------------
// Internal helpers (exported so component.mjs / If.mjs / For.mjs can use them)
// ---------------------------------------------------------------------------

export function addDisposer(componentId, dispose) {
  addToRegistry(disposersRegistry, componentId, dispose);
}

export function runMountHooks(instance) {
  const componentId = instance.componentId;
  const hooks = mountHooksRegistry.get(componentId);
  if (!hooks) return;
  mountHooksRegistry.delete(componentId);
  for (const hook of hooks) {
    const cleanup = hook();
    if (typeof cleanup === 'function') {
      addToRegistry(unmountHooksRegistry, componentId, cleanup);
    }
  }
}

export function runUnmountHooks(componentId) {
  const cleanups = unmountHooksRegistry.get(componentId);
  if (!cleanups) return;
  unmountHooksRegistry.delete(componentId);
  for (const cleanup of cleanups) {
    cleanup();
  }
}

export function disposeComponent(componentId) {
  const disposers = disposersRegistry.get(componentId);
  if (!disposers) return;
  disposersRegistry.delete(componentId);
  for (const dispose of disposers) {
    dispose();
  }
}

/**
 * Recursively tear down a DOM subtree:
 * 1. Dispose any signal effects attached to the node via `addDisposer`.
 *    Each disposer is wrapped in a try/catch so that one misbehaving
 *    disposer (e.g. from a third-party plugin) cannot silently prevent all
 *    subsequent cleanups from running.
 * 2. If the node is a component root (has `NODE_COMPONENT`), run its
 *    `onUnmount` hooks and dispose component-scoped signal effects.
 * 3. Recurse into child nodes.
 */
export function cleanupTree(node) {
  if (!node) return;

  const internal = initNodeInternal(node);
  if (internal?.disposers?.length) {
    for (const dispose of internal.disposers) {
      // Guard against a single misbehaving disposer silently skipping all
      // subsequent cleanups (e.g. a third-party plugin that throws).
      try {
        dispose();
      } catch (err) {
        console.error(
          '[esmj-dom] cleanupTree: disposer threw, cleanup continues',
          err,
        );
      }
    }
    internal.disposers = [];
  }

  const instance = getNodeComponent(node);
  if (instance) {
    runUnmountHooks(instance.componentId);
    disposeComponent(instance.componentId);
  }

  if (node.childNodes) {
    let child = node.firstChild;
    while (child) {
      const next = child.nextSibling;
      cleanupTree(child);
      child = next;
    }
  }
}
