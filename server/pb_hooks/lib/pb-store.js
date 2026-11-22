// PocketBase-backed store for lib/ops.js. Only used inside JSVM handlers (needs `Record`).
var ops = require(__hooks + "/lib/ops.js");

function plain(rec) {
  return JSON.parse(JSON.stringify(rec.publicExport()));
}

function isSyncedCollection(collection) {
  if (!collection || collection.type !== "base") return false;
  for (var i = 0; i < ops.SYNCED_MARKER_FIELDS.length; i++) {
    if (!collection.fields.getByName(ops.SYNCED_MARKER_FIELDS[i])) return false;
  }
  return true;
}

/** Field validation first, so only validation failures become 400; save errors still throw (→ 500). */
function saveValidated(txApp, r) {
  try {
    txApp.validate(r);
  } catch (e) {
    return { invalid: String(e) };
  }
  txApp.save(r);
  return plain(r);
}

function makeStore(txApp) {
  return {
    isSynced: function (name) {
      try {
        return isSyncedCollection(txApp.findCollectionByNameOrId(name));
      } catch (_) {
        return false;
      }
    },
    findProcessed: function (opId) {
      try {
        var r = txApp.findFirstRecordByData("processed_ops", "opId", opId);
        return { owner: r.getString("owner"), status: r.getInt("status"), body: JSON.parse(r.getString("result") || "{}") };
      } catch (_) {
        return null;
      }
    },
    findRecord: function (collection, id) {
      try {
        return plain(txApp.findRecordById(collection, id));
      } catch (_) {
        return null;
      }
    },
    create: function (collection, data) {
      var r = new Record(txApp.findCollectionByNameOrId(collection));
      r.load(data);
      return saveValidated(txApp, r);
    },
    update: function (collection, id, patch) {
      var r = txApp.findRecordById(collection, id);
      r.load(patch);
      return saveValidated(txApp, r);
    },
    markProcessed: function (opId, x) {
      var r = new Record(txApp.findCollectionByNameOrId("processed_ops"));
      r.set("opId", opId);
      r.set("owner", x.owner);
      r.set("targetCollection", x.collection);
      r.set("recordId", x.recordId);
      r.set("status", x.status);
      r.set("result", JSON.stringify(x.body));
      txApp.save(r);
    },
  };
}

module.exports = { makeStore: makeStore, isSyncedCollection: isSyncedCollection };
