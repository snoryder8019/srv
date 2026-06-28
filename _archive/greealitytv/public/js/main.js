// GreeAlityTV — Main JS

// ================================================================
// LANGUAGE TOGGLE (Google Translate — EN / ES)
// ================================================================
const GRV_LANG_KEY = 'grv_lang';

// Google Translate persists via a `googtrans` cookie (/en/es).
// We must manage that cookie ourselves so navigating to a new page
// doesn't re-trigger a translation we already cleared.
function grvSetGTCookie(lang) {
  const host = window.location.hostname;
  if (lang === 'en') {
    // Expire the cookie on both root path and current domain
    document.cookie = 'googtrans=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    document.cookie = 'googtrans=; path=/; domain=' + host + '; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  } else {
    document.cookie = 'googtrans=/en/' + lang + '; path=/';
    document.cookie = 'googtrans=/en/' + lang + '; path=/; domain=' + host;
  }
}

function grvWaitForGT(callback, retries) {
  retries = retries === undefined ? 40 : retries;
  const select = document.querySelector('.goog-te-combo');
  if (select) { callback(select); return; }
  if (retries <= 0) return;
  setTimeout(() => grvWaitForGT(callback, retries - 1), 150);
}

function grvTriggerGT(lang) {
  // Google Translate uses '' (empty string) to restore original language
  grvWaitForGT(select => {
    select.value = lang === 'en' ? '' : lang;
    const evt = document.createEvent('HTMLEvents');
    evt.initEvent('change', true, false);
    select.dispatchEvent(evt);
  });
}

function grvSwitchLang(lang) {
  localStorage.setItem(GRV_LANG_KEY, lang);
  grvSetGTCookie(lang);          // keep cookie in sync so next page load is correct
  const btn   = document.getElementById('langToggle');
  const label = document.getElementById('langLabel');
  if (btn && label) {
    label.textContent = lang === 'es' ? 'EN' : 'ES';
    btn.classList.toggle('lang-active-es', lang === 'es');
  }
  document.body.classList.toggle('grv-lang-es', lang === 'es');
  document.body.classList.add('lang-switching');
  setTimeout(() => document.body.classList.remove('lang-switching'), 600);
  grvTriggerGT(lang);
}

// Init on page load
(function initLangToggle() {
  const savedLang = localStorage.getItem(GRV_LANG_KEY) || 'en';

  // If user is in EN mode, make absolutely sure the GT cookie is cleared
  // (covers the case where GT set it during a previous ES session)
  if (savedLang === 'en') grvSetGTCookie('en');

  const btn   = document.getElementById('langToggle');
  const label = document.getElementById('langLabel');

  if (btn && label) {
    label.textContent = savedLang === 'es' ? 'EN' : 'ES';
    btn.classList.toggle('lang-active-es', savedLang === 'es');
    btn.addEventListener('click', () => {
      const current = localStorage.getItem(GRV_LANG_KEY) || 'en';
      grvSwitchLang(current === 'es' ? 'en' : 'es');
    });
  }

  if (savedLang === 'es') {
    document.body.classList.add('grv-lang-es');
    grvTriggerGT('es');
  }
})();

// ---- FOOTER: COPY LINK ----
function footerCopyLink() {
  navigator.clipboard.writeText(window.location.href).then(() => {
    const btn = document.getElementById('copyLinkBtn');
    btn.textContent = '✓ Copied!';
    setTimeout(() => { btn.textContent = '📋 Copy Link'; }, 2000);
  });
}

// ---- FOOTER: SHARE QR ----
let _qrGenerated = false;
function footerShowQr() {
  const modal = document.getElementById('qrModal');
  modal.style.display = 'flex';
  document.getElementById('qrUrl').textContent = window.location.href;
  if (!_qrGenerated) {
    new QRCode(document.getElementById('qrCode'), {
      text: window.location.href,
      width: 200,
      height: 200,
      colorDark: '#1a2340',
      colorLight: '#ffffff'
    });
    _qrGenerated = true;
  }
}
window.addEventListener('click', (e) => {
  const modal = document.getElementById('qrModal');
  if (modal && e.target === modal) modal.style.display = 'none';
});

// ---- COMMENT VOTING ----
document.querySelectorAll('.vote-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const commentId = btn.dataset.id;
    const contentType = btn.dataset.contentType;
    const contentId = btn.dataset.contentId;
    const type = btn.classList.contains('up-btn') ? 'up' : 'down';

    try {
      const res = await fetch(`/${contentType}s/${contentId}/comments/${commentId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type })
      });
      const data = await res.json();
      if (data.error) return;

      const commentEl = document.getElementById(`comment-${commentId}`);
      commentEl.querySelector('.up-count').textContent = data.upvotes;
      commentEl.querySelector('.down-count').textContent = data.downvotes;

      const upBtn = commentEl.querySelector('.up-btn');
      const downBtn = commentEl.querySelector('.down-btn');
      if (type === 'up') {
        upBtn.classList.toggle('active-up');
        downBtn.classList.remove('active-down');
      } else {
        downBtn.classList.toggle('active-down');
        upBtn.classList.remove('active-up');
      }
    } catch (e) {
      console.error('Vote error:', e);
    }
  });
});

// ---- FLASH AUTO-DISMISS ----
document.querySelectorAll('.flash').forEach(el => {
  setTimeout(() => {
    el.style.transition = 'opacity .4s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 400);
  }, 4000);
});

// ---- VIDEO UPLOAD PROGRESS INDICATOR ----
const videoForm = document.getElementById('videoUploadForm');
if (videoForm) {
  videoForm.addEventListener('submit', () => {
    const progress = document.getElementById('upload-progress');
    const submitBtn = document.getElementById('submitBtn');
    if (progress) progress.style.display = 'block';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Uploading...';
    }
  });
}

// ---- COOKIE CONSENT ----
(function () {
  const CONSENT_KEY = 'grv_cookie_consent';
  const banner = document.getElementById('cookieBanner');
  if (!banner) return;

  if (!localStorage.getItem(CONSENT_KEY)) {
    setTimeout(() => { banner.style.display = 'block'; }, 400);
  }

  function dismissBanner() {
    banner.style.transition = 'transform .3s ease, opacity .3s ease';
    banner.style.transform  = 'translateY(100%)';
    banner.style.opacity    = '0';
    setTimeout(() => { banner.style.display = 'none'; }, 320);
  }

  document.getElementById('cookieAccept').addEventListener('click', () => {
    localStorage.setItem(CONSENT_KEY, 'accepted');
    dismissBanner();
  });

  document.getElementById('cookieDecline').addEventListener('click', () => {
    localStorage.setItem(CONSENT_KEY, 'declined');
    dismissBanner();
  });
})();

// ---- MOBILE NAV TOGGLE ----
const navInner = document.querySelector('.nav-inner');
if (navInner) {
  const menuBtn = document.createElement('button');
  menuBtn.className = 'nav-menu-btn';
  menuBtn.innerHTML = '☰';
  menuBtn.style.cssText = 'display:none;background:none;border:none;color:white;font-size:1.5rem;cursor:pointer;margin-left:auto;';
  navInner.appendChild(menuBtn);

  const navLinks = document.querySelector('.nav-links');
  menuBtn.addEventListener('click', () => {
    if (navLinks) {
      const visible = navLinks.style.display === 'flex';
      navLinks.style.cssText = visible
        ? ''
        : 'display:flex;flex-direction:column;position:absolute;top:64px;left:0;right:0;background:var(--navy);padding:1rem 1.5rem;gap:.75rem;z-index:99;';
    }
  });

  const mq = window.matchMedia('(max-width: 900px)');
  const handleMq = (e) => { menuBtn.style.display = e.matches ? 'block' : 'none'; };
  mq.addListener(handleMq);
  handleMq(mq);
}
