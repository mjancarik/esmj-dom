import { computed, createSignal } from '@esmj/signals';
import uid from 'easy-uid';

// ---------------------------------------------------------------------------
// runtime.mjs — shared symbols, registries, and component context
// ---------------------------------------------------------------------------

export const NODE_COMPONENT = Symbol('node-component');
export const NODE_INTERNAL = Symbol('node-internal');
const KEEP_LITERAL = Symbol('keep-literal');

/**
 * Marker symbol for declaring which props of a function component must
 * bypass `normalizeProps`'s signal/computed wrapping (see
 * `componentInstance.mjs`). A component function tagged with
 * `fn[RAW_PROPS] = ['keyA', 'keyB']` receives those specific prop values
 * exactly as passed — no wrapping — while every other prop still goes
 * through the normal per-key normalization (functions → `computed()`,
 * plain values → `createSignal()`, already-signal-like values passed
 * through). This only affects prop *normalization* — the calling
 * convention is the same `fn(props)` used by every function component,
 * with `children` always merged in as `props.children` (never wrapped,
 * same as any other component).
 *
 * `fn[RAW_PROPS]` may also be a predicate function `(key) => boolean`
 * instead of an array — used when the set of raw keys can't be enumerated
 * ahead of time (e.g. `For`/`If` forward arbitrary wrapper DOM props like
 * `class`/`$ref`/`style`/`onClick` to their container element, and those
 * must reach `applyProps` unwrapped, exactly like a regular element's
 * props, for signal/function values to be handled correctly).
 *
 * This is used internally by control-flow-style components (`For`, `If`) whose
 * props include plain multi-argument callback functions (e.g. a `keyFn`
 * `(item, index) => id`) or literal values used
 * directly (e.g. a `tagName` string, a `fallback` Node) that must NOT be
 * wrapped — `normalizeProps` assumes function props are zero-arg reactive
 * accessors and plain values should become signals, which would break
 * these props. Reactive props (e.g. `each`/`when`) are deliberately left
 * OFF each component's raw-key list (or excluded from the predicate) so
 * they keep getting normalized like any other prop.
 *
 * Not exported from `index.mjs` — an internal mechanism, not (yet) a
 * public API for arbitrary user components.
 *
 * @example
 * For[RAW_PROPS] = ['keyFn', 'equals', 'tagName']; // 'each' stays normalized
 * If[RAW_PROPS] = (key) => key !== 'when'; // everything except 'when' stays raw
 */
export const RAW_PROPS = Symbol('raw-props');

/**
 * Coerce a value into a zero-arg accessor function, for props that may be
 * passed as a plain function (accessor), a signal-like object (has `.get()`),
 * or a static value (evaluated once, non-reactive).
 *
 * Used by raw-props control-flow components (`For`, `If`, `Toggle`) to
 * normalize their `each`/`when` props without going through `normalizeProps`.
 *
 * @param {*} value
 * @returns {() => *}
 */
export function toAccessor(value) {
  if (typeof value === 'function') {
    return value;
  }
  if (value != null && typeof value.get === 'function') {
    return () => value.get();
  }
  return () => value;
}

/**
 * Resolve the single child value a RAW_PROPS control-flow component
 * (`For`, `If`, `Toggle`) should use, from its dual-mode dispatcher.
 *
 * componentInstance.mjs always merges `children` into `props.children`, so
 * that's the primary source. The `fallbackChildren` argument covers direct
 * calls that bypass componentInstance entirely (e.g. `Toggle({ when }, el)`
 * in tests), where `props.children` is absent and the caller passed
 * children as a separate positional argument instead — mirroring each
 * component's low-level positional shape.
 *
 * JSX (both the automatic and classic transforms) may pass a single child
 * either as a bare value or as a 1-element array, depending on the
 * transform/compiler used — either shape is unwrapped to the bare value.
 *
 * @param {Record<string, *>} props  The component's props object.
 * @param {*} [fallbackChildren]  Children passed as a separate positional
 *   argument, used only when `props.children` is `undefined`.
 * @returns {*}  The resolved single child (unwrapped from a 1-element array).
 */
export function resolveChild(props, fallbackChildren) {
  const children =
    props.children !== undefined ? props.children : fallbackChildren;
  return Array.isArray(children) ? children[0] : children;
}

/**
 * Mark a value to be passed through `normalizeProps` as-is, without being
 * wrapped in a signal or computed.
 *
 * By default, `normalizeProps` wraps plain values in `createSignal` and
 * functions in `computed`. Use `keepLiteral` when you intentionally want to
 * pass a raw value — including a function — without any reactive wrapping.
 *
 * @param {*} value  The value to pass through literally.
 * @returns {() => *}  A tagged wrapper function recognized by `normalizeProps`.
 *
 * @example
 * // Without keepLiteral: onClick would be wrapped in computed()
 * normalizeProps({ onClick: handleClick });
 *
 * // With keepLiteral: onClick is passed through as the original function
 * normalizeProps({ onClick: keepLiteral(handleClick) });
 */
export function keepLiteral(value) {
  const keepValue = () => {
    return value;
  };

  keepValue[KEEP_LITERAL] = true;
  return keepValue;
}

// Tags that cannot render children in normal flow: <template>'s children
// live in `.content` (a separate DocumentFragment), not the light DOM, and
// <script> never renders children as DOM. Neither can act as a transparent
// reconciliation wrapper for For/If.
const UNSUPPORTED_WRAPPER_TAGS = new Set(['template', 'script']);

/**
 * Create the reconciliation wrapper shared by `For` and `If`. Defaults to
 * `<span>`; pass `tagName` to use a different element when the default
 * wrapper would violate the parent's content model (e.g. a `<table>`/
 * `<select>` that only accepts specific child tags).
 *
 * `display:contents` is only applied to the default/fallback `<span>` — a
 * generic element with no content-model role of its own, so it must be
 * hidden from layout to stay "transparent". An explicitly chosen `tagName`
 * (e.g. `'tbody'`, `'li'`) is assumed to already be a semantically valid
 * element for its context and is left with its normal `display`; forcing
 * `display:contents` on it would strip away behavior the caller presumably
 * wants (e.g. `<li>`'s marker, `<tbody>`'s row-group box).
 *
 * Note: no tag is valid as a transparent wrapper inside `<ul>`/`<ol>`/
 * `<select>` — those elements only accept their specific item tag
 * (`<li>`/`<option>`) as direct children. This option does not solve that
 * case; see the README's "Known limitation" note.
 *
 * @param {string} tagName  Element tag to create (defaults to `'span'` by
 *   the caller, not here).
 * @param {string} dataAttrName  Attribute name used to mark the wrapper for
 *   debugging (e.g. `'data-for'`, `'data-if'`); value is a random uid.
 * @returns {HTMLElement}
 */
export function createReconciliationContainer(tagName, dataAttrName) {
  const normalizedTagName = (tagName == null ? 'span' : String(tagName)).trim();
  let resolvedTagName = normalizedTagName;

  if (UNSUPPORTED_WRAPPER_TAGS.has(normalizedTagName.toLowerCase())) {
    console.warn(
      `[esmj-dom] tagName "${tagName}" cannot render children in normal flow and is not supported as a reconciliation wrapper; falling back to "span".`,
    );
    resolvedTagName = 'span';
  }

  const container = document.createElement(resolvedTagName);
  if (resolvedTagName === 'span') {
    container.style.display = 'contents';
  }

  container.setAttribute(dataAttrName, uid());
  return container;
}

/**
 * Create the reconciliation wrapper for a control-flow component (`For`,
 * `If`) AND apply its `id` (if present) — the two steps that always precede
 * an `applyProps(container, containerProps)` call in both `ForImpl` and
 * `IfImpl`. Kept separate from `applyProps` itself (not called here) to
 * avoid a circular import between `runtime.mjs` and `createElement.mjs`;
 * callers must still call `applyProps(container, containerProps)`
 * themselves right after this returns.
 *
 * @param {string} tagName  Same as `createReconciliationContainer`.
 * @param {string} dataAttrName  Same as `createReconciliationContainer`.
 * @param {Record<string, *>} containerProps  Remaining pass-through props;
 *   only `id` is consulted here (applied via `setAttribute`, matching
 *   `applyProps`'s convention of skipping `id` so callers control it).
 * @returns {HTMLElement}
 */
export function createControlFlowContainer(
  tagName,
  dataAttrName,
  containerProps,
) {
  const container = createReconciliationContainer(tagName, dataAttrName);
  if (containerProps?.id) container.setAttribute('id', containerProps.id);
  return container;
}

/**
 * Create a signal-shaped ref object.
 *
 * Use the object directly as `$ref` (it has `.current`), or pass `ref.set`
 * as callback form. Read the node via `ref.get()`, or access members directly
 * on the ref (`ref.focus()`, `ref.value`) once assigned.
 *
 * @param {(element: HTMLElement | null) => void} [onAssign]
 * Optional callback invoked whenever the ref element is assigned.
 *
 * @returns {{
 *   get: () => (HTMLElement | null),
 *   set: (element: HTMLElement | null) => (HTMLElement | null),
 *   current: HTMLElement | null,
 *   [Symbol.toPrimitive]: (hint: string) => string | number
 * }}
 */
export function useRef(onAssign) {
  let current = null;

  const get = () => {
    return current;
  };

  const set = (element) => {
    current = element ?? null;
    if (typeof onAssign === 'function') {
      onAssign(current);
    }
    return current;
  };

  const ref = {
    get,
    set,
    [Symbol.toPrimitive]() {
      return current ? String(current) : '';
    },
  };

  Object.defineProperty(ref, 'current', {
    get() {
      return current;
    },
    set(value) {
      set(value);
    },
    enumerable: true,
    configurable: false,
  });

  return new Proxy(ref, {
    get(target, prop, receiver) {
      if (Reflect.has(target, prop)) {
        return Reflect.get(target, prop, receiver);
      }

      if (!current) {
        return undefined;
      }

      const value = current[prop];
      if (typeof value === 'function') {
        return value.bind(current);
      }

      return value;
    },

    set(target, prop, value, receiver) {
      if (Reflect.has(target, prop) || !current) {
        return Reflect.set(target, prop, value, receiver);
      }

      current[prop] = value;
      return true;
    },

    has(target, prop) {
      return Reflect.has(target, prop) || (!!current && prop in current);
    },
  });
}

// Current component context set during a component's constructor execution.
// Used by onMount / onUnmount / onEffect to associate hooks with the
// component being constructed.
let _currentComponentContext = null;

export function getInternalContext() {
  return _currentComponentContext;
}

export function setInternalContext(ctx) {
  _currentComponentContext = ctx;
}

/**
 * Retrieve the component instance stored on a DOM element, or `null` if the
 * element is not a component root.
 *
 * @param {Node} element  The DOM element to inspect.
 * @returns {*}  The component instance, or `null`.
 */
export function getNodeComponent(element) {
  return element?.[NODE_COMPONENT] || null;
}

export function setNodeComponent(element, instance) {
  element[NODE_COMPONENT] = instance;
}

export function initNodeInternal(
  element,
  internal = { disposers: [], id: uid() },
) {
  if (element?.[NODE_INTERNAL]) {
    return element[NODE_INTERNAL];
  }

  if (!element) {
    return internal;
  }

  element[NODE_INTERNAL] = internal;
  return internal;
}

export function getNodeInternal(element) {
  return element[NODE_INTERNAL];
}

export function addDisposer(element, disposer) {
  let internal = getNodeInternal(element);

  if (!internal) {
    internal = initNodeInternal(element);
  }

  internal.disposers.push(disposer);
}

// ---------------------------------------------------------------------------
// Registry helpers
// ---------------------------------------------------------------------------

/**
 * Push `item` into a registry Map keyed by `id`, creating the entry if needed.
 * Replaces the recurring "init Map if absent, then push" pattern.
 *
 * @param {Map<string, *[]>} registry
 * @param {string} id
 * @param {*} item
 */
export function addToRegistry(registry, id, item) {
  if (!registry.has(id)) registry.set(id, []);
  registry.get(id).push(item);
}

/**
 * Run `fn` with `ctx` as the active internal context, restoring the previous
 * context in a finally-block.
 *
 * @param {*} ctx
 * @param {() => *} fn
 * @returns {*} The return value of fn.
 */
export function withContext(ctx, fn) {
  const prev = getInternalContext();
  setInternalContext(ctx);
  try {
    return fn();
  } finally {
    setInternalContext(prev);
  }
}

// ---------------------------------------------------------------------------

// Lifecycle registries keyed by componentId (string from easy-uid).
export const mountHooksRegistry = new Map();
export const unmountHooksRegistry = new Map();
export const disposersRegistry = new Map();

// ---------------------------------------------------------------------------
// Props normalization — wraps plain values/functions in signals/computeds
// ---------------------------------------------------------------------------

/**
 * Normalize a props object so every value is signal-like:
 * - `children` is passed through as-is.
 * - Values that already have a `.get()` method are passed through unchanged.
 * - Function values are wrapped in `computed(value)`.
 * - All other plain values are wrapped in `createSignal(value)`.
 *
 * This allows component implementations to always call `.get()` on any prop
 * without special-casing static vs. reactive values.
 *
 * @param {Record<string, *>} props  Raw props to normalize.
 * @param {string[]|((key: string) => boolean)} [rawKeys]  Prop keys to pass
 *   through completely untouched (no signal/computed wrapping), in addition
 *   to `children`. Either an array of exact keys, or a predicate function
 *   called with each key — useful when the raw keys can't be enumerated
 *   ahead of time (e.g. arbitrary wrapper DOM props). See `RAW_PROPS`.
 * @returns {Record<string, { get(): * }>}  Normalized props with signal-like
 *   values (except `children` and any `rawKeys` entries, which stay literal).
 */
export function normalizeProps(props, rawKeys) {
  const isRaw =
    typeof rawKeys === 'function' ? rawKeys : (key) => !!rawKeys?.includes(key);

  const result = Object.create(null);
  for (const key of Object.keys(props)) {
    const value = props[key];
    if (key === 'children' || isRaw(key)) {
      result[key] = value; // children, or an explicitly-declared raw prop
    } else if (value?.[KEEP_LITERAL]) {
      result[key] = value(); // keepLiteral-wrapped value, call the wrapper to get the literal
    } else if (value != null && typeof value.get === 'function') {
      result[key] = value; // already signal-like, pass through
    } else if (typeof value === 'function') {
      result[key] = computed(value); // function → computed
    } else {
      result[key] = createSignal(value); // plain value → signal
    }
  }
  return result;
}

/**
 * Structural equality check using JSON serialization.
 *
 * Returns `true` if `a` and `b` are strictly equal (`===`) or serialize to
 * the same JSON string. Falls back to `false` for values that cannot be
 * serialized (e.g. circular references).
 *
 * Used as the `equals` option for item signals in `For` to avoid
 * unnecessary re-renders when an item's data hasn't actually changed.
 *
 * @param {*} a  First value.
 * @param {*} b  Second value.
 * @returns {boolean}
 */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => {
    const descriptorA = Object.getOwnPropertyDescriptor(a, k);
    const descriptorB = Object.getOwnPropertyDescriptor(b, k);
    if (!descriptorA || !descriptorB) return false;

    const valueA =
      'value' in descriptorA ? descriptorA.value : descriptorA.get?.call(a);
    const valueB =
      'value' in descriptorB ? descriptorB.value : descriptorB.get?.call(b);
    return deepEqual(valueA, valueB);
  });
}

// ---------------------------------------------------------------------------
// Context API — values are stored on templateInternal.contexts (a Map)
// and inherited by child components via shallow copy at construction time.
// ---------------------------------------------------------------------------

/**
 * Create a context token that can be used to pass values implicitly through
 * the component tree without explicit prop drilling.
 *
 * Pass the returned token to `setContext` (in a parent component) and
 * `getContext` / `getContextFromElement` (in a descendant) to read the value.
 *
 * @template T
 * @param {T} defaultValue  Value returned by `getContext` when no ancestor has
 *   called `setContext` for this token.
 * @returns {{ id: symbol, defaultValue: T }}  An opaque context descriptor.
 */
export function createContext(defaultValue) {
  return { id: Symbol('context-id'), defaultValue };
}

/**
 * Store a context value on the currently-constructing component.
 *
 * Must be called during a component's render/constructor phase (i.e. while the
 * component context is active). Descendant components can then retrieve the
 * value via `getContext` or `getContextFromElement`.
 *
 * @template T
 * @param {{ id: symbol, defaultValue: T }} ctx  Context token created by
 *   `createContext`.
 * @param {T} value  The value to associate with this context in the current
 *   component subtree.
 */
export function setContext(ctx, value) {
  const internal = getInternalContext();
  if (internal) {
    internal.contexts.set(ctx.id, value);
  }
}

/**
 * Retrieve a context value from the current component's inherited context.
 *
 * Must be called during a component's render/constructor phase. Returns the
 * value set by the nearest ancestor that called `setContext` with this token,
 * or `ctx.defaultValue` if no ancestor has set it.
 *
 * @template T
 * @param {{ id: symbol, defaultValue: T }} ctx  Context token created by
 *   `createContext`.
 * @returns {T}
 */
export function getContext(ctx) {
  const internal = getInternalContext();
  if (internal?.contexts?.has(ctx.id)) {
    return internal.contexts.get(ctx.id);
  }
  return ctx.defaultValue;
}

/**
 * Walk up the DOM tree from `element` and return the context value set by the
 * nearest ancestor component, or `ctx.defaultValue` if none is found.
 *
 * Unlike `getContext`, this can be called **outside** of a component's
 * constructor — for example inside an event handler or effect — because it
 * resolves context by inspecting the live DOM rather than the construction-time
 * context stack.
 *
 * @template T
 * @param {{ id: symbol, defaultValue: T }} ctx  Context token created by
 *   `createContext`.
 * @param {Node} element  The DOM node to start the upward search from.
 * @returns {T}
 */
export function getContextFromElement(ctx, element) {
  let node = element;
  while (node) {
    const internal = node[NODE_INTERNAL];
    if (internal?.contexts?.has(ctx.id)) {
      return internal.contexts.get(ctx.id);
    }
    node = node.parentElement;
  }
  return ctx.defaultValue;
}
