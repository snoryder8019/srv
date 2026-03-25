/**
 * Meeting Notetaker — AI-powered transcript summarization
 * Uses Ollama LLM to TLDR transcript chunks from Web Speech API.
 */

import { callLLM } from './agentMcp.js';

const SYSTEM_PROMPT = `You are a concise meeting note-taker. You receive a chunk of raw speech transcript from an ongoing meeting. Your job:

1. Extract the key points, decisions, action items, and important details
2. Write a clean, brief TLDR summary (3-8 bullet points max)
3. Use clear, professional language
4. If the transcript is mostly filler/small talk, say "General discussion — no key points"
5. Prefix action items with "ACTION:"
6. Prefix decisions with "DECIDED:"

Keep it SHORT. No fluff. Just the signal.`;

/**
 * Summarize a transcript chunk via LLM
 * @param {string} transcript - Raw speech-to-text output
 * @param {string} speakerName - Who was speaking
 * @param {string} meetingTitle - Meeting title for context
 * @returns {string} TLDR summary
 */
export async function summarizeChunk(transcript, speakerName, meetingTitle) {
  if (!transcript || transcript.trim().length < 30) {
    return null; // Too short to summarize
  }

  const userMessage = `Meeting: "${meetingTitle || 'Untitled Meeting'}"
Speaker: ${speakerName || 'Unknown'}

Transcript chunk:
"""
${transcript.trim().slice(0, 4000)}
"""

Write a TLDR summary of this transcript chunk.`;

  try {
    const summary = await callLLM(
      [{ role: 'user', content: userMessage }],
      SYSTEM_PROMPT
    );
    return summary || null;
  } catch (err) {
    console.error('[notetaker] LLM summarization failed:', err.message);
    return null;
  }
}
