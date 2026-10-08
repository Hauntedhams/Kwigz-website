// Test double for the Clay Public API. Used by leads-server.test.js and for local UI work:
//
//   node server/fake-clay.js            # prints the base URL
//   CLAY_API_KEY=test CLAY_API_BASE=http://127.0.0.1:<port> node server/leads-server.js
//
// Returns canned Phoenix businesses, decision-makers, enrichment and emails. No network.

const http = require('http');

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const COMPANIES = [
  { clay_company_id: 1, name: 'Nova Law Group', domain: 'novalawaz.com', size: '2-10', industry: 'Law Practice', location: 'Phoenix, Arizona', description: 'Phoenix litigation boutique focused on DUI defense and criminal defense.', linkedin_url: 'https://www.linkedin.com/company/novalawaz', lat: 33.508479, lng: -111.98475, address: '4455 E Camelback Rd, Phoenix, AZ 85018', specialties: ['DUI Defense', 'Criminal Defense'], logo: true, revenue: '1M-5M' },
  { clay_company_id: 2, name: 'Rideout Law Group', domain: 'rideoutlaw.com', size: '2-10', industry: 'Law Practice', location: 'Scottsdale, Arizona', description: 'Criminal defense and DUI attorneys.', linkedin_url: 'https://www.linkedin.com/company/rideout', lat: 33.4942, lng: -111.9261, address: '7272 E Indian School Rd, Scottsdale, AZ 85251', specialties: ['DUI', 'Criminal Law'], revenue: '500K-1M' },
  { clay_company_id: 3, name: 'Far Away Defense', domain: 'faraway.example', size: '11-50', industry: 'Law Practice', location: 'Phoenix, Arizona', description: 'DUI defense statewide.', linkedin_url: '', lat: 32.2226, lng: -110.9747, address: 'Tucson, AZ', specialties: [], revenue: '1M-5M' },
  { clay_company_id: 4, name: 'Big Firm LLP', domain: 'bigfirm.example', size: '501-1,000', industry: 'Law Practice', location: 'Phoenix, Arizona', description: 'Full-service firm including DUI defense.', linkedin_url: '', lat: 33.4484, lng: -112.074, address: '1 N Central Ave, Phoenix, AZ 85004', specialties: ['Corporate'], revenue: '75M-200M' },
  { clay_company_id: 5, name: 'No Address Law', domain: 'noaddress.example', size: '2-10', industry: 'Law Practice', location: 'Mesa, Arizona', description: 'DUI and traffic defense.', linkedin_url: '', specialties: ['DUI'], revenue: '0-500K' },
];
const PEOPLE = {
  'novalawaz.com': [{ name: 'Ryan Tait', first_name: 'Ryan', last_name: 'Tait', linkedin_url: 'https://www.linkedin.com/in/r-t-10789514/', location: { city: 'Phoenix' }, matched_experiences: [{ company: 'Nova Law Group', title: 'Founding Partner' }] }, { name: 'Alexis Brooks', first_name: 'Alexis', last_name: 'Brooks', linkedin_url: 'https://www.linkedin.com/in/alexisjeanbrooks/', location: { city: 'Paradise Valley' }, matched_experiences: [{ company: 'Nova Law Group', title: 'Attorney' }] }],
  'rideoutlaw.com': [{ name: 'Brad Rideout', first_name: 'Brad', last_name: 'Rideout', linkedin_url: 'https://www.linkedin.com/in/brad-rideout/', location: { city: 'Scottsdale' }, matched_experiences: [{ company: 'Rideout Law Group', title: 'CEO/Attorney' }] }],
  'noaddress.example': [{ name: 'Pat Owner', first_name: 'Pat', last_name: 'Owner', linkedin_url: '', location: { city: 'Mesa' }, matched_experiences: [{ company: 'No Address Law', title: 'Owner' }] }],
};
const EMAILS = { 'Ryan Tait': 'ryan@novalawaz.com', 'Brad Rideout': 'brad@rideoutlaw.com' };

function startFakeClay({ port = 0, pollsBeforeComplete = 1 } = {}) {
  const searches = new Map();
  const runs = new Map();
  const calls = [];
  let n = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      calls.push({ method: req.method, path: url.pathname, body });
      if (url.pathname === '/logo.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG_1x1); }
      if (req.headers['clay-api-key'] !== 'test-clay-key') return json(401, { message: 'Authentication failed' });
      if (url.pathname === '/me') return json(200, { user: { email: 'test@kwigz.com' }, workspace: { id: '1', name: 'Test' } });
      if (url.pathname === '/credits/balance') return json(200, { balance: 500, actionExecutionBalance: 1000 });
      if (url.pathname === '/search/query-mode' && req.method === 'POST') { const id = `search_${++n}`; searches.set(id, { query: body.query, page: 0 }); return json(200, { searchId: id, sourceType: /from people/.test(body.query) ? 'people' : 'companies' }); }
      const run = url.pathname.match(/^\/search\/query-mode\/([^/]+)\/run$/);
      if (run && req.method === 'POST') {
        const s = searches.get(run[1]); if (!s) return json(404, { message: 'Unknown search' });
        if (s.page++ > 0) return json(200, { data: [], hasMore: false });
        if (/from people/.test(s.query)) { const d = (s.query.match(/company\.domain = "([^"]+)"/) || [])[1]; return json(200, { data: PEOPLE[d] || [], hasMore: false }); }
        const limit = Number((s.query.match(/limit (\d+)/) || [])[1]) || 20;
        return json(200, { data: COMPANIES.slice(0, limit).map(({ lat, lng, address, specialties, logo, revenue, ...c }) => ({ ...c, annual_revenue: revenue, type: 'Privately Held', country: 'US' })), hasMore: false });
      }
      const start = url.pathname.match(/^\/routines\/([^/]+)\/run$/);
      if (start && req.method === 'POST') {
        const id = `run_${++n}`;
        runs.set(id, { routine: decodeURIComponent(start[1]), items: body.items, polls: 0 });
        return json(200, { routine_run_id: id, status: 'in_progress' });
      }
      const results = url.pathname.match(/^\/routines\/run\/([^/]+)\/results$/);
      if (results && req.method === 'GET') {
        const r = runs.get(results[1]); if (!r) return json(404, { message: 'Unknown run' });
        if (r.polls++ < pollsBeforeComplete) return json(202, { routine_run_id: results[1], status: 'in_progress', total: r.items.length, finished: 0 });
        const base = `http://127.0.0.1:${server.address().port}`;
        const data = r.items.map((item) => {
          const inputs = item.inputs;
          if (/0tmg770K2e6ZsSBRVnq|enrich/i.test(r.routine)) {
            const c = COMPANIES.find((x) => x.domain === inputs['Company Identifier']);
            if (!c) return { id: item.id, status: 'failed', error: { message: 'Not found' } };
            return { id: item.id, status: 'complete', result: { 'Enrich Company': { name: c.name, domain: c.domain, website: `https://${c.domain}/`, url: c.linkedin_url, industry: c.industry, size: `${c.size} employees`, employee_count: 8, annual_revenue: c.revenue, founded: 2015, description: c.description, specialties: c.specialties, logo_url: c.logo ? `${base}/logo.png` : undefined, locality: c.location.replace(' Arizona', 'AZ'), locations: c.lat ? [{ address: c.address, is_primary: true, inferred_location: { latitude: c.lat, longitude: c.lng, locality: c.location.split(',')[0], postal_code: (c.address.match(/\b85\d{3}\b/) || [''])[0], admin_district: 'Arizona', formatted_address: c.address } }] : [] } } };
          }
          if (/0tmg77588XJgBgoCmRc|email/i.test(r.routine)) { const e = EMAILS[inputs['Full Name']]; return e ? { id: item.id, status: 'complete', result: { 'Work Email': e } } : { id: item.id, status: 'complete', result: { 'Work Email': null } }; }
          if (/0tmg771yM7Pat8cFmP8|mobile/i.test(r.routine)) return { id: item.id, status: 'complete', result: { 'Mobile Phone Number': '+1 602-555-0199' } };
          return { id: item.id, status: 'failed', error: { message: 'Unknown routine' } };
        });
        return json(200, { routine_run_id: results[1], status: 'complete', total: data.length, finished: data.length, data });
      }
      json(404, { message: `No fake route for ${req.method} ${url.pathname}` });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) })));
}

module.exports = { startFakeClay, COMPANIES, PEOPLE, EMAILS };

if (require.main === module) {
  startFakeClay({ port: Number(process.env.PORT) || 0 }).then(({ base }) => console.log(`Fake Clay API at ${base}  (CLAY_API_KEY=test-clay-key CLAY_API_BASE=${base})`));
}
