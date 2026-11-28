/// <reference path="../pb_data/types.d.ts" />
// Published subapps (ADR-009): every minute, import new bundles from the inbox folder into the
// `subapps` collection. The inbox is a copy of the repo's published/ folder that the mini PC pulls
// (tools/sync-subapps.ps1). Default location: <PocketBase dir>/subapps_inbox, next to pb_hooks;
// override with SUPRA_SUBAPPS_INBOX. Phones pull from the collection (apps/shell/src/host/updates.ts).

cronAdd("subapps_import", "* * * * *", () => {
  require(`${__hooks}/lib/subapps.js`).importFromInbox();
});

// Import now (superuser only): used by tests and after a manual sync.
routerAdd(
  "POST",
  "/api/sa/subapps/import",
  (e) => e.json(200, require(`${__hooks}/lib/subapps.js`).importFromInbox()),
  $apis.requireSuperuserAuth(),
);
