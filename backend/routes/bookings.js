// backend/routes/bookings.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const axios = require('axios');

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
    // Expect data.seatingRecommendation and data.forecast (or forecast.current)
    // Default to 'indoor' if the provider does not give a recommendation
    const seating = (data && (data.seatingRecommendation || data.seatingPreference)) ? (data.seatingRecommendation || data.seatingPreference) : 'indoor';
    return { weatherInfo: data, seatingPreference: seating };
  } catch (err) {
    console.warn('Failed to fetch weather for booking:', err?.response?.data || err.message || err);
    // safe defaults when weather fetch fails
    return { weatherInfo: null, seatingPreference: 'indoor' };
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
 * Query params:
 *   date (required) - YYYY-MM-DD
 *   open (optional) - opening time HH:MM (default 11:00)
 *   close (optional) - closing time HH:MM (default 22:00)
 *   duration (optional) - slot duration in minutes (default 30)
 *
 * Returns available and taken slots for the date.
 */
router.get('/slots', async (req, res) => {
  try {
    const date = req.query.date;
    if (!date) return res.status(400).json({ error: 'Missing required query param: date (YYYY-MM-DD)' });

    // parse optional params
    const openTime = req.query.open || '11:00';
    const closeTime = req.query.close || '22:00';
    const duration = parseInt(req.query.duration || '30', 10);

    // Helper: build array of slot times (HH:MM)
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

    // Find taken slots for that date
    let taken = [];
    if (dbIsConnected()) {
      const bookings = await Booking.find({ bookingDate: date });
      taken = bookings.map(b => (b.bookingTime || '').slice(0,5)).filter(Boolean);
    } else {
      taken = inMemoryBookings.filter(b => b.bookingDate === date).map(b => (b.bookingTime || '').slice(0,5)).filter(Boolean);
    }

    // Unique taken
    taken = Array.from(new Set(taken));

    // Available = allSlots - taken
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
 * Create a booking. Minimal validation + weather fetch
 * Respects req.body.locale (e.g. "hi-IN") or Accept-Language header for localized messages.
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
      lon
    } = req.body;

    // determine locale for messages
    const locale = pickLocaleFromReq(req);

    // Log received payload for debugging
    console.log('[BOOKINGS][RECEIVED PAYLOAD]', JSON.stringify(req.body), 'locale=', locale);

    // Basic validation
    if (!bookingId || !customerName || !numberOfGuests || !bookingDate || !bookingTime) {
      const errMsg = t(locale,
        'Missing required fields: bookingId, customerName, numberOfGuests, bookingDate, bookingTime',
        'आवश्यक फ़ील्ड गायब हैं: bookingId, customerName, numberOfGuests, bookingDate, bookingTime'
      );
      return res.status(400).json({ error: 'Missing required fields', message: errMsg });
    }

    // --- Conflict check to prevent double-booking on same date+time ---
    // If DB connected: check Mongo for existing booking at same date/time
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
      // If using in-memory store, check there too
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
    // --- end conflict check ---

    // Fetch weather (best-effort). Use provided lat/lon or default will be used by weather route.
    const { weatherInfo, seatingPreference: weatherSeating } = await fetchWeatherForDate(bookingDate, lat, lon);

    // Determine final seating preference: prefer explicit client choice; otherwise use weather's suggestion; else null.
    let clientSeating = null;
    if (req.body && req.body.seatingPreference && String(req.body.seatingPreference).trim() !== "") {
      clientSeating = String(req.body.seatingPreference).trim().toLowerCase();
    }

    const finalSeatingPreference = clientSeating || (weatherSeating ? String(weatherSeating).trim().toLowerCase() : null);

    if (dbIsConnected()) {
      // Use MongoDB
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
      const successMsg = t(locale,
        `Booking created for ${customerName} on ${bookingDate} at ${bookingTime}.`,
        `${customerName} के लिए ${bookingDate} को ${bookingTime} पर बुकिंग बनाई गई।`
      );
      // Return saved booking and localized message
      return res.status(201).json({ ...booking.toObject(), message: successMsg });
    } else {
      // Use in-memory store
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
      const successMsg = t(locale,
        `Booking created for ${customerName} on ${bookingDate} at ${bookingTime}.`,
        `${customerName} के लिए ${bookingDate} को ${bookingTime} पर बुकिंग बनाई गई।`
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
