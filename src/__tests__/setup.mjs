// ---------------------------------------------------------------------------
// setup.mjs — global DOM environment for Node.js tests
//
// Loaded via --import flag so every test file has DOM globals available
// without having to import this file explicitly.
// ---------------------------------------------------------------------------

import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
});

const { window } = dom;

// Expose browser globals on the Node.js global object
global.window = window;
global.document = window.document;
global.Node = window.Node;
global.Element = window.Element;
global.HTMLElement = window.HTMLElement;
global.DocumentFragment = window.DocumentFragment;
global.Text = window.Text;
global.Comment = window.Comment;
global.MutationObserver = window.MutationObserver;
global.NodeList = window.NodeList;
global.HTMLCollection = window.HTMLCollection;
global.Event = window.Event;
global.CustomEvent = window.CustomEvent;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.cancelAnimationFrame = clearTimeout;
