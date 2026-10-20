'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const COOKIE = 'sbb_session';
const SESSION_DAYS = 30;
const COLLECTIONS = new Set(['clients', 'projects', 'bills', 'payments', 'items']);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/;
const secureCookie = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' || /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
});

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id            BIGSERIAL PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('admin','contractor')),
      company_name  TEXT NOT NULL DEFAULT '',
      person_name   TEXT NOT NULL DEFAULT '',
      address       TEXT NOT NULL DEFAULT '',
      phone         TEXT NOT NULL DEFAULT '',
      active        BOOLEAN NOT NULL DEFAULT TRUE,
      settings      JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      collection TEXT NOT NULL,
      id         TEXT NOT NULL,
      data       JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (account_id, collection, id)
    );
  `);
}

// The first admin comes from ADMIN_USERNAME / ADMIN_PASSWORD; later admins can change their password in the app.
async function ensureAdmin() {
  const { rows } = await pool.query(`SELECT 1 FROM accounts WHERE role = 'admin' LIMIT 1`);
  if (rows.length) return;
  const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 8) {
    console.error('No admin account yet. Set ADMIN_PASSWORD (at least 8 characters) to create one.');
    process.exit(1);
  }
  await pool.query(
    `INSERT INTO accounts (username, password_hash, role, person_name) VALUES ($1, $2, 'admin', 'Administrator')`,
    [username, await bcrypt.hash(password, 12)]
  );
  console.log(`Created admin account "${username}".`);
}

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);

function publicAccount(a) {
  return {
    id: String(a.id), username: a.username, role: a.role, companyName: a.company_name, personName: a.person_name,
    address: a.address, phone: a.phone, active: a.active, createdAt: a.created_at, lastLoginAt: a.last_login_at,
  };
}

/* ---------- login throttling (per IP and per username) ---------- */
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000, MAX_FAILS = 8;
function throttled(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW_MS) return false;
  return f.count >= MAX_FAILS;
}
function fail(key) {
  const f = failures.get(key);
  if (!f || Date.now() - f.first > WINDOW_MS) failures.set(key, { first: Date.now(), count: 1 });
  else f.count++;
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; img-src 'self' data: blob:; connect-src 'self'",
  });
  next();
});

// Every state-changing API call must carry this header; browsers won't send it cross-site without a CORS preflight we never allow.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('X-SBB') !== '1') return res.status(403).json({ error: 'Bad request origin.' });
  next();
});

async function loadSession(req) {
  const token = req.cookies[COOKIE];
  if (!token) return null;
  const { rows } = await pool.query(
    `SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND a.active`,
    [sha256(token)]
  );
  return rows[0] || null;
}
const auth = role => async (req, res, next) => {
  try {
    const acct = await loadSession(req);
    if (!acct) return res.status(401).json({ error: 'Please log in.' });
    if (role && acct.role !== role) return res.status(403).json({ error: 'Not allowed.' });
    req.account = acct;
    next();
  } catch (e) { next(e); }
};
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

/* ---------- auth ---------- */
app.post('/api/login', wrap(async (req, res) => {
  const username = str(req.body.username, 40).toLowerCase();
  const password = String(req.body.password || '');
  const keys = ['ip:' + req.ip, 'user:' + username];
  if (keys.some(throttled)) return res.status(429).json({ error: 'Too many wrong attempts. Wait 15 minutes and try again.' });
  const { rows } = await pool.query(`SELECT * FROM accounts WHERE username = $1`, [username]);
  const acct = rows[0];
  const ok = acct && await bcrypt.compare(password, acct.password_hash);
  if (!ok) { keys.forEach(fail); return res.status(401).json({ error: 'Login ID or password is wrong.' }); }
  if (!acct.active) return res.status(403).json({ error: 'This account is switched off. Contact your administrator.' });
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(`INSERT INTO sessions (token_hash, account_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [sha256(token), acct.id]);
  await pool.query(`UPDATE accounts SET last_login_at = now() WHERE id = $1`, [acct.id]);
  await pool.query(`DELETE FROM sessions WHERE expires_at < now()`);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: secureCookie, maxAge: SESSION_DAYS * 864e5, path: '/' });
  res.json({ role: acct.role });
}));

app.post('/api/logout', wrap(async (req, res) => {
  const token = req.cookies[COOKIE];
  if (token) await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [sha256(token)]);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}));

app.get('/api/me', auth(), (req, res) => res.json(publicAccount(req.account)));

app.post('/api/me/password', auth(), wrap(async (req, res) => {
  const { current, next: pw } = req.body;
  if (!await bcrypt.compare(String(current || ''), req.account.password_hash)) return res.status(400).json({ error: 'Your current password is wrong.' });
  if (typeof pw !== 'string' || pw.length < 6) return res.status(400).json({ error: 'The new password needs at least 6 characters.' });
  await pool.query(`UPDATE accounts SET password_hash = $1 WHERE id = $2`, [await bcrypt.hash(pw, 12), req.account.id]);
  // Sign out other devices but keep this one.
  await pool.query(`DELETE FROM sessions WHERE account_id = $1 AND token_hash <> $2`, [req.account.id, sha256(req.cookies[COOKIE])]);
  res.json({ ok: true });
}));

/* ---------- contractor bill book data (always scoped to the logged-in account) ---------- */
app.get('/api/data', auth('contractor'), wrap(async (req, res) => {
  const { rows } = await pool.query(`SELECT collection, id, data FROM records WHERE account_id = $1`, [req.account.id]);
  const out = { clients: [], projects: [], bills: [], payments: [], items: [], settings: req.account.settings || {} };
  rows.forEach(r => out[r.collection] && out[r.collection].push({ ...r.data, id: r.id }));
  res.json(out);
}));

function checkRecord(req, res) {
  const { col, id } = req.params;
  if (!COLLECTIONS.has(col) || !ID_RE.test(id)) { res.status(400).json({ error: 'Unknown record.' }); return false; }
  return true;
}
app.put('/api/records/:col/:id', auth('contractor'), wrap(async (req, res) => {
  if (!checkRecord(req, res)) return;
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Record must be an object.' });
  delete body.id;
  await pool.query(
    `INSERT INTO records (account_id, collection, id, data) VALUES ($1, $2, $3, $4)
     ON CONFLICT (account_id, collection, id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [req.account.id, req.params.col, req.params.id, body]
  );
  res.json({ ok: true });
}));
app.delete('/api/records/:col/:id', auth('contractor'), wrap(async (req, res) => {
  if (!checkRecord(req, res)) return;
  await pool.query(`DELETE FROM records WHERE account_id = $1 AND collection = $2 AND id = $3`, [req.account.id, req.params.col, req.params.id]);
  res.json({ ok: true });
}));
app.put('/api/settings', auth('contractor'), wrap(async (req, res) => {
  const allowed = ['name', 'owner', 'phone', 'email', 'address', 'reg', 'bank', 'branch', 'accName', 'accNo', 'terms', 'lastBillNo'];
  const s = {};
  allowed.forEach(k => { if (req.body[k] != null) s[k] = str(req.body[k], 1000); });
  await pool.query(`UPDATE accounts SET settings = $1 WHERE id = $2`, [s, req.account.id]);
  res.json({ ok: true });
}));

/* ---------- admin: manage contractor accounts (admins never see contractors' bills) ---------- */
app.get('/api/admin/accounts', auth('admin'), wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT a.*, COALESCE(c.bills, 0) AS bills, COALESCE(c.projects, 0) AS projects
    FROM accounts a
    LEFT JOIN (SELECT account_id, COUNT(*) FILTER (WHERE collection = 'bills') AS bills,
                      COUNT(*) FILTER (WHERE collection = 'projects') AS projects
               FROM records GROUP BY account_id) c ON c.account_id = a.id
    WHERE a.role = 'contractor' ORDER BY a.created_at DESC`);
  res.json(rows.map(r => ({ ...publicAccount(r), bills: Number(r.bills), projects: Number(r.projects) })));
}));

function accountFields(b) {
  return { companyName: str(b.companyName, 120), personName: str(b.personName, 120), address: str(b.address, 300), phone: str(b.phone, 40) };
}
app.post('/api/admin/accounts', auth('admin'), wrap(async (req, res) => {
  const f = accountFields(req.body);
  const username = str(req.body.username, 40).toLowerCase();
  const password = String(req.body.password || '');
  if (!f.personName) return res.status(400).json({ error: 'Enter the contractor\'s name.' });
  if (!f.address) return res.status(400).json({ error: 'Enter the address.' });
  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Login ID must be 3–40 small letters, numbers, dots or dashes.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password needs at least 6 characters.' });
  // Pre-fill the contractor's bill header from what the admin entered.
  const settings = { name: f.companyName || f.personName, owner: f.personName, address: f.address, phone: f.phone };
  try {
    const { rows } = await pool.query(
      `INSERT INTO accounts (username, password_hash, role, company_name, person_name, address, phone, settings)
       VALUES ($1, $2, 'contractor', $3, $4, $5, $6, $7) RETURNING *`,
      [username, await bcrypt.hash(password, 12), f.companyName, f.personName, f.address, f.phone, settings]
    );
    res.status(201).json(publicAccount(rows[0]));
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That login ID is already taken. Choose another.' });
    throw e;
  }
}));
app.patch('/api/admin/accounts/:id', auth('admin'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query(`SELECT * FROM accounts WHERE id = $1 AND role = 'contractor'`, [id]);
  if (!rows[0]) return res.status(404).json({ error: 'Contractor not found.' });
  const cur = rows[0];
  const b = req.body;
  const f = accountFields({
    companyName: b.companyName ?? cur.company_name, personName: b.personName ?? cur.person_name,
    address: b.address ?? cur.address, phone: b.phone ?? cur.phone,
  });
  const password = b.password ? String(b.password) : '';
  if (!f.personName || !f.address) return res.status(400).json({ error: 'Name and address are required.' });
  if (password && password.length < 6) return res.status(400).json({ error: 'Password needs at least 6 characters.' });
  const active = typeof b.active === 'boolean' ? b.active : cur.active;
  await pool.query(`UPDATE accounts SET company_name=$1, person_name=$2, address=$3, phone=$4, active=$5 WHERE id=$6`,
    [f.companyName, f.personName, f.address, f.phone, active, id]);
  if (password) await pool.query(`UPDATE accounts SET password_hash = $1 WHERE id = $2`, [await bcrypt.hash(password, 12), id]);
  // A reset password or a switched-off account signs the contractor out everywhere.
  if (!active || password) await pool.query(`DELETE FROM sessions WHERE account_id = $1`, [id]);
  const { rows: out } = await pool.query(`SELECT * FROM accounts WHERE id = $1`, [id]);
  res.json(publicAccount(out[0]));
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

/* ---------- pages ---------- */
const pub = path.join(__dirname, 'public');
// PDF libraries are served from our own dependencies so the app needs no outside script hosts.
const pkgDist = name => path.dirname(require.resolve(name));
app.get('/vendor/jspdf.umd.min.js', (req, res) => res.sendFile(path.join(pkgDist('jspdf'), 'jspdf.umd.min.js')));
app.get('/vendor/jspdf.plugin.autotable.min.js', (req, res) => res.sendFile(path.join(pkgDist('jspdf-autotable'), 'jspdf.plugin.autotable.min.js')));
app.get('/', wrap(async (req, res) => {
  const acct = await loadSession(req);
  res.redirect(!acct ? '/login' : acct.role === 'admin' ? '/admin' : '/app');
}));
app.get('/login', (req, res) => res.sendFile(path.join(pub, 'login.html')));
app.get('/app', wrap(async (req, res) => {
  const acct = await loadSession(req);
  if (!acct) return res.redirect('/login');
  if (acct.role === 'admin') return res.redirect('/admin');
  res.sendFile(path.join(pub, 'app.html'));
}));
app.get('/admin', wrap(async (req, res) => {
  const acct = await loadSession(req);
  if (!acct) return res.redirect('/login');
  if (acct.role !== 'admin') return res.redirect('/app');
  res.sendFile(path.join(pub, 'admin.html'));
}));
app.use(express.static(pub, { index: false }));

app.use((err, req, res, next) => {
  console.error(err);
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That record is too large.' });
  res.status(500).json({ error: 'Something went wrong on the server. Try again.' });
});

if (require.main === module) {
  migrate().then(ensureAdmin).then(() => app.listen(PORT, () => console.log(`Site Bill Book running on port ${PORT}`)))
    .catch(e => { console.error(e); process.exit(1); });
}
module.exports = { app, pool, migrate, ensureAdmin };
