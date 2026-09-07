import { supabase, requireConfigured } from "./supabase.js";

async function unwrap(query) {
  requireConfigured();
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export const api = {
  session: async () => (await supabase?.auth.getSession()).data.session ?? null,
  signIn: async (email, password) => unwrap(supabase.auth.signInWithPassword({ email, password })),
  signOut: async () => unwrap(supabase.auth.signOut()),
  profile: async () => unwrap(supabase.from("profiles").select("id,display_name,role,approved,disabled_at").single()),
  findSamples: (term, activeOnly = false) => {
    let query = supabase.from("samples").select("*, parent:parent_sample_id(sample_id,sample_type,status), processing_event:created_by_processing_event_id(event_id)").ilike("sample_id", `%${term}%`).order("sample_id").limit(50);
    if (activeOnly) query = query.eq("status", "ACTIVE");
    return unwrap(query);
  },
  getSample: (sampleId) => unwrap(supabase.from("samples").select("*, parent:parent_sample_id(sample_id,sample_type,status), processing_event:created_by_processing_event_id(event_id)").eq("sample_id", sampleId).single()),
  children: (id) => unwrap(supabase.from("samples").select("*").eq("parent_sample_id", id).order("sample_id")),
  audit: (id) => unwrap(supabase.from("audit_events").select("event_type,created_at,metadata").eq("sample_id", id).order("created_at", { ascending: false }).limit(30)),
  pending: () => unwrap(supabase.from("processing_outputs").select("*, processing_event:processing_event_id(event_id,source_sample_id,samples!processing_events_source_sample_id_fkey(sample_id,sample_type)), output_samples:processing_output_samples(ordinal,sample:samples(*))").eq("result_status", "AWAITING_RESULTS").order("created_at")),
  createPlan: (payload) => unwrap(supabase.rpc("create_processing_plan", { p_payload: payload })),
  recordResults: (outputId, actualVolumeUl, concentrationNgUl, vialVolumes, allowOverCapacity = false) => unwrap(supabase.rpc("record_extraction_results", { p_output_id: outputId, p_actual_volume_ul: actualVolumeUl, p_concentration_ng_ul: concentrationNgUl, p_vial_volumes: vialVolumes, p_allow_over_capacity: allowOverCapacity })),
  activate: (sampleId) => unwrap(supabase.rpc("activate_sample", { p_sample_id: sampleId })),
  markNotCreated: (sampleId) => unwrap(supabase.rpc("mark_sample_not_created", { p_sample_id: sampleId })),
  markLabelsPrinted: (sampleIds) => unwrap(supabase.rpc("mark_labels_printed", { p_sample_ids: sampleIds })),
  registerSource: (payload) => unwrap(supabase.rpc("register_source_sample", { p_payload: payload })),
};
