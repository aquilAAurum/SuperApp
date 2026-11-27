/// <reference path="../pb_data/types.d.ts" />
// Supra Contacts — server schema (PocketBase on the Supra mini PC; SQLite underneath).
// Install: copy into SuperApp/server/pb_migrations/ (see docs/PLAN.md §Integration).
//
// Mirrors schema/contacts.sql with the Supra synced-collection conventions (SuperApp spec §Data layer):
// app-owned collections are prefixed with the app id (`contacts_`), carry version / deleted / owner /
// origin_device, and are written ONLY through POST /api/sa/ops (create/update/delete rules null).
// Record ids are the importer's deterministic 15-char ids, so the phone, the server and the local
// SQLite file all agree on identity. Dates are ISO `YYYY-MM-DD` text so SQL date() math is identical
// everywhere. Two SQL view collections expose the reach-out schedule and backlinks.
migrate(
  (app) => {
    const OWNER = "@request.auth.id != '' && owner = @request.auth.id";
    const users = app.findCollectionByNameOrId("users");
    const devices = app.findCollectionByNameOrId("core_devices");
    const people = app.findCollectionByNameOrId("core_people");
    const DATE = "^$|^\\d{4}-\\d{2}-\\d{2}$";

    const synced = (name, fields, indexes) =>
      new Collection({
        type: "base",
        name,
        listRule: OWNER,
        viewRule: OWNER,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          ...fields,
          { name: "version", type: "number", required: true, onlyInt: true, min: 1 },
          { name: "deleted", type: "bool" },
          { name: "owner", type: "relation", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: false },
          { name: "origin_device", type: "relation", collectionId: devices.id, maxSelect: 1, cascadeDelete: false },
          { name: "created", type: "autodate", onCreate: true, onUpdate: false },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
        indexes: [`CREATE INDEX idx_${name}_owner_updated ON ${name} (owner, updated)`, ...(indexes || [])],
      });

    const entities = synced(
      "contacts_entities",
      [
        { name: "kind", type: "select", required: true, maxSelect: 1, values: ["person", "organization", "role", "project", "event", "group", "note"] },
        { name: "kind_source", type: "select", maxSelect: 1, values: ["frontmatter", "folder", "inferred", "default"] },
        { name: "kind_reasons", type: "json", maxSize: 20000 },
        { name: "title", type: "text", required: true, max: 300 },
        { name: "title_key", type: "text", required: true, max: 300 },
        { name: "path", type: "text", max: 1000 },
        { name: "is_ghost", type: "bool" },
        { name: "status", type: "text", max: 100 },
        { name: "seniority", type: "text", max: 100 },
        { name: "relationship", type: "text", max: 100 },
        { name: "tier_raw", type: "text", max: 100 },
        { name: "frontmatter", type: "json", maxSize: 200000 },
        { name: "body", type: "text", max: 500000 },
        { name: "content_hash", type: "text", max: 64 },
        { name: "aliases", type: "json", maxSize: 20000 },
        { name: "tags", type: "json", maxSize: 20000 },
        { name: "attributes", type: "json", maxSize: 200000 },
        { name: "issues", type: "json", maxSize: 50000 },
      ],
      ["CREATE INDEX idx_contacts_entities_key ON contacts_entities (owner, title_key)", "CREATE INDEX idx_contacts_entities_kind ON contacts_entities (owner, kind)"],
    );
    app.save(entities);
    const rel = (name, required) => ({ name, type: "relation", required: !!required, collectionId: entities.id, maxSelect: 1, cascadeDelete: false });

    app.save(
      synced("contacts_people", [
        rel("entity", true),
        { name: "core_person", type: "relation", collectionId: people.id, maxSelect: 1, cascadeDelete: false },
        { name: "first_name", type: "text", max: 100 },
        { name: "last_name", type: "text", max: 100 },
        { name: "display_name", type: "text", required: true, max: 200 },
        { name: "job_title", type: "text", max: 200 },
        rel("current_org"),
        rel("alma_mater"),
        { name: "location", type: "text", max: 200 },
        { name: "preferred_channel", type: "text", max: 50 },
        { name: "cadence_days", type: "number", onlyInt: true, min: 0 },
        { name: "last_touch", type: "text", max: 10, pattern: DATE },
        { name: "next_touch", type: "text", max: 10, pattern: DATE },
        { name: "how_met", type: "text", max: 1000 },
        { name: "met_on", type: "text", max: 10, pattern: DATE },
      ]),
    );
    app.save(
      synced("contacts_organizations", [
        rel("entity", true),
        { name: "name", type: "text", required: true, max: 300 },
        { name: "legal_name", type: "text", max: 300 },
        { name: "industry", type: "text", max: 200 },
        { name: "company_size", type: "text", max: 100 },
        { name: "website", type: "text", max: 500 },
        { name: "domain", type: "text", max: 253 },
        { name: "hq_location", type: "text", max: 200 },
        { name: "relationship_tier", type: "text", max: 100 },
        rel("primary_contact"),
        rel("parent_org"),
        { name: "philanthropy_type", type: "text", max: 100 },
        { name: "matching_gifts", type: "select", maxSelect: 1, values: ["yes", "no"] },
      ], ["CREATE INDEX idx_contacts_organizations_domain ON contacts_organizations (owner, domain)"]),
    );
    app.save(
      synced("contacts_nodes", [
        rel("entity", true),
        { name: "node_type", type: "select", required: true, maxSelect: 1, values: ["role", "project", "event", "group"] },
        rel("org"),
        { name: "start_date", type: "text", max: 10, pattern: DATE },
        { name: "end_date", type: "text", max: 10, pattern: DATE },
        { name: "occurred_on", type: "text", max: 10, pattern: DATE },
        { name: "description", type: "text", max: 5000 },
      ]),
    );
    app.save(
      synced("contacts_contact_points", [
        rel("entity", true),
        { name: "channel", type: "select", required: true, maxSelect: 1, values: ["email", "phone", "whatsapp", "google_voice", "linkedin", "website", "twitter", "address", "other"] },
        { name: "value", type: "text", required: true, max: 500 },
        { name: "value_norm", type: "text", required: true, max: 500 },
        { name: "label", type: "text", max: 50 },
        { name: "is_primary", type: "bool" },
        { name: "is_valid", type: "bool" },
        { name: "source", type: "text", required: true, max: 100 },
      ], ["CREATE INDEX idx_contacts_contact_points_norm ON contacts_contact_points (owner, channel, value_norm)"]),
    );
    app.save(
      synced("contacts_key_dates", [
        rel("entity", true),
        { name: "kind", type: "text", required: true, max: 50 },
        { name: "label", type: "text", max: 100 },
        { name: "year", type: "number", onlyInt: true, min: 0 },
        { name: "month", type: "number", required: true, onlyInt: true, min: 1, max: 12 },
        { name: "day", type: "number", required: true, onlyInt: true, min: 1, max: 31 },
        { name: "recurring", type: "bool" },
        { name: "source", type: "text", required: true, max: 100 },
      ]),
    );
    app.save(
      synced("contacts_interactions", [
        rel("entity", true),
        { name: "occurred_on", type: "text", required: true, max: 10, pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        { name: "kind", type: "text", max: 100 },
        { name: "summary", type: "text", max: 5000 },
        { name: "source", type: "text", required: true, max: 100 },
      ]),
    );
    app.save(
      synced("contacts_edges", [
        rel("source", true),
        rel("target", true),
        { name: "relation", type: "text", required: true, max: 100 },
        { name: "origin", type: "select", required: true, maxSelect: 1, values: ["frontmatter", "body", "outline"] },
        { name: "field", type: "text", max: 100 },
        { name: "section", type: "text", max: 500 },
        rel("context_note"),
        { name: "context", type: "text", max: 500 },
      ], ["CREATE INDEX idx_contacts_edges_target ON contacts_edges (owner, target)", "CREATE INDEX idx_contacts_edges_source ON contacts_edges (owner, source)"]),
    );
    app.save(
      synced("contacts_mentions", [
        rel("entity", true),
        rel("parent"),
        { name: "text", type: "text", required: true, max: 300 },
        { name: "section", type: "text", max: 500 },
      ]),
    );

    // Proposed facts from outside Supra (connectors, CSV imports, manual) waiting for review in the
    // Contacts subapp's data-quality queue. Decisions are made in the app; nothing is written to the vault.
    app.save(
      synced("contacts_enrichment", [
        rel("entity", true),
        { name: "field", type: "text", required: true, max: 100 },
        { name: "value", type: "text", required: true, max: 5000 },
        { name: "mode", type: "select", maxSelect: 1, values: ["set", "add"] },
        { name: "source", type: "text", required: true, max: 100 },
        { name: "confidence", type: "number", min: 0, max: 1 },
        { name: "observed_at", type: "text", max: 40 },
        { name: "status", type: "select", required: true, maxSelect: 1, values: ["proposed", "accepted", "rejected", "applied"] },
        { name: "decided_at", type: "text", max: 40 },
        { name: "applied_at", type: "text", max: 40 },
        { name: "message", type: "text", max: 1000 },
      ], ["CREATE INDEX idx_contacts_enrichment_status ON contacts_enrichment (owner, status)"]),
    );

    // Vault migration audit (PRD SA-2026-007 E1.2). One record per push; a `cutover` record means the
    // vault is retired: Supra is the source of truth and the importer refuses to push again.
    app.save(
      synced("contacts_imports", [
        { name: "source", type: "text", required: true, max: 100 },
        { name: "status", type: "select", required: true, maxSelect: 1, values: ["imported", "cutover"] },
        { name: "vault", type: "text", max: 1000 },
        { name: "notes", type: "number", onlyInt: true, min: 0 },
        { name: "newest_note", type: "text", max: 40 },
        { name: "stats", type: "json", maxSize: 20000 },
      ]),
    );

    // ---- SQL views (read-only collections). Each exposes `owner` so the same owner rule applies.
    app.save(
      new Collection({
        type: "view",
        name: "contacts_reach_out",
        listRule: OWNER,
        viewRule: OWNER,
        viewQuery: `
          SELECT p.id, p.owner, p.entity, p.display_name, p.job_title, e.seniority, e.relationship, e.status, o.title AS current_org,
                 (SELECT c.value_norm FROM contacts_contact_points c WHERE c.entity = p.entity AND c.deleted = FALSE AND c.channel = 'email' AND c.is_valid = TRUE ORDER BY c.is_primary DESC LIMIT 1) AS email,
                 (SELECT c.value_norm FROM contacts_contact_points c WHERE c.entity = p.entity AND c.deleted = FALSE AND c.channel IN ('phone','google_voice','whatsapp') AND c.is_valid = TRUE ORDER BY c.is_primary DESC LIMIT 1) AS phone,
                 p.preferred_channel, nullif(p.cadence_days, 0) AS cadence_days,
                 nullif(max(coalesce(nullif(p.last_touch, ''), ''),
                            coalesce((SELECT max(i.occurred_on) FROM contacts_interactions i WHERE i.entity = p.entity AND i.deleted = FALSE AND i.kind <> 'Created'), '')), '') AS last_touch,
                 nullif(p.next_touch, '') AS next_touch,
                 coalesce(nullif(p.next_touch, ''),
                          CASE WHEN nullif(p.last_touch, '') IS NOT NULL AND p.cadence_days > 0
                               THEN date(p.last_touch, '+' || p.cadence_days || ' days') END) AS due_on,
                 e.is_ghost
            FROM contacts_people p
            JOIN contacts_entities e ON e.id = p.entity AND e.deleted = FALSE
            LEFT JOIN contacts_entities o ON o.id = p.current_org
           WHERE p.deleted = FALSE`,
      }),
    );
    app.save(
      new Collection({
        type: "view",
        name: "contacts_backlinks",
        listRule: OWNER,
        viewRule: OWNER,
        viewQuery: `
          SELECT g.id, g.owner, g.target, t.title AS target_title, g.source, s.title AS source_title, s.kind AS source_kind,
                 g.relation, g.origin, g.field, g.section, g.context, c.title AS in_note
            FROM contacts_edges g
            JOIN contacts_entities t ON t.id = g.target
            JOIN contacts_entities s ON s.id = g.source
            LEFT JOIN contacts_entities c ON c.id = g.context_note
           WHERE g.deleted = FALSE`,
      }),
    );
  },
  (app) => {
    for (const name of [
      "contacts_backlinks",
      "contacts_reach_out",
      "contacts_imports",
      "contacts_enrichment",
      "contacts_mentions",
      "contacts_edges",
      "contacts_interactions",
      "contacts_key_dates",
      "contacts_contact_points",
      "contacts_nodes",
      "contacts_organizations",
      "contacts_people",
      "contacts_entities",
    ]) {
      app.delete(app.findCollectionByNameOrId(name));
    }
  },
);
