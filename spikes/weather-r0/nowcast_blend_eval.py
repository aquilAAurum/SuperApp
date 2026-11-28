"""S-3b: optical-flow extrapolation + HRRR 15-min, alone and blended, for "rain starts at <point> soon".

Reuses S-3's frames, events and truth (nowcast_eval.py: IEM N0Q composite, onset = first radar frame with
>= 20 dBZ in the 5x5 km box after a fully dry hour). New here:

  EXT   Dense optical flow (OpenCV Farneback, frames 10 min apart) and semi-Lagrangian back-tracking from the
        point in 5-min steps, so curved and varying motion is followed (S-3 used one global shift).
  HRRR  NOAA HRRR sub-hourly REFD at 1000 m AGL (15-min steps) from the latest run available at issue time
        (init <= issue - 60 min, its usual latency), max over a box around the point. Downloaded by byte range
        from NOAA's AWS Open Data bucket (noaa-hrrr-bdp-pds); only the small crop around the point is kept.
  OR / AND  Blends: OR fires if either fires (earliest lead); AND needs both within 90 min (later lead).
  HRRR-2h   The approved push rule's model half: HRRR shows rain at the point within 2 h of issue.

Scores per issue lead (T-60/-45/-30/-15): detected = predicted onset in [0, lead + 30] min; false alarm on dry
controls (issued 3.5-4 h before onset) = predicted onset within 60 min (within 120 min for HRRR-2h).

Usage: HRRR_CACHE=<dir> python3 nowcast_blend_eval.py <asos.csv> <palette.png> <frameCache>
(run from this directory, without -I, so it can import nowcast_eval)
"""
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

import cv2
import eccodes
import numpy as np

hrrr_cache = os.environ.get("HRRR_CACHE") or sys.exit("set HRRR_CACHE")
import nowcast_eval as ne  # noqa: E402  (reads the same argv; its evaluation runs only as __main__)

UA = ne.UA
HRRR_BOX = int(os.environ.get("HRRR_BOX", 3))  # grid cells (3 km) each side
HRRR_DBZ = float(os.environ.get("HRRR_DBZ", 20.0))  # HRRR 1000 m REFD tends to run low in light rain
BUCKET = "https://noaa-hrrr-bdp-pds.s3.amazonaws.com"
_grid = {}


def _get(url, rng=None):
    hdr = {"User-Agent": UA}
    if rng:
        hdr["Range"] = f"bytes={rng[0]}-{rng[1]}"
    for attempt in range(4):
        try:
            return urllib.request.urlopen(urllib.request.Request(url, headers=hdr), timeout=60).read()
        except Exception:
            time.sleep(2 * (attempt + 1))
    return None


def hrrr_crop(run: datetime, fmin: int):
    """Max-able crop (dBZ) of REFD 1000 m around the point for run + fmin minutes, cached; None if missing."""
    os.makedirs(hrrr_cache, exist_ok=True)
    path = os.path.join(hrrr_cache, f"{run:%Y%m%d%H}_{fmin:04d}.npy")
    if os.path.exists(path):
        a = np.load(path)
        return None if a.size == 0 else a
    fh = (fmin + 59) // 60
    base = f"{BUCKET}/hrrr.{run:%Y%m%d}/conus/hrrr.t{run:%H}z.wrfsubhf{fh:02d}.grib2"
    idx = _get(base + ".idx")
    crop = None
    if idx:
        lines = idx.decode().splitlines()
        want = f"REFD:1000 m above ground:{fmin} min fcst:" if fmin % 60 else None
        for i, ln in enumerate(lines):
            parts = ln.split(":")
            label = ":".join(parts[3:6]) + ":"
            if (want and label == want) or (not want and label in (f"REFD:1000 m above ground:{fmin} min fcst:", f"REFD:1000 m above ground:{fmin // 60} hour fcst:")):
                start = int(parts[1])
                end = int(lines[i + 1].split(":")[1]) - 1 if i + 1 < len(lines) else ""
                msg = _get(base, (start, end))
                if msg:
                    h = eccodes.codes_new_from_message(msg)
                    nj, ni = eccodes.codes_get(h, "Nj"), eccodes.codes_get(h, "Ni")
                    vals = eccodes.codes_get_values(h).reshape(nj, ni)
                    if "ij" not in _grid:
                        lats = eccodes.codes_get_array(h, "latitudes").reshape(nj, ni)
                        lons = eccodes.codes_get_array(h, "longitudes").reshape(nj, ni)
                        lons = np.where(lons > 180, lons - 360, lons)
                        _grid["ij"] = np.unravel_index(np.argmin((lats - ne.LAT) ** 2 + (lons - ne.LON) ** 2), lats.shape)
                    eccodes.codes_release(h)
                    j, i0 = _grid["ij"]
                    crop = vals[j - 10: j + 11, i0 - 10: i0 + 11]  # keep 21x21 cells (63 km) for box tuning
                break
    np.save(path, crop if crop is not None else np.array([]))
    return crop


def hrrr_onset(t: datetime, horizon=90):
    """First lead (min, 15-min steps) at which HRRR has >= RAIN_DBZ in the box; None if not within horizon."""
    run = (t - timedelta(minutes=60)).replace(minute=0, second=0, microsecond=0)
    first = ((t - run).seconds // 60 // 15 + 1) * 15  # first 15-min valid time after t
    for fmin in range(first, (t - run).seconds // 60 + horizon + 1, 15):
        c = hrrr_crop(run, fmin)
        if c is None:
            continue
        b = c[10 - HRRR_BOX: 11 + HRRR_BOX, 10 - HRRR_BOX: 11 + HRRR_BOX]
        if np.nanmax(b) >= HRRR_DBZ:
            return fmin - (t - run).seconds // 60
    return None


def ext_onset(t: datetime, horizon=90):
    """Optical-flow back-trajectory extrapolation; 0 if raining now; None if no rain within horizon."""
    now, prev = ne.frame(t), ne.frame(t - timedelta(minutes=10))
    if ne.at_point(now) >= ne.RAIN_DBZ:
        return 0

    def u8(g):
        return (np.clip(np.nan_to_num(g, nan=0.0), 0, 64) * 4).astype(np.uint8)

    flow = cv2.calcOpticalFlowFarneback(u8(prev), u8(now), None, 0.5, 4, 31, 5, 7, 1.5, 0)  # px per 10 min
    flow = cv2.GaussianBlur(flow, (0, 0), 8)
    x, y = float(ne.PX), float(ne.PY)
    for lead in range(5, horizon + 1, 5):
        xi, yi = int(np.clip(round(x), 0, ne.W - 1)), int(np.clip(round(y), 0, ne.H - 1))
        fx, fy = flow[yi, xi] / 2  # px per 5 min
        if abs(fx) > 15 or abs(fy) > 15:  # > ~180 km/h: bad flow
            return None
        x, y = x - fx, y - fy
        if ne.at_point(now, ne.PX - x, ne.PY - y) >= ne.RAIN_DBZ:
            return lead
    return None


def blend(e, h, how):
    if how == "OR":
        vals = [v for v in (e, h) if v is not None]
        return min(vals) if vals else None
    if e is None or h is None:
        return None
    return max(e, h)


def main():
    events = ne.events_from_asos(ne.asos_csv)
    rows, controls = [], []
    for hour in events:
        ne._decoded.clear()
        ne.prefetch([hour - timedelta(minutes=m) for m in range(-60, 4 * 60 + 25, 5)])
        t0 = ne.truth_onset(hour)
        if t0 is None:
            continue
        for lead in (60, 45, 30, 15):
            t = t0 - timedelta(minutes=lead)
            e, h = ext_onset(t), hrrr_onset(t)
            h2 = hrrr_onset(t, 120)
            rows.append((lead, {"EXT": e, "HRRR": h, "OR": blend(e, h, "OR"), "AND": blend(e, h, "AND"), "HRRR-2h": h2}))
        for back in (240, 210):
            t = ne.align(t0 - timedelta(minutes=back))
            e, h = ext_onset(t), hrrr_onset(t)
            h2 = hrrr_onset(t, 120)
            controls.append({"EXT": e, "HRRR": h, "OR": blend(e, h, "OR"), "AND": blend(e, h, "AND"), "HRRR-2h": h2})
        print(f"{t0:%Y-%m-%d %H:%M}Z  " + "  ".join(f"T-{l}: E={r['EXT']} H={r['HRRR']}" for l, r in rows[-4:]), flush=True)

    n_events = len(rows) // 4
    print(f"\nEvents scored: {n_events}  (RAIN_DBZ={ne.RAIN_DBZ}, radar box ±{ne.BOX} km, HRRR >= {HRRR_DBZ} dBZ in ±{HRRR_BOX * 3} km)")
    print(f"{'method':8} " + " ".join(f"{'T-' + str(l):>12}" for l in (60, 45, 30, 15)) + "   false alarms   |err|<=15 at T-30")
    for m in ("EXT", "HRRR", "OR", "AND", "HRRR-2h"):
        cells, errs30 = [], []
        for lead in (60, 45, 30, 15):
            ps = [r[m] for l, r in rows if l == lead]
            win = lead + 30 if m != "HRRR-2h" else 120
            hits = [p for p in ps if p is not None and 0 <= p <= win]
            cells.append(f"{len(hits):2}/{len(ps):2} {100 * len(hits) / max(1, len(ps)):3.0f}%")
            if lead == 30:
                errs30 = [p - lead for p in hits]
        fa_win = 60 if m != "HRRR-2h" else 120
        fa = sum(1 for c in controls if c[m] is not None and c[m] <= fa_win)
        good = sum(abs(e) <= 15 for e in errs30)
        print(f"{m:8} " + " ".join(f"{c:>12}" for c in cells) + f"   {fa:2}/{len(controls)} {100 * fa / max(1, len(controls)):3.0f}%   {good}/{len(errs30)}")


if __name__ == "__main__":
    main()
