// === Navbar scroll effect (only on home page) ===
const navbar = document.getElementById('navbar');
if (navbar && !navbar.classList.contains('scrolled')) {
  const onScroll = () => navbar.classList.toggle('scrolled', window.scrollY > 50);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// === Slide-out menu (top-left) ===
const menuBtn = document.getElementById('menuBtn');
const menuClose = document.getElementById('menuClose');
const menuOverlay = document.getElementById('menuOverlay');
const siteMenu = document.getElementById('siteMenu');

if (menuBtn && siteMenu && menuOverlay) {
  const setMenu = (open) => {
    siteMenu.classList.toggle('open', open);
    menuOverlay.classList.toggle('open', open);
    document.body.classList.toggle('menu-open', open);
    siteMenu.setAttribute('aria-hidden', String(!open));
    menuBtn.setAttribute('aria-expanded', String(open));
  };
  menuBtn.addEventListener('click', () => setMenu(true));
  if (menuClose) menuClose.addEventListener('click', () => setMenu(false));
  menuOverlay.addEventListener('click', () => setMenu(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
  siteMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setMenu(false)));
}

// === Scroll-based fade-in animations ===
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });

document.querySelectorAll(
  '.value-card, .section-header, .showcase-grid, .profit-card, .agreement-card, .credential-card, .liability-block, .contact-form, .sidebar-card, .download-content, .hero-grid'
).forEach(el => {
  el.classList.add('fade-in');
  observer.observe(el);
});

document.querySelectorAll('.value-grid, .credentials-grid, .agreement-grid').forEach(grid => {
  Array.from(grid.children).forEach((child, i) => {
    child.style.transitionDelay = `${i * 0.08}s`;
  });
});

// === Lead capture ===
// Only a confirmed save counts as a successful submission.
const LEADS_ENDPOINT = window.KWIGZ_LEADS_ENDPOINT || '/api/leads';
const FALLBACK_EMAIL = 'kwigzvending@gmail.com';

async function submitLead(payload) {
  const res = await fetch(LEADS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.ok !== true) throw new Error(data.error || 'Your submission could not be saved.');
  return data;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// === Qualifier wizard (home page) ===
const qualifier = document.getElementById('qualifier');
if (qualifier) {
  const answers = {};
  const steps = qualifier.querySelectorAll('.q-step');

  const showStep = (name) => {
    steps.forEach(s => s.classList.toggle('is-active', s.dataset.step === name));
    const top = qualifier.getBoundingClientRect().top + window.scrollY - 90;
    if (Math.abs(window.scrollY - top) > 40) window.scrollTo({ top, behavior: 'smooth' });
  };

  qualifier.querySelectorAll('.path-card').forEach(card => {
    card.addEventListener('click', () => {
      answers.path = card.dataset.path;
      showStep(card.dataset.path === 'business' ? 'b1' : 'a1');
    });
  });

  const failReason = document.getElementById('failReason');
  qualifier.querySelectorAll('.q-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      opt.parentElement.querySelectorAll('.q-opt').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      answers[opt.dataset.key] = opt.dataset.answer;
      if (opt.dataset.pass === 'false' && failReason) {
        failReason.textContent = opt.dataset.key === 'age21'
          ? 'All venue partners must be 21 or older to host a nicotine vending machine.'
          : 'Our units need at least 3 ft of open wall space to be installed safely.';
      }
      setTimeout(() => showStep(opt.dataset.next), 180);
    });
  });

  qualifier.querySelectorAll('.q-back').forEach(btn => {
    btn.addEventListener('click', () => showStep(btn.dataset.back));
  });

  // --- Advertiser wizard ---
  const ADS = window.KWIGZ_ADS;
  if (ADS) {
    // Live availability from the lead server overrides the static config, so
    // campaigns approved in /admin mark categories taken without a code change.
    fetch(LEADS_ENDPOINT.replace(/\/leads$/, '/availability'))
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data || !Array.isArray(data.machines)) return;
        data.machines.forEach(live => {
          const m = ADS.machines.find(x => x.id === live.id);
          if (m) m.takenCategories = Array.from(new Set([...(m.takenCategories || []), ...live.takenCategories]));
        });
      })
      .catch(err => console.warn('Live availability could not be loaded; final availability will be confirmed on review.', err));

    const fmt = (n) => Math.round(n).toLocaleString('en-US');
    const money = (n) => `$${n}`;
    const catById = (id) => ADS.categories.find(c => c.id === id);
    const machineById = (id) => ADS.machines.find(m => m.id === id);
    const icon = (name) => `<svg class="site-icon" aria-hidden="true" focusable="false"><use href="icons.svg#${name}"></use></svg>`;

    // Conservative estimate: assume the machine is fully booked (maxUnits), so a
    // lighter rotation only ever means *more* plays than quoted.
    const estimateMonthlyPlays = (machine, units) => {
      const totalUnits = Math.max(ADS.maxUnits, units);
      const rotationSeconds = ADS.bannerSeconds * totalUnits;
      const playsPerHour = 3600 / rotationSeconds;
      return playsPerHour * machine.adHoursPerDay * ADS.campaignDays * units;
    };

    const campaignDates = () => {
      const start = new Date();
      start.setDate(start.getDate() + ADS.approvalDays);
      const end = new Date(start);
      end.setDate(end.getDate() + ADS.campaignDays - 1);
      const f = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return { start, end, label: `${f(start)} – ${f(end)}` };
    };

    // Step 1: categories
    const catGrid = document.getElementById('catGrid');
    catGrid.innerHTML = ADS.categories.map(c =>
      `<button type="button" class="q-opt cat-opt" data-cat="${c.id}"><span class="cat-icon">${icon(c.icon)}</span><span>${c.label}</span></button>`
    ).join('');
    catGrid.querySelectorAll('.cat-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        catGrid.querySelectorAll('.cat-opt').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        answers.category = catById(btn.dataset.cat).label;
        answers.categoryId = btn.dataset.cat;
        renderMachines();
        setTimeout(() => showStep('a2'), 180);
      });
    });

    // Step 2: machines with availability for the chosen category
    const machineList = document.getElementById('machineList');
    const renderMachines = () => {
      machineList.innerHTML = ADS.machines.map(m => {
        const taken = m.takenCategories.includes(answers.categoryId);
        const openCount = ADS.categories.filter(c => c.id !== 'other' && !m.takenCategories.includes(c.id)).length;
        return `<button type="button" class="machine-card ${taken ? 'is-taken' : ''}" data-machine="${m.id}">
          <div class="machine-info">
            <h4>${m.name}</h4>
            <p>${m.city} · ${m.adHoursPerDay} advertising hrs/day</p>
            <span class="machine-open">${openCount} of ${ADS.maxUnits} categories open</span>
          </div>
          <span class="avail-badge ${taken ? 'taken' : 'open'}">${icon(taken ? 'lock' : 'check-circle')} ${answers.category} ${taken ? 'taken' : 'available'}</span>
        </button>`;
      }).join('');
      machineList.querySelectorAll('.machine-card').forEach(card => {
        card.addEventListener('click', () => {
          const m = machineById(card.dataset.machine);
          answers.machine = `${m.name} — ${m.city}`;
          answers.machineId = m.id;
          if (m.takenCategories.includes(answers.categoryId)) {
            document.getElementById('takenTitle').textContent = `${answers.category} is already taken at ${m.name}.`;
            showStep('a-taken');
            return;
          }
          renderBudgets(m);
          setTimeout(() => showStep('a3'), 180);
        });
      });
    };

    // Step 3: budgets with live play estimates
    const budgetGrid = document.getElementById('budgetGrid');
    const budgetNote = document.getElementById('budgetNote');
    const renderBudgets = (m) => {
      budgetGrid.innerHTML = ADS.budgets.map((b, i) => `
        <button type="button" class="budget-card ${i === ADS.budgets.length - 2 ? 'is-popular' : ''}" data-amount="${b.amount}">
          ${i === ADS.budgets.length - 2 ? '<span class="budget-pop">Most popular</span>' : ''}
          <span class="budget-amount">${money(b.amount)}<small>/mo</small></span>
          <span class="budget-units">${b.units}× rotation</span>
          <span class="budget-plays">~${fmt(estimateMonthlyPlays(m, b.units))}</span>
          <span class="budget-plays-label">scheduled plays / month</span>
        </button>`).join('');
      budgetNote.textContent = `Estimates assume ${ADS.bannerSeconds}-second banners, ${m.adHoursPerDay} advertising hours/day at ${m.name}, and a fully booked rotation — a lighter rotation means more plays. Scheduled plays are calculated rotations, not guaranteed views.`;
      budgetGrid.querySelectorAll('.budget-card').forEach(card => {
        card.addEventListener('click', () => {
          const b = ADS.budgets.find(x => x.amount === Number(card.dataset.amount));
          budgetGrid.querySelectorAll('.budget-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          answers.budget = b.amount;
          answers.units = b.units;
          answers.estPlays = Math.round(estimateMonthlyPlays(m, b.units));
          renderSummary(m, b);
          setTimeout(() => showStep('a4'), 180);
        });
      });
    };

    // Step 4: summary
    const summaryEl = document.getElementById('campaignSummary');
    const renderSummary = (m, b) => {
      const dates = campaignDates();
      const localISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      answers.campaignStart = localISO(dates.start);
      answers.campaignEnd = localISO(dates.end);
      summaryEl.innerHTML = `
        <div class="summary-row"><span>Machine</span><strong>${m.name} · ${m.city}</strong></div>
        <div class="summary-row"><span>Category</span><strong>${answers.category} <em>(exclusive)</em></strong></div>
        <div class="summary-row"><span>Budget</span><strong>${money(b.amount)} / month</strong></div>
        <div class="summary-row"><span>Rotation</span><strong>${b.units}× · ${ADS.bannerSeconds}-second banner</strong></div>
        <div class="summary-row summary-highlight"><span>Est. scheduled plays</span><strong>~${fmt(answers.estPlays)} / month</strong></div>
        <div class="summary-row"><span>Campaign length</span><strong>${ADS.campaignDays} days · ${dates.label}<em>starts on approval, renews monthly</em></strong></div>`;
    };

    qualifier.querySelectorAll('[data-go]').forEach(btn => {
      btn.addEventListener('click', () => showStep(btn.dataset.go));
    });

    // Step 5: banner upload preview + dimension check
    const bannerInput = document.getElementById('ad-banner');
    const uploadBox = document.getElementById('uploadBox');
    const preview = document.getElementById('uploadPreview');
    const warn = document.getElementById('uploadWarn');
    const clearBanner = () => {
      bannerInput.value = '';
      preview.hidden = true;
      uploadBox.hidden = false;
      warn.hidden = true;
    };
    document.getElementById('uploadRemove').addEventListener('click', clearBanner);
    bannerInput.addEventListener('change', () => {
      const file = bannerInput.files[0];
      if (!file) return clearBanner();
      if (file.size > 5 * 1024 * 1024) {
        warn.textContent = 'That file is over 5 MB. Please upload a smaller image.';
        warn.hidden = false;
        bannerInput.value = '';
        return;
      }
      const url = URL.createObjectURL(file);
      const img = preview.querySelector('img');
      img.onload = () => {
        const { width: w, height: h } = ADS.bannerSize;
        document.getElementById('uploadDims').textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
        if (img.naturalWidth !== w || img.naturalHeight !== h) {
          warn.textContent = `Heads up: your banner is ${img.naturalWidth} × ${img.naturalHeight}. The machine displays ${w} × ${h} — we can resize it, but it may crop.`;
          warn.hidden = false;
        } else {
          warn.hidden = true;
        }
        URL.revokeObjectURL(url);
      };
      img.src = url;
      document.getElementById('uploadName').textContent = file.name;
      preview.hidden = false;
      uploadBox.hidden = true;
    });
  }

  qualifier.querySelectorAll('.lead-form').forEach(form => {
    form.querySelectorAll('input').forEach(i => i.addEventListener('input', () => i.classList.remove('invalid')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailInput = form.querySelector('input[name="email"]');
      const errorEl = form.querySelector('.lead-error');
      const submitBtn = form.querySelector('button[type="submit"]');
      const email = emailInput.value.trim();

      const missing = Array.from(form.querySelectorAll('[required]')).filter(i => !i.value.trim());
      missing.forEach(i => i.classList.add('invalid'));
      if (missing.length) {
        errorEl.textContent = 'Please fill in the required fields.';
        errorEl.hidden = false;
        missing[0].focus();
        return;
      }
      form.querySelectorAll('.invalid').forEach(i => i.classList.remove('invalid'));

      if (!isValidEmail(email)) {
        emailInput.classList.add('invalid');
        errorEl.textContent = 'Please enter a valid email address.';
        errorEl.hidden = false;
        emailInput.focus();
        return;
      }
      emailInput.classList.remove('invalid');
      errorEl.hidden = true;

      const fields = Array.from(new FormData(form).entries())
        .filter(([k, v]) => k !== 'email' && !(v instanceof File) && String(v).trim());
      const bannerFile = form.querySelector('input[type="file"]')?.files?.[0];

      const payload = {
        type: form.dataset.type,
        email,
        ...Object.fromEntries(fields),
        ...answers,
        page: window.location.href,
        submittedAt: new Date().toISOString(),
      };
      submitBtn.disabled = true;
      const originalLabel = submitBtn.textContent;
      submitBtn.textContent = 'Sending…';

      try {
        if (bannerFile) {
          payload.banner = { name: bannerFile.name, type: bannerFile.type, dataUrl: await readFileAsDataUrl(bannerFile) };
        }
        await submitLead(payload);
      } catch (err) {
        console.error('Lead submission failed', err);
        errorEl.textContent = `We couldn't save your submission. Please retry or email ${FALLBACK_EMAIL} directly.`;
        errorEl.hidden = false;
        return;
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }

      form.hidden = true;
      const done = form.parentElement.querySelector('.lead-done');
      if (done) done.hidden = false;
    });
  });
}

// === Contact form handling ===
const contactForm = document.getElementById('contactForm');
const formSuccess = document.getElementById('formSuccess');

if (contactForm && formSuccess) {
  const errorEl = document.createElement('p');
  errorEl.className = 'lead-error';
  errorEl.setAttribute('role', 'alert');
  errorEl.hidden = true;
  contactForm.append(errorEl);
  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = contactForm.querySelector('button[type="submit"]');
    if (button.disabled) return;
    button.disabled = true;
    errorEl.hidden = true;

    const data = Object.fromEntries(new FormData(contactForm).entries());
    const payload = { type: 'contact', ...data, page: window.location.href, submittedAt: new Date().toISOString() };

    try {
      await submitLead(payload);
    } catch (err) {
      console.error('Contact submission failed', err);
      errorEl.textContent = `We couldn't save your request. Please retry or email ${FALLBACK_EMAIL} directly.`;
      errorEl.hidden = false;
      return;
    } finally {
      button.disabled = false;
    }

    contactForm.style.display = 'none';
    const sidebar = document.querySelector('.contact-sidebar');
    if (sidebar) sidebar.style.display = 'none';

    formSuccess.classList.add('show');
    formSuccess.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}
