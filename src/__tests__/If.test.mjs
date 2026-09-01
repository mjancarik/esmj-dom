import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { afterFlush, createSignal } from '@esmj/signals';
import { createComponentInstance } from '../componentInstance.mjs';
import { createElement, Fragment } from '../createElement.mjs';
import { If } from '../If.mjs';
import { onUnmount } from '../lifecycle.mjs';
import { mount } from '../mount.mjs';

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

    const _container = If(() => cond.get(), thenInstance);
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

    const _container = If(() => cond.get(), thenInstance);
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

    const _container = If(() => cond.get(), thenInstance);
    await afterFlush();
    assert.equal(callCount, 1);

    cond.set(false);
    await afterFlush();
    cond.set(true);
    await afterFlush();

    assert.equal(callCount, 2, '$constructor called again on re-activation');
  });
});

// ---------------------------------------------------------------------------
// Fragment children (regression test for the DocumentFragment-empties-itself
// bug — see createElement.mjs's resolveRenderedNodes/removeRenderedNodes)
// ---------------------------------------------------------------------------

describe('If — Fragment children', () => {
  it('renders a pre-built Fragment as thenChild and removes it cleanly on toggle', async () => {
    const cond = createSignal(true);
    const s1 = document.createElement('span');
    s1.textContent = 'a';
    const s2 = document.createElement('span');
    s2.textContent = 'b';
    const frag = createElement(Fragment, {}, [s1, s2]);

    const container = If(() => cond.get(), frag);
    await afterFlush();

    assert.equal(container.querySelectorAll('span').length, 2);
    assert.ok(container.contains(s1));
    assert.ok(container.contains(s2));

    cond.set(false);
    await afterFlush();

    assert.equal(container.querySelectorAll('span').length, 0);

    cond.set(true);
    await afterFlush();

    assert.equal(container.querySelectorAll('span').length, 2);
  });

  it('handles a component instance whose render() returns a Fragment as thenChild, toggled multiple times', async () => {
    let renderCount = 0;
    let unmountCount = 0;

    const thenInstance = createComponentInstance(
      () => {
        renderCount++;
        onUnmount(() => {
          unmountCount++;
        });
        const a = document.createElement('span');
        const b = document.createElement('em');
        return createElement(Fragment, {}, [a, b]);
      },
      {},
      null,
    );

    const cond = createSignal(true);
    const container = If(() => cond.get(), thenInstance);
    await afterFlush();
    await new Promise((r) => queueMicrotask(r));

    assert.equal(renderCount, 1);
    assert.equal(container.querySelectorAll('span').length, 1);
    assert.equal(container.querySelectorAll('em').length, 1);

    cond.set(false);
    await afterFlush();
    assert.equal(
      unmountCount,
      1,
      'onUnmount fires for Fragment-returning component',
    );
    assert.equal(container.childNodes.length, 0);

    cond.set(true);
    await afterFlush();
    assert.equal(renderCount, 2, 'fresh $constructor() call on re-activation');
    assert.equal(container.querySelectorAll('span').length, 1);
  });
});

// ---------------------------------------------------------------------------
// options.tagName — configurable wrapper element
// ---------------------------------------------------------------------------

describe('If — options.tagName', () => {
  it('defaults to a <span> wrapper', async () => {
    const cond = createSignal(true);
    const thenEl = document.createElement('p');

    const container = If(() => cond.get(), thenEl);
    await afterFlush();

    assert.equal(container.tagName, 'SPAN');
  });

  it('uses the given tagName for the wrapper, keeping data-if without forcing display:contents', async () => {
    const cond = createSignal(true);
    const thenEl = document.createElement('tr');

    const container = If(() => cond.get(), thenEl, null, { tagName: 'tbody' });
    await afterFlush();

    assert.equal(container.tagName, 'TBODY');
    assert.ok(container.hasAttribute('data-if'));
    assert.equal(container.style.display, '');
    assert.ok(container.contains(thenEl));
  });

  it('falls back to <span> with a warning for unsupported wrapper tags', async () => {
    const originalConsoleWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => {
      warnings.push(args.join(' '));
    };

    try {
      const cond = createSignal(true);
      const thenEl = document.createElement('p');

      const container = If(() => cond.get(), thenEl, null, {
        tagName: 'script',
      });
      await afterFlush();

      assert.equal(container.tagName, 'SPAN');
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /tagName "script"/);
    } finally {
      console.warn = originalConsoleWarn;
    }
  });

  it('falls back to <span> for unsupported wrapper tags regardless of case', async () => {
    const originalConsoleWarn = console.warn;
    console.warn = () => {};

    try {
      const cond = createSignal(true);
      const thenEl = document.createElement('p');

      const container = If(() => cond.get(), thenEl, null, {
        tagName: 'Template',
      });
      await afterFlush();

      assert.equal(container.tagName, 'SPAN');
    } finally {
      console.warn = originalConsoleWarn;
    }
  });
});

// ---------------------------------------------------------------------------
// If — JSX props mode
// ---------------------------------------------------------------------------

describe('If — JSX props mode', () => {
  it('renders then-child when called with a props object + children', async () => {
    const cond = createSignal(true);
    const thenEl = document.createElement('span');
    thenEl.textContent = 'then';

    const container = If({ when: () => cond.get() }, thenEl);
    await afterFlush();

    assert.ok(container.contains(thenEl));
  });

  it('accepts children as an array (JSX auto-runtime shape)', async () => {
    const cond = createSignal(true);
    const thenEl = document.createElement('span');

    const container = If({ when: () => cond.get() }, [thenEl]);
    await afterFlush();

    assert.ok(container.contains(thenEl));
  });

  it('accepts "when" as a signal directly (not just a function accessor)', async () => {
    const cond = createSignal(true);
    const thenEl = document.createElement('span');

    const container = If({ when: cond }, thenEl);
    await afterFlush();

    assert.ok(container.contains(thenEl));

    cond.set(false);
    await afterFlush();

    assert.ok(!container.contains(thenEl));
  });

  it('renders "fallback" prop when condition is false', async () => {
    const cond = createSignal(false);
    const thenEl = document.createElement('span');
    const fallbackEl = document.createElement('em');
    fallbackEl.textContent = 'fallback';

    const container = If(
      { when: () => cond.get(), fallback: fallbackEl },
      thenEl,
    );
    await afterFlush();

    assert.ok(!container.contains(thenEl));
    assert.ok(container.contains(fallbackEl));
  });

  it('honors "tagName" prop', async () => {
    const cond = createSignal(true);
    const thenEl = document.createElement('tr');

    const container = If({ when: () => cond.get(), tagName: 'tbody' }, thenEl);
    await afterFlush();

    assert.equal(container.tagName, 'TBODY');
    assert.equal(container.style.display, '');
  });

  it('works end-to-end through createElement + mount (JSX-style usage)', async () => {
    const cond = createSignal(true);
    const root = document.createElement('div');
    const thenEl = document.createElement('span');
    thenEl.textContent = 'then';

    const el = createElement(If, { when: () => cond.get() }, thenEl);
    mount(root, el);
    await afterFlush();

    const container = root.firstChild;
    assert.equal(container.tagName, 'SPAN');
    assert.ok(container.contains(thenEl));
  });
});
