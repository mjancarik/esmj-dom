import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { afterFlush, createSignal } from '@esmj/signals';
import { Component } from '../Component.mjs';
import { isComponentInstance } from '../componentInstance.mjs';
import { createElement, Fragment } from '../createElement.mjs';
import { jsxDEV } from '../jsx-dev-runtime.mjs';
import { jsx, jsxs } from '../jsx-runtime.mjs';
import { onUnmount } from '../lifecycle.mjs';
import { mount } from '../mount.mjs';

// ---------------------------------------------------------------------------
// jsx / jsxs — equivalence with createElement
// ---------------------------------------------------------------------------

describe('jsx', () => {
  it('produces the same DOM as createElement for a single child', () => {
    const viaJsx = jsx('div', { className: 'x', children: 'hi' });
    const viaCreateElement = createElement('div', { className: 'x' }, 'hi');

    assert.equal(viaJsx.tagName, viaCreateElement.tagName);
    assert.equal(viaJsx.className, viaCreateElement.className);
    assert.equal(viaJsx.textContent, viaCreateElement.textContent);
  });

  it('applies props without a children key', () => {
    const el = jsx('span', { 'data-foo': 'bar' });
    assert.equal(el.getAttribute('data-foo'), 'bar');
    assert.equal(el.tagName, 'SPAN');
  });

  it('does not leak the key argument into attributes', () => {
    const el = jsx('div', { id: 'a' }, 'some-key');
    assert.equal(el.getAttribute('key'), null);
    assert.equal(el.getAttribute('id'), 'a');
  });
});

describe('jsxs', () => {
  it('renders multiple children from an array', () => {
    const child1 = document.createElement('span');
    const child2 = document.createElement('em');

    const el = jsxs('div', { children: [child1, child2] });

    assert.equal(el.childNodes.length, 2);
    assert.equal(el.childNodes[0], child1);
    assert.equal(el.childNodes[1], child2);
  });

  it('does not leak the key argument into attributes', () => {
    const el = jsxs('ul', { children: [] }, 'list-key');
    assert.equal(el.getAttribute('key'), null);
  });
});

// ---------------------------------------------------------------------------
// jsxDEV
// ---------------------------------------------------------------------------

describe('jsxDEV', () => {
  it('behaves identically to jsx for the common case', () => {
    const el = jsxDEV(
      'p',
      { className: 'note', children: 'dev mode' },
      undefined,
      false,
      {},
      null,
    );

    assert.equal(el.tagName, 'P');
    assert.equal(el.className, 'note');
    assert.equal(el.textContent, 'dev mode');
  });
});

// ---------------------------------------------------------------------------
// Fragment
// ---------------------------------------------------------------------------

describe('Fragment', () => {
  it('is exported consistently from createElement.mjs, jsx-runtime.mjs, and jsx-dev-runtime.mjs', async () => {
    const { Fragment: fromRuntime } = await import('../jsx-runtime.mjs');
    const { Fragment: fromDevRuntime } = await import('../jsx-dev-runtime.mjs');
    assert.equal(fromRuntime, Fragment);
    assert.equal(fromDevRuntime, Fragment);
  });

  it('flattens children into the parent with no wrapper element', () => {
    const child1 = document.createElement('span');
    const child2 = document.createElement('em');

    const parent = createElement('div', {}, [
      jsx(Fragment, { children: [child1, child2] }),
    ]);

    assert.equal(parent.childNodes.length, 2);
    assert.equal(parent.childNodes[0], child1);
    assert.equal(parent.childNodes[1], child2);
  });

  it('mounts correctly via mount()', () => {
    const container = document.createElement('div');
    const child1 = document.createElement('span');
    const child2 = document.createElement('em');

    mount(container, jsx(Fragment, { children: [child1, child2] }));

    assert.equal(container.childNodes.length, 2);
    assert.equal(container.childNodes[0], child1);
    assert.equal(container.childNodes[1], child2);
  });
});

// ---------------------------------------------------------------------------
// Function / class components via jsx()
// ---------------------------------------------------------------------------

describe('jsx with components', () => {
  it('returns a mountable component instance for a function component', () => {
    function Greeting({ name }) {
      const el = document.createElement('p');
      el.textContent = `Hello, ${name.get ? name.get() : name}`;
      return el;
    }

    const instance = jsx(Greeting, { name: 'world' });
    assert.ok(isComponentInstance(instance));

    const container = document.createElement('div');
    mount(container, instance);

    assert.equal(container.textContent, 'Hello, world');
  });

  it('returns a mountable component instance for a class component', () => {
    class Greeting extends Component {
      render() {
        const el = document.createElement('p');
        const name = this.props.name;
        el.textContent = `Hi, ${name.get ? name.get() : name}`;
        return el;
      }
    }

    const instance = jsx(Greeting, { name: 'there' });
    assert.ok(isComponentInstance(instance));

    const container = document.createElement('div');
    mount(container, instance);

    assert.equal(container.textContent, 'Hi, there');
  });
});

// ---------------------------------------------------------------------------
// Fragment — reactive child slot (regression test for the "DocumentFragment
// empties itself on insertion" bug: a Fragment produced by a reactive
// function/signal child must be trackable and cleanly replaceable across
// multiple updates).
// ---------------------------------------------------------------------------

describe('Fragment — reactive child', () => {
  it('renders and replaces a Fragment across multiple reactive updates with no throw', async () => {
    const mode = createSignal('a');

    const parent = createElement('div', {}, [
      () => {
        const m = mode.get();
        if (m === 'a') {
          const s1 = document.createElement('span');
          s1.textContent = 'a1';
          const s2 = document.createElement('span');
          s2.textContent = 'a2';
          return jsx(Fragment, { children: [s1, s2] });
        }
        if (m === 'b') {
          const s = document.createElement('em');
          s.textContent = 'b';
          return jsx(Fragment, { children: [s] });
        }
        return null;
      },
    ]);

    await afterFlush();
    assert.equal(parent.querySelectorAll('span').length, 2);

    mode.set('b');
    await afterFlush();
    assert.equal(parent.querySelectorAll('span').length, 0);
    assert.equal(parent.querySelector('em').textContent, 'b');

    mode.set('c');
    await afterFlush();
    assert.equal(parent.childNodes.length, 1); // only the anchor comment remains
    assert.equal(parent.querySelector('em'), null);

    mode.set('a');
    await afterFlush();
    assert.equal(parent.querySelectorAll('span').length, 2);
  });
});

// ---------------------------------------------------------------------------
// Fragment — component root (regression test for onUnmount/onEffect
// bookkeeping being lost when a component's render() returns a bare
// Fragment; see componentInstance.mjs)
// ---------------------------------------------------------------------------

describe('Fragment — component root', () => {
  it('fires onUnmount for a function component whose body returns a Fragment', async () => {
    let unmounted = false;

    function FragComponent() {
      onUnmount(() => {
        unmounted = true;
      });
      const s1 = document.createElement('span');
      const s2 = document.createElement('span');
      return jsx(Fragment, { children: [s1, s2] });
    }

    const container = document.createElement('div');
    mount(container, jsx(FragComponent, {}));
    await afterFlush();

    assert.equal(container.querySelectorAll('span').length, 2);

    container.innerHTML = '';
    assert.ok(
      !unmounted,
      'sanity: manual innerHTML clear does not call cleanup',
    );
  });

  it('fires onUnmount for a class component whose render() returns a Fragment, when unmounted via If', async () => {
    const { If } = await import('../If.mjs');
    let unmounted = false;

    class FragComponent extends Component {
      onUnmount() {
        unmounted = true;
      }
      render() {
        const s1 = document.createElement('span');
        const s2 = document.createElement('span');
        return jsx(Fragment, { children: [s1, s2] });
      }
    }

    const cond = createSignal(true);
    const container = If(() => cond.get(), jsx(FragComponent, {}));
    await afterFlush();
    await new Promise((r) => queueMicrotask(r));

    assert.equal(container.querySelectorAll('span').length, 2);

    cond.set(false);
    await afterFlush();

    assert.ok(
      unmounted,
      'onUnmount should fire even though render() returned a Fragment',
    );
    assert.equal(container.querySelectorAll('span').length, 0);
  });
});
