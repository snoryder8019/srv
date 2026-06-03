/**
 * NPC "tavern" - a small modal chat with Vesk, the Hexwarden.
 * Talks to POST /api/v1/npc/chat (qwen2.5 via the AI gateway).
 * No framework - plain DOM. Keeps last few turns as history.
 */
(function () {
  const overlay = document.getElementById('tavern-overlay');
  if (!overlay) return;

  const log = overlay.querySelector('.tavern-log');
  const input = overlay.querySelector('.tavern-input input');
  const sendBtn = overlay.querySelector('.tavern-send');
  const openers = document.querySelectorAll('[data-open-tavern]');
  const closeBtn = overlay.querySelector('.td-modal-close');

  const history = [];
  let busy = false;

  function addMsg(text, who) {
    const el = document.createElement('div');
    el.className = `tavern-msg ${who}`;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function open() {
    overlay.classList.add('open');
    if (!log.childElementCount) {
      addMsg('Speak, Architect. The lanes will not hold themselves.', 'npc');
    }
    setTimeout(() => input.focus(), 50);
  }
  function close() { overlay.classList.remove('open'); }

  async function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    input.value = '';
    addMsg(text, 'me');
    history.push({ role: 'user', content: text });
    const thinking = addMsg('Vesk is thinking...', 'npc thinking');

    try {
      const res = await fetch('/api/v1/npc/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      });
      const data = await res.json();
      const reply = (data && data.reply) || 'Static on the line, Architect.';
      thinking.remove();
      addMsg(reply, 'npc');
      history.push({ role: 'assistant', content: reply });
      if (history.length > 12) history.splice(0, history.length - 12);
    } catch (err) {
      thinking.remove();
      addMsg('The comms are down. Try again.', 'npc');
    } finally {
      busy = false;
      input.focus();
    }
  }

  openers.forEach(b => b.addEventListener('click', open));
  if (closeBtn) closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  if (sendBtn) sendBtn.addEventListener('click', send);
  if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
})();
