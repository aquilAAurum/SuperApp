"""S-2: measure radar tile sizes and fetch times for a phone-sized viewport around a point.

Usage: python3 -I radar_sizes.py [lat lon]   (defaults to Milford, MA)
Prints one row per layer: tiles per frame, bytes per frame, median fetch time, and a 24-frame loop estimate.
Writes nothing; makes ~150 small requests, paced.
"""
import math
import statistics
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

UA = "Supra-weather/1.0 (self-hosted)"
LAT, LON = (float(sys.argv[1]), float(sys.argv[2])) if len(sys.argv) == 3 else (42.14, -71.52)


def tile_xy(lat, lon, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read()
            return r.status, len(body), time.perf_counter() - t
    except urllib.error.HTTPError as e:
        return e.code, 0, time.perf_counter() - t


def viewport(z):
    # A 412x915 CSS-px phone shows about 2 x 4 tiles of 256 px; add a 1-tile margin -> 4 x 6.
    cx, cy = tile_xy(LAT, LON, z)
    return [(x, y) for x in range(cx - 1, cx + 3) for y in range(cy - 2, cy + 4)]


def five_min_ago(minutes):
    t = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    return t.replace(minute=t.minute - t.minute % 5, second=0, microsecond=0)


IEM = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0"
stamp = five_min_ago(15).strftime("%Y%m%d%H%M")
LAYERS = {
    "IEM NEXRAD composite (now)": lambda z, x, y: f"{IEM}/nexrad-n0q-900913/{z}/{x}/{y}.png",
    f"IEM composite at {stamp}Z (archive frame)": lambda z, x, y: f"{IEM}/ridge::USCOMP-N0Q-{stamp}/{z}/{x}/{y}.png",
    "IEM HRRR reflectivity +60 min": lambda z, x, y: f"{IEM}/hrrr::REFD-F0060-0/{z}/{x}/{y}.png",
    "OpenFreeMap base (vector .pbf)": None,  # measured separately below
}

for z in (6, 7, 8):
    tiles = viewport(z)
    for name, make in LAYERS.items():
        if make is None:
            continue
        sizes, times, codes = [], [], set()
        for x, y in tiles:
            code, size, dt = fetch(make(z, x, y))
            codes.add(code)
            sizes.append(size)
            times.append(dt)
            time.sleep(0.05)
        frame = sum(sizes)
        print(
            f"z{z} {name:42} tiles={len(tiles)} codes={sorted(codes)} frame={frame/1024:7.1f} KiB "
            f"median={statistics.median(times)*1000:5.0f} ms  24-frame loop={frame*24/1024/1024:5.2f} MiB"
        )

# Base map: OpenFreeMap vector tiles (one-time per viewport, cacheable for weeks).
import json

style = json.load(urllib.request.urlopen(urllib.request.Request("https://tiles.openfreemap.org/styles/liberty", headers={"User-Agent": UA})))
src = next(s for s in style["sources"].values() if "url" in s)
tj = json.load(urllib.request.urlopen(urllib.request.Request(src["url"], headers={"User-Agent": UA})))
tmpl = tj["tiles"][0]
for z in (7, 8):
    sizes = [fetch(tmpl.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y)))[1] for x, y in viewport(z)]
    print(f"z{z} OpenFreeMap base vector tiles={len(sizes)} total={sum(sizes)/1024:7.1f} KiB (cached once)")
