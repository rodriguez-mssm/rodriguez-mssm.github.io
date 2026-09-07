# Security and Data Handling

## Security model

The GitHub Pages code and its Supabase URL/publishable (or legacy anon) key are public. That key identifies the project and is safe to expose only because PostgreSQL Row Level Security is enabled. It is not an authorization boundary by itself.

The Supabase service-role key bypasses RLS. Never put it in `inventory/config.js`, browser storage, GitHub Actions intended for Pages output, commits, screenshots, or support messages. Use it only in a trusted administrative environment.

All inventory tables, including `sample_sources`, enable RLS. There are no anonymous policies or anonymous table privileges. Authenticated reads require an approved, non-disabled profile. Mutations use narrowly granted database functions which repeat that approval check and implement locked transactions. Application users cannot directly insert/update/delete audit history.

Sample Source metadata is protected research inventory metadata. Approved users may select it and may call only `create_sample_source` and `update_sample_source` for changes. Both are fixed-`search_path` `SECURITY DEFINER` functions, assert approval, and append audit events. There is no browser delete function or direct INSERT/UPDATE/DELETE grant; referenced sources are additionally protected by `ON DELETE RESTRICT`.

## Data rules

Do not enter PHI: no names, MRNs, dates of birth, diagnoses, or clinical free text. Sample identifiers still constitute protected research data in this application and in exports/backups. Avoid embedding data beyond `sample_id` in barcodes.

Use an institutionally approved Supabase organization, region, account controls, retention policy, and contractual/compliance posture before production use. This repository does not itself establish HIPAA or institutional compliance.

## Authentication administration

Disable public registration. Create/invite users in Supabase Authentication, then approve the corresponding profile as documented in `inventory/README.md`. Use individual accounts, strong passwords, and MFA if enabled for the selected Supabase Auth plan/configuration. Disable departing users promptly. Review Auth logs and `audit_events` after suspicious activity.

The V1 role enum anticipates `admin` and `user`, but both approved roles have the same bench data permissions. Administration remains in the Supabase dashboard/SQL environment; this prevents a premature browser admin panel from holding elevated capabilities.

## RLS verification before bench use

After applying migrations:

1. With no session, request `/rest/v1/samples?select=*` using only the anon key. Expect HTTP 200 with `[]` (or an authorization response), never rows.
2. Attempt anonymous POST to `samples`. Expect denial.
3. Sign in as an unapproved user and repeat. Expect no inventory rows and RPC rejection.
4. Approve the profile, sign in again, and confirm reads/RPCs succeed.
5. Disable the profile and confirm a refreshed session can no longer read inventory or execute RPCs.
6. Confirm direct authenticated INSERT/UPDATE/DELETE against `audit_events` is denied.
7. Repeat anonymous and unapproved reads against `/rest/v1/sample_sources?select=*`; expect no rows. Confirm approved reads and the two approved-user RPCs work.

Static source tests in `tests/security.test.js` guard against accidentally omitting RLS or granting anon policies, but they do not replace live integration verification.

The detailed operation-by-operation review and RPC-hardening findings are documented in `docs/RLS_REVIEW.md`. Apply all four migrations in timestamp order. `202609070001_sample_sources.sql` adds the protected Sample Source model after the three deployed V1 migrations.

## Browser and supply-chain limitations

Pinned dependencies are currently retrieved from a public ESM CDN. CDN compromise or unavailability affects the app. Before regulated or offline production use, vendor dependencies with a reproducible lockfile/build and Content Security Policy. GitHub Pages cannot keep server secrets. Browser caches and downloaded PDFs may contain sample identifiers; use managed devices and delete unneeded downloads according to lab policy.

Report vulnerabilities privately to the repository owner; do not include real sample records, credentials, or exploitable production details in a public GitHub issue.
