import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Component } from '../Component.mjs';

// ---------------------------------------------------------------------------
// Component base class
// ---------------------------------------------------------------------------

describe('Component', () => {
  it('stores props on this.props', () => {
    const props = { name: 'test', value: 42 };
    const comp = new Component(props);
    assert.equal(comp.props, props);
  });

  it('stores undefined props when none are provided', () => {
    const comp = new Component(undefined);
    assert.equal(comp.props, undefined);
  });

  it('can be subclassed with a render() method', () => {
    class MyButton extends Component {
      render() {
        const el = document.createElement('button');
        el.textContent = this.props.label.get?.() ?? this.props.label;
        return el;
      }
    }

    const comp = new MyButton({ label: 'Click me' });
    const el = comp.render();

    assert.ok(el instanceof HTMLElement);
    assert.equal(el.tagName, 'BUTTON');
    assert.equal(el.textContent, 'Click me');
  });

  it('can implement onMount and onUnmount lifecycle methods', () => {
    class MyComp extends Component {
      constructor(props) {
        super(props);
        this.mounted = false;
        this.unmounted = false;
      }
      onMount() {
        this.mounted = true;
      }
      onUnmount() {
        this.unmounted = true;
      }
      render() {
        return document.createElement('div');
      }
    }

    const comp = new MyComp({});
    comp.onMount();
    assert.ok(comp.mounted);

    comp.onUnmount();
    assert.ok(comp.unmounted);
  });
});
