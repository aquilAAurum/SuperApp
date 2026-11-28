#!/usr/bin/env python3
"""Builds data/fooddb.json (compact rows) from the TempoLife food dataset (CC-BY-4.0; mostly USDA
SR Legacy, public domain). Input is treated as untrusted data: every field is type-checked, names
are stripped of control characters and capped, numbers bounded. Run with `python3 -I`.

  npm pack tempo-food-db@1.0.0 && tar -xzf tempo-food-db-1.0.0.tgz
  python3 -I scripts/build-fooddb.py package/data/tempolife-foods.json data/fooddb.json

Row format: [name, kcal, protein_g, carbs_g, fat_g, fiber_g|null, sugar_g|null, sodium_mg|null], per 100 g.
"""
import json, re, sys

src, dst = sys.argv[1], sys.argv[2]
rows = json.load(open(src, encoding="utf-8"))
CTRL = re.compile(r"[\x00-\x1f\x7f]")

def num(v, hi):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v < 0 or v > hi:
        return None
    return round(float(v), 1)

out, seen = [], set()
for r in rows:
    if not isinstance(r, dict) or not isinstance(r.get("name"), str):
        continue
    name = CTRL.sub("", r["name"]).strip()[:120]
    if not name or name.lower() in seen:
        continue
    kcal = num(r.get("kcal_per_100g"), 1000)
    if kcal is None:
        continue
    salt = num(r.get("salt_g"), 100)
    brand = r.get("brand") if isinstance(r.get("brand"), str) else None
    if brand:
        name = f"{name} ({CTRL.sub('', brand).strip()[:40]})"
    seen.add(name.lower())
    out.append([name, round(kcal), num(r.get("protein_g"), 100) or 0, num(r.get("carbs_g"), 100) or 0, num(r.get("fat_g"), 100) or 0,
                num(r.get("fiber_g"), 100), num(r.get("sugar_g"), 100), None if salt is None else round(salt * 393.4)])

out.sort(key=lambda x: x[0].lower())
json.dump({"source": "TempoLife food dataset 1.0.0 (tempolife.app), CC-BY-4.0; USDA FoodData Central SR Legacy (public domain)", "rows": out},
          open(dst, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(len(out), "foods")
