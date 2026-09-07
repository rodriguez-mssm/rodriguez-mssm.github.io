begin;

-- Reserved material must never exceed the source quantity. These constraints
-- also guard future database code, not only the V1 RPCs.
alter table public.samples
  add constraint reserved_cells_within_current check (
    current_cell_count_million is null or reserved_cell_count_million <= current_cell_count_million
  ),
  add constraint reserved_volume_within_current check (
    current_volume_ul is null or reserved_volume_ul <= current_volume_ul
  );

-- Replace the plan RPC to verify the accounting values supplied by a direct
-- API caller. The original browser already sends values in this shape.
create or replace function public.create_processing_plan(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  src public.samples;
  pe public.processing_events;
  po public.processing_outputs;
  item jsonb;
  out_sample public.samples;
  dimension public.quantity_dimension;
  allocated numeric := 0;
  item_allocation numeric;
  count integer;
  each_amount numeric;
  expected_volume numeric;
  max_vial_volume numeric;
  output_type public.sample_type;
  operation public.operation_type;
  i integer;
  created jsonb := '[]'::jsonb;
begin
  perform public.assert_approved();

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'A processing-plan object is required';
  end if;

  select * into src
  from public.samples
  where id = nullif(p_payload->>'source_sample_id', '')::uuid
  for update;

  if not found or src.status <> 'ACTIVE' then
    raise exception 'Source sample is not active';
  end if;

  if jsonb_typeof(p_payload->'outputs') <> 'array'
     or jsonb_array_length(p_payload->'outputs') = 0 then
    raise exception 'At least one output is required';
  end if;

  dimension := case
    when src.sample_type in ('PBMC','BMMNC','SORTED_CELLS') then 'CELLS'::public.quantity_dimension
    else 'VOLUME'::public.quantity_dimension
  end;

  -- Validate every output and derive the authoritative total allocation.
  for item in select * from jsonb_array_elements(p_payload->'outputs') loop
    output_type := nullif(item->>'output_type', '')::public.sample_type;
    operation := nullif(item->>'operation_type', '')::public.operation_type;
    item_allocation := nullif(item->>'source_allocation', '')::numeric;
    count := nullif(item->>'requested_count', '')::integer;
    each_amount := nullif(item->>'amount_each', '')::numeric;
    expected_volume := nullif(item->>'expected_volume_ul', '')::numeric;
    max_vial_volume := nullif(item->>'max_vial_volume_ul', '')::numeric;

    if item_allocation is null or item_allocation <= 0 or count is null or count <= 0 or count > 1000 then
      raise exception 'Each output requires a positive allocation and 1 to 1000 samples';
    end if;

    if operation = 'ALIQUOT' then
      if output_type <> src.sample_type then
        raise exception 'Aliquot output type must match the source sample type';
      end if;
      if each_amount is null or each_amount <= 0 or item_allocation <> each_amount * count then
        raise exception 'Aliquot source allocation must equal amount per sample multiplied by sample count';
      end if;
      if expected_volume is not null or max_vial_volume is not null then
        raise exception 'Aliquot outputs cannot include extraction yield fields';
      end if;
    elsif operation = 'EXTRACTION' then
      if output_type not in ('DNA','RNA') then
        raise exception 'Extraction output type must be DNA or RNA';
      end if;
      if each_amount is not null or expected_volume is null or expected_volume <= 0
         or max_vial_volume is null or max_vial_volume <= 0 then
        raise exception 'Extraction outputs require positive expected and maximum vial volumes';
      end if;
      if count <> ceil(expected_volume / max_vial_volume)::integer then
        raise exception 'Extraction vial count must equal expected volume divided by vial capacity, rounded up';
      end if;
    end if;

    allocated := allocated + item_allocation;
  end loop;

  if dimension = 'CELLS'
     and allocated > src.current_cell_count_million - src.reserved_cell_count_million then
    raise exception 'Allocation exceeds unreserved source quantity';
  end if;
  if dimension = 'VOLUME'
     and allocated > src.current_volume_ul - src.reserved_volume_ul then
    raise exception 'Allocation exceeds unreserved source quantity';
  end if;

  update public.samples
  set reserved_cell_count_million = reserved_cell_count_million + case when dimension='CELLS' then allocated else 0 end,
      reserved_volume_ul = reserved_volume_ul + case when dimension='VOLUME' then allocated else 0 end
  where id=src.id;

  insert into public.processing_events(event_id,source_sample_id,source_dimension,planned_source_allocation,notes,created_by)
  values('PE-'||lpad(nextval('public.processing_event_number_seq')::text,6,'0'),src.id,dimension,allocated,nullif(p_payload->>'notes',''),auth.uid())
  returning * into pe;

  for item in select * from jsonb_array_elements(p_payload->'outputs') loop
    count := (item->>'requested_count')::integer;
    each_amount := nullif(item->>'amount_each','')::numeric;
    insert into public.processing_outputs(processing_event_id,output_type,operation_type,planned_source_allocation,requested_count,amount_each,expected_volume_ul,max_vial_volume_ul,result_status)
    values(pe.id,(item->>'output_type')::public.sample_type,(item->>'operation_type')::public.operation_type,(item->>'source_allocation')::numeric,count,each_amount,nullif(item->>'expected_volume_ul','')::numeric,nullif(item->>'max_vial_volume_ul','')::numeric,case when item->>'operation_type'='EXTRACTION' then 'AWAITING_RESULTS'::public.result_status else 'NOT_REQUIRED'::public.result_status end)
    returning * into po;

    for i in 1..count loop
      insert into public.samples(sample_id,sample_type,parent_sample_id,status,planned_cell_count_million,planned_volume_ul,created_by_processing_event_id,created_by)
      values(public.next_sample_identifier(po.output_type),po.output_type,src.id,'PLANNED',case when po.output_type in ('PBMC','BMMNC','SORTED_CELLS') and po.operation_type='ALIQUOT' then each_amount end,case when po.output_type in ('SERUM','PLASMA','DNA','RNA') and po.operation_type='ALIQUOT' then each_amount end,pe.id,auth.uid())
      returning * into out_sample;
      insert into public.processing_output_samples values(po.id,out_sample.id,i,false);
      created := created || jsonb_build_array(to_jsonb(out_sample));
      insert into public.audit_events(event_type,sample_id,processing_event_id,processing_output_id,actor_id,metadata)
      values('LABEL_RESERVED',out_sample.id,pe.id,po.id,auth.uid(),jsonb_build_object('ordinal',i));
    end loop;
  end loop;

  insert into public.audit_events(event_type,processing_event_id,sample_id,actor_id,metadata)
  values('PROCESSING_PLANNED',pe.id,src.id,auth.uid(),jsonb_build_object('planned_source_allocation',allocated));
  return jsonb_build_object('event_id',pe.event_id,'id',pe.id,'samples',created);
end $$;

-- Replace result entry to reject null/non-finite logical inputs and ensure the
-- distribution cannot create samples without a corresponding volume.
create or replace function public.record_extraction_results(
  p_output_id uuid,
  p_actual_volume_ul numeric,
  p_concentration_ng_ul numeric,
  p_vial_volumes numeric[],
  p_allow_over_capacity boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  po public.processing_outputs;
  pe public.processing_events;
  src public.samples;
  capacity numeric;
  existing_count integer;
  needed integer;
  additional jsonb := '[]'::jsonb;
  sample_row record;
  idx integer := 0;
  used_count integer;
  distribution_total numeric;
begin
  perform public.assert_approved();
  if p_output_id is null or p_actual_volume_ul is null or p_actual_volume_ul <= 0
     or p_concentration_ng_ul is null or p_concentration_ng_ul < 0
     or p_vial_volumes is null or cardinality(p_vial_volumes) = 0
     or p_allow_over_capacity is null then
    raise exception 'Complete, non-negative extraction measurements and at least one vial are required';
  end if;
  if array_position(p_vial_volumes, null) is not null
     or exists(select 1 from unnest(p_vial_volumes) x where x <= 0) then
    raise exception 'Every vial volume must be greater than zero';
  end if;

  select * into po from public.processing_outputs where id=p_output_id for update;
  if not found or po.operation_type <> 'EXTRACTION' or po.result_status <> 'AWAITING_RESULTS' then
    raise exception 'Output is not awaiting extraction results';
  end if;
  select * into pe from public.processing_events where id=po.processing_event_id for update;
  select * into src from public.samples where id=pe.source_sample_id for update;

  select sum(x),cardinality(p_vial_volumes) into distribution_total,used_count from unnest(p_vial_volumes) x;
  if abs(distribution_total-p_actual_volume_ul) > 0.01 then
    raise exception 'Vial volumes must equal actual volume within 0.01 µL';
  end if;
  if not p_allow_over_capacity
     and exists(select 1 from unnest(p_vial_volumes) x where x > po.max_vial_volume_ul + 0.01) then
    raise exception 'A vial exceeds capacity';
  end if;

  select count(*),count(*) * po.max_vial_volume_ul into existing_count,capacity
  from public.processing_output_samples where processing_output_id=po.id;
  needed := greatest(0,used_count-existing_count,ceil((p_actual_volume_ul-capacity)/po.max_vial_volume_ul)::integer);
  if needed > 0 then additional := public.add_output_vials_internal(po.id,needed); end if;

  for sample_row in
    select s.*,pos.ordinal from public.processing_output_samples pos
    join public.samples s on s.id=pos.sample_id
    where pos.processing_output_id=po.id order by pos.ordinal for update of s
  loop
    idx := idx+1;
    if idx <= used_count then
      update public.samples set planned_volume_ul=p_vial_volumes[idx],concentration_ng_ul=p_concentration_ng_ul where id=sample_row.id;
    else
      update public.samples set status='NOT_CREATED' where id=sample_row.id and status='PLANNED';
      insert into public.audit_events(event_type,sample_id,processing_event_id,processing_output_id,actor_id,metadata)
      values('SAMPLE_NOT_CREATED',sample_row.id,pe.id,po.id,auth.uid(),jsonb_build_object('reason','actual_yield_required_fewer_vials'));
    end if;
  end loop;

  update public.processing_outputs
  set actual_source_consumption=planned_source_allocation,actual_volume_ul=p_actual_volume_ul,
      concentration_ng_ul=p_concentration_ng_ul,result_status='RESULTS_RECORDED',
      result_recorded_at=now(),result_recorded_by=auth.uid()
  where id=po.id;

  if pe.source_dimension='CELLS' then
    update public.samples
    set current_cell_count_million=current_cell_count_million-po.planned_source_allocation,
        reserved_cell_count_million=reserved_cell_count_million-po.planned_source_allocation,
        status=case when current_cell_count_million-po.planned_source_allocation=0 then 'CONSUMED' else status end
    where id=src.id;
  else
    update public.samples
    set current_volume_ul=current_volume_ul-po.planned_source_allocation,
        reserved_volume_ul=reserved_volume_ul-po.planned_source_allocation,
        status=case when current_volume_ul-po.planned_source_allocation=0 then 'CONSUMED' else status end
    where id=src.id;
  end if;

  update public.processing_events
  set actual_source_consumption=actual_source_consumption+po.planned_source_allocation,status='IN_PROGRESS'
  where id=pe.id;
  insert into public.audit_events(event_type,sample_id,processing_event_id,processing_output_id,actor_id,metadata)
  values('EXTRACTION_RESULTS_RECORDED',src.id,pe.id,po.id,auth.uid(),jsonb_build_object('actual_volume_ul',p_actual_volume_ul,'concentration_ng_ul',p_concentration_ng_ul,'distribution',to_jsonb(p_vial_volumes),'capacity_override',p_allow_over_capacity));
  return jsonb_build_object('additional_samples',additional,'activated_ready_count',used_count,'total_mass_ng',p_actual_volume_ul*p_concentration_ng_ul);
end $$;

-- Extra vials are an internal consequence of result entry. Direct invocation
-- is unnecessary and could bypass that state machine.
revoke execute on function public.add_output_vials(uuid,integer) from authenticated;

-- Reassert the exact public RPC surface after replacements.
revoke execute on function public.create_processing_plan(jsonb) from public,anon;
revoke execute on function public.record_extraction_results(uuid,numeric,numeric,numeric[],boolean) from public,anon;
grant execute on function public.is_approved_lab_user() to authenticated;
grant execute on function public.create_processing_plan(jsonb) to authenticated;
grant execute on function public.record_extraction_results(uuid,numeric,numeric,numeric[],boolean) to authenticated;

commit;
