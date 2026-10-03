const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const password = 'integration-test-password-only-123456';
const serverFile = path.join(__dirname, 'leads-server.js');

async function start(dataDir) {
  const child = spawn(process.execPath, [serverFile], {
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ADMIN_PASSWORD: password, NODE_ENV: 'production' },
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
