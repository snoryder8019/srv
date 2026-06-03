(function () {
  const modal = document.getElementById('contactModal');
  const form = document.getElementById('contactForm');
  const status = modal?.querySelector('[data-contact-status]');
  if (!modal || !form) return;

  function open() {
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => form.querySelector('input[name="name"]')?.focus(), 30);
  }
  function close() {
    modal.hidden = true;
    document.body.style.overflow = '';
    setStatus('');
  }
  function setStatus(msg, isError) {
    if (!status) return;
    status.textContent = msg;
    status.classList.toggle('is-error', !!isError);
  }

  document.querySelectorAll('[data-contact-open]').forEach((b) => b.addEventListener('click', open));
  document.querySelectorAll('[data-contact-close]').forEach((b) => b.addEventListener('click', close));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) close(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus('Sending…');
    const fd = new FormData(form);
    const payload = {
      name: fd.get('name'),
      email: fd.get('email'),
      company: fd.get('company') || '',
      topic: fd.get('topic') || '',
      message: fd.get('message'),
      hp: fd.get('hp') || '',
      pageHint: location.pathname,
    };
    try {
      const res = await fetch('/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setStatus(`Got it — reference ${data.id}. We'll reply within a day.`);
      form.reset();
    } catch (err) {
      setStatus(`Couldn't send: ${err.message}`, true);
    }
  });
})();
