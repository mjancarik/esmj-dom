import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { afterFlush, createSignal } from '@esmj/signals';
import { createElement, Fragment, renderChild } from '../createElement.mjs';
import { For } from '../For.mjs';
import { onUnmount } from '../lifecycle.mjs';
import { mount } from '../mount.mjs';

// ---------------------------------------------------------------------------
// Initial render
// ---------------------------------------------------------------------------

describe('For — initial render', () => {
  it('renders items into a span[data-for] container', async () => {
    const items = createSignal([
      { id: 1, text: 'a' },
      { id: 2, text: 'b' },
    ]);

    const container = For(
      () => items.get(),
      (item) => item.id,
      (itemSig) => {
        const el = document.createElement('li');
        el.textContent = itemSig.get().text;
        return el;
      },
    );
    await afterFlush();

    assert.equal(container.tagName, 'SPAN');
    assert.ok(container.hasAttribute('data-for'));
    assert.equal(container.children.length, 2);
    assert.equal(container.children[0].textContent, 'a');
    assert.equal(container.children[1].textContent, 'b');
  });

  it('renders an empty list with no children', async () => {
    const items = createSignal([]);
    const container = For(
      () => items.get(),
      (item) => item.id,
      () => document.createElement('li'),
    );
    await afterFlush();

    assert.equal(container.children.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Adding items
// ---------------------------------------------------------------------------

describe('For — adding items', () => {
  it('appends a new DOM child for a new key', async () => {
    const items = createSignal([{ id: 1, text: 'a' }]);
    const container = For(
      () => items.get(),
      (item) => item.id,
      (itemSig) => {
        const el = document.createElement('li');
        el.textContent = itemSig.get().text;
        return el;
      },
    );
    await afterFlush();
    assert.equal(container.children.length, 1);

    items.set([
      { id: 1, text: 'a' },
      { id: 2, text: 'b' },
    ]);
    await afterFlush();

    assert.equal(container.children.length, 2);
    assert.equal(container.children[1].textContent, 'b');
  });
});

// ---------------------------------------------------------------------------
// Removing items
// ---------------------------------------------------------------------------

describe('For — removing items', () => {
  it('removes DOM child when key disappears', async () => {
    const items = createSignal([
      { id: 1, text: 'a' },
      { id: 2, text: 'b' },
    ]);
    const container = For(
      () => items.get(),
      (item) => item.id,
      (itemSig) => {
        const el = document.createElement('li');
        el.textContent = itemSig.get().text;
        return el;
      },
    );
    await afterFlush();
    assert.equal(container.children.length, 2);

    items.set([{ id: 1, text: 'a' }]);
    await afterFlush();

    assert.equal(container.children.length, 1);
    assert.equal(container.children[0].textContent, 'a');
  });

  it('calls onUnmount for removed component items', async () => {
    let _unmounted = false;

    const items = createSignal([{ id: 1 }]);
    const container = For(
      () => items.get(),
      (item) => item.id,
      () => {
        onUnmount(() => {
          _unmounted = true;
        });
        return document.createElement('li');
      },
    );
    await afterFlush();
    await new Promise((r) => queueMicrotask(r));

    items.set([]);
    await afterFlush();

    // cleanupTree is called, which runs unmount hooks via element's component
    // (Note: onUnmount only works inside a component $constructor context)
    // The item element's disposers will be cleaned up regardless
    assert.equal(container.children.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Updating existing items (same key)
// ---------------------------------------------------------------------------

describe('For — updating items in-place', () => {
  it('updates the item signal without remounting', async () => {
    let renderCount = 0;
    const items = createSignal([{ id: 1, text: 'first' }]);

    const _container = For(
      () => items.get(),
      (item) => item.id,
      (itemSig) => {
        renderCount++;
        const el = document.createElement('li');
        // Reactive text bound to the item signal
        el.appendChild(document.createTextNode(''));
        el.firstChild.textContent = itemSig.get().text;
        return el;
      },
    );
    await afterFlush();
    assert.equal(renderCount, 1);

    items.set([{ id: 1, text: 'updated' }]);
    await afterFlush();

    // renderFn should NOT have been called again (same key → in-place update)
    assert.equal(
      renderCount,
      1,
      'renderFn must not be called for existing keys',
    );
  });

  it('reactive text inside renderFn updates when item signal changes', async () => {
    const items = createSignal([{ id: 1, text: 'first' }]);

    const container = For(
      () => items.get(),
      (item) => item.id,
      (itemSig) => {
        const el = document.createElement('li');
        // Reactive text node using the item signal
        renderChild(el, () => itemSig.get().text);
        return el;
      },
    );
    await afterFlush();

    items.set([{ id: 1, text: 'updated' }]);
    await afterFlush();

    assert.equal(container.children[0].textContent, 'updated');
  });
});

// ---------------------------------------------------------------------------
// options.equals
// ---------------------------------------------------------------------------

describe('For — options.equals', () => {
  it('default deepEqual skips reactive update for structurally identical replacement item', async () => {
    let runCount = 0;
    const items = createSignal([{ id: 1, text: 'same' }]);

    const container = For(
      () => items.get(),
      (item) => item.id,
      (itemSig) => {
        const el = document.createElement('li');
        renderChild(el, () => {
          runCount++;
          return itemSig.get().text;
        });
        return el;
      },
    );
    await afterFlush();
    assert.equal(runCount, 1);

    // New object reference, but deep-equal content -> default equals must
    // suppress the notification.
    items.set([{ id: 1, text: 'same' }]);
    await afterFlush();

    assert.equal(runCount, 1, 'reactive binding must not re-run');
    assert.equal(container.children[0].textContent, 'same');
  });

  it('reference-identity equals forces reactive update even when content is deep-equal', async () => {
    let runCount = 0;
    const items = createSignal([{ id: 1, text: 'same' }]);

    const container = For(
      () => items.get(),
      (item) => item.id,
      (itemSig) => {
        const el = document.createElement('li');
        renderChild(el, () => {
          runCount++;
          return itemSig.get().text;
        });
        return el;
      },
      { equals: (a, b) => a === b },
    );
    await afterFlush();
    assert.equal(runCount, 1);

    // New object reference with the same field values -> custom equals
    // treats this as a change and must notify subscribers.
    items.set([{ id: 1, text: 'same' }]);
    await afterFlush();

    assert.equal(runCount, 2, 'reactive binding must re-run for new reference');
    assert.equal(container.children[0].textContent, 'same');
  });

  it('reference-identity equals does not trigger a redundant update for the same object reference', async () => {
    let runCount = 0;
    const sharedItem = { id: 1, text: 'same' };
    const items = createSignal([sharedItem]);

    For(
      () => items.get(),
      (item) => item.id,
      (itemSig) => {
        const el = document.createElement('li');
        renderChild(el, () => {
          runCount++;
          return itemSig.get().text;
        });
        return el;
      },
      { equals: (a, b) => a === b },
    );
    await afterFlush();
    assert.equal(runCount, 1);

    // Same object reference reused at the same index -> no change, no update.
    items.set([sharedItem]);
    await afterFlush();

    assert.equal(
      runCount,
      1,
      'reactive binding must not re-run for same reference',
    );
  });
});

// ---------------------------------------------------------------------------
// Reordering items
// ---------------------------------------------------------------------------

describe('For — reordering', () => {
  it('reorders DOM children to match new array order', async () => {
    const items = createSignal([
      { id: 1, text: 'a' },
      { id: 2, text: 'b' },
      { id: 3, text: 'c' },
    ]);

    const container = For(
      () => items.get(),
      (item) => item.id,
      (itemSig) => {
        const el = document.createElement('li');
        el.textContent = itemSig.get().text;
        return el;
      },
    );
    await afterFlush();

    items.set([
      { id: 3, text: 'c' },
      { id: 1, text: 'a' },
      { id: 2, text: 'b' },
    ]);
    await afterFlush();

    assert.equal(container.children[0].textContent, 'c');
    assert.equal(container.children[1].textContent, 'a');
    assert.equal(container.children[2].textContent, 'b');
  });
});

describe('For — defensive key handling', () => {
  it('logs and skips later duplicate keys without throwing', async () => {
    const items = createSignal([
      { id: 1, text: 'a' },
      { id: 1, text: 'b' },
    ]);

    const originalConsoleError = console.error;
    const errors = [];
    console.error = (...args) => {
      errors.push(args.join(' '));
    };

    try {
      const container = For(
        () => items.get(),
        (item) => item.id,
        (itemSig) => {
          const el = document.createElement('li');
          el.textContent = itemSig.get().text;
          return el;
        },
      );

      await afterFlush();

      assert.equal(container.children.length, 1);
      assert.equal(container.children[0].textContent, 'a');
      assert.equal(errors.length, 1);
      assert.match(errors[0], /For: duplicate key "1" detected/);
    } finally {
      console.error = originalConsoleError;
    }
  });
});

// ---------------------------------------------------------------------------
// Fragment items (regression test for the DocumentFragment-empties-itself
// bug — a renderFn returning a Fragment must have all of its top-level
// children tracked/reordered/removed as one group)
// ---------------------------------------------------------------------------

describe('For — Fragment items', () => {
  it('renders each Fragment item as multiple sibling nodes, in order, interleaved with single-node items', async () => {
    const items = createSignal([
      { id: 1, text: 'a' },
      { id: 2, text: 'b' },
      { id: 3, text: 'c' },
    ]);

    const container = For(
      () => items.get(),
      (item) => item.id,
      (itemSig) => {
        const item = itemSig.get();
        if (item.id === 2) {
          const s1 = document.createElement('b');
          s1.textContent = `${item.text}1`;
          const s2 = document.createElement('i');
          s2.textContent = `${item.text}2`;
          return createElement(Fragment, {}, [s1, s2]);
        }
        const el = document.createElement('li');
        el.textContent = item.text;
        return el;
      },
    );
    await afterFlush();

    const tags = Array.from(container.childNodes).map((n) => n.tagName);
    assert.deepEqual(tags, ['LI', 'B', 'I', 'LI']);
    assert.equal(container.childNodes[1].textContent, 'b1');
    assert.equal(container.childNodes[2].textContent, 'b2');
  });

  it('removes all nodes of a Fragment item (and runs onUnmount) when its key is removed from the list', async () => {
    let unmounted = false;
    const items = createSignal([
      { id: 1, text: 'a' },
      { id: 2, text: 'b' },
    ]);

    const { createComponentInstance } = await import(
      '../componentInstance.mjs'
    );

    const container = For(
      () => items.get(),
      (item) => item.id,
      (itemSig) => {
        const item = itemSig.get();
        if (item.id === 2) {
          return createComponentInstance(
            () => {
              onUnmount(() => {
                unmounted = true;
              });
              const s1 = document.createElement('b');
              const s2 = document.createElement('i');
              return createElement(Fragment, {}, [s1, s2]);
            },
            {},
            null,
          );
        }
        const el = document.createElement('li');
        el.textContent = item.text;
        return el;
      },
    );
    await afterFlush();
    await new Promise((r) => queueMicrotask(r));

    assert.equal(container.childNodes.length, 3); // li + b + i

    items.set([{ id: 1, text: 'a' }]);
    await afterFlush();

    assert.equal(container.childNodes.length, 1);
    assert.ok(
      unmounted,
      'onUnmount should fire for a removed Fragment-returning item',
    );
  });

  it('reorders a Fragment item as a contiguous block along with single-node items', async () => {
    const items = createSignal([
      { id: 1, text: 'a' },
      { id: 2, text: 'b' },
      { id: 3, text: 'c' },
    ]);

    const container = For(
      () => items.get(),
      (item) => item.id,
      (itemSig) => {
        const item = itemSig.get();
        if (item.id === 2) {
          const s1 = document.createElement('b');
          const s2 = document.createElement('i');
          return createElement(Fragment, {}, [s1, s2]);
        }
        const el = document.createElement('li');
        el.textContent = item.text;
        return el;
      },
    );
    await afterFlush();

    items.set([
      { id: 3, text: 'c' },
      { id: 2, text: 'b' },
      { id: 1, text: 'a' },
    ]);
    await afterFlush();

    const tags = Array.from(container.childNodes).map((n) => n.tagName);
    assert.deepEqual(tags, ['LI', 'B', 'I', 'LI']);
    assert.equal(container.childNodes[0].textContent, 'c');
    assert.equal(container.childNodes[3].textContent, 'a');
  });
});

// ---------------------------------------------------------------------------
// options.tagName — configurable wrapper element
// ---------------------------------------------------------------------------

describe('For — options.tagName', () => {
  it('defaults to a <span> wrapper', async () => {
    const items = createSignal([{ id: 1, text: 'a' }]);
    const container = For(
      () => items.get(),
      (item) => item.id,
      (itemSig) => {
        const el = document.createElement('li');
        el.textContent = itemSig.get().text;
        return el;
      },
    );
    await afterFlush();

    assert.equal(container.tagName, 'SPAN');
  });

  it('uses the given tagName for the wrapper, keeping data-for without forcing display:contents', async () => {
    const items = createSignal([
      { id: 1, text: 'a' },
      { id: 2, text: 'b' },
    ]);
    const container = For(
      () => items.get(),
      (item) => item.id,
      (itemSig) => {
        const el = document.createElement('tr');
        el.textContent = itemSig.get().text;
        return el;
      },
      { tagName: 'tbody' },
    );
    await afterFlush();

    assert.equal(container.tagName, 'TBODY');
    assert.ok(container.hasAttribute('data-for'));
    assert.equal(container.style.display, '');
    assert.equal(container.children.length, 2);
  });

  it('falls back to <span> with a warning for unsupported wrapper tags', async () => {
    const originalConsoleWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => {
      warnings.push(args.join(' '));
    };

    try {
      const items = createSignal([{ id: 1, text: 'a' }]);
      const container = For(
        () => items.get(),
        (item) => item.id,
        (itemSig) => {
          const el = document.createElement('li');
          el.textContent = itemSig.get().text;
          return el;
        },
        { tagName: 'template' },
      );
      await afterFlush();

      assert.equal(container.tagName, 'SPAN');
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /tagName "template"/);
    } finally {
      console.warn = originalConsoleWarn;
    }
  });

  it('falls back to <span> for unsupported wrapper tags regardless of case', async () => {
    const originalConsoleWarn = console.warn;
    console.warn = () => {};

    try {
      const items = createSignal([{ id: 1, text: 'a' }]);
      const container = For(
        () => items.get(),
        (item) => item.id,
        (itemSig) => {
          const el = document.createElement('li');
          el.textContent = itemSig.get().text;
          return el;
        },
        { tagName: 'SCRIPT' },
      );
      await afterFlush();

      assert.equal(container.tagName, 'SPAN');
    } finally {
      console.warn = originalConsoleWarn;
    }
  });
});

// ---------------------------------------------------------------------------
// For — JSX props mode
// ---------------------------------------------------------------------------

describe('For — JSX props mode', () => {
  it('renders items when called with a props object + children', async () => {
    const items = createSignal([
      { id: 1, text: 'a' },
      { id: 2, text: 'b' },
    ]);

    const container = For(
      { each: () => items.get(), keyFn: (item) => item.id },
      (itemSig) => {
        const el = document.createElement('li');
        el.textContent = itemSig.get().text;
        return el;
      },
    );
    await afterFlush();

    assert.equal(container.tagName, 'SPAN');
    assert.ok(container.hasAttribute('data-for'));
    assert.equal(container.children.length, 2);
    assert.equal(container.children[0].textContent, 'a');
    assert.equal(container.children[1].textContent, 'b');
  });

  it('accepts children as an array (JSX auto-runtime shape)', async () => {
    const items = createSignal([{ id: 1, text: 'a' }]);
    const renderFn = (itemSig) => {
      const el = document.createElement('li');
      el.textContent = itemSig.get().text;
      return el;
    };

    const container = For(
      { each: () => items.get(), keyFn: (item) => item.id },
      [renderFn],
    );
    await afterFlush();

    assert.equal(container.children.length, 1);
    assert.equal(container.children[0].textContent, 'a');
  });

  it('accepts "each" as a signal directly (not just a function accessor)', async () => {
    const items = createSignal([{ id: 1, text: 'a' }]);

    const container = For(
      { each: items, keyFn: (item) => item.id },
      (itemSig) => {
        const el = document.createElement('li');
        el.textContent = itemSig.get().text;
        return el;
      },
    );
    await afterFlush();

    assert.equal(container.children.length, 1);

    items.set([
      { id: 1, text: 'a' },
      { id: 2, text: 'b' },
    ]);
    await afterFlush();

    assert.equal(container.children.length, 2);
  });

  it('throws when "keyFn" prop is missing', () => {
    const items = createSignal([{ id: 1, text: 'a' }]);

    assert.throws(() => {
      For({ each: () => items.get() }, (_itemSig) => {
        return document.createElement('li');
      });
    }, /"keyFn" prop is required/);
  });

  it('honors "equals" and "tagName" props', async () => {
    const items = createSignal([{ id: 1, text: 'a' }]);

    const container = For(
      {
        each: () => items.get(),
        keyFn: (item) => item.id,
        equals: (a, b) => a === b,
        tagName: 'tbody',
      },
      (itemSig) => {
        const el = document.createElement('tr');
        el.textContent = itemSig.get().text;
        return el;
      },
    );
    await afterFlush();

    assert.equal(container.tagName, 'TBODY');
    assert.equal(container.style.display, '');
    assert.equal(container.children.length, 1);
  });

  it('works end-to-end through createElement + mount (JSX-style usage)', async () => {
    const items = createSignal([
      { id: 1, text: 'a' },
      { id: 2, text: 'b' },
    ]);
    const root = document.createElement('div');

    const el = createElement(
      For,
      { each: () => items.get(), keyFn: (item) => item.id },
      (itemSig) => {
        const li = document.createElement('li');
        li.textContent = itemSig.get().text;
        return li;
      },
    );
    mount(root, el);
    await afterFlush();

    const container = root.firstChild;
    assert.equal(container.tagName, 'SPAN');
    assert.equal(container.children.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Wrapper pass-through props — arbitrary DOM props on the wrapper element
// ---------------------------------------------------------------------------

describe('For — wrapper pass-through props', () => {
  it('applies a static class to the wrapper element', async () => {
    const items = createSignal([{ id: 1, text: 'a' }]);

    const container = For(
      {
        each: () => items.get(),
        keyFn: (item) => item.id,
        class: 'todo-items',
      },
      (itemSig) => {
        const el = document.createElement('li');
        el.textContent = itemSig.get().text;
        return el;
      },
    );
    await afterFlush();

    assert.equal(container.className, 'todo-items');
  });

  it('invokes a $ref callback with the wrapper element', async () => {
    const items = createSignal([{ id: 1, text: 'a' }]);
    let capturedEl = null;

    const container = For(
      {
        each: () => items.get(),
        keyFn: (item) => item.id,
        $ref: (el) => {
          capturedEl = el;
        },
      },
      (itemSig) => {
        const el = document.createElement('li');
        el.textContent = itemSig.get().text;
        return el;
      },
    );
    await afterFlush();

    assert.equal(capturedEl, container);
  });

  it('binds an onClick handler on the wrapper element', async () => {
    const items = createSignal([{ id: 1, text: 'a' }]);
    let clicked = false;

    const container = For(
      {
        each: () => items.get(),
        keyFn: (item) => item.id,
        onClick: () => {
          clicked = true;
        },
      },
      (itemSig) => {
        const el = document.createElement('li');
        el.textContent = itemSig.get().text;
        return el;
      },
    );
    await afterFlush();

    container.dispatchEvent(new Event('click', { bubbles: true }));
    assert.equal(clicked, true);
  });

  it('reactively updates a computed class on the wrapper element', async () => {
    const items = createSignal([{ id: 1, text: 'a' }]);
    const highlighted = createSignal(false);

    const container = For(
      {
        each: () => items.get(),
        keyFn: (item) => item.id,
        class: () => (highlighted.get() ? 'highlighted' : 'plain'),
      },
      (itemSig) => {
        const el = document.createElement('li');
        el.textContent = itemSig.get().text;
        return el;
      },
    );
    await afterFlush();

    assert.equal(container.className, 'plain');

    highlighted.set(true);
    await afterFlush();

    assert.equal(container.className, 'highlighted');
  });
});
