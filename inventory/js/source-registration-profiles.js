export const SOURCE_REGISTRATION_PROFILES = Object.freeze({
  GENERIC: Object.freeze({ label: "Generic manual registration", requiresCoa: false }),
  STEMCELL_COA: Object.freeze({ label: "STEMCELL COA registration", requiresCoa: true }),
});

export async function parseForRegistrationProfile(profile, file, onProgress) {
  if (!SOURCE_REGISTRATION_PROFILES[profile]) throw new Error("Unknown registration profile");
  if (profile === "GENERIC") return null;
  const { parseSourceDocument } = await import("./source-document-parser.js");
  return parseSourceDocument(profile, file, onProgress);
}
