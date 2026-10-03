# KWIGZ Website

Static marketing site for KWIGZ nicotine vending partnerships, plus a tiny
zero-dependency Node server that captures leads and powers the admin dashboard.

## Run locally

```bash
ADMIN_PASSWORD=yourpassword node server/leads-server.js
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

### Campaign workflow

1. Advertiser applies on the site → shows up as a lead and in *Needs attention*.
2. **Create campaign** (prefilled from the application). Status `pending`
   immediately **reserves the category** on that machine — the public site
   pulls `/api/availability` and shows it as taken.
3. Collect payment → **Send payment link** (Stripe, see below) or **Mark paid**
   for cash/check. Check the banner → **Approve creative**.
4. Assign the banner in VapeTM, then **Activate**. The dashboard tracks dates;
   campaigns auto-flip to `ended` the day after their end date, which frees
   the slot again.
5. Two campaigns can't hold the same category on the same machine for
   overlapping dates — the server rejects the conflicting booking. End or cancel
   the old campaign or choose non-overlapping dates.

## Payments & recurring billing (Stripe)

Advertisers pay through a Stripe **Payment Link** that sets up a monthly
subscription. The server creates one link per campaign (single use, never
expires, prefilled with the advertiser's email) and Stripe webhooks keep the
dashboard in sync — no manual "Mark paid" needed. Stripe sends receipts,
monthly invoices, and failed-card emails itself. Zero npm dependencies: the
server calls Stripe's REST API directly.

Payment-link requests omit optional checkout `custom_text`, which Stripe rejects
when Managed Payments is enabled. Billing and creative-approval details remain
in the editable payment-link email; the integration does not change your
account's Managed Payments setting.

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
- `budgets[]` — budget → rotation units (`$100 = 1×`, `$150 = 1.5×`, `$200 = 2×`, `$300 = 3×`).
- `bannerSeconds` (15), `maxUnits` (10), `campaignDays` (30), `approvalDays` (3), `bannerSize` (1080 × 441).

Estimated scheduled plays shown to advertisers:

```
adHoursPerDay × 3600 / (bannerSeconds × max(maxUnits, units)) × units × campaignDays
```

With 15-second banners, 16 ad hours/day and a fully booked 10-unit rotation,
1 unit ≈ **11,520 plays/month** ($100) and 3 units ≈ 34,560 ($300). The quote
assumes a full rotation, so a lighter rotation only ever means more plays than
promised; the dashboard shows both the quoted and the live-rotation figure.

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
