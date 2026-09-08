-- Read-only pre-production cleanup inventory. This file never deletes data.
-- Synthetic operational lineages are rooted only by external_id beginning TEST-.

select 'profiles_retained_pending_review' as category, p.id, u.email, p.display_name,
       p.role::text, p.approved::text, coalesce(p.disabled_at::text, '') as disabled_at,
       p.created_at::text
from public.profiles p join auth.users u on u.id=p.id
order by p.created_at;

select 'sample_sources_retained' as category, id, nickname, name,
       registration_profile::text, created_by, created_at
from public.sample_sources order by nickname;

select 'root_samples_classification' as category, id, sample_id, coalesce(external_id,'') as external_id,
       sample_type::text, sample_source_id, created_by, created_at,
       case when external_id ilike 'TEST-%' then 'REMOVE_SYNTHETIC' else 'RETAIN_REVIEW_REQUIRED' end as disposition
from public.samples where parent_sample_id is null order by created_at;

select 'registration_sessions_review' as category, id, status::text, sample_id,
       sample_source_id, created_by, created_at,
       case
         when sample_id in (select id from public.samples where external_id ilike 'TEST-%') then 'REMOVE_SYNTHETIC'
         when sample_id is null then 'UNLINKED_DRAFT_REVIEW_REQUIRED'
         else 'RETAIN_REVIEW_REQUIRED'
       end as disposition
from public.source_registration_sessions order by created_at;

select 'source_subjects_review' as category, id, sample_source_id, vendor_subject_id,
       created_by, created_at
from public.source_subjects order by created_at;

select 'storage_objects_review' as category, id, bucket_id, name, created_at
from storage.objects where bucket_id='sample-media' order by created_at;

with recursive synthetic_samples as (
  select id from public.samples where parent_sample_id is null and external_id ilike 'TEST-%'
  union all
  select s.id from public.samples s join synthetic_samples p on s.parent_sample_id=p.id
), target_events as (
  select distinct pe.id from public.processing_events pe
  where pe.source_sample_id in (select id from synthetic_samples)
), target_outputs as (
  select po.id from public.processing_outputs po where po.processing_event_id in (select id from target_events)
), target_sessions as (
  select rs.id from public.source_registration_sessions rs where rs.sample_id in (select id from synthetic_samples)
), target_media as (
  select sm.id,sm.storage_path from public.sample_media sm
  where sm.sample_id in (select id from synthetic_samples)
     or sm.registration_session_id in (select id from target_sessions)
), target_subjects as (
  select distinct m.source_subject_id as id from public.source_sample_metadata m
  where m.sample_id in (select id from synthetic_samples) and m.source_subject_id is not null
)
select * from (
  select 'samples' as object_type,count(*)::bigint as remove_count from synthetic_samples
  union all select 'processing_events',count(*) from target_events
  union all select 'processing_outputs',count(*) from target_outputs
  union all select 'processing_output_samples',count(*) from public.processing_output_samples where processing_output_id in (select id from target_outputs)
  union all select 'extraction_qc_measurements',count(*) from public.extraction_qc_measurements where processing_output_id in (select id from target_outputs)
  union all select 'extraction_qc_artifacts',count(*) from public.extraction_qc_artifacts where processing_output_id in (select id from target_outputs)
  union all select 'audit_events',count(*) from public.audit_events
    where sample_id in (select id from synthetic_samples)
       or processing_event_id in (select id from target_events)
       or processing_output_id in (select id from target_outputs)
  union all select 'source_registration_sessions',count(*) from target_sessions
  union all select 'source_sample_metadata',count(*) from public.source_sample_metadata where sample_id in (select id from synthetic_samples)
  union all select 'sample_media_rows',count(*) from target_media
  union all select 'source_subjects',count(*) from target_subjects
  union all select 'storage_objects',count(*) from storage.objects where bucket_id='sample-media' and name in (select storage_path from target_media union select storage_path from public.extraction_qc_artifacts where processing_output_id in (select id from target_outputs))
) counts order by object_type;
