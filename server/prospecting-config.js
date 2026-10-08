// Lead-generation settings for the admin "Generate leads" button.
// Edit this file to tune who gets found for each advertiser category.
//
// Searches run against Clay's company database (free). Each company found is then
// enriched through Clay-managed functions (costs credits — see `routines` below).
// Query grammar: `clay searches query-mode reference` (Clay CLI) or
// https://developers.clay.com/searches/advanced

module.exports = {
  defaults: {
    limit: 15,              // leads per run (admin can pick 5–maxLimit)
    maxLimit: 20,
    radiusMiles: 20,        // drop companies further than this from the machine
    candidateMultiplier: 3, // search for N× the requested leads, then keep the closest / best
    maxCandidates: 60,      // hard cap on companies enriched per run (0.5 credit each)
    contactsPerCompany: 2,
    followUpDays: 2,        // "follow up" reminder after an outreach touch
    websitePhoneTimeoutMs: 7000,
  },

  // Who the outreach comes from. Merge fields {{senderName}} etc. in templates.
  sender: {
    name: 'Victor',
    title: 'Founder, KWIGZ',
    phone: '',
    email: '',
  },

  // Clay-managed function routine ids (find yours with `clay routines list`).
  routines: {
    enrichCompany: 'function:t_0tmg770K2e6ZsSBRVnq',   // 0.5 credit — address, lat/lng, logo, specialties
    workEmail: 'function:t_0tmg77588XJgBgoCmRc',       // 1.1 credits — needs Full Name + Company Domain + Company Name
    mobilePhone: 'function:t_0tmg771yM7Pat8cFmP8',     // 10.3 credits — optional, per contact, on demand
  },
  creditEstimates: { enrichCompany: 0.5, workEmail: 1.1, mobilePhone: 10.3 },

  // AI banner art (Gemini "Nano Banana", free tier). The model paints ONLY the background —
  // the real logo, name, phone and CTA are drawn on top by mockup.js, so they're always exact.
  // {{scene}} comes from categories.<id>.art; the rest is auto-filled from the lead.
  art: {
    aspectRatio: '21:9',   // closest supported ratio to the 1080×441 banner; cover-cropped on render
    imageSize: '1K',
    maxVariants: 6,        // per lead, oldest kept; extra generations replace nothing — admin deletes
    prompt: [
      'Create a premium advertising background for a {{category}} business called "{{business}}" in {{city}}, Arizona.',
      'Scene: {{scene}}',
      'Composition: wide cinematic 21:9 banner. Keep the LEFT 60% of the frame dark, simple and low-detail so white text stays readable there; put the visual interest on the right third.',
      'Style: photoreal, moody, high-end, shallow depth of field, rich contrast, no clutter.',
      'If a logo image is attached, use it ONLY as a color and mood reference — match its palette in the lighting and accents.',
      'Absolutely no text, letters, numbers, words, logos, signs, phone numbers, watermarks or UI elements anywhere in the image. No people\'s faces in close-up.',
      '{{direction}}',
    ].join('\n'),
  },

  // Cities searched for each machine. Clay filters by headquarters city, not radius, so
  // list every city inside the radius; the distance filter trims the rest afterwards.
  metros: {
    'chopper-johns-phoenix': {
      state: 'Arizona',
      cities: ['Phoenix', 'Scottsdale', 'Tempe', 'Mesa', 'Chandler', 'Gilbert', 'Glendale', 'Peoria', 'Paradise Valley', 'Avondale', 'Tolleson', 'Fountain Hills'],
    },
  },
  defaultMetro: { state: 'Arizona', cities: ['Phoenix'] },

  // Decision-maker titles, highest priority first. Shared unless a category overrides.
  defaultTitles: ['Owner', 'Founder', 'Co-Founder', 'President', 'CEO', 'Managing Partner', 'Partner', 'General Manager', 'Marketing Director', 'Marketing Manager', 'Office Manager'],

  // Per advertiser category (ids match ads-config.js).
  //   industries  → Clay `industry` enum values
  //   keywords    → `description contains (...)`, whole-word match
  //   sizes       → Clay `company_size` buckets to keep (small local businesses)
  //   titles      → overrides defaultTitles
  //   pitch       → words used by the outreach templates
  //   art         → the scene Gemini paints behind the banner (see `art.prompt` above)
  categories: {
    dui: {
      industries: ['Law Practice', 'Legal Services'],
      keywords: ['DUI', 'DWI', 'criminal defense', 'drunk driving'],
      sizes: ['1', '2-10', '11-50'],
      titles: ['Owner', 'Founder', 'Founding Partner', 'Managing Partner', 'Managing Attorney', 'Partner', 'Attorney', 'Marketing Director', 'Office Manager'],
      pitch: {
        audience: 'people who are out drinking tonight',
        hook: 'Your next DUI client is standing at the bar right now — and we have the only screen they look at before they leave.',
        tagline: 'DUI & Criminal Defense',
        cta: 'Arrested? Call now.',
      },
      art: 'a dim Phoenix city street at night after the bars close, wet asphalt reflecting red and blue police light in the far distance, a confident downtown law-office skyline, calm and authoritative',
    },
    injury: {
      industries: ['Law Practice', 'Legal Services'],
      keywords: ['personal injury', 'accident attorney', 'injury lawyer', 'car accident', 'motorcycle accident'],
      sizes: ['1', '2-10', '11-50'],
      titles: ['Owner', 'Founder', 'Founding Partner', 'Managing Partner', 'Managing Attorney', 'Partner', 'Attorney', 'Marketing Director', 'Office Manager'],
      pitch: {
        audience: 'riders and drivers in a 21+ nightlife crowd',
        hook: 'Our screens sit inside a biker bar — the exact crowd that calls an injury attorney after a wreck.',
        tagline: 'Personal Injury Attorneys',
        cta: 'Injured? Free consultation.',
      },
      art: 'a desert highway at dusk with a motorcycle and car headlights streaking past, Phoenix skyline glowing, a sense of protection and strength, deep navy and amber tones',
    },
    motorcycle: {
      industries: ['Motor Vehicle Manufacturing', 'Retail Motor Vehicles', 'Vehicle Repair and Maintenance', 'Retail', 'Automotive'],
      keywords: ['motorcycle', 'Harley', 'motorcycles', 'bike shop', 'custom bikes'],
      sizes: ['1', '2-10', '11-50', '51-200'],
      pitch: {
        audience: 'riders who are already in a biker bar',
        hook: 'Every person who sees our screen rode in — your shop would be the only motorcycle brand on it.',
        tagline: 'Motorcycle Sales · Service · Parts',
        cta: 'Ride in this weekend.',
      },
      art: 'a gleaming custom cruiser motorcycle under warm garage lights, chrome and polished black paint, Arizona sunset through an open roll-up door, dust in the air',
    },
    bail: {
      industries: ['Legal Services', 'Financial Services', 'Consumer Services'],
      keywords: ['bail bonds', 'bail bond', 'bail bondsman'],
      sizes: ['1', '2-10', '11-50'],
      pitch: {
        audience: 'late-night bar-goers',
        hook: 'When someone\'s friend gets picked up after last call, the number they remember is the one they saw on our screen.',
        tagline: '24/7 Bail Bonds',
        cta: 'Call anytime, day or night.',
      },
      art: 'a quiet downtown Phoenix courthouse at night with warm lights on, a 24-hour open-sign glow (no readable text), reassuring and ready, deep green and gold tones',
    },
    tattoo: {
      industries: ['Consumer Services', 'Retail', 'Arts and Crafts', 'Personal Care Services'],
      keywords: ['tattoo', 'tattoos', 'tattoo studio', 'piercing'],
      sizes: ['1', '2-10', '11-50'],
      titles: ['Owner', 'Founder', 'Co-Founder', 'Shop Manager', 'Studio Manager', 'Artist'],
      pitch: {
        audience: 'a 21+ bar crowd a few blocks from your shop',
        hook: 'Bar crowds book tattoos. You would be the only studio on a screen they look at every time they buy.',
        tagline: 'Custom Tattoos & Piercing',
        cta: 'Walk-ins welcome.',
      },
      art: 'a moody tattoo studio interior, neon pink and violet glow on dark brick, tattoo machines and ink bottles in soft focus, artistic and edgy',
    },
    insurance: {
      industries: ['Insurance', 'Insurance Agencies and Brokerages', 'Insurance Carriers'],
      keywords: ['motorcycle insurance', 'auto insurance', 'insurance agency', 'insurance agent'],
      sizes: ['1', '2-10', '11-50'],
      titles: ['Owner', 'Agency Owner', 'Agent', 'Principal', 'President', 'Marketing Manager'],
      pitch: {
        audience: 'local riders and drivers',
        hook: 'Riders need motorcycle and auto coverage — our screen is inside the bar they drink at.',
        tagline: 'Auto · Motorcycle · Home Insurance',
        cta: 'Get a free quote.',
      },
      art: 'a protected home and motorcycle in a Phoenix suburb at golden hour, calm sky, a feeling of security and trust, teal and navy palette',
    },
    hvac: {
      industries: ['Building Equipment Contractors', 'Construction', 'Consumer Services', 'Repair and Maintenance', 'Facilities Services'],
      keywords: ['HVAC', 'air conditioning', 'AC repair', 'heating and cooling', 'residential', 'homeowners'],
      sizes: ['2-10', '11-50', '51-200'],
      pitch: {
        audience: 'homeowners within a few miles of your shop',
        hook: 'Phoenix homeowners are in this bar every night — and in July, every one of them needs an AC guy.',
        tagline: 'Air Conditioning Repair & Install',
        cta: 'Same-day service.',
      },
      art: 'a blazing Phoenix summer sky over desert rooftops with a modern AC condenser unit, cool blue air flowing from a vent into a dark comfortable room, relief from heat',
    },
    plumbing: {
      industries: ['Building Equipment Contractors', 'Construction', 'Consumer Services', 'Repair and Maintenance'],
      keywords: ['plumbing', 'plumber', 'plumbers', 'drain cleaning', 'water heater'],
      sizes: ['2-10', '11-50', '51-200'],
      pitch: {
        audience: 'homeowners in the neighborhood',
        hook: 'Everyone in that bar owns a water heater that will fail someday. Be the name they already know.',
        tagline: 'Plumbing · Drains · Water Heaters',
        cta: '24/7 emergency service.',
      },
      art: 'gleaming copper and chrome pipes with crystal-clear water droplets, a modern water heater in a clean dark utility room, green and steel tones',
    },
    autobody: {
      industries: ['Vehicle Repair and Maintenance', 'Automotive Service and Collision Repair', 'Automotive', 'Motor Vehicle Manufacturing'],
      keywords: ['auto body', 'collision repair', 'collision', 'body shop', 'paint and body'],
      sizes: ['1', '2-10', '11-50'],
      pitch: {
        audience: 'drivers and riders in a nightlife crowd',
        hook: 'Nightlife and fender-benders go together. Your shop would be the only body shop on our screen.',
        tagline: 'Collision & Auto Body Repair',
        cta: 'Free estimates.',
      },
      art: 'a flawless freshly painted car in a dark showroom-style body shop, mirror reflections on the paint, sparks from a welder in the background, red and charcoal tones',
    },
    restaurant: {
      industries: ['Restaurants', 'Food and Beverage Services', 'Food & Beverages'],
      keywords: ['restaurant', 'late night', 'tacos', 'pizza', 'burgers', 'delivery', 'wings'],
      sizes: ['1', '2-10', '11-50'],
      titles: ['Owner', 'Founder', 'Co-Founder', 'General Manager', 'Operating Partner', 'Marketing Manager'],
      pitch: {
        audience: 'hungry bar-goers right before they leave',
        hook: 'Our screen is the last thing people look at before they leave the bar hungry.',
        tagline: 'Open Late · Dine In · Takeout',
        cta: 'Open late tonight.',
      },
      art: 'late-night street food under warm string lights, sizzling tacos and burgers steaming on a dark wooden table, cozy and inviting, amber and red tones',
    },
    other: {
      industries: [],
      keywords: [],
      sizes: ['1', '2-10', '11-50'],
      pitch: {
        audience: 'a 21+ nightlife crowd',
        hook: 'We put one local business per category on the screen people use every time they buy.',
        tagline: 'Proudly serving Phoenix',
        cta: 'Call today.',
      },
      art: 'a stylish Phoenix nightlife scene at dusk, warm bar lights and a desert skyline, upscale and local',
    },
  },
};
