# Feature Name: Weather & Sky (`weather` subapp, agenda weather guard)

- **Feature ID:** SA-2026-009
- **Doc ID:** D02 (PRD)   · **Producer:** Qz   · **Consumers:** Jane, Jules, Priya, Kumi Wai, Russ, Theo
- **Version:** 0.4   · **Status:** Proposal (scoping; O-1 to O-7 decided by Nick 2026-11-28; O-8 deferred until a station is bought; no code)   · **Date:** 2026-11-28
- **Owner(s):** Qz (content), Nick (approval)   · **T-Shirt Size:** L (four releases, §9)
- **Subapp id:** `weather` (collections `weather_*`, events `weather.*`, deep links `superapp://weather/...`)
- **Depends on:** SA-2026-003 (data and sync), SA-2026-004 (M4: `device.location`, `notify.post`), SA-2026-005 (M5: bus, inbox, deep links), the M6 server-proxy pattern, and an **agenda** (SA-2026-010, proposed in §7; none exists yet).
- **Planning only.** This document scopes the feature for later build sprints.

---

## 1. Problem and goal

Weather apps answer "what is it doing now?". The owner needs answers to "will this change my plans?": is rain about to start, will tomorrow's hike get wet, will Thursday's drive hit snow, is tonight worth going outside for the aurora. Existing apps (MyRadar, NWS, Weather.com) show the data but don't know the owner's calendar, and push either too much or nothing.

**Goal:** a calm weather subapp built on NOAA data and public stations, with MyRadar-style animated radar, that puts **hourly forecast** and **impending changes** first, sends **one nightly brief at 7 pm**, tells the owner when the **week's rain/snow outlook changes**, flags **sky events** (aurora, meteor showers, eclipses, bright planets, ISS passes), and **checks the agenda** for weather conflicts.

Three jobs, in this order:

| Job | Means |
| :-- | :-- |
| **Warn of change** | NWS alerts for the owner's places, plus "rain starting in ~20 min", "temperature drops 15° after 3 pm", "gusts to 45 mph tonight". |
| **Plan** | Hourly next 48 h, 7-day outlook with rain/snow totals, the 7 pm brief, agenda conflicts. |
| **Comfort** | Feels-like, dew point (muggy/dry), wind chill, UV, air quality, sunrise/sunset, "good hours outside today". |

## 2. Principles (design brief)

1. **Changes first.** Home opens on what is about to change (an alert, a precipitation start, a front), then now, then hourly. A quiet day says so in one line.
2. **Few, earned notifications.** One scheduled message a day (7 pm). Everything else is event-driven, deduplicated, rate-limited (§6.4) and silent overnight except NWS warnings.
3. **Say what changed.** Updates name the delta: "Thursday snow now 3–6 in (was 1–3 in)", never just "forecast updated".
4. **Facts with a source and time.** Every number shows its source (NWS, station KBOS, HRRR) and age. Stale data is labelled, never silently shown (SA-U3).
5. **Phone privileges only through Supra.** Location and notifications go through the bridge with consent. The subapp makes no network calls; the mini PC talks to NOAA (SA-C3, spec §Integrations).
6. **Calm visuals.** Same token set as EatWell; colour is never the only signal (radar legend has values, alerts have text severity); 48 px targets; WCAG 2.1 AA.

"Astrological guidance" in the request means **astronomical** sky events (aurora, meteors, eclipses, planets, moon). Horoscope-style astrology is out of scope (O-1, decided by Nick 2026-11-28).

## 3. Architecture

```
NOAA / public sources ──► mini PC (PocketBase hooks: fetch, cache, derive, schedule)
                               │  weather_* collections (synced) + core_notifications (+ ntfy push)
                               ▼
                        phone shell (mirror, bridge)  ──►  weather subapp (iframe, no network)
                               ▲                                │
                     agenda_events (SA-2026-010) ◄── weather_conflicts ──► agenda view badges
```

Why the server does the work:

- **Subapps cannot fetch** (`connect-src 'none'`, ADR-003). NOAA must be reached by the mini PC, like Home Assistant and Jellyfin.
- **Phone background tasks are "Later"** (spec §Capabilities: WorkManager not in v1). The 7 pm brief and change detection must run when the phone is asleep, so they are PocketBase `cronAdd` jobs (the pattern `sa_retention` already uses), delivered as `core_notifications` and woken with the ntfy push the spec already plans.
- **One fetch serves every view**: forecasts are cached server-side per NWS grid point, so phone, future TV and agenda all read the same snapshot.

### 3.1 Server routes and jobs (`server/pb_hooks/weather.pb.js`, logic in `lib/weather-*.js`)

| Item | Kind | Does |
| :-- | :-- | :-- |
| `weather_refresh` | cron, every 15 min (alerts every 5 min) | For each active place: NWS hourly + gridpoint data (hourly ≤ 1×/h, ETag/`If-Modified-Since`), active alerts, nearest station observations; writes `weather_snapshots`, runs change detection (§6) and the agenda check (§7.3). |
| `weather_nowcast` | cron, every 5 min, only for places with precipitation within 150 km | Radar-derived "starts/stops in N min" for each place (§4.2). |
| `weather_sky` | cron, hourly | SWPC Kp and aurora (OVATION) forecast; computes moon, planets, meteor-shower peaks, eclipses, ISS passes for each place; combines with cloud cover into `weather_sky_events`. |
| `weather_brief` | cron, every minute, fires at **19:00 in the phone's timezone** (§3.3; fallback `America/New_York`, DST-safe) | Builds the nightly brief (§5) and posts it. |
| `GET /api/sa/weather/radar/frames` | route | Frame list (past 2 h at 5–10 min, future 0–6 h from HRRR) with timestamps and source. |
| `GET /api/sa/weather/radar/tile/:layer/:t/:z/:x/:y` | route | Proxied, cached PNG tile (server-side LRU, 24 h max). |
| `GET /api/sa/weather/point?lat&lon` | route | On-demand forecast for an ad-hoc point (agenda event location, "search a place"). Coordinates rounded to 0.01° (~1 km) before leaving the mini PC. |

Outbound requests carry a generic `User-Agent` (`Supra-weather/1.0 (self-hosted)`; NWS requires one) and **no owner identity** (Profile privacy rule).

### 3.2 Bridge (contract first, SA-C4; API 1.x minor, additive)

A new `weather.*` namespace with scope `weather.read` (no consent sheet: it exposes only server-derived weather, never the owner's location by itself):

| Method | Returns |
| :-- | :-- |
| `weather.radarFrames({ bbox })` | Frame list from the route above. |
| `weather.radarTile({ layer, t, z, x, y })` | `{ mime, dataBase64 }`; the subapp turns it into a `blob:` URL (the subapp CSP already allows `img-src data: blob:`). |
| `weather.point({ lat, lon })` | Forecast for an ad-hoc point (rate-limited per app). |

Forecasts, alerts, sky events and conflicts are ordinary synced collections read with `data.*` / `data.subscribe`, so they work offline from the mirror. Current position uses `device.location` (M4, consent).

Tile transfer over the bridge is the main performance risk (≈ 15–40 KB per tile, ~12 tiles × 24 frames per loop). Spike S-2 measures it; fallback is server-composited frames (one image per frame for the viewport).

### 3.3 Location and timezone (O-2, decided)

The forecast follows the phone; there is no fixed "home" in R1.

| Input | Source | Fallback |
| :-- | :-- | :-- |
| **Location** | Phone GPS through `device.location` (consent). Read when the weather app opens and when the shell resumes with weather granted; the shell writes the rounded position (0.01°) to the `current` place in `weather_places` through ops. | **Milford, MA** (42.14, −71.52) when location is denied, unavailable, or older than 24 h. The app and the brief say "Using Milford, MA (location unavailable)". |
| **Timezone** | The phone's IANA timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`), written to `weather_settings.timezone` on every app open and shell resume, so travel moves the 7 pm brief with the owner. | `America/New_York` (Milford's zone) when the phone has never reported one. |

The server always forecasts for the last known `current` place, so warnings and the 7 pm brief still work while the phone is asleep. Background location updates (phone asleep, owner travelling) need WorkManager, which is "Later" in the spec; until then the position is as fresh as the last time Supra was opened, and its age is shown. Extra saved places (work, cabin) and agenda locations are optional and use the same pipeline.

## 4. Data sources

All free/public; terms and attribution confirmed in spike S-1 before build. Primary is NOAA; everything else is a labelled secondary.

### 4.1 Forecast, alerts, observations

| Need | Source | Notes |
| :-- | :-- | :-- |
| Hourly forecast (7 days) | NWS API `api.weather.gov/points/{lat},{lon}` → `/gridpoints/{wfo}/{x},{y}/forecast/hourly` | Temperature, dew point, humidity, wind/gusts, sky cover, PoP, short text. |
| Precip amounts, snow, ice, thunder, apparent temp | `/gridpoints/{wfo}/{x},{y}` (raw grid) | `quantitativePrecipitation`, `snowfallAmount`, `iceAccumulation`, `probabilityOfThunder`, `apparentTemperature`, `windChill`, `heatIndex`. Drives week outlook and change detection. |
| Watches, warnings, advisories | `/alerts/active?point={lat},{lon}` (CAP) | Severity, certainty, urgency, onset/ends; updated every 5 min. |
| Discussion (optional) | `/products?type=AFD&location={wfo}` | Forecaster reasoning; shown collapsed for "why". |
| Official observations | `/stations/{id}/observations/latest` (ASOS/AWOS near each place) | Truth for "now" and pressure trend. |
| Public weather stations | **MADIS** (includes CWOP citizen stations, mesonets) and **Synoptic** public data, if their terms allow | Hyper-local temperature, wind and rain rate; quality-filtered (§4.3). Weather Underground PWS API is excluded (requires a contributing station and limits reuse). |
| **Owner's weather station** (later, R5; O-7: none owned yet) | Read by the mini PC from the station's local API on the LAN, or from Home Assistant once it runs on the mini PC (M6); a vendor cloud key, if one is needed, lives in `core_integrations` and never reaches the phone. Brand and connection in O-8. | **First source for "now" at the station's location** (temperature, humidity, wind/gusts, rain rate and daily total, pressure trend). Rain rate > 0 at the station confirms a nowcast start; its pressure trend feeds §6.2. |
| Air quality | AirNow API (EPA; free key held in `core_integrations`) | AQI + pollutant, forecast. |
| UV | EPA UV index forecast (Envirofacts) | Hourly UV by ZIP/city. |
| Fallback / outside the US | Open-Meteo (no key) | Used only when NWS is down or the place is outside NWS coverage; labelled. |

### 4.2 Radar (the MyRadar part)

| Layer | Source | Use |
| :-- | :-- | :-- |
| Past radar, 2 h loop | NEXRAD / MRMS composite reflectivity tiles (Iowa Environmental Mesonet tile cache, or NOAA nowCOAST/`opengeo.ncep.noaa.gov` WMS) | Animated loop, 5-min frames. |
| Future radar, 0–6 h | HRRR simulated reflectivity (15-min sub-hourly) | "Future radar" continuation of the loop, clearly marked *model*. |
| Precip type | MRMS precipitation flag | Rain / snow / mix colouring. |
| Overlays | NWS alert polygons (from the alerts feed), lightning (later, source TBD in S-1), temperature, wind | Toggleable layers. |
| Nowcast "starts in N min" | Server-side: compare successive MRMS frames for motion vectors near each place (simple cross-correlation), cross-checked with HRRR 15-min | Minute-scale start/stop for the next 60–90 min; shown with a confidence and suppressed when the two disagree. |

Map: MapLibre GL or Leaflet bundled inside the single-file subapp, with a lightweight base map (OSM-derived vector tiles proxied and cached the same way, or a pre-rendered region pack). Base map source is decided in S-2.

### 4.3 Station quality

Citizen stations are noisy. A station is used only if: reported in the last 30 min; within 10 km and 150 m elevation of the place; passes MADIS QC flags; and is within a plausibility band of the nearest ASOS and NWS grid (e.g. ±8 °F). Outliers are dropped and listed in Diagnostics, not shown. Later (R5), the owner's station skips the distance rule but keeps the staleness and plausibility checks; when it fails them the app says "Your station: no recent data" and falls back to public stations.

### 4.4 Sky

| Event | Source / method |
| :-- | :-- |
| Aurora | NOAA SWPC: planetary Kp (observed 1-min and 3-day forecast), OVATION aurora probability grid, alerts (G-scale storms, CME arrival). "Visible from here" = OVATION view-line reaches the place's latitude, at night, with forecast sky cover < 40 %. |
| Moon phase, rise/set, sun, twilight | Computed on the server (e.g. `astronomy-engine`, MIT) per place. |
| Planets (bright, conjunctions, oppositions) | Computed (same library). |
| Eclipses (solar, lunar) | Computed; local contact times and magnitude. |
| Meteor showers | Static IMO calendar (peak, ZHR) per year, scored with moonlight and cloud cover. |
| ISS and bright satellite passes | CelesTrak TLE + SGP4 (`satellite.js`) on the server; magnitude estimate, only evening/morning visible passes. |
| Viewing score | Combines darkness (moon, twilight), forecast cloud cover, and the event; shown as *good / fair / poor* with the reasons. |

## 5. The 7 pm nightly brief

Posted at 19:00 in the phone's timezone (§3.3), for the phone's last known location (fallback Milford, MA), every day (can be turned off or moved in Settings; quiet-hours rules do not delay it). Short notification text; tapping opens `superapp://weather/brief/<date>`.

**Notification (≤ 2 lines):** "Tomorrow: 41°/28°, rain 2–5 pm (70 %). Snow Thu 3–6 in ↑. Hike at 1 pm may be wet."

**Brief screen:**

1. **Tomorrow at a glance:** high/low, feels-like range, sunrise/sunset, and "best hours outside".
2. **Hourly strip** for 6 am–11 pm: temperature, precip chance and type, wind.
3. **Tomorrow's agenda vs weather:** each event with a location, its forecast at that time, and any conflict (§7).
4. **Week ahead, rain and snow:** each day with type, chance, and amount ranges; changes since yesterday's brief marked ↑/↓ with old values.
5. **Alerts** active or expected to start before tomorrow night.
6. **Tonight's sky:** only if something rates *good* (aurora chance, meteor peak, eclipse, ISS pass, conjunction).

The brief is stored in `weather_briefs` so the "changes since yesterday" diff has a baseline and past briefs can be reread.

## 6. Change detection and warnings

### 6.1 NWS alerts

Warnings (tornado, severe thunderstorm, flash flood, winter storm, blizzard, ice storm, extreme cold/heat, high wind) notify immediately, including overnight. Watches and advisories notify during waking hours; overnight they wait for the morning. Updates to the same alert (CAP `references`) edit the notification instead of posting a new one.

### 6.2 Impending shifts (next 0–12 h)

| Trigger (defaults; tunable) | Example message |
| :-- | :-- |
| Precip starts within 60 min at a place (nowcast, both sources agree) | "Rain starting at home in ~20 min, about an hour." |
| Precip type changes (rain → snow/ice) within 6 h | "Rain turns to snow around 9 pm." |
| Temperature change ≥ 15 °F within 3 h, or crossing 32 °F with wet ground | "Falling to 30° by 6 pm; wet roads may freeze." |
| Gusts ≥ 40 mph, or +20 mph above now, within 6 h | "Gusts to 45 mph after 4 pm." |
| Pressure fall ≥ 3 hPa / 3 h at nearby stations | Shown on Home as "front arriving", no push by itself. |
| Thunder probability ≥ 30 % within 6 h | "Thunderstorms possible 3–6 pm." |
| Heat index ≥ 95 °F or wind chill ≤ 0 °F | Comfort warning. |

### 6.3 Week outlook updates (rain and snow, days 1–7)

Compared against the last notified snapshot per day. Notify when: a day gains or loses precipitation (PoP crosses 40 %); snow range changes category (trace, < 1, 1–3, 3–6, 6–12, > 12 in); rain total changes by ≥ 0.5 in; ice appears; or the type changes. Changes are batched into the 7 pm brief unless the affected day is within 48 h and the change is upward, then pushed once (max one outlook push per day outside the brief).

### 6.4 Notification budget

- Per place and trigger type, one notification per 3 h; the same condition is not re-announced unless it worsens.
- Quiet hours (default 22:00–07:00): only NWS warnings and nowcast for places where the owner currently is.
- Each notification states the source and links to the detail. Every sent and suppressed notification is logged (Diagnostics, app id `weather`).

## 7. Agenda integration

### 7.1 Gap: there is no central agenda yet

Supra has no agenda collection, calendar subapp, or calendar integration. The weather guard needs one. Proposal **SA-2026-010 Agenda** (separate PRD), minimal for this feature:

- Server-side **Google Calendar sync** (OAuth refresh token in `core_integrations`, never on the phone; read-only at first), plus events created in Supra.
- Core collection `core_agenda_events`: title, start/end, all-day, timezone, location text, geocoded `lat/lon` (server geocoder: US Census, then Nominatim; rounded), optional destination for trips (`to_lat/to_lon`), `kind` (`outdoor`, `travel`, `indoor`, `unknown`), source id.
- An `agenda` subapp (day/week list) that shows weather badges, and the shell "Today" surface later.

Readable by other apps through `core.agenda_events.read`. Until SA-2026-010 ships, the weather app's R1–R2 work without conflicts.

### 7.2 Classifying events

`kind` is set by, in order: the owner's explicit choice (sticky per recurring series); keywords (hike, run, bike, golf, game, picnic, BBQ, beach, ski, garden, walk → outdoor; flight, drive, trip, airport, road trip, a destination different from the start → travel); location type (park, trail, stadium, airport). Unknown events are not checked. The owner can mark a series "never warn".

### 7.3 Conflict rules (defaults; tunable)

| Event kind | Conflict when, during the event window (±1 h) |
| :-- | :-- |
| Outdoor | PoP ≥ 50 % or ≥ 0.1 in rain; thunder ≥ 20 %; any active warning; gusts ≥ 35 mph; heat index ≥ 95 °F; wind chill ≤ 10 °F; AQI ≥ 151; for evening sky plans, cloud cover ≥ 70 %. |
| Travel (drive) | Snow ≥ 1 in, any ice/freezing rain, visibility advisory (fog), winter-weather advisory or warning at origin, destination, or **along the route** (sampled every ~25 km on the server route; route corridor in R4, origin + destination before that). |
| Travel (flight) | Warnings or heavy snow/thunder at departure or arrival airport within ±3 h. |

Severity: *heads-up* (chance), *likely*, *warning* (NWS alert). Each conflict records the forecast it was based on.

### 7.4 When it checks and how it tells

- Re-checked on every forecast refresh for events in the next 7 days, and immediately when an event is created or moved.
- Written to `weather_conflicts` (event id, rule, severity, details, forecast snapshot id). The agenda view shows a badge on the event; the weather app has an "Affects your plans" card.
- Notified when a conflict first reaches *likely* (≥ 24 h ahead, it waits for the 7 pm brief); when it is within 24 h and escalates; and when it clears ("Saturday hike now looks dry"). Bus event `weather.conflict.raised` / `weather.conflict.cleared` (M5) so other subapps can react.
- Suggestions are factual: the best dry window that day, or "snow ends 10 am; roads better after noon". No auto-rescheduling.

## 8. Data (server: `server/pb_migrations/<ts>_weather.js`)

| Collection | Holds | Notes |
| :-- | :-- | :-- |
| `weather_places` | Owner's places: name, rounded lat/lon, NWS grid and nearest stations (cached), flag `current` (from the phone, §3.3) or saved | Few records. The `current` place is seeded as Milford, MA and replaced by the phone's rounded GPS position when available. |
| `weather_snapshots` | Per place, per refresh: hourly 48 h, daily 7 d (with precip/snow/ice ranges), current obs, sources and fetch times | Keep 14 days (feeds diffs); older purged by cron. |
| `weather_alerts` | Active/recent NWS alerts per place (CAP id, event, severity, onset, ends, headline, polygon) | Keep 30 days. |
| `weather_nowcasts` | Latest start/stop prediction per place | Overwritten. |
| `weather_sky_events` | Upcoming sky events per place with viewing score | Rolling 14 days. |
| `weather_briefs` | Nightly brief content per date | Keep 90 days. |
| `weather_conflicts` | Agenda conflicts (event, rule, severity, status, snapshot) | Cleared conflicts kept 14 days. |
| `weather_settings` | Phone timezone (§3.3), brief time and on/off, quiet hours, thresholds, notification toggles per trigger, sky interests | One live record. |

All synced (version, soft delete, owner-only rules). Server-derived collections are written by the hooks, not by the phone; the phone writes only `weather_places` and `weather_settings` through ops.

**Privacy (Priya; Profile §5 rows to add):** places and agenda locations are personal location data, kept on the mini PC and phone only. Only rounded coordinates (0.01°) go to NOAA and other sources, with no identity. Live position is read only with `device.location` consent and is not stored beyond the "follow me" place.

## 9. Scope by release

| Release | Scope | Needs |
| :-- | :-- | :-- |
| **R1 — Forecast and warnings** | Server NWS fetch/cache, places, Home (changes first, now, hourly 48 h, 7-day with rain/snow amounts), NWS alerts with notifications, station "now" with QC, comfort (feels-like, dew point, UV, AQI), **7 pm brief** and week-outlook change detection (§6.3). | M3 (done-ish), M4 `notify.post`, `device.location`, ntfy push |
| **R2 — Radar** | Animated past radar + HRRR future radar, precip type, alert polygons, map with place pins; nowcast "starts in N min" (§6.2). | `weather.*` bridge methods, spike S-2 |
| **R3 — Sky** | Aurora (Kp, OVATION, storm alerts), moon/sun/twilight, meteor showers, eclipses, planets, ISS passes, viewing score, "Tonight's sky" in the brief and push for *good* aurora nights. | — |
| **R4 — Agenda guard** | Conflict engine, badges in the agenda view, conflict notifications, route sampling for drives. | SA-2026-010 Agenda (Google Calendar sync, `core_agenda_events`), M5 bus |
| R5 — Own station (later) | Owner's weather station as the first source for "now" (§4.1, §4.3), once one is bought. Nothing in R1–R4 depends on it; station readings plug into the existing observation pipeline. | A station (O-8) |

Out of scope: horoscope astrology (O-1), email delivery (O-5; push only), metric units (O-4), pollen (no NOAA source), marine/aviation products, ads, social features, AI chat about weather (could reuse `ai.chat` later to summarise the forecast discussion).

## 10. Acceptance (draft)

| ID | Criterion | Evidence |
| :-- | :-- | :-- |
| WX-1 | Subapp makes no network calls; all data arrives through `data.*` and `weather.*` | E2E with CSP violation listener; lint |
| WX-2 | Brief posts once at 19:00 local on DST-change days and normal days; never twice | Unit (scheduler with fake clock across DST) + integration |
| WX-3 | Week diff notifies only on the §6.3 thresholds; repeated refreshes with the same data post nothing | Unit with recorded NWS fixtures |
| WX-4 | NWS warning reaches the phone ≤ 6 min after it appears in the feed (when online) | Integration with mocked feed; manual on phone |
| WX-5 | Station outliers are dropped by the §4.3 rules and listed in Diagnostics | Unit with fixtures |
| WX-6 | Outdoor event + forecast PoP 60 % in its window produces one *likely* conflict, a badge, and a "cleared" notice when it drops below threshold | Unit + E2E (R4) |
| WX-7 | Only rounded coordinates and the generic User-Agent leave the mini PC | Integration asserting outbound requests |
| WX-8 | Stale data (> 2 h for forecast, > 30 min for obs/radar) is labelled on every screen | E2E |
| WX-9 | Home, brief, radar, sky, settings pass axe WCAG 2.1 AA | E2E |
| WX-10 | Radar loop of 24 frames is playable within 3 s on the phone over Tailscale | Manual on phone (S-2 target) |
| WX-11 | With location denied or older than 24 h, forecast and brief use Milford, MA and say so; with no reported timezone the brief fires at 19:00 `America/New_York`; a timezone change on the phone moves the next brief | Unit (fallback resolver, fake clock) + E2E |

## 11. Spikes

| ID | Question | Output |
| :-- | :-- | :-- |
| S-1 | Terms, rate limits and attribution for NWS, IEM tiles, nowCOAST, MADIS/Synoptic public data, AirNow, SWPC, CelesTrak, Open-Meteo; lightning source | Source table with "allowed for personal self-hosted use: yes/no", required attribution text |
| S-2 | Radar delivery: bridge tile transfer vs server-composited frames; base map source; loop performance on the phone | Measured timings, chosen approach |
| S-3 | Nowcast quality: MRMS motion vs HRRR for "starts in N min" on 10 recorded events | Hit/miss and timing error; go/no-go for push |
| S-4 | Google Calendar access for SA-2026-010 (both sources decided, O-3): Calendar API with OAuth on the server vs a private ICS feed; sync interval; which calendars | Recommendation for SA-2026-010 |

## 12. Open questions (Nick)

| ID | Question | Recommendation |
| :-- | :-- | :-- |
| O-1 | "Astrological guidance": astronomy only, or also horoscope astrology? | **Decided (Nick, 2026-11-28): astronomy only.** |
| O-2 | Which location and timezone drive the forecast and the brief? | **Decided (Nick, 2026-11-28): the phone's GPS location and timezone; Milford, MA (`America/New_York`) when unavailable** (§3.3). |
| O-3 | Agenda source: Google Calendar, Supra-native, or both? | **Decided (Nick, 2026-11-28): both.** Google Calendar read-only via the server plus Supra-native events; which calendars and API vs ICS in S-4. |
| O-4 | Units? | **Decided (Nick, 2026-11-28): °F** (with mph and inches); no metric switch in R1. |
| O-5 | Email the brief as well? | **Decided (Nick, 2026-11-28): no email; push notifications only.** |
| O-6 | Is ntfy push (spec §Push) acceptable to run on the mini PC for overnight warnings? | **Decided (Nick, 2026-11-28): yes.** Self-hosted ntfy on the mini PC; R1 depends on it. |
| O-7 | Include the owner's own weather station? | **Decided (Nick, 2026-11-28): later add.** No station owned yet; planned as R5. |
| O-8 | Which station to buy (deferred to R5)? | Prefer one with a local LAN API (e.g. Ecowitt, Tempest UDP, Davis WeatherLink Live) so the mini PC reads it directly with no cloud key and it keeps working offline. |
