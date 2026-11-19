// KWIGZ advertising configuration.
// Edit this file to add machines, change ad hours, or mark categories as taken.
// All estimates on the site are computed from these values.
window.KWIGZ_ADS = {
  bannerSeconds: 15,     // every banner displays for 15 seconds
  maxUnits: 33,          // a fully booked machine = 33 advertising slots
  campaignDays: 30,
  approvalDays: 3,       // estimated days from application to going live
  bannerSize: { width: 1080, height: 441 },

  // callOnly tiers show "Schedule a call" on the site instead of prices; the prices
  // stay here for admin quoting and booking.
  // maxPerCategory caps how many advertisers of the same
  // category can share one machine (null = no cap, until the machine is full).
  tiers: {
    premium:   { label: 'Full Exclusive', callOnly: true, prices: [500],           maxPerCategory: 1,    note: 'Only one advertiser in your category on this machine.' },
    exclusive: { label: 'Full Exclusive', callOnly: true, prices: [300, 400],      maxPerCategory: 1,    note: 'Only one advertiser in your category on this machine.' },
    limited:   { label: 'Limited',        prices: [75], maxPerCategory: 2,    note: 'Limited to 1–2 advertisers per category on this machine.' },
    open:      { label: 'Multiple OK',    prices: [75], maxPerCategory: null, note: 'Multiple businesses in your category can advertise here.' },
  },

  categories: [
    { id: 'dui', label: 'DUI / Criminal Defense', icon: 'scales', tier: 'premium' },
    { id: 'injury', label: 'Personal Injury', icon: 'bandage', tier: 'premium' },
    { id: 'bail', label: 'Bail Bonds', icon: 'unlock', tier: 'premium' },
    { id: 'family', label: 'Divorce / Family Law', icon: 'scales', tier: 'exclusive' },
    { id: 'insurance', label: 'Insurance', icon: 'shield', tier: 'exclusive' },
    { id: 'roofing', label: 'Roofing & Storm Damage', icon: 'building', tier: 'exclusive' },
    { id: 'hvac', label: 'HVAC', icon: 'snowflake', tier: 'exclusive' },
    { id: 'plumbing', label: 'Plumbing', icon: 'wrench', tier: 'exclusive' },
    { id: 'medspa', label: 'Med Spa', icon: 'sparkles', tier: 'limited' },
    { id: 'dentist', label: 'Cosmetic Dentist', icon: 'sparkles', tier: 'limited' },
    { id: 'debt', label: 'Debt Relief', icon: 'banknote', tier: 'limited' },
    { id: 'motorcycle', label: 'Motorcycle', icon: 'motorcycle', tier: 'limited' },
    { id: 'autobody', label: 'Auto Body', icon: 'car', tier: 'limited' },
    { id: 'localservices', label: 'Local Services', icon: 'briefcase', tier: 'limited' },
    { id: 'tattoo', label: 'Tattoo', icon: 'pen', tier: 'open' },
    { id: 'barber', label: 'Barber', icon: 'pen', tier: 'open' },
    { id: 'restaurant', label: 'Restaurant', icon: 'utensils', tier: 'open' },
    { id: 'other', label: 'Other', icon: 'sparkles', tier: 'open' },
  ],

  machines: [
    {
      id: 'chopper-johns-phoenix',
      name: "Chopper John's",
      city: 'Phoenix, AZ',
      venueType: 'biker bar',
      address: '2547 E Indian School Rd, Phoenix, AZ 85016',
      // Used by the admin's lead generator to keep prospects within a driving radius.
      lat: 33.495,
      lng: -112.0285,
      adHoursPerDay: 14,          // conservative daily advertising window
      // Category ids currently occupied by an active campaign:
      takenCategories: [],
    },
    {
      id: 'cousins-wappapello',
      name: 'Cousins Bar & Grill',
      city: 'Wappapello, MO',
      venueType: 'lakeside bar & grill',
      address: '38 Wayne 521A, Wappapello, MO 63966',
      lat: 36.927,
      lng: -90.285,
      adHoursPerDay: 14,          // 11 AM – 1 AM (estimate — adjust to the bar's hours)
      takenCategories: [],
    },
  ],
};

// Self-serve plans add one $75 slot at each step. The $500 option is reserved
// for separately quoted exclusive campaigns.
window.KWIGZ_ADS.slider = { min: 75, max: 375, step: 75, default: 75 };
window.KWIGZ_ADS.estimatedLeadsPerSlot = [5, 10];
window.KWIGZ_ADS.potentialImpressionsPerSlot = 10000;
window.KWIGZ_ADS.budgets = [
  { amount: 75, units: 1 },
  { amount: 150, units: 2 },
  { amount: 225, units: 3 },
  { amount: 300, units: 4 },
  { amount: 375, units: 5 },
  { amount: 500, units: 1 },
];

// Pricing tier for a category id (falls back to the open tier).
window.KWIGZ_ADS.tierFor = (categoryId) => {
  const ads = window.KWIGZ_ADS;
  const cat = ads.categories.find(c => c.id === categoryId);
  return ads.tiers[cat && cat.tier] || ads.tiers.open;
};
