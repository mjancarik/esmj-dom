import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSignal } from '@esmj/signals';

import {
  createContext,
  createReconciliationContainer,
  deepEqual,
  getContext,
  getContextFromElement,
  getInternalContext,
  getNodeComponent,
  getNodeInternal,
  initNodeInternal,
  keepLiteral,
  normalizeProps,
  setContext,
  setInternalContext,
  setNodeComponent,
  useRef,
  withContext,
} from '../runtime.mjs';

// ---------------------------------------------------------------------------
// normalizeProps
// ---------------------------------------------------------------------------

describe('normalizeProps', () => {
  it('wraps a plain value in a signal', () => {
    const result = normalizeProps({ count: 5 });
    assert.ok(typeof result.count.get === 'function');
    assert.equal(result.count.get(), 5);
  });

  it('wraps a function in a computed', () => {
    const base = createSignal(10);
    const result = normalizeProps({ double: () => base.get() * 2 });
    assert.ok(typeof result.double.get === 'function');
    assert.equal(result.double.get(), 20);
  });

  it('passes signal-like values through unchanged', () => {
    const sig = createSignal('hello');
    const result = normalizeProps({ name: sig });
    assert.equal(result.name, sig);
  });

  it('passes children through raw (no wrapping)', () => {
    const children = [document.createElement('div')];
    const result = normalizeProps({ children });
    assert.equal(result.children, children);
  });

  it('handles null as plain value → signal wrapping', () => {
    const result = normalizeProps({ value: null });
    assert.ok(typeof result.value.get === 'function');
    assert.equal(result.value.get(), null);
  });

  it('passes keepLiteral-wrapped value through raw (no signal wrapping)', () => {
    const result = normalizeProps({ count: keepLiteral(42) });
    assert.equal(result.count, 42);
  });

  it('passes keepLiteral-wrapped function through as the original function', () => {
    const fn = () => 'hello';
    const result = normalizeProps({ handler: keepLiteral(fn) });
    assert.equal(result.handler, fn);
  });

  it('passes keepLiteral-wrapped signal through without double-wrapping', () => {
    const sig = createSignal('x');
    const result = normalizeProps({ signal: keepLiteral(sig) });
    assert.equal(result.signal, sig);
  });

  it('does not mutate Object prototype when __proto__ exists in props', () => {
    const before = {}.isAdmin;
    const props = JSON.parse('{"__proto__":{"isAdmin":true},"safe":1}');
    const result = normalizeProps(props);
    const protoDescriptor = Object.getOwnPropertyDescriptor(
      result,
      '__proto__',
    );

    assert.equal({}.isAdmin, before);
    assert.ok(protoDescriptor);
    assert.ok(typeof protoDescriptor.value.get === 'function');
    assert.equal(protoDescriptor.value.get().isAdmin, true);
    assert.equal(result.safe.get(), 1);
  });
});

// ---------------------------------------------------------------------------
// keepLiteral
// ---------------------------------------------------------------------------

describe('keepLiteral', () => {
  it('returns a callable wrapper', () => {
    const wrapped = keepLiteral('test');
    assert.equal(typeof wrapped, 'function');
  });

  it('calling the wrapper returns the original value', () => {
    const obj = { a: 1 };
    const wrapped = keepLiteral(obj);
    assert.equal(wrapped(), obj);
  });

  it('preserves functions as literals through normalizeProps', () => {
    const fn = () => 99;
    const result = normalizeProps({ getValue: keepLiteral(fn) });
    assert.equal(result.getValue, fn);
    assert.equal(result.getValue(), 99);
  });

  it('preserves null as literal through normalizeProps', () => {
    const result = normalizeProps({ value: keepLiteral(null) });
    assert.equal(result.value, null);
  });

  it('preserves undefined as literal through normalizeProps', () => {
    const result = normalizeProps({ value: keepLiteral(undefined) });
    assert.equal(result.value, undefined);
  });
});

// ---------------------------------------------------------------------------
// useRef
// ---------------------------------------------------------------------------

describe('useRef', () => {
  it('returns a signal-shaped ref with current set to null', () => {
    const ref = useRef();
    assert.equal(typeof ref.get, 'function');
    assert.equal(typeof ref.set, 'function');
    assert.equal(ref.current, null);
    assert.equal(ref.get(), null);
  });

  it('returns a fresh object on every call', () => {
    const ref1 = useRef();
    const ref2 = useRef();
    assert.notEqual(ref1, ref2);
  });

  it('updates current when set is called', () => {
    const ref = useRef();
    const el = document.createElement('input');
    ref.set(el);
    assert.equal(ref.current, el);
    assert.equal(ref.get(), el);
  });

  it('supports setting through .current alias', () => {
    const ref = useRef();
    const el = document.createElement('input');
    ref.current = el;
    assert.equal(ref.get(), el);
  });

  it('supports callback assignment style', () => {
    let assigned = null;
    const ref = useRef((el) => {
      assigned = el;
    });
    const el = document.createElement('input');

    ref.set(el);

    assert.equal(assigned, el);
    assert.equal(ref.current, el);
  });

  it('supports direct property and method access from current element', () => {
    const ref = useRef();
    const el = document.createElement('input');
    let focused = false;
    el.focus = () => {
      focused = true;
    };

    ref.set(el);
    ref.value = 'abc';
    ref.focus();

    assert.equal(ref.value, 'abc');
    assert.equal(el.value, 'abc');
    assert.equal(ref.get().value, 'abc');
    assert.ok(focused);
  });

  it('supports Symbol.toPrimitive conversion', () => {
    const ref = useRef();
    assert.equal(`${ref}`, '');
    assert.equal(+ref, 0);

    const el = document.createElement('div');
    ref.set(el);

    assert.ok(String(ref).includes('HTMLDivElement'));
    assert.ok(Number.isNaN(+ref));
  });
});

// ---------------------------------------------------------------------------
// deepEqual
// ---------------------------------------------------------------------------

describe('deepEqual', () => {
  it('returns true for identical primitives', () => {
    assert.ok(deepEqual(1, 1));
    assert.ok(deepEqual('a', 'a'));
    assert.ok(deepEqual(null, null));
  });

  it('returns false for different primitives', () => {
    assert.ok(!deepEqual(1, 2));
    assert.ok(!deepEqual('a', 'b'));
  });

  it('returns true for equivalent objects', () => {
    assert.ok(deepEqual({ a: 1, b: [2] }, { a: 1, b: [2] }));
  });

  it('returns false for non-equivalent objects', () => {
    assert.ok(!deepEqual({ a: 1 }, { a: 2 }));
  });

  it('returns true for identical reference', () => {
    const obj = { x: 1 };
    assert.ok(deepEqual(obj, obj));
  });

  it('compares own __proto__ properties without traversing prototype chain', () => {
    const first = JSON.parse('{"__proto__":{"nested":1},"value":2}');
    const second = JSON.parse('{"__proto__":{"nested":1},"value":2}');
    assert.ok(deepEqual(first, second));
  });
});

// ---------------------------------------------------------------------------
// createContext / setContext / getContext
// ---------------------------------------------------------------------------

describe('Context API', () => {
  it('createContext returns an object with defaultValue', () => {
    const ctx = createContext('default');
    assert.equal(ctx.defaultValue, 'default');
  });

  it('createContext creates unique ids per context token', () => {
    const first = createContext('first-default');
    const second = createContext('second-default');
    assert.notEqual(first.id, second.id);
  });

  it('getContext returns defaultValue when not inside a component', () => {
    const ctx = createContext('fallback');
    assert.equal(getContext(ctx), 'fallback');
  });

  it('setContext + getContext works inside a component context', () => {
    const ctx = createContext('default');
    const internal = { disposers: [], id: 'test-id', contexts: new Map() };
    setInternalContext(internal);

    setContext(ctx, 'custom-value');
    const val = getContext(ctx);

    setInternalContext(null);
    assert.equal(val, 'custom-value');
  });

  it('keeps distinct context values isolated in the same scope', () => {
    const alpha = createContext('alpha-default');
    const beta = createContext('beta-default');
    const internal = { disposers: [], id: 'test-id', contexts: new Map() };
    setInternalContext(internal);

    setContext(alpha, 'alpha-value');
    setContext(beta, 'beta-value');

    assert.equal(getContext(alpha), 'alpha-value');
    assert.equal(getContext(beta), 'beta-value');
    setInternalContext(null);
  });
});

describe('withContext + getInternalContext', () => {
  it('exposes the provided context inside callback', () => {
    const ctx = { id: 'ctx-a', contexts: new Map() };

    const seen = withContext(ctx, () => getInternalContext());

    assert.equal(seen, ctx);
    assert.equal(getInternalContext(), null);
  });

  it('restores previous context after nested calls', () => {
    const outer = { id: 'outer', contexts: new Map() };
    const inner = { id: 'inner', contexts: new Map() };

    setInternalContext(outer);

    const seen = withContext(inner, () => {
      const duringInner = getInternalContext();
      const afterNested = withContext(outer, () => getInternalContext());
      return { duringInner, afterNested, afterRestore: getInternalContext() };
    });

    assert.equal(seen.duringInner, inner);
    assert.equal(seen.afterNested, outer);
    assert.equal(seen.afterRestore, inner);
    assert.equal(getInternalContext(), outer);

    setInternalContext(null);
  });

  it('restores previous context when callback throws', () => {
    const prev = { id: 'prev', contexts: new Map() };
    const current = { id: 'current', contexts: new Map() };

    setInternalContext(prev);

    assert.throws(() => {
      withContext(current, () => {
        throw new Error('boom');
      });
    }, /boom/);

    assert.equal(getInternalContext(), prev);
    setInternalContext(null);
  });

  it('can temporarily clear context with null and restore previous', () => {
    const prev = { id: 'prev', contexts: new Map() };

    setInternalContext(prev);

    const seen = withContext(null, () => getInternalContext());

    assert.equal(seen, null);
    assert.equal(getInternalContext(), prev);

    setInternalContext(null);
  });
});

// ---------------------------------------------------------------------------
// getContextFromElement
// ---------------------------------------------------------------------------

describe('getContextFromElement', () => {
  it('returns defaultValue when no ancestor has the context', () => {
    const ctx = createContext('default');
    const el = document.createElement('div');
    assert.equal(getContextFromElement(ctx, el), 'default');
  });

  it('finds context on the element itself', () => {
    const ctx = createContext('default');
    const el = document.createElement('div');
    // Use initNodeInternal to set up internal with contexts
    const internal = initNodeInternal(el);
    internal.contexts = new Map([[ctx.id, 'from-element']]);
    assert.equal(getContextFromElement(ctx, el), 'from-element');
  });
});

// ---------------------------------------------------------------------------
// getNodeComponent / setNodeComponent
// ---------------------------------------------------------------------------

describe('getNodeComponent / setNodeComponent', () => {
  it('returns null for a plain element', () => {
    const el = document.createElement('div');
    assert.equal(getNodeComponent(el), null);
  });

  it('returns the set instance', () => {
    const el = document.createElement('div');
    const fakeInstance = { componentId: 'x' };
    setNodeComponent(el, fakeInstance);
    assert.equal(getNodeComponent(el), fakeInstance);
  });

  it('returns null for a null element', () => {
    assert.equal(getNodeComponent(null), null);
  });

  it('returns null for an undefined element', () => {
    assert.equal(getNodeComponent(undefined), null);
  });
});

// ---------------------------------------------------------------------------
// initNodeInternal / getNodeInternal
// ---------------------------------------------------------------------------

describe('initNodeInternal / getNodeInternal', () => {
  it('creates and returns internal for a new element', () => {
    const el = document.createElement('div');
    const internal = initNodeInternal(el);
    assert.ok(Array.isArray(internal.disposers));
    assert.ok(typeof internal.id === 'string');
  });

  it('returns the same internal on a second call', () => {
    const el = document.createElement('div');
    const a = initNodeInternal(el);
    const b = initNodeInternal(el);
    assert.equal(a, b);
  });

  it('getNodeInternal returns null for element without internal', () => {
    const el = document.createElement('div');
    assert.equal(getNodeInternal(el), undefined);
  });

  it('getNodeInternal returns internal after init', () => {
    const el = document.createElement('div');
    initNodeInternal(el);
    assert.ok(getNodeInternal(el) != null);
  });
});

// ---------------------------------------------------------------------------
// createReconciliationContainer
// ---------------------------------------------------------------------------

describe('createReconciliationContainer', () => {
  it('creates a container with the given tagName, attribute and display:contents', () => {
    const container = createReconciliationContainer('tbody', 'data-each');
    assert.equal(container.tagName, 'TBODY');
    assert.ok(container.hasAttribute('data-each'));
    assert.equal(container.style.display, 'contents');
  });

  it('uses a random uid as the attribute value on each call', () => {
    const a = createReconciliationContainer('span', 'data-each');
    const b = createReconciliationContainer('span', 'data-each');
    assert.notEqual(a.getAttribute('data-each'), b.getAttribute('data-each'));
  });

  it('falls back to span for unsupported wrapper tags regardless of case', () => {
    const originalConsoleWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => {
      warnings.push(args.join(' '));
    };

    try {
      const container = createReconciliationContainer('TEMPLATE', 'data-if');
      assert.equal(container.tagName, 'SPAN');
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /tagName "TEMPLATE"/);
    } finally {
      console.warn = originalConsoleWarn;
    }
  });

  it('falls back to span for "script" with mixed case and surrounding whitespace', () => {
    const originalConsoleWarn = console.warn;
    console.warn = () => {};

    try {
      const container = createReconciliationContainer(' ScRiPt ', 'data-if');
      assert.equal(container.tagName, 'SPAN');
    } finally {
      console.warn = originalConsoleWarn;
    }
  });

  it('propagates the DOM exception for an invalid (empty) tagName', () => {
    assert.throws(() => createReconciliationContainer('', 'data-each'));
  });
});
