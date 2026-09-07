# V1 Deployment Checklist

Use only synthetic records until every authorization and workflow check below passes. Check off each item in order.

## 1. Create and secure the Supabase project

- [ ] Sign in to the Supabase Dashboard and select **New project**.
- [ ] Choose the institutionally approved organization, project name, region, and database password. Save the database password in the approved password manager; it does not belong in Git or the browser.
- [ ] Wait until project provisioning completes.
- [ ] Open **Authentication → Providers → Email**. Enable the Email provider and turn **Allow new users to sign up** off. Do not enable anonymous sign-ins.
- [ ] Open **Authentication → URL Configuration**. Set **Site URL** to `https://rodriguez-mssm.github.io/inventory/`. Add `http://localhost:8000/inventory/` under **Redirect URLs** for controlled local testing, and retain the production URL there if the dashboard requires an explicit redirect entry.

These Auth settings are project-level controls and are the principal manual settings not represented in database SQL.

## 2. Obtain the two public frontend values

- [ ] In the project, click **Connect**, or open **Project Settings → API Keys**.
- [ ] Copy the project URL, shaped like `https://PROJECT_REF.supabase.co`.
- [ ] Copy a **Publishable key**, shaped like `sb_publishable_...`. A legacy `anon` JWT is also supported, but use the publishable key for a new project.
- [ ] Do **not** copy a secret key, legacy `service_role` key, database password, access token, or connection string into the frontend.

Only the project URL and publishable/anon key are required by `inventory/js/supabase.js`.

## 3. Apply the reproducible database migrations

Preferred CLI procedure from the repository root:

```sh
supabase init
supabase login
supabase link --project-ref PROJECT_REF
supabase db push --dry-run
supabase db push
supabase migration list
```

Run `supabase init` once because this repository currently contains migrations but no local `supabase/config.toml`; accept the generated local defaults and commit that generated non-secret file if the CLI creates it. Do not put the database password or access token in it.

- [ ] Confirm the dry run lists these files in order:
  1. `202609050001_inventory_v1.sql`
  2. `202609050002_harden_inventory_rpcs.sql`
  3. `202609060001_enforce_browser_least_privilege.sql`
  4. `202609070001_sample_sources.sql`
  5. `202609070002_source_registration_profiles.sql`
  6. `202609070003_require_stemcell_intake_photo.sql`
- [ ] Apply all pending migrations with `supabase db push`.
- [ ] Confirm all six versions appear as local and remote in `supabase migration list`.

If the CLI cannot be used, open **SQL Editor → New query**, run the complete first migration, then the complete second migration. Record this operational exception: SQL Editor execution does not populate CLI migration history. Do not later use `db push` until migration history has been reconciled.

## 4. Verify the database objects

- [ ] Open **Table Editor** and confirm the prior seven tables plus `source_registration_sessions`, `source_subjects`, `source_sample_metadata`, and `sample_media`.
- [ ] Open **Storage** and confirm `sample-media` exists and is marked private. Do not make it public.
- [ ] Open **Database → Functions** and confirm the prior RPCs plus `begin_source_registration`, `record_registration_media`, `complete_source_registration`, `search_inventory_sample_ids`, and `get_sample_source_provenance`. Internal helpers should also exist but are not granted to browser roles.
- [ ] Open **Database → Triggers** and confirm `auth_user_profile` is attached to `auth.users` and calls `handle_new_user`.
- [ ] Open **Database → Policies**. Confirm RLS is enabled on all eleven public tables. Confirm the public-schema policies are self-read on `profiles` and approved-user SELECT policies on inventory/audit tables. Confirm Storage policies require approved users and no public/anonymous media policy exists.
- [ ] In **SQL Editor → New query**, run the verification query below. Expect eleven rows, each with `rowsecurity = true`:

```sql
select c.relname, c.relrowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles','sample_sources','samples','processing_events','processing_outputs','processing_output_samples','audit_events','source_registration_sessions','source_subjects','source_sample_metadata','sample_media')
order by c.relname;
```

- [ ] Verify callable browser functions. The result should contain the prior controlled RPCs plus `begin_source_registration`, `record_registration_media`, `complete_source_registration`, `search_inventory_sample_ids`, and `get_sample_source_provenance`. Internal mutation helpers and trigger functions must not be executable by `authenticated`.

```sql
select p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and has_function_privilege('authenticated', p.oid, 'EXECUTE')
order by p.proname;
```

- [ ] In **Database → Schema Visualizer** or **Table Editor**, spot-check primary keys, foreign keys, unique `samples.sample_id`, sequence-backed functions, quantity checks, reservation-within-current checks, parent self-reference check, indexes, and generated mass columns.

No tables, enums, sequences, indexes, constraints, functions, triggers, grants, or RLS policies need manual creation.

## Manual actions versus migrations

| Manual once per project | Reproduced by SQL/configuration |
|---|---|
| Create the Supabase project and choose organization/region/password | All application enums, sequences, tables, generated columns, keys, checks, and indexes |
| Disable public/anonymous signup and set Auth URLs | Auth-user profile trigger and default unapproved profile |
| Obtain the public project URL/key and place them in `inventory/config.js` | RLS enablement, policies, grants, and approved-user predicate |
| Create/invite Auth users and deliberately approve/disable profile rows | All workflow and audit functions, transaction locks, state/allocation validation |
| Push the repository and perform device/PDF checks | Static frontend behavior and configurable development label layout |

The first approval is intentionally a controlled data-administration action, not schema creation. No service-role or secret key is needed by the frontend.

## 5. Configure the static frontend

- [ ] Edit `inventory/config.js` to contain exactly the public values:

```js
export const APP_CONFIG = {
  supabaseUrl: "https://PROJECT_REF.supabase.co",
  supabaseAnonKey: "sb_publishable_REPLACE_ME",
  appBasePath: "/inventory/",
};
```

- [ ] Run `npm test`.
- [ ] Run `npm run serve`, open `http://localhost:8000/inventory/`, and confirm the login screen replaces “Setup required.”
- [ ] Confirm the repository contains no database password, secret key, legacy service-role key, access token, or connection string.

The publishable key is intentionally present in public source. RLS and function grants—not key secrecy—protect the database.

## 6. Create the first authorized account

- [ ] Open **Authentication → Users → Add user → Create new user**. Enter the first lab operator’s email and a temporary strong password. Use **Auto Confirm User** only for a controlled account whose email has already been verified administratively. Alternatively select **Send invitation** and let the user complete the invite.
- [ ] Confirm a row for that Auth user automatically appears in **Table Editor → profiles** with `approved = false`, `role = user`, and `disabled_at = null`.
- [ ] Before approval, sign in at `/inventory/`. Confirm the page says **Access pending** and no inventory navigation/data appears.
- [ ] Open **SQL Editor → New query** and approve the first account. Use `admin` only to identify the initial responsible operator; V1 `admin` does not have broader browser/database privileges than `user`:

```sql
update public.profiles
set approved = true,
    role = 'admin',
    display_name = 'Initial lab administrator',
    disabled_at = null,
    updated_at = now()
where id = (select id from auth.users where email = 'SYNTHETIC-TEST-ACCOUNT@example.org');
```

- [ ] Verify exactly one row was updated. Sign out and back in; the Home screen should load.
- [ ] For later ordinary users, repeat user creation and set `approved = true, role = 'user'` only after authorization is confirmed.

The application has no signup form and no browser administration panel. Disabling public signup prevents discovery-based account creation; even if an account is created through another enabled Auth route, the trigger gives it `approved = false`, and RLS/RPC checks deny inventory access.

## 7. Run authorization validation

- [ ] Complete Test 5 in `docs/ACCEPTANCE_TEST.md` before creating workflow data.
- [ ] Verify an unauthenticated REST read returns no rows and an anonymous RPC call fails.
- [ ] Verify an authenticated but unapproved user can read only their own profile row, cannot read inventory tables, cannot write tables, and cannot run workflow RPCs successfully.
- [ ] Verify an approved user can SELECT inventory/Sample Sources and execute the controlled workflow RPCs, but still cannot directly INSERT/UPDATE/DELETE inventory or audit rows.

## 8. Run the synthetic workflow acceptance test

- [ ] Complete Tests 0–4 in `docs/ACCEPTANCE_TEST.md` using only synthetic external references and database-generated Sample IDs.
- [ ] Verify processing-plan creation and source over-allocation rejection.
- [ ] Verify pending extraction results, calculated mass, editable distribution, and additional-vial creation.
- [ ] Verify planned labels do not count as active physical samples.
- [ ] Verify activation and `NOT_CREATED` transitions.
- [ ] In **Table Editor → audit_events**, filter by the synthetic samples/events and confirm all expected events listed in the acceptance test.

## 9. Deploy GitHub Pages

The repository’s verified Pages configuration is **legacy branch deployment**, `main`, `/(root)`, public, with HTTPS enforced.

- [ ] Commit the reviewed files, including all six migrations and `inventory/config.js` containing only the public URL/key.
- [ ] Push the commit to `origin/main`.
- [ ] On GitHub open **rodriguez-mssm/rodriguez-mssm.github.io → Settings → Pages**.
- [ ] Under **Build and deployment**, confirm **Deploy from a branch**, branch **main**, folder **/(root)**. Do not change it to `/docs`; that would omit `inventory/` and alter the current site.
- [ ] Open the repository’s **Actions** tab and wait for the Pages build/deployment to succeed.
- [ ] Open `https://rodriguez-mssm.github.io/` and confirm the existing root page still works.
- [ ] Open `https://rodriguez-mssm.github.io/inventory/` in a private window and confirm it shows Login, not inventory data.

## 10. Mobile camera and label checks

- [ ] On current Android Chrome and iPhone Safari, open the production HTTPS URL, sign in with the approved synthetic test account, and allow camera access only when **Start camera** is tapped.
- [ ] Scan a synthetic generated label using the rear camera. Confirm one scan result, clear feedback, explicit activation confirmation, and readiness for the next scan.
- [ ] Deny camera permission once and verify manual Sample ID entry remains usable. Restore permission in browser/site settings.
- [ ] Generate a synthetic multi-label PDF and an additional one-vial PDF. Confirm human ID, type, planned amount where applicable, and a decodable Data Matrix/QR containing only `sample_id`.
- [ ] Open **Label calibration**, generate the 85-position sheet, and print it on ordinary paper at **Actual size / 100%** with all fit/shrink/printable-area scaling disabled.
- [ ] Overlay it on the physical CryoLabel sheet and check positions 1, 5, 81, and 85 for cumulative drift. Adjust only `inventory/js/label-config.js` and repeat if necessary.
- [ ] Verify partial-sheet printing: Start position 80 accepts six labels and rejects seven unless multi-page printing is explicitly enabled.
- [ ] **PRODUCTION LABEL PRINTING REMAINS BLOCKED until this physical overlay/calibration succeeds.**
- [ ] Confirm the PDF page is generated with configured physical units and the print dialog offers **Actual size / 100%**.

> **PRODUCTION LABEL PRINTING IS BLOCKED UNTIL THE EXACT LABEL PRODUCT AND DIMENSIONS ARE PROVIDED.** The current template is for development validation only.

## 11. Final public-exposure check

- [ ] View `https://rodriguez-mssm.github.io/inventory/config.js`. It may reveal only the project URL, publishable/anon key, and base path.
- [ ] Search the repository and built site for `service_role`, `sb_secret_`, database passwords, connection strings, real sample identifiers, or PHI. References explaining that privileged keys are forbidden are expected in documentation; actual key values, credentials, real identifiers, and PHI must have no matches.
- [ ] In a signed-out private window, repeat direct REST and RPC denial checks after deployment.
- [ ] Retain screenshots/test evidence using synthetic IDs only and store them in an approved location, not this public repository.
