const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');

const app = express();
const PORT = 8091;

const PIPER_BIN = path.join(__dirname, 'bin/piper');
const PIPER_LIB  = path.join(__dirname, 'bin');
const MODELS_DIR = path.join(__dirname, 'models');

// ── Voice registry ────────────────────────────────────────────────────────
// Each entry: { label, model, speaker (optional), gender, accent }
const VOICES = {
  // US English — Lessac (female, high quality)
  'lessac':   { label: 'Lessac',   model: 'en_US-lessac-high.onnx',  gender: 'F', accent: 'US' },
  // US English — Ryan (male, high quality)
  'ryan':     { label: 'Ryan',     model: 'en_US-ryan-high.onnx',    gender: 'M', accent: 'US' },
  // British English — Cori (female, high quality)
  'cori':     { label: 'Cori',     model: 'en_GB-cori-high.onnx',    gender: 'F', accent: 'GB' },
  // Arctic multi-speaker (medium quality, 18 speakers — US English mix)
  'awb':      { label: 'AWB',      model: 'en_US-arctic-medium.onnx', speaker: 0,  gender: 'M', accent: 'US' },
  'rms':      { label: 'RMS',      model: 'en_US-arctic-medium.onnx', speaker: 1,  gender: 'M', accent: 'US' },
  'slt':      { label: 'SLT',      model: 'en_US-arctic-medium.onnx', speaker: 2,  gender: 'F', accent: 'US' },
  'ksp':      { label: 'KSP',      model: 'en_US-arctic-medium.onnx', speaker: 3,  gender: 'M', accent: 'US' },
  'clb':      { label: 'CLB',      model: 'en_US-arctic-medium.onnx', speaker: 4,  gender: 'F', accent: 'US' },
  'lnh':      { label: 'LNH',      model: 'en_US-arctic-medium.onnx', speaker: 5,  gender: 'F', accent: 'US' },
  'aew':      { label: 'AEW',      model: 'en_US-arctic-medium.onnx', speaker: 6,  gender: 'M', accent: 'US' },
  'bdl':      { label: 'BDL',      model: 'en_US-arctic-medium.onnx', speaker: 7,  gender: 'M', accent: 'US' },
  'jmk':      { label: 'JMK',      model: 'en_US-arctic-medium.onnx', speaker: 8,  gender: 'M', accent: 'US' },
  'rxr':      { label: 'RXR',      model: 'en_US-arctic-medium.onnx', speaker: 9,  gender: 'M', accent: 'US' },
  'fem':      { label: 'FEM',      model: 'en_US-arctic-medium.onnx', speaker: 10, gender: 'F', accent: 'US' },
  'ljm':      { label: 'LJM',      model: 'en_US-arctic-medium.onnx', speaker: 11, gender: 'F', accent: 'US' },
  'slp':      { label: 'SLP',      model: 'en_US-arctic-medium.onnx', speaker: 12, gender: 'F', accent: 'US' },
  'aup':      { label: 'AUP',      model: 'en_US-arctic-medium.onnx', speaker: 13, gender: 'M', accent: 'US' },
  'ahw':      { label: 'AHW',      model: 'en_US-arctic-medium.onnx', speaker: 14, gender: 'M', accent: 'US' },
  'axb':      { label: 'AXB',      model: 'en_US-arctic-medium.onnx', speaker: 15, gender: 'F', accent: 'US' },
  'eey':      { label: 'EEY',      model: 'en_US-arctic-medium.onnx', speaker: 16, gender: 'F', accent: 'US' },
  'gka':      { label: 'GKA',      model: 'en_US-arctic-medium.onnx', speaker: 17, gender: 'M', accent: 'US' },
};

const DEFAULT_VOICE = 'lessac';

// ── Persistent Piper process (one per model file) ─────────────────────────
class PiperProcess extends EventEmitter {
  constructor(modelFile) {
    super();
    this.modelFile = modelFile;
    this.modelPath = path.join(MODELS_DIR, modelFile);
    this.proc = null;
    this.queue = [];
    this.active = null;
    this.ready = false;
    this._spawn();
  }

  _spawn() {
    this.ready = false;
    const env = { ...process.env, LD_LIBRARY_PATH: PIPER_LIB };
    this.proc = spawn(PIPER_BIN, ['--model', this.modelPath, '--output_raw', '--json-input'], { env });

    this.proc.stdout.on('data', (chunk) => {
      if (this.active) this.active.onChunk(chunk);
    });

    this.proc.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Initialized piper')) {
        this.ready = true;
        console.log(`[piper:${this.modelFile}] ready`);
        this._next();
      }
      if (msg.includes('Real-time factor') && this.active) {
        const done = this.active.onDone;
        this.active = null;
        done();
        this._next();
      }
    });

    this.proc.on('error', (err) => {
      if (this.active) { this.active.onError(err); this.active = null; }
    });

    this.proc.on('exit', (code) => {
      console.warn(`[piper:${this.modelFile}] exited (${code}), respawning...`);
      if (this.active) { this.active.onError(new Error('Piper exited')); this.active = null; }
      setTimeout(() => this._spawn(), 1000);
    });
  }

  _next() {
    if (this.active || !this.ready || this.queue.length === 0) return;
    const item = this.queue.shift();
    this.active = item;
    // --json-input mode: always send JSON, speaker_id optional
    const text = item.text.replace(/\r?\n/g, ' ').trim();
    const payload = { text };
    if (item.speaker !== undefined) payload.speaker_id = item.speaker;
    this.proc.stdin.write(JSON.stringify(payload) + '\n');
  }

  synthesizeStream(text, speaker, onChunk, onDone, onError) {
    this.queue.push({ text, speaker, onChunk, onDone, onError });
    this._next();
  }
}

// ── Process pool: one instance per unique model file ─────────────────────
const processPool = {};

function getProcess(modelFile) {
  if (!processPool[modelFile]) {
    console.log(`[piper] spawning persistent process for ${modelFile}`);
    processPool[modelFile] = new PiperProcess(modelFile);
  }
  return processPool[modelFile];
}

// Pre-warm the default voice immediately
getProcess(VOICES[DEFAULT_VOICE].model);

// ── WAV header (streaming-safe with unknown size) ─────────────────────────
function streamingWavHeader(sampleRate = 22050, channels = 1, bitDepth = 16) {
  const buf = Buffer.alloc(44);
  const byteRate = sampleRate * channels * (bitDepth / 8);
  buf.write('RIFF', 0);       buf.writeUInt32LE(0xFFFFFFFF, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);      buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);   buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(channels * (bitDepth / 8), 32);  buf.writeUInt16LE(bitDepth, 34);
  buf.write('data', 36);      buf.writeUInt32LE(0xFFFFFFFF, 40);
  return buf;
}

// ── Express ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ limit: '1mb' }));

// List available voices
app.get('/voices', (req, res) => {
  const list = Object.entries(VOICES).map(([id, v]) => ({
    id, label: v.label, gender: v.gender, accent: v.accent,
  }));
  res.json({ voices: list, default: DEFAULT_VOICE });
});

app.get('/health', (req, res) => {
  const status = {};
  for (const [id, v] of Object.entries(VOICES)) {
    const proc = processPool[v.model];
    if (proc && !status[v.model]) status[v.model] = proc.ready;
  }
  res.json({ status: 'ok', models: status });
});

// POST /v1/audio/speech  { input, voice }
app.post('/v1/audio/speech', (req, res) => {
  const text = (req.body?.input || req.body?.text || '').toString().trim();
  if (!text) return res.status(400).json({ error: 'No input text' });

  const voiceId = req.body?.voice || DEFAULT_VOICE;
  const voiceDef = VOICES[voiceId] || VOICES[DEFAULT_VOICE];
  const proc = getProcess(voiceDef.model);

  res.setHeader('Content-Type', 'audio/wav');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-store');
  res.write(streamingWavHeader());

  proc.synthesizeStream(
    text,
    voiceDef.speaker,
    (chunk) => { if (!res.writableEnded) res.write(chunk); },
    () => { if (!res.writableEnded) res.end(); },
    (err) => { console.error('[tts]', err.message); if (!res.writableEnded) res.end(); }
  );
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[piper-tts] listening on :${PORT} — pre-warming ${DEFAULT_VOICE}...`);
});
