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
  *Mark paid → Approve creative → Activate → End*. *+ Book* on any open slot.
- **Calendar** — month timeline of all campaigns (click a bar to edit), plus key
  dates: starts, renewals, expirations. *Renew +30d* clones a campaign.

### Campaign workflow

1. Advertiser applies on the site → shows up as a lead and in *Needs attention*.
2. **Create campaign** (prefilled from the application). Status `pending`
   immediately **reserves the category** on that machine — the public site
   pulls `/api/availability` and shows it as taken.
3. Collect payment → **Mark paid**. Check the banner → **Approve creative**.
4. Assign the banner in VapeTM, then **Activate**. The dashboard tracks dates;
   campaigns auto-flip to `ended` the day after their end date, which frees
   the slot again.
5. Two campaigns can't hold the same category on the same machine for
   overlapping dates — the server rejects the conflicting booking. End or cancel
   the old campaign or choose non-overlapping dates.

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

Public: `POST /api/leads` · `GET /api/availability` · `GET /healthz`
Admin (`Authorization: Bearer <ADMIN_PASSWORD>`): `GET /api/leads` ·
`PATCH /api/leads/:id` · `GET /api/leads.csv` · `GET|POST /api/campaigns` ·
`PATCH|DELETE /api/campaigns/:id` · `GET /api/uploads/<file>`

## Icons

Monochrome SVG icons live in [`icons.svg`](./icons.svg), styled by
[`icons.css`](./icons.css). Use
`<svg class="site-icon" aria-hidden="true" focusable="false"><use href="icons.svg#check"></use></svg>`.
Advertising category `icon` values are symbol ids from that file.
