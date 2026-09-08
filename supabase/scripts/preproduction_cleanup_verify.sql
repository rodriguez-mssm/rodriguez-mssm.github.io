-- Read-only post-cleanup verification.
select jsonb_pretty(jsonb_build_object(
  'operational_counts',jsonb_build_object(
    'samples',(select count(*) from public.samples),
    'processing_events',(select count(*) from public.processing_events),
    'processing_outputs',(select count(*) from public.processing_outputs),
    'processing_output_samples',(select count(*) from public.processing_output_samples),
    'source_registration_sessions',(select count(*) from public.source_registration_sessions),
    'source_subjects',(select count(*) from public.source_subjects),
    'source_sample_metadata',(select count(*) from public.source_sample_metadata),
    'sample_media',(select count(*) from public.sample_media),
    'extraction_qc_measurements',(select count(*) from public.extraction_qc_measurements),
    'extraction_qc_artifacts',(select count(*) from public.extraction_qc_artifacts),
    'sample_media_storage_objects',(select count(*) from storage.objects where bucket_id='sample-media')
  ),
  'retained_counts',jsonb_build_object(
    'auth_users',(select count(*) from auth.users),
    'profiles',(select count(*) from public.profiles),
    'sample_sources',(select count(*) from public.sample_sources),
    'configuration_audit_events',(select count(*) from public.audit_events)
  ),
  'retained_profile',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'email',u.email,'approved',p.approved,'role',p.role,'disabled_at',p.disabled_at)) from public.profiles p join auth.users u on u.id=p.id),'[]'::jsonb),
  'retained_sample_sources',coalesce((select jsonb_agg(jsonb_build_object('id',id,'nickname',nickname,'name',name,'registration_profile',registration_profile)) from public.sample_sources),'[]'::jsonb),
  'remaining_audit_events',coalesce((select jsonb_agg(jsonb_build_object('id',id,'event_type',event_type,'metadata',metadata) order by id) from public.audit_events),'[]'::jsonb),
  'rls_disabled_tables',coalesce((select jsonb_agg(tablename order by tablename) from pg_tables where schemaname='public' and tablename in ('profiles','samples','processing_events','processing_outputs','processing_output_samples','audit_events','sample_sources','source_registration_sessions','source_subjects','source_sample_metadata','sample_media','extraction_qc_measurements','extraction_qc_artifacts') and not rowsecurity),'[]'::jsonb),
  'required_functions_missing',coalesce((select jsonb_agg(required.name order by required.name) from (values ('record_extraction_results_with_qc'),('record_extraction_qc_artifact'),('get_extraction_qc_for_sample'),('create_processing_plan'),('register_source_sample'),('complete_source_registration')) required(name) where not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=required.name)),'[]'::jsonb)
)) post_cleanup_verification;
