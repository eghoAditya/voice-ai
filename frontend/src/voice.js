// frontend/src/voice.js
// Robust voice helper with improved number parsing and better voice selection.
// Exports: startConversation(onUpdate), stopConversation(), speak(text)

let running = false;
let stopRequested = false;

// Utility: pick best voice from available voices
function chooseBestVoice() {
  const voices = window.speechSynthesis.getVoices() || [];
  if (!voices.length) return null;

  // prefer language order: en-IN, en-GB, en-US, fallback to first
  const langPriority = [/en-?in/i, /en-?gb/i, /en-?us/i, /en/i];

  // ranking keywords to prefer clearer voices
  const preferKeywords = ['google', 'female', 'samantha', 'zira', 'mark', 'alloy', 'microsoft', 'voice'];

  for (const langRe of langPriority) {
    // prefer voices with both lang match and a keyword (higher quality)
    const withKeyword = voices.filter(v => langRe.test(v.lang) && preferKeywords.some(k => v.name.toLowerCase().includes(k)));
    if (withKeyword.length) return withKeyword[0];

    // else any voice with the language
    const anyLang = voices.find(v => langRe.test(v.lang));
    if (anyLang) return anyLang;
  }

  // fallback: prefer any voice that has one of the keywords
  const globalPrefer = voices.find(v => preferKeywords.some(k => v.name.toLowerCase().includes(k)));
  if (globalPrefer) return globalPrefer;

  // ultimate fallback
  return voices[0];
}

// speak helper that returns a Promise which resolves when speaking ends
export function speak(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) {
      console.warn("No speechSynthesis available");
      resolve();
      return;
    }

    // ensure voices are loaded (some browsers populate asynchronously)
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

        // tuning: make speed slightly slower & clear
        ut.volume = 1;
        ut.rate = 0.95; // slight slowdown improves clarity for many voices
        ut.pitch = 1;

        ut.onstart = () => console.debug('[TTS] started');
        ut.onend = () => {
          console.debug('[TTS] ended');
          resolve();
        };
        ut.onerror = (e) => {
          console.warn('[TTS] error', e);
          resolve();
        };

        try { window.speechSynthesis.cancel(); } catch (e) {}
        window.speechSynthesis.speak(ut);
      } catch (err) {
        console.warn('speak failed', err);
        resolve();
      }
    }
  });
}

// listenOnce: creates fresh recognition, returns transcript or "" on failure
function listenOnce({ lang = "en-IN", timeoutMs = 14000 } = {}) {
  return new Promise((resolve) => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      resolve("");
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SpeechRecognition();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    let finished = false;
    const cleanup = () => {
      try {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
      } catch (e) {}
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
      } catch (e) {
        finish("");
      }
    };

    rec.onerror = (ev) => {
      finish("");
    };

    rec.onend = () => {
      if (!finished) finish("");
    };

    const to = setTimeout(() => {
      if (!finished) finish("");
    }, timeoutMs);

    try {
      rec.start();
    } catch (e) {
      clearTimeout(to);
      finish("");
    }
  });
}

// speak then listen helper (waits for TTS to finish before listening)
async function speakThenListen(promptText) {
  await speak(promptText);
  await new Promise(r => setTimeout(r, 220));
  return await listenOnce();
}

// parse number words & digits more robustly
function parseNumberText(text) {
  if (!text) return null;
  const t = text.toLowerCase().replace(/[,]/g, ' ').trim();

  // direct digits
  const digits = t.match(/\d+/);
  if (digits) return parseInt(digits[0], 10);

  // map small number words
  const small = {
    zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10,
    eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19,
    twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90, hundred:100
  };

  // simple two-word parsing e.g., "twenty two"
  const parts = t.split(/\s+/);
  // if phrase contains 'guest' or 'guests', remove it
  const filtered = parts.filter(p => !/guest/.test(p));
  let total = 0;
  let seen = false;
  for (let i = 0; i < filtered.length; i++) {
    const w = filtered[i];
    if (small[w] !== undefined) {
      // handle "twenty two"
      if (small[w] >= 20 && i+1 < filtered.length && small[filtered[i+1]] !== undefined && small[filtered[i+1]] < 10) {
        total += small[w] + small[filtered[i+1]];
        seen = true;
        break;
      } else {
        total += small[w];
        seen = true;
      }
    }
  }
  if (seen) return total || 1;
  // fallback: try to pick first word that might be number word
  for (const p of filtered) {
    if (small[p] !== undefined) return small[p];
  }
  return null;
}

function parseDateText(text) {
  const t = (text || "").toLowerCase().trim();
  if (!t) return null;
  if (t.includes("today")) return new Date();
  if (t.includes("tomorrow")) { const d = new Date(); d.setDate(d.getDate() + 1); return d; }
  const parsed = Date.parse(t);
  if (!isNaN(parsed)) return new Date(parsed);
  return null;
}
function formatDateYMD(d) {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseTimeText(text) {
  const t = (text || "").toLowerCase().replace("o'clock", "").trim();
  const hhmm = t.match(/(\d{1,2})[:. ](\d{2})/);
  if (hhmm) {
    let hh = parseInt(hhmm[1], 10);
    const mm = String(parseInt(hhmm[2], 10)).padStart(2, "0");
    if (t.includes("pm") && hh < 12) hh += 12;
    if (t.includes("am") && hh === 12) hh = 0;
    return `${String(hh).padStart(2, "0")}:${mm}`;
  }
  const simple = t.match(/(\d{1,2})\s*(am|pm)?/);
  if (simple) {
    let hh = parseInt(simple[1], 10);
    const ampm = simple[2];
    if (ampm === "pm" && hh < 12) hh += 12;
    if (ampm === "am" && hh === 12) hh = 0;
    return `${String(hh).padStart(2, "0")}:00`;
  }
  return null;
}
function genBookingId() { const ts = Date.now(); const rand = Math.floor(Math.random() * 9000) + 1000; return `bk-${ts}-${rand}`; }

export function stopConversation() {
  stopRequested = true;
  running = false;
  try { window.speechSynthesis.cancel(); } catch (e) {}
}

export async function startConversation(onUpdate) {
  if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
    const msg = "Speech recognition not supported in this browser. Use Chrome or Edge.";
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
    { key: "bookingTime", prompt: "What time would you like?" },
    { key: "cuisinePreference", prompt: "Any cuisine preference?" },
    { key: "specialRequests", prompt: "Any special requests? Say 'no' if none." }
  ];

  const answers = {};

  try {
    const greet = "Hello! I will help you book a table. I will ask some quick questions.";
    onUpdate && onUpdate(greet, "agent");
    await speak(greet);

    for (let i = 0; i < flow.length; i++) {
      if (stopRequested) break;
      const q = flow[i];
      onUpdate && onUpdate(q.prompt, "agent");

      let transcript = await speakThenListen(q.prompt);
      if (!transcript) {
        const reprompt = "I didn't catch that. " + q.prompt;
        onUpdate && onUpdate(reprompt, "agent");
        transcript = await speakThenListen(reprompt);
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

    // parse/normalize
    const parsedDate = parseDateText(answers.bookingDate || "") || new Date();
    const bookingDateYMD = formatDateYMD(parsedDate);
    const parsedTime = parseTimeText(answers.bookingTime || "") || "19:00";

    // use parseNumberText robustly
    let noGuests = parseNumberText(answers.numberOfGuests) || null;
    if (!noGuests) {
      // try extract digits
      const d = (answers.numberOfGuests || "").match(/\d+/);
      noGuests = d ? parseInt(d[0], 10) : 1;
    }
    if (isNaN(noGuests) || noGuests <= 0) noGuests = 1;

    let special = answers.specialRequests || "";
    if (special.toLowerCase().trim() === "no") special = "";

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

    const confirmText = `Confirming: ${payload.customerName}, ${payload.numberOfGuests} guests, on ${payload.bookingDate} at ${payload.bookingTime}. Say yes to confirm.`;
    onUpdate && onUpdate(confirmText, "agent");
    await speak(confirmText);

    const confirmResp = await speakThenListen("Please say yes to confirm or no to cancel.");
    onUpdate && onUpdate(confirmResp || "", "user");
    const yes = (confirmResp || "").toLowerCase();
    const yesWords = ["yes", "yeah", "yep", "sure", "ok", "okay", "confirm"];
    let confirmed = false;
    for (const w of yesWords) if (yes.includes(w)) confirmed = true;

    if (!confirmed) {
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
        headers: { "Content-Type": "application/json" },
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
