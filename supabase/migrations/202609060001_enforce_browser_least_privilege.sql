begin;

-- Supabase projects may have default privileges that grant newly created
-- public tables and functions to browser roles. Establish the complete V1
-- browser surface explicitly instead of relying on RLS alone.
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant usage on schema public to authenticated;
grant select on table
  public.profiles,
  public.samples,
  public.processing_events,
  public.processing_outputs,
  public.processing_output_samples,
  public.audit_events
to authenticated;

-- Required for evaluation of approved-user SELECT policies. It returns only
-- the approval state of the current authenticated session.
grant execute on function public.is_approved_lab_user() to authenticated;

-- The only state-changing browser entry points. Each calls assert_approved()
-- and performs its changes inside one database transaction.
grant execute on function public.register_source_sample(jsonb) to authenticated;
grant execute on function public.create_processing_plan(jsonb) to authenticated;
grant execute on function public.record_extraction_results(uuid,numeric,numeric,numeric[],boolean) to authenticated;
grant execute on function public.activate_sample(text) to authenticated;
grant execute on function public.mark_sample_not_created(text) to authenticated;
grant execute on function public.mark_labels_printed(uuid[]) to authenticated;

commit;
