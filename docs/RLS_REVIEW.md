# RLS and RPC Security Review

Review scope: all five migrations, browser data calls, table/Storage grants, RLS policies, trigger behavior, and every `SECURITY DEFINER` function. The browser UI is not treated as a security boundary.

## Access summary

| Principal | SELECT | INSERT / UPDATE / DELETE | RPCs |
|---|---|---|---|
| Unauthenticated (`anon`) | No inventory/profile rows. Static public HTML/CSS/JS and public configuration remain visible. | No table privileges or policies. | No EXECUTE grants. Calls fail before workflow code can run. |
| Authenticated, unapproved | May read only their own `profiles` row, including approval status. No inventory or audit rows. | No direct mutation policies; cannot approve themselves. | The six public workflow RPCs are discoverable/callable at the API layer, but each immediately calls `assert_approved()` and fails. Internal functions are not granted. |
| Approved `user` | May SELECT inventory, Sample Source, source registration/metadata/media, processing, linkage, and audit rows; may read their own profile and private media. | No direct public-table mutations. Storage INSERT is limited to the user's UUID prefix; no browser update/delete. | May execute processing, Sample Source, draft-media, reviewed-completion, and search RPCs. Database constraints, locks, triggers, and RPC validation enforce rules. |
| Approved `admin` | Exactly the same browser/database access as approved `user` in V1. | Exactly the same as approved `user`. | Exactly the same as approved `user`. The role is reserved metadata; user approval/administration is performed by a Supabase project administrator in the Dashboard/SQL environment. |

Supabase project owners/administrators using the Dashboard, SQL Editor, database credentials, or a secret/service-role key are outside browser RLS and can administer the database. Those credentials must never be exposed to the static site.

## Signup, profiles, and approval

- The frontend implements email/password **login only**; it has no signup method or form.
- Project deployment must disable **Authentication → Providers → Email → Allow new users to sign up** and anonymous sign-ins.
- Every `auth.users` insert fires `auth_user_profile`. The trigger creates `profiles(id, role='user', approved=false)`.
- `profile_read_self` allows an authenticated account to see only its own profile. There is no profile UPDATE policy, so the user cannot set `approved` or change `role`.
- `is_approved_lab_user()` requires `auth.uid()` to match an approved profile with `disabled_at is null`. Its fixed `search_path` avoids object-shadowing.
- Disabling a profile immediately makes inventory SELECT policies false and makes `assert_approved()` reject workflow RPCs.

Even if project signup is accidentally enabled, a new account is unapproved and has no inventory access. Disabling signup remains required to avoid unwanted Auth accounts and abuse.

## Table operations

All eleven public application tables have RLS enabled. The migrations grant authenticated users SELECT only. The policies further reduce access:

- `profiles`: own row only.
- `sample_sources`, `samples`, processing tables, `source_registration_sessions`, `source_subjects`, `source_sample_metadata`, `sample_media`, and `audit_events`: all rows only when `is_approved_lab_user()` is true.
- No table has an INSERT, UPDATE, or DELETE policy for `anon` or `authenticated`.
- `anon` has all public-table privileges explicitly revoked.
- Sequences are not callable by `anon` or `authenticated`.
- Audit events are append-only for browser users because they can read them but cannot mutate them directly.

Therefore a caller cannot bypass an RPC by issuing a direct REST INSERT/UPDATE/DELETE, even with a valid approved-user JWT.

## SECURITY DEFINER review

Every `SECURITY DEFINER` function fixes `search_path` to `public, pg_temp`. Public and anonymous EXECUTE privileges are revoked. The controlled functions granted to `authenticated` are:

1. `register_source_sample(jsonb)`
2. `create_processing_plan(jsonb)`
3. `record_extraction_results(uuid,numeric,numeric,numeric[],boolean)`
4. `activate_sample(text)`
5. `mark_sample_not_created(text)`
6. `mark_labels_printed(uuid[])`
7. `create_sample_source(text,text,text,source_registration_profile)`
8. `update_sample_source(uuid,text,text,text,source_registration_profile)`
9. `begin_source_registration(uuid)`
10. `record_registration_media(...)`
11. `complete_source_registration(uuid,jsonb)`
12. `search_inventory_sample_ids(text,boolean)`
13. `get_sample_source_provenance(uuid)`

The fifth migration replaces the Sample Source RPC signatures to include the registration profile and adds draft/media/completion/search RPCs. Each is approval-gated and fixed-search-path. Generic registration rejects a source configured for a profile workflow, and completion rejects any request without `review_confirmed=true`.

Each workflow RPC begins with `assert_approved()`. `is_approved_lab_user()` is also executable by `authenticated` because PostgreSQL must call it while evaluating SELECT policies; it returns only whether the current session is approved. Internal mutation functions—including `next_sample_identifier`, `refresh_processing_event_status`, `add_output_vials_internal`, `assert_approved`, and the no-longer-public `add_output_vials` wrapper—have no browser-role EXECUTE grant.

Function-specific controls:

- `register_source_sample`: validates enum type and required non-negative canonical quantity; PostgreSQL generates the immutable Sample ID and audit event.
- `create_processing_plan`: locks the source row; requires active source; validates output structure/count; requires same-type aliquots; derives/validates aliquot allocation as amount × count; validates DNA/RNA extraction shape and computed vial count; checks unreserved source quantity; reserves material and creates the entire plan atomically.
- `record_extraction_results`: locks output/event/source; requires pending extraction state; rejects null/non-positive vial volumes and missing measurements; checks conservation within 0.01 µL; enforces capacity unless explicitly audited override; creates only the additional vials required; consumes the planned source allocation once; records results and audit atomically.
- `activate_sample`: locks the sample; accepts only `PLANNED`; requires extraction results before extraction vial activation; consumes aliquot source once; updates quantities and appends one activation event. A repeated call fails before another event or consumption occurs.
- `mark_sample_not_created`: locks the sample; accepts only `PLANNED`; prevents premature extraction-vial disposition; releases aliquot reservation once and appends history.
- `mark_labels_printed`: records label-print events only for existing sample UUIDs. It does not activate samples or change quantities.
- `create_sample_source` / `update_sample_source`: require approval, validate through table constraints, preserve UUID identity, and append `SAMPLE_SOURCE_CREATED` / `SAMPLE_SOURCE_UPDATED`. No delete function is exposed.

The transaction aborts on any exception, so partial plan/result/state changes are not committed.

## Finding and remediation

The initial migration correctly separated authentication from approval and blocked direct table writes, but three direct-RPC invariants required hardening:

- A malicious approved caller could supply an aliquot `source_allocation` smaller than `amount_each × count`.
- Extraction result arrays could contain null values or otherwise incomplete measurements.
- The standalone `add_output_vials` wrapper was unnecessarily executable by approved browser users outside result entry.

Migration `202609050002_harden_inventory_rpcs.sql` fixes these issues without altering the original migration. It also adds database constraints preventing reserved quantity from exceeding current quantity and caps a single output plan at 1,000 sample records to limit accidental/hostile oversized requests.

A live catalog review then found that Supabase's project default privileges had granted authenticated users direct table privileges and EXECUTE on newly created internal functions. RLS still blocked direct table writes, but `add_output_vials_internal` was an unsafe callable `SECURITY DEFINER` path. Migration `202609060001_enforce_browser_least_privilege.sql` explicitly revokes all browser table/function/sequence privileges and reconstructs only the intended SELECT and RPC surface. This third migration is required.

Migration `202609070001_sample_sources.sql` creates the RLS-protected provider/origin table, grants authenticated users SELECT only behind the approved-user policy, and exposes only audited create/update RPCs. New root samples require a valid source. A non-definer insert trigger copies the parent's source to descendants and rejects conflicting source IDs. No delete privilege or RPC exists, and the foreign key uses `ON DELETE RESTRICT`.

Migration `202609070002_source_registration_profiles.sql` adds approval-gated draft sessions, donor identity, root-only metadata, private media references, and the private Storage bucket. Storage object SELECT requires approval; INSERT additionally requires the first object-path component to equal `auth.uid()`. No anonymous/public, update, or delete Storage policy is created.

## Residual limitations

- `admin` is not an elevated application role in V1. A Supabase project administrator must create, approve, disable, and inspect accounts.
- An approved user can read all V1 research inventory and perform all normal bench workflows. There is no per-study or per-row tenancy.
- `mark_labels_printed` records the browser’s successful PDF-generation action; it cannot prove that a printer physically printed or correctly scaled the sheet.
- A project owner, database credential holder, or secret/service-role key bypasses browser RLS. Operational credential control remains essential.
- Live allow/deny behavior must be verified against the deployed project as specified in the deployment checklist and acceptance test.
