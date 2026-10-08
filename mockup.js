// KWIGZ ad mockup renderer (browser, no dependencies).
// Draws a 1080×441 banner for a business (optionally over AI-generated art) and warps it onto the
// header strip of the real machine screen in the reference photo — the rest of the screen (product
// grid) is the actual photo. Used by /admin and /preview/<token>.
(() => {
  // Reference photo: the installed machine at Yucca Tap Room. The ad slot is the dark header strip
  // above the product grid (where the venue logo sits). Corners in photo pixels (573×768).
  const PHOTO = '/yucca-installed-web.jpg';
  const PHOTO_SIZE = [573, 768];
  const SCREEN_QUAD = { tl: [226, 263], tr: [345.5, 276], br: [345.5, 331], bl: [226, 324] };
  const RENDER_SCALE = 2; // composite at 2× the photo so the banner stays crisp even on a soft photo
  const BANNER = [1080, 441];
  const FONT = "'Inter', -apple-system, 'Helvetica Neue', Arial, sans-serif";

  const THEMES = {
    dui: { base: '#0b1a33', base2: '#132a52', accent: '#f5b301', ink: '#0b1a33' },
    injury: { base: '#1a0b2e', base2: '#2b1450', accent: '#ff7a00', ink: '#1a0b2e' },
    motorcycle: { base: '#0f0f0f', base2: '#262626', accent: '#ff3b1f', ink: '#111' },
    bail: { base: '#0d1f14', base2: '#163424', accent: '#ffd500', ink: '#0d1f14' },
    tattoo: { base: '#050505', base2: '#1c1c1c', accent: '#ff2d95', ink: '#050505' },
    insurance: { base: '#0a2540', base2: '#123b63', accent: '#4fd1c5', ink: '#0a2540' },
    hvac: { base: '#0b2a4a', base2: '#0e3f6e', accent: '#38bdf8', ink: '#0b2a4a' },
    plumbing: { base: '#0f2a3f', base2: '#164060', accent: '#22c55e', ink: '#0f2a3f' },
    autobody: { base: '#1f1f1f', base2: '#333', accent: '#ef4444', ink: '#1f1f1f' },
    restaurant: { base: '#2a0a0a', base2: '#4a1414', accent: '#fbbf24', ink: '#2a0a0a' },
    other: { base: '#111827', base2: '#1f2937', accent: '#dc2626', ink: '#fff' },
  };
  const themeFor = (id) => THEMES[id] || THEMES.other;

  const canvasOf = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Could not load ${url}`));
      img.src = url;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // Shrinks the font until the text fits maxWidth; returns the size used.
  function fitText(ctx, text, maxWidth, maxSize, minSize, weight = 800) {
    let size = maxSize;
    for (; size > minSize; size -= 2) {
      ctx.font = `${weight} ${size}px ${FONT}`;
      if (ctx.measureText(text).width <= maxWidth) break;
    }
    ctx.font = `${weight} ${size}px ${FONT}`;
    return size;
  }

  function ellipsize(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
    return `${t.trim()}…`;
  }

  // Draws `img` scaled to cover the box (like CSS background-size: cover), centered.
  function drawCover(ctx, img, x, y, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  // Most saturated, reasonably common color in the logo → brand accent. Null if the logo is
  // basically monochrome (then the category accent is used).
  function logoAccent(logo) {
    try {
      const n = 48, c = canvasOf(n, n), ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(logo, 0, 0, n, n);
      const { data } = ctx.getImageData(0, 0, n, n);
      const bins = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        if (a < 64) continue;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const sat = max ? (max - min) / max : 0, light = (max + min) / 510;
        if (sat < 0.35 || light < 0.12 || light > 0.92) continue;
        const key = `${r >> 4},${g >> 4},${b >> 4}`;
        const bin = bins.get(key) || { r: 0, g: 0, b: 0, count: 0, sat: 0 };
        bin.r += r; bin.g += g; bin.b += b; bin.count++; bin.sat += sat;
        bins.set(key, bin);
      }
      let best = null;
      for (const bin of bins.values()) { const score = bin.count * (0.5 + bin.sat / bin.count); if (bin.count >= 6 && (!best || score > best.score)) best = { ...bin, score }; }
      if (!best) return null;
      const r = Math.round(best.r / best.count), g = Math.round(best.g / best.count), b = Math.round(best.b / best.count);
      const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      return { hex, dark: (0.299 * r + 0.587 * g + 0.114 * b) < 150 };
    } catch { return null; }
  }

  function drawBanner(spec, logo, art) {
    const [W, H] = BANNER;
    const c = canvasOf(W, H);
    const ctx = c.getContext('2d');
    const th = { ...themeFor(spec.categoryId) };
    // With AI art behind it, borrow the accent from the business's real logo so the pill/tagline match their brand.
    if (art && logo) { const brand = logoAccent(logo); if (brand) { th.accent = brand.hex; th.ink = brand.dark ? '#fff' : '#111'; } }

    if (art) {
      drawCover(ctx, art, 0, 0, W, H);
      // Left-to-right scrim keeps the text side legible whatever the art looks like.
      const scrim = ctx.createLinearGradient(0, 0, W, 0);
      scrim.addColorStop(0, 'rgba(5,8,16,0.88)'); scrim.addColorStop(0.5, 'rgba(5,8,16,0.62)'); scrim.addColorStop(1, 'rgba(5,8,16,0.10)');
      ctx.fillStyle = scrim; ctx.fillRect(0, 0, W, H);
      const bottom = ctx.createLinearGradient(0, H - 160, 0, H);
      bottom.addColorStop(0, 'rgba(5,8,16,0)'); bottom.addColorStop(1, 'rgba(5,8,16,0.55)');
      ctx.fillStyle = bottom; ctx.fillRect(0, 0, W, H);
    } else {
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, th.base); bg.addColorStop(1, th.base2);
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      // soft accent glow top-right
      const glow = ctx.createRadialGradient(W - 120, 40, 10, W - 120, 40, 520);
      glow.addColorStop(0, `${th.accent}55`); glow.addColorStop(1, `${th.accent}00`);
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    }
    ctx.fillStyle = th.accent; ctx.fillRect(0, 0, 14, H);

    let x = 54;
    if (logo) {
      const box = 150, y = 52;
      ctx.save(); roundRect(ctx, x, y, box, box, 22); ctx.fillStyle = '#fff'; ctx.fill(); ctx.clip();
      const scale = Math.min((box - 24) / logo.width, (box - 24) / logo.height);
      const w = logo.width * scale, h = logo.height * scale;
      ctx.drawImage(logo, x + (box - w) / 2, y + (box - h) / 2, w, h);
      ctx.restore();
      x += box + 36;
    }

    const ctaText = spec.cta || 'Call today.';
    ctx.font = `700 26px ${FONT}`;
    const ctaW = Math.min(360, ctx.measureText(ctaText).width + 56);
    const textMax = W - x - ctaW - 90;

    // Business name
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
    const nameSize = fitText(ctx, spec.business, textMax, 66, 34, 900);
    ctx.fillText(ellipsize(ctx, spec.business, textMax), x, 60 + nameSize * 0.78);
    let y = 60 + nameSize + 18;

    // Tagline (a dark brand accent is unreadable as text on the scrim — fall back to soft white)
    if (spec.tagline) {
      ctx.fillStyle = th.ink === '#fff' && th.accent !== themeFor(spec.categoryId).accent ? 'rgba(255,255,255,0.85)' : th.accent;
      fitText(ctx, spec.tagline, textMax, 32, 22, 700);
      ctx.fillText(ellipsize(ctx, spec.tagline, textMax), x, y + 26);
      y += 60;
    }

    // Phone / website
    const contact = spec.phone ? spec.phone : (spec.website || '');
    if (contact) {
      ctx.fillStyle = '#fff';
      const label = spec.phone ? 'CALL OR TEXT' : 'VISIT';
      ctx.font = `700 18px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillText(label, x, Math.max(y + 30, H - 112));
      ctx.fillStyle = '#fff';
      fitText(ctx, contact, textMax, 58, 30, 900);
      ctx.fillText(contact, x, H - 48);
    }

    // CTA pill
    ctx.font = `700 26px ${FONT}`;
    const pillX = W - ctaW - 48, pillY = H - 48 - 64;
    if (art) { ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 6; }
    roundRect(ctx, pillX, pillY, ctaW, 64, 32); ctx.fillStyle = th.accent; ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = th.ink === '#fff' ? '#fff' : th.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ellipsize(ctx, ctaText, ctaW - 40), pillX + ctaW / 2, pillY + 33);

    // City / footer
    ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.font = `600 20px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.7)';
    if (spec.city) ctx.fillText(spec.city, W - 48, 64);
    ctx.textAlign = 'left';
    return c;
  }

  // The header strip is a little taller than the 1080×441 ad (perspective aside, ~1080×550). Draw the
  // banner at the top and extend its bottom edge colour downwards so nothing of the old header shows.
  function stripCanvas(banner) {
    const quadW = Math.hypot(SCREEN_QUAD.tr[0] - SCREEN_QUAD.tl[0], SCREEN_QUAD.tr[1] - SCREEN_QUAD.tl[1]);
    const quadH = (Math.hypot(SCREEN_QUAD.bl[0] - SCREEN_QUAD.tl[0], SCREEN_QUAD.bl[1] - SCREEN_QUAD.tl[1]) + Math.hypot(SCREEN_QUAD.br[0] - SCREEN_QUAD.tr[0], SCREEN_QUAD.br[1] - SCREEN_QUAD.tr[1])) / 2;
    const H = Math.max(BANNER[1], Math.round(BANNER[0] * quadH / quadW));
    const c = canvasOf(BANNER[0], H);
    const ctx = c.getContext('2d');
    if (H > BANNER[1]) {
      const bctx = banner.getContext('2d');
      const d = bctx.getImageData(0, BANNER[1] - 6, BANNER[0], 6).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4 * 7) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      ctx.fillStyle = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
      ctx.fillRect(0, 0, BANNER[0], H);
    }
    ctx.drawImage(banner, 0, 0);
    return c;
  }

  // Maps the strip canvas onto the photo's header quad with thin horizontal slices (each slice gets
  // its own affine transform, which approximates the perspective well). Output is RENDER_SCALE× the photo.
  function drawMachine(photo, banner) {
    const S = RENDER_SCALE;
    const [W, H] = [PHOTO_SIZE[0] * S, PHOTO_SIZE[1] * S];
    const c = canvasOf(W, H);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(photo, 0, 0, W, H);
    const strip = stripCanvas(banner);
    const q = Object.fromEntries(Object.entries(SCREEN_QUAD).map(([k, [x, y]]) => [k, [x * S, y * S]]));
    const { tl, tr, br, bl } = q;
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const sw = strip.width, sh = strip.height;
    const slices = 24;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(...tl); ctx.lineTo(...tr); ctx.lineTo(...br); ctx.lineTo(...bl); ctx.closePath(); ctx.clip();
    for (let i = 0; i < slices; i++) {
      const t0 = i / slices, t1 = (i + 1) / slices;
      const L0 = lerp(tl, bl, t0), R0 = lerp(tr, br, t0), L1 = lerp(tl, bl, t1);
      const sy = t0 * sh, sH = (t1 - t0) * sh;
      const a = (R0[0] - L0[0]) / sw, b = (R0[1] - L0[1]) / sw;
      const cc = (L1[0] - L0[0]) / sH, d = (L1[1] - L0[1]) / sH;
      ctx.setTransform(a, b, cc, d, L0[0], L0[1]);
      const over = i === slices - 1 ? 0 : sh / slices * 0.35;
      ctx.drawImage(strip, 0, sy, sw, sH + over, 0, 0, sw, sH + over);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Match the photo: slight glass glare + the screen's own glow bleeding onto the bezel edge.
    const glare = ctx.createLinearGradient(tl[0], tl[1], br[0], br[1]);
    glare.addColorStop(0, 'rgba(255,255,255,0.08)'); glare.addColorStop(0.5, 'rgba(255,255,255,0)'); glare.addColorStop(1, 'rgba(0,0,0,0.10)');
    ctx.fillStyle = glare; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    return c;
  }

  // Zoomed crop around the machine so the ad is legible in emails and previews (photo px → ×scale).
  const CLOSEUP = { x: 150, y: 222, w: 270, h: 405, scale: 3 };
  function drawCloseup(machine) {
    const S = RENDER_SCALE;
    const c = canvasOf(CLOSEUP.w * CLOSEUP.scale, CLOSEUP.h * CLOSEUP.scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(machine, CLOSEUP.x * S, CLOSEUP.y * S, CLOSEUP.w * S, CLOSEUP.h * S, 0, 0, c.width, c.height);
    return c;
  }

  async function render(spec, { logoUrl = '', photoUrl = PHOTO, artUrl = '' } = {}) {
    if (document.fonts?.load) { try { await Promise.all([document.fonts.load(`900 60px ${FONT}`), document.fonts.load(`700 26px ${FONT}`)]); } catch { /* fall back to system font */ } }
    const [photo, logo, art] = await Promise.all([loadImage(photoUrl), logoUrl ? loadImage(logoUrl).catch(() => null) : null, artUrl ? loadImage(artUrl).catch(() => null) : null]);
    const banner = drawBanner(spec, logo, art);
    const machine = drawMachine(photo, banner);
    const closeup = drawCloseup(machine);
    return { banner, machine, closeup };
  }

  function download(canvas, filename) {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: filename });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
  }

  window.KWIGZ_MOCKUP = { SCREEN_QUAD, PHOTO, PHOTO_SIZE, CLOSEUP, THEMES, render, drawBanner, drawMachine, drawCloseup, loadImage, download };
})();
