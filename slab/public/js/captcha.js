/*
 * Self-hosted proof-of-work CAPTCHA widget (open-source reCAPTCHA alternative).
 * Pairs with plugins/captcha.js. No external requests, no tracking.
 *
 * Auto-wires every <form data-captcha>: on submit it fetches a signed challenge
 * from /captcha/challenge, brute-forces the SHA-256 proof of work in the
 * browser (sub-second), drops the solution into a hidden `captcha` field, and
 * then lets the form submit normally (works for both full-page POST and fetch).
 *
 * Progressive enhancement: the hidden field + a status line are injected here,
 * so no server-rendered markup is required and JS-less clients simply see the
 * server reject the empty solution.
 */
(function () {
  'use strict';

  var ENDPOINT = '/captcha/challenge';

  function hex(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
    return s;
  }

  // Find the number in [0, maxnumber] whose SHA-256(salt+number) === challenge.
  function solve(salt, challenge, maxnumber) {
    var enc = new TextEncoder();
    var i = 0;
    function step(resolve, reject) {
      // Work in slices so the UI thread never locks up on slower devices.
      var end = Math.min(i + 2000, maxnumber);
      (function loop() {
        if (i > maxnumber) return reject(new Error('unsolved'));
        crypto.subtle.digest('SHA-256', enc.encode(salt + i)).then(function (d) {
          if (hex(d) === challenge) return resolve(i);
          i++;
          if (i <= end) return loop();
          end = Math.min(i + 2000, maxnumber);
          setTimeout(loop, 0);
        }).catch(reject);
      })();
    }
    return new Promise(step);
  }

  function payloadFor(algorithm, challenge, number, salt, signature) {
    var json = JSON.stringify({ algorithm: algorithm, challenge: challenge, number: number, salt: salt, signature: signature });
    return btoa(json);
  }

  function ensureField(form) {
    var field = form.querySelector('input[name="captcha"]');
    if (!field) {
      field = document.createElement('input');
      field.type = 'hidden';
      field.name = 'captcha';
      form.appendChild(field);
    }
    return field;
  }

  function ensureStatus(form) {
    var el = form.querySelector('.captcha-status');
    if (!el) {
      el = document.createElement('div');
      el.className = 'captcha-status';
      el.setAttribute('aria-live', 'polite');
      el.style.cssText = 'font-size:.8rem;opacity:.7;margin:.35rem 0;min-height:1em;';
      var btn = form.querySelector('[type="submit"]');
      if (btn && btn.parentNode) btn.parentNode.insertBefore(el, btn);
      else form.appendChild(el);
    }
    return el;
  }

  async function runChallenge(form, status) {
    status.textContent = 'Verifying you’re human…';
    var res = await fetch(ENDPOINT, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
    if (!res.ok) throw new Error('challenge fetch failed');
    var c = await res.json();
    var number = await solve(c.salt, c.challenge, c.maxnumber);
    var token = payloadFor(c.algorithm, c.challenge, number, c.salt, c.signature);
    ensureField(form).value = token;
    status.textContent = 'Verified ✓';
    return token;
  }

  function wire(form) {
    if (form.__captchaWired) return;
    form.__captchaWired = true;
    ensureField(form);
    var status = ensureStatus(form);
    var solved = false;

    form.addEventListener('submit', function (e) {
      if (solved) return; // token already attached — let it through
      e.preventDefault();
      var btn = form.querySelector('[type="submit"]');
      if (btn) btn.disabled = true;
      runChallenge(form, status).then(function () {
        solved = true;
        if (btn) btn.disabled = false;
        if (typeof form.requestSubmit === 'function') form.requestSubmit(btn || undefined);
        else form.submit();
      }).catch(function (err) {
        console.error('[captcha]', err);
        status.textContent = 'Verification failed — please try again.';
        if (btn) btn.disabled = false;
      });
    });
  }

  function init() {
    if (!window.crypto || !crypto.subtle) return; // insecure context — server still rejects empty solutions
    var forms = document.querySelectorAll('form[data-captcha]');
    for (var i = 0; i < forms.length; i++) wire(forms[i]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
