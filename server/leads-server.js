#!/usr/bin/env node
// KWIGZ site server + first-party lead collector + admin API.
// Zero dependencies.
//
//   node server/leads-server.js                 # http://localhost:8000
//   PORT=3000 ADMIN_PASSWORD=secret node server/leads-server.js
//
// Env:
//   PORT            port to listen on (Render sets this automatically)
//   DATA_DIR        where leads/campaigns/uploads are stored (default server/data;
//                   on Render point this at a persistent disk, e.g. /data)
//   ADMIN_PASSWORD  password for /admin and the admin API. If unset, admin
//                   routes only work from localhost.
//
// Public:  POST /api/leads   GET /api/availability   GET /healthz
// Admin:   GET /admin        GET/PATCH /api/leads     GET /api/leads.csv
//          GET/POST/PATCH/DELETE /api/campaigns       GET /api/uploads/<file>

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const PORT = process.env.PORT === undefined ? 8000 : Number(process.env.PORT);
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const JSONL_FILE = path.join(DATA_DIR, 'leads.jsonl');
const CSV_FILE = path.join(DATA_DIR, 'leads.csv');
const LEAD_META_FILE = path.join(DATA_DIR, 'lead-meta.json');
const CAMPAIGNS_FILE = path.join(DATA_DIR, 'campaigns.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || process.env.LEADS_TOKEN || '';
const PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);
if (PRODUCTION && ADMIN_PASSWORD.length < 24) {
  throw new Error('Set ADMIN_PASSWORD to a unique password of at least 24 characters before deploying.');
}
if (PRODUCTION && !process.env.DATA_DIR) {
  throw new Error('Set DATA_DIR to the persistent disk mount before deploying.');
}
const configContext = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'ads-config.js'), 'utf8'), configContext);
const ADS = configContext.window.KWIGZ_ADS;
const PUBLIC_FILES = new Set([
  'index.html', 'about.html', 'revenue.html', 'compliance.html', 'contact.html',
  'styles.css', 'script.js', 'ads-config.js', 'icons.css', 'icons.svg',
  'hero-bg.jpg', 'kwigz-logo-nobg.png', 'kwigz-logo.png',
  'slimwall-installed-web.jpg', 'slimwall-inside-web.jpg', 'IMG_2898.jpeg',
]);
const loginAttempts = new Map();
const MAX_BODY = 8 * 1024 * 1024;          // room for a base64 banner
const MAX_BANNER_BYTES = 5 * 1024 * 1024;

const CSV_COLUMNS = [
  'id', 'receivedAt', 'type', 'email', 'phone', 'name', 'contactName', 'businessName', 'website', 'venue',
  'age21', 'wallSpace', 'machineSize',
  'category', 'machine', 'budget', 'units', 'estPlays', 'campaignStart', 'campaignEnd', 'bannerFile',
  'path', 'page', 'ip',
];

const BANNER_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const LEAD_STATUSES = ['new', 'contacted', 'won', 'lost'];
const CAMPAIGN_STATUSES = ['pending', 'active', 'ended', 'cancelled'];
const PAYMENT_STATUSES = ['unpaid', 'paid', 'refunded'];
const CREATIVE_STATUSES = ['pending', 'approved', 'needs-changes'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
ensureCsvHeader();

// ---------- storage helpers ----------

// If the column set changes, archive the old CSV rather than misaligning rows.
// leads.jsonl always holds the full record regardless.
function ensureCsvHeader() {
  const header = CSV_COLUMNS.join(',');
  if (fs.existsSync(CSV_FILE)) {
    const firstLine = fs.readFileSync(CSV_FILE, 'utf8').split('\n')[0];
    if (firstLine === header) return;
    fs.renameSync(CSV_FILE, path.join(DATA_DIR, `leads-archived-${Date.now()}.csv`));
  }
  fs.writeFileSync(CSV_FILE, header + '\n');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    console.error(`Unable to read stored data: ${path.basename(file)}`, err);
    throw new Error('Stored data could not be read. Check the server logs.');
  }
}
function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

function readLeads() {
  if (!fs.existsSync(JSONL_FILE)) return [];
  const meta = readJson(LEAD_META_FILE, {});
  return fs.readFileSync(JSONL_FILE, 'utf8').split('\n').filter(Boolean).map((line) => {
    const lead = JSON.parse(line);
    if (!lead.id) lead.id = `legacy-${lead.receivedAt}-${lead.email}`.replace(/[^a-z0-9@.-]/gi, '_');
    const m = meta[lead.id] || {};
    lead.status = m.status || 'new';
    lead.notes = m.notes || '';
    lead.updatedAt = m.updatedAt || lead.receivedAt;
    return lead;
  });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Loads campaigns and auto-ends any active ones past their end date.
function readCampaigns() {
  const campaigns = readJson(CAMPAIGNS_FILE, []);
  const today = todayISO();
  let changed = false;
  for (const c of campaigns) {
    if (c.status === 'active' && c.end && c.end < today) {
      c.status = 'ended';
      c.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) writeJson(CAMPAIGNS_FILE, campaigns);
  return campaigns;
}

// A category is "taken" on a machine while a pending or active campaign holds it.
function availability() {
  const today = todayISO();
  const byMachine = {};
  for (const c of readCampaigns()) {
    if (!['pending', 'active'].includes(c.status)) continue;
    if (c.end && c.end < today) continue;
    (byMachine[c.machineId] ||= new Set()).add(c.categoryId);
  }
  return Object.entries(byMachine).map(([id, set]) => ({ id, takenCategories: [...set] }));
}

function saveBanner(banner, email) {
  if (!banner || typeof banner.dataUrl !== 'string') return '';
  const m = banner.dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('Banner must be a PNG, JPG, or WebP image');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX_BANNER_BYTES) throw new Error('Banner must be under 5 MB');
  const valid = m[1] === 'image/png'
    ? buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : m[1] === 'image/jpeg'
      ? buf[0] === 255 && buf[1] === 216 && buf[2] === 255
      : buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw new Error('The uploaded file is not a valid supported image.');
  const safeEmail = email.replace(/[^a-z0-9]+/gi, '-').slice(0, 40);
  const fileName = `${newId('banner')}-${safeEmail}.${BANNER_EXT[m[1]]}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, fileName), buf);
  return fileName;
}

// ---------- http helpers ----------

function csvCell(v) {
  const raw = v == null ? '' : String(v);
  const s = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sendFile(res, filePath, extraHeaders = {}) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      ...extraHeaders,
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  let data;
  try { data = JSON.parse(raw || '{}'); } catch { throw new Error('Invalid JSON body'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected a JSON object');
  return data;
}

function isValidEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;
}

function clean(v, max = 500) {
  if (v == null) return '';
  return String(v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

function isLoopback(req) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function isAdmin(req) {
  if (ADMIN_PASSWORD) return safeEqual(bearer(req), ADMIN_PASSWORD);
  return !PRODUCTION && isLoopback(req);
}

// ---------- public handlers ----------

async function handleLeadPost(req, res) {
  let data;
  try { data = await readJsonBody(req); } catch (err) { return sendJson(res, 400, { ok: false, error: err.message }); }

  const email = clean(data.email, 254).toLowerCase();
  if (!isValidEmail(email)) return sendJson(res, 400, { ok: false, error: 'A valid email is required' });

  const { banner, ...fields } = data;
  const lead = { id: newId('L'), receivedAt: new Date().toISOString() };
  for (const [k, v] of Object.entries(fields)) {
    if (/^[a-zA-Z0-9_-]{1,40}$/.test(k) && ![
      'id', 'status', 'notes', 'receivedAt', 'updatedAt', 'bannerFile',
      '__proto__', 'constructor', 'prototype',
    ].includes(k) && typeof v !== 'object') lead[k] = clean(v);
  }
  lead.email = email;
  try {
    const bannerFile = saveBanner(banner, email);
    if (bannerFile) lead.bannerFile = bannerFile;
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message });
  }
  lead.type = clean(data.type, 60) || 'unknown';
  lead.ip = clientIp(req);

  fs.appendFileSync(JSONL_FILE, JSON.stringify(lead) + '\n');
  fs.appendFileSync(CSV_FILE, CSV_COLUMNS.map((c) => csvCell(lead[c])).join(',') + '\n');

  console.log(`[lead] ${lead.id} ${lead.type}`);
  sendJson(res, 201, { ok: true, id: lead.id });
}

// ---------- admin handlers ----------

function handleLeadPatch(req, res, id) {
  return readJsonBody(req).then((body) => {
    const leads = readLeads();
    if (!leads.some((l) => l.id === id)) return sendJson(res, 404, { ok: false, error: 'Lead not found' });
    const meta = readJson(LEAD_META_FILE, {});
    const entry = meta[id] || {};
    if (body.status !== undefined) {
      if (!LEAD_STATUSES.includes(body.status)) return sendJson(res, 400, { ok: false, error: 'Invalid status' });
      entry.status = body.status;
    }
    if (body.notes !== undefined) entry.notes = clean(body.notes, 2000);
    entry.updatedAt = new Date().toISOString();
    meta[id] = entry;
    writeJson(LEAD_META_FILE, meta);
    sendJson(res, 200, { ok: true, lead: readLeads().find((l) => l.id === id) });
  }).catch((err) => sendJson(res, 400, { ok: false, error: err.message }));
}

function normalizeCampaign(input, existing = {}) {
  const c = { ...existing };
  const str = (k, max = 200) => { if (input[k] !== undefined) c[k] = clean(input[k], max); };
  ['machineId', 'categoryId', 'business', 'contactName', 'email', 'phone', 'website', 'bannerFile', 'leadId'].forEach((k) => str(k));
  str('notes', 2000);
  if (input.budget !== undefined) c.budget = Number(input.budget) || 0;
  if (input.units !== undefined) c.units = Number(input.units) || 0;
  if (input.estPlays !== undefined) c.estPlays = Math.round(Number(input.estPlays) || 0);
  if (input.start !== undefined) c.start = clean(input.start, 10);
  if (input.end !== undefined) c.end = clean(input.end, 10);
  if (input.status !== undefined) {
    if (!CAMPAIGN_STATUSES.includes(input.status)) throw new Error('Invalid status');
    c.status = input.status;
  }
  if (input.paymentStatus !== undefined) {
    if (!PAYMENT_STATUSES.includes(input.paymentStatus)) throw new Error('Invalid paymentStatus');
    c.paymentStatus = input.paymentStatus;
  }
  if (input.creativeStatus !== undefined) {
    if (!CREATIVE_STATUSES.includes(input.creativeStatus)) throw new Error('Invalid creativeStatus');
    c.creativeStatus = input.creativeStatus;
  }
  if (!c.machineId || !c.categoryId) throw new Error('machineId and categoryId are required');
  if (!ADS.machines.some(m => m.id === c.machineId)) throw new Error('Unknown machine');
  if (!ADS.categories.some(category => category.id === c.categoryId)) throw new Error('Unknown category');
  if (!c.business) throw new Error('Business name is required');
  const budget = ADS.budgets.find(b => b.amount === c.budget);
  if (!budget) throw new Error('Select a supported budget');
  c.units = budget.units;
  if (!Number.isFinite(c.estPlays) || c.estPlays < 0) {
    const machine = ADS.machines.find(m => m.id === c.machineId);
    c.estPlays = Math.round(machine.adHoursPerDay * 3600 * ADS.campaignDays * c.units / (ADS.bannerSeconds * ADS.maxUnits));
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(c.end || '')) throw new Error('start and end must be YYYY-MM-DD');
  if ([c.start, c.end].some(date => {
    const value = new Date(`${date}T00:00:00Z`);
    return !Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date;
  })) throw new Error('Choose valid calendar dates');
  if (c.end < c.start) throw new Error('end must be on or after start');
  c.status ||= 'pending';
  c.paymentStatus ||= 'unpaid';
  c.creativeStatus ||= 'pending';
  return c;
}

// Two campaigns can't hold the same category on the same machine over overlapping dates.
function findConflict(campaigns, c) {
  if (!['pending', 'active'].includes(c.status)) return undefined;
  return campaigns.find((o) =>
    o.id !== c.id && o.machineId === c.machineId && o.categoryId === c.categoryId &&
    ['pending', 'active'].includes(o.status) && o.start <= c.end && c.start <= o.end);
}

async function handleCampaignPost(req, res) {
  try {
    const body = await readJsonBody(req);
    const campaigns = readCampaigns();
    const c = normalizeCampaign(body);
    c.id = newId('C');
    c.createdAt = c.updatedAt = new Date().toISOString();
    const conflict = findConflict(campaigns, c);
    if (conflict) {
      return sendJson(res, 409, { ok: false, error: `${conflict.business || 'Another campaign'} already holds this category on this machine for overlapping dates`, conflict });
    }
    campaigns.push(c);
    writeJson(CAMPAIGNS_FILE, campaigns);
    if (c.leadId) {
      const meta = readJson(LEAD_META_FILE, {});
      meta[c.leadId] = { ...(meta[c.leadId] || {}), status: 'won', updatedAt: c.createdAt };
      writeJson(LEAD_META_FILE, meta);
    }
    sendJson(res, 201, { ok: true, campaign: c });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message });
  }
}

async function handleCampaignPatch(req, res, id) {
  try {
    const body = await readJsonBody(req);
    const campaigns = readCampaigns();
    const idx = campaigns.findIndex((c) => c.id === id);
    if (idx === -1) return sendJson(res, 404, { ok: false, error: 'Campaign not found' });
    const c = normalizeCampaign(body, campaigns[idx]);
    c.updatedAt = new Date().toISOString();
    const conflict = findConflict(campaigns, c);
    if (conflict) {
      return sendJson(res, 409, { ok: false, error: `${conflict.business || 'Another campaign'} already holds this category for overlapping dates`, conflict });
    }
    campaigns[idx] = c;
    writeJson(CAMPAIGNS_FILE, campaigns);
    sendJson(res, 200, { ok: true, campaign: c });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message });
  }
}

function handleCampaignDelete(res, id) {
  const campaigns = readCampaigns();
  const next = campaigns.filter((c) => c.id !== id);
  if (next.length === campaigns.length) return sendJson(res, 404, { ok: false, error: 'Campaign not found' });
  writeJson(CAMPAIGNS_FILE, next);
  sendJson(res, 200, { ok: true });
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  const filename = pathname.slice(1);
  if (!PUBLIC_FILES.has(filename)) {
    res.writeHead(404); return res.end('Not found');
  }
  sendFile(res, path.join(ROOT, filename));
}

// ---------- router ----------

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p.startsWith('/api/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  }

  // --- public ---
  if (p === '/healthz') return sendJson(res, 200, { ok: true, uptime: process.uptime() });
  if (p === '/api/leads' && req.method === 'POST') return handleLeadPost(req, res).catch((e) => sendJson(res, 500, { ok: false, error: e.message }));
  if (p === '/api/availability' && req.method === 'GET') return sendJson(res, 200, { ok: true, machines: availability() });

  // --- admin ---
  if (p === '/admin' || p === '/admin/' || p === '/admin.html') {
    return sendFile(res, path.join(__dirname, 'admin.html'), { 'Cache-Control': 'no-store' });
  }
  if (p === '/api/admin/login' && req.method === 'POST') {
    const ip = clientIp(req);
    const now = Date.now();
    for (const [key, attempt] of loginAttempts) {
      if (now - attempt.since > 15 * 60 * 1000) loginAttempts.delete(key);
    }
    const attempt = loginAttempts.get(ip) || { since: now, count: 0 };
    if (attempt.count >= 10) {
      res.setHeader('Retry-After', '900');
      return sendJson(res, 429, { ok: false, error: 'Too many login attempts. Try again in 15 minutes.' });
    }
    if (!ADMIN_PASSWORD) return sendJson(res, 200, { ok: isLoopback(req), mode: 'localhost' });
    try {
      const { password } = await readJsonBody(req);
      const ok = safeEqual(password || '', ADMIN_PASSWORD);
      if (ok) loginAttempts.delete(ip);
      else {
        attempt.count++;
        loginAttempts.set(ip, attempt);
      }
      return sendJson(res, ok ? 200 : 401, { ok });
    } catch (err) { return sendJson(res, 400, { ok: false, error: err.message }); }
  }

  if (p.startsWith('/api/') || p.startsWith('/api/uploads/')) {
    if (!isAdmin(req)) return sendJson(res, 401, { ok: false, error: 'Unauthorized' });

    if (p === '/api/leads' && req.method === 'GET') {
      const leads = readLeads();
      return sendJson(res, 200, { ok: true, count: leads.length, leads });
    }
    if (p === '/api/leads.csv' && req.method === 'GET') {
      return sendFile(res, CSV_FILE, { 'Content-Disposition': `attachment; filename="kwigz-leads-${todayISO()}.csv"`, 'Cache-Control': 'no-store' });
    }
    const leadMatch = p.match(/^\/api\/leads\/([^/]+)$/);
    if (leadMatch && req.method === 'PATCH') return handleLeadPatch(req, res, decodeURIComponent(leadMatch[1]));

    if (p === '/api/campaigns' && req.method === 'GET') return sendJson(res, 200, { ok: true, campaigns: readCampaigns() });
    if (p === '/api/campaigns' && req.method === 'POST') return handleCampaignPost(req, res);
    const campMatch = p.match(/^\/api\/campaigns\/([^/]+)$/);
    if (campMatch && req.method === 'PATCH') return handleCampaignPatch(req, res, campMatch[1]);
    if (campMatch && req.method === 'DELETE') return handleCampaignDelete(res, campMatch[1]);

    if (p.startsWith('/api/uploads/')) return sendFile(res, path.join(UPLOADS_DIR, path.basename(p)), { 'Cache-Control': 'no-store' });

    return sendJson(res, 404, { ok: false, error: 'Not found' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method not allowed'); }
  serveStatic(req, res);
}

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  route(req, res).catch(err => {
    console.error('Request failed', err);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Unable to complete the request. Please try again.' });
    else res.destroy();
  });
});

server.listen(PORT, () => {
  const port = server.address().port;
  console.log(`KWIGZ site + lead collector running at http://localhost:${port}`);
  console.log(`Admin dashboard: http://localhost:${port}/admin ${ADMIN_PASSWORD ? '(password protected)' : '(no ADMIN_PASSWORD set — localhost only)'}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
