const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');
const { ensureAuth, ensureAdmin } = require('../middleware/auth');

const API_BASE = process.env.LLM_API_BASE || 'https://ollama.madladslab.com';
const API_KEY = process.env.LLM_API_KEY || '';

router.use('/admin/assets', ensureAuth, ensureAdmin);

// ─── Asset Gallery / Generator ────────────────────────────
router.get('/admin/assets', (req, res) => {
  res.render('admin/assets/dashboard', {
    title: 'AI Image Assets',
    section: 'assets'
  });
});

// ─── Generate Image (SD v1.5) ─────────────────────────────
router.post('/admin/assets/generate', async (req, res) => {
  try {
    const { prompt, size } = req.body;
    const sizes = {
      'square': '512x512',
      'landscape': '768x512',
      'portrait': '512x768',
      'ig-post': '512x512',
      'ig-story': '512x768',
      'fb-cover': '768x512',
      'banner': '768x256'
    };
    const sizeStr = sizes[size] || '512x512';

    const data = JSON.stringify({
      prompt: prompt,
      size: sizeStr,
      n: 1
    });

    const url = new URL(API_BASE + '/v1/images/generations');
    const mod = url.protocol === 'https:' ? https : http;

    const result = await new Promise((resolve, reject) => {
      const apiReq = mod.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...(API_KEY ? { 'Authorization': 'Bearer ' + API_KEY } : {})
        },
        timeout: 120000
      }, (apiRes) => {
        let chunks = [];
        apiRes.on('data', c => chunks.push(c));
        apiRes.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch (e) {
            reject(new Error('Invalid response from image API'));
          }
        });
      });
      apiReq.on('error', reject);
      apiReq.on('timeout', () => { apiReq.destroy(); reject(new Error('Image generation timed out')); });
      apiReq.write(data);
      apiReq.end();
    });

    if (result.data && result.data[0]) {
      res.json({
        success: true,
        image: result.data[0].b64_json ? 'data:image/png;base64,' + result.data[0].b64_json : result.data[0].url,
        prompt: prompt,
        size: sizeStr
      });
    } else {
      res.json({ success: false, error: 'No image returned' });
    }
  } catch (err) {
    console.error('Image gen error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
