// Minimal Gemini image-generation client ("Nano Banana") — zero dependencies.
// Uses the Interactions API: POST {base}/interactions with an `x-goog-api-key` header.
// Docs: https://ai.google.dev/gemini-api/docs/image-generation
//
// Get a free key at https://aistudio.google.com/apikey and set GEMINI_API_KEY on the server.
// The free tier has a daily image cap (shown in AI Studio); we surface 429s as a clear message.

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// Tried in order when the configured model is unavailable to this key (404/403 "model not found").
const MODEL_FALLBACKS = ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'];

class GeminiError extends Error {
  constructor(message, { status, details } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.details = details;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Walks the Interaction response and returns the last image block, whatever step it sits in.
function findImage(node, found = { image: null }) {
  if (!node || typeof node !== 'object') return found.image;
  if (Array.isArray(node)) { for (const n of node) findImage(n, found); return found.image; }
  if (typeof node.data === 'string' && node.data.length > 100 && (node.type === 'image' || /^image\//.test(node.mime_type || node.mimeType || ''))) {
    found.image = { data: node.data, mimeType: node.mime_type || node.mimeType || 'image/png' };
  }
  if (node.inlineData?.data) found.image = { data: node.inlineData.data, mimeType: node.inlineData.mimeType || 'image/png' };
  for (const v of Object.values(node)) if (v && typeof v === 'object') findImage(v, found);
  return found.image;
}

function createGeminiClient({ apiKey, base = DEFAULT_BASE, model = MODEL_FALLBACKS[0], fetchImpl = fetch, maxRetries = 3, timeoutMs = 120000, log = () => {} } = {}) {
  if (!apiKey) throw new Error('Gemini is not configured on the server (set GEMINI_API_KEY).');
  base = base.replace(/\/+$/, '');
  let activeModel = model;

  async function post(endpoint, body, { retries = maxRetries } = {}) {
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res;
      try {
        res = await fetchImpl(`${base}${endpoint}`, { method: 'POST', headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
      } catch (err) {
        clearTimeout(timer);
        if (attempt < retries) { log(`gemini ${endpoint} → ${err.name === 'AbortError' ? 'timeout' : err.message}, retrying`); await sleep(1500 * 2 ** attempt); continue; }
        throw new GeminiError(err.name === 'AbortError' ? 'Gemini took too long to respond' : `Gemini request failed: ${err.message}`);
      }
      clearTimeout(timer);
      const text = await res.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 300) }; }
      if (res.ok) return data;
      const message = data?.error?.message || data?.message || `Gemini request failed (${res.status})`;
      const quota = res.status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(message);
      // Daily free-tier quota won't clear by retrying; per-minute limits and 5xx will.
      const transient = (res.status === 429 && !/per day|daily|PerDay/i.test(message)) || res.status >= 500;
      if (transient && attempt < retries) {
        const retryAfter = Number(res.headers.get('retry-after') || 0);
        const wait = Math.min(30000, retryAfter ? retryAfter * 1000 : 2000 * 2 ** attempt);
        log(`gemini ${endpoint} → ${res.status}, retrying in ${wait}ms`);
        await sleep(wait);
        continue;
      }
      throw new GeminiError(quota ? `Gemini free-tier limit reached — try again later or raise the quota in AI Studio. (${message})` : message, { status: res.status, details: data?.error });
    }
  }

  // images: [{ mimeType, data: Buffer|base64 string }] — reference images (logo, photo…), up to 14.
  async function generateImage({ prompt, images = [], aspectRatio = '21:9', imageSize = '1K', mimeType = 'image/png' }) {
    if (!prompt) throw new GeminiError('A prompt is required');
    const input = [{ type: 'text', text: prompt }];
    for (const img of images.slice(0, 14)) {
      if (!img?.data) continue;
      input.push({ type: 'image', mime_type: img.mimeType || 'image/png', data: Buffer.isBuffer(img.data) ? img.data.toString('base64') : String(img.data) });
    }
    const candidates = [activeModel, ...MODEL_FALLBACKS.filter((m) => m !== activeModel)];
    let lastErr;
    for (const m of candidates) {
      try {
        const data = await post('/interactions', { model: m, input, store: false, response_format: { type: 'image', mime_type: mimeType, aspect_ratio: aspectRatio, image_size: imageSize } });
        const image = findImage(data);
        if (!image) throw new GeminiError('Gemini returned no image (the prompt may have been blocked)', { details: data?.status || data });
        if (m !== activeModel) { log(`gemini: switched to model ${m}`); activeModel = m; }
        return { buffer: Buffer.from(image.data, 'base64'), mimeType: image.mimeType, model: m };
      } catch (err) {
        lastErr = err;
        const modelMissing = [400, 403, 404].includes(err.status) && /model|not found|not supported|permission|unavailable/i.test(err.message);
        if (!modelMissing) throw err;
        log(`gemini: model ${m} unavailable (${err.message}); trying next`);
      }
    }
    throw lastErr;
  }

  return { generateImage, get model() { return activeModel; }, GeminiError };
}

module.exports = { createGeminiClient, GeminiError, findImage, MODEL_FALLBACKS, DEFAULT_BASE };
