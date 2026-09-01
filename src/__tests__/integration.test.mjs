// ---------------------------------------------------------------------------
// integration.test.mjs — complex component scenarios mirroring examples/index.mjs
// ---------------------------------------------------------------------------

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { afterFlush, createSignal } from '@esmj/signals';

import {
  Component,
  createContext,
  createElement,
  For,
  getContext,
  If,
  mount,
  onMount,
  Show,
  setContext,
  useRef,
} from '../index.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}
function removeContainer(el) {
  document.body.removeChild(el);
}

// ---------------------------------------------------------------------------
// Integration 1: Counter + If — lifecycle hooks fire correctly
// ---------------------------------------------------------------------------

describe('Integration: Counter with If (lifecycle hooks)', () => {
  it('mounts sub-component when condition is true (even count)', async () => {
    const container = makeContainer();
    const mountLog = [];
    const unmountLog = [];

    function SubComp({ counter }) {
      onMount(() => {
        mountLog.push('mounted');
        return () => unmountLog.push('unmounted');
      });
      return createElement('span', { 'data-testid': 'sub' }, [
        () => `Count: ${counter.get()}`,
      ]);
    }

    function App() {
      const count = createSignal(0); // starts even → SubComp visible

      return createElement('div', {}, [
        createElement(
          'button',
          {
            'data-testid': 'btn',
            onClick: () => count.set(count.get() + 1),
          },
          ['inc'],
        ),
        If(
          () => count.get() % 2 === 0,
          createElement(SubComp, { counter: count }),
        ),
      ]);
    }

    mount(container, createElement(App));
    await afterFlush();

    // Count = 0 (even) → sub-component should be mounted
    const sub = container.querySelector('[data-testid="sub"]');
    assert.ok(sub, 'sub-component should be in the DOM initially');
    assert.equal(mountLog.length, 1, 'onMount should have fired once');

    // Click → count = 1 (odd) → sub-component removed
    container.querySelector('[data-testid="btn"]').click();
    await afterFlush();

    assert.ok(
      !container.querySelector('[data-testid="sub"]'),
      'sub-component should be removed',
    );
    assert.equal(unmountLog.length, 1, 'onUnmount should have fired once');

    // Click → count = 2 (even) → sub-component re-mounted
    container.querySelector('[data-testid="btn"]').click();
    await afterFlush();

    assert.ok(
      container.querySelector('[data-testid="sub"]'),
      'sub-component should be back',
    );
    assert.equal(
      mountLog.length,
      2,
      'onMount should have fired again on re-mount',
    );

    removeContainer(container);
  });
});

// ---------------------------------------------------------------------------
// Integration 2: TodoList with For — add / update / delete items
// ---------------------------------------------------------------------------

describe('Integration: TodoList with For', () => {
  it('renders initial list and supports add, update, delete', async () => {
    const container = makeContainer();
    const items = createSignal([
      { id: 1, text: 'Learn signals' },
      { id: 2, text: 'Build app' },
    ]);

    function TodoList() {
      return createElement('ul', { 'data-testid': 'list' }, [
        For(
          () => items.get(),
          (item) => item.id,
          (itemSig) => {
            const li = createElement(
              'li',
              { 'data-id': String(itemSig.get().id) },
              [() => itemSig.get().text],
            );
            return li;
          },
        ),
      ]);
    }

    mount(container, createElement(TodoList));
    await afterFlush();

    const list = container.querySelector('[data-testid="list"]');
    assert.ok(list, 'list should be rendered');
    assert.equal(list.querySelectorAll('li').length, 2);

    // Add item
    items.set([...items.get(), { id: 3, text: 'Release' }]);
    await afterFlush();

    assert.equal(list.querySelectorAll('li').length, 3);
    const texts = Array.from(list.querySelectorAll('li')).map(
      (li) => li.textContent,
    );
    assert.equal(texts[2], 'Release');

    // Update item in-place (same key)
    items.set(
      items
        .get()
        .map((i) => (i.id === 1 ? { ...i, text: 'Learn signals (done)' } : i)),
    );
    await afterFlush();

    const updatedLi = list.querySelector('[data-id="1"]');
    assert.equal(
      updatedLi.textContent,
      'Learn signals (done)',
      'Item text should update reactively',
    );

    // Delete item
    items.set(items.get().filter((i) => i.id !== 2));
    await afterFlush();

    assert.equal(list.querySelectorAll('li').length, 2);
    assert.ok(
      !list.querySelector('[data-id="2"]'),
      'deleted item should not exist',
    );

    removeContainer(container);
  });
});

// ---------------------------------------------------------------------------
// Integration 3: Context propagation
// ---------------------------------------------------------------------------

describe('Integration: Context propagation', () => {
  it('child reads context value set by parent', async () => {
    const container = makeContainer();
    const ThemeContext = createContext('light');
    let childReceivedTheme = null;

    function Child() {
      childReceivedTheme = getContext(ThemeContext);
      return createElement('div', { 'data-testid': 'child' }, [
        childReceivedTheme,
      ]);
    }

    function Parent() {
      setContext(ThemeContext, 'dark');
      return createElement('div', {}, [createElement(Child, {})]);
    }

    mount(container, createElement(Parent));
    await afterFlush();

    assert.equal(childReceivedTheme, 'dark');
    removeContainer(container);
  });
});

describe('Integration: Context on reactive re-renders', () => {
  it('keeps context in $dangerouslySetInnerHTML function on subsequent updates', async () => {
    const container = makeContainer();
    const ThemeContext = createContext('light');
    const tick = createSignal(0);
    const seen = [];

    function App() {
      setContext(ThemeContext, 'dark');

      return createElement('div', {
        $dangerouslySetInnerHTML: () => {
          tick.get();
          const theme = getContext(ThemeContext);
          seen.push(theme);
          return `<span>${theme}</span>`;
        },
      });
    }

    mount(container, createElement(App));
    await afterFlush();

    tick.set(1);
    await afterFlush();

    assert.equal(seen[0], 'dark');
    assert.equal(
      seen[1],
      'dark',
      'second effect run should keep parent context value',
    );

    removeContainer(container);
  });

  it('keeps context in reactive function children after signal updates', async () => {
    const container = makeContainer();
    const ThemeContext = createContext('light');
    const tick = createSignal(0);
    const seen = [];

    function App() {
      setContext(ThemeContext, 'dark');

      return createElement('div', {}, [
        () => {
          tick.get();
          const theme = getContext(ThemeContext);
          seen.push(theme);
          return theme;
        },
      ]);
    }

    mount(container, createElement(App));
    await afterFlush();

    tick.set(1);
    await afterFlush();

    assert.equal(seen[0], 'dark');
    assert.equal(
      seen[1],
      'dark',
      'second function-child run should keep parent context value',
    );

    removeContainer(container);
  });

  it('keeps context in reactive attribute value function after updates', async () => {
    const container = makeContainer();
    const ThemeContext = createContext('light');
    const tick = createSignal(0);
    const seen = [];

    function App() {
      setContext(ThemeContext, 'dark');

      return createElement('div', {
        className: () => {
          tick.get();
          const theme = getContext(ThemeContext);
          seen.push(theme);
          return `theme-${theme}`;
        },
      });
    }

    mount(container, createElement(App));
    await afterFlush();

    tick.set(1);
    await afterFlush();

    assert.equal(seen[0], 'dark');
    assert.equal(
      seen[1],
      'dark',
      'second reactive-attribute run should keep parent context value',
    );

    removeContainer(container);
  });
});

// ---------------------------------------------------------------------------
// Integration 4: Show + signal
// ---------------------------------------------------------------------------

describe('Integration: Show + signal visibility', () => {
  it('element remains in DOM but toggles visibility', async () => {
    const container = makeContainer();
    const visible = createSignal(true);

    function App() {
      return createElement('div', {}, [
        Show(
          () => visible.get(),
          createElement('p', { 'data-testid': 'message' }, ['Hello']),
        ),
      ]);
    }

    mount(container, createElement(App));
    await afterFlush();

    const message = container.querySelector('[data-testid="message"]');
    assert.ok(message, 'element should be in the DOM');
    assert.notEqual(message.style.display, 'none', 'initially visible');

    visible.set(false);
    await afterFlush();

    assert.ok(
      container.querySelector('[data-testid="message"]'),
      'element stays in DOM when hidden',
    );
    assert.equal(
      message.style.display,
      'none',
      'hidden when condition is false',
    );

    visible.set(true);
    await afterFlush();

    assert.notEqual(message.style.display, 'none', 'visible again');
    removeContainer(container);
  });
});

// ---------------------------------------------------------------------------
// Integration 5: Class component (Item) inside For
// ---------------------------------------------------------------------------

describe('Integration: Class component inside For', () => {
  it('renders class components as list items', async () => {
    const container = makeContainer();
    const items = createSignal([
      { id: 1, text: 'First' },
      { id: 2, text: 'Second' },
    ]);

    class ItemComp extends Component {
      render() {
        const text = this.props.text.get?.() ?? this.props.text;
        return createElement('li', { 'data-testid': 'item' }, [text]);
      }
    }

    function App() {
      return createElement('ul', {}, [
        For(
          () => items.get(),
          (item) => item.id,
          (itemSig) => createElement(ItemComp, { text: itemSig.get().text }),
        ),
      ]);
    }

    mount(container, createElement(App));
    await afterFlush();

    const listItems = container.querySelectorAll('[data-testid="item"]');
    assert.equal(listItems.length, 2);
    assert.equal(listItems[0].textContent, 'First');
    assert.equal(listItems[1].textContent, 'Second');

    removeContainer(container);
  });
});

// ---------------------------------------------------------------------------
// Integration 6: Reactive props across component boundary
// ---------------------------------------------------------------------------

describe('Integration: Reactive signal prop flows into child component', () => {
  it('child component updates when parent signal changes', async () => {
    const container = makeContainer();
    const name = createSignal('World');

    function Greeting({ name }) {
      return createElement('p', { 'data-testid': 'greeting' }, [
        () => `Hello, ${name.get()}!`,
      ]);
    }

    function App() {
      return createElement('div', {}, [
        createElement(Greeting, { name }),
        createElement(
          'button',
          {
            'data-testid': 'change-btn',
            onClick: () => name.set('Node'),
          },
          ['Change'],
        ),
      ]);
    }

    mount(container, createElement(App));
    await afterFlush();

    assert.equal(
      container.querySelector('[data-testid="greeting"]').textContent,
      'Hello, World!',
    );

    container.querySelector('[data-testid="change-btn"]').click();
    await afterFlush();

    assert.equal(
      container.querySelector('[data-testid="greeting"]').textContent,
      'Hello, Node!',
    );

    removeContainer(container);
  });
});

// ---------------------------------------------------------------------------
// Integration 7: useRef in component
// ---------------------------------------------------------------------------

describe('Integration: useRef in component', () => {
  it('supports $ref: ref and access via ref.get() and ref.focus()', async () => {
    const container = makeContainer();
    const mountLog = { focused: false, valueViaGet: null };

    function App() {
      const inputRef = useRef();

      onMount(() => {
        inputRef.focus();
        mountLog.valueViaGet = inputRef.get()?.value ?? null;
      });

      const input = createElement('input', { $ref: inputRef, value: 'hello' });
      input.focus = () => {
        mountLog.focused = true;
      };

      return createElement('div', {}, [input]);
    }

    mount(container, createElement(App));
    await afterFlush();

    assert.equal(mountLog.focused, true);
    assert.equal(mountLog.valueViaGet, 'hello');

    removeContainer(container);
  });
});
