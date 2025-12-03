// frontend/src/App.jsx
import { useEffect, useState, useRef } from "react";
import { startConversation, stopConversation, speak } from "./voice";

function todayYMD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

export default function App() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [messages, setMessages] = useState([]); // conversation messages
  const [listening, setListening] = useState(false);
  const [locale, setLocale] = useState("auto"); // "auto" | "en-IN" | "hi-IN"
  const convoRef = useRef(null);

  // slots modal state
  const [showSlotsModal, setShowSlotsModal] = useState(false);
  const [slotsDate, setSlotsDate] = useState(todayYMD());
  const [slotsData, setSlotsData] = useState(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [toast, setToast] = useState(null);

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

  // --- Slots modal helpers ---
  async function fetchSlotsForDate(date) {
    setSlotsLoading(true);
    setSlotsData(null);
    try {
      const res = await fetch(`http://localhost:4000/api/bookings/slots?date=${encodeURIComponent(date)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server ${res.status}`);
      }
      const j = await res.json();
      setSlotsData(j);
    } catch (err) {
      console.error("Failed to fetch slots", err);
      setSlotsData({ error: err.message || String(err) });
    } finally {
      setSlotsLoading(false);
    }
  }

  function openSlotsModal(defaultDate = todayYMD()) {
    setSlotsDate(defaultDate);
    setShowSlotsModal(true);
    // fetch once opened
    setTimeout(() => fetchSlotsForDate(defaultDate), 60);
  }

  function closeSlotsModal() {
    setShowSlotsModal(false);
    setSlotsData(null);
  }

  async function onPickSlot(slot) {
    // copy to clipboard and show toast
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(slot);
        setToast(`Copied "${slot}" to clipboard — you can paste it into your booking or speak it.`);
      } else {
        setToast(`Selected ${slot}. (Clipboard not available)`);
      }
      // auto-clear toast after 2.5s
      setTimeout(() => setToast(null), 2500);
    } catch (e) {
      setToast(`Selected ${slot}`);
      setTimeout(() => setToast(null), 2500);
    }
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
              openSlotsModal(todayYMD());
            }}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "#fff",
              cursor: "pointer"
            }}
          >
            Check available slots
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

      {/* Slots Modal */}
      {showSlotsModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.4)",
            zIndex: 9999
          }}
        >
          <div style={{ width: 760, maxWidth: "95%", background: "#fff", borderRadius: 12, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <h3 style={{ margin: 0 }}>Available slots</h3>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="date"
                  value={slotsDate}
                  onChange={(e) => setSlotsDate(e.target.value)}
                  style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid #ddd" }}
                />
                <button
                  onClick={() => fetchSlotsForDate(slotsDate)}
                  style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" }}
                >
                  Check
                </button>
                <button onClick={closeSlotsModal} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" }}>
                  Close
                </button>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              {slotsLoading && <div>Loading slots…</div>}
              {!slotsLoading && !slotsData && <div style={{ color: "#666" }}>Choose a date and click Check.</div>}
              {!slotsLoading && slotsData && slotsData.error && <div style={{ color: "red" }}>Error: {slotsData.error}</div>}

              {!slotsLoading && slotsData && !slotsData.error && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <h4 style={{ marginTop: 0 }}>Available</h4>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {slotsData.available.length === 0 && <div style={{ color: "#666" }}>No available slots.</div>}
                      {slotsData.available.map((s) => (
                        <button
                          key={s}
                          onClick={() => onPickSlot(s)}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 8,
                            border: "1px solid #e6f7ff",
                            background: "#f0fbff",
                            cursor: "pointer"
                          }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 style={{ marginTop: 0 }}>Taken</h4>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {slotsData.taken.length === 0 && <div style={{ color: "#666" }}>No taken slots.</div>}
                      {slotsData.taken.map((t) => (
                        <div key={t} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #eee", background: "#fff", color: "#777" }}>
                          {t}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: 12, color: "#666", fontSize: 13 }}>
              Tip: click an available slot to copy it to your clipboard for use in voice or manual booking flows.
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed",
          right: 18,
          bottom: 18,
          background: "#111",
          color: "#fff",
          padding: "10px 14px",
          borderRadius: 10,
          boxShadow: "0 6px 18px rgba(0,0,0,0.12)"
        }}>{toast}</div>
      )}
    </div>
  );
}
