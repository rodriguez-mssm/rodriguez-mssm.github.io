begin;

create function public.require_stemcell_intake_photo() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.registration_profile = 'STEMCELL_COA'
     and new.status = 'COMPLETED'
     and old.status is distinct from 'COMPLETED'
     and not exists (
       select 1
       from public.sample_media media
       where media.registration_session_id = new.id
         and media.media_kind = 'IMAGE'
     ) then
    raise exception 'A sample photo is required for STEMCELL sample intake';
  end if;
  return new;
end $$;

create trigger source_registration_requires_stemcell_photo
before update of status on public.source_registration_sessions
for each row execute function public.require_stemcell_intake_photo();

revoke execute on function public.require_stemcell_intake_photo() from public, anon, authenticated;

commit;
