import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { afterFlush, createSignal } from '@esmj/signals';
import { createComponentInstance } from '../componentInstance.mjs';
import { createElement } from '../createElement.mjs';
import { If } from '../If.mjs';
import { cleanupTree, onMount, onUnmount } from '../lifecycle.mjs';
import { setInternalContext } from '../runtime.mjs';

// ---------------------------------------------------------------------------
// Basic rendering
// ---------------------------------------------------------------------------

describe('If — initial render', () => {
  it('renders then-branch when condition is true', async () => {
    const cond = createSignal(true);
    const thenEl = document.createElement('span');
    thenEl.textContent = 'then';

    const container = If(() => cond.get(), thenEl);
    await afterFlush();

    assert.ok(container.contains(thenEl));
  });

  it('does not render then-branch when condition is false', async () => {
    const cond = createSignal(false);
    const thenEl = document.createElement('span');

    const container = If(() => cond.get(), thenEl);
    await afterFlush();

    assert.ok(!container.contains(thenEl));
  });

  it('renders else-branch when condition is false', async () => {
    const cond = createSignal(false);
    const thenEl = document.createElement('span');
    const elseEl = document.createElement('em');
    elseEl.textContent = 'else';

    const container = If(() => cond.get(), thenEl, elseEl);
    await afterFlush();

    assert.ok(container.contains(elseEl));
  });

  it('renders nothing when condition is false and no else branch', async () => {
    const cond = createSignal(false);
    const thenEl = document.createElement('span');

    const container = If(() => cond.get(), thenEl);
    await afterFlush();

    assert.equal(container.childNodes.length, 0);
  });

  it('wraps in a span with display:contents', () => {
    const cond = createSignal(true);
    const thenEl = document.createElement('div');
    const container = If(() => cond.get(), thenEl);

    assert.equal(container.tagName, 'SPAN');
    assert.equal(container.style.display, 'contents');
    assert.ok(container.hasAttribute('data-if'));
  });
});

// ---------------------------------------------------------------------------
// Branch switching
// ---------------------------------------------------------------------------

describe('If — branch switching', () => {
  it('switches from then to else when condition changes', async () => {
    const cond = createSignal(true);
    const thenEl = document.createElement('span');
    const elseEl = document.createElement('em');

    const container = If(() => cond.get(), thenEl, elseEl);
    await afterFlush();

    assert.ok(container.contains(thenEl));

    cond.set(false);
    await afterFlush();

    assert.ok(!container.contains(thenEl));
    assert.ok(container.contains(elseEl));
  });

  it('switches from else back to then', async () => {
    const cond = createSignal(false);
    const thenEl = document.createElement('span');
    const elseEl = document.createElement('em');

    const container = If(() => cond.get(), thenEl, elseEl);
    await afterFlush();

    cond.set(true);
    await afterFlush();

    assert.ok(container.contains(thenEl));
    assert.ok(!container.contains(elseEl));
  });

  it('does not re-render when condition stays the same', async () => {
    const cond = createSignal(true);
    let renderCount = 0;
    const thenInstance = createComponentInstance(
      () => {
        renderCount++;
        return document.createElement('div');
      },
      {},
      null,
    );

    const container = If(() => cond.get(), thenInstance);
    await afterFlush();
    const countAfterMount = renderCount;

    cond.set(true); // same value
    await afterFlush();

    assert.equal(renderCount, countAfterMount, 'no re-render on same value');
  });
});

// ---------------------------------------------------------------------------
// Borrowed node — disposers preserved on toggle
// ---------------------------------------------------------------------------

describe('If — borrowed node (pre-built)', () => {
  it('preserves _disposers on the borrowed node across toggles', async () => {
    const cond = createSignal(true);
    const thenEl = document.createElement('span');
    let disposed = false;
    thenEl._disposers = [
      () => {
        disposed = true;
      },
    ];

    const container = If(() => cond.get(), thenEl);
    await afterFlush();

    // Switch away and back
    cond.set(false);
    await afterFlush();
    cond.set(true);
    await afterFlush();

    // Disposers should NOT have been called (node is borrowed, not owned)
    assert.ok(!disposed, '_disposers on borrowed node must survive toggle');
    assert.ok(container.contains(thenEl));
  });
});

// ---------------------------------------------------------------------------
// Owned component — full lifecycle
// ---------------------------------------------------------------------------

describe('If — owned component instance', () => {
  it('calls onUnmount when component is deactivated', async () => {
    const cond = createSignal(true);
    let unmounted = false;

    const thenInstance = createComponentInstance(
      () => {
        onUnmount(() => {
          unmounted = true;
        });
        return document.createElement('div');
      },
      {},
      null,
    );

    const container = If(() => cond.get(), thenInstance);
    await afterFlush();
    await new Promise((r) => queueMicrotask(r));

    cond.set(false);
    await afterFlush();

    assert.ok(unmounted);
  });

  it('creates a fresh element when component is re-activated', async () => {
    const cond = createSignal(true);
    let callCount = 0;

    const thenInstance = createComponentInstance(
      () => {
        callCount++;
        return document.createElement('div');
      },
      {},
      null,
    );

    const container = If(() => cond.get(), thenInstance);
    await afterFlush();
    assert.equal(callCount, 1);

    cond.set(false);
    await afterFlush();
    cond.set(true);
    await afterFlush();

    assert.equal(callCount, 2, '$constructor called again on re-activation');
  });
});
