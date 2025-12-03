// frontend/src/voice.js
// Full voice helper with locale support, TTS selection, Hindi handling,
// NLP call, weather suggestion, and voice-driven slot fallback on conflicts.
// Exports: startConversation(onUpdate, options), stopConversation(), speak(text)

let running = false;
let stopRequested = false;
let ttsLang = 'en-IN'; // updated by startConversation

// ---------- TTS utils ----------
function chooseBestVoice(preferredLang) {
  const voices = window.speechSynthesis.getVoices() || [];
  if (!voices.length) return null;

  const langPriority = [];
  if (preferredLang) {
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
          try { ut.lang = ttsLang; } catch (e) { /* ignore */ }
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

  // Replace Devanagari digits
  const devanagariDigits = { '०':'0','१':'1','२':'2','३':'3','४':'4','५':'5','६':'6','७':'7','८':'8','९':'9' };
  let normalized = orig.replace(/[\u0966-\u096F]/g, (d) => devanagariDigits[d] || d);

  const digitsMatch = normalized.match(/\d+/);
  if (digitsMatch) return parseInt(digitsMatch[0], 10);

  const engSmall = {
    zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10,
    eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19,
    twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90, hundred:100
  };

  const hinSmall = {
    'शून्य':0,'शुन्य':0,'एक':1,'दो':2,'दोण':2,'तीन':3,'चार':4,'पांच':5,'छह':6,'सात':7,'आठ':8,'नौ':9,'दस':10,
    'ग्यारह':11,'बारह':12,'तेरह':13,'चौदह':14,'पंद्रह':15,'सोलह':16,'सत्रह':17,'अठारह':18,'उन्नीस':19,
    'बीस':20,'तीस':30,'चालीस':40,'पचास':50,'साठ':60,'सत्तर':70,'अस्सी':80,'नब्बे':90,'सौ':100
  };

  const t = normalized.toLowerCase().replace(/[,\;]/g,' ').replace(/[^0-9a-z\u0900-\u097F\s\-]/g,' ').trim();
  const parts = t.split(/\s+/).filter(Boolean);

  let total = 0; let seen = false;
  for (let i=0;i<parts.length;i++){
    const w = parts[i];
    if (engSmall[w] !== undefined) {
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

  for (const p of parts) {
    if (engSmall[p] !== undefined) return engSmall[p];
    if (hinSmall[p] !== undefined) return hinSmall[p];
  }

  return null;
}

// Enhanced parseDateText (supports common English/Hindi forms)
function parseDateText(text) {
  if (!text) return null;
  const raw = String(text).trim();
  const t0 = raw.toLowerCase();
  if (!t0) return null;
  if (t0.includes("today") || t0.includes("आज")) return new Date();
  if (t0.includes("tomorrow") || t0.includes("कल")) {
    const d = new Date(); d.setDate(d.getDate() + 1); return d;
  }

  let normalized = raw.replace(/(\d+)(st|nd|rd|th)/gi, "$1");
  normalized = normalized.replace(/[,]/g, " ");

  const months = {
    january:0, february:1, march:2, april:3, may:4, june:5,
    july:6, august:7, september:8, october:9, november:10, december:11,
    jan:0, feb:1, mar:2, apr:3, jun:5, jul:6, aug:7, sep:8, sept:8, oct:9, nov:10, dec:11
  };
  const hindiMonths = {
    'जनवरी':0,'फरवरी':1,'मार्च':2,'अप्रैल':3,'मई':4,'जून':5,'जुलाई':6,'अगस्त':7,'सितंबर':8,'अक्टूबर':9,'नवंबर':10,'दिसंबर':11,
    'जन':0,'फर':1,'मार्च':2,'अप्रै':3,'जून':5,'जुल':6,'अग':7,'सित':8,'अक्ट':9,'नव':10,'दिस':11
  };

  const numericIso = normalized.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (numericIso) {
    const year = parseInt(numericIso[1], 10);
    const month = parseInt(numericIso[2], 10) - 1;
    const day = parseInt(numericIso[3], 10);
    const d = new Date(year, month, day);
    if (!isNaN(d)) return d;
  }
  const numericDMY = normalized.match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (numericDMY) {
    const day = parseInt(numericDMY[1], 10);
    const month = parseInt(numericDMY[2], 10) - 1;
    const year = parseInt(numericDMY[3], 10);
    const d = new Date(year, month, day);
    if (!isNaN(d)) return d;
  }
  const numericDM = normalized.match(/(\d{1,2})[-\/](\d{1,2})$/);
  if (numericDM) {
    const day = parseInt(numericDM[1], 10);
    const month = parseInt(numericDM[2], 10) - 1;
    const year = new Date().getFullYear();
    const d = new Date(year, month, day);
    if (!isNaN(d)) return d;
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  function findMonthIndex(parts) {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i].toLowerCase();
      if (months[p] !== undefined) return { idx: i, month: months[p] };
      if (hindiMonths[p] !== undefined) return { idx: i, month: hindiMonths[p] };
      for (const m of Object.keys(months)) if (p.includes(m)) return { idx: i, month: months[m] };
      for (const hm of Object.keys(hindiMonths)) if (p.includes(hm)) return { idx: i, month: hindiMonths[hm] };
    }
    return null;
  }

  const found = findMonthIndex(parts);
  if (found) {
    const { idx, month } = found;
    let day = null, year = null;
    if (idx > 0) {
      const left = parts[idx - 1].replace(/[^\d]/g, "");
      if (left && /^[0-9]{1,2}$/.test(left)) day = parseInt(left, 10);
    }
    if (idx < parts.length - 1) {
      const right = parts[idx + 1].replace(/[^\d]/g, "");
      if (right && /^[0-9]{1,2}$/.test(right) && !day) day = parseInt(right, 10);
      if (right && /^[0-9]{4}$/.test(right)) year = parseInt(right, 10);
    }
    for (const p of parts) {
      const y = p.match(/(20\d{2})/);
      if (y) { year = parseInt(y[1], 10); break; }
    }
    if (!day) day = 1;
    if (!year) year = new Date().getFullYear();
    const d = new Date(year, month, day);
    if (!isNaN(d)) return d;
  }

  const singleDay = normalized.match(/(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s|$)/i);
  if (singleDay) {
    const day = parseInt(singleDay[1], 10);
    const now = new Date();
    const cand = new Date(now.getFullYear(), now.getMonth(), day);
    if (cand < now) {
      const next = new Date(now.getFullYear(), now.getMonth() + 1, day);
      return next;
    }
    return cand;
  }

  const parsed = Date.parse(normalized);
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
    if (j && j.intent) return j.intent;
    return null;
  } catch (err) {
    console.warn('NLP call error', err);
    return null;
  }
}

// ---------- Weather helper ----------
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

// ---------- Affirmative / Negative detection ----------
function isAffirmative(text) {
  if (!text) return false;
  const t = String(text).toLowerCase().trim();
  const norm = t.replace(/हाँ/g, 'haan').replace(/हां/g, 'haan').replace(/हूँ/g,'hun');
  const yesWords = ["yes","yeah","yep","sure","ok","okay","confirm","affirmative","please do","do it","i do","i'd like","haan","haan ji","हाँ","हां","ठीक","ठीक है","बिलकुल","हां","हॅं"];
  for (const w of yesWords) if (norm.includes(w) || t.includes(w)) return true;
  if (/^\s*y[ae]s?\b/.test(t)) return true;
  return false;
}

// ---------- Slots API helper (used when conflict occurs) ----------
async function fetchSlotsForDateAPI(date) {
  try {
    const r = await fetch(`http://localhost:4000/api/bookings/slots?date=${encodeURIComponent(date)}`);
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    console.error("Failed to fetch slots", e);
    return null;
  }
}

async function askUserToPickSlot(offeredSlots, userLocale) {
  if (!offeredSlots || offeredSlots.length === 0) return null;

  // Build spoken list (human-friendly)
  const humanSlots = offeredSlots.map(s => {
    const [hh, mm] = s.split(':').map(Number);
    if ((userLocale || '').startsWith('hi')) {
      // keep 24-hour in Hindi (recognizer will handle)
      return s;
    } else {
      const h12 = (hh % 12) === 0 ? 12 : hh % 12;
      const ampm = hh >= 12 ? "PM" : "AM";
      return `${h12}:${String(mm).padStart(2,'0')} ${ampm}`;
    }
  });

  const speakText = (userLocale || '').startsWith('hi')
    ? `मैं ${offeredSlots.join(', ')} में से उपलब्ध कर सकता हूँ। कौन सा समय चाहेंगे?`
    : `I can do ${humanSlots.join(', ').replace(/, ([^,]*)$/, ' or $1')}. Which one would you like?`;

  // Ask
  await speak(speakText);
  const pickResp = await listenOnce({ lang: userLocale });
  if (!pickResp) return null;

  // Try time parse
  const parsed = parseTimeText(pickResp);
  if (parsed) {
    const norm = parsed.slice(0,5);
    if (offeredSlots.includes(norm)) return norm;
    const hourOnly = norm.split(":")[0];
    const foundByHour = offeredSlots.find(s => s.split(":")[0] === hourOnly);
    if (foundByHour) return foundByHour;
  }

  const lower = (pickResp || "").toLowerCase();
  if (lower.match(/\b(first|1st|one|पहला|पहले)\b/)) return offeredSlots[0] || null;
  if (lower.match(/\b(second|2nd|two|दूसरा|दूसरे)\b/)) return offeredSlots[1] || null;
  if (lower.match(/\b(third|3rd|three|तीसरा|तीसरे)\b/)) return offeredSlots[2] || null;

  for (const s of offeredSlots) {
    if (pickResp.includes(s) || pickResp.includes(s.replace(':', ''))) return s;
    const hour = String(Number(s.split(':')[0]) % 12);
    if (pickResp.includes(hour)) return s;
  }

  return null;
}

// ---------- Main conversation flow ----------
export async function startConversation(onUpdate, options = {}) {
  const userLocale = (options && options.locale) ? options.locale : 'en-IN';
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

      // Before bookingTime: check weather and ask seating preference
      if (q.key === 'bookingTime') {
        const rawDateText = answers.bookingDate || "";
        const parsedDate = parseDateText(rawDateText) || new Date();
        const dateYMD = formatDateYMD(parsedDate);

        onUpdate && onUpdate(`Checking weather for ${dateYMD}…`, "agent");
        const weatherResp = await fetchWeatherSuggestion(dateYMD);
        let suggestionText = "";
        let rec = '';

        if (weatherResp.ok && weatherResp.data) {
          const w = weatherResp.data;
          rec = (w.seatingRecommendation || w.seatingPreference || '').toLowerCase();
          const summary = w.weatherSummary || "";
          if (rec === 'outdoor') {
            suggestionText = userLocale.startsWith('hi') ? `उस तारीख ${dateYMD} का मौसम अच्छा है! क्या आप outdoor seating चुनना चाहेंगे?` : `The weather looks great on ${dateYMD}! Would you prefer outdoor seating?`;
          } else if (rec === 'indoor') {
            suggestionText = userLocale.startsWith('hi') ? `संभावना है कि बारिश होगी ${dateYMD}। मैं इनडोर सीटिंग की सलाह दूँगा। क्या आप चाहेंगे?` : `It might rain on ${dateYMD}. I'd recommend our cozy indoor area. Would you like that?`;
          } else {
            suggestionText = userLocale.startsWith('hi') ? `मैंने ${dateYMD} का मौसम देखा: ${summary || 'पूर्वानुमान उपलब्ध नहीं'}. क्या आप outdoor seating चाहेंगे?` : `I checked the weather for ${dateYMD}: ${summary || 'forecast not available'}. Would you prefer outdoor seating?`;
            rec = 'outdoor';
          }
        } else {
          suggestionText = userLocale.startsWith('hi') ? `मैं ${dateYMD} के लिए पूर्वानुमान नहीं ला पाया। क्या आप डिफ़ॉल्ट रूप से इनडोर चाहेंगे?` : `I couldn't fetch the forecast for ${dateYMD}. Would you prefer indoor seating by default?`;
          rec = 'indoor';
        }

        onUpdate && onUpdate(suggestionText, "agent");
        await speak(suggestionText);
        const prefResp = await listenOnce({ lang: userLocale });
        onUpdate && onUpdate(prefResp || "", "user");

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
          seatingPreferenceFromUser = null; // ambiguous -> backend decides
        }

        if (seatingPreferenceFromUser) {
          answers.seatingPreference = seatingPreferenceFromUser;
          onUpdate && onUpdate(`(seating preference set to ${seatingPreferenceFromUser})`, "agent");
        } else {
          onUpdate && onUpdate(`(seating preference: user did not choose explicitly)`, "agent");
        }
      }

      // Ask the main prompt and listen
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

    // Normalize and build payload
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

    // include locale so backend can return localized messages
    payload.locale = userLocale;

    // prefer explicit user selection (seatingPreferenceFromUser), else interpreter/answers
    const chosenSeating = seatingPreferenceFromUser || answers.seatingPreference || null;
    if (chosenSeating) payload.seatingPreference = chosenSeating;

    // Confirm (localized)
    const confirmText = userLocale.startsWith('hi')
      ? `कन्फर्म कर रहा हूँ: ${payload.customerName}, ${payload.numberOfGuests} मेहमान, ${payload.bookingDate} को ${payload.bookingTime}। क्या मैं बुक कर दूँ? हाँ कहकर कन्फर्म करें।`
      : `Confirming: ${payload.customerName}, ${payload.numberOfGuests} guests, on ${payload.bookingDate} at ${payload.bookingTime}. Shall I book this? Say yes to confirm.`;

    onUpdate && onUpdate(confirmText, "agent");
    await speak(confirmText);

    const confirmResp = await speakThenListen(userLocale && userLocale.startsWith('hi') ? "कृपया हाँ कहें या नहीं कहें।" : "Please say yes to confirm or no to cancel.", userLocale);
    onUpdate && onUpdate(confirmResp || "", "user");

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

    // --- Save booking with voice-driven slot fallback on 409 ---
    let resp, saved;
    try {
      resp = await fetch("http://localhost:4000/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      saved = await resp.json();
    } catch (err) {
      console.error("Failed to post booking", err);
      onUpdate && onUpdate(userLocale.startsWith('hi') ? "नेटवर्क त्रुटि जबकि बुकिंग सेव हो रही थी।" : "Network error while saving booking.", "agent");
      await speak(userLocale.startsWith('hi') ? "नेटवर्क त्रुटि हुई।" : "Network error while saving booking.");
      running = false;
      return;
    }

    if (resp.ok) {
      const doneMsg = userLocale.startsWith('hi')
        ? `बुकिंग कन्फर्म हो गई। ${payload.customerName}, आपकी टेबल ${payload.bookingDate} को ${payload.bookingTime} पर बुक हो गई है।`
        : `Booking confirmed. ${payload.customerName}, your table is booked for ${payload.bookingDate} at ${payload.bookingTime}. Seating preferred: ${saved.seatingPreference || (saved.weatherInfo && saved.weatherInfo.seatingRecommendation) || "not available"}.`;
      onUpdate && onUpdate(doneMsg, "agent");
      await speak(doneMsg);
      running = false;
      return;
    }

    // Handle 409 conflict: offer voice alternatives
    if (resp.status === 409) {
      try {
        const slotsData = await fetchSlotsForDateAPI(payload.bookingDate);
        if (slotsData && slotsData.available && slotsData.available.length > 0) {
          const alternatives = slotsData.available.filter(s => s !== payload.bookingTime).slice(0, 3);
          if (alternatives.length === 0) {
            const msg = userLocale.startsWith('hi')
              ? `माफ़ कीजिए, उस तारीख पर कोई वैकल्पिक स्लॉट उपलब्ध नहीं है।`
              : `Sorry, no alternative slots available on that date. Please try another date or use the slot picker.`;
            onUpdate && onUpdate(msg, "agent");
            await speak(msg);
            running = false;
            return;
          }

          const offerText = userLocale.startsWith('hi')
            ? `माँगा हुआ समय उपलब्ध नहीं है। मैं ये समय दे सकता हूँ: ${alternatives.join(', ')}. कौन सा चाहेंगे?`
            : `The requested time is unavailable. I can offer: ${alternatives.join(', ')}. Which one would you like?`;

          onUpdate && onUpdate(offerText, "agent");
          await speak(offerText);

          const chosen = await askUserToPickSlot(alternatives, userLocale);
          if (!chosen) {
            const fallbackMsg = userLocale.startsWith('hi')
              ? `मैं वैध विकल्प नहीं समझ पाया। कृपया स्लॉट पिकर का उपयोग करें या फिर से प्रयास करें।`
              : `I didn't catch a valid alternative. Please choose a time using the slot picker or try again.`;
            onUpdate && onUpdate(fallbackMsg, "agent");
            await speak(fallbackMsg);
            running = false;
            return;
          }

          // retry with chosen slot
          payload.bookingTime = chosen;
          onUpdate && onUpdate(`Trying to book ${chosen} now…`, "agent");
          await speak(userLocale.startsWith('hi') ? `अब ${chosen} पर बुक करने की कोशिश कर रहा हूँ।` : `Trying to book ${chosen} now.`);

          try {
            const resp2 = await fetch("http://localhost:4000/api/bookings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });
            const saved2 = await resp2.json();
            if (resp2.ok) {
              const doneMsg2 = userLocale.startsWith('hi')
                ? `बुकिंग कन्फर्म हो गई। ${payload.customerName}, आपकी टेबल ${payload.bookingDate} को ${payload.bookingTime} पर बुक हो गई है।`
                : `Booking confirmed. ${payload.customerName}, your table is booked for ${payload.bookingDate} at ${payload.bookingTime}. Seating preferred: ${saved2.seatingPreference || (saved2.weatherInfo && saved2.weatherInfo.seatingRecommendation) || "not available"}.`;
              onUpdate && onUpdate(doneMsg2, "agent");
              await speak(doneMsg2);
              running = false;
              return;
            } else {
              const secondFailMsg = userLocale.startsWith('hi')
                ? `क्षमा करें, वह स्लॉट अभी-अभी लिया गया। कृपया स्लॉट पिकर से कोई अन्य समय चुनें।`
                : `Sorry, that slot just got taken as well. Please choose another time using the slot picker.`;
              onUpdate && onUpdate(secondFailMsg, "agent");
              await speak(secondFailMsg);
              running = false;
              return;
            }
          } catch (err) {
            console.error("Failed to post second booking attempt", err);
            onUpdate && onUpdate(userLocale.startsWith('hi') ? "पुनः प्रयास करते समय नेटवर्क त्रुटि।" : "Network error while saving booking on retry.", "agent");
            await speak(userLocale.startsWith('hi') ? "नेटवर्क त्रुटि हुई।" : "Network error while saving booking on retry.");
            running = false;
            return;
          }
        } else {
          const noneMsg = userLocale.startsWith('hi')
            ? `उस तारीख पर कोई वैकल्पिक स्लॉट उपलब्ध नहीं है। कृपया अलग तारीख आज़माएँ।`
            : `No alternate slots available on that date. Please try another date.`;
          onUpdate && onUpdate(noneMsg, "agent");
          await speak(noneMsg);
          running = false;
          return;
        }
      } catch (e) {
        console.error("Error handling conflict", e);
        onUpdate && onUpdate(userLocale.startsWith('hi') ? "वैकल्पिक स्लॉट खोजते समय त्रुटि।" : "Error while trying to find alternate slots. Please try again.", "agent");
        await speak(userLocale.startsWith('hi') ? "त्रुटि हुई। कृपया पुनः प्रयास करें।" : "Error while trying to find alternate slots. Please try again.");
        running = false;
        return;
      }
    }

    // Non-409 error handling
    const errMsg = saved && (saved.message || saved.error) ? (saved.message || saved.error) : (userLocale.startsWith('hi') ? "बुकिंग सेव करने में विफल" : "Failed to save booking");
    onUpdate && onUpdate(`Error: ${errMsg}`, "agent");
    await speak(userLocale.startsWith('hi') ? `मैं आपकी बुकिंग सेव नहीं कर पाया: ${errMsg}` : `I couldn't save your booking. ${errMsg}`);
    running = false;
  } catch (err) {
    console.error("Conversation error", err);
    onUpdate && onUpdate("Conversation error. Please try again.", "agent");
    await speak("Sorry, something went wrong. Please try again.");
    running = false;
  }
}
