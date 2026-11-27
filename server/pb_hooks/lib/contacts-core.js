// Contacts → core_people projection (SA-2026-007 §4.4.0). Plain CommonJS with no PocketBase globals,
// so it runs in the JSVM and in Node unit tests.
//
// Every contacts_people record has a core_people twin with the same id, so other subapps can read
// contacts through `core.people.read` without knowing about the Contacts app.

var PHONE_CHANNELS = { phone: "phone", google_voice: "gvoice", whatsapp: "whatsapp" };

/**
 * person: { id, display_name, deleted }
 * points: [{ channel, value_norm, label, is_primary, is_valid, deleted }]
 * → the core_people fields: { displayName, phones, emails, sourceIds, deleted }
 */
function project(person, points) {
  var phones = [];
  var emails = [];
  var seen = {};
  var sorted = (points || []).slice().sort(function (a, b) {
    return (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0) || String(a.value_norm).localeCompare(String(b.value_norm));
  });
  for (var i = 0; i < sorted.length; i++) {
    var p = sorted[i];
    if (!p || p.deleted || !p.is_valid) continue;
    var key = p.channel + "|" + p.value_norm;
    if (seen[key]) continue;
    seen[key] = true;
    if (PHONE_CHANNELS[p.channel]) {
      phones.push({ e164: p.value_norm, type: PHONE_CHANNELS[p.channel], label: p.label || null, primary: !!p.is_primary });
    } else if (p.channel === "email") {
      emails.push({ address: p.value_norm, label: p.label || null, primary: !!p.is_primary });
    }
  }
  return {
    displayName: String(person.display_name || "").slice(0, 200),
    phones: phones,
    emails: emails,
    sourceIds: { contacts: person.id },
    deleted: !!person.deleted,
  };
}

/** True when the core_people record (plain object) already matches the projection. */
function same(core, want) {
  if (!core) return false;
  return (
    core.displayName === want.displayName &&
    !!core.deleted === want.deleted &&
    JSON.stringify(core.phones || []) === JSON.stringify(want.phones) &&
    JSON.stringify(core.emails || []) === JSON.stringify(want.emails) &&
    JSON.stringify(core.sourceIds || {}) === JSON.stringify(want.sourceIds)
  );
}

/** JSVM only (uses `Record`): upsert the core_people twin of contacts_people/<id>. */
function syncCorePerson(app, id) {
  let person;
  try {
    person = app.findRecordById("contacts_people", id);
  } catch (_) {
    return;
  }
  const points = app
    .findRecordsByFilter("contacts_contact_points", "entity = {:e}", "", 500, 0, { e: person.getString("entity") })
    .map((r) => JSON.parse(JSON.stringify(r.publicExport())));
  const want = project({ id: id, display_name: person.getString("display_name"), deleted: person.getBool("deleted") }, points);

  let core;
  try {
    core = app.findRecordById("core_people", id);
  } catch (_) {
    core = null;
  }
  if (!core && want.deleted) return;
  const current = core ? JSON.parse(JSON.stringify(core.publicExport())) : null;
  if (!same(current, want)) {
    if (!core) {
      core = new Record(app.findCollectionByNameOrId("core_people"));
      core.set("id", id);
      core.set("owner", person.getString("owner"));
    }
    core.set("displayName", want.displayName || "(no name)");
    core.set("phones", want.phones);
    core.set("emails", want.emails);
    core.set("sourceIds", want.sourceIds);
    core.set("deleted", want.deleted);
    app.save(core);
  }
  if (!want.deleted && person.getString("core_person") !== id) {
    person.set("core_person", id);
    app.save(person); // re-enters this hook once; nothing left to change, so it stops
  }
}

module.exports = { project: project, same: same, syncCorePerson: syncCorePerson };
