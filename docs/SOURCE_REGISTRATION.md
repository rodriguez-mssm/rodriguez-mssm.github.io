# Source-specific Registration

## Profiles

Each Sample Source has an explicit registration profile. The profile is configuration, not an inference from its name:

- `GENERIC`: the existing manual sample type, external reference, quantity, concentration, and notes form.
- `STEMCELL_COA`: private COA upload, required sample photo, deterministic parsing, mandatory review, and confirmed registration.

After applying the migration, existing Sample Sources remain `GENERIC`. Open **Sample Sources → Edit** and deliberately select **STEMCELL COA registration** for the STEMCELL source.

## STEMCELL workflow

1. Choose a Sample Source configured as `STEMCELL_COA`.
2. Select a COA PDF and take/upload the required sample photo. Mobile file capture requests the rear/environment camera where supported.
3. The browser creates a draft registration session and uploads the original files to the private `sample-media` bucket using UUID-only object paths.
4. PDF.js extracts embedded text locally. If critical fields are absent or unreadable, Tesseract.js performs local OCR in the browser. The file is not sent to an external document/AI service.
5. A deterministic STEMCELL parser identifies labeled fields and normalizes scientific-notation cell counts or volumes.
6. The review form marks each field **Extracted**, **Missing**, or **User-edited**. An ambiguous product leaves internal Sample Type unselected.
7. The user compares the form with the COA and checks the confirmation box.
8. One transactional RPC creates the active root sample, vendor subject identity, source metadata, document links, and audit events. Parsed values are not authoritative before this confirmation.

## Parsed fields

The V1 parser recognizes vendor product description, catalog number, lot number, donor ID, cell processing date, raw and normalized quantity, viability, viral result/date, CMV result/date, age, sex, ethnicity, weight, height, smoker status, blood type, and anticoagulant. Fields may be null. Parser warnings and extraction method are retained.

Product mapping is deterministic:

- Human Peripheral Blood Mononuclear Cells / PB MNC → `PBMC`
- Human Bone Marrow Mononuclear Cells / BM MNC → `BMMNC`
- Serum → `SERUM`
- Plasma → `PLASMA`

All other descriptions require the user to select the internal type during review.

## Data separation and provenance

- `samples`: physical identity and canonical normalized quantity.
- `sample_sources`: external provider/origin and registration profile.
- `source_subjects`: source-scoped vendor donor identifier only.
- `source_sample_metadata`: queryable product/QC fields, less-common donor JSON, parser warnings, and per-field review provenance for the root.
- `sample_media`: private COA/photo object references linked first to the draft and then to the confirmed root.
- `parent_sample_id`: immediate physical lineage. Descendants do not duplicate COA/donor metadata; they reach it through lineage and inherit the same Sample Source.

No names, MRNs, DOBs, diagnoses, or attempts to identify vendor donors belong in this workflow.

## Private Storage

The migration creates one private `sample-media` bucket with a 15 MB object limit. It accepts PDF, JPEG, PNG, HEIC, and HEIF. Object names are:

```text
authenticated-user-uuid/registration-session-uuid/media-uuid
```

They contain no donor, lot, sample, or filename data. Approved users may read objects and create objects only in their own UUID prefix. No anonymous, public, update, or delete policy is created. Detail pages request five-minute signed URLs; the bucket itself remains private.

Draft uploads can remain if parsing/registration is abandoned. V1 deliberately has no browser deletion workflow; a Supabase administrator may review orphaned drafts under the lab's retention procedure.

## Parser fixtures

The original PDFs remain unchanged in the local `tests/fixtures/stemcell_coa/` directory. Reviewed expected values are stored beside them in `expected.json`. Both are intentionally Git-ignored because source documents and vendor donor metadata must not enter the public repository. Fixture tests prefer embedded text and invoke OCR only where the embedded text is insufficient; they skip the protected-fixture integration case in a clean checkout while synthetic parser tests still run. Poppler (`pdftotext`, `pdftoppm`) and Tesseract are required to run the local PDF fixture tests.
