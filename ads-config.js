// KWIGZ advertising configuration.
// Edit this file to add machines, change ad hours, or mark categories as taken.
// All estimates on the site are computed from these values.
window.KWIGZ_ADS = {
  bannerSeconds: 15,     // every banner displays for 15 seconds
  maxUnits: 10,          // a fully booked machine = 10 rotation units
  campaignDays: 30,
  approvalDays: 3,       // estimated days from application to going live
  bannerSize: { width: 1080, height: 441 },

  // Budget → rotation units ($200 per unit). Higher budget = proportionally more plays.
  budgets: [
    { amount: 200, units: 1 },
    { amount: 300, units: 1.5 },
    { amount: 400, units: 2 },
  ],

  // One advertiser per category per machine.
  categories: [
    { id: 'dui', label: 'DUI / Criminal Defense', icon: 'scales' },
    { id: 'injury', label: 'Personal Injury', icon: 'bandage' },
    { id: 'motorcycle', label: 'Motorcycle', icon: 'motorcycle' },
    { id: 'bail', label: 'Bail Bonds', icon: 'unlock' },
    { id: 'tattoo', label: 'Tattoo', icon: 'pen' },
    { id: 'insurance', label: 'Insurance', icon: 'shield' },
    { id: 'hvac', label: 'HVAC', icon: 'snowflake' },
    { id: 'plumbing', label: 'Plumbing', icon: 'wrench' },
    { id: 'autobody', label: 'Auto Body', icon: 'car' },
    { id: 'restaurant', label: 'Restaurant', icon: 'utensils' },
    { id: 'other', label: 'Other', icon: 'sparkles' },
  ],

  machines: [
    {
      id: 'chopper-johns-phoenix',
      name: "Chopper John's",
      city: 'Phoenix, AZ',
      adHoursPerDay: 16,          // 10 AM – 2 AM
      // Category ids currently occupied by an active campaign:
      takenCategories: [],
    },
  ],
};
