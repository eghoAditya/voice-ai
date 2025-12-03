// backend/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

const bookingsRouter = require('./routes/bookings');
const weatherRouter = require('./routes/weather');

const app = express();
app.use(cors());
app.use(express.json());


// Attempt MongoDB connection only if MONGO_URI provided
const MONGO_URI = process.env.MONGO_URI;
if (MONGO_URI) {
  mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));
} else {
  console.log('MONGO_URI not set — skipping MongoDB connection (create backend/.env to enable)');
}


// health route
app.get('/', (req, res) => {
  res.send('Voice Booking Backend OK');
});

// mount api routes
app.use('/api/bookings', bookingsRouter);
app.use('/api/weather', weatherRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
