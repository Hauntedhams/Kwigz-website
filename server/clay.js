// Minimal Clay Public API client (https://developers.clay.com) — zero dependencies.
// Auth: `clay-api-key` header. Create a key with `clay api-keys create --name kwigz`
// or in Clay → Settings → Account → API keys, then set CLAY_API_KEY on the server.

const DEFAULT_BASE = 'https://api.clay.com/public/v0';

class ClayError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ClayError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createClayClient({ apiKey, base = DEFAULT_BASE, fetchImpl = fetch, maxRetries = 5, log = () => {} } = {}) {
  if (!apiKey) throw new Error('Clay is not configured on the server (set CLAY_API_KEY).');
  base = base.replace(/\/+$/, '');

  async function request(method, endpoint, body, { retries = maxRetries } = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`${base}${endpoint}`, {
        method,
        headers: { 'clay-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 200) }; }
      if (res.ok) return { status: res.status, data };
      // 429 = workspace-wide concurrency/rate limit; 5xx = transient. Both are retried.
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const retryAfter = Number(res.headers.get('retry-after') || data?.error?.details?.retryAfter || data?.details?.retryAfter || 0);
        const wait = Math.min(30000, (retryAfter ? retryAfter * 1000 : 1000 * 2 ** attempt));
        log(`clay ${method} ${endpoint} → ${res.status}, retrying in ${wait}ms`);
        await sleep(wait);
        continue;
      }
      const message = data?.error?.message || data?.message || `Clay request failed (${res.status})`;
      throw new ClayError(message, { status: res.status, code: data?.error?.code || data?.code, details: data?.error?.details || data?.details });
    }
  }

  const me = async () => (await request('GET', '/me')).data;
  const credits = async () => (await request('GET', '/credits/balance')).data;

  // Search is a forward-only iterator: create → run until hasMore is false.
  async function searchCreate(query) {
    const { data } = await request('POST', '/search/query-mode', { query });
    if (!data.searchId && !data.search_id) throw new ClayError('Clay did not return a search id', { details: data });
    return data.searchId || data.search_id;
  }
  async function searchRun(searchId, limit = 20) {
    const { data } = await request('POST', `/search/query-mode/${encodeURIComponent(searchId)}/run`, { limit: Math.max(1, Math.min(500, limit)) });
    return { data: Array.isArray(data.data) ? data.data : [], hasMore: Boolean(data.hasMore ?? data.has_more) };
  }
  async function searchAll(query, { max = 50, pageSize = 20 } = {}) {
    const searchId = await searchCreate(query);
    const out = [];
    let hasMore = true;
    while (hasMore && out.length < max) {
      const page = await searchRun(searchId, Math.min(pageSize, max - out.length));
      out.push(...page.data);
      hasMore = page.hasMore && page.data.length > 0;
    }
    return out.slice(0, max);
  }

  // Routines run asynchronously: start → poll results (202 while in progress).
  async function routineStart(routineId, items) {
    if (!items.length) return null;
    const { data } = await request('POST', `/routines/${encodeURIComponent(routineId)}/run`, { items });
    const runId = data.routine_run_id || data.routineRunId;
    if (!runId) throw new ClayError('Clay did not return a routine run id', { details: data });
    return runId;
  }
  async function routineResults(runId, { pollMs = 2500, timeoutMs = 240000 } = {}) {
    const started = Date.now();
    const results = new Map();
    for (;;) {
      const { status, data } = await request('GET', `/routines/run/${encodeURIComponent(runId)}/results`);
      if (status === 200 && (data.status === 'complete' || Array.isArray(data.data))) {
        for (const item of data.data || []) results.set(item.id, item);
        let cursor = data.cursor;
        while (cursor) {
          const page = await request('GET', `/routines/run/${encodeURIComponent(runId)}/results?cursor=${encodeURIComponent(cursor)}&limit=100`);
          for (const item of page.data.data || []) results.set(item.id, item);
          cursor = page.data.cursor;
        }
        if (data.status === 'complete' || data.status === 'completed' || (data.finished != null && data.total != null && data.finished >= data.total)) return results;
      }
      if (Date.now() - started > timeoutMs) throw new ClayError(`Clay routine run ${runId} timed out`, { code: 'timeout' });
      await sleep(pollMs);
    }
  }
  // Runs a routine over up to 100 items per request and returns Map<itemId, {status, result, error}>.
  async function runRoutine(routineId, items, opts) {
    const all = new Map();
    for (let i = 0; i < items.length; i += 100) {
      const runId = await routineStart(routineId, items.slice(i, i + 100));
      if (!runId) continue;
      for (const [id, item] of await routineResults(runId, opts)) all.set(id, item);
    }
    return all;
  }

  return { request, me, credits, searchCreate, searchRun, searchAll, routineStart, routineResults, runRoutine };
}

module.exports = { createClayClient, ClayError, DEFAULT_BASE };
