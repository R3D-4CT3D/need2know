// Global Privacy Control: tells every site "do not sell or share my personal information".
// California, Colorado, Connecticut and other states require sites to honor it as an opt-out.
// Firefox and Brave can send it natively; Chrome and Edge can't, so we add it. background.js
// also sends the matching `Sec-GPC: 1` header with every request.
(() => {
  'use strict';
  const proto = Navigator.prototype;
  const current = Object.getOwnPropertyDescriptor(proto, 'globalPrivacyControl');
  if (current && current.get && current.get.call(navigator) === true) return; // already on
  const { get } = Object.getOwnPropertyDescriptor({ get globalPrivacyControl() { return true; } }, 'globalPrivacyControl');
  Object.defineProperty(proto, 'globalPrivacyControl', { configurable: true, enumerable: true, get });
})();
