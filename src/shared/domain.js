// "Same site" means same registrable domain (eTLD+1): news.example.com and cdn.example.com
// are one company, example.com and tracker.net are not. A full Public Suffix List is ~250 KB,
// so this keeps the common multi-part suffixes and hosting platforms where each subdomain
// belongs to a different owner.
const MULTI_PART = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'co.in', 'co.za', 'com.br', 'com.mx', 'com.ar',
  'com.cn', 'com.tw', 'com.hk', 'com.sg', 'com.tr', 'co.il',
  'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'vercel.app', 'netlify.app', 'web.app',
  'firebaseapp.com', 'herokuapp.com', 'appspot.com', 'azurewebsites.net', 'cloudfront.net',
  'blogspot.com', 'wordpress.com', 'onrender.com', 'fly.dev',
]);

export function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

export function siteOf(host) {
  host = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!host || /^[\d.]+$/.test(host) || host.includes(':')) return host; // IPv4, IPv6
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join('.');
  return MULTI_PART.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}

export function isThirdParty(host, pageHost) {
  return !!host && !!pageHost && siteOf(host) !== siteOf(pageHost);
}
