begin;

alter table public.samples add column sample_location text;
alter table public.samples add constraint samples_location_shape check (
  sample_location is null or (btrim(sample_location) <> '' and char_length(sample_location) <= 200)
);

-- Preserve the already-reviewed registration implementations behind wrappers
-- so this additive migration does not duplicate or weaken their validation.
alter function public.register_source_sample(jsonb)
rename to register_source_sample_without_location_internal;
alter function public.complete_source_registration(uuid,jsonb)
rename to complete_source_registration_without_location_internal;

revoke execute on function public.register_source_sample_without_location_internal(jsonb) from public,anon,authenticated;
revoke execute on function public.complete_source_registration_without_location_internal(uuid,jsonb) from public,anon,authenticated;

create function public.register_source_sample(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare result jsonb; sample_row public.samples; location_value text;
begin
  perform public.assert_approved();
  location_value := nullif(btrim(p_payload->>'sample_location'),'');
  if location_value is not null and char_length(location_value) > 200 then
    raise exception 'Sample location must be 200 characters or fewer';
  end if;
  result := public.register_source_sample_without_location_internal(p_payload);
  update public.samples set sample_location=location_value
  where id=(result->>'id')::uuid returning * into sample_row;
  if location_value is not null then
    insert into public.audit_events(event_type,sample_id,actor_id,metadata)
    values('SAMPLE_LOCATION_ASSIGNED',sample_row.id,auth.uid(),jsonb_build_object('sample_location',location_value,'workflow','SAMPLE_INTAKE'));
  end if;
  return to_jsonb(sample_row);
end $$;

create function public.complete_source_registration(
  p_registration_session_id uuid,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare result jsonb; sample_row public.samples; location_value text;
begin
  perform public.assert_approved();
  location_value := nullif(btrim(p_payload->>'sample_location'),'');
  if location_value is not null and char_length(location_value) > 200 then
    raise exception 'Sample location must be 200 characters or fewer';
  end if;
  result := public.complete_source_registration_without_location_internal(p_registration_session_id,p_payload);
  update public.samples set sample_location=location_value
  where id=(result->'sample'->>'id')::uuid returning * into sample_row;
  if location_value is not null then
    insert into public.audit_events(event_type,sample_id,actor_id,metadata)
    values('SAMPLE_LOCATION_ASSIGNED',sample_row.id,auth.uid(),jsonb_build_object('sample_location',location_value,'workflow','SAMPLE_INTAKE'));
  end if;
  return jsonb_set(result,'{sample}',to_jsonb(sample_row));
end $$;

revoke execute on function public.register_source_sample(jsonb) from public,anon;
revoke execute on function public.complete_source_registration(uuid,jsonb) from public,anon;
grant execute on function public.register_source_sample(jsonb) to authenticated;
grant execute on function public.complete_source_registration(uuid,jsonb) to authenticated;

commit;
