import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const executeUrl = new URL("../supabase/scripts/preproduction_cleanup_execute.sql", import.meta.url);
const inventoryUrl = new URL("../supabase/scripts/preproduction_cleanup_inventory.sql", import.meta.url);

test("pre-production cleanup is exact, guarded, and transactional", async () => {
  const sql = await readFile(executeUrl, "utf8");
  assert.match(sql, /^-- DESTRUCTIVE/);
  assert.match(sql, /begin;/i);
  assert.match(sql, /current_setting\('app\.preproduction_cleanup_confirmation'/i);
  assert.match(sql, /REMOVE_SYNTHETIC_ACCEPTANCE_20260907/);
  assert.match(sql, /b37a21ec-1a74-495b-978f-bec65f5f02ad/);
  assert.match(sql, /Cleanup target changed since dry run; no data was changed/);
  assert.match(sql, /Post-cleanup operational-empty verification failed; transaction rolled back/);
  assert.match(sql, /commit;/i);
  assert.doesNotMatch(sql, /truncate/i);
  assert.doesNotMatch(sql, /delete from (?:public\.)?profiles/i);
  assert.doesNotMatch(sql, /delete from auth\.users/i);
  assert.doesNotMatch(sql, /delete from public\.sample_sources/i);
  assert.doesNotMatch(sql, /setval|alter sequence|restart with/i);
});

test("dry-run inventory is read-only and covers operational and private-storage records", async () => {
  const sql = await readFile(inventoryUrl, "utf8");
  assert.match(sql, /with recursive synthetic_samples/i);
  for (const object of ["samples", "processing_events", "processing_outputs", "processing_output_samples", "audit_events", "source_registration_sessions", "source_subjects", "source_sample_metadata", "sample_media", "extraction_qc_measurements", "extraction_qc_artifacts", "storage.objects"]) {
    assert.match(sql, new RegExp(object.replace(".", "\\."), "i"));
  }
  assert.doesNotMatch(sql, /\bdelete\b|\btruncate\b|\bupdate\b|\binsert\b/i);
});
