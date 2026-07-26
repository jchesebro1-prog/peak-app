# Connection-Metadata Worksheet (2026-07)

Companion to `STARTER-SET-2026-07-DRAFT.md` (punch #39, catalog beta build-out, Task 7). Two parts: (1) the `CONNECTION_TYPES` taxonomy for Jeff to prune, (2) draft ports for every starter-set item, by domain default (a console = DMX512 out + sACN/Art-Net io; a passive speaker = speakON in; an amp = XLR in + speakON out; a DSP = Dante io + XLR io; a video switcher = HDMI in×N/out; a hoist motor = motor power in + pendant control in). Anything uncertain is marked **(verify)**.

## 1. Connection types (`src/lib/catalog-connect.ts`, `CONNECTION_TYPES`) — prune candidates

Jeff: strike anything Peak will never wire, or note additions needed (see the gaps flagged below).

**power**
- [ ] powerCON/True1
- [ ] Edison
- [ ] stage pin
- [ ] Socapex
- [ ] bare-end

**lighting data**
- [ ] DMX512 (5-pin XLR)
- [ ] sACN/Art-Net (etherCON/Cat6)
- [ ] RDM
- [ ] contact closure

**audio**
- [ ] XLR line/mic
- [ ] speakON NL2
- [ ] speakON NL4
- [ ] speakON NL8
- [ ] Dante/AES67 (Cat6)
- [ ] AES/EBU
- [ ] 70V pair

**video**
- [ ] HDMI
- [ ] SDI/BNC
- [ ] HDBaseT (Cat6a)
- [ ] fiber

**rigging**
- [ ] motor power
- [ ] low-voltage pendant control

**Gaps found while drafting ports below** — not in the list above; Jeff's call whether to add them:
- Generic network/NDI (no physical connector, e.g. BirdDog/Matrox streaming/control) — closest existing entry is `HDBaseT (Cat6a)`, which is a physical-cable standard, not a fit.
- RF/antenna (wireless mic combiners and transmitters, e.g. Shure Axient PSM) — nothing in the list models RF.

## 2. Draft ports by starter-set item

### Lighting Controls

| SKU | Ports (name — direction — connectionType — count) |
|---|---|
| `ETC:ION XE 2K-US` | DMX Out — out — DMX512 (5-pin XLR) — ×2<br>Network (sACN/Art-Net) — io — sACN/Art-Net (etherCON/Cat6) |
| `ETC:ELEMENT 2 1K` | DMX Out — out — DMX512 (5-pin XLR) — ×2<br>Network (sACN/Art-Net) — io — sACN/Art-Net (etherCON/Cat6) |
| `ETC:CS40` | DMX Out — out — DMX512 (5-pin XLR) — ×2<br>Network (sACN/Art-Net) — io — sACN/Art-Net (etherCON/Cat6) |
| `ETC:SP3-1220B` | DMX In — in — DMX512 (5-pin XLR)<br>RDM — io — RDM<br>Dimmed Power Out — out — stage pin — ×12 |
| `ETC:D20AF` | DMX In — in — DMX512 (5-pin XLR)<br>RDM — io — RDM<br>Dimmed Power Out — out — stage pin — ×2<br>(verify — dimmed-output connector depends on host rack) |
| `ChamSys:CHAMMQ50` | DMX Out — out — DMX512 (5-pin XLR) — ×2<br>Network (sACN/Art-Net) — io — sACN/Art-Net (etherCON/Cat6) |
| `ChamSys:CHAMMQ70` | DMX Out — out — DMX512 (5-pin XLR) — ×2<br>Network (sACN/Art-Net) — io — sACN/Art-Net (etherCON/Cat6) |
| `ChamSys:CHAMQUICKQ10` | DMX Out — out — DMX512 (5-pin XLR) — ×2<br>Network (sACN/Art-Net) — io — sACN/Art-Net (etherCON/Cat6) |
| `ChamSys:CHAMQUICKQ20` | DMX Out — out — DMX512 (5-pin XLR) — ×2<br>Network (sACN/Art-Net) — io — sACN/Art-Net (etherCON/Cat6) |
| `ChamSys:CHAMMQCOMPWING` | Console Link (sACN/Art-Net) — io — sACN/Art-Net (etherCON/Cat6) |
| `ChamSys:CHAMMQ500MPLUSWITHCASE` | DMX Out — out — DMX512 (5-pin XLR) — ×2<br>Network (sACN/Art-Net) — io — sACN/Art-Net (etherCON/Cat6) |

### Fixtures

| SKU | Ports (name — direction — connectionType — count) |
|---|---|
| `ETC:405` | Power In — in — Edison<br>(verify — dimmed via external rack; connector per whip/bare-end order) |
| `ETC:FRES7` | Power In — in — Edison<br>(verify — dimmed via external rack; connector per whip/bare-end order) |
| `ETC:4ML-27/90-FD-P` | DMX In — in — DMX512 (5-pin XLR)<br>DMX Thru — out — DMX512 (5-pin XLR)<br>Power In — in — powerCON/True1 |
| `ETC:CSPAR` | DMX In — in — DMX512 (5-pin XLR)<br>DMX Thru — out — DMX512 (5-pin XLR)<br>Power In — in — powerCON/True1 |
| `ETC:SELD22H-I` | DMX In — in — DMX512 (5-pin XLR)<br>DMX Thru — out — DMX512 (5-pin XLR)<br>Power In — in — powerCON/True1 |
| `Chauvet Professional:COLORADO1SOLO` | DMX In — in — DMX512 (5-pin XLR)<br>DMX Thru — out — DMX512 (5-pin XLR)<br>Power In — in — powerCON/True1 |
| `Chauvet Professional:COLORADOPANELQ40` | DMX In — in — DMX512 (5-pin XLR)<br>DMX Thru — out — DMX512 (5-pin XLR)<br>Power In — in — powerCON/True1 |
| `Chauvet Professional:MAVERICKFORCEXSPOT` | DMX In — in — DMX512 (5-pin XLR)<br>DMX Thru — out — DMX512 (5-pin XLR)<br>Power In — in — powerCON/True1 |
| `Chauvet Professional:MAVERICKFORCE2BEAMWASH` | DMX In — in — DMX512 (5-pin XLR)<br>DMX Thru — out — DMX512 (5-pin XLR)<br>Power In — in — powerCON/True1 |
| `Chauvet Professional:COLORSTRIKEMV2` | DMX In — in — DMX512 (5-pin XLR)<br>DMX Thru — out — DMX512 (5-pin XLR)<br>Power In — in — powerCON/True1 |

### Video Controls

| SKU | Ports (name — direction — connectionType — count) |
|---|---|
| `BirdDog:BDA200` | Video Out — out — SDI/BNC |
| `BirdDog:BDP100B` | Video Out — out — SDI/BNC |
| `BirdDog:BD4KHDMI` | HDMI — io — HDMI |
| `BirdDog:BDOG4` | SDI In — in — SDI/BNC — ×4 |
| `Matrox:MHD/I` | HDMI In — in — HDMI<br>(verify — network/streaming output not modeled; capture input only) |
| `Matrox:MHDX/I` | HDMI In — in — HDMI<br>(verify — network/streaming output not modeled; capture input only) |
| `Matrox:MHLCS/I` | HDMI In — in — HDMI<br>(verify — network/streaming output not modeled; capture input only) |
| `AVPro Edge:AC-AXION-8` | HDMI In — in — HDMI — ×8<br>HDBaseT Out — out — HDBaseT (Cat6a) — ×8 |
| `AVPro Edge:AC-CX-84` | HDBaseT In — in — HDBaseT (Cat6a) — ×8<br>HDBaseT Out — out — HDBaseT (Cat6a) — ×4 |
| `AVPro Edge:AC-EX70-UHD-KIT` | HDMI In (TX) — in — HDMI<br>HDBaseT Out (RX) — out — HDBaseT (Cat6a)<br>(kit = TX+RX pair, one line item) |
| `AVPro Edge:AC-DA14-AUHD-GEN2` | HDMI In — in — HDMI<br>HDMI Out — out — HDMI — ×4 |

### Speakers

| SKU | Ports (name — direction — connectionType — count) |
|---|---|
| `Meyer Sound:LEOPARD` | Audio In — in — XLR line/mic<br>Power In — in — powerCON/True1 |
| `Meyer Sound:900-LFC` | Audio In — in — XLR line/mic<br>Power In — in — powerCON/True1 |
| `Meyer Sound:UPQ-D1` | Audio In — in — XLR line/mic<br>Power In — in — powerCON/True1 |
| `Meyer Sound:USW-112XP` | Audio In — in — XLR line/mic<br>Power In — in — powerCON/True1 |
| `Meyer Sound:MM-4XP` | Audio In — in — XLR line/mic<br>Power In — in — powerCON/True1 |
| `Danley:TH121-T` | Audio In — in — speakON NL2<br>(verify — passive vs. powered not specified in the sheet) |
| `Danley:TH121-I-B` | Audio In — in — speakON NL2<br>(verify — passive vs. powered not specified in the sheet) |
| `Danley:STUDIO SERIES` | Audio In — in — speakON NL2<br>(verify — passive vs. powered not specified in the sheet) |
| `Danley:SIGNATURE` | Audio In — in — speakON NL2<br>(verify — passive vs. powered not specified in the sheet) |
| `Tannoy:TA-CVS8` | Audio In — in — speakON NL2<br>(verify — many install ceiling speakers are 70V-tapped; confirm before wiring) |
| `Tannoy:TA-CMS803DC-PI` | Audio In — in — speakON NL2 |
| `Tannoy:TA-AMS8DC-BK` | Audio In — in — speakON NL2 |
| `Tannoy:TA-DVS8-BK` | Audio In — in — speakON NL2 |
| `Tannoy:TA-OCV6-BK` | Audio In — in — speakON NL2 |

### Audio Controls

| SKU | Ports (name — direction — connectionType — count) |
|---|---|
| `Biamp:930-10008-00019` | (verify — product unidentified, no product type to draft ports from) |
| `Biamp:930-00005-00036` | (verify — product unidentified, no product type to draft ports from) |
| `Biamp:930-00005-00030` | (verify — product unidentified, no product type to draft ports from) |
| `Shure:AD8CUS` | (verify — RF combiner; no antenna/RF connectionType in current taxonomy) |
| `Shure:ADTQUS=-G57` | (verify — RF transmitter; no antenna/RF connectionType in current taxonomy) |
| `Shure:MXA901W-R-PM-3/8-V` | Audio Out — out — Dante/AES67 (Cat6)<br>(verify — confirm Dante vs. analog output for this bundle) |
| `Shure:IMXF5` | Audio (Dante/AES67) — io — Dante/AES67 (Cat6) |
| `Allen & Heath:AH-AVANTIS-ULTRA` | XLR In — in — XLR line/mic<br>XLR Out — out — XLR line/mic<br>Network (Dante/AES67) — io — Dante/AES67 (Cat6) |
| `Allen & Heath:AH-DLIVE-S5` | Network to MixRack (Dante/AES67) — io — Dante/AES67 (Cat6)<br>(S-Class surface has no analog I/O of its own — I/O lives on its MixRack) |
| `Allen & Heath:AH-DLIVE-DM64-RUFX` | XLR In — in — XLR line/mic — ×64<br>XLR Out — out — XLR line/mic — ×32<br>Network (Dante/AES67) — io — Dante/AES67 (Cat6) |
| `Allen & Heath:AH-DLIVE-CDM32-RUFX` | XLR In — in — XLR line/mic — ×32<br>XLR Out — out — XLR line/mic — ×16<br>Network (Dante/AES67) — io — Dante/AES67 (Cat6) |

### Curtains

| SKU | Ports (name — direction — connectionType — count) |
|---|---|
| `Texas Scenic:101A` | (no ports — mechanical/pure hardware) |
| `Texas Scenic:110S-20B` | (no ports — mechanical/pure hardware) |
| `Texas Scenic:101B` | (no ports — mechanical/pure hardware) |
| `Texas Scenic:102B` | (no ports — mechanical/pure hardware) |
| `Texas Scenic:137` | (no ports — mechanical/pure hardware) |
| `Texas Scenic:10` | (no ports — mechanical/pure hardware) |
| `Thern:CW11-1M` | (no ports — mechanical/pure hardware) |
| `Thern:CW25-1M` | (no ports — mechanical/pure hardware) |
| `Thern:CWA2-PC` | Motor Power In — in — motor power<br>Pendant Control In — in — low-voltage pendant control |
| `Thern:CT40-xx` | Motor Power In — in — motor power<br>Pendant Control In — in — low-voltage pendant control |
| `Thern:RD5-xx` | Motor Power In — in — motor power<br>Pendant Control In — in — low-voltage pendant control |
