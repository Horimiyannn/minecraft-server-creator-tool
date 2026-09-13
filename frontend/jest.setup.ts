import '@testing-library/jest-dom';

// jsdom lacks a few DOM APIs our components/tests touch.
if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom 20 implements no <dialog> behaviour at all (showModal/close are simply
// absent; native support landed in jsdom 24.1). Toggling `open` is enough for
// role/visibility queries. Escape-to-cancel is only exercised in Playwright,
// where a real browser drives it.
if (
  typeof HTMLDialogElement !== 'undefined' &&
  typeof HTMLDialogElement.prototype.showModal !== 'function'
) {
  HTMLDialogElement.prototype.showModal = function showModal(
    this: HTMLDialogElement,
  ) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
}
