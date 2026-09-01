import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { afterFlush } from '@esmj/signals';

import { Component } from '../Component.mjs';
import {
  createComponentInstance,
  isClassComponent,
  isComponentInstance,
  mountComponentInstance,
} from '../componentInstance.mjs';
import { RAW_PROPS } from '../runtime.mjs';

// ---------------------------------------------------------------------------
// isComponentInstance
// ---------------------------------------------------------------------------

describe('isComponentInstance', () => {
  it('returns true for an object with a $constructor function', () => {
    assert.ok(isComponentInstance({ $constructor: () => {} }));
  });

  it('returns false for null', () => {
    assert.ok(!isComponentInstance(null));
  });

  it('returns false for a plain object without $constructor', () => {
    assert.ok(!isComponentInstance({ foo: 1 }));
  });

  it('returns false for a function', () => {
    assert.ok(!isComponentInstance(() => {}));
  });

  it('returns false for a DOM node', () => {
    assert.ok(!isComponentInstance(document.createElement('div')));
  });
});

// ---------------------------------------------------------------------------
// isClassComponent
// ---------------------------------------------------------------------------

describe('isClassComponent', () => {
  it('returns true for a class with prototype.render', () => {
    class MyComp extends Component {
      render() {
        return document.createElement('div');
      }
    }
    assert.ok(isClassComponent(MyComp));
  });

  it('returns false for a plain function', () => {
    assert.ok(!isClassComponent(() => document.createElement('div')));
  });

  it('returns false for null', () => {
    assert.ok(!isClassComponent(null));
  });
});

// ---------------------------------------------------------------------------
// createComponentInstance — function component
// ---------------------------------------------------------------------------

describe('createComponentInstance — function component', () => {
  it('returns a descriptor with $constructor, componentId, $children', () => {
    const fn = () => document.createElement('div');
    const instance = createComponentInstance(fn, {}, null);

    assert.ok(typeof instance.$constructor === 'function');
    assert.ok(typeof instance.componentId === 'string');
    assert.equal(instance.$children, null);
  });

  it('$constructor calls the function and returns a DOM Node', () => {
    const fn = () => document.createElement('span');
    const instance = createComponentInstance(fn, {}, null);
    const el = instance.$constructor();

    assert.ok(el instanceof Node);
    assert.equal(el.tagName, 'SPAN');
  });

  it('passes normalized props to the function', () => {
    let receivedProps = null;
    const fn = (props) => {
      receivedProps = props;
      return document.createElement('div');
    };
    const instance = createComponentInstance(fn, { count: 5 }, null);
    instance.$constructor();

    assert.ok(receivedProps != null);
    assert.ok(typeof receivedProps.count.get === 'function');
    assert.equal(receivedProps.count.get(), 5);
  });

  it('keeps __proto__ as data prop without polluting Object.prototype', () => {
    const before = {}.isAdmin;
    let receivedProps = null;
    const fn = (props) => {
      receivedProps = props;
      return document.createElement('div');
    };

    const attackerProps = JSON.parse(
      '{"__proto__":{"isAdmin":true},"safe":"ok"}',
    );
    const instance = createComponentInstance(fn, attackerProps, null);
    instance.$constructor();

    const protoDescriptor = Object.getOwnPropertyDescriptor(
      receivedProps,
      '__proto__',
    );
    assert.ok(protoDescriptor);
    assert.ok(typeof protoDescriptor.value.get === 'function');
    assert.equal(protoDescriptor.value.get().isAdmin, true);
    assert.equal(receivedProps.safe.get(), 'ok');
    assert.equal({}.isAdmin, before);
  });

  it('passes children through to the function', () => {
    let receivedChildren = null;
    const fn = (props) => {
      receivedChildren = props.children;
      return document.createElement('div');
    };
    const children = [document.createElement('span')];
    const instance = createComponentInstance(fn, {}, children);
    instance.$constructor();

    assert.equal(receivedChildren, children);
  });

  it('sets element on instance after $constructor call', () => {
    const fn = () => document.createElement('p');
    const instance = createComponentInstance(fn, {}, null);
    assert.equal(instance.element, null);

    instance.$constructor();

    assert.ok(instance.element instanceof Node);
  });
});

// ---------------------------------------------------------------------------
// createComponentInstance — class component
// ---------------------------------------------------------------------------

describe('createComponentInstance — class component', () => {
  it('instantiates class and calls render()', () => {
    class MyComp extends Component {
      render() {
        return document.createElement('article');
      }
    }
    const instance = createComponentInstance(MyComp, {}, null);
    const el = instance.$constructor();

    assert.ok(el instanceof Node);
    assert.equal(el.tagName, 'ARTICLE');
  });

  it('stores classInstance on the descriptor', () => {
    class MyComp extends Component {
      render() {
        return document.createElement('div');
      }
    }
    const instance = createComponentInstance(MyComp, {}, null);
    instance.$constructor();

    assert.ok(instance.classInstance instanceof MyComp);
  });

  it('bridges onMount to mount hook registry', async () => {
    let mounted = false;
    class MyComp extends Component {
      onMount() {
        mounted = true;
      }
      render() {
        return document.createElement('div');
      }
    }
    const instance = createComponentInstance(MyComp, {}, null);
    const parent = document.createElement('div');
    mountComponentInstance(parent, instance);
    await afterFlush();
    await new Promise((r) => queueMicrotask(r));

    assert.ok(mounted);
  });
});

// ---------------------------------------------------------------------------
// mountComponentInstance
// ---------------------------------------------------------------------------

describe('mountComponentInstance', () => {
  it('appends the component element to the parent', () => {
    const fn = () => document.createElement('section');
    const instance = createComponentInstance(fn, {}, null);
    const parent = document.createElement('div');

    mountComponentInstance(parent, instance);

    assert.equal(parent.firstChild?.tagName, 'SECTION');
  });

  it('calls onMount hooks asynchronously via microtask', async () => {
    const _mountCalled = false;
    const _fn = () => {
      // Register onMount from inside the component
      import('../lifecycle.mjs').then(() => {
        // onMount won't work here — we need it called during $constructor
      });
      return document.createElement('div');
    };

    // Simpler: use a class component which bridges onMount directly
    let called = false;
    class MyComp extends Component {
      onMount() {
        called = true;
      }
      render() {
        return document.createElement('div');
      }
    }
    const instance = createComponentInstance(MyComp, {}, null);
    const parent = document.createElement('div');

    mountComponentInstance(parent, instance);
    assert.ok(!called, 'onMount should not be called synchronously');

    await new Promise((r) => queueMicrotask(r));
    assert.ok(called, 'onMount should be called after microtask');
  });
});

// ---------------------------------------------------------------------------
// createComponentInstance — RAW_PROPS per-key opt-out
// ---------------------------------------------------------------------------

describe('createComponentInstance — RAW_PROPS per-key opt-out', () => {
  it('passes only the declared raw keys through unnormalized; other props still normalize', () => {
    let receivedProps = null;
    const fn = (props) => {
      receivedProps = props;
      return document.createElement('div');
    };
    fn[RAW_PROPS] = ['key'];

    const keyFn = (item) => item.id;
    const instance = createComponentInstance(
      fn,
      { key: keyFn, count: 5 },
      null,
    );
    instance.$constructor();

    // "key" is in the raw-key list — stays the exact same function reference,
    // not wrapped in computed().
    assert.equal(receivedProps.key, keyFn);
    // "count" is NOT in the raw-key list — still normalized to a signal.
    assert.ok(typeof receivedProps.count.get === 'function');
    assert.equal(receivedProps.count.get(), 5);
  });

  it('merges children into props.children even when RAW_PROPS is present (even an empty list) — same convention as any other function component', () => {
    let receivedProps = null;
    let receivedSecondArg = null;
    const fn = (props, secondArg) => {
      receivedProps = props;
      receivedSecondArg = secondArg;
      return document.createElement('div');
    };
    fn[RAW_PROPS] = [];

    const children = [document.createElement('span')];
    const instance = createComponentInstance(fn, { foo: 'bar' }, children);
    instance.$constructor();

    // Called with a single argument, like any other function component —
    // children is merged into props.children, not passed separately.
    assert.equal(receivedSecondArg, undefined);
    assert.equal(receivedProps.children, children);
    // "foo" is not in the (empty) raw-key list, so it's still normalized.
    assert.ok(typeof receivedProps.foo.get === 'function');
    assert.equal(receivedProps.foo.get(), 'bar');
  });

  it('does not affect class components even if a RAW_PROPS class had the marker', () => {
    class MyComp extends Component {
      render() {
        this.receivedProps = this.props;
        return document.createElement('div');
      }
    }
    // Marking a class component should be a no-op — class components are
    // never routed through the raw-props branch.
    MyComp[RAW_PROPS] = ['count'];

    const instance = createComponentInstance(MyComp, { count: 5 }, null);
    instance.$constructor();

    assert.ok(
      typeof instance.classInstance.receivedProps.count.get === 'function',
    );
    assert.equal(instance.classInstance.receivedProps.count.get(), 5);
  });

  it('normal (non-tagged) function components still get normalizeProps behavior', () => {
    let receivedProps = null;
    const fn = (props) => {
      receivedProps = props;
      return document.createElement('div');
    };
    const instance = createComponentInstance(fn, { count: 5 }, null);
    instance.$constructor();

    assert.ok(typeof receivedProps.count.get === 'function');
    assert.equal(receivedProps.count.get(), 5);
  });
});
