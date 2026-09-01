// ---------------------------------------------------------------------------
// createElement.mjs — DOM element creation with reactive props
//
// Imports: component.mjs, lifecycle.mjs, @esmj/signals, easy-uid
// Exports (public): createElement, renderChild, isSignalLike, Fragment
// Exports (internal): clearContainer, resolveRenderedNodes, removeRenderedNodes
// ---------------------------------------------------------------------------

import { effect } from '@esmj/signals';

import {
  createComponentInstance,
  isComponentInstance,
  mountComponentInstance,
} from './componentInstance.mjs';
import { cleanupTree, runMountHooks } from './lifecycle.mjs';
import { addDisposer, getInternalContext, withContext } from './runtime.mjs';

// ---------------------------------------------------------------------------
// Prop name aliases
// ---------------------------------------------------------------------------
const PROP_ALIASES = {
  className: 'class',
  htmlFor: 'for',
};

// Props that must be set as DOM properties, not HTML attributes.
// setAttribute('value', x) only sets the default — it never updates the live
// displayed value once the user has interacted. Same applies to checked etc.
const DOM_PROPERTIES = new Set([
  'value',
  'defaultValue',
  'checked',
  'selected',
  'indeterminate',
]);

const BLOCKED_ATTRIBUTE_NAMES = new Set(['srcdoc']);
const URL_LIKE_ATTRIBUTES = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'xlink:href',
]);
const BLOCKED_EVENT_NAMES = new Set(['securitypolicyviolation']);

// Attributes where explicit false/true must be preserved as text tokens
// rather than removed as generic falsy values.
const ENUMERATED_BOOLEAN_ATTRIBUTES = new Set([
  'contenteditable',
  'draggable',
  'spellcheck',
]);

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Returns true for signal-like objects (have a .get() method) that are not
 * DOM Nodes. Matches both createSignal() values and computed() values from
 * @esmj/signals.
 */
export function isSignalLike(value) {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof value.get === 'function' &&
    !(value instanceof Node)
  );
}

// ---------------------------------------------------------------------------
// createElement
// ---------------------------------------------------------------------------

/**
 * Marker used to group children without introducing a wrapping DOM element —
 * mirrors JSX's `<>...</>` fragment syntax. Passing `Fragment` as the
 * `nodeName` to `createElement` produces a `DocumentFragment` populated with
 * the (normalized) children instead of a regular element.
 *
 * Note: a `Fragment` returned as the *sole* root value from a function/class
 * component's `render()` is not fully supported yet — `appendChild` empties a
 * DocumentFragment into its parent, so the component-level lifecycle
 * bookkeeping (onMount/onUnmount/effect disposal) attached to that fragment
 * would never run. Using `Fragment` to group children passed *into* an
 * element or `mount()` works correctly.
 */
export const Fragment = Symbol('Fragment');

/**
 * Create a DOM element (or a lazy component descriptor).
 *
 * Overloads:
 *   createElement(tagName, props, children)
 *   createElement(Component, props, children)   — function component
 *   createElement(Fragment, props, children)    — grouped children, no wrapper element
 *   createElement(props, children)              — shorthand, defaults to <div>
 */
export function createElement(nodeName, props, children) {
  // Fragment → group children into a DocumentFragment, no wrapper element
  if (nodeName === Fragment) {
    const fragment = document.createDocumentFragment();
    appendChildren(fragment, normalizeChildren(children));
    return fragment;
  }

  // Function component → return a lazy descriptor, not a DOM node yet
  if (typeof nodeName === 'function') {
    return createComponentInstance(nodeName, props || {}, children);
  }

  // Shorthand: first arg is props object
  if (typeof nodeName !== 'string') {
    children = props;
    props = nodeName;
    nodeName = 'div';
  }

  props = props || {};
  const element = document.createElement(nodeName);

  // Bug fix: only set id when explicitly provided — never auto-generate one
  if (props.id) {
    element.setAttribute('id', props.id);
  }

  applyProps(element, props);
  appendChildren(element, normalizeChildren(children));

  return element;
}

// ---------------------------------------------------------------------------
// applyProps — set attributes, events, refs, and reactive bindings
// ---------------------------------------------------------------------------

/**
 * Set inner content from a string (via innerHTML) or a DocumentFragment
 * (via replaceChildren, which clears existing nodes before inserting).
 */
function applyInnerContent(element, value) {
  if (value instanceof DocumentFragment) {
    element.replaceChildren(value);
  } else {
    element.innerHTML = value ?? '';
  }
}

function isUnsafeUrlValue(value) {
  if (typeof value !== 'string') return false;
  const normalized = value
    // Strip Unicode whitespace plus control characters used in obfuscated schemes.
    .replace(/[\p{White_Space}\p{Cc}]+/gu, '')
    .toLowerCase();
  return normalized.startsWith('javascript:');
}

function isBlockedAttribute(key, value) {
  if (typeof key !== 'string') return false;
  const normalizedKey = key.toLowerCase();
  if (BLOCKED_ATTRIBUTE_NAMES.has(normalizedKey)) return true;
  return (
    URL_LIKE_ATTRIBUTES.has(normalizedKey) &&
    value !== null &&
    value !== undefined &&
    isUnsafeUrlValue(String(value))
  );
}

function normalizeAttributeKey(key) {
  if (typeof key !== 'string') return key;

  if (PROP_ALIASES[key]) {
    return PROP_ALIASES[key];
  }

  return key;
}

function normalizeAttributeValue(key, value) {
  const normalizedKey = normalizeAttributeKey(key);
  const normalizedKeyName =
    typeof normalizedKey === 'string'
      ? normalizedKey.toLowerCase()
      : String(normalizedKey).toLowerCase();

  if (
    ENUMERATED_BOOLEAN_ATTRIBUTES.has(normalizedKeyName) &&
    (value === true || value === false || value === 'true' || value === 'false')
  ) {
    return String(value);
  }

  if (value === null || value === undefined || value === false) {
    return null;
  }

  return value;
}

function setSafeAttribute(element, key, value) {
  const normalizedValue = normalizeAttributeValue(key, value);

  if (normalizedValue === null) {
    element.removeAttribute(key);
    return;
  }

  if (isBlockedAttribute(key, normalizedValue)) {
    element.removeAttribute(key);
    console.warn(
      `[esmj-dom] Blocked unsafe attribute "${String(key)}" on <${element.tagName.toLowerCase()}>`,
    );
    return;
  }

  element.setAttribute(key, normalizedValue);
}

/**
 * Set attributes, events, refs, and reactive bindings on `element` from a
 * props object. Exported (in addition to being used by `createElement`
 * itself) so control-flow components (`For`, `If`) can apply arbitrary
 * pass-through props (`class`, `$ref`, `style`, `onClick`, `data-*`, etc.) to
 * their reconciliation wrapper element exactly like a regular DOM element.
 *
 * Skips `id` — callers that want to support an `id` prop must set it via
 * `element.setAttribute('id', props.id)` themselves first, same as
 * `createElement` does.
 */
export function applyProps(element, props) {
  const capturedContext = getInternalContext();

  for (let [key, value] of Reflect.ownKeys(props).map((k) => [k, props[k]])) {
    if (key === 'id') continue; // already handled above

    // Prop key normalization (aliases + lowercase attribute names)
    key = normalizeAttributeKey(key);

    // $ref — callback ref or object ref
    if (key === '$ref') {
      if (typeof value === 'function') {
        value(element);
      } else if (typeof value === 'object' && value !== null) {
        value.current = element;
      }
      continue;
    }

    // $dangerouslySetInnerHTML — supports static value, function, signal,
    // or DocumentFragment (including as the return value of a signal/function)
    if (key === '$dangerouslySetInnerHTML') {
      if (isSignalLike(value)) {
        const dispose = effect(() => {
          withContext(capturedContext, () => {
            applyInnerContent(element, value.get());
          });
        });
        addDisposer(element, dispose);
      } else if (typeof value === 'function') {
        const dispose = effect(() => {
          withContext(capturedContext, () => {
            applyInnerContent(element, value());
          });
        });
        addDisposer(element, dispose);
      } else {
        applyInnerContent(element, value);
      }
      continue;
    }

    // style — supports object, signal-of-object, or plain string
    if (key === 'style') {
      if (isSignalLike(value)) {
        const dispose = effect(() => {
          withContext(capturedContext, () => {
            Object.assign(element.style, value.get());
          });
        });
        addDisposer(element, dispose);
      } else if (typeof value === 'object' && value !== null) {
        Object.assign(element.style, value);
      } else {
        element.setAttribute('style', value);
      }
      continue;
    }

    // Events: onClick, onInput, onKeyDown, …
    if (
      typeof key === 'string' &&
      key.startsWith('on') &&
      typeof value === 'function'
    ) {
      const eventName = key.slice(2).toLowerCase();
      if (BLOCKED_EVENT_NAMES.has(eventName)) {
        console.warn(
          `[esmj-dom] Blocked unsafe event binding "${key}" on <${element.tagName.toLowerCase()}>`,
        );
        continue;
      }
      element.addEventListener(eventName, value);
      continue;
    }

    // Reactive attribute bound to a signal / computed
    if (isSignalLike(value) || typeof value === 'function') {
      const attrKey = key;
      const dispose = effect(() => {
        withContext(capturedContext, () => {
          const v = typeof value === 'function' ? value() : value.get();
          if (DOM_PROPERTIES.has(attrKey)) {
            // Set as DOM property so live form values (value, checked, …) update
            element[attrKey] = v ?? '';
          } else {
            setSafeAttribute(element, attrKey, v);
          }
        });
      });

      addDisposer(element, dispose);
      continue;
    }

    // Static attribute
    if (DOM_PROPERTIES.has(key) || typeof key === 'symbol') {
      element[key] = value ?? '';
    } else {
      setSafeAttribute(element, key, value);
    }
  }
}

// ---------------------------------------------------------------------------
// Children helpers
// ---------------------------------------------------------------------------

function normalizeChildren(children) {
  if (children == null) return [];
  if (!Array.isArray(children)) return [children];
  return children.flat(Number.POSITIVE_INFINITY);
}

function appendChildren(parent, children) {
  for (const child of children) {
    renderChild(parent, child);
  }
}

// ---------------------------------------------------------------------------
// renderChild — unified child rendering
//
// Replaces the split between appendSingleChild (used by createElement) and
// renderInto (used by If/For). The old renderInto was missing null/bool
// guards, signal-like support, and array support.
// ---------------------------------------------------------------------------

/**
 * Append a single child value (of any supported type) to a parent node.
 * Safe to call from createElement, If, For, or mount.
 */
export function renderChild(parent, child) {
  if (child == null || child === false || child === true) {
    return;
  }

  if (child instanceof Node) {
    parent.appendChild(child);
    return;
  }

  if (typeof child === 'string' || typeof child === 'number') {
    parent.appendChild(document.createTextNode(String(child)));
    return;
  }

  // Reactive function → auto-updating text or element node
  if (typeof child === 'function') {
    createReactiveNode(parent, child);
    return;
  }

  if (isComponentInstance(child)) {
    mountComponentInstance(parent, child);
    return;
  }

  if (isSignalLike(child)) {
    createReactiveNode(parent, () => child.get());
    return;
  }

  if (Array.isArray(child)) {
    appendChildren(parent, child);
    return;
  }

  // Fallback: coerce to string
  parent.appendChild(document.createTextNode(String(child)));
}

// ---------------------------------------------------------------------------
// Rendered-node lifecycle helpers — shared by the reactive node slot below,
// If(), and For(). All three primitives need to:
//   1. Turn an arbitrary "child value" (Node, Fragment, component instance
//      descriptor, primitive, null/boolean) into the actual live DOM node(s)
//      to insert.
//   2. Later tear down + detach whatever was inserted.
//
// A `Fragment` (DocumentFragment) is expanded into an array of its (still
// live) children *before* it is inserted anywhere — inserting a
// DocumentFragment empties it, so there would be nothing left on the
// fragment object itself to track for later cleanup/removal.
// ---------------------------------------------------------------------------

/**
 * Normalize a renderable value into `{ nodes, instance }`:
 * - `nodes` — the live DOM node(s) to insert, in order (empty array for
 *   null/boolean/empty-Fragment values).
 * - `instance` — the component instance descriptor that produced `nodes`
 *   (if `value` was one), so the caller can queue its mount hooks.
 *
 * Component instances are constructed here (via `$constructor()`); if a
 * component's render result is itself a Fragment, its bookkeeping has
 * already been attached to each of the fragment's children individually by
 * `createComponentInstance` — see componentInstance.mjs.
 */
export function resolveRenderedNodes(value) {
  let instance = null;
  let resolved = value;

  if (isComponentInstance(value)) {
    instance = value;
    resolved = value.$constructor();
  }

  if (resolved instanceof DocumentFragment) {
    return { nodes: Array.from(resolved.childNodes), instance };
  }

  if (resolved instanceof Node) {
    return { nodes: [resolved], instance };
  }

  if (resolved == null || resolved === false || resolved === true) {
    return { nodes: [], instance };
  }

  return { nodes: [document.createTextNode(String(resolved))], instance };
}

/**
 * Tear down and detach DOM nodes previously produced by
 * `resolveRenderedNodes`.
 *
 * @param {Node[]} nodes
 * @param {boolean} [owned=true]  When true (the default), each node's
 *   subtree is fully disposed via `cleanupTree` (signal effects + onUnmount
 *   hooks) before removal. Pass `false` for "borrowed" pre-built nodes whose
 *   disposers must survive across toggles (see If.mjs).
 */
export function removeRenderedNodes(nodes, owned = true) {
  for (const node of nodes) {
    if (owned) {
      cleanupTree(node);
    }
    node.remove();
  }
}

// ---------------------------------------------------------------------------
// Reactive node slot — handles both DOM Node values and primitives.
//
// A comment node acts as a stable anchor. On each signal/function emission:
//   - If the new value is a DOM Node it is inserted after the anchor.
//   - If the new value is a Fragment its children are inserted after the
//     anchor as a group.
//   - If the new value is a ComponentInstance descriptor (returned by
//     `createElement(MyComponent, props)`) it is constructed and mounted.
//   - Otherwise a Text node is created for the stringified value.
//   - The previous content node(s) are cleaned up and removed before
//     inserting the next one(s), so only the latest emission's nodes ever
//     sit after the anchor.
//
// Security note: DOM Node values are inserted as-is, including any event
// listeners already attached to the node. Never pass a reactive slot that
// can accept attacker-controlled Node objects — only use developer-created
// elements as signal values.
// ---------------------------------------------------------------------------

function createReactiveNode(parent, fn) {
  const capturedContext = getInternalContext();
  const anchor = document.createComment('');
  parent.appendChild(anchor);
  let currentNodes = [];

  const dispose = effect(() => {
    withContext(capturedContext, () => {
      const value = fn();
      const { nodes: newNodes, instance } = resolveRenderedNodes(value);

      removeRenderedNodes(currentNodes);

      if (newNodes.length) {
        anchor.after(...newNodes);
      }

      if (instance) {
        queueMicrotask(() => runMountHooks(instance));
      }

      currentNodes = newNodes;
    });
  });

  addDisposer(parent, dispose);
}

// ---------------------------------------------------------------------------
// clearContainer — remove all children and fully clean up their subtrees
// ---------------------------------------------------------------------------

export function clearContainer(container) {
  for (const child of Array.from(container.childNodes)) {
    cleanupTree(child);
    child.remove();
  }
}
