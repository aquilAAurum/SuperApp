/// <reference path="../pb_data/types.d.ts" />
// Contacts subapp (SA-2026-007): keep core_people in step with contacts_people and its contact points.
// Runs after a successful write (ops route or migration push), so the projection always reads committed
// data. core_people is written server-side; its version hook bumps the version, so phones catch up.
// JSVM handlers run in isolated VMs, so the logic lives in lib/contacts-core.js and is required per call.

onRecordAfterCreateSuccess((e) => {
  e.next();
  require(`${__hooks}/lib/contacts-core.js`).syncCorePerson(e.app, e.record.id);
}, "contacts_people");

onRecordAfterUpdateSuccess((e) => {
  e.next();
  require(`${__hooks}/lib/contacts-core.js`).syncCorePerson(e.app, e.record.id);
}, "contacts_people");

onRecordAfterCreateSuccess((e) => {
  e.next();
  require(`${__hooks}/lib/contacts-core.js`).syncCorePerson(e.app, e.record.getString("entity"));
}, "contacts_contact_points");

onRecordAfterUpdateSuccess((e) => {
  e.next();
  require(`${__hooks}/lib/contacts-core.js`).syncCorePerson(e.app, e.record.getString("entity"));
}, "contacts_contact_points");
