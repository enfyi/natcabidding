export const IMPORT_REQUEST_TIMEOUT_MS = 30_000

export function createImportRequestTimeout(timeoutMs = IMPORT_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  let expired = false
  const timeoutId = setTimeout(() => {
    expired = true
    controller.abort()
  }, timeoutMs)

  return {
    signal: controller.signal,
    didExpire: () => expired,
    clear: () => clearTimeout(timeoutId),
  }
}

export function importTimeoutMessage(action: 'preview' | 'import') {
  if (action === 'preview') {
    return 'Preview timed out after 30 seconds. Check your connection and retry.'
  }
  return 'Import timed out after 30 seconds. Preview the workbook again before retrying so the current database state is checked.'
}
