-- Read-only inventory. Never deletes data. Generated IDs are not test markers.
with recursive synthetic_samples as (
  select id from public.samples
  where id='b37a21ec-1a74-495b-978f-bec65f5f02ad'::uuid
    and sample_id='PBMC-000001' and parent_sample_id is null
  union all select s.id from public.samples s join synthetic_samples p on s.parent_sample_id=p.id
), target_events as (
  select distinct id from public.processing_events where source_sample_id in (select id from synthetic_samples)
), target_outputs as (
  select id from public.processing_outputs where processing_event_id in (select id from target_events)
), target_sessions as (
  select id from public.source_registration_sessions where sample_id in (select id from synthetic_samples)
), target_media as (
  select id,storage_path from public.sample_media
  where sample_id in (select id from synthetic_samples) or registration_session_id in (select id from target_sessions)
), target_subjects as (
  select distinct source_subject_id as id from public.source_sample_metadata
  where sample_id in (select id from synthetic_samples) and source_subject_id is not null
), removal_counts as (
  select 'samples' object_type,count(*)::bigint remove_count from synthetic_samples
  union all select 'processing_events',count(*) from target_events
  union all select 'processing_outputs',count(*) from target_outputs
  union all select 'processing_output_samples',count(*) from public.processing_output_samples where processing_output_id in (select id from target_outputs)
  union all select 'extraction_qc_measurements',count(*) from public.extraction_qc_measurements where processing_output_id in (select id from target_outputs)
  union all select 'extraction_qc_artifacts',count(*) from public.extraction_qc_artifacts where processing_output_id in (select id from target_outputs)
  union all select 'audit_events',count(*) from public.audit_events where sample_id in (select id from synthetic_samples) or processing_event_id in (select id from target_events) or processing_output_id in (select id from target_outputs)
  union all select 'source_registration_sessions',count(*) from target_sessions
  union all select 'source_sample_metadata',count(*) from public.source_sample_metadata where sample_id in (select id from synthetic_samples)
  union all select 'sample_media_rows',count(*) from target_media
  union all select 'source_subjects',count(*) from target_subjects
  union all select 'storage_objects',count(*) from storage.objects where bucket_id='sample-media' and name in (select storage_path from target_media union select storage_path from public.extraction_qc_artifacts where processing_output_id in (select id from target_outputs))
)
select jsonb_pretty(jsonb_build_object(
  'profiles_preserved',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'email',u.email,'display_name',p.display_name,'role',p.role,'approved',p.approved,'disabled_at',p.disabled_at,'created_at',p.created_at) order by p.created_at) from public.profiles p join auth.users u on u.id=p.id),'[]'::jsonb),
  'sample_sources_preserved',coalesce((select jsonb_agg(jsonb_build_object('id',id,'nickname',nickname,'name',name,'registration_profile',registration_profile,'created_by',created_by,'created_at',created_at) order by nickname) from public.sample_sources),'[]'::jsonb),
  'all_samples',coalesce((select jsonb_agg(jsonb_build_object('id',id,'sample_id',sample_id,'parent_sample_id',parent_sample_id,'external_id',external_id,'sample_type',sample_type,'status',status,'created_by_processing_event_id',created_by_processing_event_id,'created_at',created_at) order by created_at) from public.samples),'[]'::jsonb),
  'processing_events',coalesce((select jsonb_agg(jsonb_build_object('id',id,'event_id',event_id,'source_sample_id',source_sample_id,'status',status,'created_at',created_at) order by created_at) from public.processing_events),'[]'::jsonb),
  'processing_outputs',coalesce((select jsonb_agg(jsonb_build_object('id',id,'processing_event_id',processing_event_id,'output_type',output_type,'operation_type',operation_type,'result_status',result_status,'created_at',created_at) order by created_at) from public.processing_outputs),'[]'::jsonb),
  'audit_event_summary',coalesce((select jsonb_agg(jsonb_build_object('event_type',event_type,'count',event_count) order by event_type) from (select event_type,count(*) event_count from public.audit_events group by event_type) grouped),'[]'::jsonb),
  'unlinked_audit_events_preserved',coalesce((select jsonb_agg(jsonb_build_object('id',id,'event_type',event_type,'actor_id',actor_id,'metadata',metadata,'created_at',created_at) order by created_at) from public.audit_events where sample_id is null and processing_event_id is null and processing_output_id is null),'[]'::jsonb),
  'root_samples_requiring_classification',coalesce((select jsonb_agg(jsonb_build_object('id',id,'sample_id',sample_id,'external_id',external_id,'sample_type',sample_type,'sample_source_id',sample_source_id,'created_by',created_by,'created_at',created_at,'strict_disposition',case when external_id ilike 'TEST-%' then 'REMOVE_SYNTHETIC' else 'REVIEW_REQUIRED' end) order by created_at) from public.samples where parent_sample_id is null),'[]'::jsonb),
  'registration_sessions_requiring_classification',coalesce((select jsonb_agg(jsonb_build_object('id',id,'status',status,'sample_id',sample_id,'sample_source_id',sample_source_id,'created_by',created_by,'created_at',created_at) order by created_at) from public.source_registration_sessions),'[]'::jsonb),
  'source_subjects_requiring_classification',coalesce((select jsonb_agg(jsonb_build_object('id',id,'sample_source_id',sample_source_id,'vendor_subject_id',vendor_subject_id,'created_by',created_by,'created_at',created_at) order by created_at) from public.source_subjects),'[]'::jsonb),
  'sample_media_requiring_classification',coalesce((select jsonb_agg(jsonb_build_object('id',id,'registration_session_id',registration_session_id,'sample_id',sample_id,'sample_source_id',sample_source_id,'media_kind',media_kind,'document_type',document_type,'filename',filename,'storage_path',storage_path,'uploaded_by',uploaded_by,'uploaded_at',uploaded_at) order by uploaded_at) from public.sample_media),'[]'::jsonb),
  'qc_artifacts_requiring_classification',coalesce((select jsonb_agg(jsonb_build_object('id',id,'processing_output_id',processing_output_id,'filename',filename,'storage_path',storage_path,'uploaded_by',uploaded_by,'uploaded_at',uploaded_at) order by uploaded_at) from public.extraction_qc_artifacts),'[]'::jsonb),
  'storage_objects_requiring_classification',coalesce((select jsonb_agg(jsonb_build_object('id',id,'bucket_id',bucket_id,'name',name,'created_at',created_at) order by created_at) from storage.objects where bucket_id='sample-media'),'[]'::jsonb),
  'exact_target_removal_counts',(select jsonb_object_agg(object_type,remove_count) from removal_counts),
  'total_operational_counts',jsonb_build_object('samples',(select count(*) from public.samples),'processing_events',(select count(*) from public.processing_events),'processing_outputs',(select count(*) from public.processing_outputs),'processing_output_samples',(select count(*) from public.processing_output_samples),'audit_events',(select count(*) from public.audit_events),'registration_sessions',(select count(*) from public.source_registration_sessions),'source_subjects',(select count(*) from public.source_subjects),'source_sample_metadata',(select count(*) from public.source_sample_metadata),'sample_media',(select count(*) from public.sample_media),'extraction_qc_measurements',(select count(*) from public.extraction_qc_measurements),'extraction_qc_artifacts',(select count(*) from public.extraction_qc_artifacts),'sample_media_storage_objects',(select count(*) from storage.objects where bucket_id='sample-media'))
)) cleanup_dry_run;
