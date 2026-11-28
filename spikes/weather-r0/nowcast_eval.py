"""S-3: can a simple radar-extrapolation nowcast say "rain starts at <point> in N minutes"?

Method (deliberately simple, so it can run in a PocketBase hook or a small sidecar):
  1. Frames: IEM NEXRAD N0Q composite through its time-enabled WMS, 600x450 px over a 6 x 4.5 degree box
     (~1 km/px), every 5 min. Colours are mapped back to N0Q palette indices with the palette of one archive
     PNG (all WMS colours are in it), then to dBZ (index * 0.5 - 32.5).
  2. Motion: phase correlation (numpy FFT) between the frames 15 min apart, on reflectivity >= 15 dBZ.
  3. Forecast: advect the latest frame by motion x lead (5..90 min); predicted onset = first lead at which the
     5x5 px box around the point reaches >= 20 dBZ.
  4. Truth: first frame where that box actually reaches >= 20 dBZ.

Events: rain onsets from ASOS hourly precipitation (KOWD, KBED, KORH; >= 6 dry hours before), Sep-Nov 2026.
For each event the nowcast is issued at T0-60, -45, -30, -15 min (T0 = radar-truth onset at the point), plus
dry control issues 3-4 h before onset to count false alarms.

Usage: python3 -I nowcast_eval.py <asos.csv> <palette.png> <cacheDir> [lat lon]
"""
import csv
import io
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

import numpy as np
from PIL import Image

UA = "Supra-weather/1.0 (self-hosted)"
asos_csv, palette_png, cache = sys.argv[1:4]
LAT, LON = (float(sys.argv[4]), float(sys.argv[5])) if len(sys.argv) == 6 else (42.14, -71.52)
W, H, DLON, DLAT = 600, 450, 3.0, 2.25
BBOX = (LON - DLON, LAT - DLAT, LON + DLON, LAT + DLAT)
PX, PY = W // 2, H // 2  # the point is the image centre
# Tunable from the environment for variants: NC_RAIN_DBZ, NC_BOX (half-width in px, ~1 km each).
RAIN_DBZ = float(os.environ.get("NC_RAIN_DBZ", 20.0))
MOTION_DBZ = 15.0
BOX = int(os.environ.get("NC_BOX", 2))

pal = np.array(Image.open(palette_png).getpalette()).reshape(-1, 3)[:256].astype(np.int64)
# Vectorised colour -> palette index: pack RGB into one int and look it up with searchsorted.
_keys = pal[:, 0] << 16 | pal[:, 1] << 8 | pal[:, 2]
_order = np.argsort(_keys)
_sorted = _keys[_order]
_decoded = {}


def frame(t: datetime) -> np.ndarray:
    """dBZ grid (NaN = no echo) for time t (UTC, 5-min aligned), cached on disk."""
    os.makedirs(cache, exist_ok=True)
    path = os.path.join(cache, t.strftime("%Y%m%d%H%M") + ".png")
    if path in _decoded:
        return _decoded[path]
    if not os.path.exists(path):
        url = (
            "https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap"
            f"&LAYERS=nexrad-n0q-wmst&STYLES=&TIME={t.strftime('%Y-%m-%dT%H:%M:00Z')}&SRS=EPSG:4326"
            f"&BBOX={BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}&WIDTH={W}&HEIGHT={H}&FORMAT=image/png&TRANSPARENT=true"
        )
        body = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60).read()
        open(path, "wb").write(body)
        time.sleep(0.2)
    a = np.array(Image.open(path).convert("RGBA"))
    out = np.full((H, W), np.nan)
    mask = a[..., 3] > 0
    rgb = a[mask][:, :3].astype(np.int64)
    k = rgb[:, 0] << 16 | rgb[:, 1] << 8 | rgb[:, 2]
    pos = np.clip(np.searchsorted(_sorted, k), 0, len(_sorted) - 1)
    idx = np.where(_sorted[pos] == k, _order[pos], 0)
    out[mask] = idx * 0.5 - 32.5
    _decoded[path] = out
    return out


def prefetch(times):
    """Download missing frames with 3 parallel requests (decoding stays lazy)."""
    from concurrent.futures import ThreadPoolExecutor

    def get(t):
        path = os.path.join(cache, t.strftime("%Y%m%d%H%M") + ".png")
        if not os.path.exists(path):
            url = (
                "https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q-t.cgi?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap"
                f"&LAYERS=nexrad-n0q-wmst&STYLES=&TIME={t.strftime('%Y-%m-%dT%H:%M:00Z')}&SRS=EPSG:4326"
                f"&BBOX={BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}&WIDTH={W}&HEIGHT={H}&FORMAT=image/png&TRANSPARENT=true"
            )
            for attempt in range(3):
                try:
                    body = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60).read()
                    open(path, "wb").write(body)
                    return
                except Exception:
                    time.sleep(2 * (attempt + 1))

    os.makedirs(cache, exist_ok=True)
    with ThreadPoolExecutor(3) as ex:
        list(ex.map(get, times))


def at_point(g, dx=0.0, dy=0.0):
    y0, x0 = int(round(PY - dy)), int(round(PX - dx))
    box = g[max(0, y0 - BOX): y0 + BOX + 1, max(0, x0 - BOX): x0 + BOX + 1]
    return np.nanmax(box) if box.size and not np.all(np.isnan(box)) else -99.0


def motion(a, b):
    """Pixel shift (dx, dy) that moves a onto b (phase correlation)."""
    fa = np.nan_to_num(np.where(a >= MOTION_DBZ, a, 0))
    fb = np.nan_to_num(np.where(b >= MOTION_DBZ, b, 0))
    if fa.sum() == 0 or fb.sum() == 0:
        return None
    r = np.fft.ifft2(np.fft.fft2(fb) * np.conj(np.fft.fft2(fa)) / (np.abs(np.fft.fft2(fb) * np.conj(np.fft.fft2(fa))) + 1e-9))
    dy, dx = np.unravel_index(np.argmax(np.abs(r)), r.shape)
    if dy > H // 2: dy -= H
    if dx > W // 2: dx -= W
    return float(dx), float(dy)


def nowcast(t: datetime):
    """Predicted onset lead in minutes (None = no rain predicted within 90 min), already raining -> 0."""
    now, prev = frame(t), frame(t - timedelta(minutes=15))
    if at_point(now) >= RAIN_DBZ:
        return 0
    m = motion(prev, now)
    if m is None:
        return None
    vx, vy = m[0] / 15, m[1] / 15  # px per minute
    if abs(vx) > 3 or abs(vy) > 3:  # > ~180 km/h: a bad correlation, not a storm
        return None
    for lead in range(5, 95, 5):
        # Rain arrives at the point when the echo now upstream at -v*lead gets there.
        if at_point(now, vx * lead, vy * lead) >= RAIN_DBZ:  # samples the point minus v x lead
            return lead
    return None


def align(t):
    return t.replace(minute=t.minute - t.minute % 5, second=0, microsecond=0)


# ---- events and radar truth (also used by nowcast_blend_eval.py)
def events_from_asos(path):
    """Rain-onset hours (UTC) after >= 6 dry hours at any station, merged when within 3 h of each other."""
    cands, dry = set(), {}
    for r in csv.DictReader(open(path)):
        wet = r["p01i"] not in ("0.00", "M")
        st = r["station"]
        if wet and dry.get(st, 0) >= 6:
            cands.add(datetime.strptime(r["valid"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc).replace(minute=0))
        dry[st] = 0 if wet else dry.get(st, 0) + 1
    merged = []
    for e in sorted(cands):
        if not merged or e - merged[-1] > timedelta(hours=3):
            merged.append(e)
    return merged


def truth_onset(hour, verbose=True):
    """First radar frame in [hour-2h, hour+1h] with rain at the point after a fully dry hour; None if none."""
    t, t0, was_dry = hour - timedelta(hours=2), None, False
    while t <= hour + timedelta(hours=1):
        wet = at_point(frame(t)) >= RAIN_DBZ
        if wet and was_dry:
            t0 = t
            break
        was_dry = was_dry or not wet
        t += timedelta(minutes=5)
    if t0 is None:
        if verbose:
            print(f"{hour:%Y-%m-%d %H:%M}Z  no clean radar onset at the point; skipped")
        return None
    if any(at_point(frame(t0 - timedelta(minutes=m))) >= RAIN_DBZ for m in range(5, 65, 5)):
        if verbose:
            print(f"{t0:%Y-%m-%d %H:%M}Z  rain within the hour before onset (intermittent); skipped")
        return None
    return t0


def main():
    results, controls = [], []
    for hour in events_from_asos(asos_csv):
        _decoded.clear()
        prefetch([hour - timedelta(minutes=m) for m in range(-60, 4 * 60 + 25, 5)])  # hour-4h20m .. hour+1h
        t0 = truth_onset(hour)
        if t0 is None:
            continue
        row = [f"{t0:%Y-%m-%d %H:%M}Z"]
        for lead in (60, 45, 30, 15):
            p = nowcast(t0 - timedelta(minutes=lead))
            results.append((lead, p))
            row.append(f"T-{lead}: {'none' if p is None else str(p) + 'm'}")
        for back in (240, 210):
            c = nowcast(align(t0 - timedelta(minutes=back)))
            # A control is a false alarm if it predicts onset within 60 min (the real onset is 3.5-4 h away).
            controls.append(c is not None and c <= 60 and back - (c or 0) > 60)
        print("  ".join(row))

    print("\nSummary (predicted onset vs truth; error = predicted - actual lead)")
    for lead in (60, 45, 30, 15):
        ps = [p for l, p in results if l == lead]
        hits = [p for p in ps if p is not None and p <= lead + 30]
        errs = [p - lead for p in hits]
        print(
            f"  issued T-{lead:2}: n={len(ps):2}  detected={len(hits):2} ({100*len(hits)/max(1,len(ps)):3.0f}%)"
            + (f"  median error={np.median(errs):+.0f} min  |err|<=10 min: {sum(abs(e)<=10 for e in errs)}" if errs else "")
        )
    print(f"  dry controls: n={len(controls)}  false alarms (onset <= 60 min predicted, none came): {sum(controls)}")


if __name__ == "__main__":
    main()
