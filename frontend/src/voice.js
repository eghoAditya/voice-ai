// frontend/src/voice.js
// Voice helper with weather-based seating suggestion.
// Exports: startConversation(onUpdate), stopConversation(), speak(text)

let running = false;
let stopRequested = false;

// ----- Voice selection & TTS -----
function chooseBestVoice() {
  const voices = window.speechSynthesis.getVoices() || [];
  if (!voices.length) return null;
  const langPriority = [/en-?in/i, /en-?gb/i, /en-?us/i, /en/i];
  const preferKeywords = ['google', 'female', 'samantha', 'zira', 'microsoft', 'voice'];
  for (const langRe of langPriority) {
    const withKeyword = voices.filter(v => langRe.test(v.lang) && preferKeywords.some(k => v.name.toLowerCase().includes(k)));
    if (withKeyword.length) return withKeyword[0];
    const anyLang = voices.find(v => langRe.test(v.lang));
    if (anyLang) return anyLang;
  }
  const globalPrefer = voices.find(v => preferKeywords.some(k => v.name.toLowerCase().includes(k)));
  if (globalPrefer) return globalPrefer;
  return voices[0];
}

export function speak(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) { resolve(); return; }

    let voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) {
      const onVoices = () => {
        voices = window.speechSynthesis.getVoices();
        window.speechSynthesis.removeEventListener('voiceschanged', onVoices);
        proceed();
      };
      window.speechSynthesis.addEventListener('voiceschanged', onVoices);
      setTimeout(() => {
        try { window.speechSynthesis.removeEventListener('voiceschanged', onVoices); } catch (e) {}
        voices = window.speechSynthesis.getVoices();
        proceed();
      }, 800);
    } else {
      proceed();
    }

    function proceed() {
      try {
        const ut = new SpeechSynthesisUtterance(text);
        const best = chooseBestVoice();
        if (best) ut.voice = best;
        ut.volume = 1; ut.rate = 0.95; ut.pitch = 1;
        ut.onend = () => resolve();
        ut.onerror = () => resolve();
        try { window.speechSynthesis.cancel(); } catch (e) {}
        window.speechSynthesis.speak(ut);
      } catch (err) {
        resolve();
      }
    }
  });
}

// ----- Recognition helper -----
function listenOnce({ lang = "en-IN", timeoutMs = 14000 } = {}) {
  return new Promise((resolve) => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) { resolve(""); return; }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SpeechRecognition();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    let finished = false;
    const cleanup = () => {
      try { rec.onresult = null; rec.onerror = null; rec.onend = null; } catch (e) {}
    };
    const finish = (text) => {
      if (finished) return;
      finished = true;
      cleanup();
      try { rec.stop(); } catch (e) {}
      resolve(text || "");
    };

    rec.onresult = (event) => {
      try {
        const t = event.results && event.results[0] && event.results[0][0] && event.results[0][0].transcript;
        finish(t ? t.trim() : "");
      } catch (e) { finish(""); }
    };
    rec.onerror = (ev) => { finish(""); };
    rec.onend = () => { if (!finished) finish(""); };

    const to = setTimeout(() => { if (!finished) finish(""); }, timeoutMs);
    try { rec.start(); } catch (e) { clearTimeout(to); finish(""); }
  });
}

async function speakThenListen(promptText) {
  await speak(promptText);
  await new Promise(r => setTimeout(r, 220));
  return await listenOnce();
}

// ----- Parsing utilities -----
const SMALL_NUM = {
  zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10,
  eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19,
  twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90, hundred:100
};

function parseNumberText(text) {
  if (!text) return null;
  const t = text.toLowerCase().replace(/[,]/g, ' ').trim();
  const digits = t.match(/\d+/);
  if (digits) return parseInt(digits[0], 10);
  const parts = t.split(/\s+/).filter(p => !/guest/.test(p));
  let total = 0, seen = false;
  for (let i=0;i<parts.length;i++){
    const w = parts[i];
    if (SMALL_NUM[w] !== undefined) {
      // handle "twenty two"
      if (SMALL_NUM[w] >= 20 && i+1 < parts.length && SMALL_NUM[parts[i+1]] !== undefined && SMALL_NUM[parts[i+1]] < 10) {
        total += SMALL_NUM[w] + SMALL_NUM[parts[i+1]];
        seen = true;
        break;
      } else {
        total += SMALL_NUM[w];
        seen = true;
      }
    }
  }
  if (seen) return total || 1;
  for (const p of parts) if (SMALL_NUM[p] !== undefined) return SMALL_NUM[p];
  return null;
}

function parseDateText(text) {
  const t = (text || "").toLowerCase().trim();
  if (!t) return null;
  if (t.includes("today")) return new Date();
  if (t.includes("tomorrow")) { const d = new Date(); d.setDate(d.getDate()+1); return d; }
  const parsed = Date.parse(t);
  if (!isNaN(parsed)) return new Date(parsed);
  return null;
}
function formatDateYMD(d) {
  const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function parseTimeText(text) {
  const t = (text || "").toLowerCase().replace("o'clock","").trim();
  const hhmm = t.match(/(\d{1,2})[:. ](\d{2})/);
  if (hhmm) {
    let hh = parseInt(hhmm[1],10);
    const mm = String(parseInt(hhmm[2],10)).padStart(2,'0');
    if (t.includes("pm") && hh<12) hh += 12;
    if (t.includes("am") && hh===12) hh = 0;
    return `${String(hh).padStart(2,'0')}:${mm}`;
  }
  const simple = t.match(/(\d{1,2})\s*(am|pm)?/);
  if (simple) {
    let hh = parseInt(simple[1],10);
    const ampm = simple[2];
    if (ampm === 'pm' && hh < 12) hh += 12;
    if (ampm === 'am' && hh === 12) hh = 0;
    return `${String(hh).padStart(2,'0')}:00`;
  }
  return null;
}
function genBookingId(){ const ts = Date.now(); const rand = Math.floor(Math.random()*9000)+1000; return `bk-${ts}-${rand}`; }

export function stopConversation() { stopRequested = true; running = false; try { window.speechSynthesis.cancel(); } catch(e) {} }

// ----- New: fetch weather suggestion from backend and ask seating preference -----
async function fetchWeatherSuggestion(dateYMD, lat='12.9716', lon='77.5946') {
  try {
    const url = `http://localhost:4000/api/weather?date=${encodeURIComponent(dateYMD)}&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const r = await fetch(url);
    if (!r.ok) {
      return { ok:false, reason:`weather API returned ${r.status}` };
    }
    const data = await r.json();
    // data.seatingRecommendation expected ('indoor'|'outdoor') and data.weatherSummary
    return { ok:true, data };
  } catch (err) {
    return { ok:false, reason: err.message || String(err) };
  }
}

// enhanced affirmative detection
function isAffirmative(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  const yesWords = ["yes","yeah","yep","sure","ok","okay","confirm","affirmative","please do","do it","i do","i'd like"];
  for (const w of yesWords) if (t.includes(w)) return true;
  if (/^\s*y[ae]h?\b/.test(t)) return true;
  return false;
}

// ----- Main conversation flow -----
export async function startConversation(onUpdate) {
  if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
    const msg = "Speech recognition not supported. Use Chrome or Edge.";
    onUpdate && onUpdate(msg, "agent");
    await speak(msg);
    return;
  }

  stopRequested = false;
  running = true;

  const flow = [
    { key: "customerName", prompt: "Please tell me your name." },
    { key: "numberOfGuests", prompt: "How many guests?" },
    { key: "bookingDate", prompt: "What date would you like to book? You can say 'today' or 'tomorrow'." },
    // We'll insert weather suggestion after bookingDate before continuing
    { key: "bookingTime", prompt: "What time would you like?" },
    { key: "cuisinePreference", prompt: "Any cuisine preference?" },
    { key: "specialRequests", prompt: "Any special requests? Say 'no' if none." }
  ];

  const answers = {};
  let seatingPreferenceFromUser = null; // will set if user answers suggestion

  try {
    const greet = "Hello! I will help you book a table. I will ask some quick questions.";
    onUpdate && onUpdate(greet, "agent");
    await speak(greet);

    for (let i=0;i<flow.length;i++){
      if (stopRequested) break;
      const q = flow[i];

      // After user answered bookingDate we want to do weather suggestion before moving on.
      if (q.key === 'bookingTime') {
        // bookingDate should already be present in answers.bookingDate
        const rawDateText = answers.bookingDate || "";
        const parsedDate = parseDateText(rawDateText) || new Date();
        const dateYMD = formatDateYMD(parsedDate);

        // fetch weather suggestion (best-effort)
        onUpdate && onUpdate(`Checking weather for ${dateYMD}…`, "agent");
        const weatherResp = await fetchWeatherSuggestion(dateYMD);
        let suggestionText = "";
        if (weatherResp.ok && weatherResp.data) {
          const w = weatherResp.data;
          const rec = (w.seatingRecommendation || w.seatingPreference || '').toLowerCase();
          const summary = w.weatherSummary || "";
          if (rec === 'outdoor') {
            suggestionText = `The weather looks great on ${dateYMD}! Would you prefer outdoor seating?`;
          } else if (rec === 'indoor') {
            suggestionText = `It might rain on ${dateYMD}. I'd recommend our cozy indoor area. Would you like that?`;
          } else {
            // unknown or approximate
            suggestionText = `I checked the weather for ${dateYMD}: ${summary || 'forecast not available'}. Would you prefer indoor seating?`;
          }
        } else {
          suggestionText = `I couldn't fetch the forecast for ${dateYMD}. Would you prefer indoor seating by default?`;
        }

        // ask suggestion and listen for preference
        onUpdate && onUpdate(suggestionText, "agent");
        await speak(suggestionText);

        // listen for yes/no/preference
        const prefResp = await listenOnce();
        onUpdate && onUpdate(prefResp || "", "user");
        if (isAffirmative(prefResp)) {
          // If suggestion was outdoor phrased, user said yes -> outdoor, else if interior suggestion yes -> indoor
          if (weatherResp.ok && weatherResp.data && ((weatherResp.data.seatingRecommendation || '').toLowerCase() === 'outdoor')) {
            seatingPreferenceFromUser = 'outdoor';
          } else if (weatherResp.ok && weatherResp.data && ((weatherResp.data.seatingRecommendation || '').toLowerCase() === 'indoor')) {
            seatingPreferenceFromUser = 'indoor';
          } else {
            // positive answer — prefer outdoor? ask clarifying? we'll assume 'indoor' as safe default if unknown suggestion asked indoor.
            seatingPreferenceFromUser = (weatherResp.ok && weatherResp.data && (weatherResp.data.seatingRecommendation === 'outdoor')) ? 'outdoor' : 'indoor';
          }
        } else {
          // user didn't confirm — assume opposite of suggestion when they say no, or leave null
          if (weatherResp.ok && weatherResp.data) {
            const rec = (weatherResp.data.seatingRecommendation || '').toLowerCase();
            seatingPreferenceFromUser = (rec === 'outdoor') ? 'indoor' : (rec === 'indoor' ? 'outdoor' : null);
          } else {
            seatingPreferenceFromUser = 'indoor'; // safe default
          }
        }
        // continue to the bookingTime prompt after suggestion
      }

      // ask the question normally
      onUpdate && onUpdate(q.prompt, "agent");
      await speak(q.prompt);
      let transcript = await listenOnce();
      if (!transcript) {
        const reprompt = "I didn't catch that. " + q.prompt;
        onUpdate && onUpdate(reprompt, "agent");
        await speak(reprompt);
        transcript = await listenOnce();
      }
      onUpdate && onUpdate(transcript || "", "user");
      answers[q.key] = transcript || "";
    }

    if (stopRequested) {
      onUpdate && onUpdate("Stopped listening.", "agent");
      await speak("Stopped listening.");
      running = false;
      return;
    }

    // normalize inputs
    const parsedDate = parseDateText(answers.bookingDate || "") || new Date();
    const bookingDateYMD = formatDateYMD(parsedDate);
    const parsedTime = parseTimeText(answers.bookingTime || "") || "19:00";
    let noGuests = parseNumberText(answers.numberOfGuests) || null;
    if (!noGuests) {
      const d = (answers.numberOfGuests || "").match(/\d+/);
      noGuests = d ? parseInt(d[0],10) : 1;
    }
    if (isNaN(noGuests) || noGuests <= 0) noGuests = 1;
    let special = answers.specialRequests || "";
    if (special.toLowerCase().trim() === 'no') special = "";

    const payload = {
      bookingId: genBookingId(),
      customerName: answers.customerName || "Guest",
      numberOfGuests: noGuests,
      bookingDate: bookingDateYMD,
      bookingTime: parsedTime,
      cuisinePreference: answers.cuisinePreference || "",
      specialRequests: special,
      lat: "12.9716",
      lon: "77.5946"
    };

    // include seatingPreference if user explicitly chose
    if (seatingPreferenceFromUser) payload.seatingPreference = seatingPreferenceFromUser;

    // confirm with user
    const confirmText = `Confirming: ${payload.customerName}, ${payload.numberOfGuests} guests, on ${payload.bookingDate} at ${payload.bookingTime}. Shall I book this? Say yes to confirm.`;
    onUpdate && onUpdate(confirmText, "agent");
    await speak(confirmText);

    const confirmResp = await speakThenListen("Please say yes to confirm or no to cancel.");
    onUpdate && onUpdate(confirmResp || "", "user");
    const confirmed = (confirmResp || "").toLowerCase();
    const yesWords = ["yes","yeah","yep","sure","ok","okay","confirm"];
    let confirmedFlag = false;
    for (const w of yesWords) if (confirmed.includes(w)) confirmedFlag = true;

    if (!confirmedFlag) {
      const msg = "Okay, booking cancelled.";
      onUpdate && onUpdate(msg, "agent");
      await speak(msg);
      running = false;
      return;
    }

    onUpdate && onUpdate("Saving your booking…", "agent");
    await speak("Saving your booking now.");

    try {
      const resp = await fetch("http://localhost:4000/api/bookings", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });
      const saved = await resp.json();
      if (!resp.ok) {
        const errMsg = saved && saved.error ? saved.error : "Failed to save booking";
        onUpdate && onUpdate(`Error: ${errMsg}`, "agent");
        await speak(`I couldn't save your booking. ${errMsg}`);
      } else {
        const doneMsg = `Booking confirmed. ${payload.customerName}, your table is booked for ${payload.bookingDate} at ${payload.bookingTime}. Seating suggested: ${saved.seatingPreference || (saved.weatherInfo && saved.weatherInfo.seatingRecommendation) || "not available"}.`;
        onUpdate && onUpdate(doneMsg, "agent");
        await speak(doneMsg);
      }
    } catch (err) {
      console.error("Failed to post booking", err);
      onUpdate && onUpdate("Network error while saving booking.", "agent");
      await speak("Network error while saving booking.");
    }

    running = false;
  } catch (err) {
    console.error("Conversation error", err);
    onUpdate && onUpdate("Conversation error. Please try again.", "agent");
    await speak("Sorry, something went wrong. Please try again.");
    running = false;
  }
}
