begin;

create type public.source_registration_profile as enum ('GENERIC', 'STEMCELL_COA');
create type public.source_registration_status as enum ('DRAFT', 'COMPLETED', 'CANCELLED');
create type public.sample_media_kind as enum ('DOCUMENT', 'IMAGE');
create type public.sample_document_type as enum ('COA');

alter table public.sample_sources
  add column registration_profile public.source_registration_profile not null default 'GENERIC';

create table public.source_registration_sessions (
  id uuid primary key default gen_random_uuid(),
  sample_source_id uuid not null references public.sample_sources(id) on delete restrict,
  registration_profile public.source_registration_profile not null,
  status public.source_registration_status not null default 'DRAFT',
  sample_id uuid unique references public.samples(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint registration_completion_shape check (
    (status = 'DRAFT' and sample_id is null and completed_at is null)
    or (status = 'COMPLETED' and sample_id is not null and completed_at is not null)
    or status = 'CANCELLED'
  )
);

create table public.source_subjects (
  id uuid primary key default gen_random_uuid(),
  sample_source_id uuid not null references public.sample_sources(id) on delete restrict,
  vendor_subject_id text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint source_subject_vendor_id_valid check (
    vendor_subject_id = btrim(vendor_subject_id) and char_length(vendor_subject_id) between 1 and 120
  ),
  unique(sample_source_id, vendor_subject_id)
);

create table public.source_sample_metadata (
  sample_id uuid primary key references public.samples(id) on delete restrict,
  registration_session_id uuid not null unique references public.source_registration_sessions(id) on delete restrict,
  source_subject_id uuid references public.source_subjects(id) on delete restrict,
  vendor_product_name text,
  catalog_number text,
  lot_number text,
  processing_date date,
  raw_quantity_text text,
  viability_percent numeric check (viability_percent between 0 and 100),
  anticoagulant text,
  viral_testing_result text,
  viral_testing_date date,
  cmv_status text,
  cmv_testing_date date,
  donor_metadata jsonb not null default '{}'::jsonb,
  product_metadata jsonb not null default '{}'::jsonb,
  field_provenance jsonb not null default '{}'::jsonb,
  parser_metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint source_metadata_catalog_length check (catalog_number is null or char_length(catalog_number) <= 120),
  constraint source_metadata_lot_length check (lot_number is null or char_length(lot_number) <= 120),
  constraint source_metadata_json_objects check (
    jsonb_typeof(donor_metadata) = 'object'
    and jsonb_typeof(product_metadata) = 'object'
    and jsonb_typeof(field_provenance) = 'object'
    and jsonb_typeof(parser_metadata) = 'object'
  )
);

create table public.sample_media (
  id uuid primary key,
  registration_session_id uuid not null references public.source_registration_sessions(id) on delete restrict,
  sample_id uuid references public.samples(id) on delete restrict,
  sample_source_id uuid not null references public.sample_sources(id) on delete restrict,
  media_kind public.sample_media_kind not null,
  document_type public.sample_document_type,
  filename text not null check (filename = btrim(filename) and char_length(filename) between 1 and 255),
  storage_bucket text not null default 'sample-media' check (storage_bucket = 'sample-media'),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/heic','image/heif')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  metadata jsonb not null default '{}'::jsonb,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  constraint sample_media_type_shape check (
    (media_kind = 'DOCUMENT' and document_type is not null and mime_type = 'application/pdf')
    or (media_kind = 'IMAGE' and document_type is null and mime_type like 'image/%')
  )
);

create index registration_sessions_source_idx on public.source_registration_sessions(sample_source_id, created_at desc);
create index source_subjects_vendor_idx on public.source_subjects(vendor_subject_id);
create index source_metadata_lot_idx on public.source_sample_metadata(lot_number) where lot_number is not null;
create index source_metadata_catalog_idx on public.source_sample_metadata(catalog_number) where catalog_number is not null;
create index sample_media_sample_idx on public.sample_media(sample_id, uploaded_at) where sample_id is not null;
create index sample_media_session_idx on public.sample_media(registration_session_id, uploaded_at);

create trigger source_registration_sessions_set_updated_at
before update on public.source_registration_sessions
for each row execute function public.set_sample_source_updated_at();

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values(
  'sample-media',
  'sample-media',
  false,
  15728640,
  array['application/pdf','image/jpeg','image/png','image/heic','image/heif']
)
on conflict (id) do nothing;

create policy sample_media_objects_read_approved on storage.objects
for select to authenticated
using (bucket_id = 'sample-media' and public.is_approved_lab_user());

create policy sample_media_objects_insert_approved on storage.objects
for insert to authenticated
with check (
  bucket_id = 'sample-media'
  and public.is_approved_lab_user()
  and (storage.foldername(name))[1] = auth.uid()::text
);

create or replace function public.begin_source_registration(p_sample_source_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare source_row public.sample_sources; session_row public.source_registration_sessions;
begin
  perform public.assert_approved();
  select * into source_row from public.sample_sources where id = p_sample_source_id;
  if not found then raise exception 'Sample Source not found'; end if;

  insert into public.source_registration_sessions(sample_source_id, registration_profile, created_by)
  values(source_row.id, source_row.registration_profile, auth.uid())
  returning * into session_row;
  return to_jsonb(session_row);
end $$;

create or replace function public.record_registration_media(
  p_registration_session_id uuid,
  p_media_id uuid,
  p_media_kind public.sample_media_kind,
  p_document_type public.sample_document_type,
  p_filename text,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes bigint
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare session_row public.source_registration_sessions; media_row public.sample_media; expected_path text;
begin
  perform public.assert_approved();
  select * into session_row from public.source_registration_sessions
  where id = p_registration_session_id for update;
  if not found or session_row.status <> 'DRAFT' or session_row.created_by <> auth.uid() then
    raise exception 'Registration session is not an editable draft owned by this user';
  end if;

  expected_path := auth.uid()::text || '/' || session_row.id::text || '/' || p_media_id::text;
  if p_storage_path <> expected_path then raise exception 'Invalid private media object path'; end if;
  if not exists(select 1 from storage.objects where bucket_id='sample-media' and name=p_storage_path) then
    raise exception 'Private media upload was not found';
  end if;

  insert into public.sample_media(
    id, registration_session_id, sample_source_id, media_kind, document_type,
    filename, storage_path, mime_type, size_bytes, uploaded_by
  ) values(
    p_media_id, session_row.id, session_row.sample_source_id, p_media_kind,
    p_document_type, btrim(p_filename), p_storage_path, p_mime_type,
    p_size_bytes, auth.uid()
  ) returning * into media_row;
  insert into public.audit_events(event_type,actor_id,metadata)
  values('SOURCE_MEDIA_UPLOADED',auth.uid(),jsonb_build_object(
    'registration_session_id',session_row.id,'sample_source_id',session_row.sample_source_id,
    'media_id',media_row.id,'media_kind',media_row.media_kind,'document_type',media_row.document_type
  ));
  return to_jsonb(media_row);
end $$;

-- Generic registration is retained, but profile-driven sources must use the
-- reviewed completion RPC below.
create or replace function public.register_source_sample(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.samples; st public.sample_type; cells numeric; volume numeric;
  concentration numeric; source_id uuid; profile public.source_registration_profile;
begin
  perform public.assert_approved();
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'A source-sample object is required';
  end if;
  st := nullif(p_payload->>'sample_type', '')::public.sample_type;
  source_id := nullif(p_payload->>'sample_source_id', '')::uuid;
  cells := nullif(p_payload->>'cell_count_million','')::numeric;
  volume := nullif(p_payload->>'volume_ul','')::numeric;
  concentration := nullif(p_payload->>'concentration_ng_ul','')::numeric;

  select registration_profile into profile from public.sample_sources where id = source_id;
  if not found then raise exception 'A valid Sample Source is required'; end if;
  if profile <> 'GENERIC' then raise exception 'This Sample Source requires its profile-specific reviewed registration workflow'; end if;
  if st in ('PBMC','BMMNC','SORTED_CELLS') and (cells is null or cells < 0) then raise exception 'Cell count is required'; end if;
  if st in ('SERUM','PLASMA','DNA','RNA') and (volume is null or volume < 0) then raise exception 'Volume is required'; end if;

  insert into public.samples(
    sample_id,sample_type,sample_source_id,status,external_id,
    original_cell_count_million,current_cell_count_million,
    original_volume_ul,current_volume_ul,concentration_ng_ul,
    created_by,activated_at,notes
  ) values(
    public.next_sample_identifier(st),st,source_id,'ACTIVE',nullif(p_payload->>'external_id',''),
    cells,cells,volume,volume,concentration,auth.uid(),now(),nullif(p_payload->>'notes','')
  ) returning * into s;
  insert into public.audit_events(event_type,sample_id,actor_id,metadata)
  values('SOURCE_REGISTERED',s.id,auth.uid(),jsonb_build_object('sample_id',s.sample_id,'sample_source_id',source_id,'registration_profile',profile));
  return to_jsonb(s);
end $$;

create or replace function public.complete_source_registration(
  p_registration_session_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  session_row public.source_registration_sessions; source_row public.sample_sources;
  s public.samples; subject_row public.source_subjects; st public.sample_type;
  cells numeric; volume numeric; concentration numeric; donor_id text;
  viability numeric; processing_date_value date; viral_date_value date; cmv_date_value date;
begin
  perform public.assert_approved();
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or coalesce((p_payload->>'review_confirmed')::boolean, false) is not true then
    raise exception 'User review and confirmation are required before registration';
  end if;

  select * into session_row from public.source_registration_sessions
  where id = p_registration_session_id for update;
  if not found or session_row.status <> 'DRAFT' or session_row.created_by <> auth.uid() then
    raise exception 'Registration session is not an editable draft owned by this user';
  end if;
  select * into source_row from public.sample_sources where id = session_row.sample_source_id;

  if session_row.registration_profile = 'STEMCELL_COA' and not exists(
    select 1 from public.sample_media
    where registration_session_id = session_row.id and media_kind = 'DOCUMENT' and document_type = 'COA'
  ) then raise exception 'A STEMCELL COA upload is required'; end if;

  st := nullif(p_payload->>'sample_type','')::public.sample_type;
  cells := nullif(p_payload->>'cell_count_million','')::numeric;
  volume := nullif(p_payload->>'volume_ul','')::numeric;
  concentration := nullif(p_payload->>'concentration_ng_ul','')::numeric;
  donor_id := nullif(btrim(p_payload->>'donor_id'),'');
  viability := nullif(p_payload->>'viability_percent','')::numeric;
  processing_date_value := nullif(p_payload->>'processing_date','')::date;
  viral_date_value := nullif(p_payload->>'viral_testing_date','')::date;
  cmv_date_value := nullif(p_payload->>'cmv_testing_date','')::date;

  if st in ('PBMC','BMMNC','SORTED_CELLS') and (cells is null or cells < 0) then raise exception 'Cell count is required'; end if;
  if st in ('SERUM','PLASMA','DNA','RNA') and (volume is null or volume < 0) then raise exception 'Volume is required'; end if;
  if viability is not null and (viability < 0 or viability > 100) then raise exception 'Viability must be between 0 and 100'; end if;

  insert into public.samples(
    sample_id,sample_type,sample_source_id,status,external_id,
    original_cell_count_million,current_cell_count_million,
    original_volume_ul,current_volume_ul,concentration_ng_ul,
    created_by,activated_at
  ) values(
    public.next_sample_identifier(st),st,source_row.id,'ACTIVE',nullif(p_payload->>'external_id',''),
    cells,cells,volume,volume,concentration,auth.uid(),now()
  ) returning * into s;

  if donor_id is not null then
    insert into public.source_subjects(sample_source_id,vendor_subject_id,created_by)
    values(source_row.id,donor_id,auth.uid())
    on conflict (sample_source_id,vendor_subject_id) do update set vendor_subject_id=excluded.vendor_subject_id
    returning * into subject_row;
  end if;

  insert into public.source_sample_metadata(
    sample_id,registration_session_id,source_subject_id,vendor_product_name,
    catalog_number,lot_number,processing_date,raw_quantity_text,viability_percent,
    anticoagulant,viral_testing_result,viral_testing_date,cmv_status,cmv_testing_date,
    donor_metadata,product_metadata,field_provenance,parser_metadata,created_by
  ) values(
    s.id,session_row.id,subject_row.id,nullif(p_payload->>'vendor_product_name',''),
    nullif(p_payload->>'catalog_number',''),nullif(p_payload->>'lot_number',''),processing_date_value,
    nullif(p_payload->>'raw_quantity_text',''),viability,nullif(p_payload->>'anticoagulant',''),
    nullif(p_payload->>'viral_testing_result',''),viral_date_value,nullif(p_payload->>'cmv_status',''),cmv_date_value,
    coalesce(p_payload->'donor_metadata','{}'::jsonb),coalesce(p_payload->'product_metadata','{}'::jsonb),
    coalesce(p_payload->'field_provenance','{}'::jsonb),coalesce(p_payload->'parser_metadata','{}'::jsonb),auth.uid()
  );

  update public.sample_media set sample_id=s.id where registration_session_id=session_row.id;
  update public.source_registration_sessions
  set status='COMPLETED',sample_id=s.id,completed_at=now()
  where id=session_row.id;

  insert into public.audit_events(event_type,sample_id,actor_id,metadata)
  values('SOURCE_REGISTERED',s.id,auth.uid(),jsonb_build_object(
    'sample_id',s.sample_id,'sample_source_id',source_row.id,
    'registration_profile',session_row.registration_profile,'registration_session_id',session_row.id
  ));
  insert into public.audit_events(event_type,sample_id,actor_id,metadata)
  values('SOURCE_METADATA_RECORDED',s.id,auth.uid(),jsonb_build_object(
    'registration_session_id',session_row.id,'review_confirmed',true,
    'media_count',(select count(*) from public.sample_media where registration_session_id=session_row.id)
  ));
  return jsonb_build_object('sample',to_jsonb(s),'registration_session_id',session_row.id);
end $$;

create or replace function public.search_inventory_sample_ids(
  p_term text,
  p_active_only boolean default false
) returns table(sample_uuid uuid)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_approved();
  return query
  with recursive lineage(sample_id, ancestor_id) as (
    select s.id, s.id from public.samples s
    union all
    select lineage.sample_id, ancestor.parent_sample_id
    from lineage
    join public.samples ancestor on ancestor.id = lineage.ancestor_id
    where ancestor.parent_sample_id is not null
  )
  select distinct s.id
  from public.samples s
  left join public.sample_sources ss on ss.id = s.sample_source_id
  where (not coalesce(p_active_only,false) or s.status = 'ACTIVE')
    and (
      s.sample_id ilike '%' || coalesce(p_term,'') || '%'
      or ss.nickname ilike '%' || coalesce(p_term,'') || '%'
      or ss.name ilike '%' || coalesce(p_term,'') || '%'
      or exists (
        select 1 from lineage l
        join public.source_sample_metadata sm on sm.sample_id = l.ancestor_id
        left join public.source_subjects subject on subject.id = sm.source_subject_id
        where l.sample_id = s.id and (
          sm.catalog_number ilike '%' || coalesce(p_term,'') || '%'
          or sm.lot_number ilike '%' || coalesce(p_term,'') || '%'
          or subject.vendor_subject_id ilike '%' || coalesce(p_term,'') || '%'
        )
      )
    )
  order by s.id
  limit 50;
end $$;

create or replace function public.get_sample_source_provenance(p_sample_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  perform public.assert_approved();
  with recursive ancestors(id,parent_sample_id,depth) as (
    select s.id,s.parent_sample_id,0 from public.samples s where s.id=p_sample_id
    union all
    select parent.id,parent.parent_sample_id,ancestors.depth+1
    from ancestors join public.samples parent on parent.id=ancestors.parent_sample_id
  )
  select jsonb_build_object(
    'root_sample_id',sm.sample_id,
    'metadata',to_jsonb(sm) || jsonb_build_object('source_subject',jsonb_build_object('vendor_subject_id',subject.vendor_subject_id))
  ) into result
  from ancestors
  join public.source_sample_metadata sm on sm.sample_id=ancestors.id
  left join public.source_subjects subject on subject.id=sm.source_subject_id
  order by ancestors.depth
  limit 1;
  return result;
end $$;

drop function public.create_sample_source(text,text,text);
drop function public.update_sample_source(uuid,text,text,text);

create function public.create_sample_source(
  p_name text,p_nickname text,p_url text,p_registration_profile public.source_registration_profile
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare source_row public.sample_sources;
begin
  perform public.assert_approved();
  insert into public.sample_sources(name,nickname,url,registration_profile,created_by)
  values(btrim(p_name),btrim(p_nickname),nullif(btrim(p_url),''),coalesce(p_registration_profile,'GENERIC'),auth.uid())
  returning * into source_row;
  insert into public.audit_events(event_type,actor_id,metadata)
  values('SAMPLE_SOURCE_CREATED',auth.uid(),jsonb_build_object('sample_source_id',source_row.id,'name',source_row.name,'nickname',source_row.nickname,'registration_profile',source_row.registration_profile));
  return to_jsonb(source_row);
end $$;

create function public.update_sample_source(
  p_sample_source_id uuid,p_name text,p_nickname text,p_url text,
  p_registration_profile public.source_registration_profile
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare source_row public.sample_sources;
begin
  perform public.assert_approved();
  update public.sample_sources set name=btrim(p_name),nickname=btrim(p_nickname),
    url=nullif(btrim(p_url),''),registration_profile=coalesce(p_registration_profile,'GENERIC')
  where id=p_sample_source_id returning * into source_row;
  if not found then raise exception 'Sample Source not found'; end if;
  insert into public.audit_events(event_type,actor_id,metadata)
  values('SAMPLE_SOURCE_UPDATED',auth.uid(),jsonb_build_object('sample_source_id',source_row.id,'name',source_row.name,'nickname',source_row.nickname,'registration_profile',source_row.registration_profile));
  return to_jsonb(source_row);
end $$;

alter table public.source_registration_sessions enable row level security;
alter table public.source_subjects enable row level security;
alter table public.source_sample_metadata enable row level security;
alter table public.sample_media enable row level security;

create policy source_registration_sessions_read_approved on public.source_registration_sessions for select to authenticated using(public.is_approved_lab_user());
create policy source_subjects_read_approved on public.source_subjects for select to authenticated using(public.is_approved_lab_user());
create policy source_sample_metadata_read_approved on public.source_sample_metadata for select to authenticated using(public.is_approved_lab_user());
create policy sample_media_read_approved on public.sample_media for select to authenticated using(public.is_approved_lab_user());

revoke all privileges on table public.source_registration_sessions,public.source_subjects,public.source_sample_metadata,public.sample_media from anon,authenticated;
grant select on table public.source_registration_sessions,public.source_subjects,public.source_sample_metadata,public.sample_media to authenticated;

revoke execute on function public.begin_source_registration(uuid) from public,anon;
revoke execute on function public.record_registration_media(uuid,uuid,public.sample_media_kind,public.sample_document_type,text,text,text,bigint) from public,anon;
revoke execute on function public.complete_source_registration(uuid,jsonb) from public,anon;
revoke execute on function public.search_inventory_sample_ids(text,boolean) from public,anon;
revoke execute on function public.get_sample_source_provenance(uuid) from public,anon;
revoke execute on function public.create_sample_source(text,text,text,public.source_registration_profile) from public,anon;
revoke execute on function public.update_sample_source(uuid,text,text,text,public.source_registration_profile) from public,anon;
revoke execute on function public.register_source_sample(jsonb) from public,anon;

grant execute on function public.begin_source_registration(uuid) to authenticated;
grant execute on function public.record_registration_media(uuid,uuid,public.sample_media_kind,public.sample_document_type,text,text,text,bigint) to authenticated;
grant execute on function public.complete_source_registration(uuid,jsonb) to authenticated;
grant execute on function public.search_inventory_sample_ids(text,boolean) to authenticated;
grant execute on function public.get_sample_source_provenance(uuid) to authenticated;
grant execute on function public.create_sample_source(text,text,text,public.source_registration_profile) to authenticated;
grant execute on function public.update_sample_source(uuid,text,text,text,public.source_registration_profile) to authenticated;
grant execute on function public.register_source_sample(jsonb) to authenticated;

commit;
