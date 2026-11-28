/// <reference path="../pb_data/types.d.ts" />
// Today home projections (SA-2026-009, ADR-011). After a successful write to a Contacts or EatWell
// collection, refresh the matching core_agenda item or core_glances card. Logic: lib/agenda-core.js.
// Ids are deterministic (md5 of owner + stable key), so repeated projections update one record.

onRecordAfterCreateSuccess((e) => {
  e.next();
  const lib = require(`${__hooks}/lib/agenda-core.js`);
  lib.guarded("syncKeyDate", () => lib.syncKeyDate(e.app, (s) => $security.md5(s), e.record.id, new Date(new Date().toDateString())));
}, "contacts_key_dates");

onRecordAfterUpdateSuccess((e) => {
  e.next();
  const lib = require(`${__hooks}/lib/agenda-core.js`);
  lib.guarded("syncKeyDate", () => lib.syncKeyDate(e.app, (s) => $security.md5(s), e.record.id, new Date(new Date().toDateString())));
}, "contacts_key_dates");

onRecordAfterCreateSuccess((e) => {
  e.next();
  const lib = require(`${__hooks}/lib/agenda-core.js`);
  lib.guarded("syncReachOut", () => lib.syncReachOut(e.app, (s) => $security.md5(s), e.record.id));
}, "contacts_people");

onRecordAfterUpdateSuccess((e) => {
  e.next();
  const lib = require(`${__hooks}/lib/agenda-core.js`);
  lib.guarded("syncReachOut", () => lib.syncReachOut(e.app, (s) => $security.md5(s), e.record.id));
}, "contacts_people");

// A logged touch moves the reach-out due date.
onRecordAfterCreateSuccess((e) => {
  e.next();
  const lib = require(`${__hooks}/lib/agenda-core.js`);
  lib.guarded("syncReachOut", () => {
    const people = e.app.findRecordsByFilter("contacts_people", "entity = {:e}", "", 1, 0, { e: e.record.getString("entity") });
    if (people.length) lib.syncReachOut(e.app, (s) => $security.md5(s), people[0].id);
  });
}, "contacts_interactions");

for (const c of ["eatwell_entries", "eatwell_water"]) {
  onRecordAfterCreateSuccess((e) => {
    e.next();
    const lib = require(`${__hooks}/lib/agenda-core.js`);
    lib.guarded("syncEatwellDay", () => lib.syncEatwellDay(e.app, (s) => $security.md5(s), e.record.getString("owner"), e.record.getString("date")));
  }, c);
  onRecordAfterUpdateSuccess((e) => {
    e.next();
    const lib = require(`${__hooks}/lib/agenda-core.js`);
    lib.guarded("syncEatwellDay", () => lib.syncEatwellDay(e.app, (s) => $security.md5(s), e.record.getString("owner"), e.record.getString("date")));
  }, c);
}

// Full rebuild: on every server start (fills Today from data that predates it or came from a
// restore), nightly after midnight local time (recurring dates roll forward), and on demand.
// Handlers cannot see top-level functions in this file (JSVM isolation), so the logic is in lib.
onServe((e) => {
  require(`${__hooks}/lib/agenda-core.js`).rebuildLogged(e.app, (s) => $security.md5(s), "startup");
  return e.next();
});

cronAdd("agenda_rebuild", "7 0 * * *", () => {
  require(`${__hooks}/lib/agenda-core.js`).rebuildLogged($app, (s) => $security.md5(s), "nightly");
});

// Rebuild now (superuser only): used by tests and after a manual import.
routerAdd(
  "POST",
  "/api/sa/agenda/rebuild",
  (e) => e.json(200, require(`${__hooks}/lib/agenda-core.js`).rebuildLogged(e.app, (s) => $security.md5(s), "manual") || {}),
  $apis.requireSuperuserAuth(),
);
