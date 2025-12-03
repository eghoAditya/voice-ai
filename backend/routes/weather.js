// backend/routes/weather.js
const express = require('express');
const router = express.Router();
const axios = require('axios');

const OPENWEATHER_KEY = process.env.OPENWEATHER_KEY;

// Helper: parse YYYY-MM-DD to UTC midnight timestamp (seconds)
function ymdToUtcSeconds(ymd) {
  const parts = ymd.split('-').map(p => parseInt(p, 10));
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  const [year, month, day] = parts;
  const ms = Date.UTC(year, month - 1, day, 0, 0, 0);
  return Math.floor(ms / 1000);
}

function decideSeatingFromWeatherObj(obj) {
  // obj can be either 'daily' entry (has pop/weather) or current weather object
  if (!obj) return 'indoor';
  // check pop if present
  if (obj.pop !== undefined && obj.pop >= 0.3) return 'indoor';
  // check weather text
  const weatherMain = (obj.weather && obj.weather[0] && obj.weather[0].main) || '';
  const w = String(weatherMain).toLowerCase();
  if (w.includes('rain') || w.includes('thunder') || w.includes('snow') || w.includes('drizzle')) return 'indoor';
  return 'outdoor';
}

router.get('/', async (req, res) => {
  try {
    const { date, lat, lon } = req.query;
    if (!date) return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' });

    const targetSeconds = ymdToUtcSeconds(date);
    if (!targetSeconds) return res.status(400).json({ error: 'invalid date format. Use YYYY-MM-DD' });

    const latitude = lat || '12.9716';
    const longitude = lon || '77.5946';

    if (!OPENWEATHER_KEY) {
      return res.status(500).json({ error: 'OpenWeatherMap API key not configured (OPENWEATHER_KEY missing)' });
    }

    // First: try One Call (daily forecast)
    try {
      const url = `https://api.openweathermap.org/data/2.5/onecall`;
      const params = {
        lat: latitude,
        lon: longitude,
        exclude: 'minutely,hourly,alerts',
        units: 'metric',
        appid: OPENWEATHER_KEY
      };
      const resp = await axios.get(url, { params });
      const data = resp.data;

      if (data && Array.isArray(data.daily)) {
        // try exact match
        const matched = data.daily.find(d => d.dt === targetSeconds);
        if (matched) {
          const summary = (matched.weather && matched.weather[0] && matched.weather[0].description) || 'No description';
          const tempDay = matched.temp ? matched.temp.day : null;
          const pop = matched.pop !== undefined ? matched.pop : null;
          const seatingRecommendation = decideSeatingFromWeatherObj(matched);

          return res.json({
            date,
            location: { lat: parseFloat(latitude), lon: parseFloat(longitude) },
            weatherSummary: `${summary}${tempDay !== null ? `, avg day temp ${tempDay}°C` : ''}${pop !== null ? `, precipitation probability ${Math.round(pop * 100)}%` : ''}`,
            seatingRecommendation,
            forecast: {
              dt: matched.dt,
              temp: matched.temp,
              pop: matched.pop,
              weather: matched.weather
            }
          });
        }

        // nearest fallback within forecast window
        const nearest = data.daily.reduce((best, cur) => {
          const diff = Math.abs(cur.dt - targetSeconds);
          if (!best || diff < best.diff) return { item: cur, diff };
          return best;
        }, null);

        if (nearest && nearest.diff <= 3 * 24 * 3600) {
          const m = nearest.item;
          const approxSummary = (m.weather && m.weather[0] && m.weather[0].description) || 'No description';
          const seatingRecommendation = decideSeatingFromWeatherObj(m);
          return res.json({
            date,
            location: { lat: parseFloat(latitude), lon: parseFloat(longitude) },
            weatherSummary: `Approximate forecast (closest available): ${approxSummary}`,
            seatingRecommendation,
            forecast: {
              dt: m.dt,
              temp: m.temp,
              pop: m.pop,
              weather: m.weather
            }
          });
        }

        // forecast present but date outside window
        return res.json({
          date,
          location: { lat: parseFloat(latitude), lon: parseFloat(longitude) },
          weatherSummary: 'Forecast not available for that date (outside provider forecast window).',
          seatingRecommendation: 'indoor',
          forecast: null
        });
      } else {
        // Unexpected shape — fall through to current-weather fallback
        console.warn('OneCall returned unexpected shape; falling back to current weather');
      }
    } catch (oneErr) {
      // If One Call returns 401 or other error, fall back to current weather endpoint
      console.warn('OneCall error — falling back to current-weather:', oneErr?.response?.data || oneErr.message || oneErr);
      // continue to fallback
    }

    // Fallback: use current weather endpoint to approximate
    try {
      const curUrl = `https://api.openweathermap.org/data/2.5/weather`;
      const curParams = {
        lat: latitude,
        lon: longitude,
        units: 'metric',
        appid: OPENWEATHER_KEY
      };
      const curResp = await axios.get(curUrl, { params: curParams });
      const cur = curResp.data;

      const summary = (cur.weather && cur.weather[0] && cur.weather[0].description) || 'No description';
      const seatingRecommendation = decideSeatingFromWeatherObj({
        weather: cur.weather,
        pop: cur.rain ? 1 : 0 // if rain object exists, treat as precipitation
      });

      return res.json({
        date,
        location: { lat: parseFloat(latitude), lon: parseFloat(longitude) },
        weatherSummary: `Approximate (current) weather: ${summary}${cur.main && cur.main.temp ? `, temp ${cur.main.temp}°C` : ''}`,
        seatingRecommendation,
        forecast: {
          current: cur
        },
        note: 'Used current-weather endpoint as fallback because forecast API was unavailable'
      });
    } catch (curErr) {
      console.error('Current weather fallback also failed', curErr?.response?.data || curErr.message || curErr);
      if (curErr.response && curErr.response.data) {
        return res.status(502).json({ error: 'Weather provider error (fallback)', details: curErr.response.data });
      }
      return res.status(500).json({ error: 'Server error fetching weather (fallback)', details: curErr.message });
    }

  } catch (err) {
    console.error('Weather route error', err.message || err);
    return res.status(500).json({ error: 'Server error fetching weather', details: err.message });
  }
});

module.exports = router;
