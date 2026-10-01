# Product photo sourcing — brief for a photo-gathering session

**Audience:** a Claude session (or a person) that has been given access to the **Peak Product Photos** folder, either
through the Google Drive web UI or a Google Drive for desktop folder on this Mac. That folder is the source of truth for
Quartzite's catalog product images.

**Goal:** for as many catalog parts as possible, find the manufacturer's official product photo on the web, download
it, name it so Quartzite can match it, and file it in the folder. Keep a manifest of what was done and what couldn't be
found.

Quartzite syncs the folder on its own (read-only, daily or on **Sync now**) and shrinks every image to web size. This
session never uploads to Quartzite and never touches its database. **Its only output is files in the Drive folder.**

See `docs/guides/google-drive-photos-setup.md` for how the sync works.

---

## 1. Get the list of parts

Ask Jeff for a catalog export, or have him run it: **Quartzite → Import/Export → Catalog → Export CSV**. The useful
columns are:

- SKU
- manufacturer
- manufacturer part number
- manufacturer model number
- description
- category

**Skip:**

- **Labor-category rows.** They never show to customers.
- Custom or one-off parts (no manufacturer part number).
- Rows whose description says discontinued.

### Priority order — work top-down and stop where time runs out

1. **Parts Peak actually quotes.** In Quartzite, **Catalog → Datasheets** lists every quoted part, most-quoted first.
   The **Missing image** filter shows the ones still without a photo. Ask Jeff for a screenshot or list if you can't
   open the app.
2. **ETC parts that only have a datasheet thumbnail.** About 178 ETC parts got an auto-made "page 1 of the datasheet"
   image on 2026-09-30. A real product photo replaces it automatically.
3. **The portal's main departments:** Rigging, Lighting, Cable & Connectors, Atmospherics, Hardware, Drapery. Within
   each, the manufacturers Peak sells most, e.g. ETC, Chauvet Pro, EAW, Allen & Heath, Shure, Crestron, TCP.
4. Everything else, manufacturer by manufacturer.

---

## 2. What image to get

**The primary photo**, one per part:

- The manufacturer's own product shot, on a **white or transparent background**, showing the whole product.
- At least **1000 px** on the long side. Bigger is fine, since Quartzite shrinks it.
- **The exact variant.** A black model gets the black photo, and a 19° lens gets the 19° photo. If the manufacturer
  only shows one photo for a family, use it for each variant (see naming), but note it in the manifest.
- **No watermarks**, retailer logos, price stickers or "sale" badges.
- **No** lifestyle or installation photos, drawings, line art or dimension diagrams as the primary.

**Extra angles** (optional, at most 2–3 per part): rear panel, connectors, the product in use. Name them so they sort
after the primary (see naming).

**Formats:** **JPEG or PNG** (WebP is OK).

- Convert **AVIF, HEIC, GIF and SVG** before saving: `sips -s format jpeg in.avif --out out.jpg` on macOS.
- Maximum **25 MB** per file.

---

## 3. Where to look (in this order)

1. **The manufacturer's product page**, usually the main gallery image. Many manufacturers also have a **media
   library**, **press kit** or **dealer portal** with high-resolution images. ETC, Chauvet, Shure and Allen & Heath all
   have one. Prefer these.
2. **The manufacturer's spec sheet or datasheet PDF**, if the website photo is tiny. Only use it if the PDF has a clean
   product image you can extract, and note it as the source.
3. **A major authorized dealer**, e.g. Full Compass, B&H, Sweetwater or Production Resource Group, and **only** if the
   image is clearly the manufacturer's stock shot with no watermark. Record the URL. Flag it in the manifest
   (`source_type = dealer`) so Jeff can review it.
4. **Never** use: Google Images thumbnails, stock-photo sites, eBay or Amazon seller photos, forum posts, or
   AI-generated images.

**Rights:** Peak is a dealer, and manufacturer product images are generally provided for dealers to sell the product.
That's the basis for using them. Keep every source URL in the manifest so any image can be traced or removed.

---

## 4. Naming — this is what makes the match work

Quartzite matches a file to a part by finding the part's **SKU, manufacturer part number or manufacturer model
number inside the file name**. How it compares:

- It ignores case, spaces, dashes and punctuation, comparing only A–Z and 0–9.
- The longest match wins.
- Keys shorter than 4 characters are ignored.

**The rules:**

- **Start the name with the manufacturer part number, exactly as it appears in the export.**
  - The primary is `S4LED-S3.jpg`.
  - Extras are `S4LED-S3 - 2 rear.jpg`, `S4LED-S3 - 3 connectors.jpg`.
- **One part number per file name.** Never `S4LED-S3 and S4LED-S3-Lustr.jpg`. A name that matches two parts goes to
  the **Couldn't match** list and isn't attached.
- **Watch for part numbers that contain each other**, e.g. `S4LED-S3` and `S4LED-S3-LUSTR`.
  - `S4LED-S3-LUSTR.jpg` is safe: the longest match wins.
  - But a name made from a short family code can match many parts and be rejected.
  - Always use the **full** part number of the specific SKU.
- **The same photo for several variants:** save **one copy per part number**: `CS-PAR-W.jpg`, `CS-PAR-B.jpg`. Do not
  use one file named after the family.
- **Part numbers under 4 characters** (e.g. ETC `450`): put the manufacturer in front, `ETC 450.jpg`. Check that the
  combined name doesn't accidentally contain another part's number.

**Check before saving:** strip the file name down to uppercase A–Z and 0–9. Confirm it contains the target part's
key. Confirm it does **not** contain the key of any other part in the export of 4 or more characters, unless that part
number is a shorter piece of the target's own. Do this as a quick script over the export CSV.

---

## 5. Folder layout

```
Peak Product Photos/
  _manifest.csv            ← required (see §6)
  _not-found.csv           ← parts searched but nothing usable found
  ETC/
    S4LED-S3.jpg
    S4LED-S3 - 2 rear.jpg
  Chauvet Pro/
    ...
  EAW/
    ...
```

- **One subfolder per manufacturer.** Folder names don't affect matching.
- Quartzite ignores non-image files, so the CSVs can live in the folder.
- **Never delete or rename files someone else put there.** If something looks wrong, list it in `_manifest.csv` under
  `notes` for Jeff.

---

## 6. The manifest (`_manifest.csv`)

Append one row per file saved:

| column | example |
|---|---|
| `file` | `ETC/S4LED-S3.jpg` |
| `sku` | `ETC:S4LED-S3` (as in the export) |
| `mfr_part_number` | `S4LED-S3` |
| `role` | `primary` or `extra` |
| `source_url` | the page or image URL it came from |
| `source_type` | `manufacturer`, `manufacturer-pdf` or `dealer` |
| `variant_note` | e.g. "family photo — shows black version" (blank if exact) |
| `width_px` / `height_px` | e.g. 2400 / 2400 |
| `datasheet_url` | the manufacturer's datasheet PDF link, if you saw one |
| `manual_url` | the manual or user-guide PDF link, if you saw one |
| `date` | 2026-10-02 |

`datasheet_url` and `manual_url` cost nothing to collect while you're on the product page. They'll let Quartzite
fetch datasheets and manuals in bulk later.

**`_not-found.csv`** columns: `sku, mfr_part_number, searched, reason`. Reasons are things like "discontinued, no
image online", "only watermarked dealer images" or "manufacturer site requires dealer login".

---

## 7. Done checklist

- Every file is JPEG, PNG or WebP, at most 25 MB and at least 1000 px on the long side. No HEIC, AVIF or SVG.
- Every file name passes the naming check in §4.
- One primary per part. Extras are numbered after it.
- `_manifest.csv` has a row for every file. `_not-found.csv` lists every skipped part.
- Nothing outside **Peak Product Photos** was changed.
- Tell Jeff it's ready. He runs **Catalog → Datasheets → Sync now** in Quartzite and reviews the **Couldn't match**
  list. Rename anything listed there in Drive, then sync again.
