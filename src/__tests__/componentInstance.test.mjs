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
    const mountCalled = false;
    const fn = () => {
      // Register onMount from inside the component
      import('../lifecycle.mjs').then(({ onMount }) => {
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
