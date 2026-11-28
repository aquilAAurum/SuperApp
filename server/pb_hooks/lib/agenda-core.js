// Today home projections (SA-2026-009, ADR-011): Contacts and EatWell → core_agenda / core_glances.
// Plain CommonJS with no PocketBase globals (runs in the JSVM and in Node unit tests); the PocketBase
// adapter at the bottom takes `app` and a `hash` function as arguments.

var DAY = 86400000;

function pad(n) {
  return (n < 10 ? "0" : "") + n;
}

function ymd(d) {
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function parseYmd(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Next occurrence (on or after `today`) of a key date, or null when a one-off date has passed. */
function nextOccurrence(kd, today) {
  var month = Number(kd.month);
  var day = Number(kd.day);
  if (!month || !day) return null;
  if (!kd.recurring) {
    if (!kd.year) return null;
    var once = new Date(Number(kd.year), month - 1, day);
    return once >= today ? once : null;
  }
  var y = today.getFullYear();
  for (var i = 0; i < 2; i++) {
    var d = new Date(y + i, month - 1, day);
    // 29 Feb in a non-leap year rolls to 1 Mar in JS; keep it on 28 Feb instead.
    if (d.getMonth() !== month - 1) d = new Date(y + i, month - 1, day - 1);
    if (d >= today) return d;
  }
  return null;
}

var KEY_DATE_LABEL = { birthday: "Birthday", anniversary: "Anniversary", met_on: "Met", follow_up: "Follow up" };

/**
 * kd: { id, kind, label, year, month, day, recurring, deleted }, person: { id, display_name } | null
 * → core_agenda fields, or null when the item should not (or no longer) exist.
 */
function keyDateItem(kd, person, today) {
  if (!kd || kd.deleted) return null;
  var when = nextOccurrence(kd, today);
  if (!when) return null;
  var label = kd.label || KEY_DATE_LABEL[kd.kind] || String(kd.kind || "Date").replace(/_/g, " ");
  var name = person && person.display_name ? person.display_name : "";
  var title = name ? label + ": " + name : label;
  if (kd.recurring && kd.year && /birthday|anniversary/i.test(String(kd.kind))) {
    title += " (" + (when.getFullYear() - Number(kd.year)) + ")";
  }
  return {
    kind: "date",
    title: title.slice(0, 200),
    start: ymd(when),
    end: "",
    all_day: true,
    status: "open",
    priority: 0,
    source_app: "contacts",
    source_key: "contacts:key_date:" + kd.id,
    deep_link: person ? "superapp://contacts/person/" + person.id : "superapp://contacts/",
    person: person ? person.id : "",
    notes: "",
  };
}

/**
 * The contacts_reach_out view's due date, computed in JS so hooks need not query the view:
 * next_touch if set, else (latest of last_touch and the newest logged interaction) + cadence_days.
 * person: { id, display_name, next_touch, last_touch, cadence_days }, lastInteraction: 'YYYY-MM-DD' | ''
 */
function reachRow(person, lastInteraction, isGhost) {
  var next = parseYmd(person.next_touch) ? person.next_touch : null;
  var last = [person.last_touch, lastInteraction].filter(function (d) {
    return !!parseYmd(d);
  }).sort().pop() || null;
  var due = next;
  var cadence = Number(person.cadence_days) || 0;
  if (!due && last && cadence > 0) {
    var d = parseYmd(last);
    due = ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + cadence));
  }
  return { id: person.id, display_name: person.display_name, due_on: due, is_ghost: !!isGhost };
}

/** row: a contacts_reach_out view row { id, display_name, due_on, is_ghost } → core_agenda fields or null. */
function reachOutItem(row) {
  if (!row || row.is_ghost || !parseYmd(row.due_on)) return null;
  return {
    kind: "task",
    title: ("Reach out to " + (row.display_name || "contact")).slice(0, 200),
    start: row.due_on,
    end: "",
    all_day: true,
    status: "open",
    priority: 1,
    source_app: "contacts",
    source_key: "contacts:reach_out:" + row.id,
    deep_link: "superapp://contacts/person/" + row.id,
    person: row.id,
    notes: "",
  };
}

/**
 * EatWell's daily glance. entries: [{ kcal, deleted }], water: [{ ml, deleted }], settings: { budget_override } | null
 */
function eatwellGlance(date, entries, water, settings) {
  var kcal = 0;
  var ml = 0;
  for (var i = 0; i < (entries || []).length; i++) if (!entries[i].deleted) kcal += Number(entries[i].kcal) || 0;
  for (var j = 0; j < (water || []).length; j++) if (!water[j].deleted) ml += Number(water[j].ml) || 0;
  var budget = settings && Number(settings.budget_override) > 0 ? Number(settings.budget_override) : null;
  return {
    app_id: "eatwell",
    key: "intake",
    date: date,
    title: "Eaten today",
    value: Math.round(kcal),
    unit: "kcal",
    target: budget,
    detail: ml > 0 ? (ml >= 1000 ? (ml / 1000).toFixed(1) + " L water" : ml + " ml water") : "No water logged",
    deep_link: "superapp://eatwell/",
  };
}

/** Deterministic 15-char id (a-z0-9) for a projected record, from its owner and stable key. */
function projectedId(hash, owner, key) {
  return String(hash(owner + "|" + key)).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15);
}

var AGENDA_FIELDS = ["kind", "title", "start", "end", "all_day", "status", "priority", "source_app", "source_key", "deep_link", "person", "notes"];
var GLANCE_FIELDS = ["app_id", "key", "date", "title", "value", "unit", "target", "detail", "deep_link"];

function differs(rec, want, fields) {
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var a = rec.get(f);
    var b = want[f];
    if (b === null || b === undefined) b = "";
    if (a === null || a === undefined) a = "";
    if (String(a) !== String(b)) return true;
  }
  return false;
}

// ---- PocketBase adapter (JSVM only) ----------------------------------------------------------

/**
 * The core_people id to link. Hooks run in file order (agenda.pb.js before contacts.pb.js), so on a
 * new contact the core_people twin may not exist yet: create it first (syncCorePerson is idempotent).
 * Returns "" if it still cannot be found.
 */
function personRef(app, id) {
  if (!id) return "";
  try {
    require(__hooks + "/lib/contacts-core.js").syncCorePerson(app, id);
  } catch (_) {
    // Linking is best-effort; the item is still projected without a person.
  }
  try {
    app.findRecordById("core_people", id);
    return id;
  } catch (_) {
    return "";
  }
}

/**
 * Runs a projection without ever failing the write that triggered it: Today is secondary to the
 * Contacts or EatWell save. Failures are logged as one JSON line (no record content).
 */
function guarded(name, fn) {
  try {
    fn();
  } catch (err) {
    console.log(JSON.stringify({ level: "error", msg: "agenda.projection_failed", projection: name, error: String(err).slice(0, 300) }));
  }
}

function upsert(app, collection, id, owner, want, fields) {
  var rec;
  try {
    rec = app.findRecordById(collection, id);
  } catch (_) {
    rec = null;
  }
  if (!want) {
    if (rec && !rec.getBool("deleted")) {
      rec.set("deleted", true);
      app.save(rec);
    }
    return;
  }
  if (rec && !rec.getBool("deleted") && !differs(rec, want, fields)) return;
  if (!rec) {
    rec = new Record(app.findCollectionByNameOrId(collection));
    rec.set("id", id);
    rec.set("owner", owner);
  }
  for (var i = 0; i < fields.length; i++) rec.set(fields[i], want[fields[i]] === null ? null : want[fields[i]]);
  rec.set("deleted", false);
  app.save(rec);
}

function syncKeyDate(app, hash, id, today) {
  var kd;
  try {
    kd = app.findRecordById("contacts_key_dates", id);
  } catch (_) {
    return;
  }
  var owner = kd.getString("owner");
  var person = null;
  var found = app.findRecordsByFilter("contacts_people", "entity = {:e} && deleted = false", "", 1, 0, { e: kd.getString("entity") });
  if (found.length) person = { id: found[0].id, display_name: found[0].getString("display_name") };
  var plain = JSON.parse(JSON.stringify(kd.publicExport()));
  var key = "contacts:key_date:" + id;
  var item = keyDateItem(plain, person, today);
  if (item) item.person = personRef(app, item.person);
  upsert(app, "core_agenda", projectedId(hash, owner, key), owner, item, AGENDA_FIELDS);
}

function syncReachOut(app, hash, personId) {
  var person;
  try {
    person = app.findRecordById("contacts_people", personId);
  } catch (_) {
    return;
  }
  var owner = person.getString("owner");
  var row = null;
  if (!person.getBool("deleted")) {
    var entity = person.getString("entity");
    var ghost;
    try {
      var ent = app.findRecordById("contacts_entities", entity);
      ghost = ent.getBool("is_ghost") || ent.getBool("deleted");
    } catch (_) {
      ghost = true;
    }
    var latest = app.findRecordsByFilter("contacts_interactions", "entity = {:e} && deleted = false && kind != 'Created'", "-occurred_on", 1, 0, { e: entity });
    row = reachRow(
      { id: personId, display_name: person.getString("display_name"), next_touch: person.getString("next_touch"), last_touch: person.getString("last_touch"), cadence_days: person.getInt("cadence_days") },
      latest.length ? latest[0].getString("occurred_on") : "",
      ghost,
    );
  }
  var key = "contacts:reach_out:" + personId;
  var item = reachOutItem(row);
  if (item) item.person = personRef(app, item.person);
  upsert(app, "core_agenda", projectedId(hash, owner, key), owner, item, AGENDA_FIELDS);
}

function syncEatwellDay(app, hash, owner, date) {
  if (!parseYmd(date)) return;
  var list = function (c) {
    return app.findRecordsByFilter(c, "owner = {:o} && date = {:d}", "", 2000, 0, { o: owner, d: date }).map(function (r) {
      return JSON.parse(JSON.stringify(r.publicExport()));
    });
  };
  var settings = null;
  var s = app.findRecordsByFilter("eatwell_settings", "owner = {:o} && deleted = false", "-updated", 1, 0, { o: owner });
  if (s.length) settings = JSON.parse(JSON.stringify(s[0].publicExport()));
  var want = eatwellGlance(date, list("eatwell_entries"), list("eatwell_water"), settings);
  upsert(app, "core_glances", projectedId(hash, owner, "eatwell:intake:" + date), owner, want, GLANCE_FIELDS);
}

/**
 * Rebuilds every projection from the source collections. Projections otherwise only follow writes,
 * so data that existed before Today shipped (or was restored from a backup) would never appear.
 * Idempotent: upsert skips records that already match. Each record is guarded on its own, so one
 * bad row cannot stop the rest. Returns counts for logs and the superuser endpoint.
 */
function rebuildAll(app, hash, today) {
  var counts = { keyDates: 0, people: 0, eatwellDays: 0 };
  var each = function (collection, filter, fn) {
    for (var page = 0; ; page++) {
      var batch = app.findRecordsByFilter(collection, filter, "id", 200, page * 200);
      if (batch.length === 0) break;
      for (var i = 0; i < batch.length; i++) fn(batch[i]);
      if (batch.length < 200) break;
    }
  };
  each("contacts_key_dates", "deleted = false", function (kd) {
    guarded("syncKeyDate", function () {
      syncKeyDate(app, hash, kd.id, today);
    });
    counts.keyDates++;
  });
  each("contacts_people", "deleted = false", function (p) {
    guarded("syncReachOut", function () {
      syncReachOut(app, hash, p.id);
    });
    counts.people++;
  });
  // Today's intake card per owner; past days are not shown on Today.
  var date = ymd(today);
  var owners = {};
  ["eatwell_entries", "eatwell_water"].forEach(function (c) {
    each(c, "date = '" + date + "'", function (r) {
      owners[r.getString("owner")] = true;
    });
  });
  Object.keys(owners).forEach(function (owner) {
    guarded("syncEatwellDay", function () {
      syncEatwellDay(app, hash, owner, date);
    });
    counts.eatwellDays++;
  });
  return counts;
}

/** rebuildAll for today's local date, logged as one JSON line; never throws. */
function rebuildLogged(app, hash, reason) {
  var counts = null;
  guarded("rebuildAll", function () {
    counts = rebuildAll(app, hash, new Date(new Date().toDateString()));
  });
  console.log(JSON.stringify({ level: "info", msg: "agenda.rebuilt", reason: reason, counts: counts }));
  return counts;
}

module.exports = {
  ymd: ymd,
  parseYmd: parseYmd,
  nextOccurrence: nextOccurrence,
  keyDateItem: keyDateItem,
  reachOutItem: reachOutItem,
  reachRow: reachRow,
  eatwellGlance: eatwellGlance,
  projectedId: projectedId,
  guarded: guarded,
  syncKeyDate: syncKeyDate,
  syncReachOut: syncReachOut,
  syncEatwellDay: syncEatwellDay,
  rebuildAll: rebuildAll,
  rebuildLogged: rebuildLogged,
  DAY: DAY,
};
