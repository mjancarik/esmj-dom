import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { afterFlush, computed, createSignal } from '@esmj/signals';
import { createComponentInstance } from '../componentInstance.mjs';
import { createElement, isSignalLike, renderChild } from '../createElement.mjs';
import { useRef } from '../runtime.mjs';

// ---------------------------------------------------------------------------
// isSignalLike
// ---------------------------------------------------------------------------

describe('isSignalLike', () => {
  it('returns true for a signal (has .get())', () => {
    const s = createSignal(1);
    assert.ok(isSignalLike(s));
  });

  it('returns true for a computed (has .get())', () => {
    const c = computed(() => 42);
    assert.ok(isSignalLike(c));
  });

  it('returns true for any object with .get()', () => {
    assert.ok(isSignalLike({ get() {} }));
  });

  it('returns false for a DOM Node', () => {
    const el = document.createElement('div');
    assert.ok(!isSignalLike(el));
  });

  it('returns false for null', () => {
    assert.ok(!isSignalLike(null));
  });

  it('returns false for a string', () => {
    assert.ok(!isSignalLike('hello'));
  });

  it('returns false for a plain object without .get()', () => {
    assert.ok(!isSignalLike({ value: 1 }));
  });
});

// ---------------------------------------------------------------------------
// createElement — static
// ---------------------------------------------------------------------------

describe('createElement — static', () => {
  it('creates an element with tag name', () => {
    const el = createElement('span', {});
    assert.equal(el.tagName, 'SPAN');
  });

  it('defaults to div when no tag name given', () => {
    const el = createElement({});
    assert.equal(el.tagName, 'DIV');
  });

  it('applies id attribute', () => {
    const el = createElement('div', { id: 'my-id' });
    assert.equal(el.getAttribute('id'), 'my-id');
  });

  it('applies static string attribute', () => {
    const el = createElement('div', { 'data-foo': 'bar' });
    assert.equal(el.getAttribute('data-foo'), 'bar');
  });

  it('blocks unsafe srcdoc attribute', () => {
    const el = createElement('iframe', { srcdoc: '<script>alert(1)</script>' });
    assert.equal(el.hasAttribute('srcdoc'), false);
  });

  it('blocks javascript: URLs in href', () => {
    const el = createElement('a', { href: "javascript:alert('xss')" });
    assert.equal(el.hasAttribute('href'), false);
  });

  it('blocks javascript: URLs prefixed by unicode whitespace', () => {
    const el = createElement('a', { href: '\u00A0javascript:alert(1)' });
    assert.equal(el.hasAttribute('href'), false);
  });

  it('allows safe href values', () => {
    const el = createElement('a', { href: '/docs' });
    assert.equal(el.getAttribute('href'), '/docs');
  });

  it('aliases className → class', () => {
    const el = createElement('div', { className: 'foo' });
    assert.equal(el.getAttribute('class'), 'foo');
  });

  it('aliases htmlFor → for', () => {
    const el = createElement('label', { htmlFor: 'input-id' });
    assert.equal(el.getAttribute('for'), 'input-id');
  });

  it('aliases tabIndex → tabindex', () => {
    const el = createElement('div', { tabIndex: '0' });
    assert.equal(el.getAttribute('tabindex'), '0');
  });

  it('aliases readOnly → readonly', () => {
    const el = createElement('input', { readOnly: true });
    assert.equal(el.getAttribute('readonly'), 'true');
  });

  it('removes attribute when value is null', () => {
    const el = createElement('div', { 'data-x': null });
    assert.equal(el.hasAttribute('data-x'), false);
  });

  it('appends string children', () => {
    const el = createElement('p', {}, 'hello');
    assert.equal(el.textContent, 'hello');
  });

  it('appends multiple children from array', () => {
    const el = createElement('div', {}, ['a', 'b', 'c']);
    assert.equal(el.textContent, 'abc');
  });

  it('skips null/undefined/false/true children', () => {
    const el = createElement('div', {}, [null, undefined, false, true]);
    assert.equal(el.childNodes.length, 0);
  });

  it('appends Node children', () => {
    const child = document.createElement('span');
    const el = createElement('div', {}, child);
    assert.equal(el.firstChild, child);
  });

  it('sets DOM property for value', () => {
    const el = createElement('input', { value: 'hello' });
    assert.equal(el.value, 'hello');
  });

  it('sets DOM property for checked', () => {
    const el = createElement('input', { checked: true });
    assert.equal(el.checked, true);
  });

  it('sets DOM property for defaultValue', () => {
    const el = createElement('input', { defaultValue: 'hello' });
    assert.equal(el.defaultValue, 'hello');
  });

  it('serializes contentEditable=false as contenteditable="false"', () => {
    const parent = document.createElement('div');
    parent.contentEditable = 'true';

    const el = createElement('div', { contentEditable: false });
    parent.appendChild(el);

    assert.equal(el.getAttribute('contenteditable'), 'false');
  });

  it('serializes contentEditable=true as contenteditable="true"', () => {
    const el = createElement('div', { contentEditable: true });
    assert.equal(el.getAttribute('contenteditable'), 'true');
  });

  it('serializes draggable=false as draggable="false"', () => {
    const el = createElement('div', { draggable: false });
    assert.equal(el.getAttribute('draggable'), 'false');
  });

  it('serializes spellCheck=false as spellcheck="false"', () => {
    const el = createElement('div', { spellCheck: false });
    assert.equal(el.getAttribute('spellcheck'), 'false');
  });
});

// ---------------------------------------------------------------------------
// createElement — $ref
// ---------------------------------------------------------------------------

describe('createElement — $ref', () => {
  it('calls callback ref with the element', () => {
    let captured = null;
    createElement('div', {
      $ref: (el) => {
        captured = el;
      },
    });
    assert.ok(captured instanceof HTMLElement);
    assert.equal(captured.tagName, 'DIV');
  });

  it('sets .current on object ref', () => {
    const ref = { current: null };
    const el = createElement('span', { $ref: ref });
    assert.equal(ref.current, el);
  });

  it('sets .current on a useRef() ref', () => {
    const ref = useRef();
    const el = createElement('div', { $ref: ref });
    assert.equal(ref.current, el);
    assert.equal(ref.get(), el);
  });

  it('supports Solid-like callback assignment style via useRef', () => {
    let inputElement = null;
    const ref = useRef((el) => {
      inputElement = el;
    });

    const el = createElement('input', { $ref: ref, value: 'abc' });

    assert.equal(inputElement, el);
    assert.equal(inputElement.value, 'abc');
  });

  it('supports callback form via useRef().set', () => {
    const ref = useRef();
    const el = createElement('input', { $ref: ref.set, value: 'abc' });
    assert.equal(ref.get(), el);
    assert.equal(ref.current.value, 'abc');
  });

  it('supports both $ref object and $ref set callback with direct access', () => {
    const refA = useRef();
    const refB = useRef();
    let focusedA = false;
    let focusedB = false;

    const elA = createElement('input', { $ref: refA, value: 'one' });
    const elB = createElement('input', { $ref: refB.set, value: 'two' });
    elA.focus = () => {
      focusedA = true;
    };
    elB.focus = () => {
      focusedB = true;
    };

    refA.focus();
    refB.get().focus();

    assert.equal(refA.value, 'one');
    assert.equal(refB.get().value, 'two');
    assert.ok(focusedA);
    assert.ok(focusedB);
  });
});

// ---------------------------------------------------------------------------
// createElement — events
// ---------------------------------------------------------------------------

describe('createElement — events', () => {
  it('attaches event listener via onClick', () => {
    let clicked = false;
    const el = createElement('button', {
      onClick: () => {
        clicked = true;
      },
    });
    el.dispatchEvent(new Event('click'));
    assert.ok(clicked);
  });

  it('attaches event listener via onInput', () => {
    let fired = false;
    const el = createElement('input', {
      onInput: () => {
        fired = true;
      },
    });
    el.dispatchEvent(new Event('input'));
    assert.ok(fired);
  });

  it('blocks onSecurityPolicyViolation listener binding', () => {
    let fired = false;
    const el = createElement('div', {
      onSecurityPolicyViolation: () => {
        fired = true;
      },
    });
    el.dispatchEvent(new Event('securitypolicyviolation'));
    assert.equal(fired, false);
  });
});

// ---------------------------------------------------------------------------
// createElement — reactive props (signal / function)
// ---------------------------------------------------------------------------

describe('createElement — reactive attributes', () => {
  it('tracks signal-bound attribute', async () => {
    const sig = createSignal('initial');
    const _disposers = [];
    const el = createElement('div', { 'data-val': sig });
    assert.equal(el.getAttribute('data-val'), 'initial');

    sig.set('updated');
    await afterFlush();

    assert.equal(el.getAttribute('data-val'), 'updated');
  });

  it('tracks function-bound attribute', async () => {
    const sig = createSignal('a');
    const el = createElement('div', { 'data-val': () => sig.get() });
    assert.equal(el.getAttribute('data-val'), 'a');

    sig.set('b');
    await afterFlush();

    assert.equal(el.getAttribute('data-val'), 'b');
  });

  it('blocks javascript: URLs from reactive attribute values', async () => {
    const href = createSignal('/safe');
    const el = createElement('a', { href });
    assert.equal(el.getAttribute('href'), '/safe');

    href.set(' javascript:alert(1)');
    await afterFlush();

    assert.equal(el.hasAttribute('href'), false);
  });

  it('blocks unicode-whitespace-prefixed javascript URLs from reactive values', async () => {
    const href = createSignal('/safe');
    const el = createElement('a', { href });
    assert.equal(el.getAttribute('href'), '/safe');

    href.set('\u2003javascript:alert(1)');
    await afterFlush();

    assert.equal(el.hasAttribute('href'), false);
  });

  it('removes attribute when reactive value is false', async () => {
    const sig = createSignal(true);
    const el = createElement('div', { hidden: sig });

    sig.set(false);
    await afterFlush();

    assert.equal(el.hasAttribute('hidden'), false);
  });

  it('tracks signal-bound value property', async () => {
    const sig = createSignal('hello');
    const el = createElement('input', { value: sig });
    assert.equal(el.value, 'hello');

    sig.set('world');
    await afterFlush();

    assert.equal(el.value, 'world');
  });

  it('tracks signal-bound contentEditable attribute', async () => {
    const parent = document.createElement('div');
    parent.contentEditable = 'true';

    const sig = createSignal(true);
    const el = createElement('div', { contentEditable: sig });
    parent.appendChild(el);

    assert.equal(el.getAttribute('contenteditable'), 'true');

    sig.set(false);
    await afterFlush();

    assert.equal(el.getAttribute('contenteditable'), 'false');
  });

  it('tracks signal-bound draggable attribute', async () => {
    const sig = createSignal(true);
    const el = createElement('div', { draggable: sig });

    assert.equal(el.getAttribute('draggable'), 'true');

    sig.set(false);
    await afterFlush();

    assert.equal(el.getAttribute('draggable'), 'false');
  });

  it('tracks signal-bound spellcheck attribute', async () => {
    const sig = createSignal(true);
    const el = createElement('div', { spellCheck: sig });

    assert.equal(el.getAttribute('spellcheck'), 'true');

    sig.set(false);
    await afterFlush();

    assert.equal(el.getAttribute('spellcheck'), 'false');
  });
});

// ---------------------------------------------------------------------------
// createElement — style
// ---------------------------------------------------------------------------

describe('createElement — style', () => {
  it('applies static object style', () => {
    const el = createElement('div', { style: { color: 'red' } });
    assert.equal(el.style.color, 'red');
  });

  it('applies string style via setAttribute', () => {
    const el = createElement('div', { style: 'color: blue;' });
    assert.equal(el.getAttribute('style'), 'color: blue;');
  });

  it('tracks signal-bound style object', async () => {
    const sig = createSignal({ color: 'red' });
    const el = createElement('div', { style: sig });
    assert.equal(el.style.color, 'red');

    sig.set({ color: 'blue' });
    await afterFlush();

    assert.equal(el.style.color, 'blue');
  });
});

// ---------------------------------------------------------------------------
// createElement — $dangerouslySetInnerHTML
// ---------------------------------------------------------------------------

describe('createElement — $dangerouslySetInnerHTML', () => {
  it('sets innerHTML from a static string', () => {
    const el = createElement('div', {
      $dangerouslySetInnerHTML: '<b>bold</b>',
    });
    assert.equal(el.querySelector('b')?.tagName, 'B');
  });

  it('tracks a signal-bound innerHTML', async () => {
    const sig = createSignal('<em>initial</em>');
    const el = createElement('div', { $dangerouslySetInnerHTML: sig });
    assert.ok(el.querySelector('em'));

    sig.set('<strong>updated</strong>');
    await afterFlush();

    assert.ok(el.querySelector('strong'));
    assert.ok(!el.querySelector('em'));
  });

  it('tracks a function-bound innerHTML', async () => {
    const sig = createSignal('first');
    const el = createElement('div', {
      $dangerouslySetInnerHTML: () => `<span>${sig.get()}</span>`,
    });
    assert.equal(el.querySelector('span')?.textContent, 'first');

    sig.set('second');
    await afterFlush();

    assert.equal(el.querySelector('span')?.textContent, 'second');
  });
});

// ---------------------------------------------------------------------------
// createElement — function component
// ---------------------------------------------------------------------------

describe('createElement — function component', () => {
  it('returns a component instance descriptor (not a Node)', () => {
    const MyComp = () => document.createElement('div');
    const instance = createElement(MyComp, {});
    assert.ok(typeof instance.$constructor === 'function');
    assert.ok(!(instance instanceof Node));
  });
});

// ---------------------------------------------------------------------------
// renderChild
// ---------------------------------------------------------------------------

describe('renderChild', () => {
  it('appends a string as a text node', () => {
    const parent = document.createElement('div');
    renderChild(parent, 'hello');
    assert.equal(parent.textContent, 'hello');
  });

  it('appends a number as a text node', () => {
    const parent = document.createElement('div');
    renderChild(parent, 42);
    assert.equal(parent.textContent, '42');
  });

  it('appends a Node directly', () => {
    const parent = document.createElement('div');
    const child = document.createElement('span');
    renderChild(parent, child);
    assert.equal(parent.firstChild, child);
  });

  it('skips null', () => {
    const parent = document.createElement('div');
    renderChild(parent, null);
    assert.equal(parent.childNodes.length, 0);
  });

  it('skips undefined', () => {
    const parent = document.createElement('div');
    renderChild(parent, undefined);
    assert.equal(parent.childNodes.length, 0);
  });

  it('skips false', () => {
    const parent = document.createElement('div');
    renderChild(parent, false);
    assert.equal(parent.childNodes.length, 0);
  });

  it('skips true', () => {
    const parent = document.createElement('div');
    renderChild(parent, true);
    assert.equal(parent.childNodes.length, 0);
  });

  it('flattens an array of children', () => {
    const parent = document.createElement('div');
    renderChild(parent, ['a', 'b', 'c']);
    assert.equal(parent.textContent, 'abc');
  });

  it('creates reactive text node for signal', async () => {
    const sig = createSignal('hello');
    const parent = document.createElement('div');
    renderChild(parent, sig);
    assert.equal(parent.textContent, 'hello');

    sig.set('world');
    await afterFlush();

    assert.equal(parent.textContent, 'world');
  });

  it('creates reactive text node for function', async () => {
    const sig = createSignal('a');
    const parent = document.createElement('div');
    renderChild(parent, () => sig.get());
    assert.equal(parent.textContent, 'a');

    sig.set('b');
    await afterFlush();

    assert.equal(parent.textContent, 'b');
  });

  it('swaps DOM Node when signal returns a Node', async () => {
    const span = document.createElement('span');
    const em = document.createElement('em');
    const sig = createSignal(span);
    const parent = document.createElement('div');

    renderChild(parent, sig);
    assert.ok(parent.contains(span), 'initial node should be in parent');

    sig.set(em);
    await afterFlush();

    assert.ok(!parent.contains(span), 'old node should be removed');
    assert.ok(parent.contains(em), 'new node should be in parent');
  });

  it('swaps DOM Node when reactive function returns a Node', async () => {
    const span = document.createElement('span');
    const em = document.createElement('em');
    const sig = createSignal(span);
    const parent = document.createElement('div');

    renderChild(parent, () => sig.get());
    assert.ok(parent.contains(span));

    sig.set(em);
    await afterFlush();

    assert.ok(!parent.contains(span));
    assert.ok(parent.contains(em));
  });

  it('switches between a Node and a primitive value', async () => {
    const span = document.createElement('span');
    const sig = createSignal(span);
    const parent = document.createElement('div');

    renderChild(parent, sig);
    assert.ok(parent.contains(span));

    sig.set('just text');
    await afterFlush();

    assert.ok(!parent.contains(span));
    assert.equal(parent.textContent, 'just text');
  });

  it('removes node when signal emits null', async () => {
    const span = document.createElement('span');
    const sig = createSignal(span);
    const parent = document.createElement('div');

    renderChild(parent, sig);
    assert.ok(parent.contains(span));

    sig.set(null);
    await afterFlush();

    assert.ok(!parent.contains(span));
    // only the comment anchor remains
    assert.equal(parent.childElementCount, 0);
  });

  it('renders a ComponentInstance returned from a reactive function', async () => {
    // Before this fix, a signal returning a ComponentInstance descriptor fell
    // through to the String(value) fallback and rendered "[object Object]".
    const sig = createSignal(false);
    const parent = document.createElement('div');

    renderChild(parent, () => {
      if (!sig.get()) return null;
      return createComponentInstance(
        () => {
          const el = document.createElement('b');
          el.textContent = 'component';
          return el;
        },
        {},
        null,
      );
    });

    assert.equal(parent.textContent, '', 'nothing rendered when false');
    assert.ok(
      !parent.textContent.includes('[object Object]'),
      'must not render object toString',
    );

    sig.set(true);
    await afterFlush();

    assert.ok(parent.querySelector('b'), 'component element should be in DOM');
    assert.equal(parent.querySelector('b')?.textContent, 'component');
  });
});
