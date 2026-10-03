const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const password = 'integration-test-password-only-123456';
const serverFile = path.join(__dirname, 'leads-server.js');

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
    for (const changes of [{ start: '2099-02-30' }, { budget: 1 }, { machineId: 'unknown' }, { categoryId: 'unknown' }]) {
      assert.equal((await request('/api/campaigns', { method: 'POST', auth: true, data: { ...campaign, ...changes } })).status, 400);
    }
    const created = await request('/api/campaigns', { method: 'POST', auth: true, data: campaign });
    assert.equal(created.status, 201);
    const saved = (await created.json()).campaign;
    assert.equal(saved.units, 2);
    assert.equal(saved.estPlays, 23040);
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

    const base = { machineId: 'chopper-johns-phoenix', business: 'Desert Ink', contactName: 'Sam', budget: 150, start: '2099-01-01', end: '2099-01-30' };
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
    assert.ok(link.email.body.includes(link.url) && link.email.body.includes('$150/month') && link.email.body.includes('Hi Sam'));
    const priceCall = mock.calls.find((x) => x.path === '/prices');
    assert.equal(priceCall.auth, 'Bearer sk_test_mock');
    assert.equal(priceCall.params.unit_amount, '15000');
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
