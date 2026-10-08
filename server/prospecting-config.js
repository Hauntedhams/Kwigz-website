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
    },
  },
};
