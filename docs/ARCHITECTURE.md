# Inventory Architecture

## System boundary

GitHub Pages serves static UI code from `/inventory/`. The browser establishes HTTPS connections directly to Supabase Auth and its generated PostgreSQL API. No inventory record is stored in Git, local HTML, or a Google Sheet.

The repository root remains the existing README-backed GitHub Pages site. The inventory app is additive and does not replace the root build/deployment mechanism.

## Frontend modules

- `config.js`: deployment-specific public Supabase coordinates.
- `sample-types.js`: centralized material dimensions and canonical units.
- `calculations.js`: deterministic allocation, mass, capacity, and distribution rules.
- `api.js`: the only data-access surface used by the UI.
- `sample-sources.js`: Sample Source input normalization, URL validation, and client-side filtering.
- `labels.js` / `label-config.js`: dimension-controlled PDF and 2D barcode output.
- `scanner.js`: rear-camera Data Matrix/QR scanning and duplicate suppression.
- `app.js`: routing and screen rendering.
- `lifecycle.js`: documented/tested client lifecycle rules. PostgreSQL remains authoritative.

## Relational model

`profiles` maps Auth identities to lab approval and the minimal `admin`/`user` role.

`sample_sources` stores one external/provider origin with a UUID, unique case-insensitive nickname, full name, optional URL, creator, and timestamps. Approved users read it through RLS and create/update it only through audited RPCs. V1 intentionally provides no delete operation.

`samples` represents one immutable planned or physical tube. A UUID is used for relationships; `sample_id` is an immutable unique label. `parent_sample_id` points to the immediate physical source, while `sample_source_id` points to the external/provider origin. Canonical quantity columns are explicit rather than a generic amount/unit pair:

- Cell materials: original/current/reserved/planned count in millions.
- Serum/plasma: original/current/reserved/planned volume in µL.
- DNA/RNA: original/current/planned volume in µL, concentration in ng/µL, and generated total mass in ng.

This strongly typed V1 is easier to validate and query than an entity-attribute-value measurements table. A later `sample_measurements` table can hold repeated or instrument-specific measurements without changing identity/lineage.

`processing_events` is one source plus one or more output plans. It preserves event-level planned allocation, actual consumption, status, actor, and timestamps.

`processing_outputs` distinguishes three quantities: planned source allocation, expected output, and actual output. It also stores operation, material, requested vial count, capacity, concentration, and result state.

`processing_output_samples` gives each output’s physical sample records a stable ordinal and records whether an extra vial was added.

`audit_events` is append-only to application users. It records planning, label reservation/printing, activation, result entry, unused labels, and additional vials. Corrections should append a future correction event rather than rewrite history silently.

## Transaction and concurrency rules

Planning locks the source sample, verifies unreserved availability, and reserves source quantity in the same transaction. A second user cannot overbook it. Human identifiers are allocated by PostgreSQL sequences and protected by unique constraints.

A `BEFORE INSERT` trigger requires a Sample Source for every newly registered root and copies the immediate parent's `sample_source_id` to every descendant. This covers aliquots, extraction products, and additional vials even if a caller bypasses the UI. Existing pre-migration synthetic rows remain nullable and are not assigned a fictitious source.

Aliquot source material is actually consumed tube-by-tube on activation. Marking an unused aliquot label `NOT_CREATED` releases its reservation. Extraction input is consumed when results are recorded, and all affected rows are locked. Additional vial ordinals are assigned while the output row is locked. Activation requires `PLANNED`, so duplicate activation cannot produce a second event.

## Identity and lineage

Visible IDs are `<TYPE>-NNNNNN` and events are `PE-NNNNNN`. Every physical tube receives a new independent identifier. IDs never encode authoritative lineage and never nest. `samples.parent_sample_id` and `created_by_processing_event_id` answer what created a tube; event/output/audit records answer what happened to its source.

Sample Source and parent lineage are deliberately orthogonal: Sample Source means external/provider origin; parent means the immediate physical tube. Descendants retain the same Sample Source while their parent changes at each processing step.

## State separation

Sample lifecycle is `PLANNED → ACTIVE` or `PLANNED → NOT_CREATED`; an active sample may later become `CONSUMED` or `DISCARDED`. Extraction result status (`AWAITING_RESULTS` / `RESULTS_RECORDED`) is separate from physical-sample status. Printing is an event, not a lifecycle state.

Storage locations are intentionally absent. A future storage module can reference `samples.id` and append movement events without changing the processing model.
