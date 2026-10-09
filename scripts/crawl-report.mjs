// Turns the newest data/crawl-*.json into:
//   src/data/crawl-stats.json   compact stats the extension ships (popup comparison, Findings page)
//   docs/findings.md            a readable write-up for the repository
// Usage: node scripts/crawl-report.mjs [data/crawl-YYYY-MM-DD.json]
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { summarize } from '../src/shared/crawlstats.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const file = process.argv[2] ?? `data/${(await readdir(root + 'data')).filter(f => /^crawl-[\d-]+\.json$/.test(f)).sort().pop()}`;
const crawl = JSON.parse(await readFile(root + file, 'utf8'));
const notesFile = file.replace(/\.json$/, '.notes.json');
const notes = await readFile(root + notesFile, 'utf8').then(JSON.parse, () => ({}));
const s = summarize(crawl, notes);

await mkdir(root + 'src/data', { recursive: true });
await writeFile(root + 'src/data/crawl-stats.json', JSON.stringify(s) + '\n');

const pct = n => `${n}%`;
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
const m = crawl.meta;
const md = `# Fingerprinting on the web's top ${s.sites} sites

Measured ${m.date} with What Sites See ${m.extensionVersion} in ${m.browser}, on the homepages of the
first ${s.sites} working sites of the [Tranco](https://tranco-list.eu/) research list (list \`${m.tranco}\`).
${crawl.skipped.length} domains ranked among them were skipped because they didn't load a web page
(CDNs, APIs, ad and DNS infrastructure, and a few that blocked the crawler).

## Headline numbers

- **Median score: ${s.median}/100.** ${pct(Math.round(((s.grades.moderate + s.grades.heavy) / s.sites) * 100))} of sites actively fingerprinted visitors (score 25+), ${pct(Math.round((s.grades.heavy / s.sites) * 100))} heavily (60+).
- **Median ${s.medianThirdParties} other companies' domains contacted** by a homepage.
- **With protection on, ${pct(s.protection.stoppedShare)} of the fingerprinting attempts it's designed for were stopped** (${s.protection.attempts} attempts), across all ${s.sites} sites.
- **${s.protection.possibleBreakage.length ? `${s.protection.possibleBreakage.length} site${s.protection.possibleBreakage.length === 1 ? '' : 's'} showed possible breakage` : 'No site showed signs of breaking'}** with protection on${s.protection.botChallenges.length ? `; ${s.protection.botChallenges.length} returned bot-check pages instead, also seen without protection (details below)` : ''}.

A note on keystroke listeners: half the sites let another company's script listen to every key
on the page. Analytics libraries often do this to measure engagement; the extension can see the
listener, not what the script does with what it hears.

## How often each technique was used

${table(['Technique', 'Sites', 'By a third party'], s.techniques.map(t => [t.title, pct(t.share), pct(t.thirdParty)]))}

## Companies seen

${s.vendors.length ? table(['Company', 'Sites'], s.vendors.map(v => [v.name, pct(v.share)])) : 'None of the session-recording, fingerprinting or fraud-detection companies the extension tracks appeared.'}

## Highest scores

${table(['Site', 'Tranco rank', 'Score', 'Techniques'], s.top.map(t => [t.domain, t.rank, t.score, t.techniques]))}

## Possible breakage with protection on

${s.protection.possibleBreakage.length
    ? table(['Site', 'What changed'], s.protection.possibleBreakage.map(b => [b.domain, b.reasons.join('; ')]))
    : 'None detected.'}

These are automatic flags, not confirmed breakage: busy homepages change between visits (rotating ads,
A/B tests), so new errors or a smaller page can have nothing to do with protection.

## Bot checks

${s.protection.botChallenges.length ? `These sites served a bot-protection page instead of the site during the protected pass. In
follow-up checks the same pages appeared with protection off, so they're counted as the crawler
being flagged (repeated automated visits from one address), not as breakage. Whether protection
contributed to the first challenge can't be separated after the fact.

${table(['Site', 'Follow-up'], s.protection.botChallenges.map(b => [b.domain, b.note]))}` : 'None.'}
${s.protection.notDetectedAsBlocked.length ? `
## Known undercount

The ${s.protection.stoppedShare}% above is a lower bound. On these sites a blocked session recorder was
reported as not blocked, because it loads with \`fetch\`, which the version used for this crawl
didn't track. The extension now does.

${table(['Site', 'Follow-up'], s.protection.notDetectedAsBlocked.map(b => [b.domain, b.note]))}` : ''}

## Method and limits

- ${m.method}
- Homepages only: logins, checkouts and article pages often fingerprint more.
- One visit per site from one location; results vary with region, consent banners and time.
- Sites can detect automated browsers and behave differently. The crawler uses a normal Chrome user agent.
- Detection covers the techniques in [the README](../README.md#what-it-catches); anything else isn't counted.
- Bot protection: repeated automated visits get challenged; a few sites blocked the crawler outright.
- Raw data: [\`${file}\`](../${file})${notes.about ? `; follow-up checks: [\`${notesFile}\`](../${notesFile})` : ''}.
`;
await mkdir(root + 'docs', { recursive: true });
await writeFile(root + 'docs/findings.md', md);
console.log(`wrote src/data/crawl-stats.json and docs/findings.md from ${file}`);
