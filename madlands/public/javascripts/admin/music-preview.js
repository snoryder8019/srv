/* Music builder preview — reads the score fields and plays them with the engine. */
import { createPlayer } from '/js/madlands/music-engine.js';

const $ = (id) => document.getElementById(id);
let player = null;

function scoreFromForm() {
  return {
    key: $('f-key')?.value || 'A minor',
    tempoBpm: $('f-tempoBpm')?.value || '90',
    progression: ($('f-progression')?.value || 'Am, F, C, G'),
    groove: $('f-groove')?.value || '',
    leadTimbre: $('f-leadTimbre')?.value || '',
  };
}

const btn = $('preview');
btn?.addEventListener('click', async () => {
  if (player && player.playing) { player.stop(); btn.textContent = '▶ Preview'; return; }
  if (player) player.dispose();
  player = createPlayer(scoreFromForm());
  btn.textContent = '■ Stop';
  try { await player.play(); } catch (e) { btn.textContent = '▶ Preview'; }
});

window.addEventListener('beforeunload', () => { try { player && player.dispose(); } catch {} });
