export function emptyInventoryHtml() {
  return '<p class="warning">No samples found.</p>';
}

export function scannerUnavailableHtml(message) {
  return `<p class="error">Camera scanner could not start: ${message}. Manual Sample ID entry remains available.</p>`;
}
