// backend/models/Booking.js
const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
  bookingId: { type: String, required: true, unique: true },
  customerName: { type: String, required: true },
  numberOfGuests: { type: Number, required: true },
  bookingDate: { type: Date, required: true },
  bookingTime: { type: String, required: true },
  cuisinePreference: { type: String },
  specialRequests: { type: String },
  weatherInfo: { type: Object }, // raw weather API payload / parsed summary
  seatingPreference: { type: String }, // 'indoor' | 'outdoor'
  status: { type: String, default: 'confirmed' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Booking', BookingSchema);
