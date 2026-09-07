import { LABEL_CONFIG } from "./label-config.js?v=202609070003";
import { labelCapacity, positionToGrid } from "./label-layout.js?v=202609070003";

export function requestLabelPrintOptions(labelCount, config = LABEL_CONFIG) {
  const capacity = labelCapacity(config);
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.innerHTML = `<form method="dialog"><h2>Place labels on sheet</h2><p>${labelCount} label${labelCount === 1 ? "" : "s"} requested. The sheet has ${capacity} positions.</p><label>Start position<input name="startPosition" type="number" min="1" max="${capacity}" step="1" value="1" required></label><p class="hint" id="label-position-summary"></p><label class="confirm-review"><input name="multiPage" type="checkbox"> Allow additional pages when labels do not fit on the first sheet</label><p id="label-print-error" class="error" role="alert"></p><div class="row"><button value="print">Generate PDF</button><button value="cancel" class="secondary">Cancel</button></div></form>`;
    document.body.append(dialog);
    const form = dialog.querySelector("form");
    const update = () => {
      const start = Number(form.startPosition.value);
      const summary = dialog.querySelector("#label-position-summary");
      const error = dialog.querySelector("#label-print-error");
      try {
        const { row, column } = positionToGrid(start, config);
        const remaining = capacity - start + 1;
        summary.textContent = `Position ${start} of ${capacity} - row ${row}, column ${column}. ${remaining} position${remaining === 1 ? "" : "s"} remain on this sheet.`;
        error.textContent = !form.multiPage.checked && labelCount > remaining ? `${labelCount} labels do not fit; only ${remaining} positions remain.` : "";
      } catch (issue) { summary.textContent = ""; error.textContent = issue.message; }
    };
    form.startPosition.oninput = update;
    form.multiPage.onchange = update;
    form.addEventListener("submit", (event) => {
      const startPosition = Number(form.startPosition.value);
      const remaining = capacity - startPosition + 1;
      if (event.submitter?.value === "print" && (!Number.isInteger(startPosition) || startPosition < 1 || startPosition > capacity || (!form.multiPage.checked && labelCount > remaining))) {
        event.preventDefault(); update();
      }
    });
    dialog.addEventListener("close", () => {
      const startPosition = Number(form.startPosition.value);
      const remaining = capacity - startPosition + 1;
      const accepted = dialog.returnValue === "print" && Number.isInteger(startPosition) && startPosition >= 1 && startPosition <= capacity && (form.multiPage.checked || labelCount <= remaining);
      const result = accepted ? { startPosition, multiPage: form.multiPage.checked } : null;
      dialog.remove(); resolve(result);
    });
    update(); dialog.showModal();
  });
}
