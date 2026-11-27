// Pure write-path logic for POST /api/sa/ops (spec §Sync, write path steps 4-5).
// Runs in PocketBase's JSVM (goja) via require() and in Node for unit tests, so it is plain
// CommonJS with no PocketBase globals: all storage goes through the injected `store`.

var OP_ID = /^[A-Za-z0-9-]{8,64}$/;
var RECORD_ID = /^[a-z0-9]{15}$/;
var COLLECTION = /^[a-z][a-z0-9_]{1,63}$/;
var RESERVED = ["id", "version", "deleted", "owner", "origin_device", "created", "updated", "collectionId", "collectionName", "expand"];

/**
 * A collection is "synced" (written only through ops, versioned) when it has the synced-collection
 * fields from the spec's conventions. Field-based, so app collections created by later migrations
 * qualify automatically and non-synced collections that happen to have a `version` text field
 * (e.g. `subapps`) never do.
 */
var SYNCED_MARKER_FIELDS = ["version", "deleted", "owner", "origin_device"];

function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function result(status, body) {
  return { status: status, body: body };
}

function err(status, code, message, extra) {
  var body = { code: code, message: message };
  if (extra) for (var k in extra) body[k] = extra[k];
  return result(status, body);
}

/**
 * store.create/update return either the saved record or { invalid: "<message>" } when the record
 * failed field validation (nothing written). Validation failures are final (400); anything thrown is
 * left to the caller and answered as a retryable 500.
 */
function saved(r) {
  if (r && typeof r.invalid === "string") return err(400, "INVALID_PARAMS", "The server rejected this record: " + r.invalid.slice(0, 300));
  return result(200, { record: r });
}

/** Validates the op shape. Returns an error result or null. */
function validateOp(op) {
  if (!isObject(op)) return err(400, "INVALID_PARAMS", "op must be an object");
  if (typeof op.opId !== "string" || !OP_ID.test(op.opId)) return err(400, "INVALID_PARAMS", "opId must be 8-64 chars [A-Za-z0-9-]");
  if (typeof op.collection !== "string" || !COLLECTION.test(op.collection)) return err(400, "INVALID_PARAMS", "invalid collection");
  if (typeof op.recordId !== "string" || !RECORD_ID.test(op.recordId)) return err(400, "INVALID_PARAMS", "recordId must be 15 chars a-z0-9");
  if (["create", "update", "delete"].indexOf(op.op) < 0) return err(400, "INVALID_PARAMS", "op must be create, update or delete");
  if (op.op !== "delete" && !isObject(op.payload)) return err(400, "INVALID_PARAMS", "payload must be an object");
  if (op.op !== "create" && (typeof op.baseVersion !== "number" || op.baseVersion < 1 || Math.floor(op.baseVersion) !== op.baseVersion)) {
    return err(400, "INVALID_PARAMS", "baseVersion must be a positive integer");
  }
  return null;
}

/** Copies payload fields, dropping server-owned ones so clients can never set them. */
function cleanPayload(payload) {
  var out = {};
  if (!isObject(payload)) return out;
  for (var k in payload) {
    if (Object.prototype.hasOwnProperty.call(payload, k) && RESERVED.indexOf(k) < 0) out[k] = payload[k];
  }
  return out;
}

/**
 * Applies one outbox op exactly once.
 *   store.isSynced(collection) → bool
 *   store.findProcessed(opId) → { owner, status, body } | null
 *   store.findRecord(collection, id) → plain record | null
 *   store.create(collection, data) → plain record (server sets version = 1)
 *   store.update(collection, id, data) → plain record (server bumps version)
 *   store.markProcessed(opId, { owner, collection, recordId, status, body })
 * ctx: { userId, deviceId }
 * The caller runs this inside one transaction; a unique index on opId closes concurrent replays.
 */
function applyOp(store, op, ctx) {
  var invalid = validateOp(op);
  if (invalid) return invalid;
  if (!ctx || !ctx.userId) return err(401, "UNAUTHENTICATED", "sign in required");

  var prior = store.findProcessed(op.opId);
  if (prior) {
    if (prior.owner !== ctx.userId) return err(409, "CONFLICT", "opId already used");
    var replay = { status: prior.status, body: prior.body };
    replay.body = Object.assign({}, prior.body, { replayed: true });
    return replay;
  }

  if (!store.isSynced(op.collection)) return err(403, "SCOPE_DENIED", "collection is not writable through ops");

  var existing = store.findRecord(op.collection, op.recordId);
  if (existing && existing.owner !== ctx.userId) existing = null; // never reveal other owners' records
  var res;

  if (op.op === "create") {
    if (existing) {
      res = err(409, "CONFLICT", "record already exists", { server: existing });
    } else {
      var data = cleanPayload(op.payload);
      data.id = op.recordId;
      data.owner = ctx.userId;
      data.deleted = false;
      if (ctx.deviceId) data.origin_device = ctx.deviceId;
      res = saved(store.create(op.collection, data));
    }
  } else if (!existing) {
    res = err(404, "NOT_FOUND", "record does not exist on the server");
  } else if (existing.deleted && op.op === "update") {
    res = err(404, "NOT_FOUND", "record was deleted on the server", { server: existing });
  } else if (existing.version !== op.baseVersion) {
    res = err(409, "CONFLICT", "version conflict", { server: existing, baseVersion: op.baseVersion });
  } else {
    var patch = op.op === "delete" ? { deleted: true } : cleanPayload(op.payload);
    if (ctx.deviceId) patch.origin_device = ctx.deviceId;
    res = saved(store.update(op.collection, op.recordId, patch));
  }

  store.markProcessed(op.opId, { owner: ctx.userId, collection: op.collection, recordId: op.recordId, status: res.status, body: res.body });
  return res;
}

module.exports = { applyOp: applyOp, validateOp: validateOp, cleanPayload: cleanPayload, SYNCED_MARKER_FIELDS: SYNCED_MARKER_FIELDS, RESERVED: RESERVED };
