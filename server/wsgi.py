# VODOS API — לייקים ותגובות לאתר https://xnet2.github.io/VOD/
# קובץ WSGI ל-PythonAnywhere (metailim.pythonanywhere.com). ספרייה סטנדרטית בלבד, בלי התקנות.
#
# הכתובת הראשית "/" ממשיכה לעבוד כמו היום: היא מוגשת ע"י ה-Static files של PythonAnywhere
# (דף ההפניה ל-xnet2.github.io/da), ואם אי פעם המיפוי הזה יוסר — הקובץ הזה מפנה לשם בעצמו.
#
# נקודות קצה (כולן תחת /vod/). בקשות POST נשלחות כ-text/plain עם גוף JSON:
#   GET  /vod/health                            → בדיקה שהשרת חי (deep=1 בודק גם גישה לגוגל)
#   GET  /vod/stats?ids=a,b,c&client=X          → ספירת לייקים ותגובות + אילו סרטונים המשתמש כבר אהב
#   POST /vod/like       {id, client, on}       → לייק / ביטול לייק (בלי התחברות; דפדפן אחד = לייק אחד)
#   POST /vod/auth       {credential}           → התחברות עם Google (ID token) → מחזיר session
#   POST /vod/me         {session}              → מי מחובר, והאם הוא מנהל
#   POST /vod/logout     {session}
#   GET  /vod/comments?id=X                     → התגובות לסרטון, מהחדשה לישנה
#   POST /vod/comments   {session, id, text}    → הוספת תגובה (דורש התחברות)
#   POST /vod/comments/delete {session, cid}    → מחיקת תגובה (הכותב או מנהל)
#   POST /vod/admin/comments  {session, before} → כל התגובות האחרונות, לדף הניהול (מנהל בלבד)

import json
import os
import re
import secrets
import sqlite3
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote
from urllib.request import urlopen

# ==== הגדרות ====
GOOGLE_CLIENT_ID = '426523025549-7c50rkn7cun4vmm2r802u0ij6egjehtg.apps.googleusercontent.com'
# המיילים (חשבונות Google) שמותר להם למחוק כל תגובה ולהיכנס לדף הניהול
ADMIN_EMAILS = {
    # 'your.name@gmail.com',
}

DB_PATH = os.path.join(os.path.expanduser('~'), 'vod.db')
HOME_REDIRECT = 'https://xnet2.github.io/da/'
MAX_TEXT = 500
MAX_IDS = 100
COMMENT_COOLDOWN = 8               # שניות בין תגובות של אותו משתמש
SESSION_DAYS = 60

EMOJI_RE = re.compile('[\U0001F000-\U0001FAFF☀-➿⬀-⯿]')
LINK_RE = re.compile(r'(https?://|www\.|\b[\w-]+\.(com|co\.il|net|org|io|me|click|link|ly|info)\b)', re.I)


class ApiError(Exception):
    def __init__(self, code, error, message=None):
        super().__init__(error)
        self.code, self.error, self.message = code, error, message


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
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY, sub TEXT NOT NULL, email TEXT, name TEXT,
                picture TEXT, created INTEGER NOT NULL);
        ''')
        # שדרוג טבלת תגובות קיימת (מהגרסה בלי התחברות)
        cols = {r[1] for r in _db.execute('PRAGMA table_info(comments)')}
        for col in ('sub', 'picture'):
            if col not in cols:
                _db.execute(f'ALTER TABLE comments ADD COLUMN {col} TEXT')
        _db.commit()
    return _db


def clean(value, limit):
    return re.sub(r'\s+', ' ', str(value or '')).strip()[:limit]


def param(query, name, limit=300):
    return clean(query.get(name, [''])[0], limit)


def comment_json(row, me=None):
    cid, name, text, ts, picture, sub = row
    out = {'id': cid, 'name': name, 'text': text, 'ts': ts, 'picture': picture or ''}
    if me and (sub == me['sub'] or me['admin']):
        out['mine'] = True  # מותר למחוק
    return out


# ---------------- Google sign-in ----------------

def verify_google(credential):
    """בודק את ה-ID token מול Google ומחזיר את פרטי המשתמש."""
    try:
        with urlopen('https://oauth2.googleapis.com/tokeninfo?id_token=' + quote(credential), timeout=10) as r:
            info = json.load(r)
    except HTTPError:
        raise ApiError(401, 'invalid token', 'ההתחברות נכשלה, נסו שוב')
    except (URLError, OSError, ValueError):
        raise ApiError(502, 'google unreachable', 'אין כרגע חיבור לשרתי Google, נסו שוב בעוד רגע')
    if info.get('aud') != GOOGLE_CLIENT_ID:
        raise ApiError(401, 'wrong audience', 'ההתחברות נכשלה')
    if info.get('iss') not in ('accounts.google.com', 'https://accounts.google.com'):
        raise ApiError(401, 'wrong issuer', 'ההתחברות נכשלה')
    if int(info.get('exp') or 0) < time.time():
        raise ApiError(401, 'expired', 'ההתחברות פגה, נסו שוב')
    return info


def current_user(body):
    """מחזיר את המשתמש המחובר לפי session, או None."""
    token = clean(body.get('session'), 100)
    if not token:
        return None
    row = db().execute('SELECT sub, email, name, picture, created FROM sessions WHERE token = ?', (token,)).fetchone()
    if not row or row[4] < time.time() - SESSION_DAYS * 86400:
        return None
    sub, email, name, picture, _ = row
    return {'sub': sub, 'email': email or '', 'name': name or 'משתמש', 'picture': picture or '',
            'admin': (email or '').lower() in {e.lower() for e in ADMIN_EMAILS}}


def require_user(body):
    user = current_user(body)
    if not user:
        raise ApiError(401, 'login required', 'צריך להתחבר עם Google כדי להגיב')
    return user


def public_user(user):
    return {'name': user['name'], 'picture': user['picture'], 'admin': user['admin']}


# ---------------- handlers ----------------

def health(query):
    out = {'ok': True}
    if param(query, 'deep'):
        # בודק שהשרת יכול להגיע ל-Google (בחשבון חינמי יש רשימת אתרים מותרים)
        try:
            urlopen('https://oauth2.googleapis.com/tokeninfo?id_token=x', timeout=10)
            out['google'] = 'reachable'
        except HTTPError:
            out['google'] = 'reachable'  # 400 = הגענו, הטוקן פשוט לא תקין
        except (URLError, OSError) as err:
            out['google'] = 'unreachable: ' + str(err)
    return 200, out


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


def auth(body):
    credential = str(body.get('credential') or '')
    if not credential:
        return 400, {'ok': False, 'error': 'missing credential'}
    info = verify_google(credential)
    token = secrets.token_urlsafe(32)
    c = db()
    with c:
        c.execute('DELETE FROM sessions WHERE created < ?', (int(time.time()) - SESSION_DAYS * 86400,))
        c.execute('INSERT INTO sessions (token, sub, email, name, picture, created) VALUES (?, ?, ?, ?, ?, ?)',
                  (token, info['sub'], info.get('email', ''), clean(info.get('name') or info.get('given_name'), 60),
                   info.get('picture', ''), int(time.time())))
    return 200, {'ok': True, 'session': token, 'user': public_user(current_user({'session': token}))}


def me(body):
    user = current_user(body)
    return 200, {'ok': True, 'user': public_user(user) if user else None}


def logout(body):
    token = clean(body.get('session'), 100)
    if token:
        with db() as c:
            c.execute('DELETE FROM sessions WHERE token = ?', (token,))
    return 200, {'ok': True}


def list_comments(query):
    vid = param(query, 'id')
    if not vid:
        return 400, {'ok': False, 'error': 'missing id'}
    rows = db().execute('SELECT id, name, text, ts, picture, sub FROM comments WHERE vid = ? ORDER BY id DESC LIMIT 200',
                        (vid,)).fetchall()
    return 200, {'ok': True, 'comments': [comment_json(r) for r in rows]}


def my_comment_ids(body, query):
    """אילו מהתגובות בסרטון שייכות למשתמש המחובר (כדי להציג לו 'מחק')."""
    user = current_user(body)
    vid = clean(body.get('id'), 300)
    if not user or not vid:
        return 200, {'ok': True, 'ids': []}
    if user['admin']:
        rows = db().execute('SELECT id FROM comments WHERE vid = ?', (vid,))
    else:
        rows = db().execute('SELECT id FROM comments WHERE vid = ? AND sub = ?', (vid, user['sub']))
    return 200, {'ok': True, 'ids': [r[0] for r in rows]}


def add_comment(body, ip):
    user = require_user(body)
    vid = clean(body.get('id'), 300)
    text = clean(body.get('text'), MAX_TEXT)
    if not vid or not text:
        return 400, {'ok': False, 'error': 'missing fields'}
    # אותו כלל כמו בפיד: בלי קישורים ובלי יותר מ-2 אימוג'ים (מונע ספאם ופרסום)
    if LINK_RE.search(text) or len(EMOJI_RE.findall(text)) > 2:
        return 400, {'ok': False, 'error': 'blocked', 'message': "תגובות עם קישורים או עם יותר מ-2 אימוג'ים לא מתפרסמות"}
    c = db()
    now = int(time.time())
    last = c.execute('SELECT MAX(ts) FROM comments WHERE sub = ?', (user['sub'],)).fetchone()[0]
    if last and now - last < COMMENT_COOLDOWN:
        return 429, {'ok': False, 'error': 'too fast', 'message': 'אפשר להגיב שוב בעוד כמה שניות'}
    with c:
        cur = c.execute('INSERT INTO comments (vid, client, ip, name, text, ts, sub, picture) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        (vid, user['sub'], ip, user['name'], text, now, user['sub'], user['picture']))
    row = (cur.lastrowid, user['name'], text, now, user['picture'], user['sub'])
    return 200, {'ok': True, 'comment': comment_json(row, user)}


def delete_comment(body):
    user = require_user(body)
    try:
        cid = int(body.get('cid'))
    except (TypeError, ValueError):
        return 400, {'ok': False, 'error': 'missing cid'}
    c = db()
    row = c.execute('SELECT sub, vid FROM comments WHERE id = ?', (cid,)).fetchone()
    if not row:
        return 404, {'ok': False, 'error': 'not found'}
    if row[0] != user['sub'] and not user['admin']:
        return 403, {'ok': False, 'error': 'forbidden', 'message': 'אפשר למחוק רק תגובות שלך'}
    with c:
        c.execute('DELETE FROM comments WHERE id = ?', (cid,))
    return 200, {'ok': True, 'cid': cid, 'vid': row[1]}


def admin_comments(body):
    user = require_user(body)
    if not user['admin']:
        return 403, {'ok': False, 'error': 'forbidden', 'message': 'החשבון הזה אינו מנהל'}
    try:
        before = int(body.get('before') or 0)
    except (TypeError, ValueError):
        before = 0
    sql = 'SELECT id, name, text, ts, picture, sub, vid, ip FROM comments'
    args = ()
    if before:
        sql += ' WHERE id < ?'
        args = (before,)
    rows = db().execute(sql + ' ORDER BY id DESC LIMIT 100', args).fetchall()
    out = []
    for r in rows:
        item = comment_json(r[:6], user)
        item.update({'vid': r[6], 'ip': r[7] or ''})
        out.append(item)
    total = db().execute('SELECT COUNT(*) FROM comments').fetchone()[0]
    return 200, {'ok': True, 'comments': out, 'total': total}


# ---------------- WSGI plumbing ----------------

CORS = [
    ('Access-Control-Allow-Origin', '*'),
    ('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'),
    ('Access-Control-Allow-Headers', 'Content-Type'),
    ('Access-Control-Max-Age', '86400'),
]
STATUS = {200: '200 OK', 204: '204 No Content', 400: '400 Bad Request', 401: '401 Unauthorized',
          403: '403 Forbidden', 404: '404 Not Found', 429: '429 Too Many Requests',
          500: '500 Internal Server Error', 502: '502 Bad Gateway'}


def read_json(environ):
    try:
        size = min(int(environ.get('CONTENT_LENGTH') or 0), 20000)
    except ValueError:
        size = 0
    raw = environ['wsgi.input'].read(size) if size else b''
    try:
        data = json.loads(raw.decode('utf-8') or '{}')
    except ValueError:
        data = {}
    return data if isinstance(data, dict) else {}


ROUTES = {
    ('GET', 'health'): lambda env, q, b, ip: health(q),
    ('GET', 'stats'): lambda env, q, b, ip: stats(q),
    ('POST', 'like'): lambda env, q, b, ip: like(b),
    ('POST', 'auth'): lambda env, q, b, ip: auth(b),
    ('POST', 'me'): lambda env, q, b, ip: me(b),
    ('POST', 'logout'): lambda env, q, b, ip: logout(b),
    ('GET', 'comments'): lambda env, q, b, ip: list_comments(q),
    ('POST', 'comments'): lambda env, q, b, ip: add_comment(b, ip),
    ('POST', 'comments/mine'): lambda env, q, b, ip: my_comment_ids(b, q),
    ('POST', 'comments/delete'): lambda env, q, b, ip: delete_comment(b),
    ('POST', 'admin/comments'): lambda env, q, b, ip: admin_comments(b),
}


def api(environ, route, method):
    if method == 'OPTIONS':
        return 204, None
    handler = ROUTES.get((method, route))
    if not handler:
        return 404, {'ok': False, 'error': 'not found'}
    query = parse_qs(environ.get('QUERY_STRING', ''))
    body = read_json(environ) if method == 'POST' else {}
    ip = (environ.get('HTTP_X_REAL_IP') or environ.get('REMOTE_ADDR') or '')[:64]
    try:
        return handler(environ, query, body, ip)
    except ApiError as err:
        payload = {'ok': False, 'error': err.error}
        if err.message:
            payload['message'] = err.message
        return err.code, payload


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
