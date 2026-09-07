import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.0";
import { APP_CONFIG } from "../config.js";

export const configured = !APP_CONFIG.supabaseUrl.includes("YOUR_PROJECT") && !APP_CONFIG.supabaseAnonKey.includes("YOUR_");
export const supabase = configured ? createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;

export function requireConfigured() {
  if (!configured) throw new Error("Supabase is not configured. See inventory/README.md.");
}
