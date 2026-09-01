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
//  - <If>/<For>/<Toggle> can be used as JSX elements directly (props +
//    children), in addition to their low-level function-call form
//    (If(condition, then, else), For(itemsAccessor, keyFn, renderFn),
//    Show(condition, child)) — both styles are fully supported.
//  - <>...</> (Fragment) groups children with no wrapping DOM element; the
//    JSX transform auto-imports `Fragment` from the jsx-runtime, so no
//    explicit import is needed for the shorthand syntax.
// ---------------------------------------------------------------------------

import { createSignal } from '@esmj/signals';
import uid from 'easy-uid';

import {
  Component,
  For,
  If,
  mount,
  onMount,
  Toggle,
  useRef,
} from '../src/index.mjs';

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
  // For/If forward unrecognized props straight to their reconciliation
  // wrapper element, exactly like a plain DOM element — useRef + className
  // work here the same way they'd work on a <div>.
  const ifRef = useRef((el) => console.log('If wrapper element:', el));

  return (
    <div data-testid="xxx">
      <p onClick={() => state.set(state.get() + 1)}>
        {() => `Count: ${state.get()}`}
        <If
          when={() => state.get() % 2 === 0}
          fallback={<Yyy counter={state} />} // component instance
          className="if-wrapper"
          $ref={ifRef}
        >
          <p>TextNode</p> {/* borrowed Node */}
        </If>
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
    console.log('Item mounted:', this.state.text.get());
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
  const forRef = useRef((el) => console.log('For wrapper element:', el));

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
      {/* item is a read-only signal: call item.get() to read the current value */}
      <For
        each={() => items.get()}
        keyFn={(item) => item.id}
        tagName="ul"
        className="todo-items"
        $ref={forRef}
      >
        {(item) => (
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
        )}
      </For>
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

// Toggle keeps its child in the DOM and only toggles CSS display — unlike
// If, no teardown/remount happens on show/hide.
function ToggleDemo() {
  const showDetails = createSignal(true);

  return (
    <div data-testid="toggle-demo">
      <h2>Toggle Demo</h2>
      <button onClick={() => showDetails.set(!showDetails.get())}>
        {() => (showDetails.get() ? 'Hide details' : 'Show details')}
      </button>
      <Toggle when={() => showDetails.get()}>
        <p>These details stay mounted — only `display` toggles.</p>
      </Toggle>
    </div>
  );
}

function App() {
  const count = createSignal(0);
  const name = createSignal('World');
  const parityRef = useRef((el) => console.log('App If wrapper element:', el));

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
      <If
        when={() => count.get() % 2 === 0}
        fallback={<OddCounter counter={count} />}
        className="parity-display"
        $ref={parityRef}
      >
        <p style={{ color: 'green' }}>Count is even</p>
      </If>
      <hr />
      <TodoList />
      <ChildrenDemo>
        <p>This is a child element passed to ChildrenDemo.</p>
      </ChildrenDemo>
      <hr />
      <FragmentDemo />
      <hr />
      <ToggleDemo />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
mount('#component', <App />);
