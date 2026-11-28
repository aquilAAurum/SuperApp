/// <reference path="../pb_data/types.d.ts" />
// Today home (SA-2026-009, ADR-011): two core collections every app can contribute to.
//   core_agenda   anything time-bound: events, tasks, reminders, focus blocks, dates.
//   core_glances  one small summary card per app (and key) per day.
// Synced-collection conventions apply (written only through /api/sa/ops or by server projections).
// Ownership between apps (an app only writes items whose source_app is its own id) is enforced by the
// shell's data handlers; projections from Contacts and EatWell are written by server hooks.
migrate(
  (app) => {
    const OWNER = "@request.auth.id != '' && owner = @request.auth.id";
    const users = app.findCollectionByNameOrId("users");
    const devices = app.findCollectionByNameOrId("core_devices");
    const people = app.findCollectionByNameOrId("core_people");
    const WHEN = "^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,3})?)?(Z|[+-]\\d{2}:\\d{2})?)?$";
    const DATE = "^\\d{4}-\\d{2}-\\d{2}$";
    const APP = "^[a-z][a-z0-9]{1,31}$";
    const tail = [
      { name: "version", type: "number", required: true, onlyInt: true, min: 1 },
      { name: "deleted", type: "bool" },
      { name: "owner", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
      { name: "origin_device", type: "relation", collectionId: devices.id, maxSelect: 1, cascadeDelete: false },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ];
    const synced = (name, fields, indexes) =>
      new Collection({
        type: "base",
        name,
        listRule: OWNER,
        viewRule: OWNER,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [...fields, ...tail],
        indexes: [`CREATE INDEX idx_${name}_owner_updated ON ${name} (owner, updated)`, ...indexes],
      });

    app.save(
      synced(
        "core_agenda",
        [
          { name: "kind", type: "select", required: true, maxSelect: 1, values: ["event", "task", "reminder", "focus", "date"] },
          { name: "title", type: "text", required: true, max: 200 },
          // Local date (all-day) or local date-time; end optional.
          { name: "start", type: "text", required: true, max: 40, pattern: WHEN },
          { name: "end", type: "text", max: 40, pattern: "^$|" + WHEN.slice(1) },
          { name: "all_day", type: "bool" },
          { name: "status", type: "select", maxSelect: 1, values: ["open", "done", "skipped"] },
          { name: "priority", type: "number", onlyInt: true, min: 0, max: 3 },
          { name: "source_app", type: "text", required: true, max: 32, pattern: APP },
          // Stable key for projections and imports (e.g. "contacts:key_date:<id>"); empty for hand-made items.
          { name: "source_key", type: "text", max: 120 },
          { name: "deep_link", type: "text", max: 512, pattern: "^$|^superapp://" },
          { name: "person", type: "relation", collectionId: people.id, maxSelect: 1, cascadeDelete: false },
          { name: "notes", type: "text", max: 2000 },
        ],
        ["CREATE INDEX idx_core_agenda_owner_start ON core_agenda (owner, start)"],
      ),
    );

    app.save(
      synced(
        "core_glances",
        [
          { name: "app_id", type: "text", required: true, max: 32, pattern: APP },
          { name: "key", type: "text", required: true, max: 40, pattern: "^[a-z][a-z0-9_]{0,39}$" },
          { name: "date", type: "text", required: true, max: 10, pattern: DATE },
          { name: "title", type: "text", required: true, max: 60 },
          { name: "value", type: "number" },
          { name: "unit", type: "text", max: 20 },
          { name: "target", type: "number" },
          { name: "detail", type: "text", max: 120 },
          { name: "deep_link", type: "text", max: 512, pattern: "^$|^superapp://" },
        ],
        ["CREATE UNIQUE INDEX idx_core_glances_slot ON core_glances (owner, app_id, key, date)"],
      ),
    );
  },
  (app) => {
    for (const name of ["core_glances", "core_agenda"]) app.delete(app.findCollectionByNameOrId(name));
  },
);
