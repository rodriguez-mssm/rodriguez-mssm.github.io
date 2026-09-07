import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/202609050001_inventory_v1.sql", import.meta.url);
const hardeningUrl = new URL("../supabase/migrations/202609050002_harden_inventory_rpcs.sql", import.meta.url);
const privilegeUrl = new URL("../supabase/migrations/202609060001_enforce_browser_least_privilege.sql", import.meta.url);

test("all protected inventory tables enable RLS", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of ["profiles", "samples", "processing_events", "processing_outputs", "processing_output_samples", "audit_events"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
  }
});

test("anonymous inventory privileges are revoked and no anon policy exists", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /revoke all on all tables in schema public from anon/i);
  assert.doesNotMatch(sql, /create policy[^;]+to anon/i);
  assert.doesNotMatch(sql, /service[_-]role[^\n]*['\"][A-Za-z0-9._-]+/i);
});

test("mutations require approved-user assertion", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const fn of ["register_source_sample", "create_processing_plan", "record_extraction_results", "activate_sample", "mark_sample_not_created", "mark_labels_printed"]) {
    const body = sql.match(new RegExp(`function public\\.${fn}\\([^]*?end \\$\\$;`, "i"))?.[0] || "";
    assert.match(body, /perform public\.assert_approved\(\)/i, `${fn} must check approval`);
  }
});

test("follow-up migration hardens direct RPC accounting", async () => {
  const sql = await readFile(hardeningUrl, "utf8");
  assert.match(sql, /item_allocation\s*<>\s*each_amount\s*\*\s*count/i);
  assert.match(sql, /count\s*<>\s*ceil\(expected_volume\s*\/\s*max_vial_volume\)/i);
  assert.match(sql, /array_position\(p_vial_volumes,\s*null\)/i);
  assert.match(sql, /revoke execute on function public\.add_output_vials\(uuid,integer\) from authenticated/i);
  assert.match(sql, /grant execute on function public\.is_approved_lab_user\(\) to authenticated/i);
  assert.match(sql, /reserved_cells_within_current/i);
  assert.match(sql, /reserved_volume_within_current/i);
});

test("static frontend does not reference a privileged browser key", async () => {
  const files = [
    new URL("../inventory/config.js", import.meta.url),
    new URL("../inventory/js/supabase.js", import.meta.url),
    new URL("../inventory/js/api.js", import.meta.url),
  ];
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|sb_secret_|service_role/i);
  assert.match(source, /supabaseUrl/);
  assert.match(source, /supabaseAnonKey/);
});

test("final migration explicitly limits the browser privilege surface", async () => {
  const sql = await readFile(privilegeUrl, "utf8");
  assert.match(sql, /revoke all privileges on all tables in schema public from anon, authenticated/i);
  assert.match(sql, /revoke execute on all functions in schema public from public, anon, authenticated/i);
  assert.match(sql, /grant select on table[\s\S]+to authenticated/i);
  for (const fn of ["register_source_sample", "create_processing_plan", "record_extraction_results", "activate_sample", "mark_sample_not_created", "mark_labels_printed", "is_approved_lab_user"]) {
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\(`, "i"));
  }
  for (const fn of ["add_output_vials", "add_output_vials_internal", "assert_approved", "next_sample_identifier", "refresh_processing_event_status", "handle_new_user"]) {
    assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${fn}\\(`, "i"));
  }
});
