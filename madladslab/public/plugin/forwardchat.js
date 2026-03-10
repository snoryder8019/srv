/**
 * forwardChat Loader — install this ONCE on the 3rd-party site.
 * Only this file is ever referenced in the site's HTML.
 * The runtime is fetched from madladslab.com so updates are seamless.
 *
 * Usage:
 *   <script src="https://madladslab.com/plugin/forwardchat.js?site=YOUR_SITE_TOKEN"></script>
 */
(function () {
  var token = (document.currentScript && document.currentScript.src
    ? new URL(document.currentScript.src).searchParams.get('site')
    : null)
    || (function () {
      var s = document.querySelector('script[src*="forwardchat.js"]');
      return s ? new URL(s.src).searchParams.get('site') : null;
    })();

  if (!token) {
    console.warn('[forwardChat] No site token found. Add ?site=TOKEN to the script URL.');
    return;
  }

  var base = (function () {
    try {
      var src = (document.currentScript && document.currentScript.src) ||
        (document.querySelector('script[src*="forwardchat.js"]') || {}).src || '';
      var url = new URL(src);
      return url.origin;
    } catch (e) {
      return 'https://madladslab.com';
    }
  })();

  // Fetch meta (resolves current runtime URL + confirms site is active)
  fetch(base + '/agents/api/forwardchat/meta?site=' + token)
    .then(function (r) { return r.json(); })
    .then(function (meta) {
      if (!meta.success) {
        console.warn('[forwardChat] Site not active or token invalid.');
        return;
      }
      var script = document.createElement('script');
      script.src = base + meta.runtimeUrl + '?v=' + Date.now(); // cache-bust on load
      script.setAttribute('data-fwdchat-token', token);
      script.setAttribute('data-fwdchat-base', base);
      document.head.appendChild(script);
    })
    .catch(function (e) {
      console.warn('[forwardChat] Could not load runtime:', e.message);
    });
})();
