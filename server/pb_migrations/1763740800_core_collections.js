/// <reference path="../pb_data/types.d.ts" />
// Core schema v1 (spec §Data layer). Conventions for synced collections:
//   id generated on device (15 chars a-z0-9) · version (server-bumped) · deleted (soft) · owner ·
//   origin_device · created/updated autodate.
// Synced collections are written ONLY through POST /api/sa/ops (pb_hooks/ops.pb.js), which enforces
// baseVersion and opId idempotency, so their create/update/delete API rules are null (superuser only).

migrate(
  (app) => {
    // Declared inside the callback: JSVM migration callbacks must not rely on module scope.
    const OWNER = "@request.auth.id != '' && owner = @request.auth.id";
    const OWNER_CREATE = "@request.auth.id != '' && @request.body.owner = @request.auth.id";
    const OWNER_UPDATE = "@request.auth.id != '' && owner = @request.auth.id && (@request.body.owner:isset = false || @request.body.owner = @request.auth.id)";
    const users = app.findCollectionByNameOrId("users");
    const autodates = [
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ];
    const owner = { name: "owner", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false };

    // Every shell install (phone now, TV/car later). Written directly by the shell (owner rules).
    const devices = new Collection({
      type: "base",
      name: "core_devices",
      listRule: OWNER,
      viewRule: OWNER,
      createRule: OWNER_CREATE,
      updateRule: OWNER_UPDATE,
      deleteRule: OWNER,
      fields: [
        { name: "name", type: "text", required: true, max: 100 },
        { name: "kind", type: "select", required: true, maxSelect: 1, values: ["phone", "tablet", "tv", "car", "desktop"] },
        { name: "formFactor", type: "select", required: true, maxSelect: 1, values: ["phone", "tablet", "tv", "car", "desktop"] },
        { name: "shellVersion", type: "text", max: 32 },
        { name: "capabilities", type: "json", maxSize: 20000 },
        { name: "lastSeen", type: "date" },
        { name: "pushTopic", type: "text", max: 200 },
        owner,
        ...autodates,
      ],
      indexes: ["CREATE INDEX idx_core_devices_owner ON core_devices (owner)"],
    });
    app.save(devices);

    const synced = (name, fields, extraIndexes = []) =>
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
          owner,
          { name: "origin_device", type: "relation", collectionId: devices.id, maxSelect: 1, cascadeDelete: false },
          ...autodates,
        ],
        indexes: [`CREATE INDEX idx_${name}_owner_updated ON ${name} (owner, updated)`, ...extraIndexes],
      });

    app.save(
      synced("core_people", [
        { name: "displayName", type: "text", required: true, max: 200 },
        { name: "phones", type: "json", maxSize: 20000 },
        { name: "emails", type: "json", maxSize: 20000 },
        { name: "sourceIds", type: "json", maxSize: 20000 },
        { name: "tags", type: "json", maxSize: 20000 },
      ]),
    );
    app.save(synced("core_tags", [{ name: "name", type: "text", required: true, max: 100 }, { name: "color", type: "text", max: 32 }]));
    app.save(
      synced("core_files", [
        { name: "file", type: "file", maxSelect: 1, maxSize: 52428800, protected: true },
        { name: "mime", type: "text", max: 200 },
        { name: "size", type: "number", onlyInt: true, min: 0 },
        { name: "sha256", type: "text", max: 64, pattern: "^[0-9a-f]{64}$" },
        { name: "tags", type: "json", maxSize: 20000 },
        { name: "sourceApp", type: "text", max: 32 },
      ]),
    );
    app.save(
      synced(
        "core_settings",
        [
          { name: "scope", type: "text", required: true, max: 32 },
          { name: "key", type: "text", required: true, max: 200 },
          { name: "value", type: "json", maxSize: 200000 },
        ],
        ["CREATE UNIQUE INDEX idx_core_settings_key ON core_settings (owner, scope, key)"],
      ),
    );
    app.save(
      synced("core_notifications", [
        { name: "appId", type: "text", required: true, max: 32 },
        { name: "title", type: "text", required: true, max: 120 },
        { name: "body", type: "text", max: 1000 },
        { name: "deepLink", type: "text", max: 512 },
        { name: "readAt", type: "date" },
        { name: "targetDevice", type: "relation", collectionId: devices.id, maxSelect: 1, cascadeDelete: false },
      ]),
    );
    app.save(
      synced("core_messages", [
        { name: "from", type: "relation", required: true, collectionId: devices.id, maxSelect: 1, cascadeDelete: false },
        { name: "to", type: "text", required: true, max: 15 },
        { name: "topic", type: "text", required: true, max: 128 },
        { name: "payload", type: "json", maxSize: 65536 },
        { name: "expiresAt", type: "date", required: true },
        { name: "deliveredAt", type: "date" },
      ]),
    );
    app.save(
      synced("core_external_apps", [
        { name: "name", type: "text", required: true, max: 100 },
        { name: "icon", type: "file", maxSelect: 1, maxSize: 1048576, mimeTypes: ["image/png", "image/webp", "image/svg+xml"] },
        { name: "packages", type: "json", maxSize: 20000 },
        { name: "linkTemplates", type: "json", maxSize: 20000 },
      ]),
    );

    // Server-held integration tokens. No client API access at all; only hooks read `secret`.
    app.save(
      new Collection({
        type: "base",
        name: "core_integrations",
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          { name: "kind", type: "select", required: true, maxSelect: 1, values: ["homeassistant", "jellyfin", "anthropic", "ntfy"] },
          { name: "baseUrl", type: "url" },
          { name: "secret", type: "text", hidden: true, max: 4096 },
          ...autodates,
        ],
        indexes: ["CREATE UNIQUE INDEX idx_core_integrations_kind ON core_integrations (kind)"],
      }),
    );

    // Published subapp bundles: read-only to clients, uploaded by the owner via admin UI or tools/.
    app.save(
      new Collection({
        type: "base",
        name: "subapps",
        listRule: "@request.auth.id != ''",
        viewRule: "@request.auth.id != ''",
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          { name: "appId", type: "text", required: true, max: 32, pattern: "^[a-z][a-z0-9]{1,31}$" },
          { name: "version", type: "text", required: true, max: 64 },
          { name: "manifest", type: "json", required: true, maxSize: 65536 },
          { name: "bundle", type: "file", required: true, maxSelect: 1, maxSize: 52428800, mimeTypes: ["application/zip"] },
          { name: "sha256", type: "text", required: true, max: 64, pattern: "^[0-9a-f]{64}$" },
          { name: "channel", type: "select", maxSelect: 1, values: ["stable", "beta", "dev"] },
          ...autodates,
        ],
        indexes: ["CREATE UNIQUE INDEX idx_subapps_app_version ON subapps (appId, version)"],
      }),
    );

    app.save(
      new Collection({
        type: "base",
        name: "grants",
        listRule: OWNER,
        viewRule: OWNER,
        createRule: OWNER_CREATE,
        updateRule: OWNER_UPDATE,
        deleteRule: OWNER,
        fields: [
          { name: "device", type: "relation", required: true, collectionId: devices.id, maxSelect: 1, cascadeDelete: true },
          { name: "appId", type: "text", required: true, max: 32 },
          { name: "scope", type: "text", required: true, max: 128 },
          { name: "decision", type: "select", required: true, maxSelect: 1, values: ["allow", "allow_once", "deny"] },
          { name: "decidedAt", type: "date", required: true },
          owner,
          ...autodates,
        ],
        indexes: ["CREATE UNIQUE INDEX idx_grants_unique ON grants (device, appId, scope)"],
      }),
    );

    app.save(
      new Collection({
        type: "base",
        name: "diagnostics",
        listRule: OWNER,
        viewRule: OWNER,
        createRule: OWNER_CREATE,
        updateRule: null,
        deleteRule: OWNER,
        fields: [
          { name: "device", type: "relation", required: true, collectionId: devices.id, maxSelect: 1, cascadeDelete: true },
          { name: "file", type: "file", maxSelect: 1, maxSize: 20971520, protected: true, mimeTypes: ["application/zip"] },
          { name: "summary", type: "text", max: 5000 },
          owner,
          ...autodates,
        ],
      }),
    );

    // Idempotency ledger for /api/sa/ops (kept 30 days).
    app.save(
      new Collection({
        type: "base",
        name: "processed_ops",
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          { name: "opId", type: "text", required: true, min: 8, max: 64, pattern: "^[A-Za-z0-9-]+$" },
          { name: "owner", type: "text", required: true, max: 15 },
          { name: "collectionName", type: "text", required: true, max: 64 },
          { name: "recordId", type: "text", required: true, max: 15 },
          { name: "status", type: "number", required: true, onlyInt: true },
          { name: "result", type: "text", max: 2000000 },
          ...autodates,
        ],
        indexes: ["CREATE UNIQUE INDEX idx_processed_ops_opid ON processed_ops (opId)", "CREATE INDEX idx_processed_ops_created ON processed_ops (created)"],
      }),
    );

    const schemaInfo = new Collection({
      type: "base",
      name: "schema_info",
      listRule: "@request.auth.id != ''",
      viewRule: "@request.auth.id != ''",
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: "version", type: "number", required: true, onlyInt: true, min: 1 },
        { name: "appliedAt", type: "date", required: true },
      ],
    });
    app.save(schemaInfo);
    const info = new Record(schemaInfo);
    info.set("version", 1);
    info.set("appliedAt", new Date().toISOString());
    app.save(info);
  },
  (app) => {
    for (const name of [
      "schema_info",
      "processed_ops",
      "diagnostics",
      "grants",
      "subapps",
      "core_integrations",
      "core_external_apps",
      "core_messages",
      "core_notifications",
      "core_settings",
      "core_files",
      "core_tags",
      "core_people",
      "core_devices",
    ]) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
);
