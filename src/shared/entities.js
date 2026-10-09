// Domains owned by the same company. Large sites load their own code from separate domains
// (google.com from gstatic.com, facebook.com from fbcdn.net), which isn't a third party in any
// meaningful sense. Same idea as the Disconnect and DuckDuckGo entity lists, kept to major
// companies. Shared hosting (amazonaws.com, cloudfront.net, akamai) is deliberately absent:
// it serves many unrelated companies.
export const ENTITIES = {
  Google: ['google.com', 'gstatic.com', 'googleapis.com', 'googleusercontent.com', 'youtube.com', 'ytimg.com', 'googlevideo.com',
    'ggpht.com', 'google.co.uk', 'google.de', 'google.co.jp', 'google.fr', 'google.ca', 'google.com.br', 'google.co.in', 'gmail.com', 'blogger.com'],
  Meta: ['facebook.com', 'facebook.net', 'fbcdn.net', 'fbsbx.com', 'instagram.com', 'cdninstagram.com', 'whatsapp.com', 'whatsapp.net', 'threads.net', 'messenger.com'],
  Microsoft: ['microsoft.com', 'live.com', 'office.com', 'office.net', 'bing.com', 'msn.com', 'microsoftonline.com', 's-microsoft.com',
    'msecnd.net', 'msftauth.net', 'xbox.com', 'skype.com', 'azure.com', 'windows.com', 'linkedin.com', 'licdn.com', 'github.com',
    'githubassets.com', 'githubusercontent.com'],
  Amazon: ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.co.jp', 'amazon.in', 'media-amazon.com', 'ssl-images-amazon.com', 'primevideo.com', 'twitch.tv', 'ttvnw.net', 'jtvnw.net'],
  Apple: ['apple.com', 'icloud.com', 'cdn-apple.com', 'mzstatic.com', 'apple-cloudkit.com'],
  'X (Twitter)': ['twitter.com', 'x.com', 'twimg.com', 't.co'],
  Yahoo: ['yahoo.com', 'yimg.com', 'yahoo.co.jp', 'aol.com'],
  Netflix: ['netflix.com', 'nflxext.com', 'nflximg.net', 'nflxvideo.net', 'nflxso.net'],
  Wikimedia: ['wikipedia.org', 'wikimedia.org', 'wiktionary.org', 'wikidata.org'],
  Yandex: ['yandex.ru', 'yandex.com', 'yandex.net', 'yastatic.net', 'ya.ru'],
  VK: ['vk.com', 'userapi.com', 'mail.ru', 'imgsmail.ru', 'mycdn.me', 'ok.ru', 'dzen.ru', 'vk.ru'],
  Baidu: ['baidu.com', 'bdstatic.com', 'bdimg.com'],
  Alibaba: ['alibaba.com', 'alicdn.com', 'aliexpress.com', 'aliexpress.ru', 'taobao.com', 'tmall.com'],
  Tencent: ['qq.com', 'gtimg.cn', 'gtimg.com', 'wechat.com', 'weixin.qq.com'],
  ByteDance: ['tiktok.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'ttwstatic.com', 'byteoversea.com', 'tiktokv.com'],
  Reddit: ['reddit.com', 'redditstatic.com', 'redditmedia.com', 'redd.it'],
  Pinterest: ['pinterest.com', 'pinimg.com'],
  eBay: ['ebay.com', 'ebaystatic.com', 'ebayimg.com', 'ebay.co.uk', 'ebay.de'],
  Adobe: ['adobe.com', 'adobelogin.com', 'typekit.net', 'adobe.io'],
  Spotify: ['spotify.com', 'scdn.co', 'spotifycdn.com'],
  Zoom: ['zoom.us', 'zoom.com'],
  Cloudflare: ['cloudflare.com', 'cloudflareinsights.com'],
  Samsung: ['samsung.com', 'samsungcloud.com'],
};

const byDomain = new Map(Object.entries(ENTITIES).flatMap(([name, domains]) => domains.map(d => [d, name])));

// The owning company for a registrable domain, or null if it isn't one we know.
export const entityOf = site => byDomain.get(String(site || '').toLowerCase()) ?? null;
