/// <reference path="../pb_data/types.d.ts" />
// Today home projections (SA-2026-009, ADR-011). After a successful write to a Contacts or EatWell
// collection, refresh the matching core_agenda item or core_glances card. Logic: lib/agenda-core.js.
// Ids are deterministic (md5 of owner + stable key), so repeated projections update one record.

onRecordAfterCreateSuccess((e) => {
  e.next();
  require(`${__hooks}/lib/agenda-core.js`).syncKeyDate(e.app, (s) => $security.md5(s), e.record.id, new Date(new Date().toDateString()));
}, "contacts_key_dates");

onRecordAfterUpdateSuccess((e) => {
  e.next();
  require(`${__hooks}/lib/agenda-core.js`).syncKeyDate(e.app, (s) => $security.md5(s), e.record.id, new Date(new Date().toDateString()));
}, "contacts_key_dates");

onRecordAfterCreateSuccess((e) => {
  e.next();
  require(`${__hooks}/lib/agenda-core.js`).syncReachOut(e.app, (s) => $security.md5(s), e.record.id);
}, "contacts_people");

onRecordAfterUpdateSuccess((e) => {
  e.next();
  require(`${__hooks}/lib/agenda-core.js`).syncReachOut(e.app, (s) => $security.md5(s), e.record.id);
}, "contacts_people");

// A logged touch moves the reach-out due date.
onRecordAfterCreateSuccess((e) => {
  e.next();
  const lib = require(`${__hooks}/lib/agenda-core.js`);
  const people = e.app.findRecordsByFilter("contacts_people", "entity = {:e}", "", 1, 0, { e: e.record.getString("entity") });
  if (people.length) lib.syncReachOut(e.app, (s) => $security.md5(s), people[0].id);
}, "contacts_interactions");

for (const c of ["eatwell_entries", "eatwell_water"]) {
  onRecordAfterCreateSuccess((e) => {
    e.next();
    require(`${__hooks}/lib/agenda-core.js`).syncEatwellDay(e.app, (s) => $security.md5(s), e.record.getString("owner"), e.record.getString("date"));
  }, c);
  onRecordAfterUpdateSuccess((e) => {
    e.next();
    require(`${__hooks}/lib/agenda-core.js`).syncEatwellDay(e.app, (s) => $security.md5(s), e.record.getString("owner"), e.record.getString("date"));
  }, c);
}

// Recurring dates roll forward: refresh every key date once a day, after midnight local time.
cronAdd("agenda_key_dates", "7 0 * * *", () => {
  const lib = require(`${__hooks}/lib/agenda-core.js`);
  const today = new Date(new Date().toDateString());
  for (let page = 0; ; page++) {
    const batch = $app.findRecordsByFilter("contacts_key_dates", "deleted = false", "id", 200, page * 200);
    if (batch.length === 0) break;
    for (const kd of batch) lib.syncKeyDate($app, (s) => $security.md5(s), kd.id, today);
  }
});
