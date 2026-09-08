import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildSourceSamplePayload } from "../inventory/js/registration-payload.js";

const sourceId = "11111111-1111-4111-8111-111111111111";
const migrationUrl = new URL("../supabase/migrations/202609070005_sample_location.sql", import.meta.url);

test("generic intake trims and serializes sample location", () => {
  const payload = buildSourceSamplePayload({ sampleSourceId: sourceId, sampleType: "PBMC", cellCount: 100, sampleLocation: "  Freezer 2 / Rack A / Box 4  " });
  assert.equal(payload.sample_location, "Freezer 2 / Rack A / Box 4");
  assert.equal(buildSourceSamplePayload({ sampleSourceId: sourceId, sampleType: "PBMC", cellCount: 100 }).sample_location, null);
});

test("sample location rejects more than 200 characters", () => {
  assert.throws(() => buildSourceSamplePayload({ sampleSourceId: sourceId, sampleType: "PBMC", cellCount: 100, sampleLocation: "x".repeat(201) }), /200 characters/);
});

test("migration adds constrained location through hardened intake RPCs", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /alter table public\.samples add column sample_location text/i);
  assert.match(sql, /char_length\(sample_location\) <= 200/i);
  for (const fn of ["register_source_sample", "complete_source_registration"]) {
    const body = sql.match(new RegExp(`create function public\\.${fn}\\([^]*?end \\$\\$;`, "i"))?.[0] || "";
    assert.match(body, /security definer set search_path = public, pg_temp/i);
    assert.match(body, /perform public\.assert_approved\(\)/i);
    assert.match(body, /sample_location/);
  }
  assert.match(sql, /SAMPLE_LOCATION_ASSIGNED/);
  assert.match(sql, /revoke execute on function public\.register_source_sample_without_location_internal\(jsonb\) from public,anon,authenticated/i);
  assert.match(sql, /revoke execute on function public\.complete_source_registration_without_location_internal\(uuid,jsonb\) from public,anon,authenticated/i);
});

test("both generic and STEMCELL intake show location and sample detail displays it", async () => {
  const [app, stemcell] = await Promise.all([
    readFile(new URL("../inventory/js/app.js", import.meta.url), "utf8"),
    readFile(new URL("../inventory/js/stemcell-registration-ui.js", import.meta.url), "utf8"),
  ]);
  assert.match(app, /Sample location \(optional\)[\s\S]+id="registration-location"/);
  assert.match(app, /mountStemcellRegistration\([^)]*locationInput/);
  assert.match(app, /renderGenericRegistration\(container, source, locationInput\)/);
  assert.match(stemcell, /sample_location: locationInput\.value\.trim\(\) \|\| null/);
  assert.match(app, /<strong>Sample location:<\/strong>/);
});
