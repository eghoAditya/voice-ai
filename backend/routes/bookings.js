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
    const seating = data.seatingRecommendation || data.seatingPreference || 'indoor';
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
      // Return in-memory bookings
      return res.json(inMemoryBookings.slice().reverse());
    }
  } catch (err) {
    console.error('Error fetching bookings', err);
    return res.status(500).json({ error: 'Server error fetching bookings' });
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

    if (!bookingId || !customerName || !numberOfGuests || !bookingDate || !bookingTime) {
      return res.status(400).json({ error: 'Missing required fields: bookingId, customerName, numberOfGuests, bookingDate, bookingTime' });
    }

    // Fetch weather (best-effort). Use provided lat/lon or default will be used by weather route.
    const { weatherInfo, seatingPreference } = await fetchWeatherForDate(bookingDate, lat, lon);

    if (dbIsConnected()) {
      // Use MongoDB
      const existing = await Booking.findOne({ bookingId });
      if (existing) return res.status(400).json({ error: 'bookingId already exists' });

      const booking = new Booking({
        bookingId,
        customerName,
        numberOfGuests,
        bookingDate,
        bookingTime,
        cuisinePreference,
        specialRequests,
        weatherInfo,
        seatingPreference
      });

      await booking.save();
      return res.status(201).json(booking);
    } else {
      // Use in-memory store
      if (inMemoryBookings.some(b => b.bookingId === bookingId)) {
        return res.status(400).json({ error: 'bookingId already exists (in-memory)' });
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
        seatingPreference: seatingPreference || 'unknown',
        status: 'confirmed',
        createdAt: new Date().toISOString()
      };
      inMemoryBookings.push(booking);
      return res.status(201).json(booking);
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
