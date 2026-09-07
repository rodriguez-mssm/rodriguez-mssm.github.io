const value = (item) => item == null ? "" : String(item);

function field(label, name, initial, options = {}) {
  const origin = initial == null || initial === "" ? "Missing" : "Extracted";
  const type = options.type || "text";
  const attrs = [options.step && `step="${options.step}"`, options.min != null && `min="${options.min}"`, options.max != null && `max="${options.max}"`, options.required && "required"].filter(Boolean).join(" ");
  return `<label data-review-field="${name}">${label} <span class="field-origin ${origin.toLowerCase()}">${origin}</span><input name="${name}" type="${type}" value="${options.escape(value(initial))}" ${attrs}></label>`;
}

export async function mountStemcellRegistration({ container, source, api, typeOptions, escapeHtml, toast }) {
  let registrationSession = null; let coaMedia = null; let photoMedia = null; let parsed = null;
  container.innerHTML = `<section class="panel"><h2>STEMCELL COA registration</h2><p>Upload the original COA, optionally add a sample/package photo, then review every extracted value before registration.</p><div class="row"><label>Certificate of Analysis PDF<input id="stemcell-coa" type="file" accept="application/pdf,.pdf" required></label><label>Sample photo (optional)<input id="stemcell-photo" type="file" accept="image/jpeg,image/png,image/heic,image/heif" capture="environment"></label></div><button id="parse-stemcell-coa" type="button">Upload and parse COA</button><p id="stemcell-parse-status" role="status"></p></section><div id="stemcell-review"></div>`;
  const coaInput = container.querySelector("#stemcell-coa");
  const photoInput = container.querySelector("#stemcell-photo");
  const status = container.querySelector("#stemcell-parse-status");
  const button = container.querySelector("#parse-stemcell-coa");

  button.onclick = async () => {
    const coa = coaInput.files[0]; const photo = photoInput.files[0];
    if (!coa) { status.innerHTML = '<span class="error">Select a STEMCELL COA PDF.</span>'; return; }
    if (coa.type !== "application/pdf" || coa.size > 15728640) { status.innerHTML = '<span class="error">COA must be a PDF no larger than 15 MB.</span>'; return; }
    if (photo && (!['image/jpeg','image/png','image/heic','image/heif'].includes(photo.type) || photo.size > 15728640)) { status.innerHTML = '<span class="error">Photo must be JPEG, PNG, HEIC, or HEIF and no larger than 15 MB.</span>'; return; }
    button.disabled = true;
    try {
      if (!registrationSession) registrationSession = await api.beginSourceRegistration(source.id);
      if (!coaMedia) {
        status.textContent = "Uploading COA privately…";
        coaMedia = await api.uploadRegistrationMedia(registrationSession.id, coa, "DOCUMENT", "COA");
      }
      if (photo && !photoMedia) {
        status.textContent = "Uploading photo privately…";
        photoMedia = await api.uploadRegistrationMedia(registrationSession.id, photo, "IMAGE");
      }
      status.textContent = "Extracting embedded PDF text…";
      const { parseForRegistrationProfile } = await import("./source-registration-profiles.js");
      parsed = await parseForRegistrationProfile("STEMCELL_COA", coa, (progress) => {
        if (progress?.status === "OCR_FALLBACK") status.textContent = "Embedded text was incomplete. Running local OCR fallback…";
        else if (progress?.status === "recognizing text" && progress.progress) status.textContent = `Running local OCR fallback… ${Math.round(progress.progress * 100)}%`;
      });
      status.innerHTML = `<span class="success">COA parsed using ${escapeHtml(parsed.extractionMethod)}. Review is required.</span>`;
      renderReview();
    } catch (error) { status.innerHTML = `<span class="error">${escapeHtml(error.message || error)}</span>`; }
    finally { button.disabled = false; }
  };

  function renderReview() {
    const review = container.querySelector("#stemcell-review");
    const warningHtml = parsed.extractionWarnings.length ? `<div class="warning"><strong>Review warnings</strong><ul>${parsed.extractionWarnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul></div>` : "";
    review.innerHTML = `<form id="stemcell-review-form" class="panel"><h2>Review extracted metadata</h2>${warningHtml}<p class="hint">Badges show the initial parser result. Any changed field is marked User-edited.</p><div class="row"><label data-review-field="sampleType">Internal sample type <span class="field-origin ${parsed.internalSampleType ? "extracted" : "missing"}">${parsed.internalSampleType ? "Extracted" : "Missing"}</span><select name="sampleType" required><option value="">Select type</option>${typeOptions(parsed.internalSampleType)}</select></label>${field("External/lab reference (optional)", "externalId", null, { escape: escapeHtml })}</div>${field("Vendor product description", "vendorProductName", parsed.vendorProductName, { escape: escapeHtml, required: true })}<div class="row">${field("Catalog #", "catalogNumber", parsed.catalogNumber, { escape: escapeHtml })}${field("Lot #", "lotNumber", parsed.lotNumber, { escape: escapeHtml })}${field("Donor ID", "donorId", parsed.donorId, { escape: escapeHtml })}</div><div class="row">${field("Cell processing date", "processingDate", parsed.processingDate, { escape: escapeHtml, type: "date" })}${field("Cell count (million)", "cellCount", parsed.cellCountMillion, { escape: escapeHtml, type: "number", step: "any", min: 0 })}${field("Volume (µL)", "volume", parsed.volumeUl, { escape: escapeHtml, type: "number", step: "any", min: 0 })}</div><p>Raw vendor quantity: <code>${escapeHtml(parsed.rawQuantityText || "Missing")}</code></p><div class="row">${field("Viability (%)", "viability", parsed.viabilityPercent, { escape: escapeHtml, type: "number", step: "any", min: 0, max: 100 })}${field("Anticoagulant", "anticoagulant", parsed.anticoagulant, { escape: escapeHtml })}${field("Blood type", "bloodType", parsed.donorMetadata.bloodType, { escape: escapeHtml })}</div><h3>Vendor donor metadata</h3><div class="row">${field("Age", "age", parsed.donorMetadata.age, { escape: escapeHtml, type: "number", min: 0 })}${field("Sex", "sex", parsed.donorMetadata.sex, { escape: escapeHtml })}${field("Ethnicity", "ethnicity", parsed.donorMetadata.ethnicity, { escape: escapeHtml })}</div><div class="row">${field("Weight (kg)", "weightKg", parsed.donorMetadata.weightKg, { escape: escapeHtml, type: "number", step: "any", min: 0 })}${field("Height (cm)", "heightCm", parsed.donorMetadata.heightCm, { escape: escapeHtml, type: "number", step: "any", min: 0 })}${field("Smoker", "smoker", parsed.donorMetadata.smoker, { escape: escapeHtml })}</div><div class="row">${field("CMV status", "cmvStatus", parsed.cmvStatus, { escape: escapeHtml })}${field("CMV testing date", "cmvTestingDate", parsed.cmvTestingDate, { escape: escapeHtml, type: "date" })}${field("Viral testing result", "viralTestingResult", parsed.viralTestingResult, { escape: escapeHtml })}${field("Most recent viral testing", "viralTestingDate", parsed.viralTestingDate, { escape: escapeHtml, type: "date" })}</div><label class="confirm-review"><input name="reviewConfirmed" type="checkbox" required> I compared these values with the COA and confirm the final registration metadata.</label><button>Register source sample</button><p id="stemcell-register-result" role="status"></p></form>`;
    const form = review.querySelector("#stemcell-review-form");
    const updateQuantityVisibility = () => {
      const cells = ["PBMC","BMMNC","SORTED_CELLS"].includes(form.sampleType.value);
      form.cellCount.closest("label").hidden = !cells; form.volume.closest("label").hidden = cells;
      form.cellCount.required = cells; form.volume.required = !cells;
    };
    form.querySelectorAll("input,select").forEach((input) => input.addEventListener("input", () => {
      const wrapper = input.closest("[data-review-field]");
      const badge = wrapper?.querySelector(".field-origin");
      if (badge) { badge.textContent = "User-edited"; badge.className = "field-origin user-edited"; }
    }));
    form.sampleType.addEventListener("change", updateQuantityVisibility); updateQuantityVisibility();
    form.onsubmit = async (event) => {
      event.preventDefault(); const result = form.querySelector("#stemcell-register-result");
      const submit = form.querySelector('button[type="submit"],button:not([type])'); submit.disabled = true;
      try {
        const provenance = {};
        form.querySelectorAll("[data-review-field]").forEach((wrapper) => {
          const input = wrapper.querySelector("input,select"); const badge = wrapper.querySelector(".field-origin");
          provenance[input.name] = { status: badge.textContent.toUpperCase().replace("-", "_"), document_id: coaMedia.id, value: input.value || null };
        });
        const payload = {
          review_confirmed: true, sample_type: form.sampleType.value, external_id: form.externalId.value || null,
          cell_count_million: form.cellCount.required ? Number(form.cellCount.value) : null,
          volume_ul: form.volume.required ? Number(form.volume.value) : null,
          concentration_ng_ul: null, vendor_product_name: form.vendorProductName.value || null,
          catalog_number: form.catalogNumber.value || null, lot_number: form.lotNumber.value || null,
          donor_id: form.donorId.value || null, processing_date: form.processingDate.value || null,
          raw_quantity_text: parsed.rawQuantityText, viability_percent: form.viability.value || null,
          anticoagulant: form.anticoagulant.value || null, viral_testing_result: form.viralTestingResult.value || null,
          viral_testing_date: form.viralTestingDate.value || null, cmv_status: form.cmvStatus.value || null,
          cmv_testing_date: form.cmvTestingDate.value || null,
          donor_metadata: { age: form.age.value ? Number(form.age.value) : null, sex: form.sex.value || null, ethnicity: form.ethnicity.value || null, weightKg: form.weightKg.value ? Number(form.weightKg.value) : null, heightCm: form.heightCm.value ? Number(form.heightCm.value) : null, smoker: form.smoker.value || null, bloodType: form.bloodType.value || null },
          product_metadata: {}, field_provenance: provenance,
          parser_metadata: { parser: "STEMCELL_COA_V1", extractionMethod: parsed.extractionMethod, confidence: parsed.parserConfidence, warnings: parsed.extractionWarnings, missingFields: parsed.missingFields },
        };
        const completed = await api.completeSourceRegistration(registrationSession.id, payload);
        result.innerHTML = `<span class="success">Registered <strong>${escapeHtml(completed.sample.sample_id)}</strong> after reviewed COA confirmation.</span>`;
        form.querySelectorAll("input,select,button").forEach((control) => { control.disabled = true; });
        toast(`${completed.sample.sample_id} registered`);
      } catch (error) { result.innerHTML = `<span class="error">${escapeHtml(error.message || error)}</span>`; submit.disabled = false; }
    };
  }
}
