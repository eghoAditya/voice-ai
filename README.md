# Voice AI Restaurant Booking System

A full-stack **voice-enabled restaurant reservation system** with:
- Conversational booking (English + Hindi)
- NLP-based intent extraction
- Smart weather-based seating suggestions
- Time-slot conflict prevention
- Email & SMS confirmations
- Admin dashboard with analytics and export tools

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Flow](#project-flow)
- [Setup Instructions](#setup-instructions)
- [Dependencies](#dependencies)
- [Run Servers](#run-servers)
- [Environment Variables](#environment-variables)
- [API Endpoints](#api-endpoints)
- [Admin Dashboard](#admin-dashboard)
- [Project Structure](#project-structure)
- [Approach](#approach-development-timeline)
- [Future Improvements](#future-improvements)

---

## Overview

Users can reserve a table using only their **voice**.  
Supports **English (en-IN)** and **Hindi (hi-IN)**.

Includes real-time NLP extraction, weather-based seating suggestions, conflict-free time slots, and booking confirmation via **email/SMS**.

---

## Features

### Voice Conversation
- Speech-to-text + text-to-speech via Web Speech API  
- Natural conversational flow  
- Handles clarifications automatically  

### NLP Automation
Automatically extracts:
- Name  
- Number of guests  
- Date & time  
- Seating preference (indoor/outdoor)  
- Cuisine  
- Special requests  

### Smart Seating Recommendations
- Integrates OpenWeather API  
- Suggests indoor/outdoor seating based on weather  

### Slot Management
- Prevents double bookings  
- Suggests alternate time slots  

### Contact Notifications
Supports:
- **Email** (NodeMailer)  
- **SMS** (Twilio)  

### Admin Dashboard
- View all bookings  
- Delete bookings  
- Analytics (peak hours, cuisines, seating trends)  
- CSV export  
- Dark theme UI  

---

## Tech Stack

| Layer | Technology |
|------|------------|
| Frontend | React, Web Speech API |
| Backend | Node.js + Express |
| Database | MongoDB Atlas |
| NLP | Groq Endpoint |
| Weather API | OpenWeather |
| Communication | Twilio (SMS), NodeMailer (Email) |

---

## Architecture

### **Frontend (React)**  
- Voice Engine (Speech-to-Text + TTS)  
- Conversational UI  
- NLP requests → Backend  
- Slot Picker Modal  
- Admin Dashboard UI  

### **Backend (Express + MongoDB)**  
- `/api/bookings`  
- `/api/bookings/slots`  
- `/api/nlp/interpret`  
- `/api/weather`  
- Twilio-based SMS  
- Email via NodeMailer  

---

## Project Flow

1. User selects language + contact method  
2. Voice conversation begins  
3. NLP extracts all booking details  
4. Weather API suggests seating  
5. Slot API checks availability  
6. Booking saved to MongoDB  
7. SMS/Email confirmation sent  
8. User sees “Booking Confirmed” message  
9. Admin can manage and analyze bookings  

---

## Setup Instructions

### Clone Repository
```bash
git clone <repository-url>
cd project-folder 
```
## Dependencies

Backend:
```bash
cd backend
npm install
```

Frontend:
```bash
cd frontend
npm install
```

## Run servers

Backend:
```bash
npm start
```
Frontend:
```bash
npm run dev
```
### Environment Variables
Create: backend/.env
```bash
MONGO_URI=

OPENWEATHER_API_KEY=

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=465
EMAIL_USER=
EMAIL_PASS=
```
##  API Endpoints

---

### **Booking Routes**

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/bookings` | Create booking |
| GET | `/api/bookings` | Get all bookings |
| GET | `/api/bookings/slots?date=YYYY-MM-DD` | Check available slots |
| GET | `/api/bookings/:id` | Get single booking |
| DELETE | `/api/bookings/:id` | Delete booking |

---

### **NLP Route**

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/nlp/interpret` | Extract intent via Groq |

---

### **Weather Route**

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/weather` | Weather + seating suggestion |

---

## Admin Dashboard

The admin dashboard includes:

- Full booking list  
- Delete action  
- Analytics (peak hours, cuisines, seating preferences)  
- CSV export  
- Dark UI theme  

---

##  Project Structure
📁 frontend  
├── 📁 src  
│   ├── 📄 App.jsx  
│   ├── 📄 Admin.jsx  
│   ├── 📄 voice.js  
│   └── 📁 components  
└── 📄 package.json  

📁 backend  
├── 📁 models  
├── 📁 routes  
├── 📁 services  
├── 📄 server.js  
└── 📄 package.json  


---

## Approach (Development Timeline)

1. Backend + MongoDB setup  
2. Speech Recognition + TTS  
3. NLP pipeline (English + Hindi)  
4. Date & time parsing logic  
5. Weather seating suggestions  
6. Slot conflict prevention  
7. SMS + Email confirmation  
8. Admin analytics dashboard  
9. Final UI polish  

---

## Future Improvements

- Admin authentication  
- User re-scheduling flow  
- Multi-restaurant support  
- WebSocket real-time dashboard  
- WhatsApp confirmations  

---










