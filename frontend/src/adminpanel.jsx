import { useEffect, useState } from "react";


export default function AdminPanel({ onClose }) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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

  async function handleDelete(bookingId) {
    if (!confirm("Delete booking?")) return;
    try {
      const res = await fetch(`http://localhost:4000/api/bookings/${bookingId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      await loadBookings();
    } catch (err) {
      alert("Failed to delete booking: " + (err.message || err));
    }
  }

  function computePeakHours(list) {
    const counts = {};
    (list || []).forEach(b => {
      const t = (b.bookingTime || "00:00").slice(0,5);
      counts[t] = (counts[t] || 0) + 1;
    });
    // Create sorted array of [time, count]
    const arr = Object.entries(counts).sort((a,b) => b[1] - a[1]);
    return arr.slice(0,5); // top 5
  }

  function computePopularCuisines(list) {
    const counts = {};
    (list || []).forEach(b => {
      const c = (b.cuisinePreference || "Unknown").toLowerCase();
      counts[c] = (counts[c] || 0) + 1;
    });
    const arr = Object.entries(counts).sort((a,b) => b[1] - a[1]);
    return arr.slice(0,5);
  }

  function exportCsv() {
    if (!bookings || bookings.length === 0) {
      alert("No bookings to export.");
      return;
    }
    const rows = [
      ["bookingId","customerName","numberOfGuests","bookingDate","bookingTime","cuisinePreference","specialRequests","seatingPreference","status","createdAt"]
    ];
    bookings.forEach(b => {
      rows.push([
        b.bookingId || "",
        b.customerName || "",
        String(b.numberOfGuests || ""),
        (b.bookingDate || "").slice(0,10),
        b.bookingTime || "",
        b.cuisinePreference || "",
        (b.specialRequests || "").replace(/\n/g,' '),
        b.seatingPreference || "",
        b.status || "",
        b.createdAt || ""
      ]);
    });
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bookings-export-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const peak = computePeakHours(bookings);
  const popular = computePopularCuisines(bookings);

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.45)",
        zIndex: 10000
      }}
    >
      <div style={{ width: 980, maxWidth: "98%", maxHeight: "90%", overflowY: "auto", background: "#fff", borderRadius: 12, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <h2 style={{ margin: 0 }}>Admin Dashboard</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={exportCsv} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd" }}>Export CSV</button>
            <button onClick={onClose} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd" }}>Close</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12, marginTop: 12 }}>
          <div>
            <h3 style={{ marginTop: 0 }}>Bookings</h3>
            {loading && <div>Loading…</div>}
            {error && <div style={{ color: "red" }}>Error: {error}</div>}
            {!loading && bookings.length === 0 && <div style={{ color: "#666" }}>No bookings yet.</div>}
            {!loading && bookings.length > 0 && (
              <div style={{ display: "grid", gap: 8 }}>
                {bookings.map(b => (
                  <div key={b.bookingId || b._id} style={{ border: "1px solid #eee", padding: 10, borderRadius: 8, display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{b.customerName} — {b.numberOfGuests}</div>
                      <div style={{ fontSize: 13, color: "#666" }}>{(b.bookingDate || "").slice(0,10)} @ {b.bookingTime} • {b.cuisinePreference || "—"}</div>
                      <div style={{ marginTop: 6, fontSize: 13 }}>Seating: <strong>{b.seatingPreference || (b.weatherInfo && b.weatherInfo.seatingRecommendation) || "—"}</strong></div>
                      {b.specialRequests && <div style={{ marginTop: 6, color: "#444" }}>Note: {b.specialRequests}</div>}
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12, color: "#999" }}>{new Date(b.createdAt).toLocaleString()}</div>
                      <div style={{ marginTop: 8 }}>
                        <button onClick={() => handleDelete(b.bookingId)} style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #eee", cursor: "pointer" }}>Delete</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 style={{ marginTop: 0 }}>Analytics</h3>

            <div style={{ marginBottom: 12 }}>
              <strong>Peak hours (top times)</strong>
              <div style={{ marginTop: 8 }}>
                {peak.length === 0 && <div style={{ color: "#666" }}>No data yet.</div>}
                {peak.map(([time, count]) => (
                  <div key={time} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px dashed #f1f1f1" }}>
                    <div>{time}</div>
                    <div style={{ color: "#333", fontWeight: 700 }}>{count}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <strong>Popular cuisines</strong>
              <div style={{ marginTop: 8 }}>
                {popular.length === 0 && <div style={{ color: "#666" }}>No data yet.</div>}
                {popular.map(([cuisine, count]) => (
                  <div key={cuisine} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px dashed #f1f1f1" }}>
                    <div style={{ textTransform: "capitalize" }}>{cuisine}</div>
                    <div style={{ color: "#333", fontWeight: 700 }}>{count}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 18, color: "#666", fontSize: 13 }}>
              Tip: use Export CSV to download all bookings for offline analytics.
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
