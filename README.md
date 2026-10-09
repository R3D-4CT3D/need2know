# What Sites See — browser extension

Catches websites fingerprinting you **as you browse**, stops most of it, and helps you get the
data deleted.

- **See it.** While a page loads, the extension watches the browser APIs trackers use to identify
  your device. It shows which script did what, and gives each site a 0–100 score on the toolbar icon.
- **Stop it.** Protection feeds fingerprinting scripts noise and generic values, so sites can't
  link your visits. It's **off by default**: you choose the default, turn it on or off per site
  from the popup, and pick which defenses run and which companies to always allow. It blocks session recorders and fingerprinting services, sends the legal Global
  Privacy Control opt-out, and can close WebRTC IP leaks.
- **Undo it.** Generates a CCPA, GDPR or UK GDPR deletion request with the evidence attached, links
  to the right opt-out pages, and points Californians to the state's one-stop data broker deletion
  platform.
- **Measure the web.** A crawler runs the extension over the Tranco top sites and reports what
  they do, and whether protection breaks them. See [docs/findings.md](docs/findings.md); the
  popup compares each site you visit with those results.
- **Learn from it.** A Privacy Checkup scores your defenses and shows, side by side, what sites see
  with and without protection. History shows which companies follow you across sites. Evidence
  reports come with a SHA-256 integrity hash.

This is v2 of [What Sites See](#background). v1 was a demo page showing what *one* page can learn
about you. v2 shows you what *real* sites actually try, and fights back.

| Browser | Build | Status |
|---|---|---|
| Chrome 111+ | `dist/chrome` | Primary target |
| Edge, Brave, Opera, Vivaldi | `dist/chrome` | Same Chromium engine, same build |
| Firefox 140+ | `dist/firefox` | Supported (lints clean with `web-ext`) |
| Safari | — | Not yet (needs Xcode's web-extension converter) |

## Quick start

```bash
npm run build        # writes dist/chrome and dist/firefox (the extension has no dependencies)
npm test             # unit tests (scoring, protection plans, letters, evidence hashing…)
npm run serve        # test pages at http://localhost:8080
npm install          # dev-only: Playwright and FingerprintJS, for the end-to-end test
npm run test:e2e     # loads the extension into real Chromium and checks every test page
npm run lint:firefox # Mozilla's add-on linter on the Firefox build
npm run crawl        # measure the Tranco top sites (about an hour), then:
npm run crawl:report # regenerate docs/findings.md and the stats the extension ships
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

Then visit http://localhost:8080. The **Fingerprinter** page should score 100 and the **Control**
page 2. On **Protection test**, the canvas and audio values differ between `localhost:8080` and
`127.0.0.1:8081` but stay the same on reload.

`test:e2e` uses Playwright's Chromium (`npx playwright-core install chromium`), or set
`CHROME_PATH` to another Chromium build. Branded Google Chrome no longer accepts `--load-extension`.

## What it catches

| Technique | How it's detected | Points |
|---|---|---|
| Canvas fingerprinting | Text drawn on a canvas ≥16×16, then read back (`toDataURL`, `toBlob`, `getImageData`) | 25 |
| Session recording | Page contacts a known replay vendor (Hotjar, FullStory, Clarity, LogRocket…) | 25 |
| Audio fingerprinting | `OfflineAudioContext.startRendering()` | 20 |
| Font probing | Text measured in ≥20 distinct fonts: canvas `measureText`, `document.fonts.check`, or sizing styled elements (`offsetWidth`/`offsetHeight`/`getBoundingClientRect`) | 20 |
| Commercial fingerprinting service | Page contacts FingerprintJS / Fingerprint.com | 20 |
| Graphics chip lookup | WebGL `UNMASKED_RENDERER_WEBGL` / `UNMASKED_VENDOR_WEBGL` | 15 |
| Hardware sweep | ≥10 distinct `navigator` / `screen` properties read | 10 |
| Third-party keystroke listener | A script from another site adds a key or input listener to the whole page | 10 |
| Fraud and bot detection | Page contacts ThreatMetrix, iovation, BioCatch, HUMAN, DataDome… | 10 |
| Camera and mic count | `mediaDevices.enumerateDevices()` | 8 |
| WebRTC connection | `RTCPeerConnection.createOffer()` / `createDataChannel()` | 8 |
| Exact OS version and device model | `userAgentData.getHighEntropyValues()` (User-Agent Client Hints) | 6 |
| Battery, voices, keyboard layout | `getBattery()`, `speechSynthesis.getVoices()`, `keyboard.getLayoutMap()` | 6 each |
| Storage quota | `storage.estimate()` | 4 |
| Canvas read | Pixels read back with no text drawn first (usually harmless) | 2 |

Score is capped at 100. Grades: 1–24 *a little probing*, 25–59 *actively fingerprinting*, 60+ *heavy*.
The canvas rule follows the OpenWPM heuristic from Englehardt & Narayanan, *Online Tracking: A
1-million-site Measurement and Analysis* (CCS 2016).

## How protection works

Detection always runs. Protection is the user's choice: off by default, switchable per site in the
popup, pausable for an hour or until restart, and configurable in Settings (default for all
sites, each defense, each blocking category, companies to always allow, private windows, badge,
history retention, sites never recorded, import, export and erase).

### Private windows

Browsers keep extensions out of private windows until you allow them: in Chromium browsers,
**Details → Allow in Incognito** (Edge: *InPrivate*); in Firefox, **about:addons → Run in Private
Windows**. Settings shows whether it's allowed. Once it is:

- **Private windows get their own seeds.** A site sees a different "you" in a private window than
  in a normal one, so it can't link the two visits.
- **"Always protect in private windows"** protects private windows even on sites that are off in
  normal ones. A page script can't tell it's in a private window; only the extension's isolated
  script can (`extension.inIncognitoContext`). So the protection files are injected behind
  `private-only.js`, stay inert, and switch on when the bridge confirms a private window. That
  handoff is synchronous and happens before any page script runs. Network blocking does the same
  with session rules that exclude open private tabs from the "protection off" exemption.
- **Private windows are never recorded** in history.

| Signal | Defense |
|---|---|
| Canvas, WebGL pixels, audio | **Noise.** Tiny changes, seeded per site and per browser session: one site always sees the same "you", two sites see different ones. |
| GPU name, CPU cores, memory, battery, voices, device hints, keyboard layout, camera/mic count | **Generic values** many people share. |
| Session recorders, fingerprinting services (and optionally fraud/bot detection) | **Blocked** at the network level with `declarativeNetRequest`, from rules generated from `shared/vendors.js`. |
| "Do not sell or share" | **Global Privacy Control:** `navigator.globalPrivacyControl` plus the `Sec-GPC: 1` header. |
| WebRTC IP leaks | **Optional:** limits WebRTC to the default public interface. |
| Installed fonts | **Standard fonts only.** Font probes (canvas and DOM) see only the fonts that ship with your OS. Rendering is untouched; only measurements of probe-style elements change. |
| Screen size, time zone | **Not hidden.** Hiding them breaks sites; the popup explains browser settings that help. |

Against the real FingerprintJS library, Protect mode gives you a **different `visitorId` on every
site** and the same one on repeat visits to a site. The end-to-end test checks exactly that.

Design details worth knowing:

- **Load order.** Protection runs before `hooks.js` in the page, so it wraps the browser's real
  functions first and its internal canvas copies stay invisible. `hooks.js` wraps those wrappers,
  so every attempt is still recorded: `page → hooks.js (records) → protection (adds noise) → browser`.
- **Settings without code generation.** Protection must be configured *synchronously* at
  `document_start`, and content scripts can't be generated at runtime. So each defense is its own
  file (`content/protect/canvas.js`, `audio.js`, `fonts.js`, …) and `scripting.registerContentScripts()`
  injects only the enabled ones, after `core.js` (shared helpers). `hooks.js`, always last, removes
  those helpers before any page script runs. Per-site exceptions become `matches` / `excludeMatches`.
- **Fonts without breaking pages.** A font probe measures text in `"SomeFont", fallback` and
  compares it with the fallback. On canvas `measureText` and when sizing elements styled with an
  inline font-family, a family that isn't standard for your OS (and isn't a web font the page
  loaded) is dropped for that one measurement. Probes see a standard install; rendering never changes.
- **Web Workers.** Content scripts can't run in workers, and a worker that answers differently from
  the page exposes the protection. So `hooks.js` starts each dedicated `Worker` from a `blob:` script
  that runs `worker-prelude.js` (detection, plus the page's protection with the same seed) and then
  loads the original. Relative URLs (`location`, `importScripts`, `fetch`, XHR…) are re-resolved
  against the original script, and module workers have early messages held until they've loaded.
  Only where the page's CSP allows `blob:` workers, which the background reads from response
  headers; elsewhere workers run untouched.
- **Blocking follows the same switch.** Vendor blocklists are static rulesets; a dynamic
  `allowAllRequests` rule exempts every page where protection is off, and an `allow` rule covers
  companies the user trusts. GPC's header rule outranks both, so it's sent everywhere.
- **No reload race.** The popup's switch asks the background to save, re-register scripts and
  rules, and only then reload the tab. The popup also compares the setting with what the page
  actually loaded with, and says so if they differ.
- **A secret seed.** The background keeps a random per-session secret and derives each site's seed
  with SHA-256. The bridge hands it to `content/protect/core.js` on an event name `core.js` makes up at
  `document_start`, before any page script exists to overhear it. If a page fingerprints before the
  seed arrives (a few milliseconds), it gets a random seed for that page load. Protection never
  fails open.
- **Undetectable round trips.** Canvas noise only touches fully opaque pixels, and sets a bit rather
  than flipping it, based on the color with low bits masked. Applying it twice changes nothing, so
  the classic "read, write back, read again" check finds nothing odd, just like an unmodified browser.

## Permissions

| Permission | Why |
|---|---|
| Access to all sites | To watch and protect every page you visit. Nothing is sent anywhere. |
| `scripting` | To switch protection on or off per site. |
| `declarativeNetRequest` | To block session recorders and fingerprinting services, and send the GPC header. |
| `storage` | Settings, per-tab reports and your local history. |
| `alarms` | To end a pause on time. |
| `webRequest` | Read-only: to see whether a page's security policy allows Web Worker coverage. Nothing is blocked or changed with it. |
| `privacy` | Only for WebRTC IP leak protection, which stays off until you turn it on. |

No data leaves your browser. Firefox's manifest declares `data_collection_permissions: none`.

## How detection works

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
- **Short-lived iframes.** Fingerprinters often probe inside an iframe and delete it within
  milliseconds, killing any timer still pending inside it. So `hooks.js` reports through the highest
  *same-origin* ancestor window, whose document and timers outlive the iframe.
- **`bridge.js`** can't share variables with `hooks.js`, since they run in separate worlds. The two
  talk through a DOM event. The bridge also records every domain the frame loads from, using
  `PerformanceObserver`.
- **The bridge sends cumulative snapshots, not individual changes,** so a lost message or a restarted
  background script corrects itself on the next send.
- **`shared/`** is pure JavaScript with no browser APIs: scoring, protection plans, advice, letters,
  evidence hashing and the cross-site view. The extension pages and the unit tests share it.

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

- **Font protection covers measurement-based probing** (canvas `measureText` and sizing inline-styled
  elements). A page that measures its own text in a font you installed would get the standard-font
  size instead; switch the defense off for that site if it misbehaves.
- **Protection isn't a guarantee.** Sites have many signals. Protect mode removes the strongest ones,
  but IP address, screen size, time zone and language still narrow you down.
- **Private windows are tested by unit tests, not end to end.** Playwright can't open an incognito
  window with an extension allowed in it, so the browser suite covers the normal-window side.
- **Very early fingerprinting gets a random seed** for that page load (see *A secret seed* above).
  That's more private, but the site sees a different you on every reload.
- **Fraud and bot detection isn't blocked by default** because banks and checkouts depend on it.
- **SharedWorker and ServiceWorker aren't covered,** and neither are dedicated workers on pages whose
  CSP forbids `blob:` workers (common on large sites). Wrapping those would change or break them. Content scripts can't run inside workers, so fingerprinting done
  with `OffscreenCanvas` in a worker goes unseen.
- **iframe escapes are verified in Chromium only.** The escape tests (fresh `about:blank`, `frames[i]`,
  `srcdoc`, `blob:`, `data:`) all pass in Chromium. Firefox hasn't been tested in an automated way:
  it runs scripts inside `about:blank` frames, but doesn't support `match_origin_as_fallback`, so
  `blob:` and `data:` frames are likely a gap there.
- **Scripts inside `data:` frames** are caught but can't be attributed, because their stack traces
  have no URL.
- Hooking can be detected. A determined script could notice the wrappers and stay quiet.
- A page can hide which script made a call by making `Error.stackTraceLimit` non-writable. The
  detection still counts; only the attribution is lost.
- A page can send fake events to the bridge. The worst it can do is make itself look *worse*.
- **"Third party" uses a short built-in suffix list,** not the full Public Suffix List, so some CDN
  domains owned by the site itself will be labeled third-party.
- The vendor list (`shared/vendors.js`) is curated and incomplete.

## Roadmap

- [x] Catch font probing done by measuring DOM elements
- [x] Catch fingerprinting inside short-lived, `blob:` and `data:` iframes
- [x] Verify against the real FingerprintJS library in an end-to-end test
- [x] Protect mode: per-site noise, generic values, vendor blocking, per-site allowlist
- [x] Global Privacy Control and WebRTC IP leak protection
- [x] Browser-specific "How to stop this" advice
- [x] Deletion requests (CCPA, US state laws, GDPR, UK GDPR) with evidence attached
- [x] Privacy Checkup, typing warning, cross-site tracker view, evidence reports
- [x] Font protection, Web Worker coverage, a real-world crawl with findings
- [ ] Automated Firefox end-to-end test (Selenium with geckodriver, or `web-ext run`)
- [ ] Publish to the Chrome Web Store, Microsoft Edge Add-ons and Firefox Add-ons (addons.mozilla.org)

## Project layout

```
src/
  manifest.json        base manifest (Chromium); Firefox variant is generated
  background.js        per-tab state, badge, history, settings → scripts and network rules, seeds
  content/hooks.js     detection: API wrappers, runs in the page's world
  content/protect/     protection: core.js, then one file per defense (run before hooks.js)
  content/worker-prelude.js   runs inside Web Workers; inlined into hooks.js at build time
  content/gpc.js       Global Privacy Control flag
  content/bridge.js    relays to background, seed handoff, typing warning (isolated world)
  shared/              scoring, techniques, vendors, plans, advice, letters, evidence, insights
  popup/               toolbar popup
  checkup/ findings/ history/ options/ request/ report/   full-page views
  data/crawl-stats.json   crawl summary the popup and Findings page use
  icons/               generated by scripts/make-icons.mjs
scripts/               build, icons, two-origin test server, crawler and crawl report
data/                  raw crawl results; docs/findings.md is generated from them
test/                  node:test unit tests, e2e.mjs (Playwright), pages/ test sites
```

## Background

v1 was a single-page app that shows a visitor what any site can learn about them in a few seconds,
from browser and GPU to fonts, battery and typing rhythm. The detection code in `hooks.js` mirrors
the techniques v1 demonstrates. Drop the v1 HTML into `test/pages/v1.html` to watch the extension
catch it.
