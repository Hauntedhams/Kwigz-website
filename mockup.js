// KWIGZ ad mockup renderer (browser, no dependencies).
// Draws a 1080×441 banner for a business (optionally over AI-generated art), composes the machine's
// portrait screen, and warps it onto the photo of the installed SlimWall. Used by /admin and /preview/<token>.
(() => {
  // Screen corners on slimwall-installed-web.jpg as displayed (1050×1400, EXIF-rotated).
  const SCREEN_QUAD = { tl: [419, 506], tr: [618, 526], br: [618, 922], bl: [427, 959] };
  const PHOTO = '/slimwall-installed-web.jpg';
  const PHOTO_SIZE = [1050, 1400];
  const SCREEN = [1080, 1920];
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
    const [W, H] = [1080, 441];
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

  // Portrait screen: the advertiser banner on top, the machine's attract loop below.
  function drawScreen(spec, banner) {
    const [W, H] = SCREEN;
    const c = canvasOf(W, H);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#07070c'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(banner, 0, 0, W, 441);

    const bg = ctx.createRadialGradient(W / 2, 1000, 50, W / 2, 1000, 900);
    bg.addColorStop(0, '#1b1038'); bg.addColorStop(1, '#07070c');
    ctx.fillStyle = bg; ctx.fillRect(0, 441, W, H - 441);

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const neon = (text, y, size, color) => {
      ctx.font = `900 ${size}px ${FONT}`;
      ctx.shadowColor = color; ctx.shadowBlur = 60; ctx.fillStyle = color; ctx.fillText(text, W / 2, y);
      ctx.shadowBlur = 18; ctx.fillStyle = '#fff'; ctx.fillText(text, W / 2, y);
      ctx.shadowBlur = 0;
    };
    neon('VAPES', 760, 190, '#b36bff');
    neon('SOLD', 960, 190, '#b36bff');
    neon('HERE', 1160, 190, '#b36bff');
    ctx.fillStyle = '#fff'; ctx.font = `800 64px ${FONT}`; ctx.fillText('TAP TO BUY', W / 2, 1440);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 4; roundRect(ctx, W / 2 - 230, 1390, 460, 100, 50); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `700 34px ${FONT}`; ctx.fillText('21+ · ID VERIFIED', W / 2, 1640);
    ctx.fillStyle = '#dc2626'; ctx.font = `900 54px ${FONT}`; ctx.fillText('KWIGZ', W / 2, 1790);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    return c;
  }

  // Maps the screen canvas onto the photo's screen quad with thin horizontal strips
  // (each strip gets its own affine transform, which approximates the perspective well).
  function drawMachine(photo, screen) {
    const [W, H] = PHOTO_SIZE;
    const c = canvasOf(W, H);
    const ctx = c.getContext('2d');
    ctx.drawImage(photo, 0, 0, W, H);
    const { tl, tr, br, bl } = SCREEN_QUAD;
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const sw = screen.width, sh = screen.height;
    const strips = 36;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(...tl); ctx.lineTo(...tr); ctx.lineTo(...br); ctx.lineTo(...bl); ctx.closePath(); ctx.clip();
    for (let i = 0; i < strips; i++) {
      const t0 = i / strips, t1 = (i + 1) / strips;
      const L0 = lerp(tl, bl, t0), R0 = lerp(tr, br, t0), L1 = lerp(tl, bl, t1);
      const sy = t0 * sh, sH = (t1 - t0) * sh;
      // affine: (0,0)→L0, (sw,0)→R0, (0,sH)→L1
      const a = (R0[0] - L0[0]) / sw, b = (R0[1] - L0[1]) / sw;
      const cc = (L1[0] - L0[0]) / sH, d = (L1[1] - L0[1]) / sH;
      ctx.setTransform(a, b, cc, d, L0[0], L0[1]);
      // Overdraw each strip by a few source pixels so edges blend instead of showing seams.
      const over = i === strips - 1 ? 0 : sh / strips * 0.35;
      ctx.drawImage(screen, 0, sy, sw, sH + over, 0, 0, sw, sH + over);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // glass glare + slight darkening at the edges so it sits in the photo
    const glare = ctx.createLinearGradient(tl[0], tl[1], br[0], br[1]);
    glare.addColorStop(0, 'rgba(255,255,255,0.10)'); glare.addColorStop(0.45, 'rgba(255,255,255,0)'); glare.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = glare; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    return c;
  }

  // Zoomed crop around the machine so the ad is legible in emails and previews.
  const CLOSEUP = { x: 300, y: 420, w: 450, h: 620, scale: 2 };
  function drawCloseup(machine) {
    const c = canvasOf(CLOSEUP.w * CLOSEUP.scale, CLOSEUP.h * CLOSEUP.scale);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(machine, CLOSEUP.x, CLOSEUP.y, CLOSEUP.w, CLOSEUP.h, 0, 0, c.width, c.height);
    return c;
  }

  async function render(spec, { logoUrl = '', photoUrl = PHOTO, artUrl = '' } = {}) {
    if (document.fonts?.load) { try { await Promise.all([document.fonts.load(`900 60px ${FONT}`), document.fonts.load(`700 26px ${FONT}`)]); } catch { /* fall back to system font */ } }
    const [photo, logo, art] = await Promise.all([loadImage(photoUrl), logoUrl ? loadImage(logoUrl).catch(() => null) : null, artUrl ? loadImage(artUrl).catch(() => null) : null]);
    const banner = drawBanner(spec, logo, art);
    const screen = drawScreen(spec, banner);
    const machine = drawMachine(photo, screen);
    const closeup = drawCloseup(machine);
    return { banner, screen, machine, closeup };
  }

  function download(canvas, filename) {
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: filename });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
  }

  window.KWIGZ_MOCKUP = { SCREEN_QUAD, PHOTO, THEMES, render, drawBanner, drawScreen, drawMachine, drawCloseup, loadImage, download };
})();
