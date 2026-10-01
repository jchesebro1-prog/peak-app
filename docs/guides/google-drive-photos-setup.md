# Google Drive product photos — setup and use

How the **Peak Product Photos** folder feeds product images into Quartzite. Shipped 2026-10-01: punch #283,
decisions D507–D510.

---

## What it does

- You keep product photos in a Google Drive folder named exactly **Peak Product Photos**. It can live in My Drive or a
  Shared Drive, and subfolders are fine.
- Quartzite reads that folder (read-only — it never changes, moves or deletes anything in Drive). It matches each
  photo to a catalog part by the **part number in the file name**. Each matched photo is shrunk to a web-size image of
  about 100–300 KB and attached to that part.
- Those images show in the customer portal catalog and in the part editor. Real photos always show ahead of the
  datasheet thumbnails created on Sep 30.
- The full-size originals stay in Drive, on storage the company already pays for. The app keeps only the small copies.

---

## One-time setup (about 5 minutes)

### 1. Allow read-only Drive access in Google Cloud

1. Go to <https://console.cloud.google.com/> and open the **Peak Backend** project (use the project picker at the top).
2. Go to **APIs & Services → OAuth consent screen**. On newer consoles this is under **Google Auth Platform → Data Access**.
3. **Add or remove scopes** → add `https://www.googleapis.com/auth/drive.readonly` → **Update** → **Save**.
4. **Recommended:** under **Audience** (or **User type**), switch from **Testing** to **Internal**.
   - **Internal** means only peaksystemsgroup.com accounts can sign in, which is what you want.
   - It also stops Google from expiring the app's access every 7 days. Under Testing that expiry would quietly
     stop the photo sync, Gmail sync and calendar.
5. Make sure the **Google Drive API** is enabled: **APIs & Services → Library → "Google Drive API" → Enable**. It already
   is for the Recordings archive, so this is just a check.

### 2. Create the folder

- Create a folder named exactly **Peak Product Photos**: capital P's, with spaces.
- **Best: in a Shared Drive**, so it belongs to the company rather than one person.
- The Google account you connect in step 3 needs at least **Viewer** access to it.
- Only one folder in that account may have this name. If there are two, the app stops and asks you to rename the
  extras.

### 3. Connect it in Quartzite

1. **Settings** → scroll to the **Mailboxes** card. The link doesn't jump there on its own.
2. Under **Catalog photos account (Google Drive)**, click **Enable Drive photos** next to the account that can see the
   folder (jeffc@ or jenat@).
3. Google asks you to approve "See and download all your Google Drive files". This is read-only. Approve it.
4. Back in Settings, pick that account in the **Catalog photos account** dropdown → **Save**.
   - If the photos account is someone else's personal mailbox, that person has to do step 2 themselves. They'll see
     an **Enable Drive photos** button on their own **Account** page.

### 4. First sync

- **Catalog → Datasheets** → the **Drive photos** panel at the top → **Sync now**.
- It runs in rounds of about 45 seconds and keeps going until done. Leave the tab open.
- Do the first sync on the **live site** (quartzite-six.vercel.app), not a preview link. Preview links write to the
  same database.

---

## Naming photos

The file name is the only thing the app uses to find the part.

| Do | Don't |
|---|---|
| Put the **manufacturer part number** in the name: `S4LED-S3.jpg` | Use names with no part number: `IMG_2041.jpg`, `front.jpg` |
| Add words after it for extra angles: `S4LED-S3 front.jpg`, `S4LED-S3 - 2.jpg` | Put two different part numbers in one name |
| Use the part number exactly as it appears in the catalog. Dashes, spaces and case don't matter. | Use part numbers shorter than 4 characters on their own. They're too short to match safely, so add the manufacturer, e.g. `ETC 450.jpg`. |
| JPEG, PNG or WebP, up to 25 MB | HEIC (iPhone default), SVG, PDF |

- **iPhone:** Settings → Camera → Formats → **Most Compatible**. Photos then save as JPEG.
- **Subfolders** (e.g. `ETC/`, `Chauvet/`) are fine and help keep things tidy. The folder name isn't used for matching.
- **Several photos per part** is fine. They all attach to the part. The order can be changed in the part editor's
  Images gallery (↑/↓).

---

## Day to day

- **Add a photo:** drop it in the folder, then **Sync now**. Or wait for the automatic daily sync around 7 am Central.
- **Replace a photo:** replace the file in Drive. Keep the same file, or upload a new version via Drive's **Manage
  versions**. The next sync updates the catalog copy.
- **Wrong part?** Rename the file in Drive. The next sync moves it to the newly matched part.
- **Remove a photo from customers:** in Quartzite, open the part → Images → **Hide from customers**. Deleting a file
  from Drive does **not** remove it from the catalog. This is on purpose, so a Drive clean-up can't blank the store.
- **"Couldn't match" list** (on the Drive photos panel): files whose names matched no part, or several parts. The panel
  also lists HEIC files and files over 25 MB. Rename or convert them, then Sync now.
- **A file shows as failed:** it's skipped until the file changes in Drive. Re-save it as JPEG or re-export a smaller
  copy and it will retry.

---

## Troubleshooting

| Panel says | Fix |
|---|---|
| "not set up" | Steps 3.1–3.4 above. |
| "needs read-only Drive access" | Click **Enable Drive photos** on that account in Settings → Mailboxes. Or the account owner does it on their Account page. |
| "No folder named Peak Product Photos was found" | Check the exact name, and that the connected account can see the folder (share it, or add the account to the Shared Drive). |
| "Found N folders named Peak Product Photos" | Rename the extra folders. |
| "A photo sync is already running" | Wait a minute. The daily sync or another tab is running. |
| "Google rejected the photos account's token" / "can't read Drive" | Reconnect via **Enable Drive photos**. If it keeps happening every week, the consent screen is still in **Testing** (step 1.4). |
| "Drive is rate-limiting" / stopped partway | Press **Sync now** again. It picks up where it stopped. |

---

## For developers

- Code:
  - `src/lib/part-docs/shrink.ts`: sharp, ≤1600 px WebP q80.
  - `src/lib/google/drive-photos.ts`: Drive v3, read-only.
  - `src/lib/part-docs/drive-photo-plan.ts`: the pure planner.
  - `src/lib/part-docs/drive-photo-sync.ts`: the executor.
  - `src/lib/part-docs/drive-photo-view.ts`: the panel view model.
  - The panel `src/app/(app)/catalog/documents/drive-photos-panel.tsx`.
  - The cron rider in `src/app/api/gmail/sync/route.ts`.
- **State:** settings blob `drive_photo_sync` (folder, per-file md5/document/parts, last run, run lease).
- **Setting:** `catalogPhotosMailbox`.
- **Scope:** `drive.readonly` via `/api/gmail/connect?mailbox=…&drivephotos=1`.
- Spec and plan:
  - `docs/superpowers/specs/2026-10-01-catalog-photos-shrink-and-drive-sync-design.md`
  - `docs/superpowers/plans/2026-10-01-catalog-photos-shrink-and-drive-sync.md`
