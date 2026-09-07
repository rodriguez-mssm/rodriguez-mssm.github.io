# Synthetic V1 Acceptance Test

Run in a new Supabase project after all five migrations and frontend configuration. Use only synthetic external references and record the database-generated IDs on a temporary test worksheet.

The V1 always generates immutable IDs such as `PBMC-000001`; it does not accept a caller-selected `sample_id`. Wherever this plan names `TEST-PBMC-001` or `TEST-SERUM-001`, enter that value in **External/lab reference**, then use the generated Sample ID for scanning/searching. This tests the requested synthetic records without bypassing the implemented ID strategy.

## Test 0: Sample Sources

1. Sign in as an approved synthetic-test user and open **Sample Sources**.
2. Add `STEMCELL Technologies`, nickname `STEMCELL`, URL `https://www.stemcell.com/`. Expect it to appear immediately.
3. Attempt to add another source with nickname `stemcell`. Expect the case-insensitive uniqueness constraint to reject it.
4. Edit the full name or URL and save. Confirm `SAMPLE_SOURCE_CREATED` and `SAMPLE_SOURCE_UPDATED` exist in `audit_events` with the source UUID in metadata.
5. Sign out and request `/rest/v1/sample_sources?select=*` with the publishable key only. Expect no rows. Repeat with an authenticated but unapproved user and expect no rows/RPC rejection.
6. Confirm an approved user can read and create sources but cannot directly insert, update, or delete `sample_sources`.
7. There is no delete UI. Confirm a database delete of a source referenced by a sample is blocked by the foreign key.
8. Edit STEMCELL and select **STEMCELL COA registration**. Confirm another source remains **Generic manual registration** and still shows the prior manual form.

Sample Source means the external/provider origin. Parent Sample means the immediate physical lineage and is not interchangeable with Sample Source.

## Test 0A: STEMCELL reviewed registration and private media

1. Select STEMCELL under **Register source**. Confirm the COA/photo workflow appears instead of the generic form.
2. Select a synthetic PDF from `tests/fixtures/stemcell_coa/` and optionally capture a synthetic package photo. Confirm no sample row exists before review confirmation.
3. Confirm embedded text is attempted first and OCR is reported only when needed. Review Extracted/Missing badges and change one harmless field; expect **User-edited**.
4. Confirm PBMC/BMMNC/serum product mapping and normalized cell/volume quantity match the adjacent `expected.json` entry. For ambiguous descriptions, ensure Sample Type remains unselected.
5. Submit without the review checkbox, including by direct RPC. Expect rejection and no sample.
6. Check the review confirmation and register. Verify `SOURCE_REGISTERED` and `SOURCE_METADATA_RECORDED`, a linked `source_sample_metadata` row, and linked COA/photo `sample_media` rows.
7. Search by donor ID, lot number, and catalog number. Confirm the root and descendants are found while concise results do not display all demographics.
8. Open the root detail. Confirm the COA uses a short-lived signed URL and the optional image appears. No public Storage URL should work.
9. Sign out and repeat Storage/table reads with only the publishable key; expect denial/no rows. Repeat while authenticated but unapproved; expect denial/no rows and RPC rejection.

## Test 1: PBMC multi-output

1. Sign in as an approved synthetic test user.
2. Open **Register source** and select `STEMCELL`. Upload a synthetic PBMC COA fixture, review it, set External/lab reference to `TEST-PBMC-001`, confirm the normalized Cell count is `100`, and complete reviewed registration.
3. Record the generated `PBMC-NNNNNN` source ID. Search it and verify ACTIVE, original/current 100M, no parent, and `SOURCE_REGISTERED` history.
4. Open **Process sample**, find that generated source ID, and configure:
   - PBMC / Aliquot: amount 10, count 6 (60M allocation).
   - DNA / Extraction: source input 20, expected volume 90 µL, max 50 µL (2 labels).
   - RNA / Extraction: source input 20, expected volume 90 µL, max 50 µL (2 labels).
5. Verify Available 100M, Allocated 100M, Expected remaining 0M.
6. Add another 10M output. Verify the UI displays a blocking over-allocation error and disables plan creation. Remove it.
7. Create the plan. Record the generated `PE-NNNNNN`. Verify 10 planned sample records: 6 PBMC, 2 DNA, 2 RNA.
   Verify the root and all 10 planned descendants have the same STEMCELL `sample_source_id`; no processing form asks for Sample Source again.
8. Generate the label PDF. Verify ten human-readable IDs/codes and no record content beyond the Sample ID in each code.
9. Activate only two of the six planned PBMC aliquots. Search all six IDs: exactly two are ACTIVE; the other four remain PLANNED and are not physical active inventory.
10. In **Table Editor → audit_events**, filter `processing_event_id` to the event UUID. Verify one `PROCESSING_PLANNED`, ten `LABEL_RESERVED`, ten `LABEL_PRINTED`, and two `SAMPLE_ACTIVATED` events.

Database bypass check: with an approved-user access token, call `create_processing_plan` directly using an aliquot whose `source_allocation` is smaller than `amount_each × requested_count`. Expect an error and no new event/samples/reservation.

## Test 2: DNA results

1. Open **Pending processing** and select the DNA output from Test 1.
2. Verify expected volume 90 µL, maximum 50 µL, and two planned vials.
3. Enter Actual volume `92` and Concentration `70`.
4. Verify total mass displays 6,440 ng and 6.44 µg.
5. Verify the suggested distribution is `50 + 42`. Save it.
6. Confirm no additional vial was created.
7. Activate both DNA vial IDs.
8. Search each vial. Verify both inherit 70 ng/µL. Verify:
   - 50 × 70 = 3,500 ng.
   - 42 × 70 = 2,940 ng.
   - 3,500 + 2,940 = 6,440 ng.
9. Verify one `EXTRACTION_RESULTS_RECORDED` audit event on the source/event, followed by one `SAMPLE_ACTIVATED` event for each DNA tube.
10. Attempt to submit results for the same output again through a direct RPC call. Expect `Output is not awaiting extraction results` and no duplicate consumption/event.

## Test 3: higher-than-expected yield

1. Register a second synthetic PBMC source under a synthetic Sample Source using external reference `TEST-PBMC-HIGH-YIELD-001` and sufficient cells.
2. Plan a DNA extraction with source input 20M, expected 90 µL, and maximum 50 µL. Verify two labels / 100 µL planned capacity.
3. Open its pending result and enter Actual volume `130`, concentration `70`.
4. Verify the application reports one additional vial required and suggests `50 + 50 + 30`.
5. Save results. Verify exactly one new unique DNA Sample ID is returned and the additional-label button appears.
6. Generate the one-label additional PDF.
7. Search/inspect the three planned DNA records and verify distribution 50, 50, and 30 µL; total 130 µL; no vial exceeds 50 µL.
8. Verify one `ADDITIONAL_VIAL_CREATED` event for the new ID, one `LABEL_PRINTED` event after its PDF is generated, and one `EXTRACTION_RESULTS_RECORDED` event.

## Test 4: serum

1. Open **Register source**. Select a synthetic Sample Source and Serum, enter External/lab reference `TEST-SERUM-001` and Volume `10000` µL. Register and record the generated `SERUM-NNNNNN` ID.
2. Process it into Serum / Aliquot, 500 µL each, count 20. Verify 10,000 µL allocated and zero expected unreserved remainder.
3. Create the plan and generate 20 labels.
4. Activate exactly 18 planned samples.
5. For the remaining two planned sample IDs, use **Confirm samples → manual Sample ID** and choose **Mark not created**.
6. Search/count output records. Verify exactly 18 ACTIVE and 2 NOT_CREATED; no query for `status=eq.ACTIVE` returns 20.
7. Verify the source has 1,000 µL current and 0 µL reserved: only 18 × 500 µL was physically consumed; two unused reservations were released.
8. Verify 18 `SAMPLE_ACTIVATED`, two `SAMPLE_NOT_CREATED`, 20 `LABEL_RESERVED`, and 20 `LABEL_PRINTED` audit events for this plan.

## Test 5: authorization

Use a private browser for unauthenticated checks, a deliberately unapproved synthetic account, and the approved account. Substitute the public project values below; do not use a secret/service-role key.

### Unauthenticated

1. Visit the production `/inventory/` URL in a private window. Verify Login only; no sample request is issued before authentication.
2. Direct read:

```sh
curl -i 'https://PROJECT_REF.supabase.co/rest/v1/samples?select=*' \
  -H 'apikey: sb_publishable_REPLACE_ME'
```

Expect no rows (`[]`) or an authorization denial, never inventory data.

3. Direct table write:

```sh
curl -i 'https://PROJECT_REF.supabase.co/rest/v1/samples' \
  -X POST \
  -H 'apikey: sb_publishable_REPLACE_ME' \
  -H 'Content-Type: application/json' \
  -d '{"sample_id":"TEST-BYPASS-001","sample_type":"PBMC","status":"ACTIVE"}'
```

Expect permission/RLS denial and no inserted row.

4. Anonymous RPC:

```sh
curl -i 'https://PROJECT_REF.supabase.co/rest/v1/rpc/register_source_sample' \
  -X POST \
  -H 'apikey: sb_publishable_REPLACE_ME' \
  -H 'Content-Type: application/json' \
  -d '{"p_payload":{"sample_type":"PBMC","cell_count_million":1,"external_id":"TEST-ANON-BYPASS"}}'
```

Expect function permission denial.

### Authenticated but unapproved

1. In **Authentication → Users**, create a second synthetic account. Confirm its `profiles.approved` remains false.
2. Sign in. Verify **Access pending**.
3. Obtain that test session’s access token only in a controlled test environment. Repeat the read and RPC requests with `Authorization: Bearer UNAPPROVED_ACCESS_TOKEN`. Expect no inventory rows and `Inventory access is not approved` for the RPC.
4. Attempt direct PATCH of the account’s profile to set `approved=true`. Expect denial and verify the profile remains false.

### Approved user

1. Sign in as the approved account. Verify inventory searches and Tests 1–4 succeed.
2. Attempt direct POST/PATCH/DELETE against `samples` and `audit_events` with the approved token. Expect denial; normal mutations must go through RPCs.
3. Call the removed `add_output_vials` RPC with the approved token. Expect function permission denial.
4. Search inventory for `STEMCELL`. Expect samples associated with that Sample Source by nickname or full name.

## Final audit-event inventory

The implementation’s exact V1 event names are:

- `SOURCE_REGISTERED`
- `SOURCE_MEDIA_UPLOADED`
- `SOURCE_METADATA_RECORDED`
- `SAMPLE_SOURCE_CREATED`
- `SAMPLE_SOURCE_UPDATED`
- `PROCESSING_PLANNED`
- `LABEL_RESERVED`
- `LABEL_PRINTED` (the application recorded PDF generation; not proof of physical printing)
- `SAMPLE_ACTIVATED`
- `EXTRACTION_RESULTS_RECORDED`
- `SAMPLE_NOT_CREATED`
- `ADDITIONAL_VIAL_CREATED`

For each acceptance event, verify `actor_id`, timestamp, related sample/event/output UUIDs where applicable, and synthetic-only metadata. Normal application users must be unable to update or delete these rows.
