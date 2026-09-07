begin;

create extension if not exists pgcrypto;

create type public.lab_role as enum ('admin', 'user');
create type public.sample_status as enum ('PLANNED', 'ACTIVE', 'NOT_CREATED', 'CONSUMED', 'DISCARDED');
create type public.sample_type as enum ('PBMC', 'BMMNC', 'SORTED_CELLS', 'SERUM', 'PLASMA', 'DNA', 'RNA');
create type public.quantity_dimension as enum ('CELLS', 'VOLUME');
create type public.processing_status as enum ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
create type public.operation_type as enum ('ALIQUOT', 'EXTRACTION');
create type public.result_status as enum ('NOT_REQUIRED', 'AWAITING_RESULTS', 'RESULTS_RECORDED');

create sequence public.processing_event_number_seq;
create sequence public.pbmc_sample_number_seq;
create sequence public.bmmnc_sample_number_seq;
create sequence public.sorted_cells_sample_number_seq;
create sequence public.serum_sample_number_seq;
create sequence public.plasma_sample_number_seq;
create sequence public.dna_sample_number_seq;
create sequence public.rna_sample_number_seq;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role public.lab_role not null default 'user',
  approved boolean not null default false,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.samples (
  id uuid primary key default gen_random_uuid(),
  sample_id text not null unique check (sample_id ~ '^[A-Z][A-Z0-9_]*-[0-9]{6}$'),
  sample_type public.sample_type not null,
  parent_sample_id uuid references public.samples(id) on delete restrict,
  status public.sample_status not null,
  external_id text,
  original_cell_count_million numeric check (original_cell_count_million >= 0),
  current_cell_count_million numeric check (current_cell_count_million >= 0),
  reserved_cell_count_million numeric not null default 0 check (reserved_cell_count_million >= 0),
  original_volume_ul numeric check (original_volume_ul >= 0),
  current_volume_ul numeric check (current_volume_ul >= 0),
  reserved_volume_ul numeric not null default 0 check (reserved_volume_ul >= 0),
  planned_cell_count_million numeric check (planned_cell_count_million >= 0),
  planned_volume_ul numeric check (planned_volume_ul >= 0),
  concentration_ng_ul numeric check (concentration_ng_ul >= 0),
  total_mass_ng numeric generated always as (case when current_volume_ul is not null and concentration_ng_ul is not null then current_volume_ul * concentration_ng_ul end) stored,
  created_by_processing_event_id uuid,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  notes text,
  constraint sample_not_own_parent check (parent_sample_id is null or parent_sample_id <> id),
  constraint original_current_cell_pair check (original_cell_count_million is null or current_cell_count_million is not null or status = 'PLANNED'),
  constraint quantity_shape check (
    (sample_type in ('PBMC','BMMNC','SORTED_CELLS') and original_volume_ul is null and current_volume_ul is null)
    or (sample_type in ('SERUM','PLASMA','DNA','RNA') and original_cell_count_million is null and current_cell_count_million is null)
  )
);

create table public.processing_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique check (event_id ~ '^PE-[0-9]{6}$'),
  source_sample_id uuid not null references public.samples(id) on delete restrict,
  source_dimension public.quantity_dimension not null,
  planned_source_allocation numeric not null check (planned_source_allocation > 0),
  actual_source_consumption numeric not null default 0 check (actual_source_consumption >= 0),
  status public.processing_status not null default 'PLANNED',
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.samples add constraint samples_processing_event_fkey foreign key (created_by_processing_event_id) references public.processing_events(id) on delete restrict;

create table public.processing_outputs (
  id uuid primary key default gen_random_uuid(),
  processing_event_id uuid not null references public.processing_events(id) on delete restrict,
  output_type public.sample_type not null,
  operation_type public.operation_type not null,
  planned_source_allocation numeric not null check (planned_source_allocation > 0),
  actual_source_consumption numeric check (actual_source_consumption >= 0),
  requested_count integer not null check (requested_count > 0),
  amount_each numeric check (amount_each > 0),
  expected_volume_ul numeric check (expected_volume_ul > 0),
  max_vial_volume_ul numeric check (max_vial_volume_ul > 0),
  actual_volume_ul numeric check (actual_volume_ul >= 0),
  concentration_ng_ul numeric check (concentration_ng_ul >= 0),
  actual_total_mass_ng numeric generated always as (case when actual_volume_ul is not null and concentration_ng_ul is not null then actual_volume_ul * concentration_ng_ul end) stored,
  result_status public.result_status not null,
  result_recorded_at timestamptz,
  result_recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint output_plan_shape check (
    (operation_type = 'ALIQUOT' and amount_each is not null and expected_volume_ul is null and max_vial_volume_ul is null and result_status = 'NOT_REQUIRED')
    or (operation_type = 'EXTRACTION' and expected_volume_ul is not null and max_vial_volume_ul is not null and result_status in ('AWAITING_RESULTS','RESULTS_RECORDED'))
  )
);

create table public.processing_output_samples (
  processing_output_id uuid not null references public.processing_outputs(id) on delete restrict,
  sample_id uuid not null unique references public.samples(id) on delete restrict,
  ordinal integer not null check (ordinal > 0),
  is_additional boolean not null default false,
  primary key (processing_output_id, ordinal)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type ~ '^[A-Z][A-Z0-9_]+$'),
  sample_id uuid references public.samples(id) on delete restrict,
  processing_event_id uuid references public.processing_events(id) on delete restrict,
  processing_output_id uuid references public.processing_outputs(id) on delete restrict,
  actor_id uuid not null references auth.users(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index samples_parent_idx on public.samples(parent_sample_id);
create index samples_type_status_idx on public.samples(sample_type, status);
create index samples_external_id_idx on public.samples(external_id) where external_id is not null;
create index processing_events_source_idx on public.processing_events(source_sample_id, created_at desc);
create index processing_outputs_pending_idx on public.processing_outputs(result_status, created_at) where result_status = 'AWAITING_RESULTS';
create index audit_sample_idx on public.audit_events(sample_id, created_at desc);
create index audit_event_idx on public.audit_events(processing_event_id, created_at desc);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles(id, display_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end $$;
create trigger auth_user_profile after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_approved_lab_user() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.profiles where id = auth.uid() and approved and disabled_at is null)
$$;

create or replace function public.next_sample_identifier(p_type public.sample_type) returns text language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare n bigint; prefix text;
begin
  case p_type
    when 'PBMC' then n := nextval('public.pbmc_sample_number_seq'); prefix := 'PBMC';
    when 'BMMNC' then n := nextval('public.bmmnc_sample_number_seq'); prefix := 'BMMNC';
    when 'SORTED_CELLS' then n := nextval('public.sorted_cells_sample_number_seq'); prefix := 'SC';
    when 'SERUM' then n := nextval('public.serum_sample_number_seq'); prefix := 'SERUM';
    when 'PLASMA' then n := nextval('public.plasma_sample_number_seq'); prefix := 'PLASMA';
    when 'DNA' then n := nextval('public.dna_sample_number_seq'); prefix := 'DNA';
    when 'RNA' then n := nextval('public.rna_sample_number_seq'); prefix := 'RNA';
  end case;
  return prefix || '-' || lpad(n::text, 6, '0');
end $$;

create or replace function public.assert_approved() returns void language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not public.is_approved_lab_user() then raise exception 'Inventory access is not approved' using errcode = '42501'; end if;
end $$;

create or replace function public.refresh_processing_event_status(p_event_id uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists(select 1 from public.samples where created_by_processing_event_id=p_event_id and status='PLANNED')
     and not exists(select 1 from public.processing_outputs where processing_event_id=p_event_id and result_status='AWAITING_RESULTS') then
    update public.processing_events set status='COMPLETED',completed_at=coalesce(completed_at,now()) where id=p_event_id;
  else
    update public.processing_events set status='IN_PROGRESS' where id=p_event_id and status='PLANNED';
  end if;
end $$;

create or replace function public.register_source_sample(p_payload jsonb) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.samples; st public.sample_type; cells numeric; volume numeric; concentration numeric;
begin
  perform public.assert_approved(); st := (p_payload->>'sample_type')::public.sample_type;
  cells := nullif(p_payload->>'cell_count_million','')::numeric; volume := nullif(p_payload->>'volume_ul','')::numeric; concentration := nullif(p_payload->>'concentration_ng_ul','')::numeric;
  if st in ('PBMC','BMMNC','SORTED_CELLS') and (cells is null or cells < 0) then raise exception 'Cell count is required'; end if;
  if st in ('SERUM','PLASMA','DNA','RNA') and (volume is null or volume < 0) then raise exception 'Volume is required'; end if;
  insert into public.samples(sample_id,sample_type,status,external_id,original_cell_count_million,current_cell_count_million,original_volume_ul,current_volume_ul,concentration_ng_ul,created_by,activated_at,notes)
  values(public.next_sample_identifier(st),st,'ACTIVE',nullif(p_payload->>'external_id',''),cells,cells,volume,volume,concentration,auth.uid(),now(),nullif(p_payload->>'notes','')) returning * into s;
  insert into public.audit_events(event_type,sample_id,actor_id,metadata) values('SOURCE_REGISTERED',s.id,auth.uid(),jsonb_build_object('sample_id',s.sample_id));
  return to_jsonb(s);
end $$;

create or replace function public.create_processing_plan(p_payload jsonb) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare src public.samples; pe public.processing_events; po public.processing_outputs; item jsonb; out_sample public.samples; dimension public.quantity_dimension; allocated numeric := 0; count integer; each_amount numeric; i integer; created jsonb := '[]'::jsonb;
begin
  perform public.assert_approved();
  select * into src from public.samples where id = (p_payload->>'source_sample_id')::uuid for update;
  if not found or src.status <> 'ACTIVE' then raise exception 'Source sample is not active'; end if;
  if jsonb_array_length(coalesce(p_payload->'outputs','[]'::jsonb)) = 0 then raise exception 'At least one output is required'; end if;
  for item in select * from jsonb_array_elements(p_payload->'outputs') loop allocated := allocated + (item->>'source_allocation')::numeric; end loop;
  dimension := case when src.sample_type in ('PBMC','BMMNC','SORTED_CELLS') then 'CELLS'::public.quantity_dimension else 'VOLUME'::public.quantity_dimension end;
  if allocated <= 0 then raise exception 'Allocation must be positive'; end if;
  if dimension = 'CELLS' and allocated > src.current_cell_count_million - src.reserved_cell_count_million then raise exception 'Allocation exceeds unreserved source quantity'; end if;
  if dimension = 'VOLUME' and allocated > src.current_volume_ul - src.reserved_volume_ul then raise exception 'Allocation exceeds unreserved source quantity'; end if;
  update public.samples set reserved_cell_count_million = reserved_cell_count_million + case when dimension='CELLS' then allocated else 0 end, reserved_volume_ul = reserved_volume_ul + case when dimension='VOLUME' then allocated else 0 end where id=src.id;
  insert into public.processing_events(event_id,source_sample_id,source_dimension,planned_source_allocation,notes,created_by)
  values('PE-'||lpad(nextval('public.processing_event_number_seq')::text,6,'0'),src.id,dimension,allocated,nullif(p_payload->>'notes',''),auth.uid()) returning * into pe;
  for item in select * from jsonb_array_elements(p_payload->'outputs') loop
    count := (item->>'requested_count')::integer; each_amount := nullif(item->>'amount_each','')::numeric;
    insert into public.processing_outputs(processing_event_id,output_type,operation_type,planned_source_allocation,requested_count,amount_each,expected_volume_ul,max_vial_volume_ul,result_status)
    values(pe.id,(item->>'output_type')::public.sample_type,(item->>'operation_type')::public.operation_type,(item->>'source_allocation')::numeric,count,each_amount,nullif(item->>'expected_volume_ul','')::numeric,nullif(item->>'max_vial_volume_ul','')::numeric,case when item->>'operation_type'='EXTRACTION' then 'AWAITING_RESULTS'::public.result_status else 'NOT_REQUIRED'::public.result_status end) returning * into po;
    for i in 1..count loop
      insert into public.samples(sample_id,sample_type,parent_sample_id,status,planned_cell_count_million,planned_volume_ul,created_by_processing_event_id,created_by)
      values(public.next_sample_identifier(po.output_type),po.output_type,src.id,'PLANNED',case when po.output_type in ('PBMC','BMMNC','SORTED_CELLS') and po.operation_type='ALIQUOT' then each_amount end,case when po.output_type in ('SERUM','PLASMA','DNA','RNA') and po.operation_type='ALIQUOT' then each_amount end,pe.id,auth.uid()) returning * into out_sample;
      insert into public.processing_output_samples values(po.id,out_sample.id,i,false);
      created := created || jsonb_build_array(to_jsonb(out_sample));
      insert into public.audit_events(event_type,sample_id,processing_event_id,processing_output_id,actor_id,metadata) values('LABEL_RESERVED',out_sample.id,pe.id,po.id,auth.uid(),jsonb_build_object('ordinal',i));
    end loop;
  end loop;
  insert into public.audit_events(event_type,processing_event_id,sample_id,actor_id,metadata) values('PROCESSING_PLANNED',pe.id,src.id,auth.uid(),jsonb_build_object('planned_source_allocation',allocated));
  return jsonb_build_object('event_id',pe.event_id,'id',pe.id,'samples',created);
end $$;

create or replace function public.add_output_vials_internal(p_output_id uuid, p_count integer) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare po public.processing_outputs; pe public.processing_events; src public.samples; s public.samples; start_at integer; i integer; result jsonb := '[]'::jsonb;
begin
  if p_count <= 0 then return result; end if;
  select * into po from public.processing_outputs where id=p_output_id for update;
  select * into pe from public.processing_events where id=po.processing_event_id;
  select * into src from public.samples where id=pe.source_sample_id;
  select coalesce(max(ordinal),0) into start_at from public.processing_output_samples where processing_output_id=po.id;
  for i in 1..p_count loop
    insert into public.samples(sample_id,sample_type,parent_sample_id,status,created_by_processing_event_id,created_by)
    values(public.next_sample_identifier(po.output_type),po.output_type,src.id,'PLANNED',pe.id,auth.uid()) returning * into s;
    insert into public.processing_output_samples values(po.id,s.id,start_at+i,true);
    insert into public.audit_events(event_type,sample_id,processing_event_id,processing_output_id,actor_id,metadata) values('ADDITIONAL_VIAL_CREATED',s.id,pe.id,po.id,auth.uid(),'{}');
    result := result || jsonb_build_array(to_jsonb(s));
  end loop;
  update public.processing_outputs set requested_count=requested_count+p_count where id=po.id;
  return result;
end $$;

create or replace function public.add_output_vials(p_output_id uuid,p_count integer) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public.assert_approved(); return public.add_output_vials_internal(p_output_id,p_count); end $$;

create or replace function public.record_extraction_results(p_output_id uuid,p_actual_volume_ul numeric,p_concentration_ng_ul numeric,p_vial_volumes numeric[],p_allow_over_capacity boolean default false) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare po public.processing_outputs; pe public.processing_events; src public.samples; capacity numeric; existing_count integer; needed integer; additional jsonb := '[]'::jsonb; sample_row record; idx integer := 0; used_count integer; distribution_total numeric;
begin
  perform public.assert_approved();
  if p_actual_volume_ul < 0 or p_concentration_ng_ul < 0 then raise exception 'Measurements cannot be negative'; end if;
  select * into po from public.processing_outputs where id=p_output_id for update;
  if not found or po.operation_type <> 'EXTRACTION' or po.result_status <> 'AWAITING_RESULTS' then raise exception 'Output is not awaiting extraction results'; end if;
  select * into pe from public.processing_events where id=po.processing_event_id for update;
  select * into src from public.samples where id=pe.source_sample_id for update;
  select coalesce(sum(x),0), cardinality(p_vial_volumes) into distribution_total, used_count from unnest(p_vial_volumes) x;
  if used_count is null or used_count=0 then raise exception 'At least one vial volume is required'; end if;
  if abs(distribution_total-p_actual_volume_ul) > 0.01 then raise exception 'Vial volumes must equal actual volume within 0.01 µL'; end if;
  if not p_allow_over_capacity and exists(select 1 from unnest(p_vial_volumes) x where x > po.max_vial_volume_ul + 0.01 or x < 0) then raise exception 'A vial exceeds capacity or has a negative volume'; end if;
  select count(*), count(*) * po.max_vial_volume_ul into existing_count,capacity from public.processing_output_samples where processing_output_id=po.id;
  needed := greatest(0,used_count-existing_count,ceil((p_actual_volume_ul-capacity)/po.max_vial_volume_ul)::integer);
  if needed > 0 then additional := public.add_output_vials_internal(po.id,needed); end if;
  for sample_row in select s.*,pos.ordinal from public.processing_output_samples pos join public.samples s on s.id=pos.sample_id where pos.processing_output_id=po.id order by pos.ordinal for update of s loop
    idx := idx+1;
    if idx <= used_count then
      update public.samples set planned_volume_ul=p_vial_volumes[idx], concentration_ng_ul=p_concentration_ng_ul where id=sample_row.id;
    else
      update public.samples set status='NOT_CREATED' where id=sample_row.id and status='PLANNED';
      insert into public.audit_events(event_type,sample_id,processing_event_id,processing_output_id,actor_id,metadata) values('SAMPLE_NOT_CREATED',sample_row.id,pe.id,po.id,auth.uid(),jsonb_build_object('reason','actual_yield_required_fewer_vials'));
    end if;
  end loop;
  update public.processing_outputs set actual_source_consumption=planned_source_allocation,actual_volume_ul=p_actual_volume_ul,concentration_ng_ul=p_concentration_ng_ul,result_status='RESULTS_RECORDED',result_recorded_at=now(),result_recorded_by=auth.uid() where id=po.id;
  if pe.source_dimension='CELLS' then update public.samples set current_cell_count_million=current_cell_count_million-po.planned_source_allocation,reserved_cell_count_million=reserved_cell_count_million-po.planned_source_allocation,status=case when current_cell_count_million-po.planned_source_allocation=0 then 'CONSUMED' else status end where id=src.id;
  else update public.samples set current_volume_ul=current_volume_ul-po.planned_source_allocation,reserved_volume_ul=reserved_volume_ul-po.planned_source_allocation,status=case when current_volume_ul-po.planned_source_allocation=0 then 'CONSUMED' else status end where id=src.id; end if;
  update public.processing_events set actual_source_consumption=actual_source_consumption+po.planned_source_allocation,status='IN_PROGRESS' where id=pe.id;
  insert into public.audit_events(event_type,sample_id,processing_event_id,processing_output_id,actor_id,metadata) values('EXTRACTION_RESULTS_RECORDED',src.id,pe.id,po.id,auth.uid(),jsonb_build_object('actual_volume_ul',p_actual_volume_ul,'concentration_ng_ul',p_concentration_ng_ul,'distribution',to_jsonb(p_vial_volumes),'capacity_override',p_allow_over_capacity));
  return jsonb_build_object('additional_samples',additional,'activated_ready_count',used_count,'total_mass_ng',p_actual_volume_ul*p_concentration_ng_ul);
end $$;

create or replace function public.activate_sample(p_sample_id text) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.samples; po public.processing_outputs; pe public.processing_events; src public.samples;
begin
  perform public.assert_approved(); select * into s from public.samples where sample_id=upper(trim(p_sample_id)) for update;
  if not found then raise exception 'Sample not found'; end if;
  if s.status <> 'PLANNED' then raise exception 'Sample cannot be activated from status %',s.status; end if;
  if s.created_by_processing_event_id is not null then
    select o.* into po from public.processing_outputs o join public.processing_output_samples os on os.processing_output_id=o.id where os.sample_id=s.id;
    if po.operation_type='EXTRACTION' and po.result_status <> 'RESULTS_RECORDED' then raise exception 'Extraction results must be recorded before activation'; end if;
    select * into pe from public.processing_events where id=po.processing_event_id for update; select * into src from public.samples where id=pe.source_sample_id for update;
    if po.operation_type='ALIQUOT' then
      if pe.source_dimension='CELLS' then update public.samples set current_cell_count_million=current_cell_count_million-po.amount_each,reserved_cell_count_million=reserved_cell_count_million-po.amount_each,status=case when current_cell_count_million-po.amount_each=0 then 'CONSUMED' else status end where id=src.id;
      else update public.samples set current_volume_ul=current_volume_ul-po.amount_each,reserved_volume_ul=reserved_volume_ul-po.amount_each,status=case when current_volume_ul-po.amount_each=0 then 'CONSUMED' else status end where id=src.id; end if;
      update public.processing_outputs set actual_source_consumption=coalesce(actual_source_consumption,0)+po.amount_each where id=po.id;
      update public.processing_events set actual_source_consumption=actual_source_consumption+po.amount_each,status='IN_PROGRESS' where id=pe.id;
    end if;
  end if;
  update public.samples set status='ACTIVE',activated_at=now(),original_cell_count_million=planned_cell_count_million,current_cell_count_million=planned_cell_count_million,original_volume_ul=planned_volume_ul,current_volume_ul=planned_volume_ul where id=s.id returning * into s;
  insert into public.audit_events(event_type,sample_id,processing_event_id,processing_output_id,actor_id,metadata) values('SAMPLE_ACTIVATED',s.id,pe.id,po.id,auth.uid(),'{}');
  if pe.id is not null then perform public.refresh_processing_event_status(pe.id); end if;
  return to_jsonb(s);
end $$;

create or replace function public.mark_sample_not_created(p_sample_id text) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.samples; po public.processing_outputs; pe public.processing_events; src public.samples;
begin
  perform public.assert_approved(); select * into s from public.samples where sample_id=upper(trim(p_sample_id)) for update;
  if not found then raise exception 'Sample not found'; end if; if s.status <> 'PLANNED' then raise exception 'Only planned samples may be marked not created'; end if;
  select o.* into po from public.processing_outputs o join public.processing_output_samples os on os.processing_output_id=o.id where os.sample_id=s.id;
  if po.operation_type='EXTRACTION' and po.result_status='AWAITING_RESULTS' then raise exception 'Record extraction results before deciding which planned vials were created'; end if;
  select * into pe from public.processing_events where id=po.processing_event_id for update; select * into src from public.samples where id=pe.source_sample_id for update;
  if po.operation_type='ALIQUOT' then
    if pe.source_dimension='CELLS' then update public.samples set reserved_cell_count_million=reserved_cell_count_million-po.amount_each where id=src.id;
    else update public.samples set reserved_volume_ul=reserved_volume_ul-po.amount_each where id=src.id; end if;
  end if;
  update public.samples set status='NOT_CREATED' where id=s.id returning * into s;
  insert into public.audit_events(event_type,sample_id,processing_event_id,processing_output_id,actor_id,metadata) values('SAMPLE_NOT_CREATED',s.id,pe.id,po.id,auth.uid(),jsonb_build_object('reason','user_confirmed_unused_label'));
  perform public.refresh_processing_event_status(pe.id);
  return to_jsonb(s);
end $$;

create or replace function public.mark_labels_printed(p_sample_ids uuid[]) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare sid uuid; n integer:=0;
begin perform public.assert_approved(); foreach sid in array p_sample_ids loop if exists(select 1 from public.samples where id=sid) then insert into public.audit_events(event_type,sample_id,actor_id) values('LABEL_PRINTED',sid,auth.uid()); n:=n+1; end if; end loop; return n; end $$;

alter table public.profiles enable row level security;
alter table public.samples enable row level security;
alter table public.processing_events enable row level security;
alter table public.processing_outputs enable row level security;
alter table public.processing_output_samples enable row level security;
alter table public.audit_events enable row level security;

create policy profile_read_self on public.profiles for select to authenticated using (id=auth.uid());
create policy samples_read_approved on public.samples for select to authenticated using (public.is_approved_lab_user());
create policy processing_events_read_approved on public.processing_events for select to authenticated using (public.is_approved_lab_user());
create policy processing_outputs_read_approved on public.processing_outputs for select to authenticated using (public.is_approved_lab_user());
create policy processing_output_samples_read_approved on public.processing_output_samples for select to authenticated using (public.is_approved_lab_user());
create policy audit_events_read_approved on public.audit_events for select to authenticated using (public.is_approved_lab_user());

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.profiles,public.samples,public.processing_events,public.processing_outputs,public.processing_output_samples,public.audit_events to authenticated;
revoke execute on all functions in schema public from public,anon;
grant execute on function public.register_source_sample(jsonb),public.create_processing_plan(jsonb),public.add_output_vials(uuid,integer),public.record_extraction_results(uuid,numeric,numeric,numeric[],boolean),public.activate_sample(text),public.mark_sample_not_created(text),public.mark_labels_printed(uuid[]) to authenticated;

commit;
