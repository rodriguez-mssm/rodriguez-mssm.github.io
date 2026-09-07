begin;

create table public.sample_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  nickname text not null,
  url text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sample_source_name_valid check (name = btrim(name) and char_length(name) between 1 and 200),
  constraint sample_source_nickname_valid check (nickname = btrim(nickname) and char_length(nickname) between 1 and 80),
  constraint sample_source_url_valid check (
    url is null or (char_length(url) <= 2048 and url ~* '^https?://[^[:space:]]+$')
  )
);

create unique index sample_sources_nickname_ci_key on public.sample_sources (lower(nickname));
create index sample_sources_name_ci_idx on public.sample_sources (lower(name));

alter table public.samples
  add column sample_source_id uuid references public.sample_sources(id) on delete restrict;
create index samples_sample_source_idx on public.samples(sample_source_id);

create or replace function public.set_sample_source_updated_at() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger sample_sources_set_updated_at
before update on public.sample_sources
for each row execute function public.set_sample_source_updated_at();

-- New roots must identify their external/provider origin. Descendants always
-- copy the immediate parent's source, so processing callers never select it.
-- Existing pre-migration rows are intentionally left nullable; descendants of
-- those legacy rows may also remain nullable until the root is backfilled.
create or replace function public.enforce_sample_source_inheritance() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare parent_source_id uuid;
begin
  if new.parent_sample_id is null then
    if new.sample_source_id is null then
      raise exception 'A sample source is required for a registered source sample';
    end if;
    return new;
  end if;

  select sample_source_id into parent_source_id
  from public.samples
  where id = new.parent_sample_id;

  if not found then
    raise exception 'Parent sample not found';
  end if;

  if parent_source_id is null and new.sample_source_id is not null then
    raise exception 'Assign a Sample Source to the legacy parent before creating sourced descendants';
  elsif new.sample_source_id is null then
    new.sample_source_id := parent_source_id;
  elsif new.sample_source_id <> parent_source_id then
    raise exception 'A child sample must inherit its parent sample source';
  end if;
  return new;
end $$;

create trigger samples_enforce_sample_source
before insert on public.samples
for each row execute function public.enforce_sample_source_inheritance();

create or replace function public.create_sample_source(
  p_name text,
  p_nickname text,
  p_url text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare source_row public.sample_sources;
begin
  perform public.assert_approved();

  insert into public.sample_sources(name, nickname, url, created_by)
  values(
    btrim(p_name),
    btrim(p_nickname),
    nullif(btrim(p_url), ''),
    auth.uid()
  )
  returning * into source_row;

  insert into public.audit_events(event_type, actor_id, metadata)
  values(
    'SAMPLE_SOURCE_CREATED',
    auth.uid(),
    jsonb_build_object(
      'sample_source_id', source_row.id,
      'name', source_row.name,
      'nickname', source_row.nickname
    )
  );
  return to_jsonb(source_row);
end $$;

create or replace function public.update_sample_source(
  p_sample_source_id uuid,
  p_name text,
  p_nickname text,
  p_url text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare source_row public.sample_sources;
begin
  perform public.assert_approved();

  update public.sample_sources
  set name = btrim(p_name),
      nickname = btrim(p_nickname),
      url = nullif(btrim(p_url), '')
  where id = p_sample_source_id
  returning * into source_row;

  if not found then
    raise exception 'Sample source not found';
  end if;

  insert into public.audit_events(event_type, actor_id, metadata)
  values(
    'SAMPLE_SOURCE_UPDATED',
    auth.uid(),
    jsonb_build_object(
      'sample_source_id', source_row.id,
      'name', source_row.name,
      'nickname', source_row.nickname
    )
  );
  return to_jsonb(source_row);
end $$;

-- Replace the root-registration entry point without changing its signature.
-- The payload now must contain a valid sample_source_id.
create or replace function public.register_source_sample(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.samples;
  st public.sample_type;
  cells numeric;
  volume numeric;
  concentration numeric;
  source_id uuid;
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

  if source_id is null or not exists(select 1 from public.sample_sources where id = source_id) then
    raise exception 'A valid sample source is required';
  end if;
  if st in ('PBMC','BMMNC','SORTED_CELLS') and (cells is null or cells < 0) then
    raise exception 'Cell count is required';
  end if;
  if st in ('SERUM','PLASMA','DNA','RNA') and (volume is null or volume < 0) then
    raise exception 'Volume is required';
  end if;

  insert into public.samples(
    sample_id, sample_type, sample_source_id, status, external_id,
    original_cell_count_million, current_cell_count_million,
    original_volume_ul, current_volume_ul, concentration_ng_ul,
    created_by, activated_at, notes
  ) values(
    public.next_sample_identifier(st), st, source_id, 'ACTIVE',
    nullif(p_payload->>'external_id',''), cells, cells, volume, volume,
    concentration, auth.uid(), now(), nullif(p_payload->>'notes','')
  ) returning * into s;

  insert into public.audit_events(event_type, sample_id, actor_id, metadata)
  values(
    'SOURCE_REGISTERED',
    s.id,
    auth.uid(),
    jsonb_build_object('sample_id', s.sample_id, 'sample_source_id', source_id)
  );
  return to_jsonb(s);
end $$;

alter table public.sample_sources enable row level security;
create policy sample_sources_read_approved on public.sample_sources
for select to authenticated using (public.is_approved_lab_user());

-- Preserve the least-privilege browser model established by 202609060001.
revoke all privileges on table public.sample_sources from anon, authenticated;
grant select on table public.sample_sources to authenticated;

revoke execute on function public.set_sample_source_updated_at() from public, anon, authenticated;
revoke execute on function public.enforce_sample_source_inheritance() from public, anon, authenticated;
revoke execute on function public.create_sample_source(text,text,text) from public, anon;
revoke execute on function public.update_sample_source(uuid,text,text,text) from public, anon;
revoke execute on function public.register_source_sample(jsonb) from public, anon;

grant execute on function public.create_sample_source(text,text,text) to authenticated;
grant execute on function public.update_sample_source(uuid,text,text,text) to authenticated;
grant execute on function public.register_source_sample(jsonb) to authenticated;

commit;
