// The upload button used to report every failure as a parse error. A full
// localStorage throws QuotaExceededError after the deck has already parsed.
export function uploadErrorMessage(err) {
  const message = String(err?.message || '')
  const quota = err?.name === 'QuotaExceededError' || /quota/i.test(message)
  if (quota) {
    const lead = "Could not save the presentation: this browser's storage is full. Delete an old presentation from the archive and try again."
    return message ? `${lead} ${message}` : lead
  }
  return `Could not parse PPTX: ${message}`
}
