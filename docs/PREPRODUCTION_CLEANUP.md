# Pre-production synthetic-data cleanup

Status: **approved cleanup executed successfully on 2026-09-07; post-cleanup verification passed**.

## Retention boundary

Generated IDs are not classified by their text. The acceptance root predates Sample Sources and has no `external_id`, so a `TEST-%` filter would incorrectly select nothing. The reviewed cleanup instead pins the exact root UUID and follows relational lineage through `parent_sample_id`, processing-event foreign keys, output links, metadata, QC, audit rows, and private-object paths.

Retain:

- All schema objects, migrations, enums, sequences, indexes, constraints, triggers, functions, grants, RLS policies, and Storage bucket/policies.
- Auth user/profile `83e604d2-41eb-40ed-82b2-21244052297b` (`inventory-test@yourdomain.org`), approved role `user`. This is treated as the requested production account; cleanup does not touch `auth.users` or `profiles`.
- Sample Source `618e78cc-ff50-4d9a-b625-b71b72845cd7`, nickname `STEMCELL`, full name `STEMCELL Technologies`, registration profile `STEMCELL_COA`.
- Its two configuration audit events: `SAMPLE_SOURCE_CREATED` and `SAMPLE_SOURCE_UPDATED`.
- Sequence current values. They are deliberately not reset: previously printed synthetic labels must never be reassigned to real samples.

Remove after explicit approval:

- Samples: `PBMC-000001`, `PBMC-000002`, `DNA-000001`, `DNA-000002`, `RNA-000001`, `RNA-000002`.
- Processing event: `PE-000001`.
- Three processing outputs: one PBMC aliquot plan and the pending DNA and RNA extractions.
- Five `processing_output_samples` links.
- Twelve operational audit events: five `LABEL_RESERVED`, five `LABEL_PRINTED`, one `PROCESSING_PLANNED`, and one `SOURCE_REGISTERED`.

Current dry run found zero rows in `source_registration_sessions`, `source_subjects`, `source_sample_metadata`, `sample_media`, `extraction_qc_measurements`, and `extraction_qc_artifacts`, and zero objects in private bucket `sample-media`. The guarded script includes these tables for referentially safe cleanup but refuses to execute if Storage objects or non-target samples/events/outputs appear after this report.

## Files and safety controls

- `supabase/scripts/preproduction_cleanup_inventory.sql` is read-only and reproduces the inventory report.
- `supabase/scripts/preproduction_cleanup_dry_run.sql` is the initial strict-prefix report demonstrating why `TEST-%` alone is unsafe.
- `supabase/scripts/preproduction_cleanup_execute.sql` is destructive but cannot run by itself. It requires a separate session-local confirmation token, targets an exact root UUID, checks expected counts, rejects any newly appearing non-target operational data or Storage objects, uses one transaction, and rolls back if either deletion or post-cleanup verification differs from expectations.

This is intentionally not a migration: deleting deployment-specific acceptance data should not be replayed in new projects or become part of schema history.

## Approval and execution

The owner approved the exact report. The inventory was rerun immediately before execution and matched the expected counts. The guarded transaction committed successfully, and the execution file was returned to its locked state without the session-local approval token.

After commit, run the inventory report again and verify:

- Every operational table listed above has zero rows.
- Private `sample-media` has zero objects.
- Exactly one profile and Auth account remain usable.
- The STEMCELL Sample Source remains selectable with profile `STEMCELL_COA`.
- Exactly the two Sample Source configuration audit events remain.
- Migration history still agrees through `202609070004`.
- RLS/functions/grants remain unchanged.

Post-cleanup verification found zero rows in every operational table and zero private `sample-media` objects. One approved Auth user/profile, the STEMCELL Sample Source, and its two configuration audit events remain. No protected table has RLS disabled, all required functions remain present, and local/remote migration history agrees through `202609070004`.

The first imported/registered real sample will use the next sequence value, not reuse a synthetic identifier.
