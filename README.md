# @esmj/dom

A tiny, reactive DOM library for building component-based UIs in vanilla JavaScript. It uses `@esmj/signals` for fine-grained reactivity — only the parts of the DOM that depend on a changed signal update, with no virtual DOM or diffing overhead.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [API Reference](#api-reference)
  - [mount](#mountcontainer-rootchild)
  - [unmount](#unmountcontainer)
  - [createElement](#createelementtagnamecomponent-props-children)
  - [Fragment & JSX support](#fragment--jsx-support)
  - [Component](#component-base-class)
  - [If](#ifcondition-thenchild-elsechild-options)
  - [Show](#showcondition-child)
  - [Each](#eachitemsaccessor-keyfn-renderfn-options)
  - [Lifecycle Hooks](#lifecycle-hooks)
    - [onMount](#onmountcallback)
    - [onUnmount](#onunmountcallback)
    - [onEffect](#oneffectdisposefn)
    - [afterRender](#afterrendercallback)
  - [Context API](#context-api)
    - [createContext](#createcontextdefaultvalue)
    - [setContext](#setcontextctx-value)
    - [getContext](#getcontextctx)
  - [useRef](#userefonassign)
  - [Utilities](#utilities)
  - [Advanced](#advanced)
    - [renderChild](#renderchildparent-child)
    - [withContext](#withcontextctx-fn)
- [Examples](#examples)
  - [Counter with conditional rendering](#counter-with-conditional-rendering)
  - [Reactive list with Each](#reactive-list-with-each)
  - [Class-based component](#class-based-component)
  - [Context API usage](#context-api-usage)
- [License](#license)

## Installation

```sh
npm install @esmj/dom
```

## Quick Start

```js
import { createSignal } from '@esmj/signals';
import { createElement, mount, onMount } from '@esmj/dom';

function Counter() {
  const count = createSignal(0);

  onMount(() => {
    console.log('Counter mounted');
    return () => console.log('Counter unmounted');
  });

  return createElement('div', {}, [
    createElement(
      'button',
      { onClick: () => count.set(count.get() + 1) },
      [() => `Count: ${count.get()}`],
    ),
  ]);
}

mount('#app', createElement(Counter, {}));
```

Children that are **functions** (`() => someSignal.get()`) are reactive text nodes — they re-evaluate and update the DOM automatically whenever a signal they read changes.

## Core Concepts

**Signals as props** — Any prop value can be a signal, a computed, or a plain function. `createElement` wraps plain functions in `computed()` automatically, so the attribute or text node stays in sync with the signal graph.

**Prop name aliases** — `className` → `class`, `htmlFor` → `for`, `tabIndex` → `tabindex`, `readOnly` → `readonly`, `autoComplete` → `autocomplete`.

**Special props:**
- `$ref: (el) => ...` — called with the real DOM element after it is created.
- `on*` (e.g. `onClick`, `onInput`) — added as `addEventListener` listeners (`onSecurityPolicyViolation` is blocked).
- `style` — accepts an object `{ color: 'red' }` or a string.
- `$dangerouslySetInnerHTML` — accepts a string, `DocumentFragment`, signal, or function and replaces element content reactively.
- Security guardrails: `srcdoc` is blocked, and URL-like attributes (`href`, `src`, `action`, `formaction`, `xlink:href`) reject `javascript:` values.

**Ownership model** — `If` and `Each` accept two kinds of children:
- **Borrowed Node** (`createElement('div', ...)`) — only detached/re-attached on branch switch; reactive bindings and effects stay alive across toggles.
- **Owned ComponentInstance** (`createElement(MyComponent, ...)`) — fully torn down (`onUnmount` fires, effects disposed) and freshly created on each activation.

## API Reference

### `mount(container, rootChild)`

Renders `rootChild` into `container` and clears any previous content.

If the container already holds a previously mounted tree, `mount()` first runs
the same teardown path as `unmount()` for existing children (component
`onUnmount` hooks + registered disposers), then mounts the new root.

| Param | Type | Description |
|---|---|---|
| `container` | `string \| Element` | CSS selector string or a DOM element. |
| `rootChild` | `Node \| ComponentInstance \| string` | The root node or component to render. |

```js
mount('#app', createElement(App, {}));
mount(document.getElementById('app'), createElement(App, {}));
```

---

### `unmount(container)`

Tears down the component tree inside `container` and clears its DOM. This is the symmetric inverse of `mount`.

Runs all `onUnmount` hooks and disposes signal effects (`onEffect`) for every component in the tree, then empties the container element.

| Param | Type | Description |
|---|---|---|
| `container` | `string \| Element` | CSS selector string or a DOM element. |

```js
// Mount an app
mount('#app', createElement(App, {}));

// Later — tear it down cleanly
unmount('#app');
```

---

### `createElement(tagName|Component, props, children)`

Creates a DOM element or a lazy component descriptor.

**Signatures:**

```js
// HTML element
createElement('div', { className: 'box', onClick: handler }, [child1, child2]);

// Function component
createElement(MyComponent, { count: signal });

// Shorthand (defaults to <div>)
createElement({ className: 'wrapper' }, [children]);
```

**Children** can be:
- A DOM `Node`
- A component instance (result of `createElement(Component, props)`)
- A `string` or `number` — becomes a text node
- A `() => value` **function** — becomes a reactive text node; re-evaluated on signal change

`$dangerouslySetInnerHTML` also supports reactive updates:

```js
const html = createSignal('<em>initial</em>');

createElement('div', {
  $dangerouslySetInnerHTML: html, // also accepts () => '<b>...</b>' or DocumentFragment
});
```

```js
const count = createSignal(0);

createElement('p', {}, [
  () => `Current count: ${count.get()}`,
]);
```

---

### Fragment & JSX support

`@esmj/dom` ships an automatic JSX runtime, so you can use `.jsx`/`.tsx` files with a transpiler (esbuild, Babel, or TypeScript) configured for the **automatic** JSX transform instead of calling `createElement` directly.

**tsconfig.json:**

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@esmj/dom"
  }
}
```

Once configured, the transpiler rewrites JSX into calls against `@esmj/dom/jsx-runtime` (production) or `@esmj/dom/jsx-dev-runtime` (dev-time tooling such as Vite dev/Babel `development: true`) automatically — you don't import from those entry points yourself.

```jsx
import { createSignal } from '@esmj/signals';
import { mount } from '@esmj/dom';

function Counter() {
  const count = createSignal(0);
  return (
    <button onClick={() => count.set(count.get() + 1)}>
      Count: {() => count.get()}
    </button>
  );
}

mount('#app', <Counter />);
```

**`Fragment`** (`<>...</>`) groups children without introducing a wrapping DOM element — it renders as a `DocumentFragment`. It is also exported as a value from the main package for direct `createElement(Fragment, props, children)` calls.

```jsx
import { Fragment } from '@esmj/dom';

function Pair() {
  return (
    <>
      <span>left</span>
      <span>right</span>
    </>
  );
}
```

> **Known limitation:** returning a `Fragment` as the *sole* root value of a component's `render()`/function body works for mounting and unmounting (including `onMount`/`onUnmount`/`onEffect`), but an **empty** Fragment (zero children) has no live DOM node left to carry that bookkeeping, so its lifecycle hooks will not fire. Always render at least one child from a Fragment-returning component.

---

### `Component` base class

Extend `Component` to use the class component API. The library calls `render()` to build the DOM and looks for optional `onMount()` / `onUnmount()` lifecycle methods.

> **Props are signals.** All props passed to a class component are normalized automatically: plain values become `createSignal(value)`, functions become `computed(fn)`. Always call `.get()` to read a prop value inside `render()` and lifecycle methods.

```js
import { Component, createElement } from '@esmj/dom';

class MyCard extends Component {
  onMount() {
    console.log('mounted, label:', this.props.label.get());
  }

  onUnmount() {
    console.log('unmounted');
  }

  render() {
    return createElement('div', { className: 'card' }, [
      this.props.children,
    ]);
  }
}

// Usage
createElement(MyCard, { label: 'Hello' }, [
  createElement('p', {}, ['Hello from class component']),
]);
```

---

### `If(condition, thenChild, elseChild?, options?)`

Conditionally renders one of two branches. When the branch changes, the inactive branch is removed from the DOM (component instances are fully torn down; lifecycle hooks fire).

| | `If` | `Show` |
|---|---|---|
| DOM removal on toggle | ✅ full teardown | ❌ stays in DOM |
| `onMount`/`onUnmount` fire | ✅ | ❌ |
| Reactive attributes preserved | resets on each activation | ✅ always alive |
| Use when | branch is rarely shown or expensive to keep | state/scroll position must survive hide |

Use `If` when you need DOM teardown and lifecycle hooks. Use [`Show`](#showcondition-child) when you only want to toggle visibility while keeping the element alive.

| Param | Type | Description |
|---|---|---|
| `condition` | `() => boolean` | Reactive condition accessor. |
| `thenChild` | `Node \| ComponentInstance` | Rendered when condition is truthy. |
| `elseChild` | `Node \| ComponentInstance` | Optional. Rendered when condition is falsy. |
| `options.tagName` | `string` | Optional. Tag name for the wrapper element. Defaults to `'span'`. Use this when the wrapper's parent element only accepts specific direct children (e.g. `{ tagName: 'tbody' }` inside a `<table>`). If you want to pass `options` without an `elseChild`, pass `null` as the 3rd argument: `If(cond, thenChild, null, { tagName: 'tbody' })`. |

Returns a `display:contents` wrapper (default `<span>`, configurable via `options.tagName`) that is invisible to CSS layout.

> **Known limitation:** no `tagName` value makes the wrapper valid inside `<ul>`, `<ol>`, or `<select>` — those elements only accept their specific item tag (`<li>`/`<option>`) as *direct* children, regardless of the wrapper's `display` style. Avoid `If`/`Each` directly inside those elements until a future anchor-based (no-wrapper) implementation lands.

```js
const isLoggedIn = createSignal(false);

If(
  () => isLoggedIn.get(),
  createElement(Dashboard, {}),
  createElement(LoginForm, {}),
);
```

---

### `Show(condition, child)`

Toggles an element's `display` style between `''` and `'none'`. The element
**stays in the DOM** while visibility changes — no teardown and no lifecycle
hooks on show/hide toggles.

Use `Show` to preserve component state or skip remounting cost. Use [`If`](#ifcondition-thenchild-elsechild-options) for full teardown semantics.

| Param | Type | Description |
|---|---|---|
| `condition` | `() => boolean` | Reactive condition accessor. |
| `child` | `Node \| ComponentInstance \| string` | The element to show or hide. |

```js
const showPanel = createSignal(true);

Show(
  () => showPanel.get(),
  createElement('aside', { className: 'panel' }, ['Sidebar content']),
);
```

---

### `Each(itemsAccessor, keyFn, renderFn, options?)`

Efficiently renders a keyed list. Each item gets its own reactive signal. When the array changes:

- **Existing key** → `itemSignal.set(newItem)` — in-place reactive update, no remount.
- **New key** → fresh signal + fresh DOM via `renderFn`.
- **Removed key** → full teardown + DOM removal.
- **Duplicate key in same list update** → logs an error and ignores later duplicates for that update cycle.

| Param | Type | Description |
|---|---|---|
| `itemsAccessor` | `() => Item[]` | Returns the current array. |
| `keyFn` | `(item, index) => string \| number` | Produces a stable key per item. |
| `renderFn` | `(itemSignal, index) => Node` | Builds the DOM for one item. Called **once per new key** — use `itemSignal.get()` inside reactive expressions to receive in-place updates without remounting. |
| `options.equals` | `(prev: Item, next: Item) => boolean` | Equality check used by each item's signal on existing-key updates. Defaults to [`deepEqual`](#deepequala-b). |
| `options.tagName` | `string` | Optional. Tag name for the wrapper element. Defaults to `'span'`. Use this when the wrapper's parent element only accepts specific direct children (e.g. `{ tagName: 'tbody' }` inside a `<table>`). |

Returns a `display:contents` wrapper (default `<span>`, configurable via `options.tagName`).

> **Known limitation:** no `tagName` value makes the wrapper valid inside `<ul>`, `<ol>`, or `<select>` — those elements only accept their specific item tag (`<li>`/`<option>`) as *direct* children, regardless of the wrapper's `display` style. Avoid `Each` directly inside those elements until a future anchor-based (no-wrapper) implementation lands.

```js
const todos = createSignal([
  { id: 1, text: 'Buy milk' },
  { id: 2, text: 'Walk the dog' },
]);

Each(
  () => todos.get(),
  (item) => item.id,
  (item) => createElement('li', {}, [() => item.get().text]),
);
```

**Custom `equals` for contenteditable / DOM-ahead-of-model UIs** — the default
`deepEqual` skips notifying an item's subscribers when a replacement item is
structurally identical to the previous one. That's usually the right call for
static lists, but it breaks editors where the DOM can diverge from the model
(e.g. mid-edit) and a programmatic update "corrects" the model back to a value
that's deep-equal to what it already held — reactive bindings like
`$dangerouslySetInnerHTML` would never re-run, leaving stale DOM behind. Pass
a reference-identity `equals` and always assign a **new object reference** at
changed indices to force the update through:

```js
Each(
  () => content.get(),
  (item) => item.id,
  (itemSignal) =>
    createElement('p', {
      contentEditable: true,
      $dangerouslySetInnerHTML: () => itemSignal.get().text || '<br>',
    }),
  { equals: (a, b) => a === b },
);
```

---

## Lifecycle Hooks

Lifecycle hooks must be called **during component construction** (i.e. synchronously inside a function component body or a class constructor). They register against the currently-active component context.

---

### `onMount(callback)`

Runs after the component's DOM node is inserted into the document. If `callback` returns a function, that function is automatically registered as an unmount cleanup.

```js
function MyComponent() {
  onMount(() => {
    console.log('mounted');

    // optional cleanup — equivalent to calling onUnmount
    return () => console.log('unmounted');
  });

  return createElement('div', {}, ['Hello']);
}
```

---

### `onUnmount(callback)`

Registers a cleanup callback that runs when the component is removed from the DOM. Alternative to returning a function from `onMount`.

```js
function Timer() {
  const tick = createSignal(0);
  const id = setInterval(() => tick.set(tick.get() + 1), 1000);

  onUnmount(() => clearInterval(id));

  return createElement('span', {}, [() => `${tick.get()}s`]);
}
```

---

### `onEffect(disposeFn)`

Registers the **return value of `effect()`** as a component-scoped disposer. It is called automatically on unmount.

Use `onEffect` for signal effects. Use `onUnmount` for everything else (timers, event listeners, subscriptions).

```js
import { effect } from '@esmj/signals';

function SyncTitle({ title }) {
  // effect() returns a dispose function — pass it to onEffect
  onEffect(effect(() => {
    document.title = title.get();
  }));

  return createElement('span', {}, []);
}
```

---

### `afterRender(callback)`

Schedules `callback` after all pending renders and cascading reactive updates have fully settled (uses `onFlush` + a macrotask). Because all signal flushes are microtasks, they are guaranteed to drain before any macrotask runs.

Use this when you need to read layout or focus an element after the DOM has fully settled. **Not** a general post-render hook — for signal side-effects, use `onEffect` instead.

```js
function FocusInput() {
  let inputEl;

  afterRender(() => {
    inputEl?.focus();
  });

  return createElement('input', { $ref: (el) => (inputEl = el) }, []);
}
```

---

## Context API

Contexts let ancestor components provide values to any descendant without prop-drilling.

---

### `createContext(defaultValue)`

Creates a context object. Pass `defaultValue` to use when no ancestor has called `setContext`.
Each `createContext(...)` call returns a unique token, so context values stay
isolated even when multiple contexts are active in the same subtree.

```js
const ThemeContext = createContext('light');
```

---

### `setContext(ctx, value)`

Sets a context value inside the **currently-constructing** component. All descendants will inherit this value.
Calling it outside component construction is a no-op.

```js
function ThemeProvider() {
  setContext(ThemeContext, 'dark');
  return createElement('div', {}, [createElement(ChildComponent, {})]);
}
```

---

### `getContext(ctx)`

Reads the nearest context value during component construction.

```js
function ThemedButton() {
  const theme = getContext(ThemeContext); // 'dark' or default 'light'

  return createElement('button', { className: `btn-${theme}` }, ['Click']);
}
```

---

### `useRef(onAssign?)`

Creates a signal-shaped ref object for use as `$ref`. Read the assigned element via `ref.get()` or `ref.current`, and access members directly on the ref itself (`ref.focus()`, `ref.value`) once an element has been assigned — property/method access is proxied through to the underlying element.

| Param | Type | Description |
|---|---|---|
| `onAssign` | `(element: HTMLElement \| null) => void` | Optional. Called whenever the ref element is assigned or cleared. |

```js
import { createElement, useRef } from '@esmj/dom';

function FocusInput() {
  const inputRef = useRef();

  return createElement('div', {}, [
    createElement('input', { $ref: inputRef }, []),
    createElement(
      'button',
      { onClick: () => inputRef.focus() }, // proxied to the input element
      ['Focus'],
    ),
  ]);
}
```

---

## Utilities

### `isSignalLike(value)`

Returns `true` if `value` is a signal-like object (has a `.get()` method and is not a DOM `Node`). Works with both `createSignal()` and `computed()` values from `@esmj/signals`.

```js
isSignalLike(createSignal(0));   // true
isSignalLike(computed(() => 1)); // true
isSignalLike(42);                // false
```

---

## Advanced

The following exports are primarily useful when building abstractions or framework extensions on top of `@esmj/dom`. Most application code won't need them.

### `getContextFromElement(ctx, element)`

Walks the DOM tree upward from `element` to find the nearest context value. Useful for accessing context outside of component construction (e.g. in event handlers that fire outside the component tree).

```js
button.addEventListener('click', (e) => {
  const theme = getContextFromElement(ThemeContext, e.target);
  console.log('Theme at click target:', theme);
});
```

### `normalizeProps(props)`

Converts a plain props object so every value becomes signal-like (used internally by the component system):
- Already signal-like → passed through.
- Plain function → wrapped in `computed()`.
- Primitive value → wrapped in `createSignal()`.
- `children` → always passed through as-is.
- Values wrapped with `keepLiteral()` → passed through raw (no wrapping).

```js
const normalized = normalizeProps({ label: 'Click me', count: signal });
normalized.label.get(); // 'Click me'
normalized.count.get(); // reactive value
```

### `keepLiteral(value)`

Marks a prop value to be passed through `normalizeProps` as-is, without being wrapped in a signal or computed. Useful when you intentionally want to pass a raw value — including a function — to a component without any reactive wrapping.

```js
function MyComponent({ onClick, label }) {
  // onClick is the original function, label is the string
  return createElement('button', { onClick }, label);
}

// Without keepLiteral: onClick would be wrapped in computed()
// With keepLiteral: onClick is passed through as the original function
createElement(MyComponent, {
  onClick: keepLiteral(handleClick),
  label: keepLiteral('Save'),
});
```

### `getNodeComponent(element)`

Returns the component instance associated with a DOM element, or `null` if none. Useful for inspecting the component tree from outside.

```js
const instance = getNodeComponent(someElement);
```

### `renderChild(parent, child)`

Appends a single child value of any supported type to a DOM `parent`. This is the shared primitive `createElement`, `If`, and `Each` all use to render children, exposed for authors building their own rendering helpers on top of `@esmj/dom`.

Supported `child` values: `null`/`undefined`/`boolean` (skipped), a DOM `Node`, a `string`/`number` (text node), a reactive `() => value` function, a signal-like value, a component instance, or an array of any of the above (rendered recursively).

| Param | Type | Description |
|---|---|---|
| `parent` | `Element` | The DOM node to append `child` to. |
| `child` | `Node \| ComponentInstance \| string \| number \| Function \| Signal \| Array \| null \| boolean` | The value to render. |

```js
const parent = document.createElement('div');

renderChild(parent, 'plain text');
renderChild(parent, () => count.get()); // reactive text node
renderChild(parent, createElement('span', {}, ['child element']));
```

### `withContext(ctx, fn)`

Runs `fn` with `ctx` set as the active internal component context, restoring the previous context afterward (even if `fn` throws). Used internally to keep context-dependent lifecycle hooks and reactive callbacks (e.g. inside `effect()`) associated with the right component across re-renders; exposed for framework extension authors who need the same behavior.

| Param | Type | Description |
|---|---|---|
| `ctx` | `*` | The internal component context to activate for the duration of `fn`. |
| `fn` | `() => *` | The function to run with `ctx` active. |

```js
import { withContext } from '@esmj/dom';

function useDeferredContext(ctx) {
  // capture the context active during this call...
  return (fn) => withContext(ctx, fn); // ...and reactivate it later, e.g. in an async callback or effect
}
```

### `deepEqual(a, b)`

Deep equality via `JSON.stringify`. Used internally by `Each` to skip re-renders when an item's content hasn't changed.

```js
deepEqual({ x: 1 }, { x: 1 }); // true
deepEqual({ x: 1 }, { x: 2 }); // false
```

---

## Examples

### Counter with conditional rendering

```js
import { createSignal } from '@esmj/signals';
import { createElement, If, mount, onMount } from '@esmj/dom';

function EvenBadge() {
  onMount(() => console.log('EvenBadge mounted'));
  return createElement('span', { style: { color: 'green' } }, ['Even!']);
}

function Counter() {
  const count = createSignal(0);

  return createElement('div', {}, [
    createElement(
      'button',
      { onClick: () => count.set(count.get() + 1) },
      [() => `Count: ${count.get()}`],
    ),
    If(
      () => count.get() % 2 === 0,
      createElement(EvenBadge, {}),
    ),
  ]);
}

mount('#app', createElement(Counter, {}));
```

---

### Reactive list with Each

```js
import { createSignal } from '@esmj/signals';
import { createElement, Each, mount } from '@esmj/dom';

function TodoApp() {
  const items = createSignal([
    { id: 1, text: 'Buy milk' },
    { id: 2, text: 'Walk the dog' },
  ]);

  function addItem() {
    const text = prompt('New todo:');
    if (text) {
      items.set([...items.get(), { id: Date.now(), text }]);
    }
  }

  function removeItem(id) {
    items.set(items.get().filter((i) => i.id !== id));
  }

  return createElement('div', {}, [
    createElement('button', { onClick: addItem }, ['Add todo']),
    createElement('ul', {}, [
      Each(
        () => items.get(),
        (item) => item.id,
        (item) =>
          createElement('li', {}, [
            () => item.get().text,
            createElement(
              'button',
              { onClick: () => removeItem(item.get().id) },
              [' x'],
            ),
          ]),
      ),
    ]),
  ]);
}

mount('#app', createElement(TodoApp, {}));
```

---

### Class-based component

```js
import { Component, createElement, mount } from '@esmj/dom';

class Card extends Component {
  onMount() {
    console.log('Card mounted:', this.props.title.get());
  }

  onUnmount() {
    console.log('Card unmounted');
  }

  render() {
    return createElement('div', { className: 'card' }, [
      createElement('h2', {}, [this.props.title]),
      ...this.props.children,
    ]);
  }
}

mount(
  '#app',
  createElement(Card, { title: 'Hello' }, [
    createElement('p', {}, ['Card body text']),
  ]),
);
```

---

### Context API usage

```js
import { createSignal } from '@esmj/signals';
import {
  createElement,
  mount,
  createContext,
  setContext,
  getContext,
} from '@esmj/dom';

const UserContext = createContext(null);

function UserAvatar() {
  const user = getContext(UserContext);
  return createElement('img', { src: () => user.get().avatarUrl, alt: 'avatar' }, []);
}

function App() {
  const user = createSignal({ name: 'Alice', avatarUrl: '/alice.png' });

  setContext(UserContext, user);

  return createElement('div', {}, [
    createElement('h1', {}, [() => `Hello, ${user.get().name}`]),
    createElement(UserAvatar, {}),
  ]);
}

mount('#app', createElement(App, {}));
```

---

## License


[MIT](LICENSE)
