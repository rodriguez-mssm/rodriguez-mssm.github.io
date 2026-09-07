import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL("../supabase/migrations/202609070002_source_registration_profiles.sql", import.meta.url);
const requiredPhotoMigrationUrl = new URL("../supabase/migrations/202609070003_require_stemcell_intake_photo.sql", import.meta.url);

test("profile registration cannot create a sample before explicit confirmation", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const completion = sql.match(/function public\.complete_source_registration\([^]*?end \$\$;/i)?.[0] || "";
  assert.match(completion, /review_confirmed/);
  assert.match(completion, /User review and confirmation are required before registration/i);
  assert.match(completion, /insert into public\.samples/i);
  const begin = sql.match(/function public\.begin_source_registration\([^]*?end \$\$;/i)?.[0] || "";
  assert.doesNotMatch(begin, /insert into public\.samples/i);
});

test("private Storage bucket and object policies require approved users", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /'sample-media',[\s\S]+false,[\s\S]+15728640/i);
  assert.match(sql, /sample_media_objects_read_approved[\s\S]+is_approved_lab_user/i);
  assert.match(sql, /sample_media_objects_insert_approved[\s\S]+is_approved_lab_user[\s\S]+storage\.foldername\(name\)/i);
  assert.match(sql, /not exists\(select 1 from storage\.objects where bucket_id='sample-media' and name=p_storage_path\)/i);
  assert.doesNotMatch(sql, /create policy[^;]+on storage\.objects[^;]+to anon/i);
  assert.doesNotMatch(sql, /for delete to authenticated/i);
});

test("metadata/media tables are RLS protected and writes use approved RPCs", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  for (const table of ["source_registration_sessions", "source_subjects", "source_sample_metadata", "sample_media"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`${table}_read_approved[\\s\\S]+is_approved_lab_user`, "i"));
  }
  for (const fn of ["begin_source_registration", "record_registration_media", "complete_source_registration", "search_inventory_sample_ids", "get_sample_source_provenance", "create_sample_source", "update_sample_source"]) {
    const body = sql.match(new RegExp(`function public\\.${fn}\\([^]*?end \\$\\$;`, "i"))?.[0] || "";
    assert.match(body, /security definer set search_path = public, pg_temp/i);
    assert.match(body, /perform public\.assert_approved\(\)/i);
  }
});

test("COA and photo remain linked to the confirmed root and descendant provenance remains relational", async () => {
  const [sql, inheritance] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(new URL("../supabase/migrations/202609070001_sample_sources.sql", import.meta.url), "utf8"),
  ]);
  assert.match(sql, /update public\.sample_media set sample_id=s\.id where registration_session_id=session_row\.id/i);
  assert.match(sql, /function public\.get_sample_source_provenance/i);
  assert.match(sql, /with recursive ancestors/i);
  assert.match(sql, /media_kind = 'DOCUMENT' and document_type = 'COA'/i);
  assert.match(sql, /media_kind = 'IMAGE'/i);
  assert.match(inheritance, /new\.sample_source_id := parent_source_id/i);
});

test("profile-specific source cannot bypass reviewed workflow through generic registration", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const generic = sql.match(/function public\.register_source_sample\([^]*?end \$\$;/i)?.[0] || "";
  assert.match(generic, /profile <> 'GENERIC'/i);
  assert.match(generic, /profile-specific reviewed registration workflow/i);
});

test("STEMCELL intake requires a photo in both the UI and database", async () => {
  const [sql, ui] = await Promise.all([
    readFile(requiredPhotoMigrationUrl, "utf8"),
    readFile(new URL("../inventory/js/stemcell-registration-ui.js", import.meta.url), "utf8"),
  ]);
  assert.match(ui, /id="stemcell-photo"[^>]+required/);
  assert.match(ui, /if \(!photo\)/);
  assert.match(sql, /registration_profile = 'STEMCELL_COA'/i);
  assert.match(sql, /media_kind = 'IMAGE'/i);
  assert.match(sql, /before update of status on public\.source_registration_sessions/i);
  assert.match(sql, /revoke execute on function public\.require_stemcell_intake_photo\(\) from public, anon, authenticated/i);
});
