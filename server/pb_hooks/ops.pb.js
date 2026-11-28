/// <reference path="../pb_data/types.d.ts" />
// Server side of the sync write path (spec §Sync, steps 4-5) and the version convention.
// JSVM handlers run in isolated VMs: shared code is require()d inside each handler.

// version starts at 1 on create and is incremented on every update of a synced collection.
onRecordCreate((e) => {
  const { isSyncedCollection } = require(`${__hooks}/lib/pb-store.js`);
  if (isSyncedCollection(e.record.collection())) e.record.set("version", 1);
  e.next();
});

onRecordUpdate((e) => {
  const { isSyncedCollection } = require(`${__hooks}/lib/pb-store.js`);
  if (isSyncedCollection(e.record.collection())) {
    e.record.set("version", e.record.original().getInt("version") + 1);
  }
  e.next();
});

// POST /api/sa/ops  { opId, collection, recordId, op, payload, baseVersion }
// Header X-Superapp-Device: <core_devices id> (optional; recorded as origin_device when owned by the caller).
routerAdd(
  "POST",
  "/api/sa/ops",
  (e) => {
    const { applyOp } = require(`${__hooks}/lib/ops.js`);
    const { makeStore } = require(`${__hooks}/lib/pb-store.js`);
    const info = e.requestInfo();
    const op = JSON.parse(JSON.stringify(info.body || {}));
    const userId = e.auth ? e.auth.id : "";

    let deviceId = "";
    const claimed = String(info.headers["x_superapp_device"] || "");
    if (/^[a-z0-9]{15}$/.test(claimed)) {
      try {
        const dev = $app.findRecordById("core_devices", claimed);
        if (dev.getString("owner") === userId) deviceId = claimed;
      } catch (_) {
        deviceId = "";
      }
    }

    let res = null;
    try {
      $app.runInTransaction((txApp) => {
        res = applyOp(makeStore(txApp), op, { userId: userId, deviceId: deviceId });
      });
    } catch (err) {
      // Validation failures are answered as 400 inside applyOp. Anything thrown here (database busy,
      // I/O) rolled the transaction back and is transient: 500 lets the outbox retry with backoff.
      $app.logger().error("sa.ops.failed", "collection", String(op.collection || ""), "error", String(err));
      // Also to stdout (CORE-14 JSON line), so service and CI logs show the cause.
      console.log(JSON.stringify({ level: "error", msg: "sa.ops.failed", collection: String(op.collection || ""), op: String(op.op || ""), error: String(err).slice(0, 300) }));
      return e.json(500, { code: "SERVER_ERROR", message: "The server could not apply this change. It will be retried." });
    }
    return e.json(res.status, res.body);
  },
  $apis.requireAuth("users"),
);

// Retention: processed_ops kept 30 days (spec); soft-deleted records hard-deleted after 14 days
// (ADR-005; restorable with op "restore" until then).
cronAdd("sa_retention", "17 3 * * *", () => {
  const { isSyncedCollection } = require(`${__hooks}/lib/pb-store.js`);
  const ago = (days) => new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().replace("T", " ");
  const purge = (name, filter, cutoff) => {
    for (;;) {
      const batch = $app.findRecordsByFilter(name, filter, "", 200, 0, { cutoff: cutoff });
      if (batch.length === 0) return;
      for (const r of batch) $app.delete(r);
    }
  };
  purge("processed_ops", "created < {:cutoff}", ago(30));
  for (const c of $app.findAllCollections("base")) {
    if (isSyncedCollection(c)) purge(c.name, "deleted = true && updated < {:cutoff}", ago(14));
  }
});
