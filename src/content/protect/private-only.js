// Protection for private windows only. Runs before core.js when the user wants private windows
// protected on sites that aren't protected in normal windows. core.js reads and deletes this
// flag immediately, then keeps every defense inert unless the bridge confirms a private window.
Object.defineProperty(window, '__wssPrivateOnly', { configurable: true, value: true });
