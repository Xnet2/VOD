// ==== הגדרות — שנה לפני הפריסה ====
const API_KEY = 'CHANGE_ME'; // השאר כאן את המפתח הסודי שלך (אל תעלה אותו לגיטהאב)
const SHEET_NAME = 'Videos';
const PUBLIC_READ = true; // true = האתר יכול לקרוא סרטונים (GET) בלי מפתח. כתיבה (POST) תמיד דורשת מפתח

const HEADERS = ['vodUid', 'videoUrl', 'source', 'sourceName', 'avatar', 'text', 'timestamp', 'link', 'addedAt', 'poster'];

// ---- מקורות חיצוניים לשאיבה אוטומטית ----
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; VOD-Archiver/1.0)' };
const SOURCES = {
  jdn: { name: 'JDN', avatar: 'https://www.jdn.co.il/wp-content/uploads/2022/01/logosite-150x150.png', api: 'https://www.jdn.co.il/wp-json/wp/v2/posts?categories=19&per_page=30&_fields=id,date,link,title,content,jetpack_featured_media_url' },
  hm: { name: 'המחדש', avatar: 'https://hm-news.co.il/wp-content/uploads/2026/06/cropped-hm-icon-1-192x192.png', api: 'https://hm-news.co.il/wp-json/wp/v2/posts?categories=513&per_page=30&_embed=wp:featuredmedia', home: 'https://hm-news.co.il/' }
};

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  // גיליון ישן בלי עמודת poster — מוסיף את הכותרת החסרה
  else if (sheet.getRange(1, HEADERS.length).getValue() !== HEADERS[HEADERS.length - 1]) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  return sheet;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function checkKey_(key) {
  return key === API_KEY;
}

// מוסיף לגיליון רק סרטונים שעדיין לא קיימים (dedup לפי videoUrl). מחזיר כמה נוספו
function addVideos_(videos) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_();
    const lastRow = sheet.getLastRow();
    const existingUrls = new Set();
    if (lastRow > 1) {
      const urlCol = sheet.getRange(2, 2, lastRow - 1, 1).getValues(); // עמודה B = videoUrl
      urlCol.forEach((r) => { if (r[0]) existingUrls.add(String(r[0])); });
    }

    const now = new Date().toISOString();
    const newRows = [];
    videos.forEach((v) => {
      if (!v || !v.videoUrl || existingUrls.has(v.videoUrl)) return;
      existingUrls.add(v.videoUrl);
      newRows.push([
        v.vodUid || '', v.videoUrl, v.source || '', v.sourceName || '',
        v.avatar || '', v.text || '', v.timestamp || '', v.link || '', now, v.poster || ''
      ]);
    });

    if (newRows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, HEADERS.length).setValues(newRows);
    }
    return newRows.length;
  } finally {
    lock.releaseLock();
  }
}

// ---- POST: מקבל מערך סרטונים ומוסיף לגיליון ----
function doPost(e) {
  try {
    const key = (e.parameter && e.parameter.key) || '';
    if (!checkKey_(key)) return jsonOut_({ ok: false, error: 'unauthorized' });

    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    const videos = Array.isArray(body.videos) ? body.videos : [];
    if (!videos.length) return jsonOut_({ ok: true, added: 0 });
    return jsonOut_({ ok: true, added: addVideos_(videos) });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

// ---- GET: מחזיר סרטונים מהארכיון ----
// פרמטרים: mode=random (ברירת מחדל) | latest, limit (עד 200), offset (ל-latest), source (jdn / hm / ...), action=scrape (דורש key)
function doGet(e) {
  try {
    const p = e.parameter || {};
    const key = p.key || '';
    if (p.action === 'scrape') {
      if (!checkKey_(key)) return jsonOut_({ ok: false, error: 'unauthorized' });
      return jsonOut_(Object.assign({ ok: true }, scrapeAll()));
    }
    if (!PUBLIC_READ && !checkKey_(key)) return jsonOut_({ ok: false, error: 'unauthorized' });

    const limit = Math.min(parseInt(p.limit, 10) || 30, 200);
    const offset = Math.max(parseInt(p.offset, 10) || 0, 0);
    const sheet = getSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return jsonOut_({ ok: true, videos: [], total: 0 });

    let rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
    if (p.source) rows = rows.filter((r) => String(r[2]) === p.source);

    if (p.mode === 'latest') {
      const t = (r) => Date.parse(r[6] instanceof Date ? r[6].toISOString() : r[6]) || Date.parse(r[8]) || 0;
      rows.sort((a, b) => t(b) - t(a));
      rows = rows.slice(offset, offset + limit);
    } else {
      // ערבוב Fisher-Yates ובחירת limit הראשונים — מדגם אקראי
      for (let i = rows.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = rows[i]; rows[i] = rows[j]; rows[j] = tmp;
      }
      rows = rows.slice(0, limit);
    }

    const iso = (x) => (x instanceof Date ? x.toISOString() : x);
    const picked = rows.map((r) => ({
      vodUid: r[0], videoUrl: r[1], source: r[2], sourceName: r[3],
      avatar: r[4], text: r[5], timestamp: iso(r[6]), link: r[7], poster: r[9] || ''
    }));
    return jsonOut_({ ok: true, videos: picked, total: lastRow - 1 });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

// =====================================================================
//  שאיבה אוטומטית מ-JDN ומהמחדש
//  הרץ פעם אחת את installTrigger() מתוך העורך — מכאן זה ירוץ כל 30 דקות
// =====================================================================

function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'scrapeAll')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('scrapeAll').timeBased().everyMinutes(30).create();
  scrapeAll();
}

function scrapeAll() {
  const result = {};
  [['jdn', scrapeJdn_], ['hm', scrapeHm_], ['hmStories', scrapeHmStories_]].forEach(([name, fn]) => {
    try {
      const videos = fn();
      result[name] = { found: videos.length, added: addVideos_(videos) };
    } catch (err) {
      result[name] = { error: String(err) };
    }
  });
  console.log(JSON.stringify(result));
  return result;
}

function fetchText_(url) {
  const res = UrlFetchApp.fetch(url, { headers: UA, muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error(url + ' → HTTP ' + res.getResponseCode());
  return res.getContentText();
}

function decodeHtml_(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#038;|&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').trim();
}

// קובץ וידאו ישיר מתוך תוכן הכתבה (<video src> או <source src>)
function findDirectVideo_(html) {
  const m = html.match(/<(?:video|source)\b[^>]*\ssrc="([^"]+\.(?:mp4|m3u8|webm)[^"]*)"/i);
  return m ? decodeHtml_(m[1]) : '';
}

function findPoster_(html) {
  const m = html.match(/<video\b[^>]*\sposter="([^"]+)"/i);
  return m ? decodeHtml_(m[1]) : '';
}

// ---- JDN: קטגוריית "וידאו" ----
function scrapeJdn_() {
  const src = SOURCES.jdn;
  const posts = JSON.parse(fetchText_(src.api));
  const out = [];
  posts.forEach((p) => {
    const html = (p.content && p.content.rendered) || '';
    const videoUrl = findDirectVideo_(html);
    if (!videoUrl) return;
    out.push({
      vodUid: 'jdn-' + p.id, videoUrl: videoUrl, source: 'jdn', sourceName: src.name, avatar: src.avatar,
      text: decodeHtml_(p.title && p.title.rendered), timestamp: p.date, link: p.link,
      poster: findPoster_(html) || p.jetpack_featured_media_url || ''
    });
  });
  return out;
}

// מאתר את כתובת ה-CDN של ספריית Bunny (נשמר במטמון כדי לא לחפש שוב)
function bunnyHost_(libraryId, guid) {
  const props = PropertiesService.getScriptProperties();
  const cacheKey = 'bunny_' + libraryId;
  let host = props.getProperty(cacheKey);
  if (host) return host;
  const html = fetchText_('https://iframe.mediadelivery.net/embed/' + libraryId + '/' + guid);
  const m = html.match(/https:\/\/(vz-[a-z0-9-]+\.b-cdn\.net)/i);
  if (!m) return '';
  host = m[1];
  props.setProperty(cacheKey, host);
  return host;
}

// ---- המחדש: קטגוריית "וידאו" (נגן Bunny או קובץ ישיר) ----
function scrapeHm_() {
  const src = SOURCES.hm;
  const posts = JSON.parse(fetchText_(src.api));
  const out = [];
  posts.forEach((p) => {
    const html = (p.content && p.content.rendered) || '';
    let videoUrl = '', uid = 'hm-' + p.id;
    const bunny = html.match(/iframe\.mediadelivery\.net\/(?:embed|play)\/(\d+)\/([0-9a-f-]{36})/i);
    if (bunny) {
      const host = bunnyHost_(bunny[1], bunny[2]);
      if (host) { videoUrl = 'https://' + host + '/' + bunny[2] + '/playlist.m3u8'; uid = bunny[2]; }
    }
    if (!videoUrl) videoUrl = findDirectVideo_(html);
    if (!videoUrl) return;
    const media = p._embedded && p._embedded['wp:featuredmedia'] && p._embedded['wp:featuredmedia'][0];
    out.push({
      vodUid: uid, videoUrl: videoUrl, source: 'hm', sourceName: src.name, avatar: src.avatar,
      text: decodeHtml_(p.title && p.title.rendered), timestamp: p.date, link: p.link,
      poster: findPoster_(html) || (media && media.source_url) || ''
    });
  });
  return out;
}

// ---- המחדש: סטוריז מעמוד הבית (סרטונים אנכיים — מושלם לפיד) ----
function scrapeHmStories_() {
  const src = SOURCES.hm;
  const html = fetchText_(src.home);
  const out = [];
  const re = /<a\b[^>]*data-hm-story-card[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const attr = (n) => { const x = tag.match(new RegExp('\\s' + n + '="([^"]*)"', 'i')); return x ? decodeHtml_(x[1]) : ''; };
    const videoUrl = attr('data-video');
    if (!videoUrl) continue;
    const guid = (videoUrl.match(/([0-9a-f-]{36})/i) || [])[1];
    out.push({
      vodUid: guid || 'hm-story-' + attr('data-story-id'), videoUrl: videoUrl, source: 'hm', sourceName: src.name,
      avatar: src.avatar, text: attr('aria-label'), timestamp: new Date().toISOString(), link: attr('href'),
      poster: attr('data-poster')
    });
  }
  return out;
}
