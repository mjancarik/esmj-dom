import { computed, createSignal } from '@esmj/signals';
import uid from 'easy-uid';

// ---------------------------------------------------------------------------
// runtime.mjs — shared symbols, registries, and component context
// ---------------------------------------------------------------------------

export const NODE_COMPONENT = Symbol('node-component');
export const NODE_INTERNAL = Symbol('node-internal');
const KEEP_LITERAL = Symbol('keep-literal');

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
 * @returns {Record<string, { get(): * }>}  Normalized props with signal-like
 *   values.
 */
export function normalizeProps(props) {
  const result = Object.create(null);
  for (const key of Object.keys(props)) {
    const value = props[key];
    if (key === 'children') {
      result[key] = value; // children always passed through raw
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
 * Used as the `equals` option for item signals in `Each` to avoid
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
