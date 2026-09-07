import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { filterSampleSources, validateSampleSource } from "../inventory/js/sample-sources.js";
import { buildSourceSamplePayload } from "../inventory/js/registration-payload.js";

const migrationUrl = new URL("../supabase/migrations/202609070001_sample_sources.sql", import.meta.url);
const sourceId = "11111111-1111-4111-8111-111111111111";

test("valid STEMCELL Sample Source is normalized", () => {
  assert.deepEqual(validateSampleSource({
    name: " STEMCELL Technologies ",
    nickname: " STEMCELL ",
    url: "https://www.stemcell.com/",
  }), {
    name: "STEMCELL Technologies",
    nickname: "STEMCELL",
    url: "https://www.stemcell.com/",
  });
});

test("Sample Source URL rejects invalid and non-http values", () => {
  assert.throws(() => validateSampleSource({ name: "Vendor", nickname: "V", url: "not a URL" }), /valid http/i);
  assert.throws(() => validateSampleSource({ name: "Vendor", nickname: "V", url: "javascript:alert(1)" }), /must use http/i);
});

test("root registration requires a Sample Source UUID", () => {
  assert.throws(() => buildSourceSamplePayload({ sampleType: "PBMC", cellCount: 100 }), /Select a valid Sample Source/);
  assert.equal(buildSourceSamplePayload({ sampleSourceId: sourceId, sampleType: "PBMC", cellCount: 100 }).sample_source_id, sourceId);
});

test("Sample Source search matches nickname and full name", () => {
  const sources = [
    { id: sourceId, nickname: "STEMCELL", name: "STEMCELL Technologies" },
    { id: "22222222-2222-4222-8222-222222222222", nickname: "Smith Lab", name: "Jane Smith Lab, Example University" },
  ];
  assert.deepEqual(filterSampleSources(sources, "stemcell").map(({ id }) => id), [sourceId]);
  assert.equal(filterSampleSources(sources, "Technologies")[0].id, sourceId);
});

test("migration enforces uniqueness, source registration, inheritance, RLS, and no delete", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create unique index sample_sources_nickname_ci_key[^;]+lower\(nickname\)/i);
  assert.match(sql, /A valid sample source is required/i);
  assert.match(sql, /new\.sample_source_id := parent_source_id/i);
  assert.match(sql, /before insert on public\.samples[\s\S]+enforce_sample_source_inheritance/i);
  assert.match(sql, /alter table public\.sample_sources enable row level security/i);
  assert.match(sql, /sample_sources_read_approved[\s\S]+is_approved_lab_user/i);
  assert.match(sql, /revoke all privileges on table public\.sample_sources from anon, authenticated/i);
  assert.match(sql, /grant select on table public\.sample_sources to authenticated/i);
  assert.doesNotMatch(sql, /grant\s+delete/i);
  assert.match(sql, /references public\.sample_sources\(id\) on delete restrict/i);
});

test("approved-only Sample Source RPCs are audited and fixed-search-path", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const fn of ["create_sample_source", "update_sample_source"]) {
    const body = sql.match(new RegExp(`function public\\.${fn}\\([^]*?end \\$\\$;`, "i"))?.[0] || "";
    assert.match(body, /security definer set search_path = public, pg_temp/i);
    assert.match(body, /perform public\.assert_approved\(\)/i);
  }
  assert.match(sql, /SAMPLE_SOURCE_CREATED/);
  assert.match(sql, /SAMPLE_SOURCE_UPDATED/);
  assert.match(sql, /SOURCE_REGISTERED[\s\S]+sample_source_id/i);
});

test("processing children inherit source without frontend reselection", async () => {
  const [sql, app] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(new URL("../inventory/js/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(sql, /if new\.parent_sample_id is null/i);
  assert.match(sql, /select sample_source_id into parent_source_id/i);
  assert.match(sql, /new\.sample_source_id := parent_source_id/i);
  assert.doesNotMatch(app.match(/function outputEditor[^]*?function updateOutputFromForm/)?.[0] || "", /sampleSource/i);
});

test("inventory API joins and filters samples by Sample Source", async () => {
  const api = await readFile(new URL("../inventory/js/api.js", import.meta.url), "utf8");
  assert.match(api, /sample_source:sample_source_id\(id,name,nickname,url\)/);
  assert.match(api, /\.in\("sample_source_id", matchingSources/);
});
