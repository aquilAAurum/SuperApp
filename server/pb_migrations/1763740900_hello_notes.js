/// <reference path="../pb_data/types.d.ts" />
// Collection for the `hello` reference subapp (app-owned collections are prefixed with the app id).
// Synced-collection conventions apply, so it is written only through POST /api/sa/ops.
migrate(
  (app) => {
    const OWNER = "@request.auth.id != '' && owner = @request.auth.id";
    const users = app.findCollectionByNameOrId("users");
    const devices = app.findCollectionByNameOrId("core_devices");
    app.save(
      new Collection({
        type: "base",
        name: "hello_notes",
        listRule: OWNER,
        viewRule: OWNER,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          { name: "text", type: "text", required: true, max: 200 },
          { name: "n", type: "number" },
          { name: "version", type: "number", required: true, onlyInt: true, min: 1 },
          { name: "deleted", type: "bool" },
          { name: "owner", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
          { name: "origin_device", type: "relation", collectionId: devices.id, maxSelect: 1, cascadeDelete: false },
          { name: "created", type: "autodate", onCreate: true, onUpdate: false },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
        indexes: ["CREATE INDEX idx_hello_notes_owner_updated ON hello_notes (owner, updated)"],
      }),
    );
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId("hello_notes"));
  },
);
