// vodos-media — מביא קבצי וידאו מאתרי המקור עבור האתר, כדי שהדפדפן יוכל לערוך אותם
// (להוסיף בסוף טשטוש ולוגו) לפני ההורדה. אתרי המקור לא שולחים כותרות CORS, ולכן הדפדפן
// לא מרשה לאתר לקרוא את הקבצים ישירות.
//
// שימוש: GET https://vodos-media.<subdomain>.workers.dev/?url=<כתובת הסרטון>
// מותר רק לקבצים מהאתרים שברשימה, ורק לאתר VODOS (ובדיקות מקומיות).
//
// בנוסף, כל 10 דקות (cron ב-wrangler.toml) הוא מביא את הסרטונים החדשים של "הפרגוד"
// מ-hateder.net ושולח אותם לטבלה דרך ה-Apps Script הקיים — בדיוק כמו שהתוסף שולח.
// המפתח של ה-Apps Script שמור כסוד: wrangler secret put APPS_SCRIPT_KEY

const ALLOWED_HOSTS = new Set(['stream.hagizra.news', 'cdn.thechats.click']);
const ALLOWED_ORIGINS = [/^https:\/\/xnet2\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];

function cors(origin) {
  const ok = ALLOWED_ORIGINS.some(re => re.test(origin || ''));
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'https://xnet2.github.io',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function fail(status, message, origin) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin) },
  });
}

// ---- הפרגוד (hateder.net) → הטבלה ----
const PARGOD = {
  api: 'https://hateder.net/api/videos?source=pargod',
  link: 'https://hateder.net/pargod',
  name: 'הפרגוד',
  avatar: 'https://play-lh.googleusercontent.com/fSnPR2dasoQYNsodYKYZIbdS6FmaHCj2tej7yLtbD27EEJJd4K1BlEANFjg2ine8X2JdNtxnhkkACod8V62Q9g=w480-h960-rw',
};

export function pargodRow(v) {
  return {
    vodUid: 'pargod:' + v.id, videoUrl: v.url, source: 'pargod', sourceName: PARGOD.name,
    avatar: PARGOD.avatar, text: v.text || '', timestamp: v.ts || '', link: PARGOD.link,
  };
}

// מביא עמוד אחד (8 סרטונים) מהאתר; before = המזהה הכי ישן שכבר נלקח
export async function fetchPargod(before) {
  const res = await fetch(PARGOD.api + (before ? '&before=' + before : ''), { headers: { 'User-Agent': 'VODOS/1.0 (+https://xnet2.github.io/VOD/)' } });
  if (!res.ok) throw new Error('hateder ' + res.status);
  const j = await res.json();
  return { videos: (j.videos || []).filter(v => v && v.url), more: !!j.more };
}

export async function pushToSheet(env, videos) {
  if (!videos.length) return { added: 0 };
  const res = await fetch(env.APPS_SCRIPT_URL + '?key=' + encodeURIComponent(env.APPS_SCRIPT_KEY), {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({ videos }), redirect: 'follow',
  });
  const j = await res.json().catch(() => ({ ok: false, error: 'bad response ' + res.status }));
  if (!j.ok) throw new Error('sheet: ' + j.error);
  return j;
}

async function syncPargod(env, pages = 2) {
  let before = '', all = [];
  for (let i = 0; i < pages; i++) {
    const { videos, more } = await fetchPargod(before);
    all = all.concat(videos);
    if (!more || !videos.length) break;
    before = videos[videos.length - 1].id;
  }
  const out = await pushToSheet(env, all.map(pargodRow)); // ה-Apps Script מדלג על מה שכבר קיים
  console.log('pargod sync', all.length, 'fetched,', out.added, 'added');
  return out;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncPargod(env));
  },

  async fetch(request) {
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'method not allowed', origin);

    const raw = new URL(request.url).searchParams.get('url');
    if (!raw) return fail(400, 'missing url', origin);
    let target;
    try { target = new URL(raw); } catch { return fail(400, 'bad url', origin); }
    if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) return fail(403, 'host not allowed', origin);

    const headers = {};
    const range = request.headers.get('Range');
    if (range) headers.Range = range;
    const upstream = await fetch(target.toString(), {
      method: request.method, headers, redirect: 'follow',
      cf: { cacheEverything: true, cacheTtl: 86400 },
    });
    if (!upstream.ok && upstream.status !== 206) return fail(upstream.status, 'upstream ' + upstream.status, origin);

    const out = new Headers(cors(origin));
    for (const h of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'Last-Modified', 'ETag']) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    out.set('Cache-Control', 'public, max-age=86400');
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
