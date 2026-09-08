# Rodriguez Lab Inventory V1

A static, authenticated sample-processing and inventory application for GitHub Pages. Private data stays in Supabase/PostgreSQL; the public repository contains only frontend code and reproducible schema migrations.

## Local development

Requirements: Node 20+ for tests and Python 3 (or any static web server).

1. For this no-build V1, place the project URL and **publishable** key (or legacy anon key) in `config.js`. These values are public by design; never place a secret/service-role key there.
2. From the repository root, run `npm test`.
3. Run `npm run serve` and open `http://localhost:8000/inventory/`.

Camera access on a non-localhost development address generally requires HTTPS. Test camera scanning on the deployed Pages URL or an HTTPS development tunnel.

## Supabase setup

1. Create a Supabase project in the desired compliant organizational account and record its Project URL and publishable key (or legacy anon key).
2. Apply migrations with the Supabase CLI: `supabase link --project-ref PROJECT_REF`, then `supabase db push`. Alternatively, run every migration in filename order in the SQL editor. Existing deployments should apply `202609070002_source_registration_profiles.sql`, `202609070003_require_stemcell_intake_photo.sql`, and `202609070004_extraction_qc.sql` in that order after the Sample Sources migration.
3. In Authentication settings, enable Email provider. Disable public sign-ups unless the lab explicitly wants self-registration; this app intentionally has no sign-up form.
4. Set the Site URL to `https://rodriguez-mssm.github.io/inventory/` and add local/deployed redirect URLs as needed.
5. Put the Project URL and publishable/anon key in `inventory/config.js` and deploy. Do not commit a service-role key.

The migration creates new users as unapproved. To authorize a user:

1. Supabase Dashboard → Authentication → Users → Add user / Send invitation.
2. After the user exists, approve them in SQL:

```sql
update public.profiles
set approved = true, role = 'user', display_name = 'Lab member'
where id = (select id from auth.users where email = 'member@example.org');
```

To disable inventory access without deleting history:

```sql
update public.profiles
set disabled_at = now()
where id = (select id from auth.users where email = 'member@example.org');
```

An Auth administrator may also ban/delete the Auth login. Historical foreign-key references remain; prefer disabling the profile for routine offboarding.

## Database migrations

Migrations are under `supabase/migrations/` and reconstruct tables, enums, constraints, indexes, sequences, RLS, and transactional functions. Do not manually change production schema without adding a matching migration.

## Sample Sources

A Sample Source identifies the external provider or origin of material, such as a collaborator's lab, institution, or vendor. It is not the physical parent sample:

- `sample_source_id` remains constant across a lineage and identifies the external/provider origin.
- `parent_sample_id` points to the immediate physical tube used to create a sample.

Approved users manage origins from the **Sample Sources** home card. A source has a unique nickname, full name, and optional HTTP(S) URL. A Sample Source must be created before using **Sample Intake** for a newly arrived root sample. Processing automatically inherits the root's `sample_source_id`; users never select it again for aliquots, extraction products, or additional vials.

Rows created before the Sample Sources migration remain nullable so existing synthetic tests are not given a fabricated origin. Assign those synthetic roots deliberately if they will continue to be used; newly registered roots cannot be created without a source.

Each source also has an explicit registration profile. Existing sources default to Generic. Edit the STEMCELL source and select **STEMCELL COA registration** to enable private COA upload, required sample-photo upload, local PDF parsing/OCR fallback, reviewed metadata, and confirmed intake. See [source-specific registration](../docs/SOURCE_REGISTRATION.md).

The source-registration migration creates the private Supabase Storage bucket and its policies reproducibly. No Dashboard bucket setup or public URL is required.

## GitHub Pages deployment

The repository’s existing root is an implicitly rendered Jekyll/README page. `inventory/` is a self-contained static directory and is served at `/inventory/` by the existing branch-based Pages deployment. No workflow replacement is required. Commit and push to the configured Pages branch (`main` at inspection time).

Pinned browser dependencies are loaded from `esm.sh`. A future regulated/offline deployment should vendor and integrity-pin these assets or introduce a reproducible bundling step.

## Labels

`js/label-config.js` reproduces the geometry extracted from the unchanged blank `label-templates/cryolabel/CryoLabel_Template.docx`: US Letter portrait, 5 × 17 positions, 33.020 × 13.000 mm labels, and the template's alternating gap rows/columns. It centralizes page, label, margin, gap, barcode, quiet-zone, inset, and font values.

Before each PDF, choose a start position from 1–85. Overflow is blocked unless **Allow additional pages** is explicitly selected. The **Label calibration** home card produces a full boundary/position sheet. Print it at **Actual size / 100%**, disable all fitting/scaling, and overlay it against the physical sheet. The template is not production-ready until that manual calibration passes; adjust only `js/label-config.js` if measurements require correction.

Data Matrix is the default because it is compact. The generator falls back to QR if Data Matrix generation fails. Codes contain only `sample_id`.

## DNA/RNA extraction QC

**Pending processing → Enter results** records actual volume and an explicitly identified Qubit concentration, then calculates total ng and µg and retains the existing vial-distribution workflow. Optional extraction-level QC includes raw NanoDrop A230/A260/A280, generated purity ratios, DNA DIN or RNA RIN, and one or more PDF/PNG/JPEG fragment/integrity traces.

QC belongs to the pooled `processing_output`, not to each child vial. Derived vial detail pages identify it as inherited extraction QC; only vial volume, inherited homogeneous Qubit concentration, and calculated vial mass are vial-specific. Trace files use the existing private `sample-media` bucket and short-lived signed links. Extraction QC is not sequencing-library QC and does not apply ONT pass/fail thresholds.

## Camera permissions

- Use HTTPS or localhost, allow camera permission, and select the rear camera when prompted.
- iPhone Safari requires a user gesture to start scanning and may stop the stream when backgrounded.
- Camera focus and Data Matrix detection vary. Good contrast, adequate module size, and a clean lens matter; manual Sample ID entry is always available.
- The scanner suppresses the same decoded value for 2.5 seconds. Activation still requires an explicit confirmation, and the database rejects duplicate activation.

## Tests

Run `npm test`. Parser fixture tests additionally require Poppler (`pdftotext`, `pdftoppm`) and Tesseract. Tests cover every supplied STEMCELL COA, source allocation, serum conversion, vial planning, mass calculation, distribution/capacity validation, lifecycle transitions, Storage/RLS safeguards, and mandatory review. Before production use, also run the manual RLS verification in `SECURITY.md` against the configured Supabase project.

## Inspection and backup/export

- Inspect records with the Supabase Table Editor or read-only SQL queries. `audit_events` is the chronological event log.
- Use Supabase database backups appropriate to the project plan. For an ad hoc export, use `pg_dump` with a direct/database-pooler connection obtained from project settings; protect the dump as research data.
- CSV exports from the dashboard are sensitive research-data exports and must use approved storage.

See the [deployment checklist](../docs/DEPLOYMENT_CHECKLIST.md), [synthetic acceptance test](../docs/ACCEPTANCE_TEST.md), [RLS review](../docs/RLS_REVIEW.md), [architecture](../docs/ARCHITECTURE.md), [bench workflows](../docs/REAL_WORLD_WORKFLOW.md), [migration plan](../docs/MIGRATION_PLAN.md), and [security](../SECURITY.md).
