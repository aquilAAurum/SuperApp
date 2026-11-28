/// <reference path="../pb_data/types.d.ts" />
// EatWell subapp (SA-2026-008): food diary, own foods, weight, water and goals. App-owned collections
// are prefixed `eatwell_`, carry the synced-collection conventions (version / deleted / owner /
// origin_device) and are written ONLY through POST /api/sa/ops (create/update/delete rules null).
// Dates are the owner's local calendar day as `YYYY-MM-DD`; amounts are metric (kg, cm, ml, g, kcal)
// and converted for display on the phone. Health Connect readings are NOT stored here (ADR-010):
// they are read live on the phone; only what the owner logs in EatWell is synced.
migrate(
  (app) => {
    const OWNER = "@request.auth.id != '' && owner = @request.auth.id";
    const users = app.findCollectionByNameOrId("users");
    const devices = app.findCollectionByNameOrId("core_devices");
    const DATE = "^\\d{4}-\\d{2}-\\d{2}$";
    const MEALS = ["breakfast", "lunch", "dinner", "snack"];

    const synced = (name, fields, indexes) =>
      new Collection({
        type: "base",
        name,
        listRule: OWNER,
        viewRule: OWNER,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          ...fields,
          { name: "version", type: "number", required: true, onlyInt: true, min: 1 },
          { name: "deleted", type: "bool" },
          { name: "owner", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
          { name: "origin_device", type: "relation", collectionId: devices.id, maxSelect: 1, cascadeDelete: false },
          { name: "created", type: "autodate", onCreate: true, onUpdate: false },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
        indexes: [`CREATE INDEX idx_${name}_owner_updated ON ${name} (owner, updated)`, ...(indexes || [])],
      });

    // Nutrient amounts shared by diary entries (totals for the servings eaten) and foods (per serving).
    const nutrients = [
      { name: "kcal", type: "number", required: false, min: 0, max: 20000 },
      { name: "protein_g", type: "number", min: 0, max: 2000 },
      { name: "carbs_g", type: "number", min: 0, max: 2000 },
      { name: "fat_g", type: "number", min: 0, max: 2000 },
      { name: "fiber_g", type: "number", min: 0, max: 1000 },
      { name: "sugar_g", type: "number", min: 0, max: 2000 },
      { name: "sodium_mg", type: "number", min: 0, max: 100000 },
    ];

    app.save(
      synced(
        "eatwell_entries",
        [
          { name: "date", type: "text", required: true, pattern: DATE, max: 10 },
          { name: "meal", type: "select", required: true, maxSelect: 1, values: MEALS },
          { name: "name", type: "text", required: true, max: 120 },
          { name: "brand", type: "text", max: 80 },
          { name: "servings", type: "number", min: 0, max: 100 },
          { name: "serving_label", type: "text", max: 60 },
          // Builtin food key (e.g. "b:oats") or an eatwell_foods id; empty for quick-add calories.
          { name: "food_ref", type: "text", max: 40 },
          { name: "logged_at", type: "text", max: 40 },
          ...nutrients,
        ],
        ["CREATE INDEX idx_eatwell_entries_owner_date ON eatwell_entries (owner, date)"],
      ),
    );

    app.save(
      synced("eatwell_foods", [
        { name: "name", type: "text", required: true, max: 120 },
        { name: "brand", type: "text", max: 80 },
        { name: "serving_label", type: "text", max: 60 },
        { name: "favorite", type: "bool" },
        // Builtin key when this row only marks a builtin food as a favorite (no own nutrients).
        { name: "builtin_ref", type: "text", max: 40 },
        ...nutrients,
      ]),
    );

    app.save(
      synced(
        "eatwell_weights",
        [
          { name: "date", type: "text", required: true, pattern: DATE, max: 10 },
          { name: "kg", type: "number", required: true, min: 1, max: 1000 },
        ],
        ["CREATE INDEX idx_eatwell_weights_owner_date ON eatwell_weights (owner, date)"],
      ),
    );

    app.save(
      synced("eatwell_water", [
        { name: "date", type: "text", required: true, pattern: DATE, max: 10 },
        { name: "ml", type: "number", required: true, min: 1, max: 10000 },
        { name: "logged_at", type: "text", max: 40 },
      ]),
    );

    app.save(
      synced("eatwell_settings", [
        { name: "units", type: "select", maxSelect: 1, values: ["imperial", "metric"] },
        { name: "sex", type: "select", maxSelect: 1, values: ["male", "female"] },
        { name: "birth_year", type: "number", onlyInt: true, min: 1900, max: 2100 },
        { name: "height_cm", type: "number", min: 50, max: 260 },
        { name: "activity", type: "select", maxSelect: 1, values: ["sedentary", "light", "moderate", "very", "extra"] },
        { name: "goal_kg", type: "number", min: 1, max: 1000 },
        // Weekly change: negative loses, positive gains (kg / week).
        { name: "rate_kg_week", type: "number", min: -1.5, max: 1 },
        { name: "budget_override", type: "number", onlyInt: true, min: 0, max: 10000 },
        { name: "protein_pct", type: "number", onlyInt: true, min: 5, max: 70 },
        { name: "carbs_pct", type: "number", onlyInt: true, min: 5, max: 80 },
        { name: "fat_pct", type: "number", onlyInt: true, min: 5, max: 70 },
        { name: "water_goal_ml", type: "number", onlyInt: true, min: 0, max: 10000 },
        { name: "exercise_adds", type: "bool" },
        { name: "hc_write", type: "bool" },
        { name: "gentle_mode", type: "bool" },
      ]),
    );
  },
  (app) => {
    for (const name of ["eatwell_settings", "eatwell_water", "eatwell_weights", "eatwell_foods", "eatwell_entries"]) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
);
