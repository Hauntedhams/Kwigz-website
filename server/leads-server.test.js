const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync, readFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const vm = require('node:vm');

const password = 'integration-test-password-only-123456';
const serverFile = path.join(__dirname, 'leads-server.js');

test('campaign modal clears hidden identity for add, booking, applications, and renewals', () => {
  const html = readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
  const start = html.indexOf('  function openCampaignModal(');
  const end = html.indexOf("  $('#campaignCancel').addEventListener", start);
  assert.ok(start >= 0 && end > start);
  const fields = {};
  for (const name of ['id', 'leadId', 'business', 'start', 'end', 'estPlays']) {
    let value = '';
    let defaultValue = '';
    const hidden = ['id', 'leadId'].includes(name);
    fields[name] = {
      dataset: {},
      get value() { return value; },
      set value(next) {
        value = String(next);
        // Hidden inputs use the default value mode: setting value changes the reset value.
        if (hidden) defaultValue = value;
      },
      reset() { value = defaultValue; },
    };
  }
  const elements = { ...fields, namedItem: (name) => fields[name] };
  const nodes = {};
  const context = {
    form: {
      ...fields, elements,
      reset: () => Object.values(fields).forEach((field) => field.reset()),
    },
    $: (selector) => (nodes[selector] ||= {}),
    ADS: { machines: [{ id: 'machine' }], categories: [{ id: 'category' }], budgets: [{ amount: 200 }], approvalDays: 3, campaignDays: 30 },
    todayISO: '2099-01-01',
    addDays: (date) => date,
    recalcModal: () => {},
    modal: { showModal: () => {} },
  };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  const open = context.openCampaignModal;
  const existing = { id: 'C-existing', leadId: 'L-existing', business: 'Existing' };
  open(existing, { isEdit: true });
  assert.equal(fields.id.value, 'C-existing');
  assert.equal(fields.leadId.value, 'L-existing');
  for (const data of [{}, { categoryId: 'category' }, { leadId: 'L-new' }, { ...existing, id: undefined }]) {
    open(existing, { isEdit: true });
    open(data);
    assert.equal(fields.id.value, '', 'new campaign must POST, never PATCH the previously edited campaign');
    assert.equal(fields.leadId.value, data.leadId || '', 'lead identity must come from the new campaign');
  }
  open(existing, { isEdit: true });
  open(existing);
  assert.equal(fields.id.value, '', 'only explicit edit mode may retain a campaign ID');
});

async function start(dataDir, extraEnv = {}) {
  const child = spawn(process.execPath, [serverFile], {
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ADMIN_PASSWORD: password, NODE_ENV: 'production', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Server startup timed out')), 10000);
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
    });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(output)); });
  });
  return { base, child };
}

async function stop(child) {
  if (child.exitCode !== null) return;
  await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
}

test('campaign pricing preserves original play allocations at the higher prices', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'kwigz-pricing-'));
  let instance;
  try {
    instance = await start(dataDir);
    const config = { window: {} };
    vm.runInNewContext(readFileSync(path.join(__dirname, '..', 'ads-config.js'), 'utf8'), config);
    assert.equal(JSON.stringify(config.window.KWIGZ_ADS.budgets), JSON.stringify([
      { amount: 200, units: 1 }, { amount: 300, units: 1.5 }, { amount: 400, units: 2 },
    ]));
    for (const [budget, units, estPlays, categoryId] of [
      [200, 1, 11520, 'tattoo'], [300, 1.5, 17280, 'hvac'], [400, 2, 23040, 'plumbing'],
    ]) {
      const response = await fetch(`${instance.base}/api/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${password}` },
        body: JSON.stringify({
          machineId: 'chopper-johns-phoenix', categoryId, business: 'Pricing test',
          budget, units: 999, start: '2099-01-01', end: '2099-01-30',
        }),
      });
      assert.equal(response.status, 201);
      const { campaign } = await response.json();
      assert.equal(campaign.budget, budget);
      assert.equal(campaign.units, units);
      assert.equal(campaign.estPlays, estPlays);
    }
  } finally {
    if (instance) await stop(instance.child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('Stripe mode recognizes standard and restricted live and test keys', async () => {
  for (const [key, mode] of [
    ['sk_live_mock', 'live'], ['rk_live_mock', 'live'],
    ['sk_test_mock', 'test'], ['rk_test_mock', 'test'],
  ]) {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'kwigz-mode-'));
    let instance;
    try {
      instance = await start(dataDir, { STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: 'whsec_mock' });
      const response = await fetch(`${instance.base}/api/campaigns`, {
        headers: { Authorization: `Bearer ${password}` },
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).stripe.mode, mode);
    } finally {
      if (instance) await stop(instance.child);
      rmSync(dataDir, { recursive: true, force: true });
    }
  }
});

test('production API protects private files and persists valid leads and campaigns', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'kwigz-test-'));
  let instance;
  try {
    instance = await start(dataDir);
    const request = (url, { method = 'GET', data, auth = false } = {}) => fetch(instance.base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${password}` } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    assert.equal((await request('/healthz')).status, 200);
    for (const file of ['/', '/about.html', '/icons.svg', '/admin']) assert.equal((await request(file)).status, 200);
    for (const file of ['/.git/config', '/.env', '/server/leads-server.js', '/server/data/leads.jsonl', '/package.json']) {
      assert.equal((await request(file)).status, 404, file);
    }
    for (const route of ['/api/leads', '/api/campaigns', '/api/leads.csv', '/api/uploads/test.png']) {
      assert.equal((await request(route)).status, 401, route);
    }
    assert.equal((await request('/api/admin/login', { method: 'POST', data: { password: 'incorrect' } })).status, 401);
    assert.equal((await request('/api/admin/login', { method: 'POST', data: { password } })).status, 200);
    assert.equal((await request('/api/leads', { method: 'POST', data: null })).status, 400);
    assert.equal((await request('/api/leads', { method: 'POST', data: { email: 'invalid' } })).status, 400);
    assert.equal((await request('/api/leads', {
      method: 'POST', data: { email: 'test@example.com', banner: { dataUrl: 'data:image/png;base64,dGVzdA==' } },
    })).status, 400);
    const submitted = await request('/api/leads', {
      method: 'POST', data: { email: 'test@example.com', type: 'business', venue: '=formula', id: 'spoof', receivedAt: 'spoof' },
    });
    assert.equal(submitted.status, 201);
    const leadId = (await submitted.json()).id;
    assert.notEqual(leadId, 'spoof');
    const list = await (await request('/api/leads', { auth: true })).json();
    assert.equal(list.leads.length, 1);
    assert.notEqual(list.leads[0].receivedAt, 'spoof');
    const csv = await (await request('/api/leads.csv', { auth: true })).text();
    assert.ok(csv.includes("'=formula"));
    assert.equal((await request(`/api/leads/${leadId}`, { auth: true, method: 'PATCH', data: { status: 'contacted', notes: 'Follow up' } })).status, 200);
    const campaign = {
      machineId: 'chopper-johns-phoenix', categoryId: 'tattoo', business: 'Test business',
      budget: 200, units: 999, start: '2099-01-01', end: '2099-01-30',
      status: 'pending', paymentStatus: 'unpaid', creativeStatus: 'pending',
    };
    for (const changes of [{ start: '2099-02-30' }, { budget: 1 }, { budget: 100 }, { budget: 150 }, { machineId: 'unknown' }, { categoryId: 'unknown' }]) {
      assert.equal((await request('/api/campaigns', { method: 'POST', auth: true, data: { ...campaign, ...changes } })).status, 400);
    }
    const created = await request('/api/campaigns', { method: 'POST', auth: true, data: campaign });
    assert.equal(created.status, 201);
    const saved = (await created.json()).campaign;
    assert.equal(saved.units, 1);
    assert.equal(saved.estPlays, 11520);
    assert.equal((await request('/api/campaigns', { method: 'POST', auth: true, data: { ...campaign, force: true } })).status, 409);
    const availability = await (await request('/api/availability')).json();
    assert.deepEqual(availability.machines[0].takenCategories, ['tattoo']);
    await stop(instance.child);
    instance = await start(dataDir);
    const persisted = await (await request('/api/leads', { auth: true })).json();
    assert.equal(persisted.leads[0].notes, 'Follow up');
    assert.equal((await (await request('/api/campaigns', { auth: true })).json()).campaigns.length, 1);
    assert.ok(readFileSync(path.join(dataDir, 'leads.jsonl'), 'utf8').includes(leadId));
  } finally {
    if (instance) await stop(instance.child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

// Minimal stand-in for api.stripe.com: records requests, returns Stripe-shaped objects.
function startMockStripe() {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const params = Object.fromEntries(new URLSearchParams(body));
      calls.push({ method: req.method, path: req.url, auth: req.headers.authorization, params });
      const reply = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url === '/prices') return reply({ id: 'price_mock', unit_amount: Number(params.unit_amount) });
      if (req.url === '/payment_links') {
        if (params['managed_payments[enabled]'] !== 'false') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          const message = Object.keys(params).some((key) => key.startsWith('custom_text['))
            ? 'custom_text cannot be used with Managed Payments'
            : 'Invalid line_items[0]: the product tax code is missing. Product tax code is required for Managed Payments.';
          return res.end(JSON.stringify({ error: { message } }));
        }
        return reply({ id: 'plink_mock', url: 'https://buy.stripe.com/test_mock', active: true });
      }
      if (req.url.startsWith('/payment_links/')) return reply({ id: req.url.split('/')[2], active: false });
      if (req.url.startsWith('/subscriptions/')) {
        return reply(req.method === 'DELETE'
          ? { id: 'sub_mock', status: 'canceled' }
          : { id: 'sub_mock', status: 'active', cancel_at_period_end: true, current_period_end: Math.floor(Date.parse('2099-02-01T00:00:00Z') / 1000) });
      }
      res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: `mock: unknown ${req.url}` } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, base: `http://127.0.0.1:${server.address().port}` })));
}

test('stripe payment links, signed webhooks, and billing shutdown', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'kwigz-stripe-'));
  const webhookSecret = 'whsec_test_secret';
  const mock = await startMockStripe();
  let instance;
  try {
    instance = await start(dataDir, { STRIPE_SECRET_KEY: 'sk_test_mock', STRIPE_WEBHOOK_SECRET: webhookSecret, STRIPE_API_BASE: mock.base, SITE_URL: 'https://example.test/' });
    const request = (url, { method = 'GET', data, auth = false, headers = {}, raw } = {}) => fetch(instance.base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${password}` } : {}), ...headers },
      body: raw !== undefined ? raw : data === undefined ? undefined : JSON.stringify(data),
    });
    const signed = (event) => {
      const payload = JSON.stringify(event);
      const t = Math.floor(Date.now() / 1000);
      const v1 = crypto.createHmac('sha256', webhookSecret).update(`${t}.${payload}`).digest('hex');
      return request('/api/stripe/webhook', { method: 'POST', raw: payload, headers: { 'Stripe-Signature': `t=${t},v1=${v1}` } });
    };
    const getCampaign = async (id) => (await (await request('/api/campaigns', { auth: true })).json()).campaigns.find((c) => c.id === id);

    assert.equal((await request('/payment-complete.html')).status, 200);
    const info = await (await request('/api/campaigns', { auth: true })).json();
    assert.deepEqual(info.stripe, { enabled: true, mode: 'test', webhook: true });

    const base = { machineId: 'chopper-johns-phoenix', business: 'Desert Ink', contactName: 'Sam', budget: 300, start: '2099-01-01', end: '2099-01-30' };
    const noEmail = (await (await request('/api/campaigns', { method: 'POST', auth: true, data: { ...base, categoryId: 'tattoo' } })).json()).campaign;
    assert.equal((await request(`/api/campaigns/${noEmail.id}/payment-link`, { method: 'POST', auth: true })).status, 400);
    assert.equal((await request(`/api/campaigns/${noEmail.id}/payment-link`, { method: 'POST' })).status, 401);

    const c = (await (await request('/api/campaigns', { method: 'POST', auth: true, data: { ...base, categoryId: 'hvac', email: 'sam@example.com' } })).json()).campaign;
    const linkRes = await request(`/api/campaigns/${c.id}/payment-link`, { method: 'POST', auth: true });
    assert.equal(linkRes.status, 200);
    const link = await linkRes.json();
    assert.equal(link.mode, 'test');
    assert.equal(link.url, `https://buy.stripe.com/test_mock?client_reference_id=${c.id}&prefilled_email=sam%40example.com`);
    assert.match(link.email.subject, /HVAC at Chopper John's/);
    assert.ok(link.email.body.includes(link.url) && link.email.body.includes('$300/month') && link.email.body.includes('Hi Sam'));
    assert.ok(link.email.body.includes('ASAP') && !/business days/.test(link.email.body));
    assert.equal(c.units, 1.5);
    assert.equal(c.estPlays, 17280);
    assert.ok(link.email.body.includes('1.5x rotation') && link.email.body.includes('17,280'));
    const priceCall = mock.calls.find((x) => x.path === '/prices');
    assert.equal(priceCall.auth, 'Bearer sk_test_mock');
    assert.equal(priceCall.params.unit_amount, '30000');
    assert.equal(priceCall.params['recurring[interval]'], 'month');
    const linkCall = mock.calls.find((x) => x.path === '/payment_links');
    assert.equal(linkCall.params['managed_payments[enabled]'], 'false');
    assert.ok(!Object.keys(linkCall.params).some((key) => key.startsWith('custom_text[')));
    assert.equal(linkCall.params['line_items[0][price]'], 'price_mock');
    assert.equal(linkCall.params['restrictions[completed_sessions][limit]'], '1');
    assert.equal(linkCall.params['subscription_data[metadata][campaignId]'], c.id);
    assert.equal(linkCall.params['after_completion[redirect][url]'], 'https://example.test/payment-complete.html?session_id={CHECKOUT_SESSION_ID}');
    // Re-sending reuses the stored link instead of creating another one.
    const before = mock.calls.length;
    assert.equal((await (await request(`/api/campaigns/${c.id}/payment-link`, { method: 'POST', auth: true })).json()).url, link.url);
    assert.equal(mock.calls.length, before);

    // Webhook security.
    assert.equal((await request('/api/stripe/webhook', { method: 'POST', raw: '{}' })).status, 400);
    assert.equal((await request('/api/stripe/webhook', { method: 'POST', raw: '{}', headers: { 'Stripe-Signature': `t=${Math.floor(Date.now() / 1000)},v1=deadbeef` } })).status, 400);
    const stale = Math.floor(Date.now() / 1000) - 3600;
    const staleSig = crypto.createHmac('sha256', webhookSecret).update(`${stale}.{}`).digest('hex');
    assert.equal((await request('/api/stripe/webhook', { method: 'POST', raw: '{}', headers: { 'Stripe-Signature': `t=${stale},v1=${staleSig}` } })).status, 400);
    assert.equal((await getCampaign(c.id)).paymentStatus, 'unpaid');

    // Customer pays → campaign flips to paid with the subscription attached.
    assert.equal((await signed({ type: 'checkout.session.completed', data: { object: { client_reference_id: c.id, customer: 'cus_mock', subscription: 'sub_mock', payment_link: 'plink_mock', customer_details: { email: 'sam@example.com' } } } })).status, 200);
    let saved = await getCampaign(c.id);
    assert.equal(saved.paymentStatus, 'paid');
    assert.equal(saved.stripeSubscriptionId, 'sub_mock');
    assert.equal(saved.stripeCustomerId, 'cus_mock');
    assert.equal(saved.subscriptionStatus, 'active');
    assert.equal((await request(`/api/campaigns/${c.id}/payment-link`, { method: 'POST', auth: true })).status, 400);

    // Monthly renewal extends the slot by one campaign period; retries of the same invoice don't double-extend.
    const renewal = { type: 'invoice.paid', data: { object: { id: 'in_2', billing_reason: 'subscription_cycle', subscription: 'sub_mock' } } };
    assert.equal((await signed(renewal)).status, 200);
    assert.equal((await getCampaign(c.id)).end, '2099-03-01');
    assert.equal((await signed(renewal)).status, 200);
    assert.equal((await getCampaign(c.id)).end, '2099-03-01');
    // Newer API shape (parent.subscription_details) is understood too.
    assert.equal((await signed({ type: 'invoice.paid', data: { object: { id: 'in_3', billing_reason: 'subscription_cycle', parent: { subscription_details: { subscription: 'sub_mock' } } } } })).status, 200);
    assert.equal((await getCampaign(c.id)).end, '2099-03-31');

    assert.equal((await signed({ type: 'invoice.payment_failed', data: { object: { id: 'in_4', subscription: 'sub_mock' } } })).status, 200);
    assert.equal((await getCampaign(c.id)).paymentStatus, 'past-due');
    assert.equal((await signed({ type: 'invoice.paid', data: { object: { id: 'in_4', billing_reason: 'subscription_cycle', subscription: 'sub_mock' } } })).status, 200);
    assert.equal((await getCampaign(c.id)).paymentStatus, 'paid');

    // Unknown events and unmatched campaigns are acknowledged without changes.
    assert.equal((await signed({ type: 'charge.refunded', data: { object: { id: 'ch_1' } } })).status, 200);
    assert.equal((await signed({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'C-nope' } } })).status, 200);

    // Admin stops billing → Stripe asked to cancel at period end.
    assert.equal((await request(`/api/campaigns/${c.id}/stop-billing`, { method: 'POST', auth: true, data: {} })).status, 200);
    saved = await getCampaign(c.id);
    assert.equal(saved.billingEndsAt, '2099-02-01');
    assert.equal(mock.calls.at(-1).params.cancel_at_period_end, 'true');
    assert.equal((await signed({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_mock' } } })).status, 200);
    saved = await getCampaign(c.id);
    assert.equal(saved.subscriptionStatus, 'canceled');
    assert.equal(saved.status, 'pending', 'paid campaigns are not cancelled when billing stops — they run out their end date');

    // Cancelling an unpaid campaign with a link deactivates the link so nobody pays for a dead slot.
    const other = (await (await request('/api/campaigns', { method: 'POST', auth: true, data: { ...base, categoryId: 'plumbing', email: 'pat@example.com' } })).json()).campaign;
    assert.equal((await request(`/api/campaigns/${other.id}/payment-link`, { method: 'POST', auth: true })).status, 200);
    assert.equal((await request(`/api/campaigns/${other.id}`, { method: 'PATCH', auth: true, data: { status: 'cancelled' } })).status, 200);
    assert.ok(mock.calls.some((x) => x.path === '/payment_links/plink_mock' && x.params.active === 'false'));
    assert.equal((await request(`/api/campaigns/${other.id}/stop-billing`, { method: 'POST', auth: true, data: {} })).status, 400);
  } finally {
    if (instance) await stop(instance.child);
    await new Promise((resolve) => mock.server.close(resolve));
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('production with a Stripe key requires the webhook secret', async () => {
  const child = spawn(process.execPath, [serverFile], {
    env: { ...process.env, NODE_ENV: 'production', DATA_DIR: tmpdir(), ADMIN_PASSWORD: password, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: '' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', chunk => { output += chunk; });
  const code = await new Promise(resolve => child.once('exit', resolve));
  assert.notEqual(code, 0);
  assert.match(output, /STRIPE_WEBHOOK_SECRET/);
});

test('production refuses missing or weak admin passwords', async () => {
  const child = spawn(process.execPath, [serverFile], {
    env: { ...process.env, NODE_ENV: 'production', ADMIN_PASSWORD: '', LEADS_TOKEN: '' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', chunk => { output += chunk; });
  const code = await new Promise(resolve => child.once('exit', resolve));
  assert.notEqual(code, 0);
  assert.match(output, /at least 24 characters/);
});

// ---------- prospecting (Clay lead generation) ----------

const prospectingLib = require('./prospecting');
const { startFakeClay } = require('./fake-clay');

test('phone extraction prefers tel: links and rejects non-NANP numbers', () => {
  assert.deepEqual(prospectingLib.normalizePhone('602-955-0055'), { e164: '+16029550055', display: '(602) 955-0055' });
  assert.deepEqual(prospectingLib.normalizePhone('1 (480) 555-1234'), { e164: '+14805551234', display: '(480) 555-1234' });
  assert.equal(prospectingLib.normalizePhone('123-456-7890'), null);
  assert.equal(prospectingLib.normalizePhone('555-555-5555'), null);
  const html = '<a href="tel:+16029550055">Call</a> <p>Office: 480.555.0199</p> <p>Zip 85016 · est. 2024 · 2547 E Indian School</p>';
  assert.equal(prospectingLib.extractPhone(html).display, '(602) 955-0055');
  assert.equal(prospectingLib.extractPhone('<p>no numbers here</p>'), null);
  assert.ok(Math.abs(prospectingLib.haversineMiles(33.495, -112.0285, 33.508479, -111.98475) - 2.69) < 0.05);
});

test('website phone lookup reads the homepage, then the contact page', async () => {
  const site = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/') return res.end('<html><body>Welcome. No phone on the home page.</body></html>');
    if (req.url === '/contact') return res.end('<html><body><a href="tel:(602) 555-0142">Call us</a></body></html>');
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
  try {
    const phone = await prospectingLib.findWebsitePhone(`http://127.0.0.1:${site.address().port}`, { timeoutMs: 2000 });
    assert.equal(phone.display, '(602) 555-0142');
    assert.match(phone.source, /\/contact$/);
    assert.equal(await prospectingLib.findWebsitePhone('ftp://example.com'), null);
  } finally {
    await new Promise((resolve) => site.close(resolve));
  }
});

test('lead generation: Clay search → enrich → radius → contacts → emails → drafts → outreach → follow-up', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'kwigz-prospecting-'));
  const clay = await startFakeClay();
  let instance;
  try {
    instance = await start(dataDir, { CLAY_API_KEY: 'test-clay-key', CLAY_API_BASE: clay.base, GEMINI_API_KEY: 'test-gemini-key', GEMINI_API_BASE: `${clay.base}/v1beta`, GEMINI_IMAGE_MODEL: 'gemini-missing-model', SITE_URL: 'https://kwigz.test' });
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${password}` };
    const call = async (method, p, body) => {
      const res = await fetch(`${instance.base}${p}`, { method, headers: auth, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, data: await res.json() };
    };

    // Admin-only.
    assert.equal((await fetch(`${instance.base}/api/prospects`)).status, 401);
    assert.equal((await fetch(`${instance.base}/api/prospecting/status`)).status, 401);

    const status = await call('GET', '/api/prospecting/status');
    assert.equal(status.data.clay.configured, true);
    assert.equal(status.data.gemini.configured, true);
    assert.equal(status.data.categories.find((c) => c.id === 'dui').configured, true);
    assert.equal(status.data.machines[0].geo, true);
    const credits = await call('GET', '/api/prospecting/credits');
    assert.equal(credits.data.balance, 500);

    assert.equal((await call('POST', '/api/prospecting/runs', { categoryId: 'nope', machineId: 'chopper-johns-phoenix' })).status, 400);

    // Step 1 — generate leads (phones off: no outbound web requests in tests).
    const started = await call('POST', '/api/prospecting/runs', { categoryId: 'dui', machineId: 'chopper-johns-phoenix', limit: 5, radiusMiles: 20, findPhones: false });
    assert.equal(started.status, 202);
    assert.equal(started.data.run.status, 'queued');
    assert.equal((await call('POST', '/api/prospecting/runs', { categoryId: 'dui', machineId: 'chopper-johns-phoenix' })).status, 400, 'one run at a time');
    let run;
    for (let i = 0; i < 100; i++) {
      run = (await call('GET', `/api/prospecting/runs/${started.data.run.id}`)).data.run;
      if (['done', 'failed'].includes(run.status)) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(run.status, 'done', run.error);
    assert.deepEqual({ candidates: run.counts.candidates, inRadius: run.counts.inRadius, saved: run.counts.saved, emailsFound: run.counts.emailsFound }, { candidates: 5, inRadius: 4, saved: 4, emailsFound: 2 });
    assert.equal(run.creditsUsed, 5.8, '5 enrich × 0.5 + 3 emails × 1.1');
    const searchQuery = clay.calls.find((c) => c.path === '/search/query-mode').body.query;
    assert.match(searchQuery, /industry in \("Law Practice", "Legal Services"\)/);
    assert.match(searchQuery, /city in \("Phoenix", .*"Scottsdale"/);
    assert.match(searchQuery, /description contains \("DUI"/);

    let { prospects } = (await call('GET', '/api/prospects')).data;
    assert.equal(prospects.length, 4);
    assert.ok(!prospects.some((p) => p.domain === 'faraway.example'), 'Tucson is outside the 20 mile radius');
    const nova = prospects.find((p) => p.domain === 'novalawaz.com');
    assert.equal(nova.distanceMiles, 2.7);
    assert.equal(nova.contacts[0].name, 'Ryan Tait', 'founding partner outranks associate');
    assert.equal(nova.contacts[0].email, 'ryan@novalawaz.com');
    assert.equal(nova.address, '4455 E Camelback Rd, Phoenix, AZ 85018');
    assert.ok(nova.score > prospects.find((p) => p.domain === 'bigfirm.example').score, 'small local firm outscores a 500-person firm');
    assert.equal(nova.status, 'new');
    assert.equal(nova.mockup.tagline, 'DUI Defense');
    assert.equal(nova.mockup.plays, 11520);

    // Re-running skips businesses already saved.
    const again = await call('POST', '/api/prospecting/runs', { categoryId: 'dui', machineId: 'chopper-johns-phoenix', limit: 5, findPhones: false });
    for (let i = 0; i < 100; i++) {
      run = (await call('GET', `/api/prospecting/runs/${again.data.run.id}`)).data.run;
      if (['done', 'failed'].includes(run.status)) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.equal(run.status, 'failed');
    assert.match(run.error, /already in your prospect list or was ruled out/);
    assert.equal(clay.calls.filter((c) => /\/routines\/.*\/run$/.test(c.path)).length, 2, "second run enriches nothing — ruled-out businesses are remembered");

    // Step 2 — drafts + preview link.
    const generated = await call('POST', '/api/prospects/generate', { categoryId: 'dui' });
    assert.equal(generated.data.count, 4);
    ({ prospects } = (await call('GET', '/api/prospects')).data);
    const drafted = prospects.find((p) => p.id === nova.id);
    assert.equal(drafted.status, 'drafted');
    assert.match(drafted.previewUrl, /^https:\/\/kwigz\.test\/preview\/[a-f0-9]{24}$/);
    assert.match(drafted.drafts.email.subject, /Nova Law Group on the screen at Chopper John's/);
    assert.match(drafted.drafts.email.body, /^Hi Ryan,/);
    assert.ok(drafted.drafts.email.body.includes(drafted.previewUrl));
    assert.ok(drafted.drafts.email.body.includes('"DUI Defense"'));
    assert.ok(drafted.drafts.sms.includes('$200/mo'));
    assert.ok(drafted.drafts.linkedin.note.length <= 300);

    // Public preview page + JSON + logo proxy need no auth and expose no contact data.
    const token = drafted.previewUrl.split('/').pop();
    const page = await fetch(`${instance.base}/preview/${token}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /mockup\.js/);
    const pub = await fetch(`${instance.base}/api/preview/${token}`);
    assert.equal(pub.status, 200);
    const pubData = await pub.json();
    assert.equal(pubData.mockup.business, 'Nova Law Group');
    assert.equal(pubData.mockup.machine.name, "Chopper John's");
    assert.equal(JSON.stringify(pubData).includes('ryan@'), false);
    const logo = await fetch(`${instance.base}${pubData.logoUrl}`);
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get('content-type'), 'image/png');
    assert.equal((await fetch(`${instance.base}/api/preview/${'0'.repeat(24)}`)).status, 404);
    assert.equal(pubData.artUrl, '', 'no AI art yet → classic banner');

    // AI banner art: Gemini paints the background (logo sent as a reference), real text stays client-side.
    assert.equal((await fetch(`${instance.base}/api/prospects/${nova.id}/art`, { method: 'POST' })).status, 401);
    const art = await call('POST', `/api/prospects/${nova.id}/art`, { count: 1, direction: 'gold accents' });
    assert.equal(art.status, 200, JSON.stringify(art.data));
    assert.equal(art.data.made.length, 1);
    assert.equal(art.data.prospect.art.selected, art.data.made[0]);
    assert.equal(art.data.prospect.art.variants[0].model, 'gemini-nano-banana-2.1', 'unavailable configured model falls back to the default');
    assert.match(art.data.prospect.art.prompt, /for a DUI \/ Criminal Defense business called "Nova Law Group" in Phoenix/);
    assert.match(art.data.prospect.art.prompt, /Scene: a dim Phoenix city street/);
    assert.match(art.data.prospect.art.prompt, /gold accents/);
    const geminiCall = clay.calls.find((c) => c.path === '/v1beta/interactions' && !/missing/.test(c.body.model));
    assert.equal(geminiCall.body.response_format.aspect_ratio, '21:9');
    assert.equal(geminiCall.body.input.filter((b) => b.type === 'image').length, 1, 'logo attached as a color reference');
    assert.equal(geminiCall.body.store, false);
    const vid = art.data.made[0];
    const artImg = await fetch(`${instance.base}/api/prospects/${nova.id}/art/${vid}`, { headers: auth });
    assert.equal(artImg.status, 200);
    assert.equal(artImg.headers.get('content-type'), 'image/png');
    const pubArt = await (await fetch(`${instance.base}/api/preview/${token}`)).json();
    assert.equal(pubArt.mockup.art, true);
    assert.equal(pubArt.artUrl, `/api/preview/${token}/art`);
    assert.equal((await fetch(`${instance.base}${pubArt.artUrl}`)).status, 200, 'public preview serves the selected art');
    assert.equal((await call('PATCH', `/api/prospects/${nova.id}`, { artSelected: 'art-nope' })).status, 400);
    const classic = await call('PATCH', `/api/prospects/${nova.id}`, { artSelected: '' });
    assert.equal(classic.data.prospect.art.selected, '');
    assert.equal((await fetch(`${instance.base}/api/preview/${token}/art`)).status, 404, 'deselected → no public art');
    assert.equal((await call('DELETE', `/api/prospects/${nova.id}/art/${vid}`)).data.prospect.art.variants.length, 0);
    assert.equal(existsSync(path.join(dataDir, 'art', `${vid}.png`)), false, 'file removed with the variant');

    // "Send" logs the touch and schedules the follow-up.
    const sent = await call('POST', `/api/prospects/${nova.id}/outreach`, { channel: 'email' });
    assert.equal(sent.data.prospect.status, 'contacted');
    const expected = new Date(); expected.setDate(expected.getDate() + 2);
    assert.equal(sent.data.prospect.nextFollowUpAt, expected.toISOString().slice(0, 10));
    assert.equal(sent.data.prospect.outreach[0].channel, 'email');
    assert.equal((await call('POST', `/api/prospects/${nova.id}/outreach`, { channel: 'fax' })).status, 400);

    // Edits: phone, contact email, drafts, status, follow-up date.
    const patched = await call('PATCH', `/api/prospects/${nova.id}`, { phone: '602 555 0100', nextFollowUpAt: '2099-01-02', drafts: { sms: 'custom text' }, contacts: [{ ...nova.contacts[0], email: 'new@novalawaz.com' }] });
    assert.equal(patched.data.prospect.phone, '(602) 555-0100');
    assert.equal(patched.data.prospect.phoneE164, '+16025550100');
    assert.equal(patched.data.prospect.nextFollowUpAt, '2099-01-02');
    assert.equal(patched.data.prospect.drafts.sms, 'custom text');
    assert.equal(patched.data.prospect.contacts[0].email, 'new@novalawaz.com');
    assert.equal((await call('PATCH', `/api/prospects/${nova.id}`, { status: 'bogus' })).status, 400);
    const won = await call('PATCH', `/api/prospects/${nova.id}`, { status: 'won' });
    assert.equal(won.data.prospect.nextFollowUpAt, '', 'closing a prospect clears the reminder');

    // Mobile lookup goes through Clay.
    const mobile = await call('POST', `/api/prospects/${nova.id}/find-mobile`, { contact: 0 });
    assert.equal(mobile.data.found, true);
    assert.equal(mobile.data.prospect.contacts[0].mobile, '(602) 555-0199');

    assert.equal((await call('DELETE', `/api/prospects/${nova.id}`)).status, 200);
    assert.equal((await call('DELETE', `/api/prospects/${nova.id}`)).status, 404);
    assert.equal(JSON.parse(readFileSync(path.join(dataDir, 'prospects.json'), 'utf8')).length, 3);
  } finally {
    if (instance) await stop(instance.child);
    await clay.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('without CLAY_API_KEY the prospecting tools report as not configured', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'kwigz-noclay-'));
  let instance;
  try {
    instance = await start(dataDir, { CLAY_API_KEY: '' });
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${password}` };
    const status = await (await fetch(`${instance.base}/api/prospecting/status`, { headers })).json();
    assert.equal(status.clay.configured, false);
    const run = await fetch(`${instance.base}/api/prospecting/runs`, { method: 'POST', headers, body: JSON.stringify({ categoryId: 'dui', machineId: 'chopper-johns-phoenix' }) });
    assert.equal(run.status, 400);
    assert.match((await run.json()).error, /CLAY_API_KEY/);
  } finally {
    if (instance) await stop(instance.child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('gemini client: model fallback, blocked prompts, and daily quota are reported clearly', async () => {
  const { createGeminiClient } = require('./gemini');
  const fake = await startFakeClay({ geminiQuota: 2 });
  try {
    const g = createGeminiClient({ apiKey: 'test-gemini-key', base: `${fake.base}/v1beta`, model: 'gemini-missing-model', maxRetries: 0 });
    const img = await g.generateImage({ prompt: 'desert at dusk' });
    assert.equal(img.mimeType, 'image/png');
    assert.ok(img.buffer.length > 50 && img.buffer.subarray(1, 4).toString() === 'PNG');
    assert.equal(img.model, 'gemini-nano-banana-2.1');
    assert.equal(g.model, 'gemini-nano-banana-2.1', 'client remembers the working model');
    await assert.rejects(g.generateImage({ prompt: 'something blocked' }), /no image/);
    await assert.rejects(g.generateImage({ prompt: 'desert' }), /free-tier limit reached/);
    assert.throws(() => createGeminiClient({ apiKey: '' }), /GEMINI_API_KEY/);
  } finally { await fake.close(); }
});

test('without GEMINI_API_KEY art generation reports as not configured', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'kwigz-nogemini-'));
  let instance;
  try {
    instance = await start(dataDir, { CLAY_API_KEY: '', GEMINI_API_KEY: '' });
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${password}` };
    const status = await (await fetch(`${instance.base}/api/prospecting/status`, { headers })).json();
    assert.equal(status.gemini.configured, false);
    const res = await fetch(`${instance.base}/api/prospects/nope/art`, { method: 'POST', headers, body: '{}' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /GEMINI_API_KEY/);
  } finally {
    if (instance) await stop(instance.child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
