/**
 * GoFiber – motore sul Foglio Google (Apps Script)
 * Archivio condiviso, account con email e password, ruoli, foto su Drive.
 *
 * Installazione (una volta sola):
 *  1. Apri il foglio "GoFiber – Database" → Estensioni → Apps Script.
 *  2. Incolla questo file al posto del codice presente e salva.
 *  3. Esegui una volta la funzione "setup" (autorizza quando richiesto).
 *  4. Esegui il deployment → Nuovo deployment → Tipo: App web
 *     Esegui come: Me · Chi ha accesso: Chiunque → Esegui il deployment.
 *  5. Copia l'URL che finisce con /exec e incollalo in GoFiber.
 */
const VERSION = 5;
const BACKUP_KEEP = 12;     // backup mensili conservati su Drive
const ARCHIVE_DAYS = 365;   // pratiche chiuse da più di un anno vanno nello Storico
const TOMBSTONE_DAYS = 45; // righe eliminate tenute per avvisare i dispositivi, poi tolte
const SHEET_ID = ''; // vuoto = il foglio collegato o, se lo script è separato, "GoFiber – Database" cercato su Drive
const SESSION_DAYS = 90;

let SS_ = null;
function ss_() {
  if (SS_) return SS_;
  const p = PropertiesService.getScriptProperties();
  const id = SHEET_ID || p.getProperty('SHEET_ID');
  if (id) return (SS_ = SpreadsheetApp.openById(id));
  const act = SpreadsheetApp.getActiveSpreadsheet();
  if (act) return (SS_ = act);
  // script separato dal foglio: cerca "GoFiber – Database" su Drive e lo ricorda
  const it = DriveApp.searchFiles("title contains 'GoFiber' and title contains 'Database' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false");
  if (!it.hasNext()) throw new Error('Foglio "GoFiber – Database" non trovato');
  const f = it.next(); p.setProperty('SHEET_ID', f.getId());
  return (SS_ = SpreadsheetApp.openById(f.getId()));
}
function sh_(name, header) {
  const ss = ss_();
  let s = ss.getSheetByName(name);
  if (!s) {
    s = ss.insertSheet(name);
    s.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold').setBackground('#e0f2fe');
    s.setFrozenRows(1);
    s.getRange(1, 1, s.getMaxRows(), header.length).setNumberFormat('@');
  }
  return s;
}
const dati_ = () => sh_('Dati', ['PERCORSO', 'JSON', 'AGGIORNATO', 'ELIMINATO']);
const utenti_ = () => sh_('Utenti', ['ID', 'EMAIL', 'SALT', 'HASH', 'CREATO', 'ULTIMO_ACCESSO']);
const sessioni_ = () => sh_('Sessioni', ['TOKEN', 'ID', 'SCADE']);
const storico_ = () => sh_('Storico', ['PERCORSO', 'JSON', 'ARCHIVIATO']);
const cache_ = () => CacheService.getScriptCache();
const props_ = () => PropertiesService.getScriptProperties();

function setup() {
  dati_(); utenti_(); sessioni_(); storico_();
  folder_(); photos_(); backups_();
  return 'GoFiber pronto';
}

function folder_() {
  const f = DriveApp.getFileById(ss_().getId()).getParents();
  return f.hasNext() ? f.next() : DriveApp.getRootFolder();
}
function backups_() {
  const p = folder_(), it = p.getFoldersByName('GoFiber Backup');
  return it.hasNext() ? it.next() : p.createFolder('GoFiber Backup');
}
function photos_() {
  const p = folder_(), it = p.getFoldersByName('GoFiber Foto');
  return it.hasNext() ? it.next() : p.createFolder('GoFiber Foto');
}

/* ---------- HTTP ---------- */
function doGet() { return out_({ ok: true, app: 'GoFiber', version: VERSION }); }
function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (x) { return out_({ error: 'richiesta non valida' }); }
  const fn = API[b && b.action];
  if (!fn) return out_({ error: 'azione sconosciuta' });
  try { return out_(fn(b)); } catch (x) { return out_({ error: String(x && x.message || x) }); }
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- account ---------- */
function hash_(salt, pw) {
  let h = salt + '|' + pw;
  for (let i = 0; i < 500; i++) h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt));
  return h;
}
const norm_ = e => String(e || '').trim().toLowerCase();
function findUser_(email) {
  const s = utenti_(), n = s.getLastRow();
  if (n < 2) return null;
  const v = s.getRange(2, 1, n - 1, 4).getValues();
  for (let i = 0; i < v.length; i++) if (v[i][1] === email) return { row: i + 2, id: v[i][0], email: v[i][1], salt: v[i][2], hash: v[i][3] };
  return null;
}
function newSession_(id) {
  const tok = Utilities.getUuid() + Utilities.getUuid().slice(0, 8);
  const exp = Date.now() + SESSION_DAYS * 864e5;
  sessioni_().appendRow([tok, id, String(exp)]);
  CacheService.getScriptCache().put('s:' + tok, id, 21600);
  return tok;
}
function auth_(b) {
  const tok = String(b.token || '');
  if (!tok) throw new Error('auth');
  const c = CacheService.getScriptCache(), hit = c.get('s:' + tok);
  if (hit) return hit;
  const s = sessioni_(), n = s.getLastRow();
  if (n > 1) {
    const v = s.getRange(2, 1, n - 1, 3).getValues();
    for (const r of v) if (r[0] === tok && Number(r[2]) > Date.now()) { c.put('s:' + tok, r[1], 21600); return r[1]; }
  }
  throw new Error('auth');
}
const owner_ = () => props_().getProperty('OWNER') || '';

/* ---------- dati ---------- */
function readAll_() {
  const s = dati_(), n = s.getLastRow();
  if (n < 2) return [];
  return s.getRange(2, 1, n - 1, 4).getValues();
}
function getDoc_(path) {
  const s = dati_(), n = s.getLastRow();
  if (n < 2) return null;
  const col = s.getRange(2, 1, n - 1, 1).getValues();
  for (let i = col.length - 1; i >= 0; i--) if (col[i][0] === path) {
    const r = s.getRange(i + 2, 1, 1, 4).getValues()[0];
    if (r[3]) return null;
    try { return JSON.parse(r[1]); } catch (x) { return null; }
  }
  return null;
}
function role_(id) {
  if (id && id === owner_()) return { ruolo: 'admin', attivo: true, owner: true };
  const c = cache_(), hit = c.get('r:' + id);
  if (hit) return JSON.parse(hit);
  const r = getDoc_('ruoli/' + id);
  const out = r && r.stato === 'attivo' ? { ruolo: r.ruolo || 'tecnico', attivo: true, owner: false } : { ruolo: r && r.ruolo || '', attivo: false, owner: false };
  c.put('r:' + id, JSON.stringify(out), 60);
  return out;
}
function lastWrite_() { return Number(cache_().get('lw') || props_().getProperty('LAST_WRITE') || 0); }
function canWrite_(path, id, role) {
  const p = String(path).split('/');
  if (p.length < 2 || p.length % 2) return false;
  const col = p[0];
  if (col === 'tecnici' && p[1] === id && p.length === 2) return true;
  if (!role.attivo) return false;
  if (col === 'ruoli' || col === 'tecnici' || col === 'credenziali') return role.ruolo === 'admin';
  if (role.ruolo === 'admin' || role.ruolo === 'ufficio') return true;
  return ['pratiche', 'esiti', 'unita', 'rfid'].indexOf(col) >= 0;
}
function canRead_(path, id, role) {
  if (role.attivo) return true;
  const p = String(path).split('/');
  return (p[0] === 'tecnici' || p[0] === 'ruoli') && p[1] === id;
}
function isObj_(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function merge_(a, b) {
  const o = Object.assign({}, a);
  Object.keys(b).forEach(k => { o[k] = isObj_(o[k]) && isObj_(b[k]) ? merge_(o[k], b[k]) : b[k]; });
  return o;
}

const API = {
  ping: () => ({ ok: true, version: VERSION }),

  register(b) {
    const email = norm_(b.email), pw = String(b.password || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Email non valida');
    if (pw.length < 6) throw new Error('La password deve avere almeno 6 caratteri');
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      if (findUser_(email)) throw new Error('Esiste già un account con questa email');
      const id = 'u' + Utilities.getUuid().replace(/-/g, '').slice(0, 12), salt = Utilities.getUuid();
      utenti_().appendRow([id, email, salt, hash_(salt, pw), new Date().toISOString(), '']);
      if (!owner_()) props_().setProperty('OWNER', id);
      return { token: newSession_(id), id: id };
    } finally { lock.releaseLock(); }
  },

  login(b) {
    const u = findUser_(norm_(b.email));
    if (!u || hash_(u.salt, String(b.password || '')) !== u.hash) throw new Error('Email o password errate');
    utenti_().getRange(u.row, 6).setValue(new Date().toISOString());
    return { token: newSession_(u.id), id: u.id };
  },

  logout(b) {
    const tok = String(b.token || ''); CacheService.getScriptCache().remove('s:' + tok);
    const s = sessioni_(), n = s.getLastRow();
    if (n > 1) { const v = s.getRange(2, 1, n - 1, 1).getValues(); for (let i = v.length - 1; i >= 0; i--) if (v[i][0] === tok) s.deleteRow(i + 2); }
    return { ok: true };
  },

  me(b) {
    const id = auth_(b), r = role_(id);
    const u = utenti_().getRange(1, 1, utenti_().getLastRow(), 2).getValues().filter(x => x[0] === id)[0];
    return { id: id, email: u ? u[1] : '', owner: r.owner, ruolo: r.ruolo, attivo: r.attivo };
  },

  setPassword(b) {
    const id = auth_(b), r = role_(id);
    const target = b.userId || id;
    if (target !== id && !(r.attivo && r.ruolo === 'admin')) throw new Error('Non autorizzato');
    const pw = String(b.password || '');
    if (pw.length < 6) throw new Error('La password deve avere almeno 6 caratteri');
    const s = utenti_(), n = s.getLastRow(), v = s.getRange(2, 1, n - 1, 1).getValues();
    for (let i = 0; i < v.length; i++) if (v[i][0] === target) {
      const salt = Utilities.getUuid(); s.getRange(i + 2, 3, 1, 2).setValues([[salt, hash_(salt, pw)]]); return { ok: true };
    }
    throw new Error('Utente non trovato');
  },

  emails(b) {
    const id = auth_(b), r = role_(id);
    if (!(r.attivo && r.ruolo === 'admin')) return { emails: {} };
    const s = utenti_(), n = s.getLastRow(), o = {};
    if (n > 1) s.getRange(2, 1, n - 1, 2).getValues().forEach(x => { o[x[0]] = x[1]; });
    return { emails: o };
  },

  sync(b) {
    const id = auth_(b), role = role_(id), since = Number(b.since || 0);
    if (role.attivo && role.ruolo === 'admin') { maybeArchive_(); maybeBackup_(); }
    const lw = lastWrite_();
    // nessuna modifica dall'ultimo controllo: risposta immediata, senza leggere il foglio
    if (since && lw && since >= lw) return { now: since, docs: [], owner: id === owner_(), ruolo: role.ruolo, attivo: role.attivo };
    const s = dati_(), n = s.getLastRow(), now = Date.now(), docs = [];
    if (n > 1) {
      const times = s.getRange(2, 3, n - 1, 1).getValues();
      const idx = []; times.forEach((t, i) => { if (Number(t[0]) > since) idx.push(i); });
      let rows;
      if (idx.length > 150 || !since) { const all = s.getRange(2, 1, n - 1, 4).getValues(); rows = idx.map(i => all[i]); }
      else rows = idx.map(i => s.getRange(i + 2, 1, 1, 4).getValues()[0]);
      for (const r of rows) { if (!canRead_(r[0], id, role)) continue; if (!since && r[3]) continue; docs.push([r[0], r[3] ? null : r[1]]); }
    }
    // margine di 8 secondi: una scrittura in corso durante la lettura viene ripresa al giro dopo
    return { now: now - 8000, docs: docs, owner: id === owner_(), ruolo: role.ruolo, attivo: role.attivo };
  },

  write(b) {
    const id = auth_(b), role = role_(id), ops = b.ops || [];
    const lock = LockService.getScriptLock(); lock.waitLock(25000);
    try {
      const s = dati_(), n = s.getLastRow();
      const rows = n > 1 ? s.getRange(2, 1, n - 1, 4).getValues() : [];
      const idx = {}; rows.forEach((r, i) => { idx[r[0]] = i; });
      const now = Date.now(), add = [], changed = {}, errors = [];
      for (const op of ops) {
        const path = String(op.path || '');
        if (!canWrite_(path, id, role)) { errors.push(path); continue; }
        let i = idx[path], cur = i != null && !rows[i][3] ? JSON.parse(rows[i][1] || '{}') : null;
        let json = '', del = '';
        if (op.op === 'delete') { del = '1'; }
        else if (op.op === 'update') { if (!cur) { errors.push(path); continue; } json = JSON.stringify(merge_(cur, op.data || {})); }
        else json = JSON.stringify(op.data || {});
        if (json.length > 49000) { errors.push(path + ' (troppo grande)'); continue; }
        const row = [path, json, String(now), del];
        if (i != null) { rows[i] = row; changed[i] = true; }
        else { idx[path] = rows.length; rows.push(row); add.push(rows.length - 1); }
      }
      Object.keys(changed).forEach(k => { s.getRange(Number(k) + 2, 1, 1, 4).setValues([rows[k]]); });
      if (add.length) s.getRange(n + 1 < 2 ? 2 : n + 1, 1, add.length, 4).setNumberFormat('@').setValues(add.map(k => rows[k]));
      if (Object.keys(changed).length || add.length) {
        SpreadsheetApp.flush();
        props_().setProperty('LAST_WRITE', String(now)); cache_().put('lw', String(now), 21600);
        ops.forEach(op => { const p = String(op.path || '').split('/'); if (p[0] === 'ruoli') cache_().remove('r:' + p[1]); });
      }
      return { ok: true, now: now, errors: errors };
    } finally { lock.releaseLock(); }
  },

  upload(b) {
    const id = auth_(b), r = role_(id);
    if (!r.attivo) throw new Error('Non autorizzato');
    const blob = Utilities.newBlob(Utilities.base64Decode(b.b64), b.type || 'application/octet-stream', b.name || ('file-' + Date.now()));
    const f = photos_().createFile(blob);
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return { id: 'gd:' + f.getId(), contentType: b.type };
  },

  storico(b) {
    const id = auth_(b), r = role_(id);
    if (!r.attivo || r.ruolo === 'tecnico') throw new Error('Non autorizzato');
    const q = String(b.q || '').trim().toLowerCase();
    const s = storico_(), n = s.getLastRow();
    if (n < 2) return { items: [], total: 0 };
    const v = s.getRange(2, 1, n - 1, 2).getValues(), by = {};
    v.forEach(x => { const p = String(x[0]).split('/'); if (p.length !== 2) return; (by[p[1]] = by[p[1]] || {})[p[0]] = x[1]; });
    const out = [];
    Object.keys(by).forEach(k => { const o = by[k]; const txt = ((o.pratiche || '') + ' ' + (o.esiti || '')).toLowerCase(); if (!q || txt.indexOf(q) >= 0) out.push({ id: k, pratica: o.pratiche ? JSON.parse(o.pratiche) : null, esito: o.esiti ? JSON.parse(o.esiti) : null }); });
    out.sort((a, b2) => String(b2.esito && b2.esito.completedAt || '').localeCompare(String(a.esito && a.esito.completedAt || '')));
    return { items: out.slice(0, 200), total: out.length };
  },

  archiveNow(b) {
    const id = auth_(b), r = role_(id);
    if (!(r.attivo && r.ruolo === 'admin')) throw new Error('Non autorizzato');
    return archive_(Number(b.days) || ARCHIVE_DAYS);
  },

  backups(b) {
    const id = auth_(b), r = role_(id);
    if (!(r.attivo && r.ruolo === 'admin')) throw new Error('Non autorizzato');
    const out = [], it = backups_().getFiles();
    while (it.hasNext()) { const f = it.next(); out.push({ nome: f.getName(), data: f.getDateCreated().toISOString(), url: f.getUrl() }); }
    out.sort((a, b2) => b2.data.localeCompare(a.data));
    return { items: out, cartella: backups_().getUrl() };
  },

  backupNow(b) {
    const id = auth_(b), r = role_(id);
    if (!(r.attivo && r.ruolo === 'admin')) throw new Error('Non autorizzato');
    return backup_('manuale');
  },

  revokeSessions(b) {
    const id = auth_(b), r = role_(id), target = b.userId || id;
    if (target !== id && !(r.attivo && r.ruolo === 'admin')) throw new Error('Non autorizzato');
    const keepTok = target === id && b.keepCurrent ? String(b.token) : '';
    const s = sessioni_(), n = s.getLastRow(); let tolte = 0;
    if (n > 1) {
      const v = s.getRange(2, 1, n - 1, 3).getValues(), keep = [];
      v.forEach(x => { if (x[1] === target && x[0] !== keepTok) { cache_().remove('s:' + x[0]); tolte++; } else keep.push(x); });
      s.getRange(2, 1, n - 1, 3).clearContent();
      if (keep.length) s.getRange(2, 1, keep.length, 3).setNumberFormat('@').setValues(keep);
    }
    return { tolte: tolte };
  },

  pfs(b) {
    const id = auth_(b), r = role_(id);
    if (!r.attivo) throw new Error('Non autorizzato');
    const it = folder_().getFilesByName('pfs-data.json');
    if (!it.hasNext()) return { missing: true };
    return { text: it.next().getBlob().getDataAsString('UTF-8') };
  }
};

/* ---------- storico: alleggerisce il foglio Dati ---------- */
function maybeArchive_() {
  const last = Number(props_().getProperty('LAST_ARCHIVE') || 0);
  if (Date.now() - last < 864e5) return;
  props_().setProperty('LAST_ARCHIVE', String(Date.now()));
  try { archive_(ARCHIVE_DAYS); } catch (x) {}
}
function archive_(days) {
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    const s = dati_(), n = s.getLastRow();
    if (n < 2) return { archiviate: 0, tolte: 0 };
    const rows = s.getRange(2, 1, n - 1, 4).getValues(), now = Date.now();
    const cut = new Date(now - days * 864e5).toISOString(), tomb = now - TOMBSTONE_DAYS * 864e5;
    const old = {};
    rows.forEach(r => { if (String(r[0]).indexOf('esiti/') === 0 && !r[3]) { try { const e = JSON.parse(r[1]); if (e.completedAt && e.completedAt < cut) old[String(r[0]).slice(6)] = true; } catch (x) {} } });
    const toStore = [], keep = [];
    let moved = 0, purged = 0;
    rows.forEach(r => {
      const p = String(r[0]).split('/');
      if (r[3] && Number(r[2]) < tomb) { purged++; return; }
      if ((p[0] === 'esiti' || p[0] === 'pratiche') && old[p[1]] && !r[3]) {
        toStore.push([r[0], r[1], new Date(now).toISOString()]); moved++;
        keep.push([r[0], '', String(now), '1']); return;
      }
      keep.push(r);
    });
    if (!moved && !purged) return { archiviate: 0, tolte: 0 };
    if (toStore.length) { const st = storico_(), m = st.getLastRow(); st.getRange(m + 1, 1, toStore.length, 3).setNumberFormat('@').setValues(toStore); }
    s.getRange(2, 1, n - 1, 4).clearContent();
    if (keep.length) s.getRange(2, 1, keep.length, 4).setNumberFormat('@').setValues(keep);
    SpreadsheetApp.flush();
    props_().setProperty('LAST_WRITE', String(now)); cache_().put('lw', String(now), 21600);
    return { archiviate: moved / 2, tolte: purged };
  } finally { lock.releaseLock(); }
}

/* ---------- backup mensile su Drive ---------- */
function maybeBackup_() {
  const m = new Date().toISOString().slice(0, 7);
  if (props_().getProperty('LAST_BACKUP_MONTH') === m) return;
  props_().setProperty('LAST_BACKUP_MONTH', m);
  try { backup_('mensile'); } catch (x) {}
}
function backup_(tipo) {
  const f = DriveApp.getFileById(ss_().getId()), d = new Date();
  const nome = 'GoFiber backup ' + tipo + ' ' + Utilities.formatDate(d, 'Europe/Rome', 'yyyy-MM-dd HH.mm');
  const c = f.makeCopy(nome, backups_());
  const all = []; const it = backups_().getFiles();
  while (it.hasNext()) { const x = it.next(); if (x.getName().indexOf('GoFiber backup mensile') === 0) all.push(x); }
  all.sort((a, b) => b.getDateCreated() - a.getDateCreated());
  all.slice(BACKUP_KEEP).forEach(x => x.setTrashed(true));
  return { nome: nome, url: c.getUrl(), data: d.toISOString() };
}
