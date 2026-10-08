# KWIGZ Website

Static marketing site for KWIGZ nicotine vending partnerships, plus a tiny
zero-dependency Node server that captures leads and powers the admin dashboard.

## Run locally

```bash
ADMIN_PASSWORD=yourpassword node server/leads-server.js
# or: copy .env.example → .env, fill it in, then `npm run dev` (loads .env)
# site:   http://localhost:8000
# admin:  http://localhost:8000/admin
```

Without `ADMIN_PASSWORD` the dashboard still works, but only from localhost.
Use a unique production password of at least 24 characters. Never commit a
password or collected data. Run `npm run check` and `npm test` before deploying.
Tests use an isolated temporary data directory; they never edit your leads.

## Going live on Render (recommended)

The site is currently published from GitHub Pages (`CNAME` → kwigz.com). GitHub
Pages can't run the lead server. Forms show an explicit retry/direct-email
message until a working API is connected. To capture leads, host everything on Render:

1. Push this repo to GitHub (don't commit `server/data/` — it's git-ignored).
2. In Render: **New → Blueprint**, pick the repo. `render.yaml` sets up one
   web service with a 1 GB **persistent disk** mounted at `/data`.
   You'll be prompted for `ADMIN_PASSWORD` — use a unique password of at least
   24 characters. Production startup refuses a missing or weak password.
3. Use the actual service URL Render provides to open `/healthz`, then `/admin`
   to sign in. Submit a test lead and verify it survives a redeploy before
   changing DNS. The Blueprint uses Node 22 and Arizona time for campaign dates.
4. Point the domain at Render: in the service's **Settings → Custom Domains**
   add `kwigz.com` and `www.kwigz.com`, then update DNS at your registrar as
   Render instructs (A/ALIAS for apex, CNAME for www). Render issues SSL
   automatically. Finally disable GitHub Pages for the repo (Settings → Pages →
   None) so there aren't two copies of the site.

**Why a persistent disk?** Render's default filesystem is wiped on every deploy
and restart. Leads live in files, so they need the disk. Disks require a paid
instance (Starter, ~$7/mo) plus ~$0.25/GB for the disk.

**Keep GitHub Pages instead?** You can host just the API on Render and leave the
site where it is: deploy the same Blueprint, then add before `script.js` on
every page:

```html
<script>window.KWIGZ_LEADS_ENDPOINT = 'https://kwigz-website.onrender.com/api/leads';</script>
```

The admin dashboard would then live at the Render URL.

## Where leads go

Every form on the site (`See If You Qualify` business + advertiser flows, and
the contact page) POSTs to `/api/leads`. Each lead is appended to:

| File | Purpose |
|---|---|
| `DATA_DIR/leads.jsonl` | one JSON object per line — the full record |
| `DATA_DIR/leads.csv` | spreadsheet-friendly export (also downloadable from `/admin`) |
| `DATA_DIR/lead-meta.json` | status (new / contacted / won / lost) + your notes per lead |
| `DATA_DIR/campaigns.json` | advertiser campaigns created in `/admin` |
| `DATA_DIR/uploads/` | advertiser banner images |
| `DATA_DIR/prospects.json` | outbound prospects found with Clay (see *Prospecting*) |
| `DATA_DIR/prospect-runs.json`, `prospect-excluded.json`, `logos/`, `art/` | lead-search history, businesses ruled out, cached logos, AI banner art |
| `DATA_DIR/prospect-imports.json`, `imports/` | manual list imports and the original uploaded files |

`DATA_DIR` defaults to `server/data/` locally and `/data` on Render.

Nothing is emailed automatically yet. If a submission cannot be saved, its form
remains visible with an explicit retry/direct-email message. Success is displayed
only after the server confirms storage.

Export leads regularly and back up the entire persistent data directory using
Render's disk snapshot/backup facilities. A persistent disk is not an offsite backup.

## Admin dashboard (`/admin`)

Password-protected, single-page, no build step.

- **Overview** — new leads, weekly volume, slots filled, monthly ad revenue, and a
  *Needs attention* queue (applications to review, unpaid campaigns, creatives
  awaiting approval, campaigns ready to activate, renewals due).
- **Leads** — filter by type/status, search, click a row for every field, the
  uploaded banner, notes, and one-click *Create campaign* for advertiser apps.
  Export CSV.
- **Advertisers** — per-machine slot board (10 categories), live revenue, actual
  rotation length, quoted vs. live play estimates, and buttons for
  *Send payment link / Mark paid → Approve creative → Activate → End*, plus
  *Stop billing* on Stripe-billed campaigns. *+ Book* on any open slot.
- **Calendar** — month timeline of all campaigns (click a bar to edit), plus key
  dates: starts, renewals, expirations. *Renew +30d* clones a campaign.
- **Prospecting** — outbound lead generation: Clay search or a free import of your own Google Maps list. See below.
- **Outreach** — per-business checklist of email / text / LinkedIn / call / follow-up touches. See below.

### Campaign workflow

1. Advertiser applies on the site → shows up as a lead and in *Needs attention*.
2. **Create campaign** (prefilled from the application). Status `pending`
   immediately **reserves the category** on that machine — the public site
   pulls `/api/availability` and shows it as taken.
   **+ Add campaign**, **+ Book**, and **Renew** create separate records, even
   after editing another campaign. Only **Edit** updates an existing record;
   new records do not inherit another campaign's payment link or subscription.
3. Collect payment → **Send payment link** (Stripe, see below) or **Mark paid**
   for cash/check. Check the banner → **Approve creative**.
4. Assign the banner in VapeTM, then **Activate**. The dashboard tracks dates;
   campaigns auto-flip to `ended` the day after their end date, which frees
   the slot again.
5. Two campaigns can't hold the same category on the same machine for
   overlapping dates — the server rejects the conflicting booking. End or cancel
   the old campaign or choose non-overlapping dates.

## Prospecting — "Generate leads" (Clay)

The **Prospecting** tab finds local businesses to sell ad slots to, writes the
outreach, and reminds you to follow up. It talks to Clay's Public API
(`api.clay.com/public/v0`) directly from the server — zero npm dependencies.

### Setup (once)

1. Get a Clay Public API key: with the Clay CLI, `clay api-keys create --name kwigz`
   (the key prints once), or in Clay → Settings → Account → API keys.
2. Set `CLAY_API_KEY` on Render (the Blueprint prompts for it) or in a local `.env`
   (see `.env.example`; `npm run dev` loads it).
3. Make sure each machine in `ads-config.js` has `lat`/`lng`/`address` — the radius
   filter needs them. Chopper John's is already filled in.

Everything the generator does per category — Clay industries, keywords, company
sizes, which job titles count as decision-makers, the pitch line used in the
templates, and the metro city list — lives in `server/prospecting-config.js`.
Outreach copy lives in `server/outreach-templates.js`. Edit both freely.

### Step 1 · Generate leads

Pick a category, machine, how many leads (5–20) and a radius (10–35 mi), then click
**Generate leads**. The server:

1. Searches Clay's company database for businesses headquartered in the metro
   city list matching the category's industries/keywords/sizes (free).
2. Runs Clay's **Enrich Company** on each candidate (0.5 credit) → street address,
   coordinates, logo, specialties, revenue.
3. Drops anything outside the radius of the machine, scores the rest (distance,
   local-sized, keyword matches, website, revenue) and keeps the best N.
4. Finds owners / partners / managers via a Clay people search (free), ranked by
   the category's title list — up to 2 per business.
5. Looks up the primary contact's **Work Email** (1.1 credits; optional checkbox).
6. Reads the business phone number off their website (homepage → /contact; free).

Typical cost: ~2.5–4 credits per saved lead. The run's progress and credit use
show live in the tab; businesses already saved or ruled out are never paid for
twice. Clay's search filters by city, not radius, so the metro list in the config
should cover every city inside the radius you use.

### Step 1 (free) · Import your own list

Below the Clay controls, **Or import your own list** takes a CSV/TSV file or a
paste from Google Maps / a spreadsheet — any columns, with or without a header row.
Columns are auto-matched (business name, phone, website, address, email, owner,
contact title, LinkedIn, lat/lng, rating, reviews, category, notes, logo URL, Maps
URL) and you can fix the mapping in the preview before clicking **Import**. Rows
become prospects (badged *Imported*) for the category/machine selected above and
flow through exactly the same Step 2: drafts, preview page, AI art, Outreach tab.
Duplicates (same website or name) are skipped; distance is computed when lat/lng
are present; missing phones are read off their websites in the background; the
logo is pulled from the business's site. Every import is kept as a record with the
original file (`DATA_DIR/imports/`) — **View leads** filters the table to that
import, **Open file** shows the raw upload, × removes the record (leads stay).
API: `POST /api/prospecting/imports {categoryId, machineId, rows:[{business,…}], raw, filename}`.

### Outreach tab

**Outreach** is the day-to-day checklist: one row per business with tick-boxes for
**Email · Text · LinkedIn · Call · Follow-up**, the next follow-up date and a status
dropdown. Tick a box to log that touch (sets the follow-up reminder); untick to
undo it (`DELETE /api/prospects/:id/outreach?channel=…`). The ↗ next to Email /
Text / LinkedIn opens your mail app / Messages / their profile with the draft
filled in and ticks the box for you. Any touch after the first counts as a
follow-up. Filters: To contact · Follow-up due · In progress · Replied · Won ·
Everything, plus category, machine and search. **Export CSV** downloads the
current view with all tick counts.

### Step 2 · Generate outreach & send

**Generate outreach** writes, for every new lead: an email, a text, a LinkedIn
connection note + follow-up message, follow-up versions of each, and a public
**mockup page** (`/preview/<token>`) showing their ad composited onto the real
machine photo (banner auto-designed from their name, specialty, phone and logo).
The reference photo is `yucca-installed-web.jpg` (the installed machine at Yucca
Tap Room); only the dark header strip above the product grid is replaced — the
rest of the screen is the real photo. To swap the photo, replace that file and
update `SCREEN_QUAD` / `PHOTO_SIZE` / `CLOSEUP` at the top of `mockup.js`
(corners of the header strip in photo pixels).
Open a lead to review/edit the drafts, download the mockup PNGs, then:

- **Send email** opens your mail app with to/subject/body filled in.
- **Send text** opens Messages with the text filled in (Mac/iPhone).
- **Copy note & open LinkedIn** copies the connection note and opens their profile —
  LinkedIn has no messaging API, so pasting is the one manual step.
- **Log call** records a phone call.

Each of those logs the touch, flips the lead to *Contacted*, and sets a follow-up
date (`followUpDays`, default 2). Due follow-ups appear in **Overview → Needs
attention** and under the *Follow-up due* filter; the drafts switch to their
follow-up versions automatically. **Won → Book campaign** opens the normal campaign
form prefilled. **Find mobile** runs Clay's mobile lookup (~10 credits) on demand.

Nothing is sent automatically: there is no email/SMS provider wired up yet, so
every message goes out from your own accounts. The public preview pages expose
only the business name, tagline, phone and the machine — never contact details.

### AI banner art (Gemini, optional)

Under a lead's mockup, **Banner art → Generate art** asks Google's Gemini image
model ("Nano Banana") to paint a background for that business: the prompt is
auto-filled from the category scene (`categories.<id>.art` in
`server/prospecting-config.js`), the business name and city, plus any free-text
*art direction* you type, and the business's real logo is attached as a colour
reference. The model is told to paint **no text or logos** — the real logo, name,
phone and call-to-action are still drawn pixel-exact on top by `mockup.js`, and
the machine photo composite is unchanged. The pill/tagline accent is taken from
the logo's dominant colour. Each generation is saved as a thumbnail; click one to
use it (everywhere: admin, PNG downloads, the public preview), or **Classic** for
the gradient theme. The × on a thumbnail deletes it (files live in `DATA_DIR/art/`).

Setup: create a free key at <https://aistudio.google.com/apikey> and set
`GEMINI_API_KEY` on Render (the Blueprint prompts for it) or in `.env`. The free
tier has a daily image cap shown in AI Studio; when it's hit the button reports
"free-tier limit reached". `GEMINI_IMAGE_MODEL` overrides the default model
(`gemini-nano-banana-2.1`); if that model isn't available to your key the client
falls back through `gemini-3.1-flash-image` and `gemini-2.5-flash-image`.

To develop without spending credits: `npm run fake-clay` in one terminal (it also
fakes Gemini), then
`CLAY_API_KEY=test-clay-key CLAY_API_BASE=http://127.0.0.1:<port> GEMINI_API_KEY=test-gemini-key GEMINI_API_BASE=http://127.0.0.1:<port>/v1beta npm run dev`.

## Payments & recurring billing (Stripe)

Advertisers pay through a Stripe **Payment Link** that sets up a monthly
subscription. The server creates one link per campaign (single use, never
expires, prefilled with the advertiser's email) and Stripe webhooks keep the
dashboard in sync — no manual "Mark paid" needed. Stripe sends receipts,
monthly invoices, and failed-card emails itself. Zero npm dependencies: the
server calls Stripe's REST API directly.

Payment-link requests explicitly set `managed_payments[enabled]=false` to use
standard Stripe Payments for advertising subscriptions. Managed Payments is a
separate merchant-of-record offering for eligible digital products; Stripe lists
marketing/professional services as unsupported. This override applies to these
links only and does not change the account-wide setting. KWIGZ remains responsible
for applicable taxes and customer obligations; this integration does not configure
tax calculation or collection. Billing and creative-approval details remain in
the editable payment-link email.

### One-time setup

1. **Finish Stripe's account review** (Dashboard banner: "Review in progress").
   Until it's done you can only use *test mode* — which is exactly right for
   your first self-test.
2. **API key** → Stripe Dashboard → Developers → API keys. Copy the **Secret
   key** (`sk_test_…` for now). In Render → your service → Environment, set
   `STRIPE_SECRET_KEY`.
3. **Webhook** → Developers → Webhooks → *Add endpoint*:
   - URL: `https://kwigz.com/api/stripe/webhook` (or your `onrender.com` URL
     until DNS is switched)
   - Events: `checkout.session.completed`, `invoice.paid`,
     `invoice.payment_failed`, `customer.subscription.updated`,
     `customer.subscription.deleted`
   - Copy the **Signing secret** (`whsec_…`) → Render env `STRIPE_WEBHOOK_SECRET`.
4. **Customer emails** → Settings → Business → Customer emails: turn on
   *Successful payments* and *Refunds*. Settings → Billing → Subscriptions and
   emails: turn on *Smart Retries* and the failed-payment / card-expiring emails.
5. **Branding** → Settings → Business → Branding: upload the KWIGZ logo and set
   the brand color so the checkout page looks like you.
6. Redeploy (Render restarts automatically when env vars change). The startup
   log prints `Stripe: test mode` / `live mode`.

### Everyday flow

1. Create the campaign (needs the advertiser's **email**).
2. In *Needs attention* or on the slot card click **Send payment link**. A
   dialog shows the link plus a ready-to-send email — **Open in Mail** opens it
   in your mail app prefilled; edit and send. Links are reused on *Resend*.
3. Advertiser pays on Stripe's hosted page → lands on `payment-complete.html`
   → the webhook flips the campaign to **paid** and attaches the subscription.
   Approve creative, load the banner in VapeTM, **Activate**.
4. Each month Stripe charges the card and the campaign's **end date extends
   30 days** automatically (`invoice.paid`). A declined card marks it
   **past-due** and surfaces a *Payment failed* item while Stripe retries.
5. **Stop billing** on a slot card cancels the subscription at the end of the
   paid period (they keep what they paid for). Setting a campaign to
   *Ended*/*Cancelled* does the same automatically, and deactivates an unused
   payment link so nobody pays for a dead slot.

### Test run, then go live

- Test mode: create a campaign for yourself, send the link, pay with card
  `4242 4242 4242 4242` (any future expiry, any CVC). Watch the dashboard flip
  to paid, then click **Stop billing** to exercise cancellation. In Stripe →
  Developers → Webhooks you can see each delivery and its response.
- Go live once the review completes: switch `STRIPE_SECRET_KEY` to `sk_live_…`,
  create a **second webhook endpoint in live mode** (same URL + events) and
  set its `whsec_…` as `STRIPE_WEBHOOK_SECRET`. Existing test-mode links are
  automatically regenerated as live links the next time you click *Resend*.
- Don't run your self-test in live mode: Stripe keeps its processing fee when
  you refund a real charge.

Campaign records gain `paymentUrl`, `stripeCustomerId`, `stripeSubscriptionId`,
`subscriptionStatus`, `billingEndsAt`, `paidAt`, `lastInvoiceAt`. Only webhooks
and the billing endpoints write these; the admin form can't.

## Advertising config

Machines, categories, budgets and the play formula live in
[`ads-config.js`](./ads-config.js):

- `machines[]` — add a machine with its `adHoursPerDay`. (`takenCategories` is a
  static fallback; live availability now comes from campaigns in `/admin`.)
- `budgets[]` — budget → rotation units at $200/unit (`$200 = 1×`, `$300 = 1.5×`, `$400 = 2×`).
  The second-to-last tier is marked "Most popular" on the site.
- `bannerSeconds` (15), `maxUnits` (10), `campaignDays` (30), `approvalDays` (3), `bannerSize` (1080 × 441).

Estimated scheduled plays shown to advertisers:

```
adHoursPerDay × 3600 / (bannerSeconds × max(maxUnits, units)) × units × campaignDays
```

With 15-second banners, 16 ad hours/day and a fully booked 10-unit rotation,
1 unit ≈ 11,520 plays/month, so the $200 tier ≈ **11,520 plays/month**,
$300 ≈ 17,280, and $400 ≈ 23,040. The quote
assumes a full rotation, so a lighter rotation only ever means more plays than
promised; the dashboard shows both the quoted and the live-rotation figure.

Pricing configuration applies to newly created campaigns. Existing stored
campaign allocations, quoted plays, and Stripe subscriptions are not
automatically migrated; review existing agreements before editing them.
Stripe mode detection supports both standard (`sk_live_…`) and restricted
(`rk_live_…`) live keys. Restricted keys still need permissions for the API
operations used by the integration.

## API

Public: `POST /api/leads` · `GET /api/availability` · `GET /healthz` ·
`POST /api/stripe/webhook` (Stripe-signed)
Admin (`Authorization: Bearer <ADMIN_PASSWORD>`): `GET /api/leads` ·
`PATCH /api/leads/:id` · `GET /api/leads.csv` · `GET|POST /api/campaigns` ·
`PATCH|DELETE /api/campaigns/:id` · `POST /api/campaigns/:id/payment-link` ·
`POST /api/campaigns/:id/stop-billing` (`{"immediately":true}` to cancel now) ·
`GET /api/uploads/<file>`

## Icons

Monochrome SVG icons live in [`icons.svg`](./icons.svg), styled by
[`icons.css`](./icons.css). Use
`<svg class="site-icon" aria-hidden="true" focusable="false"><use href="icons.svg#check"></use></svg>`.
Advertising category `icon` values are symbol ids from that file.
