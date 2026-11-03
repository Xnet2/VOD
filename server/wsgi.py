# VODOS API — לייקים ותגובות לאתר https://xnet2.github.io/VOD/
# קובץ WSGI ל-PythonAnywhere (metailim.pythonanywhere.com). ספרייה סטנדרטית בלבד, בלי התקנות.
#
# הכתובת הראשית "/" ממשיכה לעבוד כמו היום: היא מוגשת ע"י ה-Static files של PythonAnywhere
# (דף ההפניה ל-xnet2.github.io/da), ואם אי פעם המיפוי הזה יוסר — הקובץ הזה מפנה לשם בעצמו.
#
# נקודות קצה (כולן תחת /vod/):
#   GET  /vod/health                          → בדיקה שהשרת חי
#   GET  /vod/stats?ids=a,b,c&client=X        → ספירת לייקים ותגובות + אילו סרטונים המשתמש כבר אהב
#   POST /vod/like      {"id","client","on"}  → לייק / ביטול לייק (משתמש אחד = לייק אחד לסרטון)
#   GET  /vod/comments?id=X                   → התגובות לסרטון, מהחדשה לישנה
#   POST /vod/comments  {"id","client","name","text"} → הוספת תגובה

import json
import os
import re
import sqlite3
import time
from urllib.parse import parse_qs

DB_PATH = os.path.join(os.path.expanduser('~'), 'vod.db')
HOME_REDIRECT = 'https://xnet2.github.io/da/'
MAX_TEXT = 500
MAX_NAME = 30
MAX_IDS = 100
COMMENT_COOLDOWN = 8  # שניות בין תגובות מאותו משתמש / IP

EMOJI_RE = re.compile('[\U0001F000-\U0001FAFF☀-➿⬀-⯿]')
LINK_RE = re.compile(r'(https?://|www\.|\b[\w-]+\.(com|co\.il|net|org|io|me|click|link|ly|info)\b)', re.I)

_db = None


def db():
    global _db
    if _db is None:
        _db = sqlite3.connect(DB_PATH, timeout=10, check_same_thread=False)
        _db.executescript('''
            CREATE TABLE IF NOT EXISTS likes (
                vid TEXT NOT NULL, client TEXT NOT NULL, ts INTEGER NOT NULL,
                PRIMARY KEY (vid, client));
            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                vid TEXT NOT NULL, client TEXT NOT NULL, ip TEXT,
                name TEXT NOT NULL, text TEXT NOT NULL, ts INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS comments_vid ON comments (vid, id);
        ''')
    return _db


def clean(value, limit):
    return re.sub(r'\s+', ' ', str(value or '')).strip()[:limit]


def param(query, name, limit=300):
    return clean(query.get(name, [''])[0], limit)


# ---------------- handlers ----------------

def stats(query):
    ids = [i for i in query.get('ids', [''])[0].split(',') if i][:MAX_IDS]
    client = param(query, 'client', 64)
    likes = {i: 0 for i in ids}
    comments = {i: 0 for i in ids}
    mine = []
    if ids:
        marks = ','.join('?' * len(ids))
        c = db()
        for vid, n in c.execute(f'SELECT vid, COUNT(*) FROM likes WHERE vid IN ({marks}) GROUP BY vid', ids):
            likes[vid] = n
        for vid, n in c.execute(f'SELECT vid, COUNT(*) FROM comments WHERE vid IN ({marks}) GROUP BY vid', ids):
            comments[vid] = n
        if client:
            mine = [r[0] for r in c.execute(f'SELECT vid FROM likes WHERE client = ? AND vid IN ({marks})', [client] + ids)]
    return 200, {'ok': True, 'likes': likes, 'comments': comments, 'mine': mine}


def like(body):
    vid = clean(body.get('id'), 300)
    client = clean(body.get('client'), 64)
    on = bool(body.get('on'))
    if not vid or not client:
        return 400, {'ok': False, 'error': 'missing id/client'}
    c = db()
    with c:
        if on:
            c.execute('INSERT OR IGNORE INTO likes (vid, client, ts) VALUES (?, ?, ?)', (vid, client, int(time.time())))
        else:
            c.execute('DELETE FROM likes WHERE vid = ? AND client = ?', (vid, client))
    count = c.execute('SELECT COUNT(*) FROM likes WHERE vid = ?', (vid,)).fetchone()[0]
    return 200, {'ok': True, 'id': vid, 'count': count, 'liked': on}


def list_comments(query):
    vid = param(query, 'id')
    if not vid:
        return 400, {'ok': False, 'error': 'missing id'}
    rows = db().execute(
        'SELECT id, name, text, ts FROM comments WHERE vid = ? ORDER BY id DESC LIMIT 200', (vid,)).fetchall()
    return 200, {'ok': True, 'comments': [{'id': r[0], 'name': r[1], 'text': r[2], 'ts': r[3]} for r in rows]}


def add_comment(body, ip):
    vid = clean(body.get('id'), 300)
    client = clean(body.get('client'), 64)
    name = clean(body.get('name'), MAX_NAME) or 'אורח'
    text = clean(body.get('text'), MAX_TEXT)
    if not vid or not client or not text:
        return 400, {'ok': False, 'error': 'missing fields'}
    # אותו כלל כמו בפיד: בלי קישורים ובלי יותר מ-2 אימוג'ים (מונע ספאם ופרסום)
    if LINK_RE.search(text) or LINK_RE.search(name) or len(EMOJI_RE.findall(text)) > 2:
        return 400, {'ok': False, 'error': 'blocked', 'message': "תגובות עם קישורים או עם יותר מ-2 אימוג'ים לא מתפרסמות"}
    c = db()
    now = int(time.time())
    if ip:
        last = c.execute('SELECT MAX(ts) FROM comments WHERE client = ? OR ip = ?', (client, ip)).fetchone()[0]
    else:
        last = c.execute('SELECT MAX(ts) FROM comments WHERE client = ?', (client,)).fetchone()[0]
    if last and now - last < COMMENT_COOLDOWN:
        return 429, {'ok': False, 'error': 'too fast', 'message': 'אפשר להגיב שוב בעוד כמה שניות'}
    with c:
        cur = c.execute('INSERT INTO comments (vid, client, ip, name, text, ts) VALUES (?, ?, ?, ?, ?, ?)',
                        (vid, client, ip, name, text, now))
    return 200, {'ok': True, 'comment': {'id': cur.lastrowid, 'name': name, 'text': text, 'ts': now}}


# ---------------- WSGI plumbing ----------------

CORS = [
    ('Access-Control-Allow-Origin', '*'),
    ('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'),
    ('Access-Control-Allow-Headers', 'Content-Type'),
    ('Access-Control-Max-Age', '86400'),
]
STATUS = {200: '200 OK', 204: '204 No Content', 400: '400 Bad Request', 404: '404 Not Found',
          405: '405 Method Not Allowed', 429: '429 Too Many Requests', 500: '500 Internal Server Error'}


def read_json(environ):
    try:
        size = min(int(environ.get('CONTENT_LENGTH') or 0), 10000)
    except ValueError:
        size = 0
    raw = environ['wsgi.input'].read(size) if size else b''
    try:
        data = json.loads(raw.decode('utf-8') or '{}')
    except ValueError:
        data = {}
    return data if isinstance(data, dict) else {}


def api(environ, route, method):
    if method == 'OPTIONS':
        return 204, None
    query = parse_qs(environ.get('QUERY_STRING', ''))
    ip = (environ.get('HTTP_X_REAL_IP') or environ.get('REMOTE_ADDR') or '')[:64]
    if route == 'health':
        return 200, {'ok': True}
    if route == 'stats' and method == 'GET':
        return stats(query)
    if route == 'like' and method == 'POST':
        return like(read_json(environ))
    if route == 'comments' and method == 'GET':
        return list_comments(query)
    if route == 'comments' and method == 'POST':
        return add_comment(read_json(environ), ip)
    return 404, {'ok': False, 'error': 'not found'}


def application(environ, start_response):
    path = environ.get('PATH_INFO') or '/'
    method = environ.get('REQUEST_METHOD', 'GET').upper()

    if path.startswith('/vod/'):
        try:
            code, payload = api(environ, path[len('/vod/'):].strip('/'), method)
        except Exception as err:  # noqa — תמיד להחזיר JSON עם כותרות CORS
            code, payload = 500, {'ok': False, 'error': str(err)}
        body = b'' if payload is None else json.dumps(payload, ensure_ascii=False).encode('utf-8')
        headers = CORS + [('Cache-Control', 'no-store'), ('Content-Length', str(len(body)))]
        if payload is not None:
            headers.append(('Content-Type', 'application/json; charset=utf-8'))
        start_response(STATUS.get(code, '500 Internal Server Error'), headers)
        return [body]

    if path == '/':
        # גיבוי בלבד — בפועל "/" מוגש מה-Static files ומפנה לאתר "דרך הארץ"
        qs = environ.get('QUERY_STRING', '')
        start_response('302 Found', [('Location', HOME_REDIRECT + ('?' + qs if qs else '')), ('Content-Length', '0')])
        return [b'']

    content = b'Page not found.'
    start_response('404 NOT FOUND', [('Content-Type', 'text/html'), ('Content-Length', str(len(content)))])
    return [content]
