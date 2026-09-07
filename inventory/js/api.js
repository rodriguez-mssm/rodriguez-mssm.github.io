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
  findSamples: async (term, activeOnly = false) => {
    const selection = "*, parent:parent_sample_id(sample_id,sample_type,status), processing_event:created_by_processing_event_id(event_id), sample_source:sample_source_id(id,name,nickname,url)";
    const matches = await unwrap(supabase.rpc("search_inventory_sample_ids", { p_term: term, p_active_only: activeOnly }));
    if (!matches.length) return [];
    return unwrap(supabase.from("samples").select(selection).in("id", matches.map(({ sample_uuid }) => sample_uuid)).order("sample_id"));
  },
  getSample: (sampleId) => unwrap(supabase.from("samples").select("*, parent:parent_sample_id(sample_id,sample_type,status), processing_event:created_by_processing_event_id(event_id), sample_source:sample_source_id(id,name,nickname,url)").eq("sample_id", sampleId).single()),
  children: (id) => unwrap(supabase.from("samples").select("*, sample_source:sample_source_id(id,name,nickname,url)").eq("parent_sample_id", id).order("sample_id")),
  audit: (id) => unwrap(supabase.from("audit_events").select("event_type,created_at,metadata").eq("sample_id", id).order("created_at", { ascending: false }).limit(30)),
  pending: () => unwrap(supabase.from("processing_outputs").select("*, processing_event:processing_event_id(event_id,source_sample_id,samples!processing_events_source_sample_id_fkey(sample_id,sample_type)), output_samples:processing_output_samples(ordinal,sample:samples(*))").eq("result_status", "AWAITING_RESULTS").order("created_at")),
  createPlan: (payload) => unwrap(supabase.rpc("create_processing_plan", { p_payload: payload })),
  recordResults: (outputId, actualVolumeUl, concentrationNgUl, vialVolumes, allowOverCapacity = false) => unwrap(supabase.rpc("record_extraction_results", { p_output_id: outputId, p_actual_volume_ul: actualVolumeUl, p_concentration_ng_ul: concentrationNgUl, p_vial_volumes: vialVolumes, p_allow_over_capacity: allowOverCapacity })),
  activate: (sampleId) => unwrap(supabase.rpc("activate_sample", { p_sample_id: sampleId })),
  markNotCreated: (sampleId) => unwrap(supabase.rpc("mark_sample_not_created", { p_sample_id: sampleId })),
  markLabelsPrinted: (sampleIds) => unwrap(supabase.rpc("mark_labels_printed", { p_sample_ids: sampleIds })),
  registerSource: (payload) => unwrap(supabase.rpc("register_source_sample", { p_payload: payload })),
  sampleSources: () => unwrap(supabase.from("sample_sources").select("id,name,nickname,url,registration_profile,created_at,updated_at").order("nickname")),
  createSampleSource: (source) => unwrap(supabase.rpc("create_sample_source", { p_name: source.name, p_nickname: source.nickname, p_url: source.url, p_registration_profile: source.registrationProfile })),
  updateSampleSource: (id, source) => unwrap(supabase.rpc("update_sample_source", { p_sample_source_id: id, p_name: source.name, p_nickname: source.nickname, p_url: source.url, p_registration_profile: source.registrationProfile })),
  beginSourceRegistration: (sampleSourceId) => unwrap(supabase.rpc("begin_source_registration", { p_sample_source_id: sampleSourceId })),
  uploadRegistrationMedia: async (sessionId, file, mediaKind, documentType = null) => {
    requireConfigured();
    const session = (await supabase.auth.getSession()).data.session;
    if (!session) throw new Error("Authentication is required");
    const mediaId = crypto.randomUUID();
    const storagePath = `${session.user.id}/${sessionId}/${mediaId}`;
    const { error } = await supabase.storage.from("sample-media").upload(storagePath, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return unwrap(supabase.rpc("record_registration_media", {
      p_registration_session_id: sessionId, p_media_id: mediaId, p_media_kind: mediaKind,
      p_document_type: documentType, p_filename: file.name, p_storage_path: storagePath,
      p_mime_type: file.type, p_size_bytes: file.size,
    }));
  },
  completeSourceRegistration: (sessionId, payload) => unwrap(supabase.rpc("complete_source_registration", { p_registration_session_id: sessionId, p_payload: payload })),
  sourceProvenance: (sampleId) => unwrap(supabase.rpc("get_sample_source_provenance", { p_sample_id: sampleId })),
  sampleMedia: (sampleId) => unwrap(supabase.from("sample_media").select("id,media_kind,document_type,filename,storage_path,mime_type,uploaded_at").eq("sample_id", sampleId).order("uploaded_at")),
  signedMediaUrl: async (path, expiresIn = 300) => unwrap(supabase.storage.from("sample-media").createSignedUrl(path, expiresIn)),
};
