// התחברות עם Google ושיחה עם שרת ה-VOD (משותף לאתר ולדף הניהול).
// Google נותן לנו ID token; השרת בודק אותו מול Google ומחזיר session משלו, שנשמר בדפדפן.
(() => {
  const cfg = window.VOD_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const SERVER = (params.get('server') || cfg.SERVER || '').trim().replace(/\/+$/, '');
  const CLIENT_ID = cfg.GOOGLE_CLIENT_ID || '';

  const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  let session = read('vod_session') || '';
  let user = read('vod_user') || null;
  const changeListeners = [];
  const errorListeners = [];

  async function server(path, body) {
    // text/plain כדי שהדפדפן לא ישלח בקשת preflight לפני כל POST
    const opt = body ? { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(body) } : {};
    const r = await fetch(SERVER + path, opt);
    return r.json().catch(() => ({ ok: false }));
  }

  function setUser(s, u) {
    session = s || ''; user = u || null;
    write('vod_session', session || null); write('vod_user', user);
    changeListeners.forEach(f => f(user));
  }

  async function onCredential(resp) {
    try {
      const j = await server('/auth', { credential: resp.credential });
      if (!j.ok) throw new Error(j.message || 'ההתחברות נכשלה');
      setUser(j.session, j.user);
    } catch (e) {
      errorListeners.forEach(f => f(e.message || 'ההתחברות נכשלה'));
    }
  }

  let gsi = null;
  function whenGoogle() {
    if (gsi) return gsi;
    gsi = new Promise((resolve, reject) => {
      const started = Date.now();
      (function wait() {
        if (window.google && google.accounts && google.accounts.id) {
          google.accounts.id.initialize({ client_id: CLIENT_ID, callback: onCredential, ux_mode: 'popup', auto_select: false, cancel_on_tap_outside: true });
          resolve(google.accounts.id);
        } else if (Date.now() - started > 15000) reject(new Error('לא הצלחנו לטעון את ההתחברות של Google'));
        else setTimeout(wait, 100);
      })();
    });
    return gsi;
  }

  // מצייר את כפתור "התחברות עם Google" בתוך el
  async function renderButton(el, width) {
    try {
      const id = await whenGoogle();
      el.innerHTML = '';
      id.renderButton(el, { type: 'standard', theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'he', width: width || 240 });
    } catch (e) {
      el.textContent = e.message;
    }
  }

  // בודק מול השרת שה-session עדיין בתוקף
  async function refresh() {
    if (!session) return null;
    try {
      const j = await server('/me', { session });
      if (j.ok) setUser(j.user ? session : '', j.user);
    } catch {}
    return user;
  }

  async function logout() {
    const s = session;
    setUser('', null);
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
    if (s) server('/logout', { session: s }).catch(() => {});
  }

  window.VodAuth = {
    SERVER, server, renderButton, refresh, logout,
    get session() { return session; },
    get user() { return user; },
    onChange(f) { changeListeners.push(f); },
    onError(f) { errorListeners.push(f); }
  };
})();
