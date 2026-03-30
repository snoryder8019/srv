/**
 * Agent service — connects to madladslab AI API for LLM chat.
 * Gracefully handles API being down.
 */
const http = require('http');
const https = require('https');
const AgentTask = require('../models/AgentTask');

const API_BASE = process.env.LLM_API_BASE || 'https://ollama.madladslab.com';
const API_KEY = process.env.LLM_API_KEY || '';


const SYSTEM_PROMPT = `You are the ACM Hospitality Group Assistant. You help manage three restaurants:
- The Nook (Light Farms, Celina, TX) — a cocktail kitchen & market café
- Heyday (Downtown Celina, TX) — a cocktail bar & kitchen with fresh, fun flavors
- Graffiti Pasta (Denton, TX) — Tuscan-inspired with creative fusions

You assist with marketing, promotions, newsletter drafts, subscriber analytics, and operational tasks.
Keep responses concise and actionable. Use markdown formatting when helpful.`;

function apiRequest(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(API_BASE + path);
    const mod = url.protocol === 'https:' ? https : http;

    const req = mod.request({
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
    }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString());
          resolve(json);
        } catch (e) {
          reject(new Error('Invalid API response'));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('API timeout')); });
    req.write(data);
    req.end();
  });
}

async function chat(messages, systemPrompt) {
  const allMessages = [
    { role: 'system', content: systemPrompt || SYSTEM_PROMPT },
    ...messages
  ];

  try {
    const result = await apiRequest('/v1/chat/completions', {
      messages: allMessages,
      temperature: 0.7,
      max_tokens: 2048
    });

    if (result.choices && result.choices[0]) {
      return {
        success: true,
        content: result.choices[0].message.content,
        tokens: result.usage ? result.usage.total_tokens : 0
      };
    }
    return { success: false, content: 'No response from model', tokens: 0 };
  } catch (err) {
    return {
      success: false,
      content: 'AI service is temporarily unavailable. The LLM server may be down for maintenance. Please try again later.',
      tokens: 0
    };
  }
}

async function generateContent(prompt, type) {
  const typePrompts = {
    campaign_draft: 'Draft an email marketing campaign for the following request. Include a subject line and HTML email body.',
    promo_suggest: 'Suggest promotional ideas for the restaurants. Include discount amounts, types, and target audiences.',
    content_gen: 'Generate marketing content for the following request.',
    analysis: 'Analyze the following data and provide insights and recommendations.'
  };

  const messages = [
    { role: 'user', content: (typePrompts[type] || '') + '\n\n' + prompt }
  ];

  return chat(messages);
}

async function processTask(taskId) {
  const task = await AgentTask.findById(taskId);
  if (!task) throw new Error('Task not found');

  task.status = 'running';
  await task.save();

  const start = Date.now();

  try {
    let result;
    if (task.type === 'chat') {
      result = await chat([{ role: 'user', content: task.prompt }]);
    } else {
      result = await generateContent(task.prompt, task.type);
    }

    task.response = result.content;
    task.status = result.success ? 'completed' : 'failed';
    task.metadata = {
      tokens: result.tokens,
      duration: Date.now() - start
    };
    task.completedAt = new Date();
    await task.save();

    return task;
  } catch (err) {
    task.status = 'failed';
    task.response = err.message;
    task.completedAt = new Date();
    task.metadata = { duration: Date.now() - start };
    await task.save();
    return task;
  }
}

module.exports = { chat, generateContent, processTask, SYSTEM_PROMPT };
