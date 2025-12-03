// frontend/src/App.jsx
import { useEffect, useState, useRef } from "react";
import { startConversation, stopConversation, speak } from "./voice";

export default function App() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [messages, setMessages] = useState([]); // conversation messages
  const [listening, setListening] = useState(false);
  const [locale, setLocale] = useState("auto"); // "auto" | "en-IN" | "hi-IN"
  const convoRef = useRef(null);

  // load bookings
  async function loadBookings() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("http://localhost:4000/api/bookings");
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      setBookings(data);
    } catch (err) {
      console.error("Failed to load bookings", err);
      setError(err.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBookings();
  }, []);

  // pretty display locale label
  function localeLabel(l) {
    if (!l || l === "auto") {
      const nav = (navigator && navigator.language) || "en-IN";
      return `Auto (${nav})`;
    }
    if (l === "en-IN") return "English (en-IN)";
    if (l === "hi-IN") return "Hindi (hi-IN)";
    return l;
  }

  function appendMessage(text, who = "agent") {
    setMessages((m) => [...m, { id: Date.now() + Math.random(), who, text }]);
    setTimeout(() => {
      if (convoRef.current) convoRef.current.scrollTop = convoRef.current.scrollHeight;
    }, 40);
  }

  // start conversation with selected locale
  async function handleStartConversation() {
    setMessages([]);
    setListening(true);

    // compute effective locale
    let effLocale = locale;
    if (locale === "auto") {
      effLocale = (navigator && navigator.language) || "en-IN";
      // normalize e.g. "en-US" -> "en-IN" only if English; but keep full code to allow variety
      if (effLocale.startsWith("en")) effLocale = "en-IN";
      if (effLocale.startsWith("hi")) effLocale = "hi-IN";
    }

    const onUpdate = (text, who) => {
      const whoNorm = who === "user" ? "user" : "agent";
      appendMessage(text, whoNorm);
      if (typeof text === "string" && text.toLowerCase().includes("booking confirmed")) {
        setTimeout(() => loadBookings(), 1200);
      }
    };

    try {
      // pass locale option
      await startConversation(onUpdate, { locale: effLocale });
    } catch (err) {
      console.error("startConversation error", err);
      appendMessage("Conversation error. Please try again.", "agent");
      speak("Sorry, I couldn't start the conversation.");
    } finally {
      setListening(false);
    }
  }

  function handleStopConversation() {
    stopConversation();
    setListening(false);
    appendMessage("Stopped listening.", "agent");
  }

  return (
    <div style={{ padding: 20, fontFamily: "Inter, Arial, sans-serif", maxWidth: 900, margin: "0 auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Voice AI Restaurant Booking</h1>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 13, color: "#333" }}>Language</label>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #ddd" }}
            aria-label="Choose language"
          >
            <option value="auto">Auto ({(navigator && navigator.language) || "en-IN"})</option>
            <option value="en-IN">English (en-IN)</option>
            <option value="hi-IN">Hindi (hi-IN)</option>
          </select>

          <button
            onClick={() => {
              if (listening) handleStopConversation();
              else handleStartConversation();
            }}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: listening ? "#ffecec" : "#fff",
              cursor: "pointer"
            }}
          >
            {listening ? "Stop Conversation" : "Start Conversation"}
          </button>

          <button
            onClick={() => {
              speak(locale === "hi-IN" ? "यह एक परीक्षण वाक्य है" : "This is a quick voice test. Speak after you press Start Conversation.");
            }}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "#fff",
              cursor: "pointer"
            }}
          >
            Test TTS
          </button>
        </div>
      </header>

      <section style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Conversation</h2>
        <div
          id="conversation"
          ref={convoRef}
          style={{
            minHeight: 160,
            border: "1px solid #eee",
            padding: 12,
            borderRadius: 8,
            background: "#fafafa",
            overflowY: "auto",
            maxHeight: 260
          }}
        >
          {messages.length === 0 && <p style={{ margin: 0, color: "#666" }}>Conversation will appear here while you speak.</p>}
          {messages.map((m) => (
            <div key={m.id} style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div
                style={{
                  minWidth: 70,
                  textTransform: "uppercase",
                  fontSize: 11,
                  color: m.who === "user" ? "#055160" : "#3b3b3b",
                  fontWeight: 700
                }}
              >
                {m.who}
              </div>
              <div
                style={{
                  background: m.who === "user" ? "#e6fffa" : "#fff",
                  border: "1px solid #eee",
                  padding: 10,
                  borderRadius: 8,
                  maxWidth: "100%"
                }}
              >
                <div style={{ fontSize: 14, color: "#111" }}>{m.text}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>Bookings</h2>
          <div>
            <button
              onClick={loadBookings}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "#fff",
                cursor: "pointer",
                marginLeft: 8
              }}
            >
              Refresh
            </button>
          </div>
        </div>

        <div style={{ marginTop: 8 }}>
          {loading && <div>Loading bookings…</div>}
          {error && <div style={{ color: "red" }}>Error loading bookings: {error}</div>}
          {!loading && !error && bookings.length === 0 && <div style={{ color: "#666" }}>No bookings yet.</div>}

          {!loading && bookings.length > 0 && (
            <ul style={{ padding: 0, listStyle: "none", margin: 0 }}>
              {bookings.map((b) => (
                <li
                  key={b.bookingId || b._id}
                  style={{
                    border: "1px solid #eee",
                    padding: 12,
                    borderRadius: 8,
                    marginBottom: 8,
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 12,
                    alignItems: "center"
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {b.customerName} — {b.numberOfGuests} guests
                    </div>

                    <div style={{ color: "#666", fontSize: 13 }}>
                      {new Date(b.bookingDate).toLocaleDateString()} @ {b.bookingTime} • {b.cuisinePreference || "—"}
                    </div>

                    <div style={{ marginTop: 6, fontSize: 13, color: "#444" }}>
                      Seating:{" "}
                      <strong>
                        {b.seatingPreference ||
                          (b.weatherInfo && b.weatherInfo.seatingRecommendation) ||
                          "—"}
                      </strong>
                    </div>

                    {b.weatherInfo && b.weatherInfo.weatherSummary && (
                      <div style={{ marginTop: 6, fontSize: 13, color: "#666" }}>
                        Weather: {b.weatherInfo.weatherSummary}
                        {b.weatherInfo.note ? (
                          <span style={{ marginLeft: 8, fontStyle: "italic" }}>({b.weatherInfo.note})</span>
                        ) : null}
                      </div>
                    )}

                    {b.specialRequests && (
                      <div style={{ marginTop: 6, color: "#333" }}>
                        Note: {b.specialRequests}
                      </div>
                    )}
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 12, color: "#999" }}>
                      {new Date(b.createdAt).toLocaleString()}
                    </div>

                    <div style={{ marginTop: 8 }}>
                      <button
                        onClick={async () => {
                          if (!confirm("Delete booking?")) return;
                          try {
                            const resp = await fetch(`http://localhost:4000/api/bookings/${b.bookingId}`, { method: "DELETE" });
                            if (!resp.ok) throw new Error("Delete failed");
                            await loadBookings();
                          } catch (err) {
                            alert("Failed to delete booking: " + (err.message || err));
                          }
                        }}
                        style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #eee", cursor: "pointer" }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <footer style={{ marginTop: 24, color: "#888", fontSize: 13 }}>
        Backend: <code>http://localhost:4000</code> — Bookings stored in MongoDB Atlas.
      </footer>
    </div>
  );
}
