-- DESTRUCTIVE: do not run without the owner's explicit approval.
-- This file intentionally refuses to run unless the same SQL session first sets:
--   set local app.preproduction_cleanup_confirmation = 'REMOVE_SYNTHETIC_ACCEPTANCE_20260907';
-- It targets the exact synthetic root audited on 2026-09-07 and never uses a
-- broad TEST/name heuristic. Everything is transactional and guarded by counts.

begin;

do $$
begin
  if current_setting('app.preproduction_cleanup_confirmation', true)
       is distinct from 'REMOVE_SYNTHETIC_ACCEPTANCE_20260907' then
    raise exception 'Cleanup approval token is absent; no data was changed';
  end if;
end $$;

create temp table cleanup_samples(id uuid primary key) on commit drop;
with recursive lineage as (
  select id from public.samples
  where id='b37a21ec-1a74-495b-978f-bec65f5f02ad'::uuid
    and sample_id='PBMC-000001' and parent_sample_id is null
  union all
  select s.id from public.samples s join lineage p on s.parent_sample_id=p.id
)
insert into cleanup_samples select id from lineage;

create temp table cleanup_events(id uuid primary key) on commit drop;
insert into cleanup_events
select id from public.processing_events where source_sample_id in (select id from cleanup_samples);

create temp table cleanup_outputs(id uuid primary key) on commit drop;
insert into cleanup_outputs
select id from public.processing_outputs where processing_event_id in (select id from cleanup_events);

create temp table cleanup_subjects(id uuid primary key) on commit drop;
insert into cleanup_subjects
select distinct source_subject_id from public.source_sample_metadata
where sample_id in (select id from cleanup_samples) and source_subject_id is not null;

do $$
declare linked_audits bigint;
begin
  select count(*) into linked_audits from public.audit_events
  where sample_id in (select id from cleanup_samples)
     or processing_event_id in (select id from cleanup_events)
     or processing_output_id in (select id from cleanup_outputs);

  if (select count(*) from cleanup_samples) <> 6
     or (select count(*) from cleanup_events) <> 1
     or (select count(*) from cleanup_outputs) <> 3
     or (select count(*) from public.processing_output_samples where processing_output_id in (select id from cleanup_outputs)) <> 5
     or linked_audits <> 12 then
    raise exception 'Cleanup target changed since dry run; no data was changed';
  end if;
  if exists(select 1 from public.samples where id not in (select id from cleanup_samples))
     or exists(select 1 from public.processing_events where id not in (select id from cleanup_events))
     or exists(select 1 from public.processing_outputs where id not in (select id from cleanup_outputs)) then
    raise exception 'Non-target operational records now exist; no data was changed';
  end if;
  if exists(
    select 1 from storage.objects where bucket_id='sample-media'
  ) then
    raise exception 'Storage objects now exist and require a fresh object-level dry run; no data was changed';
  end if;
end $$;

delete from public.extraction_qc_artifacts where processing_output_id in (select id from cleanup_outputs);
delete from public.extraction_qc_measurements where processing_output_id in (select id from cleanup_outputs);
delete from public.audit_events
where sample_id in (select id from cleanup_samples)
   or processing_event_id in (select id from cleanup_events)
   or processing_output_id in (select id from cleanup_outputs);
delete from public.processing_output_samples where processing_output_id in (select id from cleanup_outputs);

delete from public.source_sample_metadata where sample_id in (select id from cleanup_samples);
delete from public.sample_media where sample_id in (select id from cleanup_samples);
delete from public.source_registration_sessions where sample_id in (select id from cleanup_samples);
delete from public.source_subjects where id in (select id from cleanup_subjects);

delete from public.samples
where id in (select id from cleanup_samples)
  and id <> 'b37a21ec-1a74-495b-978f-bec65f5f02ad'::uuid;
delete from public.processing_outputs where id in (select id from cleanup_outputs);
delete from public.processing_events where id in (select id from cleanup_events);
delete from public.samples where id='b37a21ec-1a74-495b-978f-bec65f5f02ad'::uuid;

do $$
begin
  if exists(select 1 from public.samples)
     or exists(select 1 from public.processing_events)
     or exists(select 1 from public.processing_outputs)
     or exists(select 1 from public.processing_output_samples)
     or exists(select 1 from public.source_registration_sessions)
     or exists(select 1 from public.source_subjects)
     or exists(select 1 from public.source_sample_metadata)
     or exists(select 1 from public.sample_media)
     or exists(select 1 from public.extraction_qc_measurements)
     or exists(select 1 from public.extraction_qc_artifacts)
     or exists(select 1 from storage.objects where bucket_id='sample-media') then
    raise exception 'Post-cleanup operational-empty verification failed; transaction rolled back';
  end if;
  if (select count(*) from public.profiles) <> 1
     or not exists(select 1 from public.profiles where id='83e604d2-41eb-40ed-82b2-21244052297b'::uuid)
     or (select count(*) from auth.users) <> 1
     or not exists(select 1 from auth.users where id='83e604d2-41eb-40ed-82b2-21244052297b'::uuid)
     or (select count(*) from public.sample_sources) <> 1
     or not exists(select 1 from public.sample_sources where id='618e78cc-ff50-4d9a-b625-b71b72845cd7'::uuid and nickname='STEMCELL')
     or (select count(*) from public.audit_events) <> 2
     or exists(select 1 from public.audit_events where event_type not in ('SAMPLE_SOURCE_CREATED','SAMPLE_SOURCE_UPDATED')) then
    raise exception 'Retained account/configuration verification failed; transaction rolled back';
  end if;
end $$;

commit;
