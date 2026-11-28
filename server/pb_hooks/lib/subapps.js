// Import plan for published subapp bundles (ADR-009). Pure: the JSVM hook (subapps.pb.js) and the
// unit tests (tests/unit/subapps.test.ts) pass in directory listings and a text reader.
//
// Inbox layout (a copy of the repo's published/ folder, pulled by tools/sync-subapps.ps1):
//   <inbox>/<id>/<id>-<version>.zip          the bundle (tools/pack.mjs: app.json at the root)
//   <inbox>/<id>/<id>-<version>.zip.sha256   "<64 hex>  <file name>"
//   <inbox>/<id>/<id>-<version>.json         the manifest (same as the zip's app.json)
// The server checks names, versions and hash format and never overwrites a published version.
// The phone re-verifies the zip's SHA-256 and its inner app.json before installing anything.

var ID = /^[a-z][a-z0-9]{1,31}$/;
var SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
var HASH = /^[0-9a-f]{64}$/;
var MAX_BYTES = 10 * 1024 * 1024;

/**
 * @param {{ dirs: string[], files: (dir: string) => {name: string, size: number}[], readText: (dir: string, name: string) => string }} inbox
 * @param {(appId: string, version: string) => boolean} exists
 * @returns {{ items: {appId: string, version: string, sha256: string, manifest: object, zip: string, dir: string}[], errors: {path: string, reason: string}[] }}
 */
function planImport(inbox, exists) {
  var items = [];
  var errors = [];
  for (var d = 0; d < inbox.dirs.length; d++) {
    var dir = inbox.dirs[d];
    if (!ID.test(dir)) {
      errors.push({ path: dir, reason: "folder name is not a valid app id" });
      continue;
    }
    var files = inbox.files(dir);
    var byName = {};
    for (var f = 0; f < files.length; f++) byName[files[f].name] = files[f];
    for (var i = 0; i < files.length; i++) {
      var name = files[i].name;
      if (name.slice(-4) !== ".zip") continue;
      var path = dir + "/" + name;
      var prefix = dir + "-";
      if (name.indexOf(prefix) !== 0) {
        errors.push({ path: path, reason: "zip name must start with " + prefix });
        continue;
      }
      var version = name.slice(prefix.length, -4);
      if (!SEMVER.test(version)) {
        errors.push({ path: path, reason: "version " + version + " is not semantic (1.2.3)" });
        continue;
      }
      if (exists(dir, version)) continue;
      if (files[i].size > MAX_BYTES) {
        errors.push({ path: path, reason: "bundle larger than " + MAX_BYTES + " bytes" });
        continue;
      }
      if (!byName[name + ".sha256"] || !byName[dir + "-" + version + ".json"]) {
        errors.push({ path: path, reason: "missing .sha256 or .json next to the zip" });
        continue;
      }
      var sha = String(inbox.readText(dir, name + ".sha256")).trim().split(/\s+/)[0];
      if (!HASH.test(sha)) {
        errors.push({ path: path, reason: "sha256 file is malformed" });
        continue;
      }
      var manifest;
      try {
        manifest = JSON.parse(inbox.readText(dir, dir + "-" + version + ".json"));
      } catch (e) {
        errors.push({ path: path, reason: "manifest JSON is invalid" });
        continue;
      }
      if (!manifest || manifest.id !== dir || manifest.version !== version || typeof manifest.entry !== "string") {
        errors.push({ path: path, reason: "manifest id/version/entry do not match the file name" });
        continue;
      }
      items.push({ appId: dir, version: version, sha256: sha, manifest: manifest, zip: name, dir: dir });
    }
  }
  return { items: items, errors: errors };
}

/** JSVM only (uses $os, $app, $filesystem, Record). */
function importFromInbox() {
  const inbox = $os.getenv("SUPRA_SUBAPPS_INBOX") || `${__hooks}/../subapps_inbox`;
  let top;
  try {
    top = $os.readDir(inbox);
  } catch (_) {
    return { imported: [], errors: [], inbox: "missing" };
  }
  const dirs = top.filter((e) => e.isDir()).map((e) => e.name());
  const plan = planImport(
    {
      dirs,
      files: (dir) =>
        $os
          .readDir(`${inbox}/${dir}`)
          .filter((e) => !e.isDir())
          .map((e) => ({ name: e.name(), size: e.info().size() })),
      readText: (dir, name) => toString($os.readFile(`${inbox}/${dir}/${name}`)),
    },
    (appId, version) => {
      try {
        $app.findFirstRecordByFilter("subapps", "appId = {:a} && version = {:v}", { a: appId, v: version });
        return true;
      } catch (_) {
        return false;
      }
    },
  );
  const col = $app.findCollectionByNameOrId("subapps");
  const imported = [];
  for (const it of plan.items) {
    const r = new Record(col);
    r.set("appId", it.appId);
    r.set("version", it.version);
    r.set("manifest", it.manifest);
    r.set("sha256", it.sha256);
    r.set("channel", "stable");
    r.set("bundle", $filesystem.fileFromPath(`${inbox}/${it.dir}/${it.zip}`));
    $app.save(r);
    imported.push(`${it.appId}@${it.version}`);
    $app.logger().info("subapps.imported", "appId", it.appId, "version", it.version, "sha256", it.sha256);
  }
  for (const e of plan.errors) $app.logger().warn("subapps.import_rejected", "path", e.path, "reason", e.reason);
  return { imported, errors: plan.errors, inbox: "ok" };
}

module.exports = { planImport: planImport, importFromInbox: importFromInbox, MAX_BYTES: MAX_BYTES };

