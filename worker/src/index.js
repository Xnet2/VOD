// vodos-media — מביא קבצי וידאו מאתרי המקור עבור האתר, כדי שהדפדפן יוכל לערוך אותם
// (להוסיף בסוף טשטוש ולוגו) לפני ההורדה. אתרי המקור לא שולחים כותרות CORS, ולכן הדפדפן
// לא מרשה לאתר לקרוא את הקבצים ישירות.
//
// שימוש: GET https://vodos-media.<subdomain>.workers.dev/?url=<כתובת הסרטון>
// מותר רק לקבצים מהאתרים שברשימה, ורק לאתר VODOS (ובדיקות מקומיות).

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

export default {
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
