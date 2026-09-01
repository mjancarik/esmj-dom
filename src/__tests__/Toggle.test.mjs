import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { afterFlush, createSignal } from '@esmj/signals';
import { createElement } from '../createElement.mjs';
import { mount } from '../mount.mjs';
import { Toggle } from '../Toggle.mjs';

// ---------------------------------------------------------------------------
// Toggle — direct calling convention
// ---------------------------------------------------------------------------

describe('Toggle — basic visibility', () => {
  it('element is visible when "when" is true', async () => {
    const cond = createSignal(true);
    const el = document.createElement('div');

    Toggle({ when: () => cond.get() }, el);
    await afterFlush();

    assert.notEqual(el.style.display, 'none');
  });

  it('element is hidden when "when" is false', async () => {
    const cond = createSignal(false);
    const el = document.createElement('div');

    Toggle({ when: () => cond.get() }, el);
    await afterFlush();

    assert.equal(el.style.display, 'none');
  });

  it('toggles display when "when" changes', async () => {
    const cond = createSignal(true);
    const el = document.createElement('div');

    Toggle({ when: () => cond.get() }, el);
    await afterFlush();

    assert.notEqual(el.style.display, 'none');

    cond.set(false);
    await afterFlush();

    assert.equal(el.style.display, 'none');

    cond.set(true);
    await afterFlush();

    assert.notEqual(el.style.display, 'none');
  });

  it('accepts "when" as a signal directly (not just a function accessor)', async () => {
    const cond = createSignal(true);
    const el = document.createElement('div');

    Toggle({ when: cond }, el);
    await afterFlush();

    assert.notEqual(el.style.display, 'none');

    cond.set(false);
    await afterFlush();

    assert.equal(el.style.display, 'none');
  });

  it('accepts children as an array (JSX auto-runtime shape)', async () => {
    const cond = createSignal(false);
    const el = document.createElement('div');

    Toggle({ when: () => cond.get() }, [el]);
    await afterFlush();

    assert.equal(el.style.display, 'none');
  });

  it('element is NEVER removed from the DOM', async () => {
    const cond = createSignal(false);
    const parent = document.createElement('div');
    const el = document.createElement('span');
    parent.appendChild(el);

    Toggle({ when: () => cond.get() }, el);
    await afterFlush();

    assert.ok(parent.contains(el));
  });
});

// ---------------------------------------------------------------------------
// Toggle — JSX (createElement + mount)
// ---------------------------------------------------------------------------

describe('Toggle — JSX props mode via createElement + mount', () => {
  it('works end-to-end through createElement + mount (JSX-style usage)', async () => {
    const cond = createSignal(true);
    const root = document.createElement('div');
    const child = document.createElement('span');
    child.textContent = 'panel';

    const el = createElement(Toggle, { when: () => cond.get() }, child);
    mount(root, el);
    await afterFlush();

    assert.ok(root.contains(child));
    assert.notEqual(child.style.display, 'none');

    cond.set(false);
    await afterFlush();

    assert.equal(child.style.display, 'none');
    // Still in the DOM — Toggle never tears down, unlike If.
    assert.ok(root.contains(child));
  });
});
