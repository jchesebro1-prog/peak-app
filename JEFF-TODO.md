# Jeff's Action Items — Living Document

Things only Jeff can do. Updated as items are answered or added. Reviewed each session.

---

## BLOCKING CODE WORK

### #52 — ETC Fixture SKU List
Fixture builder rebuild is approved but blocked on your ETC light-engine and lens SKU list.
- **What's needed:** The specific ETC part numbers for: light engines (e.g. CSSPOTVMVS), lenses (e.g. 426LT), clamps, power/data accessories, and lamps you actually sell
- **Where it goes:** Claude imports them to the catalog, then builds the picker UI
- **Status:** Waiting on your list

### #59 — Production DATABASE_URL
The demo-data cleanup script is built and tested. Needs the production database credential to run.
- **What's needed:** Add `DATABASE_URL=<neon-connection-string>` to `.env.local` locally
- **Then:** Run `npm run db:inventory` to confirm, then the precise seed-clear script
- **Status:** Waiting on credential (Jeff traveling)

---

## CONTENT / DATA TO UPLOAD

### #82 — People Import
People data (contacts) needs to be imported.
- **Action:** Upload your Daylite people export via **Import tab** (`/import`) → People
- **Format:** CSV matching the fields shown in the Import tab

### #83 — Venues Import
Venue data needs to be imported.
- **Action:** Upload your Daylite venue/location export via **Import tab** (`/import`) → Venues
- **Format:** CSV matching the fields shown in the Import tab

---

## INFRASTRUCTURE / ACCOUNTS

### #69 — Gmail (DONE — confirmed working)
Jeff confirmed he can see emails. ✓

### Deploy Accounts
Google Cloud console setup for production deployment.
- OAuth client ID + secret (for Gmail + Calendar OAuth on real users)
- Enable Gmail API + Calendar API in the console
- See DEPLOY.md for full checklist

---

## DECISIONS STILL NEEDED

### #33 — Mobile Readability
You said you'd add specific screens that feel worst on iPhone.
- **Action:** Open the app on your phone and note which 5-10 screens are hardest to use. Add them here or to PUNCHLIST.md #33.

### #52 — Fixture Builder (see above)
ETC SKU list needed before any code can be written.

### #29 — Fabric Data
Once catalog is populated with real fabric parts (oz + basis + width per part), the auto-fill in the Lineset Builder will resolve fabric names to real weights. Confirm Charisma Velour is in your catalog import.

---

## STRATEGIC DECISIONS (no rush)

### #57 — Multi-tenant (TABLED)
You tabled this. Revisit only if expanding Quartzite to other organizations.

### #31 — Native App
Recommendation: go Capacitor when Bluetooth laser or camera justifies it. No decision needed now.

### #51 — Design tab publish workflow
One-button publish with selectors: approved. DWG export: approved. Budget vs. Estimate label: approved (consulting side = "Budget"). No action needed — Claude is building this.

---

*Last updated: 2026-08-14 | Add items anytime by editing this file or telling Claude*
