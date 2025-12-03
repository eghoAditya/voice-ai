// frontend/src/voice.js
// Voice helper integrated with Groq NLP and supports a locale option.
// Fixed: ensures TTS utterance language (ut.lang) is set to the active locale so Hindi is spoken properly.

let running = false;
let stopRequested = false;
let ttsLang = 'en-IN'; // module-level TTS language; updated by startConversation

// ---------- TTS ----------
function chooseBestVoice(preferredLang) {
  const voices = window.speechSynthesis.getVoices() || [];
  if (!voices.length) return null;

  // Build ordered language priority: prefer exact lang then fallbacks
  const langPriority = [];
  if (preferredLang) {
    // e.g., 'hi-IN' -> prefer hi-IN, then hi, then en-IN, en
    const p = preferredLang.toLowerCase();
    langPriority.push(new RegExp('^' + p.replace('-', '.?')));
    const short = p.split('-')[0];
    if (short) langPriority.push(new RegExp('^' + short));
  }
  langPriority.push(/en-?in/i);
  langPriority.push(/en-?gb/i);
  langPriority.push(/en-?us/i);
  langPriority.push(/en/i);

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

        // Set utterance language explicitly to the active TTS language
        if (ttsLang) {
          try {
            ut.lang = ttsLang;
          } catch (e) {
            // ignore if browser rejects
          }
        }

        const best = chooseBestVoice(ttsLang);
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

// ---------- Recognition helper ----------
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

async function speakThenListen(promptText, lang = 'en-IN') {
  await speak(promptText);
  await new Promise(r => setTimeout(r, 220));
  return await listenOnce({ lang });
}

// ---------- Parsing helpers ----------
const SMALL_NUM = {
  zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10,
  eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19,
  twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90, hundred:100
};

function parseNumberText(text) {
    if (!text) return null;
    const orig = String(text).trim();
  
    // 1) Quick numeric digits (Latin or Devanagari)
    // Replace Devanagari digits with Latin equivalents
    const devanagariDigits = { '०':'0','१':'1','२':'2','३':'3','४':'4','५':'5','६':'6','७':'7','८':'8','९':'9' };
    let normalized = orig.replace(/[\u0966-\u096F]/g, (d) => devanagariDigits[d] || d);
  
    const digitsMatch = normalized.match(/\d+/);
    if (digitsMatch) return parseInt(digitsMatch[0], 10);
  
    // 2) Word-based numbers: support English and Hindi words
    const engSmall = {
      zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10,
      eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19,
      twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90, hundred:100
    };
  
    const hinSmall = {
      'शून्य':0,'शुन्य':0,'एक':1,'दो':2,'दोण':2,'तीन':3,'चार':4,'पांच':5,'छह':6,'सात':7,'आठ':8,'नौ':9,'दस':10,
      'ग्यारह':11,'बारह':12,'तेरह':13,'चौदह':14,'पंद्रह':15,'पंद्रह':15,'सोलह':16,'सत्रह':17,' अठारह':18,'अठारह':18,'उन्नीस':19,
      'बीस':20,'तीस':30,'चालीस':40,'पचास':50,'साठ':60,'सत्तर':70,'अस्सी':80,'नब्बे':90,'सौ':100
    };
  
    // lower-case and normalize punctuation
    const t = normalized.toLowerCase().replace(/[,\;]/g,' ').replace(/[^0-9a-z\u0900-\u097F\s\-]/g,' ').trim();
    const parts = t.split(/\s+/).filter(Boolean);
  
    // try English words first
    let total = 0;
    let seen = false;
    for (let i=0;i<parts.length;i++){
      const w = parts[i];
      if (engSmall[w] !== undefined) {
        // handle twenty two pattern
        if (engSmall[w] >= 20 && i+1 < parts.length && engSmall[parts[i+1]] !== undefined && engSmall[parts[i+1]] < 10) {
          total += engSmall[w] + engSmall[parts[i+1]];
          seen = true;
          break;
        } else {
          total += engSmall[w];
          seen = true;
        }
      }
    }
    if (seen) return total || 1;
  
    // try Hindi words
    total = 0; seen = false;
    for (let i=0;i<parts.length;i++){
      const w = parts[i];
      if (hinSmall[w] !== undefined) {
        if (hinSmall[w] >= 20 && i+1 < parts.length && hinSmall[parts[i+1]] !== undefined && hinSmall[parts[i+1]] < 10) {
          total += hinSmall[w] + hinSmall[parts[i+1]];
          seen = true;
          break;
        } else {
          total += hinSmall[w];
          seen = true;
        }
      }
    }
    if (seen) return total || 1;
  
    // fallback: look for any single small-number word
    for (const p of parts) {
      if (engSmall[p] !== undefined) return engSmall[p];
      if (hinSmall[p] !== undefined) return hinSmall[p];
    }
  
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

// ---------- NLP call ----------
async function callNLP(text, locale = 'en-IN') {
  try {
    const resp = await fetch('http://localhost:4000/api/nlp/interpret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, locale })
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.warn('NLP call failed', resp.status, body);
      return null;
    }
    const j = await resp.json();
    if (j && j.success && j.intent) return j.intent;
    if (j && j.intent && j.intent.rawText) return j.intent; // fallback
    return null;
  } catch (err) {
    console.warn('NLP call error', err);
    return null;
  }
}

// ---------- Weather ----------
async function fetchWeatherSuggestion(dateYMD, lat='12.9716', lon='77.5946') {
  try {
    const url = `http://localhost:4000/api/weather?date=${encodeURIComponent(dateYMD)}&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const r = await fetch(url);
    if (!r.ok) return { ok:false, reason:`weather API returned ${r.status}` };
    const data = await r.json();
    return { ok:true, data };
  } catch (err) {
    return { ok:false, reason: err.message || String(err) };
  }
}

function isAffirmative(text) {
    if (!text) return false;
    const t = String(text).toLowerCase().trim();
  
    // normalize common Hindi affirmative variants (with/without nukta/diacritics)
    const norm = t.replace(/हाँ/g, 'haan').replace(/हां/g, 'haan').replace(/हूँ/g,'hun');
  
    const yesWords = ["yes","yeah","yep","sure","ok","okay","confirm","affirmative","please do","do it","i do","i'd like","haan","haan ji","हाँ","हां","ठीक","ठीक है","बिलकुल"];
    for (const w of yesWords) if (norm.includes(w) || t.includes(w)) return true;
  
    // also quick regex for single-letter yes like 'y' (in latin)
    if (/^\s*y[ae]s?\b/.test(t)) return true;
    return false;
  }
  
// ---------- Main conversation flow with locale support ----------
// startConversation(onUpdate, { locale: 'en-IN' | 'hi-IN' | ... })
export async function startConversation(onUpdate, options = {}) {
  const userLocale = (options && options.locale) ? options.locale : 'en-IN';

  // set the TTS language for the whole session
  ttsLang = userLocale;

  if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
    const msg = userLocale.startsWith('hi') ? "Speech recognition not supported. Use Chrome (Hindi support requires Chrome/Edge)." : "Speech recognition not supported. Use Chrome or Edge.";
    onUpdate && onUpdate(msg, "agent");
    await speak(msg);
    return;
  }

  stopRequested = false;
  running = true;

  const flow = [
    { key: "customerName", prompt: userLocale.startsWith('hi') ? "कृपया अपना नाम बताइए।" : "Please tell me your name." },
    { key: "numberOfGuests", prompt: userLocale.startsWith('hi') ? "कितने मेहमान हैं?" : "How many guests?" },
    { key: "bookingDate", prompt: userLocale.startsWith('hi') ? "किस तारीख के लिए बुकिंग चाहिए? आप 'आज' या 'कल' कह सकते हैं।" : "What date would you like to book? You can say 'today' or 'tomorrow'." },
    { key: "bookingTime", prompt: userLocale.startsWith('hi') ? "कितने बजे आ रहे हैं?" : "What time would you like?" },
    { key: "cuisinePreference", prompt: userLocale.startsWith('hi') ? "कोई व्यंजन पसंद?" : "Any cuisine preference?" },
    { key: "specialRequests", prompt: userLocale.startsWith('hi') ? "कोई विशेष अनुरोध? नहीं होने पर 'no' कहें।" : "Any special requests? Say 'no' if none." }
  ];

  const answers = {};
  let seatingPreferenceFromUser = null;

  try {
    const greet = userLocale.startsWith('hi') ? "नमस्ते! मैं आपकी टेबल बुक करने में मदद करूँगा। मैं कुछ प्रश्न पूछूँगा।" : "Hello! I will help you book a table. I will ask some quick questions.";
    onUpdate && onUpdate(greet, "agent");
    await speak(greet);

    for (let i = 0; i < flow.length; i++) {
      if (stopRequested) break;
      const q = flow[i];

      if (answers[q.key] && answers[q.key].length > 0) continue;

      // weather suggestion before bookingTime (same logic as before)
      // ---------- Seating suggestion (replace existing bookingTime block) ----------
// ---------- Seating suggestion (replace the existing bookingTime block) ----------
if (q.key === 'bookingTime') {
    const rawDateText = answers.bookingDate || "";
    const parsedDate = parseDateText(rawDateText) || new Date();
    const dateYMD = formatDateYMD(parsedDate);
  
    onUpdate && onUpdate(`Checking weather for ${dateYMD}…`, "agent");
    const weatherResp = await fetchWeatherSuggestion(dateYMD);
    let suggestionText = "";
    let rec = ''; // lowercased suggested seating from weather
  
    if (weatherResp.ok && weatherResp.data) {
      const w = weatherResp.data;
      rec = (w.seatingRecommendation || w.seatingPreference || '').toLowerCase();
      const summary = w.weatherSummary || "";
      if (rec === 'outdoor') {
        suggestionText = `The weather looks great on ${dateYMD}! Would you prefer outdoor seating?`;
      } else if (rec === 'indoor') {
        suggestionText = `It might rain on ${dateYMD}. I'd recommend our cozy indoor area. Would you like that?`;
      } else {
        suggestionText = `I checked the weather for ${dateYMD}: ${summary || 'forecast not available'}. Would you prefer outdoor seating?`;
        rec = 'outdoor';
      }
    } else {
      suggestionText = `I couldn't fetch the forecast for ${dateYMD}. Would you prefer indoor seating by default?`;
      rec = 'indoor';
    }
  
    // Ask and listen robustly
    onUpdate && onUpdate(suggestionText, "agent");
    await speak(suggestionText);
    const prefResp = (typeof listenWithFallback === 'function') ? await listenWithFallback(userLocale) : await listenOnce({ lang: userLocale });
    onUpdate && onUpdate(prefResp || "", "user");
  
    // helper to detect negative replies
    function isNegative(text) {
      if (!text) return false;
      const t = String(text).toLowerCase();
      const noWords = ["no","nah","nope","dont","don't","cancel","not","n","नहीं","ना","नही","न","नो"];
      for (const w of noWords) if (t.includes(w)) return true;
      return false;
    }
  
    const affirmative = isAffirmative(prefResp);
    const negative = isNegative(prefResp);
  
    if (affirmative && !negative) {
      seatingPreferenceFromUser = (rec === 'outdoor') ? 'outdoor' : (rec === 'indoor' ? 'indoor' : rec || 'outdoor');
    } else if (negative && !affirmative) {
      seatingPreferenceFromUser = (rec === 'outdoor') ? 'indoor' : (rec === 'indoor' ? 'outdoor' : 'indoor');
    } else {
      // ambiguous/no answer — do not force; leave null so backend may apply default weather logic
      seatingPreferenceFromUser = null;
    }
  
    // Persist and show for debugging/visibility
    if (seatingPreferenceFromUser) {
      answers.seatingPreference = seatingPreferenceFromUser;
      onUpdate && onUpdate(`(seating preference set to ${seatingPreferenceFromUser})`, "agent");
      try { console.debug("[SEATING] user choice:", seatingPreferenceFromUser, "prefResp:", prefResp, "weatherRec:", rec); } catch(e) {}
    } else {
      onUpdate && onUpdate(`(seating preference: user did not choose explicitly)`, "agent");
      try { console.debug("[SEATING] user ambiguous; prefResp:", prefResp, "weatherRec:", rec); } catch(e) {}
    }
  }
  
  

      // Ask prompt, then listen (and possibly call NLP)
      onUpdate && onUpdate(q.prompt, "agent");
      await speak(q.prompt);
      let transcript = await listenOnce({ lang: userLocale });

      const shouldCallNLP = transcript && (
        transcript.split(/\s+/).length > 4 ||
        /book|reserve|tomorrow|tonight|for|at|people|guests|table|कितने|कल|आज|टेबिल|बुक/i.test(transcript)
      );

      if (shouldCallNLP) {
        onUpdate && onUpdate("(interpreting intent…)", "agent");
        const intent = await callNLP(transcript, userLocale);
        if (intent) {
          if (intent.bookingDate && !answers.bookingDate) answers.bookingDate = intent.bookingDate;
          if (intent.bookingTime && !answers.bookingTime) answers.bookingTime = intent.bookingTime;
          if ((intent.numberOfGuests || intent.numberOfGuests === 0) && !answers.numberOfGuests) answers.numberOfGuests = String(intent.numberOfGuests || intent.numberOfGuests === 0 ? intent.numberOfGuests : "");
          if (intent.cuisinePreference && !answers.cuisinePreference) answers.cuisinePreference = intent.cuisinePreference;
          if (intent.specialRequests && !answers.specialRequests) answers.specialRequests = intent.specialRequests;
          if (intent.seatingPreference && !seatingPreferenceFromUser) seatingPreferenceFromUser = intent.seatingPreference;

          onUpdate && onUpdate(`(interpreter) ${JSON.stringify(intent)}`, "agent");

          if (answers[q.key] && answers[q.key].length > 0) {
            onUpdate && onUpdate(answers[q.key], "user");
            transcript = answers[q.key];
          }
        }
      }

      if (!answers[q.key] || answers[q.key].length === 0) {
        if (!transcript) {
          const reprompt = userLocale.startsWith('hi') ? "मैंने नहीं सुना। कृपया फिर कहें। " + q.prompt : "I didn't catch that. " + q.prompt;
          onUpdate && onUpdate(reprompt, "agent");
          await speak(reprompt);
          transcript = await listenOnce({ lang: userLocale });
        }
        onUpdate && onUpdate(transcript || "", "user");
        answers[q.key] = transcript || "";
      }
    }

    if (stopRequested) {
      const stopMsg = userLocale.startsWith('hi') ? "सुनना बंद कर दिया गया।" : "Stopped listening.";
      onUpdate && onUpdate(stopMsg, "agent");
      await speak(stopMsg);
      running = false;
      return;
    }

    // normalize and payload
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
    if (special.toLowerCase().trim() === 'no' || special.toLowerCase().trim() === 'nahi') special = "";

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
      
      // prefer explicit user selection, fallback to answers store
      const chosenSeating = seatingPreferenceFromUser || answers.seatingPreference || null;
      if (chosenSeating) payload.seatingPreference = chosenSeating;
      

    // final confirm (localized)
    const confirmText = userLocale.startsWith('hi')
      ? `कन्फर्म कर रहा हूँ: ${payload.customerName}, ${payload.numberOfGuests} मेहमान, ${payload.bookingDate} को ${payload.bookingTime}। क्या मैं बुक कर दूँ? हाँ कहकर कन्फर्म करें।`
      : `Confirming: ${payload.customerName}, ${payload.numberOfGuests} guests, on ${payload.bookingDate} at ${payload.bookingTime}. Shall I book this? Say yes to confirm.`;

    onUpdate && onUpdate(confirmText, "agent");
    await speak(confirmText);

    const confirmResp = await speakThenListen(userLocale && userLocale.startsWith('hi') ? "कृपया हाँ कहें या नहीं कहें।" : "Please say yes to confirm or no to cancel.", userLocale);
    onUpdate && onUpdate(confirmResp || "", "user");
    
    // use same robust affirmative detection we already use elsewhere
    const confirmedFlag = isAffirmative(confirmResp);
    

    if (!confirmedFlag) {
      const msg = userLocale.startsWith('hi') ? "ठीक है, बुकिंग रद्द कर दी गई।" : "Okay, booking cancelled.";
      onUpdate && onUpdate(msg, "agent");
      await speak(msg);
      running = false;
      return;
    }

    onUpdate && onUpdate(userLocale.startsWith('hi') ? "आपकी बुकिंग सेव की जा रही है…" : "Saving your booking…", "agent");
    await speak(userLocale.startsWith('hi') ? "अब आपकी बुकिंग सेव कर रहा हूँ।" : "Saving your booking now.");

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
        await speak(userLocale.startsWith('hi') ? `मैं आपकी बुकिंग सेव नहीं कर पाया: ${errMsg}` : `I couldn't save your booking. ${errMsg}`);
      } else {
        const doneMsg = userLocale.startsWith('hi')
          ? `बुकिंग कन्फर्म हो गई। ${payload.customerName}, आपकी टेबल ${payload.bookingDate} को ${payload.bookingTime} पर बुक हो गई है।`
          : `Booking confirmed. ${payload.customerName}, your table is booked for ${payload.bookingDate} at ${payload.bookingTime}. Seating preferred: ${saved.seatingPreference || (saved.weatherInfo && saved.weatherInfo.seatingRecommendation) || "not available"}.`;
        onUpdate && onUpdate(doneMsg, "agent");
        await speak(doneMsg);
      }
    } catch (err) {
      console.error("Failed to post booking", err);
      onUpdate && onUpdate(userLocale.startsWith('hi') ? "नेटवर्क त्रुटि जबकि बुकिंग सेव हो रही थी।" : "Network error while saving booking.", "agent");
      await speak(userLocale.startsWith('hi') ? "नेटवर्क त्रुटि हुई।" : "Network error while saving booking.");
    }

    running = false;
  } catch (err) {
    console.error("Conversation error", err);
    onUpdate && onUpdate("Conversation error. Please try again.", "agent");
    await speak("Sorry, something went wrong. Please try again.");
    running = false;
  }
}
