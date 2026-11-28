# Weather R0 spikes S-1 to S-4 (SA-2026-009)

Run 2026-11-28 from a cloud session (network: the Supra environment with the weather hosts allowed). Point: Milford, MA (42.14, −71.52), the PRD §3.3 fallback. Scripts in [`spikes/weather-r0/`](../../../spikes/weather-r0/); no data committed. Terms come from the providers' pages as found by web search (the pages themselves could not be fetched from this session), so each "Terms" cell names its source and anything marked *verify* is not confirmed yet.

## Summary and decisions proposed

| Spike | Result | Proposed decision |
| :-- | :-- | :-- |
| S-1 Sources | NWS, IEM radar, SWPC, EPA UV, Nominatim, Census, OpenFreeMap reachable and fit for personal self-hosted use. **RainViewer dropped nowcast on 2026-01-01** (free tier: past 2 h only, zoom ≤ 7). Open-Meteo free tier is < 10,000 calls/day per IP (hit from the shared cloud IP; fine from the mini PC). **CelesTrak unreachable from the cloud egress** (connection hangs). MADIS/CWOP redistribution is per provider and Synoptic's open tier is unclear, so citizen stations are not assured. | Keep the PRD's NOAA-first list. Drop RainViewer. Treat public citizen stations as optional (R1 uses NWS ASOS observations only) until MADIS/Synoptic terms are confirmed. Verify CelesTrak from the mini PC. |
| S-2 Radar delivery | One bridge call per tile cannot work: a 24-frame loop is ~576 tiles and the bridge allows **50 calls/s per app** (≥ 11.5 s). Decoding is not the problem: the whole loop decodes in 0.44 s (CPU ×1) to 2.4 s (CPU ×6) in a sandboxed iframe; one composited image per frame takes 0.36–0.78 s. | **`weather.radarFrame` returns one server-composited image per frame** for the current viewport (24 calls per loop), cached on the mini PC. Base map: state/county outlines + roads drawn by the subapp (public-domain Census boundaries) rather than 2–2.6 MB of vector tiles per viewport plus MapLibre. On-phone timing (WX-10) still manual. |
| S-3 Nowcast | Simple radar extrapolation caught only **20–42 %** of rain onsets at Milford (Sep–Nov 2026, 20–27 events). When it did fire, timing was good (most within ±10 min), with **4–12 % false alarms** on dry checks. Most misses were light rain that formed in place rather than moving in. | **No-go for pushing "rain in N min" from extrapolation alone.** R2 shows it in the app only, as "possible". Pushes for rain starting use NWS hourly PoP plus HRRR 15-min. Follow-up S-3b: optical flow (pysteps) blended with HRRR 15-min, re-scored, with a push target of ≥ 70 % detected and ≤ 10 % false alarms. |
| S-4 Google Calendar | Calendar API: an OAuth app left in *Testing* loses its refresh token after **7 days**; *In production* without verification is allowed for the owner alone (unverified-app warning, 100-user lifetime cap). Secret iCal address: no OAuth, has location and recurrence, but is a bearer secret per calendar and gives no incremental sync. | **Calendar API, app set to In production (unverified, owner only), `calendar.readonly`, `syncToken` polling every 10 min from the mini PC** (push needs a public HTTPS endpoint, which Supra does not have). Secret iCal address as the fallback if Google sign-in becomes a burden. |

## S-1 Data sources

### Live probes (2026-11-28 ~14:00Z, from the cloud session)

| Source | Endpoint probed | Result | Caching seen |
| :-- | :-- | :-- | :-- |
| NWS point → grid | `/points/42.14,-71.52` | 200, 3.9 KB. Grid **BOX 58,88**, timezone `America/New_York`, nearest stations KSFZ, KOWD, KORH, KBED, KPVD, KBOS | — |
| NWS raw grid | `/gridpoints/BOX/58,88` | 200, 314 KB, 0.4 s. All PRD fields present: temperature, dew point, apparent temp, wind chill, heat index, sky cover, gusts, PoP, QPF, **snowfallAmount, iceAccumulation**, thunder probability, visibility, weather. Values are ISO-8601 intervals (`…/PT7H`) that must be expanded to hours. | `max-age=3600`, `Last-Modified` (forecast updated 13:16Z) |
| NWS hourly / 7-day | `/forecast/hourly`, `/forecast` | 200, 162 KB / 13 KB | `max-age=3600` |
| NWS alerts | `/alerts/active?point=…` | 200, ETag | `max-age=5` (poll every 5 min is fine) |
| NWS observation | `/stations/KSFZ/observations/latest` | 200, QC flag `V`, pressure present | — |
| NWS forecast discussion | `/products/types/AFD/locations/BOX` | 200 | — |
| IEM radar tiles | `nexrad-n0q-900913`, `ridge::USCOMP-N0Q-<time>`, `hrrr::REFD-F0060-0` | 200 for all; median 175–200 ms per tile | `/cache/` 5 min; `/c/` 14 days for timestamped layers (IEM docs) |
| IEM time-enabled WMS | `cgi-bin/wms/nexrad/n0q-t.cgi` | 200, one 600×450 PNG per time (used by S-3) | — |
| IEM ASOS archive | `cgi-bin/request/asos.py` | 200 (used by S-3 to pick rain onsets) | — |
| nowCOAST / NCEP opengeo WMS | landing page, `conus_bref_qcd` capabilities | 200 | — |
| SWPC | `ovation_aurora_latest.json` (922 KB), Kp 1-min, Kp 3-day forecast, 3-day text forecast | 200 | — |
| EPA UV | Envirofacts hourly UV by ZIP 01757 | 200 | — |
| Census geocoder | one-line address | 200; **street addresses only** (a town or a park name returns no match) | — |
| Nominatim | "Hopkinton State Park" | 200, correct place; ODbL attribution in the response | — |
| OpenFreeMap | style + vector tiles | 200 | — |
| RainViewer | `weather-maps.json` | 200 (past frames only, see terms) | — |
| Open-Meteo | `/v1/forecast` | **429**: "Daily API request limit exceeded" (`X-RateLimit-Limit: 10000`, window 86400 s) on the shared cloud IP | — |
| CelesTrak | `gp.php?CATNR=25544` | **No answer** (TLS CONNECT hangs > 10 s, twice) | — |

### Terms (from provider pages via web search)

| Source | Personal self-hosted use | Key | Limits | Attribution / notes |
| :-- | :-- | :-- | :-- | :-- |
| NWS API | Yes; "open data, free to use for any purpose" | No; **User-Agent required** | Not published; "generous", retry after a short wait on 429 | Cache per the `Cache-Control` headers above |
| IEM (Iowa State) | Yes, no formal ToS found | No | None published | Use explicit timestamped TMS URLs and the `/c/` path for archive frames. N0Q was announced for replacement by N0B; still served today, *verify* before R2 |
| NOAA nowCOAST / opengeo | Public NOAA service | No | Not found | Fallback radar source |
| SWPC | Public NOAA data; may not imply NOAA endorsement or present modified data as original | No | Not found | **2026 NWS notice SCN 26-21: SWPC JSON format changes** (Kp, solar wind). Parse defensively and pin tests to fixtures |
| CelesTrak | Allowed with caching; one download per update cycle (~2 h, third-party sources) | No | Blocks abusive IPs (403/50x) | Fetch the ISS TLE at most every 2–6 h from the mini PC; *verify reachability from the mini PC* |
| Open-Meteo | Non-commercial free tier | No | < 10,000/day, 5,000/h, 600/min (terms page) | CC BY 4.0: "Weather data by Open-Meteo.com" next to the data. Fallback only |
| AirNow | Yes, per Data Use Guidelines | **Free key** (server-side, `core_integrations`) | ~500 requests/hour per key (per service; *verify*) | Cache hourly (obs) and daily (forecast) |
| EPA UV | Public | No | Not found | — |
| Synoptic | "Free, non-commercial open access" tier mentioned in its terms, but current sign-up unclear | Token | Unclear | *Verify*; not needed for R1 |
| MADIS (CWOP, mesonets) | **Per provider**; non-"full distribution" data may not be redistributed; real-time access needs an application | Account | — | Not assured; R1 does not depend on it |
| RainViewer | Personal/educational only | No | 100 req/min per IP; zoom ≤ 7; **no nowcast since 2026-01-01** | Dropped |
| OpenFreeMap | Free public instance, no key, no stated limits | No | None stated | OSM attribution; "as-is", terms may change |
| Nominatim | Yes, light use | No | **Max 1 request/s**, identifying User-Agent, cache results | ODbL attribution |
| Census geocoder | Public | No | Not found | Street addresses only; Nominatim for named places |
| Lightning (Blitzortung) | Free apps with "Lightning data by Blitzortung.org and contributors"; raw data and tiles need permission | — | — | Not in R2; GOES GLM via NOAA to be checked later |

## S-2 Radar delivery

Script: [`radar_sizes.py`](../../../spikes/weather-r0/radar_sizes.py) (tile sizes), [`bridge_transfer.mjs`](../../../spikes/weather-r0/bridge_transfer.mjs) (Playwright, sandboxed `srcdoc` iframe with the subapp CSP, private `MessagePort`, base64 → Blob → `blob:` → `img.decode()`; CPU throttled with CDP to approximate a phone).

**Sizes** (phone viewport = 4×6 tiles of 256 px with a one-tile margin; light weather in New England at the time, so storm days will be larger):

| Zoom | Past radar (N0Q) per frame | HRRR +60 min per frame | 24-frame loop |
| :-- | :-- | :-- | :-- |
| 6 | 64 KiB | 143 KiB | 1.5–3.4 MiB |
| 7 | 119 KiB | 129 KiB | 2.8–3.0 MiB |
| 8 | 69 KiB | 42 KiB | 1.0–1.7 MiB |

Base map as OpenFreeMap vector tiles: 2.0–2.6 MiB per viewport (z7–z8), plus the MapLibre library inside the single-file bundle.

**Bridge transfer** (24 frames × 24 tiles of the HRRR z6 frame, 143 KiB/frame):

| CPU | A: 24 tiles per frame (576 messages) | B: 1 composited image per frame (24 messages) |
| :-- | :-- | :-- |
| ×1 | whole loop 0.44 s | 0.36 s (first frame 0.12 s) |
| ×4 | 1.71 s | 0.56 s (first 0.51 s) |
| ×6 | 2.41 s | 0.78 s (first 0.70 s) |

The test posts all messages at once, so it measures decoding, not the bridge's rate limit. In the shell, **A would also hit the 50 calls/s per-app limit** (`apps/shell/src/bridge/rate-limit.ts`) and take ≥ 11.5 s, so tiles-per-call is out. The canvas-composited PNG was 313 KiB vs 143 KiB of tiles because the browser writes 32-bit PNG; the mini PC should write an 8-bit palette PNG or WebP.

**Not measured here:** mini PC → phone transfer over Tailscale (≈ 1.5–3.5 MiB per loop) and real phone CPU. Those are WX-10, manual on the phone once a prototype route exists.

## S-3 Nowcast ("rain starts in N min")

Script: [`nowcast_eval.py`](../../../spikes/weather-r0/nowcast_eval.py).

- **Method:** IEM NEXRAD N0Q composite frames every 5 min over a 6° × 4.5° box (~1 km/px) centred on Milford. Motion comes from phase correlation of the two frames 15 min apart. The latest frame is moved forward 5–90 min, and the predicted onset is the first lead at which the box around the point reaches the rain threshold.
- **Truth:** the first radar frame in which the point actually had rain.
- **Events:** rain onsets after ≥ 6 dry hours at KOWD, KBED or KORH (ASOS hourly, Sep 1 – Nov 28, 2026). Forecasts were issued 60, 45, 30 and 15 min before each onset. Dry controls were issued 3½–4 h before each onset; a control counts as a false alarm if it predicted rain within 60 min.

| Variant | Events | Detected at T-60 / -45 / -30 / -15 | Timing error when detected | False alarms (dry controls) |
| :-- | :-- | :-- | :-- | :-- |
| A: ≥ 20 dBZ in a 5×5 km box, intermittent rain included | 24 | 38 % / 33 % / 38 % / 42 % | median −25 to +5 min; 4–5 per lead within ±10 min | 6 / 48 (12 %) |
| B: as A, the point dry for the whole hour before onset | 20 | 25 % / 20 % / 30 % / 35 % | median 0 to +10 min; 4–5 within ±10 min | 2 / 40 (5 %) |
| C: ≥ 15 dBZ in an 11×11 km box, dry hour required | 27 | 19 % / 19 % / 26 % / 33 % | median −10 to 0 min; up to 8 within ±10 min | 4 / 54 (7 %) |

**Reading:**
- The method is precise but misses most onsets. Autumn rain here is often light, widespread rain that develops in place, which pure motion extrapolation cannot see coming.
- Variant A's "0 min" rows were rain already falling at issue time (intermittent showers), which is why B excludes them.
- Caveats:
  - The sample is small and holds few summer storms; moving thunderstorm lines, where extrapolation does best, are under-represented.
  - Truth is the radar itself, not a rain gauge.
  - HRRR was not scored, because archived HRRR 15-min tiles were not set up in this spike.

**Decision proposed:**
- No push notifications from extrapolation alone.
- R2 shows "Rain possible in ~N min" in the app only when the method fires.
- The §6.2 "rain starting" push uses the NWS hourly PoP crossing 50 % within 2 h, plus HRRR 15-min reflectivity at the point, with the radar extrapolation confirming the timing when it agrees.
- **S-3b**, before any minute-scale push: pysteps optical flow blended with HRRR 15-min, re-scored on these events plus the next winter's snow onsets. Target: ≥ 70 % detected at T-30 and ≤ 10 % false alarms.

## S-4 Google Calendar access (for SA-2026-010)

| | Calendar API (OAuth, server) | Secret iCal address |
| :-- | :-- | :-- |
| Setup | Google Cloud project, OAuth client, owner signs in once on the mini PC; refresh token in `core_integrations` | Copy one URL per calendar into `core_integrations` |
| Token life | **Testing status: refresh token expires 7 days after consent.** In production: no 7-day expiry. Unverified production apps show a warning screen and have a **lifetime cap of 100 users**, which a single owner never reaches | Valid until the owner resets it |
| Scope | `calendar.readonly` (or `calendar.events.readonly`): sensitive, not restricted (*verify* on the scopes page) | Whole calendar, read-only |
| Data | Location, recurrence (expanded with `singleEvents=true`), attendees, colours, all calendars in one token | Location and RRULE present; recurrence expanded by our parser; one feed per calendar |
| Freshness | Incremental `syncToken` polling; push (`watch`) needs a public HTTPS endpoint, which Supra deliberately lacks | Full download each poll; Google's serve-side freshness *to be measured* with a real feed |
| Risk | Google can revoke an unverified app's access; consent screen warning | URL is a bearer secret; Workspace admins may disable it |
| Later write-back (create event from Supra) | Possible with a wider scope | Not possible |

**Proposed:** Calendar API, app set to In production (unverified, owner only), `calendar.readonly`, `syncToken` poll every 10 min plus on agenda open. Fallback: secret iCal URLs. Needed from Nick when SA-2026-010 starts: which calendars to include.

Sources: [NWS API docs](https://www.weather.gov/documentation/services-web-api), [NWS API FAQ](https://weather-gov.github.io/api/general-faqs), [IEM OGC services](https://mesonet.agron.iastate.edu/ogc/), [IEM NEXRAD mosaic docs](https://mesonet.agron.iastate.edu/docs/nexrad_mosaic), [IEM HRRR GIS](https://www.mesonet.agron.iastate.edu/GIS/model.phtml), [SWPC data access](https://www.spaceweather.gov/content/data-access), [SCN 26-21](https://www.weather.gov/media/notification/pdf_2026/scn26-21_Data_Format_Changes_Impacting_SWPC_Products.pdf), [CelesTrak usage policy](https://celestrak.org/usage-policy.php), [Open-Meteo terms](https://open-meteo.com/en/terms), [Open-Meteo licence](https://open-meteo.com/en/licence), [AirNow FAQ](https://docs.airnowapi.org/faq), [Synoptic terms](https://synopticdata.com/tcs/), [MADIS restrictions](https://madis.ncep.noaa.gov/madis_restrictions.shtml), [RainViewer API transition](https://www.rainviewer.com/api/transition-faq.html), [OpenFreeMap](https://openfreemap.org), [OpenFreeMap ToS](https://openfreemap.org/tos/), [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/), [LightningMaps about](https://www.lightningmaps.org/about), [Google unverified apps](https://support.google.com/cloud/answer/7454865), [Google manage app audience](https://support.google.com/cloud/answer/15549945), [Google OAuth production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview), [Google Calendar secret address](https://support.google.com/calendar/answer/37648).
