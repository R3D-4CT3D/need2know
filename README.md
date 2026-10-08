# What Sites See — browser extension

Catches websites fingerprinting you **as you browse**. While a page loads, the extension watches the
browser APIs that trackers use to identify your device. It shows which script did what, and gives
each site a 0–100 score on the toolbar icon.

This is v2 of [What Sites See](#background). v1 was a demo page showing what *one* page can learn
about you. v2 turns that around and shows you what *real* sites actually try.

| Browser | Build | Status |
|---|---|---|
| Chrome 111+ | `dist/chrome` | Primary target |
| Edge, Brave, Opera, Vivaldi | `dist/chrome` | Same Chromium engine, same build |
| Firefox 128+ | `dist/firefox` | Supported |
| Safari | — | Not yet (needs Xcode's web-extension converter) |

## Quick start

```bash
npm run build        # writes dist/chrome and dist/firefox (no dependencies to install)
npm test             # unit tests for scoring, domains and vendor matching
npm run serve        # test pages at http://localhost:8080
```

**Chrome, Edge, Brave, Opera:** open `chrome://extensions` (or `edge://extensions`, `brave://extensions`),
turn on **Developer mode**, click **Load unpacked**, and choose `dist/chrome`.
After changing code, run `npm run build` and click the reload icon on the extension card.

**Firefox:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and choose
`dist/firefox/manifest.json`. Firefox makes site access opt-in, so open the popup and click
**Allow on all sites**, then reload the page. For auto-reload while developing:
`npx web-ext run --source-dir dist/firefox`.

**On WSL:** build inside WSL, then in Windows Chrome load
`\\wsl.localhost\Ubuntu\home\w0lfy\Projects\need2know\dist\chrome`.

Then visit http://localhost:8080. The **Fingerprinter** page should score 100 and the **Control** page 2.

## What it catches

| Technique | How it's detected | Points |
|---|---|---|
| Canvas fingerprinting | Text drawn on a canvas ≥16×16, then read back (`toDataURL`, `toBlob`, `getImageData`) | 25 |
| Session recording | Page contacts a known replay vendor (Hotjar, FullStory, Clarity, LogRocket…) | 25 |
| Audio fingerprinting | `OfflineAudioContext.startRendering()` | 20 |
| Font probing | Text measured in ≥20 distinct font settings (`measureText`, `document.fonts.check`) | 20 |
| Commercial fingerprinting service | Page contacts FingerprintJS / Fingerprint.com | 20 |
| Graphics chip lookup | WebGL `UNMASKED_RENDERER_WEBGL` / `UNMASKED_VENDOR_WEBGL` | 15 |
| Hardware sweep | ≥10 distinct `navigator` / `screen` properties read | 10 |
| Third-party keystroke listener | A script from another site adds a key or input listener to the whole page | 10 |
| Fraud and bot detection | Page contacts ThreatMetrix, iovation, BioCatch, HUMAN, DataDome… | 10 |
| Camera and mic count | `mediaDevices.enumerateDevices()` | 8 |
| WebRTC connection | `RTCPeerConnection.createOffer()` / `createDataChannel()` | 8 |
| Detailed device hints | `userAgentData.getHighEntropyValues()` | 6 |
| Battery, voices, keyboard layout | `getBattery()`, `speechSynthesis.getVoices()`, `keyboard.getLayoutMap()` | 6 each |
| Storage quota | `storage.estimate()` | 4 |
| Canvas read | Pixels read back with no text drawn first (usually harmless) | 2 |

Score is capped at 100. Grades: 1–24 *a little probing*, 25–59 *actively fingerprinting*, 60+ *heavy*.
The canvas rule follows the OpenWPM heuristic from Englehardt & Narayanan, *Online Tracking: A
1-million-site Measurement and Analysis* (CCS 2016).

## How it works

```
 page's JS world (MAIN)            extension's isolated world         background
┌──────────────────────┐  DOM    ┌───────────────────────┐ runtime  ┌──────────────────────┐
│ content/hooks.js     │ event   │ content/bridge.js     │ message  │ background.js        │
│ wraps APIs, reads    │───────▶│ cumulative snapshot   │────────▶│ per-tab state,       │
│ stack → script URL   │         │ + contacted domains   │          │ badge, history       │
└──────────────────────┘         └───────────────────────┘          └──────────┬───────────┘
                                                                     storage.session
                                                                    ┌──────────▼───────────┐
                                                                    │ popup / history page │
                                                                    │ shared/scoring.js    │
                                                                    └──────────────────────┘
```

- **`hooks.js`** runs inside the page's own JavaScript (`world: "MAIN"`) at `document_start`, before
  any site script. Each hooked API is replaced by a `Proxy` of the original, so its name and length
  still look native. The extension's bookkeeping runs in a `try/catch`, so a bug in it can never
  break the page. The extension observes these calls but never changes what they return.
- **Attribution:** each hook takes a stack trace and keeps the first `http(s)` URL in it. That URL is
  the script that made the call. The extension's own frames are `chrome-extension://` or
  `moz-extension://` URLs, so they never match.
- **`bridge.js`** can't share variables with `hooks.js`, since they run in separate worlds. The two
  talk through a DOM event. The bridge also records every domain the frame loads from, using
  `PerformanceObserver`.
- **The bridge sends cumulative snapshots, not individual changes,** so a lost message or a restarted
  background script corrects itself on the next send.
- **`shared/scoring.js`** is pure JavaScript with no browser APIs. The popup, the history page and the
  unit tests all use it.

## Cross-browser notes

- `scripts/build.mjs` writes both builds from one `src/`. Firefox's manifest gets
  `background.scripts` (it has no extension service workers), a `gecko` ID, and
  `data_collection_permissions: none`.
- `shared/api.js` picks `browser.*` (Firefox) or `chrome.*` (Chromium). Both return promises in
  Manifest V3, so no polyfill is needed.
- **Brave** adds random noise to canvas, audio and WebGL results ("farbling"). The extension still
  catches the *attempt*, which is the point. Brave Shields also blocks many fingerprinting scripts
  outright, so expect lower scores there. That's accurate, not a bug.
- **Firefox** with Enhanced Tracking Protection set to Strict blocks known fingerprinters too. It
  also doesn't support `deviceMemory`, `getBattery` or `keyboard.getLayoutMap`.
- **Private windows** are never written to history.

## Known limitations

- **Font probing done by measuring DOM elements** (`offsetWidth` on hidden spans) isn't caught yet.
  Only canvas and `document.fonts` probing are.
- **Hooks can be bypassed.** A script that grabs fresh APIs from a newly created `about:blank` iframe
  before the extension's content script runs there gets un-hooked copies.
- A page that deliberately lowers `Error.stackTraceLimit` can hide which script called an API. The
  detection itself still counts.
- A page can send fake events to the bridge. The worst it can do is make itself look *worse*.
- **"Third party" uses a short built-in suffix list,** not the full Public Suffix List, so some CDN
  domains owned by the site itself will be labeled third-party.
- The vendor list (`shared/vendors.js`) is curated and incomplete.

## Roadmap

- [ ] Patch iframe `contentWindow` so scripts can't escape the hooks through a fresh iframe
- [ ] Catch font probing done by measuring DOM elements
- [ ] Export a site's report as JSON or PDF, for investigation write-ups
- [ ] Optional protection mode that adds noise to canvas and audio readback
- [ ] Publish to the Chrome Web Store, Microsoft Edge Add-ons and Firefox Add-ons (addons.mozilla.org)

## Project layout

```
src/
  manifest.json        base manifest (Chromium); Firefox variant is generated
  background.js        per-tab state, badge, history
  content/hooks.js     API wrappers, runs in the page's world
  content/bridge.js    relays to background, runs in the isolated world
  shared/              scoring, technique catalog, vendor list, domain helpers, theme
  popup/  history/     UI
  icons/               generated by scripts/make-icons.mjs
scripts/               build, icon generator, two-origin test server
test/                  node:test unit tests, test/pages for manual and end-to-end checks
```

## Background

v1 was a single-page app that shows a visitor what any site can learn about them in a few seconds,
from browser and GPU to fonts, battery and typing rhythm. The detection code in `hooks.js` mirrors
the techniques v1 demonstrates. Drop the v1 HTML into `test/pages/v1.html` to watch the extension
catch it.
