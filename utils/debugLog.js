function debugLog(location, message, data = {}, hypothesisId = '') {
  // #region agent log
  fetch('http://127.0.0.1:7673/ingest/0c0917fc-f827-4d9b-bd1c-033c1d0ada66', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': 'a599f2'
    },
    body: JSON.stringify({
      sessionId: 'a599f2',
      location,
      message,
      data,
      hypothesisId,
      timestamp: Date.now(),
      runId: 'post-fix'
    })
  }).catch(() => {});
  // #endregion
}

module.exports = { debugLog };
