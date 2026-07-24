import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createComponentInstance } from '../componentInstance.mjs';
import { onEffect, onUnmount } from '../lifecycle.mjs';
import { mount, unmount } from '../mount.mjs';

// ---------------------------------------------------------------------------
// mount — basic
// ---------------------------------------------------------------------------

describe('mount', () => {
  it('mounts a plain DOM node into the container element', () => {
    const container = document.createElement('div');
    const child = document.createElement('span');
    child.textContent = 'hello';

    mount(container, child);

    assert.equal(container.firstChild, child);
    assert.equal(container.textContent, 'hello');
  });

  it('clears the container before mounting', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>old content</p>';

    const child = document.createElement('span');
    mount(container, child);

    assert.equal(container.children.length, 1);
    assert.equal(container.firstChild, child);
  });

  it('mounts a string as a text node', () => {
    const container = document.createElement('div');
    mount(container, 'hello world');

    assert.equal(container.textContent, 'hello world');
  });

  it('mounts a component instance', () => {
    const container = document.createElement('div');
    const instance = createComponentInstance(
      () => {
        const el = document.createElement('article');
        el.textContent = 'component';
        return el;
      },
      {},
      null,
    );

    mount(container, instance);

    assert.equal(container.firstChild?.tagName, 'ARTICLE');
  });

  it('accepts a CSS selector string as container', () => {
    // Attach a mock container to jsdom document
    const el = document.createElement('div');
    el.id = 'mount-test-root';
    document.body.appendChild(el);

    const child = document.createElement('p');
    mount('#mount-test-root', child);

    assert.equal(el.firstChild, child);

    // cleanup
    document.body.removeChild(el);
  });

  it('throws when container is not found by selector', () => {
    assert.throws(
      () => mount('#non-existent-container-xyz', document.createElement('div')),
      /mount: container not found/,
    );
  });
});

// ---------------------------------------------------------------------------
// unmount
// ---------------------------------------------------------------------------

describe('unmount', () => {
  it('clears the container DOM', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>content</p>';

    unmount(container);

    assert.equal(container.innerHTML, '');
  });

  it('runs onUnmount hooks for mounted components', async () => {
    const container = document.createElement('div');
    let unmountCalled = false;

    const instance = createComponentInstance(
      () => {
        onUnmount(() => {
          unmountCalled = true;
        });
        return document.createElement('div');
      },
      {},
      null,
    );

    mount(container, instance);
    // Wait for mount hooks to run
    await new Promise((resolve) => queueMicrotask(resolve));

    unmount(container);

    assert.equal(unmountCalled, true);
  });

  it('disposes onEffect disposers for mounted components', async () => {
    const container = document.createElement('div');
    let disposed = false;

    const instance = createComponentInstance(
      () => {
        onEffect(() => {
          disposed = true;
        });
        return document.createElement('div');
      },
      {},
      null,
    );

    mount(container, instance);
    await new Promise((resolve) => queueMicrotask(resolve));

    unmount(container);

    assert.equal(disposed, true);
  });

  it('accepts a CSS selector string as container', () => {
    const el = document.createElement('div');
    el.id = 'unmount-test-root';
    el.innerHTML = '<span>bye</span>';
    document.body.appendChild(el);

    unmount('#unmount-test-root');

    assert.equal(el.innerHTML, '');

    document.body.removeChild(el);
  });

  it('throws when container is not found by selector', () => {
    assert.throws(
      () => unmount('#non-existent-container-xyz'),
      /unmount: container not found/,
    );
  });

  it('does not throw when container holds plain nodes without components', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>plain</p><span>nodes</span>';

    assert.doesNotThrow(() => unmount(container));
    assert.equal(container.innerHTML, '');
  });
});
