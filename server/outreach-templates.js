// Outreach copy for the admin "Generate outreach" step. Plain templates, no AI.
// Edit freely. Every function receives a context object built by server/prospecting.js:
//   firstName, contactName, business, title, category (label), pitch {hook, audience, tagline, cta},
//   specialty (from Clay, e.g. "DUI Defense"), machine {name, city, venueType, address},
//   price, plays, bannerSeconds, previewUrl, siteUrl, sender {name, title, phone, email},
//   distanceMiles

function greeting(ctx) {
  return ctx.firstName ? `Hi ${ctx.firstName},` : `Hi ${ctx.business} team,`;
}

function signature(ctx) {
  return [ctx.sender.name, ctx.sender.title, ctx.sender.phone, ctx.sender.email, ctx.siteUrl].filter(Boolean).join('\n');
}

function email(ctx) {
  const where = `${ctx.machine.name}${ctx.machine.city ? ` in ${ctx.machine.city}` : ''}`;
  const near = ctx.distanceMiles != null ? ` — about ${ctx.distanceMiles} miles from your office` : '';
  return {
    subject: `${ctx.business} on the screen at ${ctx.machine.name}?`,
    body: [
      greeting(ctx),
      '',
      `I run KWIGZ — we operate the age-verified vending machine inside ${where}${near}. Every customer uses its touchscreen, and we put exactly one local business per category on it.`,
      '',
      ctx.pitch.hook,
      '',
      `I mocked up what ${ctx.business} would look like on the screen${ctx.specialty ? ` (I used "${ctx.specialty}" from your site)` : ''}:`,
      ctx.previewUrl,
      '',
      `The ${ctx.category} slot is open right now. It's $${ctx.price}/month for roughly ${ctx.plays.toLocaleString('en-US')} ${ctx.bannerSeconds}-second plays a month, no contract, and we can have you live in a few days.`,
      '',
      'Want me to hold it for you? Reply here or text me and I\'ll send the details.',
      '',
      signature(ctx),
    ].join('\n'),
  };
}

function followUpEmail(ctx) {
  return {
    subject: `Re: ${ctx.business} on the screen at ${ctx.machine.name}?`,
    body: [
      greeting(ctx),
      '',
      `Quick follow-up — the ${ctx.category} slot at ${ctx.machine.name} is still open, and it's one business per category, so once it's taken it's taken.`,
      '',
      `Here's the mockup again: ${ctx.previewUrl}`,
      '',
      'Happy to answer anything, or if it\'s not a fit just tell me and I\'ll stop bugging you.',
      '',
      signature(ctx),
    ].join('\n'),
  };
}

function sms(ctx) {
  const name = ctx.firstName ? `Hi ${ctx.firstName}, ` : 'Hi, ';
  return `${name}this is ${ctx.sender.name} with KWIGZ. We run the vending screen at ${ctx.machine.name}${ctx.machine.city ? ` (${ctx.machine.city})` : ''} and the ${ctx.category} ad slot is open — one business per category, $${ctx.price}/mo. Here's a mockup of ${ctx.business} on it: ${ctx.previewUrl} Want it?`;
}

function followUpSms(ctx) {
  return `${ctx.firstName ? `${ctx.firstName}, ` : ''}following up from KWIGZ — ${ctx.category} slot at ${ctx.machine.name} is still open. Mockup: ${ctx.previewUrl} Want me to hold it?`;
}

// LinkedIn connection notes are capped at ~300 characters; keep the opener short and
// put the detail in the follow-up message after they accept.
function linkedin(ctx) {
  const note = `Hi ${ctx.firstName || 'there'} — I run KWIGZ, the vending screen inside ${ctx.machine.name}${ctx.machine.city ? ` (${ctx.machine.city})` : ''}. The ${ctx.category} ad slot is open and I mocked up ${ctx.business} on it. Mind if I send it over?`;
  const message = [
    `Thanks for connecting, ${ctx.firstName || 'there'}.`,
    '',
    `Here's what ${ctx.business} would look like on the screen at ${ctx.machine.name}: ${ctx.previewUrl}`,
    '',
    `${ctx.pitch.hook} It's one ${ctx.category.toLowerCase()} business per machine, $${ctx.price}/month, no contract.`,
    '',
    'Worth a quick call this week?',
  ].join('\n');
  return { note: note.slice(0, 300), message };
}

module.exports = { email, followUpEmail, sms, followUpSms, linkedin };
