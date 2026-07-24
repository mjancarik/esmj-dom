// ---------------------------------------------------------------------------
// examples/index.mjs — demo components ported from ai-concept-v2.mjs
//
// Changes from v2:
//  - Each renderFn receives a read-only signal: item.get() instead of item()
//  - style object passed directly: { color: 'green' } instead of a string
//  - boot target changed to mount('#app', …)
// ---------------------------------------------------------------------------

import { createSignal } from '@esmj/signals';
import uid from 'easy-uid';

import {
  createElement,
  If,
  Each,
  Show,
  mount,
  onMount,
  onUnmount,
  Component,
} from '../src/index.mjs';

// ---------------------------------------------------------------------------
// Example 1: xxx / yyy — basic counter with If and component lifecycle
// ---------------------------------------------------------------------------

function yyy({ counter }) {
  let yElement, yyElement;

  onMount(() => {
    console.log('Mounted yyy:', yElement, yyElement);

    return () => {
      console.log('Unmounted yyy:', yElement, yyElement);
    };
  });

  return createElement(
    'div',
    { 'data-testid': 'yyy', $ref: (el) => (yElement = el) },
    [
      createElement('main', { $ref: (el) => (yyElement = el) }, [
        () => `Count is ${counter.get() % 2 === 0 ? 'even' : 'odd'}`,
      ]),
    ],
  );
}

function xxx() {
  const state = createSignal(0);

  return createElement('div', { 'data-testid': 'xxx' }, [
    createElement(
      'p',
      {
        onClick: () => state.set(state.get() + 1),
      },
      [
        () => `Count: ${state.get()}`,
        If(
          () => state.get() % 2 === 0,
          createElement('p', {}, ['TextNode']), // borrowed Node
          createElement(yyy, { counter: state }), // component instance
        ),
      ],
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Example 2: App — full demo with OddCounter and TodoList
// ---------------------------------------------------------------------------

function OddCounter({ counter }) {
  let mainRef;

  onMount(() => {
    console.log('OddCounter mounted, ref:', mainRef);
    return () => console.log('OddCounter unmounted');
  });

  return createElement('div', { 'data-testid': 'odd-counter' }, [
    createElement('main', { $ref: (el) => (mainRef = el) }, [
      () => `Count is odd: ${counter.get()}`,
    ]),
  ]);
}

class Item extends Component {
  constructor(props) {
    super(props);
    this.state = { text: props.text };
  }
  
  onMount() {
    console.log('Item mounted:', this.state.text);
  }

  render() {
    return createElement('li', {}, [
      this.state.text,
      this.props.children,
    ]);
  }
}

function TodoList() {
  const items = createSignal([
    { id: 1, text: 'Learn signals' },
    { id: 2, text: 'Build template engine' },
  ]);
  const newText = createSignal('');

  onMount(() => {
    console.log('TodoList mounted');
    return () => console.log('TodoList unmounted');
  });

  function addItem() {
    const text = newText.get().trim();
    if (!text) return;
    items.set([...items.get(), { id: uid(), text }]);
    newText.set('');
  }

  return createElement('div', { 'data-testid': 'todo-list' }, [
    createElement('h2', {}, ['Todo List']),
    createElement('div', {}, [
      createElement(
        'input',
        {
          type: 'text',
          placeholder: 'Add todo...',
          value: () => newText.get(),
          onInput: (e) => newText.set(e.target.value),
        },
        [],
      ),
      createElement('button', { onClick: addItem }, ['Add']),
    ]),
    createElement('ul', {}, [
      Each(
        () => items.get(),
        (item) => item.id,
        // item is a read-only signal: call item.get() to read the current value
        (item) =>
          createElement(Item, { text: item.get().text }, [
            createElement(
              'button',
              {
                onClick: () =>
                  items.set(items.get().filter((i) => i.id !== item.get().id)),
                style: 'margin-left: 8px',
              },
              ['×'],
            ),
          ]),
      ),
    ]),
  ]);
}

function ChildrenDemo({ children }) {
  return createElement('div', { 'data-testid': 'children-demo' }, [
    createElement('h2', {}, ['Children Demo']),
    ...children,
  ]);
}

function App() {
  const count = createSignal(0);
  const name = createSignal('World');

  return createElement('div', { 'data-testid': 'app' }, [
    createElement('h1', {}, [() => `Hello ${name.get()}!`]),
    createElement('button', { onClick: () => count.set(count.get() + 1) }, [
      () => `Count: ${count.get()}`,
    ]),
    createElement('br', {}, []),
    createElement(
      'input',
      {
        type: 'text',
        value: 'World',
        onInput: (e) => name.set(e.target.value),
      },
      [],
    ),
    createElement('hr', {}, []),
    If(
      () => count.get() % 2 === 0,
      createElement('p', { style: { color: 'green' } }, ['Count is even']),
      createElement(OddCounter, { counter: count }),
    ),
    createElement('hr', {}, []),
    createElement(TodoList, {}, []),
    createElement(ChildrenDemo, {}, [
      createElement('p', {}, ['This is a child element passed to ChildrenDemo.']),
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
mount('#component', createElement(App));
