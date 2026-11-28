/// <reference path="../pb_data/types.d.ts" />
// ADR-009: subapp bundles are downloaded by the phone with a short-lived file token. Making the
// `bundle` file field protected means a zip URL alone (without the owner's token) returns 404.
migrate(
  (app) => {
    const c = app.findCollectionByNameOrId("subapps");
    c.fields.getByName("bundle").protected = true;
    app.save(c);
  },
  (app) => {
    const c = app.findCollectionByNameOrId("subapps");
    c.fields.getByName("bundle").protected = false;
    app.save(c);
  },
);
