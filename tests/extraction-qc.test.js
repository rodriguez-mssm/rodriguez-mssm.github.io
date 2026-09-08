import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { totalMassNg } from "../inventory/js/calculations.js";
import { nanodropRatios, purityRatio, validateIntegrity } from "../inventory/js/qc-calculations.js";

const migrationUrl = new URL("../supabase/migrations/202609070004_extraction_qc.sql", import.meta.url);

test("Qubit concentration and volume calculate DNA mass", () => {
  assert.equal(totalMassNg(92, 70), 6440);
  assert.equal(totalMassNg(92, 70) / 1000, 6.44);
});

test("NanoDrop ratios derive from raw absorbance", () => {
  const ratios = nanodropRatios({ a260: 1.42, a280: 0.78, a230: 0.68 });
  assert.ok(Math.abs(ratios.a260A280 - 1.8205128205) < 1e-9);
  assert.ok(Math.abs(ratios.a260A230 - 2.0882352941) < 1e-9);
});

test("missing and zero denominators produce unavailable ratios", () => {
  assert.equal(purityRatio(1.42, 0), null);
  assert.equal(purityRatio(1.42, null), null);
  assert.deepEqual(nanodropRatios({ a260: 1.42, a280: 0, a230: 0 }), { a260A280: null, a260A230: null });
});

test("DIN and RIN validate on the supported 1-10 scale", () => {
  assert.deepEqual(validateIntegrity("DNA", 8.9), { valid: true, value: 8.9 });
  assert.equal(validateIntegrity("DNA", 11).valid, false);
  assert.deepEqual(validateIntegrity("RNA", 9.1), { valid: true, value: 9.1 });
  assert.equal(validateIntegrity("RNA", -1).valid, false);
  assert.deepEqual(validateIntegrity("RNA", ""), { valid: true, value: null });
});

test("QC schema is extraction-level, queryable, generated, and RLS protected", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create table public\.extraction_qc_measurements/i);
  assert.match(sql, /processing_output_id uuid not null references public\.processing_outputs/i);
  assert.match(sql, /qubit_concentration_ng_ul numeric not null/i);
  assert.match(sql, /a230 numeric[\s\S]+a260 numeric[\s\S]+a280 numeric/i);
  assert.match(sql, /a260_a280_ratio numeric generated always/i);
  assert.match(sql, /a260_a230_ratio numeric generated always/i);
  assert.match(sql, /create trigger extraction_qc_measurement_binding/i);
  assert.match(sql, /QC yield must match the recorded extraction result/i);
  assert.match(sql, /revoke execute on function public\.validate_extraction_qc_measurement\(\) from public,anon,authenticated/i);
  for (const table of ["extraction_qc_measurements", "extraction_qc_artifacts"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`${table}_read_approved[\\s\\S]+is_approved_lab_user`, "i"));
  }
  assert.match(sql, /revoke all privileges on table public\.extraction_qc_measurements, public\.extraction_qc_artifacts from anon, authenticated/i);
  assert.match(sql, /grant select on table public\.extraction_qc_measurements, public\.extraction_qc_artifacts to authenticated/i);
});

test("QC mutations are approved fixed-search-path RPCs with hardened grants", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const fn of ["record_extraction_results_with_qc", "record_extraction_qc_artifact", "get_extraction_qc_for_sample"]) {
    const body = sql.match(new RegExp(`function public\\.${fn}\\([^]*?end \\$\\$;`, "i"))?.[0] || "";
    assert.match(body, /security definer set search_path = public, pg_temp/i);
    assert.match(body, /perform public\.assert_approved\(\)/i);
    assert.match(sql, new RegExp(`revoke execute on function public\\.${fn}\\([^;]+from public,anon`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^;]+to authenticated`, "i"));
  }
  assert.match(sql, /EXTRACTION_QC_RECORDED/);
  assert.match(sql, /QC_TRACE_UPLOADED/);
  assert.match(sql, /bucket_id='sample-media'/);
  assert.match(sql, /auth\.uid\(\)::text \|\| '\/qc\/'/);
});

test("result UI names Qubit explicitly and shows only the material-specific integrity metric", async () => {
  const app = await readFile(new URL("../inventory/js/app.js", import.meta.url), "utf8");
  assert.match(app, /Qubit concentration \(ng\/µL\)/);
  assert.match(app, /output\.output_type === "RNA" \? "RIN" : "DIN"/);
  assert.match(app, /recordResultsWithQc/);
  assert.match(app, /QC inherited from the pooled extraction/);
});
