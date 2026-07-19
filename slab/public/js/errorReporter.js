/**
 * errorReporter.js — capture uncaught front-end errors and ship them to the
 * backend (/api/client-error) so client-side crashes are visible during the
 * testing phase instead of dying silently in a visitor's console.
 *
 * Deliberately tiny and defensive: caps how many it sends per page, dedupes
 * identical messages, prefers sendBeacon (survives navigation), and swallows
 * every failure so the reporter can never itself cause a problem.
 */
(function () {
  var MAX_PER_PAGE = 8;
  var sent = 0;
  var seen = Object.create(null);

  function post(payload) {
    if (sent >= MAX_PER_PAGE) return;
    var key = (payload.message || '') + '@' + (payload.source || '') + ':' + (payload.line || '');
    if (seen[key]) return;
    seen[key] = 1;
    sent++;
    try {
      payload.url = location.href;
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/client-error', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
      }
    } catch (e) { /* never throw from the reporter */ }
  }

  window.addEventListener('error', function (e) {
    // Resource load errors (img/script/css) fire with no e.error — skip the noise.
    if (!e || (!e.error && !e.message)) return;
    post({
      kind: 'error',
      message: (e.message || (e.error && e.error.message) || 'Script error').toString(),
      source: e.filename || '',
      line: e.lineno || 0,
      col: e.colno || 0,
      stack: (e.error && e.error.stack ? String(e.error.stack) : '').slice(0, 4000),
    });
  });

  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    post({
      kind: 'unhandledrejection',
      message: (r && (r.message || r)) ? String(r.message || r) : 'Unhandled promise rejection',
      source: '', line: 0, col: 0,
      stack: (r && r.stack ? String(r.stack) : '').slice(0, 4000),
    });
  });
})();
