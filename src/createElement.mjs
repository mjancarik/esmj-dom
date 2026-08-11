// ---------------------------------------------------------------------------
// createElement.mjs — DOM element creation with reactive props
//
// Imports: component.mjs, lifecycle.mjs, @esmj/signals, easy-uid
// Exports (public): createElement, renderChild, isSignalLike
// Exports (internal): clearContainer
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
  tabIndex: 'tabindex',
  readOnly: 'readonly',
  autoComplete: 'autocomplete',
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
 * Create a DOM element (or a lazy component descriptor).
 *
 * Overloads:
 *   createElement(tagName, props, children)
 *   createElement(Component, props, children)   — function component
 *   createElement(props, children)              — shorthand, defaults to <div>
 */
export function createElement(nodeName, props, children) {
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
  const normalized = Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return !(code <= 32 || code === 127);
    })
    .join('')
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

function setSafeAttribute(element, key, value) {
  if (value === null || value === undefined || value === false) {
    element.removeAttribute(key);
    return;
  }

  if (isBlockedAttribute(key, value)) {
    element.removeAttribute(key);
    console.warn(
      `[esmj-dom] Blocked unsafe attribute "${String(key)}" on <${element.tagName.toLowerCase()}>`,
    );
    return;
  }

  element.setAttribute(key, value);
}

function applyProps(element, props) {
  const capturedContext = getInternalContext();

  for (let [key, value] of Reflect.ownKeys(props).map((k) => [k, props[k]])) {
    if (key === 'id') continue; // already handled above

    // Prop name aliases (className → class, htmlFor → for, …)
    key = PROP_ALIASES[key] ?? key;

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
// renderInto (used by If/Each). The old renderInto was missing null/bool
// guards, signal-like support, and array support.
// ---------------------------------------------------------------------------

/**
 * Append a single child value (of any supported type) to a parent node.
 * Safe to call from createElement, If, Each, or mount.
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
// Reactive node slot — handles both DOM Node values and primitives.
//
// A comment node acts as a stable anchor. On each signal/function emission:
//   - If the new value is a DOM Node it is inserted after the anchor.
//   - If the new value is a ComponentInstance descriptor (returned by
//     `createElement(MyComponent, props)`) it is constructed and mounted.
//   - Otherwise a Text node is created for the stringified value.
//   - The previous content node is cleaned up and removed before inserting
//     the next one, so only one live node ever sits after the anchor.
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
  let currentNode = null;

  const dispose = effect(() => {
    withContext(capturedContext, () => {
      const value = fn();

      let newNode;
      let newInstance = null;

      if (value instanceof Node) {
        newNode = value;
      } else if (isComponentInstance(value)) {
        // A reactive slot may return a component descriptor (the result of
        // createElement(MyComponent, props)). Construct it here so it
        // participates in the normal lifecycle instead of rendering as
        // "[object Object]".
        newNode = value.$constructor();
        newInstance = value;
        if (!(newNode instanceof Node)) newNode = null;
      } else if (value == null || value === false || value === true) {
        newNode = null;
      } else {
        newNode = document.createTextNode(String(value));
      }

      if (currentNode) {
        cleanupTree(currentNode);
        currentNode.remove();
      }

      if (newNode) {
        anchor.after(newNode);
        if (newInstance) {
          queueMicrotask(() => runMountHooks(newInstance));
        }
      }

      currentNode = newNode ?? null;
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
