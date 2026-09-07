# Google Sheet Migration Plan

The existing sheet is not the production database and no real rows should be committed. Migration should occur only after field semantics are reviewed with a knowledgeable lab member, IDs are de-duplicated, and a backup is retained in approved storage.

| Existing field | Proposed destination | Review required |
|---|---|---|
| `Sample_ID` | `samples.sample_id` or `external_id` | Existing values may not match the new immutable format. Preserve old values as `external_id` unless formally adopted and validated unique. |
| `Donor ID` | Future controlled research-source table / external reference | Potentially sensitive research data. Confirm governance and avoid PHI. Do not place it in free-text notes. |
| `Batch #` | Future batch/run table or an import audit metadata field | Determine whether this means processing event, receipt batch, assay batch, or freezer batch. |
| `Aliquot` | Usually represented by one `samples` row plus its parent/output ordinal | Determine whether values are physical tubes or only counts. Do not infer lineage from aliquot text alone. |
| `Type` | `samples.sample_type` | Normalize spelling/case and map unknown types explicitly. |
| `Parent PBMC` | `samples.parent_sample_id` | Rename conceptually to generic parent. Resolve values to a unique sample; parent may be any type. |
| `Cell (million)` | `original_cell_count_million` | Confirm whether this is original, planned, measured, or per-aliquot quantity. |
| `Current Cell Count` | `current_cell_count_million` | Confirm measurement date and whether prior consumption is trustworthy. |
| `Used?` | `samples.status` plus imported audit event(s) | Ambiguous: partially used, consumed, discarded, or checked out must not all become one state. |
| `Box`, `Position` | Future storage-location/movement module | Preserve in the source export but do not add premature freezer workflows to V1. Validate duplicate positions. |

## Staged migration

1. Export a read-only snapshot and inventory its columns without committing it.
2. Profile duplicate/missing IDs, invalid quantities, unit inconsistencies, and broken parent links.
3. Produce a de-identified mapping specification and exception report.
4. Load into a disposable Supabase project using a service-side script and validate counts, parent relationships, quantities, and statuses.
5. Have lab staff spot-check representative PBMC, serum/plasma, DNA/RNA, used, and aliquoted records.
6. Perform the production import in one controlled window, append `LEGACY_RECORD_IMPORTED` audit events, and retain reconciliation totals.

Do not invent parent links from naming patterns. Ambiguous records should be quarantined for review rather than silently coerced.
