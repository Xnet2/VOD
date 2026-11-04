// vodos-media — מביא קבצי וידאו מאתרי המקור עבור האתר, כדי שהדפדפן יוכל לערוך אותם
// (להוסיף בסוף טשטוש ולוגו) לפני ההורדה. אתרי המקור לא שולחים כותרות CORS, ולכן הדפדפן
// לא מרשה לאתר לקרוא את הקבצים ישירות.
//
// שימוש: GET https://vodos-media.<subdomain>.workers.dev/?url=<כתובת הסרטון>
// מותר רק לקבצים מהאתרים שברשימה, ורק לאתר VODOS (ובדיקות מקומיות).
//
// בנוסף, כל 10 דקות (cron ב-wrangler.toml) הוא מביא סרטונים חדשים מכל המקורות שב-SOURCES
// ושולח אותם לטבלה דרך ה-Apps Script הקיים — באותו פורמט שהתוסף "פלאש-פוש" שולח,
// כך שזה עובד גם כשהמחשב כבוי, והטבלה מדלגת על מה שכבר קיים.
// המפתח של ה-Apps Script שמור כסוד: wrangler secret put APPS_SCRIPT_KEY

const ALLOWED_HOSTS = new Set(['stream.hagizra.news', 'cdn.thechats.click']);
const ALLOWED_ORIGINS = [/^https:\/\/xnet2\.github\.io$/, /^https:\/\/vodos\.i0527685490\.workers\.dev$/,/^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];

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

// ================= מקורות הסרטונים → הטבלה =================
const UA = { 'User-Agent': 'VODOS/1.0 (+https://xnet2.github.io/VOD/)' };

async function getJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(new URL(url).hostname + ' ' + res.status);
  return res.json();
}

// ---- התדר (hateder.net): הפרגוד, הפרגוד מיוזיק ----
const HATEDER = {
  pargod: {
    name: 'הפרגוד', link: 'https://hateder.net/pargod',
    avatar: 'https://play-lh.googleusercontent.com/fSnPR2dasoQYNsodYKYZIbdS6FmaHCj2tej7yLtbD27EEJJd4K1BlEANFjg2ine8X2JdNtxnhkkACod8V62Q9g=w480-h960-rw',
  },
  pargodmusic: {
    name: 'הפרגוד מיוזיק', link: 'https://hateder.net/pargodmusic',
    avatar: 'https://media.hateder.net/image/2026/09/5b28a8a4f17b2117fcb9e487.png',
  },
};

export function hatederRow(source, v) {
  const s = HATEDER[source];
  return {
    vodUid: source + ':' + v.id, videoUrl: v.url, source, sourceName: s.name,
    avatar: s.avatar, text: v.text || '', timestamp: v.ts || '', link: s.link,
  };
}

// עמוד אחד (8 סרטונים); before = המזהה הכי ישן שכבר נלקח
export async function fetchHateder(source, before) {
  const j = await getJson('https://hateder.net/api/videos?source=' + source + (before ? '&before=' + before : ''));
  return { videos: (j.videos || []).filter(v => v && v.url), more: !!j.more };
}

async function hatederRows(source, pages = 2) {
  let before = '', all = [];
  for (let i = 0; i < pages; i++) {
    const { videos, more } = await fetchHateder(source, before);
    all = all.concat(videos);
    if (!more || !videos.length) break;
    before = videos[videos.length - 1].id;
  }
  return all.map(v => hatederRow(source, v));
}

// ---- הגיזרה (hagizra.news) — אותו פירוק כמו בתוסף ----
const HAGIZRA = { origin: 'https://hagizra.news', avatar: 'https://stream.hagizra.news/2372e00f8639/STK-20260605-WA0078.webp' };

export function hagizraRows(messages) {
  const rows = [];
  for (const msg of messages || []) {
    let body = String(msg.text || '');
    const quote = body.match(/^\[quote-embedded#\]\((\d+)@([\s\S]*?)\)\n\n([\s\S]*)$/);
    if (quote) body = quote[3];
    const videos = [];
    body = body.replace(/\[image-embedded#\]\(([^#)]+)#[^)]*\)/g, () => '');
    body = body.replace(/\[video-embedded#\]\(([^#)]+)#[^)]*\)/g, (m, url) => { videos.push(url); return ''; });
    videos.forEach((url, i) => rows.push({
      vodUid: `hagizra:${msg.id}::${i}`, videoUrl: url, source: 'hagizra', sourceName: 'הגיזרה',
      avatar: HAGIZRA.avatar, text: body.trim(), timestamp: msg.timestamp, link: HAGIZRA.origin,
    }));
  }
  return rows;
}

async function hagizra() {
  const j = await getJson(HAGIZRA.origin + '/api/v2/messages?offset=0&limit=40&direction=desc');
  return hagizraRows(j.messages);
}

// ---- החתול השחור (black-cat.thechats.click) — אותו פירוק כמו בתוסף ----
const BLACKCAT = { origin: 'https://black-cat.thechats.click', avatar: 'https://black-cat.thechats.click/api/files/a282306b024604fd12d73f64c809310319ee0bcc' };

export function blackcatRows(list) {
  const rows = [];
  for (const msg of Array.isArray(list) ? list : []) {
    if (!msg || msg.deleted) continue;
    let body = String(msg.text || '');
    const videos = [];
    body = body.replace(/\[image-embedded#\]\(([^)]+)\)/g, () => '');
    body = body.replace(/\[video-embedded#\]\(([^)]+)\)/g, (m, url) => { videos.push(url); return ''; });
    body = body.replace(/\[audio-embedded#\]\(([^)]+)\)/g, '');
    if (msg.file && msg.file.url && /^(mp4|mov|webm|m4v)$/i.test(msg.file.filetype || '')) videos.push(msg.file.url);
    videos.forEach((url, i) => rows.push({
      vodUid: `blackcat:${msg.id}::${i}`, videoUrl: url, source: 'blackcat', sourceName: 'החתול השחור',
      avatar: BLACKCAT.avatar, text: body.trim(), timestamp: msg.timestamp, link: BLACKCAT.origin,
    }));
  }
  return rows;
}

async function blackcat() {
  return blackcatRows(await getJson(BLACKCAT.origin + '/api/messages'));
}

// כל המקורות שה-cron מושך. מקור שנכשל לא עוצר את האחרים.
export const SOURCES = {
  hagizra,
  blackcat,
  pargod: () => hatederRows('pargod'),
  pargodmusic: () => hatederRows('pargodmusic'),
};

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

export async function syncAll(env) {
  const results = await Promise.allSettled(Object.entries(SOURCES).map(async ([name, get]) => [name, await get()]));
  const rows = [], summary = {};
  results.forEach((r, i) => {
    const name = Object.keys(SOURCES)[i];
    if (r.status === 'fulfilled') { rows.push(...r.value[1]); summary[name] = r.value[1].length; }
    else summary[name] = 'error: ' + (r.reason && r.reason.message);
  });
  const out = await pushToSheet(env, rows); // ה-Apps Script מדלג על מה שכבר קיים
  console.log('sync', JSON.stringify(summary), 'added', out.added);
  return { ...out, summary };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncAll(env));
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
