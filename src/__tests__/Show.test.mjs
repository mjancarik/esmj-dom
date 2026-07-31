import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { afterFlush, createSignal } from '@esmj/signals';
import { createComponentInstance } from '../componentInstance.mjs';
import { createElement } from '../createElement.mjs';
import { mount, unmount } from '../mount.mjs';
import { Show } from '../Show.mjs';

// ---------------------------------------------------------------------------
// Basic visibility
// ---------------------------------------------------------------------------

describe('Show — basic visibility', () => {
  it('element is visible when condition is true', async () => {
    const cond = createSignal(true);
    const el = document.createElement('div');
    Show(() => cond.get(), el);
    await afterFlush();

    assert.notEqual(el.style.display, 'none');
  });

  it('element is hidden when condition is false', async () => {
    const cond = createSignal(false);
    const el = document.createElement('div');
    Show(() => cond.get(), el);
    await afterFlush();

    assert.equal(el.style.display, 'none');
  });

  it('toggles display when condition changes', async () => {
    const cond = createSignal(true);
    const el = document.createElement('div');
    Show(() => cond.get(), el);
    await afterFlush();

    assert.notEqual(el.style.display, 'none');

    cond.set(false);
    await afterFlush();

    assert.equal(el.style.display, 'none');

    cond.set(true);
    await afterFlush();

    assert.notEqual(el.style.display, 'none');
  });

  it('element is NEVER removed from the DOM', async () => {
    const cond = createSignal(false);
    const parent = document.createElement('div');
    const el = document.createElement('span');
    parent.appendChild(el);
    Show(() => cond.get(), el);
    await afterFlush();

    // Element is still in parent
    assert.ok(parent.contains(el));
  });
});

// ---------------------------------------------------------------------------
// Show with component instance
// ---------------------------------------------------------------------------

describe('Show — component instance', () => {
  it('mounts a component and controls visibility', async () => {
    const cond = createSignal(true);
    let renderCalled = false;

    const instance = createComponentInstance(
      () => {
        renderCalled = true;
        return document.createElement('div');
      },
      {},
      null,
    );

    const el = Show(() => cond.get(), instance);
    await afterFlush();
    await new Promise((r) => queueMicrotask(r));

    assert.ok(renderCalled);
    assert.ok(el instanceof HTMLElement);
    assert.notEqual(el.style.display, 'none');

    cond.set(false);
    await afterFlush();

    assert.equal(el.style.display, 'none');
  });
});

// ---------------------------------------------------------------------------
// Show with plain text child (non-HTMLElement)
// ---------------------------------------------------------------------------

describe('Show — plain text child', () => {
  it('converts a string child to a text node and returns it', () => {
    const cond = createSignal(true);
    const result = Show(() => cond.get(), 'hello');

    // Text nodes are not HTMLElements, so Show just returns without toggling
    assert.equal(result.textContent, 'hello');
  });
});

describe('Show — lifecycle cleanup', () => {
  it('disposes visibility effect when parent subtree is unmounted', async () => {
    const visible = createSignal(true);
    let conditionRuns = 0;

    function App() {
      return createElement('div', {}, [
        Show(
          () => {
            conditionRuns++;
            return visible.get();
          },
          createElement('span', { 'data-testid': 'message' }, ['message']),
        ),
      ]);
    }

    const container = document.createElement('div');
    mount(container, createElement(App));
    await afterFlush();

    visible.set(false);
    await afterFlush();
    const runsBeforeUnmount = conditionRuns;

    unmount(container);
    visible.set(true);
    await afterFlush();

    assert.equal(conditionRuns, runsBeforeUnmount);
  });
});
