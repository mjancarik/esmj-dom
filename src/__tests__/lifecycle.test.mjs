import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { afterFlush } from '@esmj/signals';

import {
  afterRender,
  cleanupTree,
  disposeComponent,
  onEffect,
  onMount,
  onUnmount,
  runMountHooks,
  runUnmountHooks,
} from '../lifecycle.mjs';
import {
  disposersRegistry,
  initNodeInternal,
  mountHooksRegistry,
  setInternalContext,
  setNodeComponent,
  unmountHooksRegistry,
} from '../runtime.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withContext(id, fn) {
  const internal = { disposers: [], id, contexts: new Map() };
  setInternalContext(internal);
  try {
    fn(internal);
  } finally {
    setInternalContext(null);
  }
}

// ---------------------------------------------------------------------------
// onMount
// ---------------------------------------------------------------------------

describe('onMount', () => {
  it('warns when called outside a component context', (_t) => {
    const messages = [];
    const orig = console.warn;
    console.warn = (...args) => messages.push(args.join(' '));
    onMount(() => {});
    console.warn = orig;
    assert.ok(messages.some((m) => m.includes('onMount')));
  });

  it('registers callback in mountHooksRegistry under the context id', () => {
    const id = `test-mount-${Math.random()}`;
    withContext(id, () => {
      onMount(() => {});
    });
    assert.ok(mountHooksRegistry.has(id));
    assert.equal(mountHooksRegistry.get(id).length, 1);
    // cleanup
    mountHooksRegistry.delete(id);
  });

  it('auto-registers the return value of onMount callback as unmount hook', () => {
    const id = `test-mount-cleanup-${Math.random()}`;
    withContext(id, () => {
      onMount(() => () => 'cleanup');
    });
    // runMountHooks will call the hook and register its return
    runMountHooks({ componentId: id });
    assert.ok(unmountHooksRegistry.has(id));
    unmountHooksRegistry.delete(id);
  });
});

// ---------------------------------------------------------------------------
// onUnmount
// ---------------------------------------------------------------------------

describe('onUnmount', () => {
  it('warns when called outside a component context', () => {
    const messages = [];
    const orig = console.warn;
    console.warn = (...args) => messages.push(args.join(' '));
    onUnmount(() => {});
    console.warn = orig;
    assert.ok(messages.some((m) => m.includes('onUnmount')));
  });

  it('registers callback in unmountHooksRegistry under the context id', () => {
    const id = `test-unmount-${Math.random()}`;
    withContext(id, () => {
      onUnmount(() => {});
    });
    assert.ok(unmountHooksRegistry.has(id));
    assert.equal(unmountHooksRegistry.get(id).length, 1);
    unmountHooksRegistry.delete(id);
  });
});

// ---------------------------------------------------------------------------
// onEffect
// ---------------------------------------------------------------------------

describe('onEffect', () => {
  it('warns when called outside a component context', () => {
    const messages = [];
    const orig = console.warn;
    console.warn = (...args) => messages.push(args.join(' '));
    onEffect(() => {});
    console.warn = orig;
    assert.ok(messages.some((m) => m.includes('onEffect')));
  });

  it('registers disposer in disposersRegistry under the context id', () => {
    const id = `test-effect-${Math.random()}`;
    const dispose = () => {};
    withContext(id, () => {
      onEffect(dispose);
    });
    assert.ok(disposersRegistry.has(id));
    assert.ok(disposersRegistry.get(id).includes(dispose));
    disposersRegistry.delete(id);
  });
});

// ---------------------------------------------------------------------------
// afterRender
// ---------------------------------------------------------------------------

describe('afterRender', () => {
  it('calls callback after effects have settled (macrotask)', async () => {
    let called = false;
    afterRender(() => {
      called = true;
    });
    assert.ok(!called);

    await afterFlush();
    // afterFlush resolves after microtasks, but afterRender uses setTimeout
    await new Promise((r) => setTimeout(r, 0));

    assert.ok(called);
  });
});

// ---------------------------------------------------------------------------
// runMountHooks / runUnmountHooks / disposeComponent
// ---------------------------------------------------------------------------

describe('runMountHooks', () => {
  it('calls each registered mount hook', () => {
    const id = `rmt-${Math.random()}`;
    let called = 0;
    mountHooksRegistry.set(id, [
      () => {
        called++;
      },
      () => {
        called++;
      },
    ]);

    runMountHooks({ componentId: id });

    assert.equal(called, 2);
    assert.ok(!mountHooksRegistry.has(id), 'registry should be cleared');
  });
});

describe('runUnmountHooks', () => {
  it('calls each registered unmount hook', () => {
    const id = `rut-${Math.random()}`;
    let called = 0;
    unmountHooksRegistry.set(id, [
      () => {
        called++;
      },
      () => {
        called++;
      },
    ]);

    runUnmountHooks(id);

    assert.equal(called, 2);
    assert.ok(!unmountHooksRegistry.has(id));
  });
});

describe('disposeComponent', () => {
  it('calls each registered disposer', () => {
    const id = `dc-${Math.random()}`;
    let called = 0;
    disposersRegistry.set(id, [
      () => {
        called++;
      },
      () => {
        called++;
      },
    ]);

    disposeComponent(id);

    assert.equal(called, 2);
    assert.ok(!disposersRegistry.has(id));
  });
});

// ---------------------------------------------------------------------------
// cleanupTree
// ---------------------------------------------------------------------------

describe('cleanupTree', () => {
  it('calls element-level disposers and clears them', () => {
    const el = document.createElement('div');
    let disposed = false;
    const internal = initNodeInternal(el);
    internal.disposers.push(() => {
      disposed = true;
    });

    cleanupTree(el);

    assert.ok(disposed);
    assert.equal(internal.disposers, null);
  });

  it('runs unmount hooks for component root elements', () => {
    const el = document.createElement('div');
    const id = `ct-comp-${Math.random()}`;
    let unmounted = false;
    initNodeInternal(el);
    setNodeComponent(el, { componentId: id });
    unmountHooksRegistry.set(id, [
      () => {
        unmounted = true;
      },
    ]);

    cleanupTree(el);

    assert.ok(unmounted);
  });

  it('recurses into child nodes', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    parent.appendChild(child);
    let childDisposed = false;
    const childInternal = initNodeInternal(child);
    childInternal.disposers.push(() => {
      childDisposed = true;
    });
    initNodeInternal(parent);

    cleanupTree(parent);

    assert.ok(childDisposed);
  });

  it('disposes component-scoped effects', () => {
    const el = document.createElement('div');
    const id = `ct-effect-${Math.random()}`;
    let effectDisposed = false;
    initNodeInternal(el);
    setNodeComponent(el, { componentId: id });
    disposersRegistry.set(id, [
      () => {
        effectDisposed = true;
      },
    ]);

    cleanupTree(el);

    assert.ok(effectDisposed);
  });
});
