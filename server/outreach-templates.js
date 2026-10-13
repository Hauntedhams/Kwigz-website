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

function locationEmail(ctx) {
  return {
    subject: `Free machine placement + revenue share for ${ctx.business}?`,
    body: [
      greeting(ctx),
      '',
      `I run KWIGZ — we place premium automated machines (custom claw machines and modern SlimWall vending) in top local venues at zero upfront or ongoing cost to you.`,
      '',
      `Here's how it works for ${ctx.business}:`,
      `• Zero cost: We supply the machine, install it, stock it, and handle automated 21+ compliance.`,
      `• Passive revenue: Your venue earns guaranteed monthly revenue share from every transaction.`,
      `• Engaging customer experience: Patrons love playing and interacting with the machine while visiting your venue.`,
      `• Compact footprint: SlimWall units need only ~3 feet of wall or floor space and a standard outlet.`,
      '',
      `We are currently selecting venue partners in your area for upcoming machine placements. Would you have 5 minutes this week for a quick call or walk-in to see if ${ctx.business} is a good fit?`,
      '',
      signature(ctx),
    ].join('\n'),
  };
}

function locationFollowUpEmail(ctx) {
  return {
    subject: `Re: Machine placement + revenue share at ${ctx.business}`,
    body: [
      greeting(ctx),
      '',
      `Quick follow-up on my note about placing a KWIGZ machine inside ${ctx.business}.`,
      '',
      `We have placement units available for upcoming routes. It's completely free for your venue, hands-off for your team, and adds an extra stream of passive monthly profit.`,
      '',
      `Let me know if you're open to chatting or having me stop by for a quick 3-minute look at the space.`,
      '',
      signature(ctx),
    ].join('\n'),
  };
}

function locationSms(ctx) {
  const name = ctx.firstName ? `Hi ${ctx.firstName}, ` : 'Hi, ';
  return `${name}this is ${ctx.sender.name} with KWIGZ. We place free, automated machines (claw & vending) in top local venues with monthly revenue share. Interested in having one placed at ${ctx.business}? Zero cost to you.`;
}

function locationFollowUpSms(ctx) {
  return `${ctx.firstName ? `${ctx.firstName}, ` : ''}following up from KWIGZ about placing a machine at ${ctx.business}. Zero cost, we handle restocking & maintenance, and share the revenue with you. Open to a quick 2-min call?`;
}

function locationCallScript(ctx) {
  return [
    `Owner / Manager Pitch for ${ctx.business}:`,
    `"Hi, may I speak with the owner or GM? Hi ${ctx.firstName || '[Name]'}, my name is ${ctx.sender.name} with KWIGZ."`,
    `"We partner with top local venues like ${ctx.business} to place premium entertainment and vending machines at zero cost. We handle all delivery, stocking, and maintenance, and pay your venue a monthly revenue share."`,
    `"It takes just 3 feet of space and adds hands-free profit to your floor."`,
    `"I'll be in your area this week — would a 5-minute walk-in work to check out your space and see if it's a fit?"`,
  ].join('\n\n');
}

module.exports = {
  email, followUpEmail, sms, followUpSms, linkedin,
  locationEmail, locationFollowUpEmail, locationSms, locationFollowUpSms, locationCallScript,
};
