// backend/routes/bookings.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const axios = require('axios');

// Notification libs (optional)
let twilioClient = null;
let nodemailer = null;
try {
  // require lazily so devs without install won't crash at load time
  twilioClient = require('twilio');
} catch (e) {
  // twilio not installed or not available
}
try {
  nodemailer = require('nodemailer');
} catch (e) {
  // nodemailer not installed or not available
}

const BACKEND_PORT = process.env.PORT || 4000;
const BACKEND_ORIGIN = `http://localhost:${BACKEND_PORT}`;

// Simple in-memory fallback store (non-persistent) used when MongoDB isn't connected.
const inMemoryBookings = [];

/**
 * Helper: check if mongoose is connected properly
 */
function dbIsConnected() {
  // readyState: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  return mongoose.connection && mongoose.connection.readyState === 1;
}

/**
 * Helpers: localization
 */
function pickLocaleFromReq(req) {
  // prefer explicit body.locale, then Accept-Language header
  const fromBody = req && req.body && req.body.locale;
  if (fromBody) return String(fromBody).toLowerCase();
  const al = req && req.headers && (req.headers['accept-language'] || req.headers['accept_language']);
  if (!al) return 'en';
  return String(al).split(',')[0].toLowerCase();
}
function t(locale, enText, hiText) {
  if (!locale) locale = 'en';
  return String(locale).startsWith('hi') ? (hiText || enText) : enText;
}

/**
 * Helper: fetch weather from our own weather route
 * Returns an object: { weatherInfo: <raw forecast/cur>, seatingPreference: 'indoor'|'outdoor' }
 */
async function fetchWeatherForDate(date, lat, lon) {
  try {
    const url = `${BACKEND_ORIGIN}/api/weather`;
    const resp = await axios.get(url, {
      params: { date, lat, lon },
      timeout: 5000
    });
    const data = resp.data;
    const seating = (data && (data.seatingRecommendation || data.seatingPreference)) ? (data.seatingRecommendation || data.seatingPreference) : 'indoor';
    return { weatherInfo: data, seatingPreference: seating };
  } catch (err) {
    console.warn('Failed to fetch weather for booking:', err?.response?.data || err.message || err);
    return { weatherInfo: null, seatingPreference: 'indoor' };
  }
}

/**
 * --- Notification helpers (Twilio + Vonage/Nexmo + SMTP + SendGrid + Ethereal fallback)
 *
 * These functions are tolerant: if credentials missing they just resolve(false) and log.
 */

/**
 * sendSms(to, text)
 * - tries Twilio if configured
 * - else tries Vonage (Nexmo) if configured
 * - else logs and returns false
 */
async function sendSms(to, text) {
  try {
    // 1) Twilio if configured
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const fromTw = process.env.TWILIO_FROM;
    if (sid && token && fromTw) {
      try {
        if (!twilioClient) twilioClient = require('twilio');
        const client = twilioClient(sid, token);
        const msg = await client.messages.create({ to, from: fromTw, body: text });
        console.log('SMS sent (Twilio):', msg.sid, 'to', to);
        return true;
      } catch (err) {
        console.error('Twilio send failed:', err && err.message ? err.message : err);
        // continue to fallback
      }
    }

    // 2) Vonage / Nexmo fallback if configured
    const vonageKey = process.env.VONAGE_API_KEY || process.env.NEXMO_API_KEY;
    const vonageSecret = process.env.VONAGE_API_SECRET || process.env.NEXMO_API_SECRET;
    const vonageFrom = process.env.VONAGE_FROM;
    if (vonageKey && vonageSecret && vonageFrom) {
      try {
        // Vonage SMS endpoint accepts form params as GET or POST
        const params = new URLSearchParams();
        params.append('api_key', vonageKey);
        params.append('api_secret', vonageSecret);
        params.append('to', to);
        params.append('from', vonageFrom);
        params.append('text', text);

        const resp = await axios.post('https://rest.nexmo.com/sms/json', params.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 7000
        });
        const d = resp.data;
        if (d && d.messages && d.messages[0] && (d.messages[0].status === '0' || d.messages[0].status === 0)) {
          console.log('SMS sent (Vonage):', d.messages[0]['message-id'], 'to', to);
          return true;
        } else {
          console.error('Vonage send error', d);
        }
      } catch (err) {
        console.error('Vonage send failed:', err && err.message ? err.message : err);
      }
    }

    console.log('No SMS provider configured or all providers failed; skipping SMS send.');
    return false;
  } catch (err) {
    console.error('Unexpected sendSms error', err);
    return false;
  }
}

/**
 * Email helpers:
 * - getSmtpTransport() returns nodemailer transport when SMTP env provided
 * - sendEmail() tries SMTP -> SendGrid -> Ethereal (nodemailer.createTestAccount)
 */
let _smtpTransport = null;
function getSmtpTransport() {
  if (_smtpTransport) return _smtpTransport;
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT && Number(process.env.SMTP_PORT);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !port || !user || !pass || !nodemailer) {
    return null;
  }
  _smtpTransport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for other ports
    auth: { user, pass }
  });
  return _smtpTransport;
}

async function sendEmail(toEmail, subject, htmlText, plainText) {
  try {
    // 1) SMTP via nodemailer if configured
    let transport = getSmtpTransport();
    let usingEthereal = false;

    if (transport) {
      try {
        const from = process.env.EMAIL_FROM || process.env.SMTP_USER;
        const info = await transport.sendMail({
          from,
          to: toEmail,
          subject,
          text: plainText || htmlText,
          html: htmlText
        });
        console.log('Email sent (SMTP):', info.messageId, 'to', toEmail);
        return true;
      } catch (err) {
        console.error('SMTP send failed:', err && err.message ? err.message : err);
        // continue to next fallback
      }
    }

    // 2) SendGrid fallback if API key present
    const sendgridApiKey = process.env.SENDGRID_API_KEY;
    if (sendgridApiKey) {
      try {
        const payload = {
          personalizations: [{ to: [{ email: toEmail }] }],
          from: { email: process.env.EMAIL_FROM || (process.env.SMTP_USER || 'no-reply@example.com') },
          subject,
          content: [
            { type: 'text/plain', value: plainText || (htmlText ? htmlText.replace(/<[^>]*>/g, '') : '') },
            { type: 'text/html', value: htmlText }
          ]
        };
        const r = await axios.post('https://api.sendgrid.com/v3/mail/send', payload, {
          headers: { Authorization: `Bearer ${sendgridApiKey}`, 'Content-Type': 'application/json' },
          timeout: 8000
        });
        if (r.status >= 200 && r.status < 300) {
          console.log('Email sent (SendGrid) to', toEmail);
          return true;
        }
      } catch (err) {
        console.error('SendGrid send failed:', err && (err.response && err.response.data) ? err.response.data : err.message || err);
      }
    }

    // 3) Ethereal test account fallback (nodemailer)
    if (nodemailer) {
      try {
        const testAcct = await nodemailer.createTestAccount();
        const testTransport = nodemailer.createTransport({
          host: testAcct.smtp.host,
          port: testAcct.smtp.port,
          secure: testAcct.smtp.secure,
          auth: { user: testAcct.user, pass: testAcct.pass }
        });
        const from = process.env.EMAIL_FROM || testAcct.user;
        const info = await testTransport.sendMail({
          from,
          to: toEmail,
          subject,
          text: plainText || htmlText,
          html: htmlText
        });
        console.log('Email sent (Ethereal):', info.messageId, 'to', toEmail);
        console.log('Ethereal preview URL:', nodemailer.getTestMessageUrl(info));
        usingEthereal = true;
        return true;
      } catch (err) {
        console.error('Ethereal send failed:', err && err.message ? err.message : err);
      }
    }

    console.log('No email provider configured or all providers failed; skipping email send.');
    return false;
  } catch (err) {
    console.error('Unexpected sendEmail error', err);
    return false;
  }
}

/**
 * GET /api/bookings
 */
router.get('/', async (req, res) => {
  try {
    if (dbIsConnected()) {
      const bookings = await Booking.find().sort({ createdAt: -1 });
      return res.json(bookings);
    } else {
      // Return in-memory bookings (reverse chronological)
      return res.json(inMemoryBookings.slice().reverse());
    }
  } catch (err) {
    console.error('Error fetching bookings', err);
    return res.status(500).json({ error: 'Server error fetching bookings' });
  }
});

/**
 * GET /api/bookings/slots
 */
router.get('/slots', async (req, res) => {
  try {
    const date = req.query.date;
    if (!date) return res.status(400).json({ error: 'Missing required query param: date (YYYY-MM-DD)' });

    const openTime = req.query.open || '11:00';
    const closeTime = req.query.close || '22:00';
    const duration = parseInt(req.query.duration || '30', 10);

    function buildSlots(openHHMM, closeHHMM, minutes) {
      const [oh, om] = openHHMM.split(':').map(s => parseInt(s, 10));
      const [ch, cm] = closeHHMM.split(':').map(s => parseInt(s, 10));
      const start = new Date(0, 0, 0, oh, om, 0, 0);
      const end = new Date(0, 0, 0, ch, cm, 0, 0);

      const slots = [];
      const cur = new Date(start);
      while (cur <= end) {
        const hh = String(cur.getHours()).padStart(2, '0');
        const mm = String(cur.getMinutes()).padStart(2, '0');
        slots.push(`${hh}:${mm}`);
        cur.setMinutes(cur.getMinutes() + minutes);
      }
      return slots;
    }

    const allSlots = buildSlots(openTime, closeTime, duration);

    let taken = [];
    if (dbIsConnected()) {
      const bookings = await Booking.find({ bookingDate: date });
      taken = bookings.map(b => (b.bookingTime || '').slice(0,5)).filter(Boolean);
    } else {
      taken = inMemoryBookings.filter(b => b.bookingDate === date).map(b => (b.bookingTime || '').slice(0,5)).filter(Boolean);
    }
    taken = Array.from(new Set(taken));
    const available = allSlots.filter(s => !taken.includes(s));

    return res.json({
      date,
      open: openTime,
      close: closeTime,
      duration,
      slots: allSlots,
      taken,
      available
    });
  } catch (err) {
    console.error('Error computing slots', err);
    return res.status(500).json({ error: 'Server error computing slots' });
  }
});

/**
 * GET /api/bookings/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (dbIsConnected()) {
      const booking = await Booking.findOne({ bookingId: id });
      if (!booking) return res.status(404).json({ error: 'Not found' });
      return res.json(booking);
    } else {
      const booking = inMemoryBookings.find(b => b.bookingId === id);
      if (!booking) return res.status(404).json({ error: 'Not found (in-memory)' });
      return res.json(booking);
    }
  } catch (err) {
    console.error('Error fetching booking', err);
    return res.status(500).json({ error: 'Server error fetching booking' });
  }
});

/**
 * POST /api/bookings
 * Create a booking. Minimal validation + weather fetch + notification dispatch
 */
router.post('/', async (req, res) => {
  try {
    const {
      bookingId,
      customerName,
      numberOfGuests,
      bookingDate,
      bookingTime,
      cuisinePreference,
      specialRequests,
      lat,
      lon,
      phone,        // optional: client may pass phone/email
      email
    } = req.body;

    const locale = pickLocaleFromReq(req);
    console.log('[BOOKINGS][RECEIVED PAYLOAD]', JSON.stringify(req.body), 'locale=', locale);

    if (!bookingId || !customerName || !numberOfGuests || !bookingDate || !bookingTime) {
      const errMsg = t(locale,
        'Missing required fields: bookingId, customerName, numberOfGuests, bookingDate, bookingTime',
        'आवश्यक फ़ील्ड गायब हैं: bookingId, customerName, numberOfGuests, bookingDate, bookingTime'
      );
      return res.status(400).json({ error: 'Missing required fields', message: errMsg });
    }

    // conflict check
    if (dbIsConnected()) {
      const existingAtSlot = await Booking.findOne({
        bookingDate: bookingDate,
        bookingTime: bookingTime
      });
      if (existingAtSlot) {
        const msg = t(locale,
          `There is already a booking at ${bookingDate} ${bookingTime}. Please choose a different time or date.`,
          `इस समय पर (${bookingDate} ${bookingTime}) पहले से ही बुकिंग है। कृपया अलग समय या तारीख चुनें।`
        );
        return res.status(409).json({
          error: 'Time slot unavailable',
          message: msg
        });
      }
    } else {
      const inMemConflict = inMemoryBookings.some(b => b.bookingDate === bookingDate && b.bookingTime === bookingTime);
      if (inMemConflict) {
        const msg = t(locale,
          `There is already a booking at ${bookingDate} ${bookingTime} (in-memory). Please choose another time or date.`,
          `इस समय पर (${bookingDate} ${bookingTime}) पहले से ही बुकिंग है (in-memory)। कृपया अलग समय या तारीख चुनें।`
        );
        return res.status(409).json({
          error: 'Time slot unavailable',
          message: msg
        });
      }
    }

    // Fetch weather
    const { weatherInfo, seatingPreference: weatherSeating } = await fetchWeatherForDate(bookingDate, lat, lon);

    // final seating preference
    let clientSeating = null;
    if (req.body && req.body.seatingPreference && String(req.body.seatingPreference).trim() !== "") {
      clientSeating = String(req.body.seatingPreference).trim().toLowerCase();
    }
    const finalSeatingPreference = clientSeating || (weatherSeating ? String(weatherSeating).trim().toLowerCase() : null);

    if (dbIsConnected()) {
      const existing = await Booking.findOne({ bookingId });
      if (existing) {
        const msg = t(locale, 'bookingId already exists', 'bookingId पहले से मौजूद है');
        return res.status(400).json({ error: 'bookingId exists', message: msg });
      }

      const booking = new Booking({
        bookingId,
        customerName,
        numberOfGuests,
        bookingDate,
        bookingTime,
        cuisinePreference,
        specialRequests,
        weatherInfo,
        seatingPreference: finalSeatingPreference,
        status: 'confirmed'
      });

      await booking.save();

      // After successful save: attempt notification(s) asynchronously (do not fail the request on notification errors)
      (async () => {
        try {
          const shortMsg = `Booking confirmed for ${customerName} on ${bookingDate} at ${bookingTime}. Seating: ${finalSeatingPreference || 'not specified'}.`;
          const hiMsg = `${customerName} के लिए ${bookingDate} को ${bookingTime} पर बुकिंग कन्फर्म हुई। सीटिंग: ${finalSeatingPreference || 'निर्धारित नहीं'}.`;

          // SMS if phone provided and Twilio/Vonage configured
          if (req.body.phone) {
            const phoneOk = await sendSms(req.body.phone, locale && String(locale).startsWith('hi') ? hiMsg : shortMsg);
            console.log('SMS send attempted:', phoneOk);
          }

          // Email if email provided and SMTP/SendGrid configured or Ethereal fallback
          if (req.body.email) {
            const subject = locale && String(locale).startsWith('hi') ? `बुकिंग कन्फर्मेशन - ${bookingId}` : `Booking confirmation - ${bookingId}`;
            const html = `<p>${locale && String(locale).startsWith('hi') ? hiMsg : shortMsg}</p>
                          <p>Booking ID: ${bookingId}</p>
                          <p>Date: ${bookingDate} at ${bookingTime}</p>
                          <p>Guests: ${numberOfGuests}</p>`;
            const emailOk = await sendEmail(req.body.email, subject, html, `${shortMsg}\nBooking ID: ${bookingId}`);
            console.log('Email send attempted for', req.body.email, emailOk);
          }
        } catch (e) {
          console.error('Notification attempt failed (post-save)', e);
        }
      })();

      const successMsg = t(locale,
        `Booking created for ${customerName} on ${bookingDate} at ${bookingTime}.`,
        `${customerName} के लिए ${bookingDate} को ${bookingTime} पर बुकिंग बनाई गई।`
      );
      return res.status(201).json({ ...booking.toObject(), message: successMsg });
    } else {
      // in-memory store
      if (inMemoryBookings.some(b => b.bookingId === bookingId)) {
        const msg = t(locale, 'bookingId already exists (in-memory)', 'bookingId पहले से मौजूद है (in-memory)');
        return res.status(400).json({ error: 'bookingId exists (in-memory)', message: msg });
      }
      const booking = {
        bookingId,
        customerName,
        numberOfGuests,
        bookingDate,
        bookingTime,
        cuisinePreference,
        specialRequests,
        weatherInfo: weatherInfo || null,
        seatingPreference: finalSeatingPreference || 'unknown',
        status: 'confirmed',
        createdAt: new Date().toISOString()
      };
      inMemoryBookings.push(booking);

      // Try notifications (async)
      (async () => {
        try {
          const shortMsg = `Booking confirmed for ${customerName} on ${bookingDate} at ${bookingTime}. Seating: ${finalSeatingPreference || 'not specified'}.`;
          const hiMsg = `${customerName} के लिए ${bookingDate} को ${bookingTime} पर बुकिंग कन्फर्म हुई। सीटिंग: ${finalSeatingPreference || 'निर्धारित नहीं'}.`;

          if (req.body.phone) {
            await sendSms(req.body.phone, locale && String(locale).startsWith('hi') ? hiMsg : shortMsg);
          }
          if (req.body.email) {
            const subject = locale && String(locale).startsWith('hi') ? `बुकिंग कन्फर्मेशन - ${bookingId}` : `Booking confirmation - ${bookingId}`;
            const html = `<p>${locale && String(locale).startsWith('hi') ? hiMsg : shortMsg}</p>
                          <p>Booking ID: ${bookingId}</p>
                          <p>Date: ${bookingDate} at ${bookingTime}</p>
                          <p>Guests: ${numberOfGuests}</p>`;
            await sendEmail(req.body.email, subject, html, `${shortMsg}\nBooking ID: ${bookingId}`);
          }
        } catch (e) {
          console.error('Notification attempt (in-memory) failed', e);
        }
      })();

      const successMsg = t(locale,
        `Booking created for ${customerName} on ${bookingDate} at ${bookingTime}.`,
        `${customerName} के लिए ${bookingDate} को ${bookingTime} पर बुकिंग बनाए गई।`
      );
      return res.status(201).json({ ...booking, message: successMsg });
    }
  } catch (err) {
    console.error('Error creating booking', err);
    return res.status(500).json({ error: 'Server error creating booking' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (dbIsConnected()) {
      const deleted = await Booking.findOneAndDelete({ bookingId: id });
      if (!deleted) return res.status(404).json({ error: 'Not found' });
      return res.json({ success: true });
    } else {
      const idx = inMemoryBookings.findIndex(b => b.bookingId === id);
      if (idx === -1) return res.status(404).json({ error: 'Not found (in-memory)' });
      inMemoryBookings.splice(idx, 1);
      return res.json({ success: true });
    }
  } catch (err) {
    console.error('Error deleting booking', err);
    return res.status(500).json({ error: 'Server error deleting booking' });
  }
});

module.exports = router;
