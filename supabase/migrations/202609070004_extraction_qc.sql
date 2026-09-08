begin;

create type public.qc_material_type as enum ('DNA', 'RNA');
create type public.qc_artifact_type as enum ('DNA_INTEGRITY_TRACE', 'RNA_INTEGRITY_TRACE', 'FRAGMENT_DISTRIBUTION_TRACE');
create type public.qc_instrument_type as enum ('TAPESTATION', 'BIOANALYZER', 'FRAGMENT_ANALYZER', 'OTHER');

create table public.extraction_qc_measurements (
  id uuid primary key default gen_random_uuid(),
  processing_output_id uuid not null references public.processing_outputs(id) on delete restrict,
  revision integer not null default 1 check (revision > 0),
  is_current boolean not null default true,
  material_type public.qc_material_type not null,
  actual_volume_ul numeric not null check (actual_volume_ul > 0),
  qubit_concentration_ng_ul numeric not null check (qubit_concentration_ng_ul >= 0),
  total_mass_ng numeric generated always as (actual_volume_ul * qubit_concentration_ng_ul) stored,
  a230 numeric check (a230 >= 0),
  a260 numeric check (a260 >= 0),
  a280 numeric check (a280 >= 0),
  a260_a280_ratio numeric generated always as
    (case when a260 is not null and a280 is not null and a280 <> 0 then a260 / a280 end) stored,
  a260_a230_ratio numeric generated always as
    (case when a260 is not null and a230 is not null and a230 <> 0 then a260 / a230 end) stored,
  din numeric check (din between 1 and 10),
  rin numeric check (rin between 1 and 10),
  measured_at timestamptz,
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint extraction_qc_integrity_shape check (
    (material_type = 'DNA' and rin is null) or
    (material_type = 'RNA' and din is null)
  ),
  unique(processing_output_id, revision)
);

create unique index extraction_qc_one_current_idx
on public.extraction_qc_measurements(processing_output_id) where is_current;
create index extraction_qc_din_idx on public.extraction_qc_measurements(din) where is_current and din is not null;
create index extraction_qc_rin_idx on public.extraction_qc_measurements(rin) where is_current and rin is not null;
create index extraction_qc_qubit_idx on public.extraction_qc_measurements(qubit_concentration_ng_ul) where is_current;

create function public.validate_extraction_qc_measurement() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare po public.processing_outputs;
begin
  select * into po from public.processing_outputs where id=new.processing_output_id;
  if not found or po.operation_type <> 'EXTRACTION' or po.output_type::text <> new.material_type::text then
    raise exception 'QC material must match a DNA/RNA extraction output';
  end if;
  if po.result_status <> 'RESULTS_RECORDED' or po.actual_volume_ul <> new.actual_volume_ul
     or po.concentration_ng_ul <> new.qubit_concentration_ng_ul then
    raise exception 'QC yield must match the recorded extraction result';
  end if;
  return new;
end $$;
create trigger extraction_qc_measurement_binding
before insert or update on public.extraction_qc_measurements
for each row execute function public.validate_extraction_qc_measurement();
revoke execute on function public.validate_extraction_qc_measurement() from public,anon,authenticated;

create table public.extraction_qc_artifacts (
  id uuid primary key,
  processing_output_id uuid not null references public.processing_outputs(id) on delete restrict,
  qc_type public.qc_artifact_type not null,
  instrument_type public.qc_instrument_type,
  instrument_model text,
  measurement_date date,
  notes text,
  filename text not null check (btrim(filename) <> ''),
  storage_bucket text not null default 'sample-media' check (storage_bucket = 'sample-media'),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf','image/png','image/jpeg')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  uploaded_by uuid not null references auth.users(id),
  uploaded_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index extraction_qc_artifacts_output_idx on public.extraction_qc_artifacts(processing_output_id, uploaded_at);

alter table public.extraction_qc_measurements enable row level security;
alter table public.extraction_qc_artifacts enable row level security;
create policy extraction_qc_measurements_read_approved on public.extraction_qc_measurements
for select to authenticated using (public.is_approved_lab_user());
create policy extraction_qc_artifacts_read_approved on public.extraction_qc_artifacts
for select to authenticated using (public.is_approved_lab_user());

revoke all privileges on table public.extraction_qc_measurements, public.extraction_qc_artifacts from anon, authenticated;
grant select on table public.extraction_qc_measurements, public.extraction_qc_artifacts to authenticated;

create function public.record_extraction_results_with_qc(
  p_output_id uuid,
  p_actual_volume_ul numeric,
  p_qubit_concentration_ng_ul numeric,
  p_vial_volumes numeric[],
  p_allow_over_capacity boolean default false,
  p_a230 numeric default null,
  p_a260 numeric default null,
  p_a280 numeric default null,
  p_din numeric default null,
  p_rin numeric default null,
  p_measured_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  po public.processing_outputs;
  result jsonb;
  measurement public.extraction_qc_measurements;
begin
  perform public.assert_approved();
  select * into po from public.processing_outputs where id = p_output_id for update;
  if not found or po.operation_type <> 'EXTRACTION' or po.output_type not in ('DNA','RNA') then
    raise exception 'Output is not a DNA or RNA extraction';
  end if;
  if p_qubit_concentration_ng_ul is null or p_qubit_concentration_ng_ul < 0 then
    raise exception 'Qubit concentration must be a non-negative number';
  end if;
  if p_a230 < 0 or p_a260 < 0 or p_a280 < 0 then
    raise exception 'NanoDrop absorbance values cannot be negative';
  end if;
  if po.output_type = 'DNA' and p_rin is not null then raise exception 'RIN is not valid for a DNA extraction'; end if;
  if po.output_type = 'RNA' and p_din is not null then raise exception 'DIN is not valid for an RNA extraction'; end if;
  if p_din is not null and (p_din < 1 or p_din > 10) then raise exception 'DIN must be between 1 and 10'; end if;
  if p_rin is not null and (p_rin < 1 or p_rin > 10) then raise exception 'RIN must be between 1 and 10'; end if;

  result := public.record_extraction_results(
    p_output_id, p_actual_volume_ul, p_qubit_concentration_ng_ul,
    p_vial_volumes, p_allow_over_capacity
  );

  insert into public.extraction_qc_measurements(
    processing_output_id, material_type, actual_volume_ul, qubit_concentration_ng_ul,
    a230, a260, a280, din, rin, measured_at, recorded_by
  ) values (
    p_output_id, po.output_type::text::public.qc_material_type, p_actual_volume_ul,
    p_qubit_concentration_ng_ul, p_a230, p_a260, p_a280, p_din, p_rin,
    p_measured_at, auth.uid()
  ) returning * into measurement;

  insert into public.audit_events(event_type,processing_event_id,processing_output_id,actor_id,metadata)
  values('EXTRACTION_QC_RECORDED',po.processing_event_id,po.id,auth.uid(),jsonb_build_object(
    'qc_measurement_id',measurement.id,'material_type',measurement.material_type,
    'qubit_concentration_ng_ul',measurement.qubit_concentration_ng_ul,
    'din',measurement.din,'rin',measurement.rin
  ));
  return result || jsonb_build_object('qc_measurement_id',measurement.id);
end $$;

create function public.record_extraction_qc_artifact(
  p_output_id uuid,
  p_artifact_id uuid,
  p_qc_type public.qc_artifact_type,
  p_instrument_type public.qc_instrument_type,
  p_instrument_model text,
  p_measurement_date date,
  p_notes text,
  p_filename text,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes bigint
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  po public.processing_outputs;
  artifact public.extraction_qc_artifacts;
  expected_prefix text;
begin
  perform public.assert_approved();
  select * into po from public.processing_outputs where id=p_output_id;
  if not found or po.operation_type <> 'EXTRACTION' or po.output_type not in ('DNA','RNA') then
    raise exception 'Output is not a DNA or RNA extraction';
  end if;
  if (po.output_type='DNA' and p_qc_type='RNA_INTEGRITY_TRACE') or
     (po.output_type='RNA' and p_qc_type='DNA_INTEGRITY_TRACE') then
    raise exception 'QC trace type does not match extraction material';
  end if;
  expected_prefix := auth.uid()::text || '/qc/' || po.id::text || '/' || p_artifact_id::text;
  if p_storage_path <> expected_prefix then raise exception 'Invalid private QC object path'; end if;
  if not exists(select 1 from storage.objects where bucket_id='sample-media' and name=p_storage_path) then
    raise exception 'Private QC upload was not found';
  end if;

  insert into public.extraction_qc_artifacts(
    id,processing_output_id,qc_type,instrument_type,instrument_model,measurement_date,notes,
    filename,storage_path,mime_type,size_bytes,uploaded_by
  ) values (
    p_artifact_id,p_output_id,p_qc_type,p_instrument_type,nullif(btrim(p_instrument_model),''),
    p_measurement_date,nullif(btrim(p_notes),''),btrim(p_filename),p_storage_path,p_mime_type,p_size_bytes,auth.uid()
  ) returning * into artifact;
  insert into public.audit_events(event_type,processing_event_id,processing_output_id,actor_id,metadata)
  values('QC_TRACE_UPLOADED',po.processing_event_id,po.id,auth.uid(),jsonb_build_object(
    'qc_artifact_id',artifact.id,'qc_type',artifact.qc_type,'instrument_type',artifact.instrument_type
  ));
  return to_jsonb(artifact);
end $$;

create function public.get_extraction_qc_for_sample(p_sample_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  perform public.assert_approved();
  select jsonb_build_object(
    'processing_output_id',po.id,
    'processing_event_id',pe.event_id,
    'measurement',to_jsonb(qc),
    'artifacts',coalesce((select jsonb_agg(to_jsonb(a) order by a.uploaded_at) from public.extraction_qc_artifacts a where a.processing_output_id=po.id),'[]'::jsonb)
  ) into result
  from public.processing_output_samples pos
  join public.processing_outputs po on po.id=pos.processing_output_id
  join public.processing_events pe on pe.id=po.processing_event_id
  left join public.extraction_qc_measurements qc on qc.processing_output_id=po.id and qc.is_current
  where pos.sample_id=p_sample_id and po.operation_type='EXTRACTION';
  return result;
end $$;

revoke execute on function public.record_extraction_results_with_qc(uuid,numeric,numeric,numeric[],boolean,numeric,numeric,numeric,numeric,numeric,timestamptz) from public,anon;
revoke execute on function public.record_extraction_qc_artifact(uuid,uuid,public.qc_artifact_type,public.qc_instrument_type,text,date,text,text,text,text,bigint) from public,anon;
revoke execute on function public.get_extraction_qc_for_sample(uuid) from public,anon;
grant execute on function public.record_extraction_results_with_qc(uuid,numeric,numeric,numeric[],boolean,numeric,numeric,numeric,numeric,numeric,timestamptz) to authenticated;
grant execute on function public.record_extraction_qc_artifact(uuid,uuid,public.qc_artifact_type,public.qc_instrument_type,text,date,text,text,text,text,bigint) to authenticated;
grant execute on function public.get_extraction_qc_for_sample(uuid) to authenticated;

commit;
