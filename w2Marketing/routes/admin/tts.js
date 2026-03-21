import express from 'express';
import http from 'http';

const router = express.Router();

const PIPER_HOST = '127.0.0.1';
const PIPER_PORT = 8091;

// POST /admin/tts
// Body: { text: string, voice?: string, speed?: number }
// Returns: audio/wav stream from local Piper service
router.post('/', (req, res) => {
  const text = (req.body?.text || '').toString().trim();
  if (!text) return res.status(400).json({ error: 'No text provided' });

  const payload = JSON.stringify({
    input: text,
    voice: req.body?.voice || 'lessac',
    speed: req.body?.speed || 1.0,
  });

  const options = {
    hostname: PIPER_HOST,
    port: PIPER_PORT,
    path: '/v1/audio/speech',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  };

  const piperReq = http.request(options, (piperRes) => {
    if (piperRes.statusCode !== 200) {
      return res.status(502).json({ error: 'TTS service error', status: piperRes.statusCode });
    }
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    piperRes.pipe(res);
  });

  piperReq.on('error', (err) => {
    console.error('[tts] Piper service unreachable:', err.message);
    res.status(503).json({ error: 'TTS service unavailable' });
  });

  piperReq.write(payload);
  piperReq.end();
});

export default router;
