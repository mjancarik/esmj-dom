// ---------------------------------------------------------------------------
// examples/index.jsx — demo components using @esmj/dom's JSX support
//
// Requires a JSX transpiler configured for the "automatic" runtime with
// jsxImportSource pointing at this package's jsx-runtime (see
// examples/vite.config.mjs, which points it at the local ../src during
// development — a real consumer would set jsxImportSource: "@esmj/dom").
//
// Notes vs. the plain createElement() style:
//  - Elements are built with JSX (<div>, <Component ... />) instead of
//    createElement(...) calls.
//  - Component functions/classes referenced in JSX MUST be capitalized —
//    lowercase tags (<div>, <yyy>) are treated as intrinsic HTML elements by
//    JSX, not as references to a variable. (The old lowercase `xxx`/`yyy`
//    demo functions were renamed to `Xxx`/`Yyy` for this reason.)
//  - If()/Each()/Show() are plain function calls, not JSX components —
//    embed their result as {expr} inside JSX children.
//  - <>...</> (Fragment) groups children with no wrapping DOM element; the
//    JSX transform auto-imports `Fragment` from the jsx-runtime, so no
//    explicit import is needed for the shorthand syntax.
// ---------------------------------------------------------------------------

import { createSignal } from '@esmj/signals';
import uid from 'easy-uid';

import { Component, Each, If, mount, onMount } from '../src/index.mjs';

// ---------------------------------------------------------------------------
// Example 1: Xxx / Yyy — basic counter with If and component lifecycle
// (defined for reference; not mounted)
// ---------------------------------------------------------------------------

function Yyy({ counter }) {
  let yElement, yyElement;

  onMount(() => {
    console.log('Mounted Yyy:', yElement, yyElement);

    return () => {
      console.log('Unmounted Yyy:', yElement, yyElement);
    };
  });

  return (
    <div data-testid="yyy" $ref={(el) => (yElement = el)}>
      <main $ref={(el) => (yyElement = el)}>
        {() => `Count is ${counter.get() % 2 === 0 ? 'even' : 'odd'}`}
      </main>
    </div>
  );
}

function Xxx() {
  const state = createSignal(0);

  return (
    <div data-testid="xxx">
      <p onClick={() => state.set(state.get() + 1)}>
        {() => `Count: ${state.get()}`}
        {If(
          () => state.get() % 2 === 0,
          <p>TextNode</p>, // borrowed Node
          <Yyy counter={state} />, // component instance
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Example 2: App — full demo with OddCounter, TodoList, and a Fragment demo
// ---------------------------------------------------------------------------

function OddCounter({ counter }) {
  let mainRef;

  onMount(() => {
    console.log('OddCounter mounted, ref:', mainRef);
    return () => console.log('OddCounter unmounted');
  });

  return (
    <div data-testid="odd-counter">
      <main $ref={(el) => (mainRef = el)}>
        {() => `Count is odd: ${counter.get()}`}
      </main>
    </div>
  );
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
    return (
      <li>
        {this.state.text}
        {this.props.children}
      </li>
    );
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

  return (
    <div data-testid="todo-list">
      <h2>Todo List</h2>
      <div>
        <input
          type="text"
          placeholder="Add todo..."
          value={() => newText.get()}
          onInput={(e) => newText.set(e.target.value)}
        />
        <button onClick={addItem}>Add</button>
      </div>
      <ul>
        {Each(
          () => items.get(),
          (item) => item.id,
          // item is a read-only signal: call item.get() to read the current value
          (item) => (
            <Item text={item.get().text}>
              <button
                onClick={() =>
                  items.set(items.get().filter((i) => i.id !== item.get().id))
                }
                style="margin-left: 8px"
              >
                ×
              </button>
            </Item>
          ),
        )}
      </ul>
    </div>
  );
}

function ChildrenDemo({ children }) {
  return (
    <div data-testid="children-demo">
      <h2>Children Demo</h2>
      {children}
    </div>
  );
}

// <>...</> groups multiple children with no wrapper element in the DOM.
function FragmentDemo() {
  return (
    <>
      <p>These two paragraphs are grouped with a Fragment…</p>
      <p>…with no wrapping element around them in the DOM.</p>
    </>
  );
}

function App() {
  const count = createSignal(0);
  const name = createSignal('World');

  return (
    <div data-testid="app">
      <h1>{() => `Hello ${name.get()}!`}</h1>
      <button onClick={() => count.set(count.get() + 1)}>
        {() => `Count: ${count.get()}`}
      </button>
      <br />
      <input
        type="text"
        value="World"
        onInput={(e) => name.set(e.target.value)}
      />
      <hr />
      {If(
        () => count.get() % 2 === 0,
        <p style={{ color: 'green' }}>Count is even</p>,
        <OddCounter counter={count} />,
      )}
      <hr />
      <TodoList />
      <ChildrenDemo>
        <p>This is a child element passed to ChildrenDemo.</p>
      </ChildrenDemo>
      <hr />
      <FragmentDemo />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
mount('#component', <App />);
