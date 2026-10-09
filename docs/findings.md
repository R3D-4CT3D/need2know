# Fingerprinting on the web's top 100 sites

Measured 2026-10-09 with What Sites See 0.3.0 in Chromium 151.0.0.0, on the homepages of the
first 100 working sites of the [Tranco](https://tranco-list.eu/) research list (list `PY35J`).
72 domains ranked among them were skipped because they didn't load a web page
(CDNs, APIs, ad and DNS infrastructure, and a few that blocked the crawler).

## Headline numbers

- **Median score: 28/100.** 59% of sites actively fingerprinted visitors (score 25+), 27% heavily (60+).
- **Median 5 other companies' domains contacted** by a homepage.
- **With protection on, 98.2% of the fingerprinting attempts it's designed for were stopped** (279 attempts), across all 100 sites.
- **No site showed signs of breaking** with protection on; 5 returned bot-check pages instead, also seen without protection (details below).

A note on keystroke listeners: half the sites let another company's script listen to every key
on the page. Analytics libraries often do this to measure engagement; the extension can see the
listener, not what the script does with what it hears.

## How often each technique was used

| Technique | Sites | By a third party |
|---|---|---|
| Exact OS version and device model | 68% | 55% |
| Hardware sweep | 61% | 45% |
| Third-party keystroke listener | 49% | 49% |
| Graphics chip lookup | 32% | 10% |
| Battery status | 27% | 20% |
| Session recording | 25% | 24% |
| Canvas read | 21% | 4% |
| Storage quota | 19% | 14% |
| Canvas fingerprinting | 18% | 3% |
| Font probing | 13% | 2% |
| Audio fingerprinting | 11% | 3% |
| Speech voices | 11% | 9% |
| Camera and mic count | 8% | 1% |
| WebRTC connection | 8% | 3% |
| Keyboard layout | 4% | 1% |
| Fraud and bot detection | 1% | 1% |

## Companies seen

| Company | Sites |
|---|---|
| Microsoft Clarity | 11% |
| Yandex Metrica | 8% |
| Contentsquare | 4% |
| FullStory | 2% |
| Forter | 1% |
| Crazy Egg | 1% |
| Hotjar | 1% |

## Highest scores

| Site | Tranco rank | Score | Techniques |
|---|---|---|---|
| linkedin.com | 17 | 100 | 13 |
| digicert.com | 51 | 100 | 9 |
| pinterest.com | 53 | 100 | 9 |
| cloudflare.net | 55 | 100 | 11 |
| adobe.com | 62 | 100 | 13 |
| nic.ru | 108 | 100 | 11 |
| dropbox.com | 130 | 100 | 11 |
| mts.ru | 161 | 100 | 11 |
| mail.ru | 13 | 98 | 9 |
| dzen.ru | 18 | 98 | 9 |
| twitter.com | 16 | 94 | 8 |
| x.com | 48 | 94 | 8 |
| tiktok.com | 58 | 86 | 7 |
| webex.com | 163 | 84 | 7 |
| myfritz.net | 71 | 78 | 6 |

## Possible breakage with protection on

None detected.

These are automatic flags, not confirmed breakage: busy homepages change between visits (rotating ads,
A/B tests), so new errors or a smaller page can have nothing to do with protection.

## Bot checks

These sites served a bot-protection page instead of the site during the protected pass. In
follow-up checks the same pages appeared with protection off, so they're counted as the crawler
being flagged (repeated automated visits from one address), not as breakage. Whether protection
contributed to the first challenge can't be separated after the fact.

| Site | Follow-up |
|---|---|
| cloudflare.net | Cloudflare challenge ("Just a moment...") with protection on, and still with protection off afterwards. |
| epicgames.com | Cloudflare challenge ("Just a moment...") with protection on, and still with protection off afterwards. |
| nih.gov | Cloudflare block ("Attention Required!") with protection on, and still with protection off afterwards. |
| nytimes.com | Bot block page from the first follow-up visit, with protection off. |
| openai.com | Cloudflare challenge ("Just a moment...") with protection on, and still with protection off afterwards. |

## Known undercount

The 98.2% above is a lower bound. On these sites a blocked session recorder was
reported as not blocked, because it loads with `fetch`, which the version used for this crawl
didn't track. The extension now does.

| Site | Follow-up |
|---|---|
| microsoft.com | Microsoft Clarity requests failed with ERR_BLOCKED_BY_CLIENT: blocked, but loaded via fetch, so v0.3.0 reported it as not blocked. Fixed in the extension afterwards. |
| skype.com | Same Microsoft Clarity loading pattern as microsoft.com. |
| intuit.com | FullStory reported as not blocked; likely the same fetch-based loading. |

## Method and limits

- Homepage, wait for load + 3 s, scroll to bottom, wait 2.5 s. Pass 1 detection only; pass 2 with protection on everywhere.
- Homepages only: logins, checkouts and article pages often fingerprint more.
- One visit per site from one location; results vary with region, consent banners and time.
- Sites can detect automated browsers and behave differently. The crawler uses a normal Chrome user agent.
- Detection covers the techniques in [the README](../README.md#what-it-catches); anything else isn't counted.
- Bot protection: repeated automated visits get challenged; a few sites blocked the crawler outright.
- Raw data: [`data/crawl-2026-10-09.json`](../data/crawl-2026-10-09.json); follow-up checks: [`data/crawl-2026-10-09.notes.json`](../data/crawl-2026-10-09.notes.json).
