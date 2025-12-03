// backend/routes/nlp.js
// POST /api/nlp/interpret
// Body: { text: "<natural language booking sentence>", locale?: "en-IN", lat?: "...", lon?: "..." }
// Response: { success: true, intent: { bookingDate, bookingTime, numberOfGuests, cuisinePreference, specialRequests, raw } }
// Uses Groq's OpenAI-compatible Responses/Chat Completions endpoint.

const express = require('express');
const router = express.Router();
const axios = require('axios');

/**
 * Environment:
 * - GROQ_API_KEY (required)
 * - GROQ_MODEL (optional) default: 'gpt-3.5-turbo'
 * - GROQ_BASE (optional) default: 'https://api.groq.com/openai/v1'
 */
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'gpt-3.5-turbo';
const GROQ_BASE = process.env.GROQ_BASE || 'https://api.groq.com/openai/v1';

if (!GROQ_API_KEY) {
  console.warn('Warning: GROQ_API_KEY is not set. NLP endpoint will fail until you set it in .env');
}

/** safe JSON parse */
function tryParseJSON(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

/** build prompt asking strict JSON */
function buildExtractionMessages(userText, locale = 'en-IN') {
    // current date in YYYY-MM-DD so model can resolve "today" / "tomorrow"
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const todayYMD = `${yyyy}-${mm}-${dd}`;
  
    return [
      {
        role: 'system',
        content:
          'You are an assistant that extracts structured booking information from a user utterance. ' +
          'Output ONLY a valid JSON object, nothing else. Fields: bookingDate (YYYY-MM-DD or null), bookingTime (HH:MM 24h or null), ' +
          'numberOfGuests (integer or null), cuisinePreference (string or null), specialRequests (string or null), raw (original text). ' +
          `Use locale ${locale} for parsing dates where relevant. IMPORTANT: when the user says relative dates like "today", "tomorrow", "this Friday", "next Monday", compute the absolute date relative to the current date. The current date is ${todayYMD}. Use that to resolve "tomorrow" etc.`
      },
      {
        role: 'user',
        content: `Extract booking info from: """${userText}"""\n\nReturn ONLY the JSON object.`
      }
    ];
  }
  

/** POST /interpret */
router.post('/interpret', async (req, res) => {
  try {
    const { text, locale } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing "text" in request body' });
    }

    if (!GROQ_API_KEY) {
      return res.status(500).json({ success: false, error: 'GROQ_API_KEY not configured on server' });
    }

    const messages = buildExtractionMessages(text, locale || 'en-IN');

    // Call Groq's OpenAI-compatible chat completions endpoint
    const url = `${GROQ_BASE}/chat/completions`;

    const payload = {
      model: GROQ_MODEL,
      messages,
      temperature: 0.0,
      max_tokens: 400
    };

    const headers = {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    };

    const groqResp = await axios.post(url, payload, { headers, timeout: 20000 });

    // Expect similar response shape to OpenAI: choices[0].message.content
    const assistantMsg =
      groqResp?.data?.choices && groqResp.data.choices[0] && groqResp.data.choices[0].message
        ? groqResp.data.choices[0].message.content
        : null;

    if (!assistantMsg) {
      // try fallback to other response fields (some Groq endpoints may use different fields)
      const alt = groqResp?.data?.output_text || groqResp?.data?.choices?.[0]?.text;
      if (!alt) {
        return res.status(502).json({ success: false, error: 'No response from NLP provider', raw: groqResp.data });
      }
      // treat alt as assistantMsg
      assistantMsg = alt;
    }

    // Try to parse JSON directly
    let parsed = tryParseJSON(assistantMsg && assistantMsg.trim());
    if (!parsed) {
      // Try to extract the first JSON object substring
      const jsonMatch = (assistantMsg || '').match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = tryParseJSON(jsonMatch[0]);
    }

    if (!parsed) {
      // Return raw assistant text so frontend can display it / fallback
      return res.json({ success: true, intent: { rawText: assistantMsg }, warning: 'Could not parse JSON; returned raw assistant text' });
    }

    // Normalize fields
    const normalized = {
      bookingDate: parsed.bookingDate || null,
      bookingTime: parsed.bookingTime || null,
      numberOfGuests:
        parsed.numberOfGuests === undefined || parsed.numberOfGuests === null
          ? null
          : Number(parsed.numberOfGuests),
      cuisinePreference: parsed.cuisinePreference || null,
      specialRequests: parsed.specialRequests || null,
      raw: parsed.raw || text
    };

    return res.json({ success: true, intent: normalized });
  } catch (err) {
    console.error('NLP (Groq) interpret error:', err?.response?.data || err?.message || err);
    // If Groq returned a useful error body, return it
    if (err?.response?.data) {
      return res.status(err.response.status || 500).json({ success: false, error: err.response.data });
    }
    return res.status(500).json({ success: false, error: err?.message || 'Server error' });
  }
});

module.exports = router;
