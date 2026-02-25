// GreeAlityTV — Main JS

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
