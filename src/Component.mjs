// Component.mjs — optional base class for class-based components
// ---------------------------------------------------------------------------

/**
 * Optional base class for class-based components.
 *
 * Subclass and implement the following methods:
 * - `render()` *(required)* — must return a DOM `Node` or component instance.
 * - `onMount()` *(optional)* — called after the element is inserted
 *   into the DOM. Equivalent to the `onMount` hook for function components.
 * - `onUnmount()` *(optional)* — called before the element is
 *   removed from the DOM. Equivalent to the `onUnmount` hook for function
 *   components.
 *
 * @example
 * class Counter extends Component {
 *   render() {
 *     return createElement('button', { onClick: () => {} }, 'Click me');
 *   }
 * }
 */
export class Component {
  /**
   * @param {Record<string, *>} props  Props passed to the component.
   */
  constructor(props) {
    this.props = props;
  }
}
