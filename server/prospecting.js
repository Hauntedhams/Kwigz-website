// Lead generation ("Generate leads") for the admin dashboard.
//
// Step 1 — POST /api/prospecting/runs: Clay company search → Clay "Enrich Company"
//          (address, lat/lng, logo, specialties) → distance filter from the machine →
//          score → Clay people search for decision-makers → Clay "Work Email" →
//          business phone scraped from the company website. Saved as prospects.
// Step 2 — POST /api/prospects/generate: writes the email / text / LinkedIn drafts and
//          creates the public mockup preview link for each prospect.
// Then the admin "sends" by copying the draft (mailto:/sms:/LinkedIn), logs the touch,
// and the prospect shows up again in "Needs attention" when the follow-up is due.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const templates = require('./outreach-templates');

const PROSPECT_STATUSES = ['new', 'drafted', 'contacted', 'replied', 'won', 'lost', 'skipped'];
const OUTREACH_CHANNELS = ['email', 'sms', 'linkedin', 'call', 'other'];
const RUN_ACTIVE = ['queued', 'searching', 'enriching', 'contacts', 'emails', 'phones'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowISO = () => new Date().toISOString();
const clean = (v, max = 500) => (v == null ? '' : String(v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max));
const q = (s) => `"${String(s).replace(/"/g, '')}"`;
const list = (arr) => `(${arr.map(q).join(', ')})`;

function haversineMiles(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeDomain(v) {
  let d = clean(v, 200).toLowerCase();
  if (!d) return '';
  try { if (/^https?:\/\//.test(d)) d = new URL(d).hostname; } catch { /* keep as-is */ }
  return d.replace(/^www\./, '').replace(/\/.*$/, '');
}

const firstNameOf = (full) => clean(full, 120).split(/\s+/)[0] || '';

// ---------- phone extraction ----------

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const d = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
  if (d.length !== 10 || /^[01]/.test(d) || /^[01]/.test(d.slice(3))) return null;
  if (/^(\d)\1{9}$/.test(d)) return null;
  return { e164: `+1${d}`, display: `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` };
}

function extractPhone(html) {
  const text = String(html || '');
  const counts = new Map();
  const bump = (p, weight) => { if (p) counts.set(p.e164, { ...p, n: (counts.get(p.e164)?.n || 0) + weight }); };
  for (const m of text.matchAll(/href=["']\s*(?:tel|sms|callto):([^"']+)["']/gi)) bump(normalizePhone(decodeURIComponent(m[1])), 5);
  for (const m of text.matchAll(/"telephone"\s*:\s*"([^"]+)"/gi)) bump(normalizePhone(m[1]), 5);
  const body = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ');
  for (const m of body.matchAll(/(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})\b/g)) bump(normalizePhone(m[0]), 1);
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  return best ? { e164: best.e164, display: best.display } : null;
}

async function fetchText(url, { timeoutMs = 7000, maxBytes = 600 * 1024, fetchImpl = fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; KWIGZ-Admin/1.0; +https://kwigz.com)', Accept: 'text/html,*/*' } });
    if (!res.ok) return '';
    const reader = res.body?.getReader?.();
    if (!reader) return (await res.text()).slice(0, maxBytes);
    const chunks = []; let size = 0;
    while (size < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); size += value.length;
    }
    reader.cancel().catch(() => {});
    return Buffer.concat(chunks).toString('utf8');
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function findWebsitePhone(website, opts) {
  if (!website) return null;
  const base = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  let home;
  try { home = new URL(base); } catch { return null; }
  if (!['http:', 'https:'].includes(home.protocol)) return null;
  const pages = [home.href, new URL('/contact', home).href, new URL('/contact-us', home).href];
  for (const url of pages) {
    const phone = extractPhone(await fetchText(url, opts));
    if (phone) return { ...phone, source: url };
  }
  return null;
}

// ---------- module ----------

function createProspecting({ dataDir, ads, config, clay, siteUrl, log = console.log, fetchImpl = fetch }) {
  const PROSPECTS_FILE = path.join(dataDir, 'prospects.json');
  const RUNS_FILE = path.join(dataDir, 'prospect-runs.json');
  const EXCLUDED_FILE = path.join(dataDir, 'prospect-excluded.json'); // enriched once, ruled out (e.g. outside radius) — never pay for them again
  const LOGO_DIR = path.join(dataDir, 'logos');
  fs.mkdirSync(LOGO_DIR, { recursive: true });

  const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { if (err.code === 'ENOENT') return fallback; throw err; } };
  const writeJson = (file, data) => { fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2)); fs.renameSync(`${file}.tmp`, file); };
  const readProspects = () => readJson(PROSPECTS_FILE, []);
  const writeProspects = (list) => writeJson(PROSPECTS_FILE, list);
  const readRuns = () => readJson(RUNS_FILE, []);
  const readExcluded = () => readJson(EXCLUDED_FILE, {});
  const writeRuns = (runs) => writeJson(RUNS_FILE, runs.slice(-50));
  const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;

  // A server restart kills any in-flight run; don't leave it looking alive.
  {
    const runs = readRuns();
    let changed = false;
    for (const r of runs) if (RUN_ACTIVE.includes(r.status)) { r.status = 'failed'; r.error = 'Server restarted during the run'; r.finishedAt = nowISO(); changed = true; }
    if (changed) writeRuns(runs);
  }
  let activeRunId = null;

  const machineById = (id) => ads.machines.find((m) => m.id === id);
  const categoryById = (id) => ads.categories.find((c) => c.id === id);
  const catConfig = (id) => config.categories[id];
  const metroFor = (machineId) => config.metros[machineId] || config.defaultMetro;
  const price = () => ads.budgets[0]?.amount || 200;
  const playsFor = (machine, units = ads.budgets[0]?.units || 1) => Math.round(machine.adHoursPerDay * 3600 * ads.campaignDays * units / (ads.bannerSeconds * ads.maxUnits));

  function status() {
    const prospects = readProspects();
    const runs = readRuns();
    return {
      clay: { configured: Boolean(clay) },
      defaults: { limit: config.defaults.limit, maxLimit: config.defaults.maxLimit, radiusMiles: config.defaults.radiusMiles, followUpDays: config.defaults.followUpDays, contactsPerCompany: config.defaults.contactsPerCompany },
      creditEstimates: config.creditEstimates,
      sender: config.sender,
      categories: ads.categories.map((c) => ({ id: c.id, label: c.label, configured: Boolean(catConfig(c.id)?.industries?.length || catConfig(c.id)?.keywords?.length), prospects: prospects.filter((p) => p.categoryId === c.id).length })),
      machines: ads.machines.map((m) => ({ id: m.id, name: m.name, city: m.city, geo: Number.isFinite(m.lat) && Number.isFinite(m.lng) })),
      activeRun: runs.find((r) => r.id === activeRunId) || null,
      recentRuns: runs.slice(-10).reverse(),
    };
  }

  // ---------- queries ----------

  function companyQuery({ categoryId, machineId, max }) {
    const cat = catConfig(categoryId) || config.categories.other;
    const metro = metroFor(machineId);
    const where = [`locations.any(is_headquarters = true and city in ${list(metro.cities)} and state_or_province = ${q(metro.state)})`];
    if (cat.industries?.length) where.push(`industry in ${list(cat.industries)}`);
    if (cat.keywords?.length) where.push(`description contains ${list(cat.keywords)}`);
    if (cat.sizes?.length) where.push(`company_size in ${list(cat.sizes)}`);
    return `select from companies where ${where.join(' and ')} limit ${max}`;
  }

  function peopleQuery(domain, categoryId, limit) {
    const titles = catConfig(categoryId)?.titles || config.defaultTitles;
    return `select from people where experiences.any(is_current = true and company.domain = ${q(domain)} and job_title is_similar_to ${list(titles)}) limit ${limit}`;
  }

  // Lower is better: position in the title priority list, with a boost when the title
  // itself mentions the category (e.g. "Managing Attorney, DUI Division").
  function rankTitle(title, categoryId) {
    const titles = catConfig(categoryId)?.titles || config.defaultTitles;
    const t = clean(title, 200).toLowerCase();
    const idx = titles.findIndex((x) => t.includes(x.toLowerCase()));
    const keywords = catConfig(categoryId)?.keywords || [];
    const boost = keywords.some((k) => t.includes(k.toLowerCase())) ? 1.5 : 0;
    return (idx === -1 ? titles.length : idx) - boost;
  }

  // ---------- normalization + scoring ----------

  function fromEnrich(result) {
    const e = result?.['Enrich Company'] || result || {};
    const loc = (e.locations || []).find((l) => l.is_primary) || (e.locations || [])[0] || {};
    const inferred = loc.inferred_location || {};
    const lat = Number(inferred.latitude), lng = Number(inferred.longitude);
    return {
      website: clean(e.website, 300),
      linkedinUrl: clean(e.url, 300),
      industry: clean(e.industry, 120),
      size: clean(e.size, 40).replace(/ employees$/, ''),
      employeeCount: Number(e.employee_count) || null,
      revenue: clean(e.annual_revenue, 40),
      founded: Number(e.founded) || null,
      description: clean(e.description, 600),
      specialties: Array.isArray(e.specialties) ? e.specialties.map((s) => clean(s, 80)).filter(Boolean).slice(0, 25) : [],
      logoUrl: /^https?:\/\//.test(e.logo_url || '') ? clean(e.logo_url, 400) : '',
      address: clean(loc.address || inferred.formatted_address, 200),
      city: clean(inferred.locality || (e.locality || '').split(',')[0], 80),
      state: clean(inferred.admin_district, 60),
      postalCode: clean(inferred.postal_code, 12),
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    };
  }

  function score(p, categoryId, radiusMiles) {
    const cat = catConfig(categoryId) || config.categories.other;
    const notes = [];
    let s = 0;
    if (p.distanceMiles == null) { s += 10; notes.push('location unknown'); } else { const d = Math.max(0, 40 * (1 - p.distanceMiles / radiusMiles)); s += d; notes.push(`${p.distanceMiles} mi away`); }
    const sizePts = { 1: 15, '2-10': 25, '11-50': 22, '51-200': 12 }[p.size] ?? 4;
    s += sizePts; if (sizePts >= 22) notes.push('local-sized business');
    const hay = `${p.specialties.join(' ')} ${p.description}`.toLowerCase();
    const hits = (cat.keywords || []).filter((k) => hay.includes(k.toLowerCase()));
    s += Math.min(20, hits.length * 5); if (hits.length) notes.push(`mentions ${hits.slice(0, 3).join(', ')}`);
    if (p.website) s += 5;
    if (p.logoUrl) s += 3;
    s += { '0-500K': 2, '500K-1M': 7, '1M-5M': 8, '5M-10M': 7 }[p.revenue] ?? 4;
    if (cat.industries?.length && p.industry && !cat.industries.includes(p.industry)) { s -= 10; notes.push(`industry: ${p.industry}`); }
    return { score: Math.round(s), scoreNotes: notes };
  }

  function pickSpecialty(p) {
    const cat = catConfig(p.categoryId) || config.categories.other;
    const kws = (cat.keywords || []).map((k) => k.toLowerCase());
    return p.specialties.find((s) => kws.some((k) => s.toLowerCase().includes(k))) || p.specialties[0] || '';
  }

  // ---------- the run ----------

  function startRun(input) {
    if (!clay) throw new Error('Clay is not configured on the server (set CLAY_API_KEY).');
    const machine = machineById(clean(input.machineId, 80));
    if (!machine) throw new Error('Unknown machine');
    const category = categoryById(clean(input.categoryId, 40));
    if (!category) throw new Error('Unknown category');
    if (!catConfig(category.id)) throw new Error(`No search settings for "${category.label}" yet — add it to server/prospecting-config.js`);
    const limit = Math.max(1, Math.min(config.defaults.maxLimit, Math.round(Number(input.limit) || config.defaults.limit)));
    const radiusMiles = Math.max(1, Math.min(100, Number(input.radiusMiles) || config.defaults.radiusMiles));
    const runs = readRuns();
    if (activeRunId && runs.some((r) => r.id === activeRunId && RUN_ACTIVE.includes(r.status))) throw new Error('A lead search is already running — wait for it to finish.');
    const run = {
      id: newId('R'), categoryId: category.id, machineId: machine.id, limit, radiusMiles,
      findEmails: input.findEmails !== false, findPhones: input.findPhones !== false,
      status: 'queued', step: 'Starting…', progress: { done: 0, total: 0 },
      counts: { candidates: 0, enriched: 0, inRadius: 0, saved: 0, contacts: 0, emailsFound: 0, phonesFound: 0 },
      creditsUsed: 0, error: '', startedAt: nowISO(), finishedAt: '', prospectIds: [],
    };
    runs.push(run); writeRuns(runs);
    activeRunId = run.id;
    executeRun(run.id).catch((err) => log('[prospecting] run crashed', err));
    return run;
  }

  function updateRun(id, patch) {
    const runs = readRuns();
    const r = runs.find((x) => x.id === id);
    if (!r) return null;
    Object.assign(r, typeof patch === 'function' ? patch(r) : patch);
    writeRuns(runs);
    return r;
  }

  async function executeRun(runId) {
    let run = readRuns().find((r) => r.id === runId);
    const machine = machineById(run.machineId);
    const hasGeo = Number.isFinite(machine.lat) && Number.isFinite(machine.lng);
    const credits = (key, n) => { run = updateRun(runId, (r) => ({ creditsUsed: Math.round((r.creditsUsed + (config.creditEstimates[key] || 0) * n) * 10) / 10 })); };
    try {
      // 1. Search (free)
      run = updateRun(runId, { status: 'searching', step: 'Searching Clay for businesses…' });
      const existing = readProspects();
      const excluded = readExcluded();
      const known = new Set([...existing.map((p) => p.domain).filter(Boolean), ...Object.keys(excluded)]);
      const max = Math.min(config.defaults.maxCandidates, run.limit * config.defaults.candidateMultiplier + known.size);
      const found = await clay.searchAll(companyQuery({ categoryId: run.categoryId, machineId: run.machineId, max }), { max });
      const seen = new Set();
      const candidates = [];
      for (const c of found) {
        const domain = normalizeDomain(c.domain);
        if (!domain || known.has(domain) || seen.has(domain)) continue;
        seen.add(domain);
        candidates.push({ id: newId('P'), clayCompanyId: c.clay_company_id || null, business: clean(c.name, 160), domain, website: domain ? `https://${domain}` : '', linkedinUrl: clean(c.linkedin_url, 300), industry: clean(c.industry, 120), size: clean(c.size, 40), revenue: clean(c.annual_revenue, 40), description: clean(c.description, 600), city: clean(String(c.location || '').split(',')[0], 80), specialties: [] });
      }
      run = updateRun(runId, { counts: { ...run.counts, candidates: candidates.length }, progress: { done: 0, total: candidates.length } });
      if (!candidates.length) throw new Error(found.length ? 'Every business Clay found is already in your prospect list or was ruled out earlier (outside the radius).' : 'Clay found no businesses for this category and area. Loosen the keywords in server/prospecting-config.js.');

      // 2. Enrich (0.5 credit each) → address, coordinates, logo, specialties
      run = updateRun(runId, { status: 'enriching', step: `Pulling addresses & details for ${candidates.length} businesses…` });
      const enriched = await clay.runRoutine(config.routines.enrichCompany, candidates.slice(0, config.defaults.maxCandidates).map((c) => ({ id: c.id, inputs: { 'Company Identifier': c.domain } })));
      credits('enrichCompany', enriched.size);
      let enrichedCount = 0;
      for (const c of candidates) {
        const r = enriched.get(c.id);
        if (r?.status === 'complete' && r.result) {
          enrichedCount++;
          const e = fromEnrich(r.result);
          for (const [k, v] of Object.entries(e)) if (v !== '' && v !== null && !(Array.isArray(v) && !v.length)) c[k] = v;
        }
        c.distanceMiles = hasGeo && c.lat != null ? Math.round(haversineMiles(machine.lat, machine.lng, c.lat, c.lng) * 10) / 10 : null;
      }

      // 3. Distance filter + score
      const inRadius = candidates.filter((c) => c.distanceMiles == null || c.distanceMiles <= run.radiusMiles);
      for (const c of candidates) if (!inRadius.includes(c)) excluded[c.domain] = { business: c.business, reason: `${c.distanceMiles} mi from ${machine.name}`, at: nowISO() };
      writeJson(EXCLUDED_FILE, excluded);
      for (const c of inRadius) Object.assign(c, score(c, run.categoryId, run.radiusMiles));
      inRadius.sort((a, b) => b.score - a.score || (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999));
      const chosen = inRadius.slice(0, run.limit);
      run = updateRun(runId, { counts: { ...run.counts, enriched: enrichedCount, inRadius: inRadius.length }, progress: { done: 0, total: chosen.length } });
      if (!chosen.length) throw new Error(`Found ${candidates.length} businesses but none within ${run.radiusMiles} miles of ${machine.name}. Try a larger radius.`);

      // 4. Decision-makers (free searches, one per company)
      run = updateRun(runId, { status: 'contacts', step: 'Finding owners & decision-makers…' });
      let contactCount = 0;
      for (const [i, c] of chosen.entries()) {
        c.contacts = [];
        try {
          const people = await clay.searchAll(peopleQuery(c.domain, run.categoryId, 8), { max: 8 });
          c.contacts = people.map((p) => {
            const exp = (p.matched_experiences || [])[0] || {};
            return { name: clean(p.name || `${p.first_name || ''} ${p.last_name || ''}`, 120), firstName: clean(p.first_name, 60) || firstNameOf(p.name), title: clean(exp.title, 120), linkedinUrl: clean(p.linkedin_url, 300), city: clean(p.location?.city, 80), email: '', emailSource: '', mobile: '', rank: rankTitle(exp.title, run.categoryId) };
          }).filter((p) => p.name).sort((a, b) => a.rank - b.rank).slice(0, config.defaults.contactsPerCompany).map(({ rank, ...p }) => p);
        } catch (err) { log(`[prospecting] people search failed for ${c.domain}: ${err.message}`); }
        contactCount += c.contacts.length;
        run = updateRun(runId, { progress: { done: i + 1, total: chosen.length } });
        await sleep(150);
      }

      // 5. Work emails (1.1 credits each) for the primary contact
      let emailsFound = 0;
      if (run.findEmails) {
        run = updateRun(runId, { status: 'emails', step: 'Looking up work emails…' });
        const items = chosen.filter((c) => c.contacts[0]).map((c) => ({ id: c.id, inputs: { 'Full Name': c.contacts[0].name, 'Company Domain': c.domain, 'Company Name': c.business, ...(c.contacts[0].linkedinUrl ? { 'Social Profile URL': c.contacts[0].linkedinUrl } : {}) } }));
        if (items.length) {
          const results = await clay.runRoutine(config.routines.workEmail, items);
          credits('workEmail', results.size);
          for (const c of chosen) {
            const r = results.get(c.id);
            const email = r?.status === 'complete' ? Object.values(r.result || {}).find((v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) : '';
            if (email) { c.contacts[0].email = email.toLowerCase(); c.contacts[0].emailSource = 'clay'; emailsFound++; }
          }
        }
      }

      // 6. Business phone from the website (free)
      let phonesFound = 0;
      if (run.findPhones) {
        run = updateRun(runId, { status: 'phones', step: 'Reading phone numbers off their websites…', progress: { done: 0, total: chosen.length } });
        let done = 0;
        const queue = [...chosen];
        await Promise.all(Array.from({ length: 4 }, async () => {
          while (queue.length) {
            const c = queue.shift();
            const phone = await findWebsitePhone(c.website, { timeoutMs: config.defaults.websitePhoneTimeoutMs, fetchImpl });
            if (phone) { c.phone = phone.display; c.phoneE164 = phone.e164; c.phoneSource = phone.source; phonesFound++; }
            run = updateRun(runId, { progress: { done: ++done, total: chosen.length } });
          }
        }));
      }

      // 7. Save
      const ts = nowISO();
      const prospects = readProspects();
      for (const c of chosen) {
        prospects.push({ ...c, runId, categoryId: run.categoryId, machineId: run.machineId, phone: c.phone || '', phoneE164: c.phoneE164 || '', phoneSource: c.phoneSource || '', status: 'new', drafts: null, previewToken: '', outreach: [], nextFollowUpAt: '', notes: '', createdAt: ts, updatedAt: ts });
      }
      writeProspects(prospects);
      run = updateRun(runId, { status: 'done', step: `Done — ${chosen.length} leads saved`, finishedAt: ts, prospectIds: chosen.map((c) => c.id), counts: { ...run.counts, saved: chosen.length, contacts: contactCount, emailsFound, phonesFound } });
      log(`[prospecting] run ${runId}: ${chosen.length} ${run.categoryId} leads (${run.creditsUsed} credits)`);
    } catch (err) {
      log(`[prospecting] run ${runId} failed: ${err.message}`);
      updateRun(runId, { status: 'failed', step: 'Failed', error: err.message, finishedAt: nowISO() });
    } finally {
      if (activeRunId === runId) activeRunId = null;
    }
  }

  // ---------- drafts / mockup ----------

  function previewUrl(p) { return `${siteUrl}/preview/${p.previewToken}`; }

  function mockupSpec(p) {
    const machine = machineById(p.machineId) || { name: p.machineId, city: '', address: '' };
    const category = categoryById(p.categoryId) || { id: p.categoryId, label: p.categoryId, icon: 'sparkles' };
    const pitch = (catConfig(p.categoryId) || config.categories.other).pitch;
    return {
      business: p.business, tagline: pickSpecialty(p) || pitch.tagline, cta: pitch.cta, phone: p.phone || '', city: p.city || '', website: p.domain || '',
      categoryId: category.id, categoryLabel: category.label, categoryIcon: category.icon, hasLogo: Boolean(p.logoUrl),
      machine: { name: machine.name, city: machine.city, address: machine.address || '', venueType: machine.venueType || '' },
      price: price(), plays: playsFor(machine), bannerSeconds: ads.bannerSeconds, bannerSize: ads.bannerSize, siteUrl,
    };
  }

  function draftContext(p) {
    const spec = mockupSpec(p);
    const contact = p.contacts?.[0] || {};
    return {
      firstName: contact.firstName || firstNameOf(contact.name), contactName: contact.name || '', title: contact.title || '',
      business: p.business, category: spec.categoryLabel, pitch: (catConfig(p.categoryId) || config.categories.other).pitch,
      specialty: pickSpecialty(p), machine: spec.machine, price: spec.price, plays: spec.plays, bannerSeconds: spec.bannerSeconds,
      previewUrl: previewUrl(p), siteUrl, sender: config.sender, distanceMiles: p.distanceMiles,
    };
  }

  function generateDrafts({ ids, categoryId, status: onlyStatus = 'new' } = {}) {
    const prospects = readProspects();
    const targets = prospects.filter((p) => (ids ? ids.includes(p.id) : (!categoryId || p.categoryId === categoryId) && (!onlyStatus || p.status === onlyStatus)));
    const ts = nowISO();
    for (const p of targets) {
      if (!p.previewToken) p.previewToken = crypto.randomBytes(12).toString('hex');
      const ctx = draftContext(p);
      p.drafts = { email: templates.email(ctx), followUpEmail: templates.followUpEmail(ctx), sms: templates.sms(ctx), followUpSms: templates.followUpSms(ctx), linkedin: templates.linkedin(ctx), generatedAt: ts };
      if (p.status === 'new') p.status = 'drafted';
      p.updatedAt = ts;
    }
    writeProspects(prospects);
    return targets;
  }

  // ---------- prospect edits ----------

  function patchProspect(id, body) {
    const prospects = readProspects();
    const p = prospects.find((x) => x.id === id);
    if (!p) return null;
    if (body.status !== undefined) { if (!PROSPECT_STATUSES.includes(body.status)) throw new Error('Invalid status'); p.status = body.status; if (['won', 'lost', 'skipped', 'replied'].includes(p.status)) p.nextFollowUpAt = ''; }
    if (body.notes !== undefined) p.notes = clean(body.notes, 4000);
    if (body.nextFollowUpAt !== undefined) { const v = clean(body.nextFollowUpAt, 10); if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('nextFollowUpAt must be YYYY-MM-DD'); p.nextFollowUpAt = v; }
    if (body.phone !== undefined) { const ph = normalizePhone(body.phone); p.phone = ph ? ph.display : clean(body.phone, 40); p.phoneE164 = ph ? ph.e164 : ''; p.phoneSource = p.phone ? 'manual' : ''; }
    if (body.business !== undefined) { const b = clean(body.business, 160); if (!b) throw new Error('Business name is required'); p.business = b; }
    if (body.website !== undefined) p.website = clean(body.website, 300);
    if (Array.isArray(body.contacts)) {
      p.contacts = body.contacts.slice(0, 6).map((c) => ({ name: clean(c.name, 120), firstName: clean(c.firstName, 60) || firstNameOf(c.name), title: clean(c.title, 120), linkedinUrl: clean(c.linkedinUrl, 300), city: clean(c.city, 80), email: clean(c.email, 254).toLowerCase(), emailSource: clean(c.emailSource, 20) || (c.email ? 'manual' : ''), mobile: clean(c.mobile, 40) })).filter((c) => c.name);
    }
    if (body.drafts && typeof body.drafts === 'object' && p.drafts) {
      const d = body.drafts;
      if (d.email) p.drafts.email = { subject: clean(d.email.subject, 200), body: String(d.email.body || '').slice(0, 6000) };
      if (d.followUpEmail) p.drafts.followUpEmail = { subject: clean(d.followUpEmail.subject, 200), body: String(d.followUpEmail.body || '').slice(0, 6000) };
      if (d.sms !== undefined) p.drafts.sms = String(d.sms).slice(0, 1000);
      if (d.followUpSms !== undefined) p.drafts.followUpSms = String(d.followUpSms).slice(0, 1000);
      if (d.linkedin) p.drafts.linkedin = { note: String(d.linkedin.note || '').slice(0, 300), message: String(d.linkedin.message || '').slice(0, 4000) };
    }
    p.updatedAt = nowISO();
    writeProspects(prospects);
    return p;
  }

  // "Send" = the admin copied/opened the draft; we record the touch and schedule the follow-up.
  function logOutreach(id, body) {
    const channel = clean(body.channel, 20);
    if (!OUTREACH_CHANNELS.includes(channel)) throw new Error('Invalid channel');
    const prospects = readProspects();
    const p = prospects.find((x) => x.id === id);
    if (!p) return null;
    const ts = nowISO();
    p.outreach.push({ channel, at: ts, note: clean(body.note, 500), followUp: p.outreach.length > 0 });
    if (['new', 'drafted', 'contacted'].includes(p.status)) p.status = 'contacted';
    const days = Math.max(1, Math.min(30, Math.round(Number(body.followUpDays) || config.defaults.followUpDays)));
    const due = new Date(); due.setDate(due.getDate() + days);
    p.nextFollowUpAt = due.toISOString().slice(0, 10);
    p.updatedAt = ts;
    writeProspects(prospects);
    return p;
  }

  function deleteProspect(id) {
    const prospects = readProspects();
    const next = prospects.filter((p) => p.id !== id);
    if (next.length === prospects.length) return false;
    writeProspects(next);
    return true;
  }

  async function findMobile(id, contactIndex = 0) {
    if (!clay) throw new Error('Clay is not configured on the server (set CLAY_API_KEY).');
    const prospects = readProspects();
    const p = prospects.find((x) => x.id === id);
    if (!p) return null;
    const c = p.contacts[Number(contactIndex) || 0];
    if (!c) throw new Error('No contact to look up');
    if (!c.linkedinUrl) throw new Error('Clay needs the contact\'s LinkedIn URL to find a mobile number');
    const results = await clay.runRoutine(config.routines.mobilePhone, [{ id: p.id, inputs: { 'Social Profile URL': c.linkedinUrl, 'Full Name': c.name, 'Company Name': p.business, 'Company Domain': p.domain, ...(c.email ? { 'Work Email': c.email } : {}) } }]);
    const r = results.get(p.id);
    const raw = r?.status === 'complete' ? Object.values(r.result || {}).find((v) => typeof v === 'string' && v.replace(/\D/g, '').length >= 10) : '';
    const ph = normalizePhone(raw);
    c.mobile = ph ? ph.display : clean(raw, 40);
    c.mobileE164 = ph ? ph.e164 : '';
    p.updatedAt = nowISO();
    writeProspects(prospects);
    return { prospect: p, found: Boolean(c.mobile), creditsUsed: config.creditEstimates.mobilePhone };
  }

  // ---------- public preview ----------

  function previewByToken(token) {
    if (!/^[a-f0-9]{24}$/.test(token || '')) return null;
    const p = readProspects().find((x) => x.previewToken === token);
    return p ? { prospect: p, spec: mockupSpec(p) } : null;
  }

  // Logos come from Clay's CDN; proxy + cache them so the canvas stays same-origin (exportable).
  async function logoFor(p) {
    if (!p?.logoUrl) return null;
    const cached = fs.readdirSync(LOGO_DIR).find((f) => f.startsWith(`${p.id}.`));
    if (cached) return { file: path.join(LOGO_DIR, cached), type: { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif' }[cached.split('.').pop()] || 'application/octet-stream' };
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetchImpl(p.logoUrl, { signal: ctrl.signal, redirect: 'follow' });
      clearTimeout(timer);
      if (!res.ok) return null;
      const type = (res.headers.get('content-type') || '').split(';')[0].trim();
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' }[type];
      if (!ext) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > 3 * 1024 * 1024) return null;
      const file = path.join(LOGO_DIR, `${p.id}.${ext}`);
      fs.writeFileSync(file, buf);
      return { file, type };
    } catch {
      return null;
    }
  }

  return {
    status, startRun, readRuns, readProspects, patchProspect, deleteProspect, generateDrafts, logOutreach, findMobile, mockupSpec, previewByToken, logoFor, previewUrl,
    PROSPECT_STATUSES, OUTREACH_CHANNELS,
  };
}

module.exports = { createProspecting, haversineMiles, extractPhone, normalizePhone, normalizeDomain, findWebsitePhone };
