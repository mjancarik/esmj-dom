// ---------------------------------------------------------------------------
// component.mjs — component instance creation and mounting
//
// Imports: runtime.mjs, lifecycle.mjs, easy-uid
// Exports: isComponentInstance, isClassComponent, createComponentInstance,
//          mountComponentInstance, resolveToElement
// ---------------------------------------------------------------------------

import uid from 'easy-uid';

import { runMountHooks } from './lifecycle.mjs';
import {
  addToRegistry,
  getInternalContext,
  initNodeInternal,
  mountHooksRegistry,
  normalizeProps,
  RAW_PROPS,
  setInternalContext,
  setNodeComponent,
  unmountHooksRegistry,
} from './runtime.mjs';

/**
 * Returns true if the value is a lazy component descriptor produced by
 * createComponentInstance (has a callable $constructor property).
 */
export function isComponentInstance(obj) {
  return (
    obj != null &&
    typeof obj === 'object' &&
    typeof obj.$constructor === 'function'
  );
}

/**
 * Returns true if fn is a class component — i.e. has a render method on
 * its prototype. This distinguishes class components from plain functions.
 */
export function isClassComponent(fn) {
  return typeof fn === 'function' && typeof fn.prototype?.render === 'function';
}

/**
 * Build a lazy component descriptor. The component function (or class) is NOT
 * called here — it is called later inside $constructor, at which point the
 * component context is set so that lifecycle hooks (onMount, onUnmount,
 * onEffect) can register themselves against the correct componentId.
 */
export function createComponentInstance(fn, props, children) {
  const componentId = uid();

  const instance = {
    componentId,
    $children: children,
    element: null,
    classInstance: null, // for class components,
    $constructor() {
      // Every function component — including RAW_PROPS-tagged control-flow
      // helpers like For/If/Toggle — is called the exact same way:
      // `fn(props)`, a single argument, with `children` merged into it as
      // `props.children` (never signal/computed-wrapped, same as any other
      // prop `normalizeProps` treats specially). RAW_PROPS only changes
      // which *other* prop keys bypass normalizeProps's signal/computed
      // wrapping (e.g. a `keyFn` callback or a literal `tagName` string) —
      // it does NOT change the calling convention. See runtime.mjs's
      // RAW_PROPS.
      const rawKeys = !isClassComponent(fn) ? fn[RAW_PROPS] : undefined;
      const componentProps = {
        ...normalizeProps(props ?? {}, rawKeys),
        children,
      };

      // Use componentId as the context id so that onMount / onUnmount calls
      // inside the component body register under the same key that
      // runMountHooks / runUnmountHooks use.
      // Bug fix: previously initNodeInternal() generated a fresh uid()
      // that never matched instance.componentId.
      //
      // contexts: shallow-copy parent's Map so child inherits all ancestor
      // context values while keeping its own writes isolated.
      const prevContext = getInternalContext();
      const templateInternal = {
        disposers: [],
        id: componentId,
        contexts: new Map(prevContext?.contexts),
      };

      setInternalContext(templateInternal);

      let result;

      if (isClassComponent(fn)) {
        // ---- Class component ----
        instance.ClassConstructor = fn;
        const classInst = new fn(componentProps);
        instance.classInstance = classInst;

        // Bridge onMount → mount hook registry
        if (typeof classInst.onMount === 'function') {
          addToRegistry(mountHooksRegistry, componentId, () => {
            classInst.onMount?.();
          });
        }

        // Bridge onUnmount → unmount hook registry
        if (typeof classInst.onUnmount === 'function') {
          addToRegistry(unmountHooksRegistry, componentId, () => {
            classInst.onUnmount?.();
          });
        }

        result = classInst.render();
      } else {
        // ---- Function component ----
        result = fn(componentProps);
      }

      setInternalContext(prevContext);

      const element = resolveToElement(result);
      instance.element = element;

      // Associate the templateInternal (disposers) and the instance
      // (onMount/onUnmount bookkeeping) with the element node so that
      // cleanupTree can find and dispose them.
      //
      // Bug fix: a DocumentFragment result (e.g. from `render() { return
      // <Fragment>...</Fragment>; }`) gets emptied into its parent as soon
      // as it is appended (mountComponentInstance / renderChild / If / For
      // all do this) — the bookkeeping must therefore be attached to each of
      // its *top-level children* individually, not to the fragment object
      // itself, otherwise cleanupTree's live-DOM-tree walk would never find
      // it and onUnmount/effect disposal would silently never run.
      //
      // Known remaining limitation: an *empty* Fragment has no child node to
      // carry this bookkeeping at all, so onUnmount/disposers registered by
      // such a component still cannot run — there is no live DOM node left
      // to hang them on.
      if (element instanceof DocumentFragment && element.childNodes.length) {
        for (const child of element.childNodes) {
          initNodeInternal(child, templateInternal);
          setNodeComponent(child, instance);
        }
      } else {
        initNodeInternal(element, templateInternal);

        if (element instanceof Node) {
          setNodeComponent(element, instance);
        }
      }

      return element;
    },
  };

  return instance;
}

/**
 * Mount a component instance into a parent node:
 * 1. Call $constructor to get the DOM element (runs the component function).
 * 2. Append to parent.
 * 3. Queue runMountHooks via microtask so the element is in the live DOM
 *    by the time mount callbacks execute.
 */
export function mountComponentInstance(parent, instance) {
  const element = instance.$constructor();

  if (element instanceof Node) {
    parent.appendChild(element);
  }

  queueMicrotask(() => {
    runMountHooks(instance);
  });
}

/**
 * Coerce any value returned from a component function into a DOM Node.
 */
export function resolveToElement(value) {
  if (value instanceof Node) return value;
  if (isComponentInstance(value)) return value.$constructor();
  if (typeof value === 'string' || typeof value === 'number') {
    return document.createTextNode(String(value));
  }
  return document.createTextNode('');
}
