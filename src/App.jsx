import { useState, useEffect, useCallback, Component } from "react";

// ═══════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════
const SUPABASE_URL = "https://hhobwuwautnddjzewizo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhob2J3dXdhdXRuZGRqemV3aXpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5NTEyMjIsImV4cCI6MjA4NjUyNzIyMn0.xCTHExXgBiEFMzzr1T-APrejG2vHJ3CNIMVUy1pqp4A";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const EMP_COLORS = ["#E07A5F","#3D405B","#81B29A","#F2CC8F","#6A4C93","#1982C4","#FF595E","#8AC926","#CA6702","#9B5DE5"];

// ─── Utilities ───
function getDaysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function getFirstDayOfMonth(y, m) { return new Date(y, m, 1).getDay(); }
function dateKey(y, m, d) { return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }
function isWeekend(y, m, d) { const day = new Date(y, m, d).getDay(); return day === 0 || day === 6; }
function businessDays(dates, holidayDates = []) {
  if (!Array.isArray(dates)) return 0;
  return dates.filter(dk => { const [y,m,d] = dk.split("-").map(Number); return !isWeekend(y, m-1, d) && !holidayDates.includes(dk); }).length;
}
function formatDate(dk) { if (!dk) return ""; const [y,m,d] = dk.split("-").map(Number); return `${MONTHS[m-1]} ${d}, ${y}`; }
function formatDateShort(dk) { if (!dk) return ""; const [y,m,d] = dk.split("-").map(Number); return `${MONTHS_SHORT[m-1]} ${d}`; }
function toICSDate(dk) { return dk.replace(/-/g, ""); }
function todayKey() { const t = new Date(); return dateKey(t.getFullYear(), t.getMonth(), t.getDate()); }
function daysSince(dk) { if (!dk) return null; const d = new Date(dk); const now = new Date(); return Math.floor((now - d) / 86400000); }
function yearsMonths(dk) {
  if (!dk) return "";
  const d = new Date(dk), now = new Date();
  let y = now.getFullYear() - d.getFullYear(), m = now.getMonth() - d.getMonth();
  if (m < 0) { y--; m += 12; }
  return y > 0 ? `${y}y ${m}m` : `${m}m`;
}

function generateICS(employees, requests, holidays) {
  let ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//VacationTracker//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:Team Time Off\r\n`;
  (holidays || []).forEach(h => {
    const end = new Date(h.date); end.setDate(end.getDate() + 1);
    const endStr = `${end.getFullYear()}${String(end.getMonth()+1).padStart(2,"0")}${String(end.getDate()).padStart(2,"0")}`;
    ics += `BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${toICSDate(h.date)}\r\nDTEND;VALUE=DATE:${endStr}\r\nSUMMARY:🏢 ${h.name}\r\nUID:holiday-${h.id}@vacationtracker\r\nSTATUS:CONFIRMED\r\nTRANSP:TRANSPARENT\r\nEND:VEVENT\r\n`;
  });
  (requests || []).filter(r => r.status === "approved").forEach(req => {
    const emp = (employees || []).find(e => e.id === req.employee_id);
    if (!emp) return;
    const dates = (req.dates || []).sort();
    if (!dates.length) return;
    let ranges = [], start = dates[0], prev = dates[0];
    for (let j = 1; j < dates.length; j++) {
      if ((new Date(dates[j]) - new Date(prev)) / 86400000 <= 3) prev = dates[j];
      else { ranges.push([start, prev]); start = dates[j]; prev = dates[j]; }
    }
    ranges.push([start, prev]);
    ranges.forEach((r, k) => {
      const end = new Date(r[1]); end.setDate(end.getDate() + 1);
      const endStr = `${end.getFullYear()}${String(end.getMonth()+1).padStart(2,"0")}${String(end.getDate()).padStart(2,"0")}`;
      ics += `BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${toICSDate(r[0])}\r\nDTEND;VALUE=DATE:${endStr}\r\nSUMMARY:${emp.name} - Time Off\r\nUID:${req.id}-${k}@vacationtracker\r\nSTATUS:CONFIRMED\r\nTRANSP:TRANSPARENT\r\nEND:VEVENT\r\n`;
    });
  });
  return ics + `END:VCALENDAR`;
}

// ─── Session ───
function saveSession(s) { try { localStorage.setItem("vt_session", JSON.stringify(s)); } catch {} }
function loadSessionStorage() { try { const s = localStorage.getItem("vt_session"); return s ? JSON.parse(s) : null; } catch { return null; } }
function clearSession() { try { localStorage.removeItem("vt_session"); } catch {} }

// ─── Supabase API ───
async function sbFetch(path, { method = "GET", body, token, headers: extra = {} } = {}) {
  const url = `${SUPABASE_URL}${path}`;
  const headers = { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json", ...extra };
  headers["Authorization"] = `Bearer ${token || SUPABASE_ANON_KEY}`;
  let res;
  try { res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch (e) { throw new Error(`Network error: ${e.message}`); }
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(typeof data === "object" ? (data.error_description || data.msg || data.message || JSON.stringify(data)) : data);
  return data;
}

async function authSignUp(email, password, name) { return sbFetch("/auth/v1/signup", { method: "POST", body: { email, password, data: { name } } }); }
async function authSignIn(email, password) { return sbFetch("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } }); }
async function authSignOut(token) { try { await sbFetch("/auth/v1/logout", { method: "POST", token }); } catch {} }
async function fetchProfiles(token) { return sbFetch("/rest/v1/profiles?select=*&order=name", { token }); }
async function patchProfile(id, updates, token) { return sbFetch(`/rest/v1/profiles?id=eq.${id}`, { method: "PATCH", body: updates, token, headers: { "Prefer": "return=representation" } }); }
async function removeProfile(id, token) { return sbFetch(`/rest/v1/profiles?id=eq.${id}`, { method: "DELETE", token }); }
async function fetchRequests(token, empId) { return sbFetch(`/rest/v1/time_off_requests?select=*${empId ? `&employee_id=eq.${empId}` : ""}&order=created_at.desc`, { token }); }
async function postRequest(empId, dates, note, token) { return sbFetch("/rest/v1/time_off_requests", { method: "POST", body: { employee_id: empId, dates, note: note || null }, token, headers: { "Prefer": "return=representation" } }); }
async function patchRequest(id, updates, token) { return sbFetch(`/rest/v1/time_off_requests?id=eq.${id}`, { method: "PATCH", body: updates, token, headers: { "Prefer": "return=representation" } }); }
async function removeRequest(id, token) { return sbFetch(`/rest/v1/time_off_requests?id=eq.${id}`, { method: "DELETE", token }); }
async function fetchHolidays(token) { return sbFetch("/rest/v1/company_holidays?select=*&order=date", { token }); }
async function addHoliday(name, date, userId, token) { return sbFetch("/rest/v1/company_holidays", { method: "POST", body: { name, date, created_by: userId }, token, headers: { "Prefer": "return=representation" } }); }
async function deleteHoliday(id, token) { return sbFetch(`/rest/v1/company_holidays?id=eq.${id}`, { method: "DELETE", token }); }

// ─── Error Boundary ───
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 40, maxWidth: 500, margin: "0 auto", fontFamily: "monospace" }}>
        <h2 style={{ color: "#C00" }}>Something crashed</h2>
        <pre style={{ background: "#f4f4f4", padding: 16, borderRadius: 8, overflow: "auto", fontSize: 12 }}>{this.state.error.toString()}</pre>
        <button onClick={() => { clearSession(); window.location.reload(); }} style={{ ...sPrimBtn, marginTop: 16 }}>Clear & reload</button>
      </div>
    );
    return this.props.children;
  }
}

// ═══════════════════════════════════════════════════════
// PROFILE DETAIL
// ═══════════════════════════════════════════════════════
const PROFILE_SECTIONS = [
  {
    title: "Basic Info",
    fields: [
      { key: "name", label: "Full Name", type: "text" },
      { key: "title", label: "Job Title", type: "text", placeholder: "e.g. Senior Designer" },
      { key: "email", label: "Work Email", type: "email" },
      { key: "personal_email", label: "Personal Email", type: "email" },
      { key: "phone", label: "Phone", type: "tel", placeholder: "(312) 555-0123" },
      { key: "start_date", label: "Start Date", type: "date" },
      { key: "birthday", label: "Birthday", type: "date" },
    ],
  },
  {
    title: "Home Address",
    fields: [
      { key: "address_street", label: "Street", type: "text" },
      { key: "address_city", label: "City", type: "text" },
      { key: "address_state", label: "State", type: "text", short: true },
      { key: "address_zip", label: "ZIP", type: "text", short: true },
    ],
  },
  {
    title: "Emergency Contact",
    fields: [
      { key: "emergency_contact_name", label: "Name", type: "text" },
      { key: "emergency_contact_phone", label: "Phone", type: "tel" },
      { key: "emergency_contact_relation", label: "Relationship", type: "text", placeholder: "e.g. Spouse, Parent" },
    ],
  },
];

function ProfileDetail({ profile, canEdit, onSave, onBack, backLabel }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const startEdit = () => { setForm({ ...profile }); setEditing(true); };
  const cancel = () => setEditing(false);
  const save = async () => {
    setSaving(true);
    const updates = {};
    PROFILE_SECTIONS.forEach(s => s.fields.forEach(f => {
      if (form[f.key] !== profile[f.key]) updates[f.key] = form[f.key] || null;
    }));
    // Also include role & allowance if admin edited those
    if (form.role !== profile.role) updates.role = form.role;
    if (form.allowance_days !== profile.allowance_days) updates.allowance_days = form.allowance_days;
    await onSave(updates);
    setEditing(false);
    setSaving(false);
  };
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const empIdx = 0; // color doesn't matter much here
  const initials = (profile.name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

  return (
    <div>
      {/* Back button */}
      {onBack && (
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#2d6a4f", fontWeight: 600, fontFamily: "var(--mono)", padding: "0 0 16px", display: "flex", alignItems: "center", gap: 4 }}>
          ← {backLabel || "Back"}
        </button>
      )}

      {/* Header card */}
      <div style={{ ...sCard, marginBottom: 16, display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: "#2d6a4f", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 20, fontWeight: 800, fontFamily: "var(--serif)", flexShrink: 0 }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "var(--serif)" }}>{profile.name}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
            {profile.title && <span style={{ fontSize: 13, color: "#666" }}>{profile.title}</span>}
            <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: profile.role === "admin" ? "#2d6a4f" : "#888", background: profile.role === "admin" ? "#E8F5E9" : "#f0f0f0", padding: "2px 8px", borderRadius: 10 }}>{profile.role}</span>
          </div>
          {profile.start_date && (
            <div style={{ fontSize: 11, color: "#999", fontFamily: "var(--mono)", marginTop: 4 }}>
              Started {formatDate(profile.start_date)} · {yearsMonths(profile.start_date)}
            </div>
          )}
        </div>
        {canEdit && !editing && (
          <button onClick={startEdit} style={{ ...sNavBtn, fontSize: 12, padding: "6px 14px", flexShrink: 0 }}>Edit</button>
        )}
      </div>

      {/* Sections */}
      {PROFILE_SECTIONS.map(section => (
        <div key={section.title} style={{ ...sCard, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--serif)", marginBottom: 12, color: "#333" }}>{section.title}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" }}>
            {section.fields.map(field => (
              <div key={field.key} style={{ gridColumn: field.short ? "auto" : "1 / -1", ...(field.short ? {} : {}) }}>
                {/* Show two short fields side by side */}
                <div style={{ fontSize: 10, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3, fontFamily: "var(--mono)" }}>
                  {field.label}
                </div>
                {editing ? (
                  <input
                    type={field.type}
                    value={form[field.key] || ""}
                    placeholder={field.placeholder || ""}
                    onChange={e => set(field.key, e.target.value)}
                    style={{ ...sInput, width: "100%", fontSize: 13, padding: "8px 10px" }}
                  />
                ) : (
                  <div style={{ fontSize: 14, color: profile[field.key] ? "#1a1a1a" : "#ccc", minHeight: 20 }}>
                    {field.type === "date" && profile[field.key]
                      ? formatDate(profile[field.key])
                      : profile[field.key] || "—"}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Admin-only: Role & Allowance */}
      {editing && canEdit && (
        <div style={{ ...sCard, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--serif)", marginBottom: 12, color: "#333" }}>Admin Settings</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" }}>
            <div>
              <div style={sFieldLabel}>Role</div>
              <select value={form.role || "employee"} onChange={e => set("role", e.target.value)} style={{ ...sInput, width: "100%", fontSize: 13, padding: "8px 10px" }}>
                <option value="employee">employee</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <div>
              <div style={sFieldLabel}>Vacation Days</div>
              <input type="number" value={form.allowance_days || 0} onChange={e => set("allowance_days", parseInt(e.target.value) || 0)} style={{ ...sInput, width: "100%", fontSize: 13, padding: "8px 10px" }} />
            </div>
          </div>
        </div>
      )}

      {/* Save/Cancel */}
      {editing && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button onClick={save} disabled={saving} style={{ ...sPrimBtn, opacity: saving ? 0.6 : 1 }}>{saving ? "Saving..." : "Save Changes"}</button>
          <button onClick={cancel} style={sNavBtn}>Cancel</button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// UPCOMING SIDEBAR
// ═══════════════════════════════════════════════════════
function UpcomingSidebar({ profiles, requests, holidays }) {
  const today = todayKey();
  const items = [];
  (holidays || []).forEach(h => { if (h.date >= today) items.push({ date: h.date, type: "holiday", label: h.name }); });
  (requests || []).filter(r => r.status === "approved").forEach(r => {
    const emp = (profiles || []).find(p => p.id === r.employee_id);
    const name = emp?.name || "Unknown";
    const future = (r.dates || []).filter(d => d >= today).sort();
    if (!future.length) return;
    let ranges = [], start = future[0], prev = future[0];
    for (let i = 1; i < future.length; i++) {
      if ((new Date(future[i]) - new Date(prev)) / 86400000 <= 3) prev = future[i];
      else { ranges.push([start, prev]); start = future[i]; prev = future[i]; }
    }
    ranges.push([start, prev]);
    ranges.forEach(([s, e]) => {
      const empIdx = (profiles || []).findIndex(p => p.id === r.employee_id);
      items.push({ date: s, type: "timeoff", label: name, dateLabel: s === e ? formatDateShort(s) : `${formatDateShort(s)} – ${formatDateShort(e)}`, color: EMP_COLORS[empIdx % EMP_COLORS.length] });
    });
  });
  items.sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = items.slice(0, 6);
  if (!upcoming.length) return <div style={{ padding: 20, textAlign: "center", color: "#bbb", fontSize: 13 }}>No upcoming time off</div>;

  let currentMonth = "";
  return (
    <div>
      {upcoming.map((item, i) => {
        const [y, m] = item.date.split("-").map(Number);
        const ml = `${MONTHS_SHORT[m-1]} ${y}`;
        const showMonth = ml !== currentMonth;
        if (showMonth) currentMonth = ml;
        const isToday = item.date === todayKey();
        return (
          <div key={`${item.type}-${item.date}-${item.label}-${i}`}>
            {showMonth && <div style={{ fontSize: 10, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: 1.5, padding: "12px 0 6px", fontFamily: "var(--mono)", borderTop: i > 0 ? "1px solid #f0f0f0" : "none" }}>{ml}</div>}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 0" }}>
              {item.type === "holiday" ? (
                <div style={{ width: 28, height: 28, borderRadius: 6, background: "#EDE9FE", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>🏢</div>
              ) : (
                <div style={{ width: 28, height: 28, borderRadius: 6, background: item.color + "22", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: item.color }} />
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</div>
                <div style={{ fontSize: 11, color: "#999", fontFamily: "var(--mono)" }}>
                  {item.type === "holiday" ? formatDateShort(item.date) : item.dateLabel}
                  {isToday && <span style={{ marginLeft: 6, color: "#2d6a4f", fontWeight: 600 }}>today</span>}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// CALENDAR
// ═══════════════════════════════════════════════════════
function MiniCalendar({ year, month, selectedDates = [], approvedDates = [], pendingDates = [], holidayDates = [], holidayNames = {}, onToggleDate, allEmpTimeOff = {}, isAdmin, employees = [] }) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const today = new Date();
  const todayStr = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
        {DAYS_SHORT.map(d => <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 600, color: "#8a8a8a", padding: "4px 0", fontFamily: "var(--mono)" }}>{d}</div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const dk = dateKey(year, month, d);
          const weekend = isWeekend(year, month, d);
          const isToday = dk === todayStr;
          const isPast = new Date(year, month, d) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
          const isSel = selectedDates.includes(dk);
          const isApp = approvedDates.includes(dk);
          const isPend = pendingDates.includes(dk);
          const isHol = holidayDates.includes(dk);

          let bg = "transparent", clr = weekend ? "#ccc" : isPast ? "#bbb" : "#2d2d2d", bdr = "1.5px solid transparent";
          if (isSel) { bg = "#2d6a4f"; clr = "#fff"; }
          else if (isHol) { bg = "#EDE9FE"; clr = "#6A4C93"; }
          else if (isApp) { bg = "#d4edda"; clr = "#155724"; }
          else if (isPend) { bg = "#fff3cd"; clr = "#856404"; }
          if (isToday && !isSel && !isApp && !isHol) bdr = "1.5px solid #2d6a4f";

          let dots = [];
          if (isAdmin && employees.length) employees.forEach((emp, idx) => {
            if ((allEmpTimeOff[emp.id] || []).includes(dk)) dots.push(EMP_COLORS[idx % EMP_COLORS.length]);
          });

          const clickable = !weekend && !isHol && onToggleDate;
          return (
            <div key={dk} onClick={() => clickable && onToggleDate(dk)} title={isHol ? holidayNames[dk] : undefined}
              style={{ position: "relative", textAlign: "center", padding: "6px 2px", fontSize: 13, fontFamily: "var(--mono)", borderRadius: 6, border: bdr, cursor: clickable ? "pointer" : "default", background: bg, color: clr, fontWeight: isToday || isHol ? 700 : 400, opacity: isPast && !isSel && !isApp && !isPend && !isHol ? 0.65 : 1, transition: "all 0.15s" }}>
              {d}
              {isHol && <div style={{ position: "absolute", top: 1, right: 2, fontSize: 7 }}>★</div>}
              {dots.length > 0 && <div style={{ display: "flex", justifyContent: "center", gap: 2, marginTop: 2 }}>{dots.slice(0,3).map((c,j) => <div key={j} style={{ width: 5, height: 5, borderRadius: "50%", background: c }} />)}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CalNav({ year, month, onPrev, onNext }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
      <button onClick={onPrev} style={sNavBtn}>←</button>
      <span style={{ fontSize: 18, fontWeight: 700, fontFamily: "var(--serif)" }}>{MONTHS[month]} {year}</span>
      <button onClick={onNext} style={sNavBtn}>→</button>
    </div>
  );
}

function Legend({ color, label, border }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#888" }}><div style={{ width: 10, height: 10, borderRadius: 3, background: color, border: border ? `1px solid ${border}` : "none" }} /> {label}</div>;
}

// ═══════════════════════════════════════════════════════
// TIME OFF PANEL (shared)
// ═══════════════════════════════════════════════════════
function TimeOffPanel({ calYear, calMonth, prevMonth, nextMonth, selectedDates, toggleDate, myApproved, myPendingDates, myPendingReqs, holidayDates, holidayNames, remaining, usedDays, pendDays, requestNote, setRequestNote, submitReq, clearSelection }) {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 24 }}>
        {[{ val: remaining, label: "Available", color: "#2d6a4f" }, { val: usedDays, label: "Used", color: "#E07A5F" }, { val: pendDays, label: "Pending", color: "#F2CC8F" }].map(s => (
          <div key={s.label} style={sStatCard}><div style={{ fontSize: 28, fontWeight: 800, fontFamily: "var(--serif)", color: s.color }}>{s.val}</div><div style={sStatLabel}>{s.label}</div></div>
        ))}
      </div>
      <div style={sCard}>
        <CalNav year={calYear} month={calMonth} onPrev={prevMonth} onNext={nextMonth} />
        <MiniCalendar year={calYear} month={calMonth} selectedDates={selectedDates} approvedDates={myApproved} pendingDates={myPendingDates} holidayDates={holidayDates} holidayNames={holidayNames}
          onToggleDate={dk => { if (!myApproved.includes(dk) && !myPendingDates.includes(dk)) toggleDate(dk); }} />
        <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Legend color="#2d6a4f" label="Selected" /><Legend color="#d4edda" label="Approved" border="#155724" /><Legend color="#fff3cd" label="Pending" border="#856404" /><Legend color="#EDE9FE" label="Holiday" border="#6A4C93" />
        </div>
      </div>
      {selectedDates.length > 0 && (
        <div style={{ ...sCard, marginTop: 16, background: "#f0f7f2" }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, fontFamily: "var(--serif)" }}>Request {businessDays(selectedDates, holidayDates)} day{businessDays(selectedDates, holidayDates) !== 1 ? "s" : ""} off</div>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 12, fontFamily: "var(--mono)" }}>{selectedDates.map(formatDate).join(", ")}</div>
          <input placeholder="Add a note (optional)" value={requestNote} onChange={e => setRequestNote(e.target.value)} style={{ ...sInput, marginBottom: 10, fontSize: 13 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submitReq} style={sPrimBtn}>Submit Request</button>
            <button onClick={clearSelection} style={{ ...sNavBtn, fontSize: 13, padding: "8px 16px" }}>Clear</button>
          </div>
        </div>
      )}
      {myPendingReqs.length > 0 && (
        <div style={{ ...sCard, marginTop: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, fontFamily: "var(--serif)" }}>Pending Requests</div>
          {myPendingReqs.map(req => (
            <div key={req.id} style={{ padding: "10px 0", borderBottom: "1px solid #eee" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{businessDays(req.dates, holidayDates)} day{businessDays(req.dates, holidayDates)!==1?"s":""}</div>
              <div style={{ fontSize: 11, color: "#888", fontFamily: "var(--mono)", marginTop: 2 }}>{(req.dates||[]).slice(0,3).map(formatDate).join(", ")}{(req.dates||[]).length > 3 ? ` +${req.dates.length-3} more` : ""}</div>
              {req.note && <div style={{ fontSize: 12, color: "#666", marginTop: 4, fontStyle: "italic" }}>"{req.note}"</div>}
              <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, fontFamily: "var(--mono)", background: "#FFF3CD", color: "#856404", marginTop: 6 }}>⏳ Awaiting approval</span>
            </div>
          ))}
        </div>
      )}
      {myApproved.length > 0 && (
        <div style={{ ...sCard, marginTop: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, fontFamily: "var(--serif)" }}>Approved Time Off</div>
          <div style={{ fontSize: 12, color: "#666", fontFamily: "var(--mono)", lineHeight: 1.8 }}>{[...myApproved].sort().map(formatDate).join(" · ")}</div>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [name, setName] = useState("");
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false); const [done, setDone] = useState(false);
  const go = async () => {
    setError(""); setLoading(true);
    try {
      if (mode === "signup") { if (!name.trim()) { setError("Name required"); setLoading(false); return; } const d = await authSignUp(email, password, name.trim()); if (d.access_token) onAuth(d); else setDone(true); }
      else onAuth(await authSignIn(email, password));
    } catch (e) { setError(e.message); }
    setLoading(false);
  };
  if (done) return (
    <div style={{ ...sCont, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ maxWidth: 400, padding: 32, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✉️</div>
        <h2 style={{ fontFamily: "var(--serif)", fontSize: 22 }}>Check your email</h2>
        <p style={{ color: "#666", fontSize: 14, marginBottom: 20 }}>Click the confirmation link, then sign in.</p>
        <button onClick={() => { setMode("login"); setDone(false); }} style={sPrimBtn}>Go to Sign In</button>
      </div>
    </div>
  );
  return (
    <div style={{ ...sCont, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ maxWidth: 400, width: "100%", padding: "40px 24px" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <img src="/logo.svg" alt="Mess" style={{ height: 32, marginBottom: 16 }} />
          <h1 style={{ fontFamily: "var(--serif)", fontSize: 28, fontWeight: 800, margin: 0 }}>Time Off Tracker</h1>
          <p style={{ color: "#888", fontSize: 13, marginTop: 6, fontFamily: "var(--mono)" }}>{mode === "login" ? "Sign in to continue" : "Create your account"}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          {mode === "signup" && <input placeholder="Full name" value={name} onChange={e => setName(e.target.value)} style={sInput} />}
          <input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} style={sInput} />
          <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && go()} style={sInput} />
        </div>
        {error && <p style={{ color: "#E07A5F", fontSize: 12, marginBottom: 12 }}>{error}</p>}
        <button onClick={go} disabled={loading} style={{ ...sPrimBtn, width: "100%", padding: "12px 0", opacity: loading ? 0.6 : 1 }}>{loading ? "..." : mode === "login" ? "Sign In" : "Create Account"}</button>
        <p style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: "#888" }}>
          {mode === "login" ? "No account? " : "Have an account? "}
          <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }} style={{ background: "none", border: "none", color: "#2d6a4f", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>{mode === "login" ? "Sign up" : "Sign in"}</button>
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════
function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [requests, setRequests] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [appState, setAppState] = useState("init");
  const [error, setError] = useState("");

  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [selectedDates, setSelectedDates] = useState([]);
  const [requestNote, setRequestNote] = useState("");
  const [tab, setTab] = useState("timeoff"); // unified tab for both roles
  const [editingEmp, setEditingEmp] = useState(null);
  const [viewingProfile, setViewingProfile] = useState(null); // profile ID for team detail view

  useEffect(() => { const s = loadSessionStorage(); if (s) setSession(s); setAppState("ready"); }, []);

  const token = session?.access_token;
  const userId = session?.user?.id;
  const isAdmin = profile?.role === "admin";

  const holidayDates = (holidays || []).map(h => h.date);
  const holidayNames = {}; (holidays || []).forEach(h => { holidayNames[h.date] = h.name; });

  const handleAuth = useCallback((d) => { setSession(d); saveSession(d); }, []);
  const doSignOut = useCallback(async () => { if (token) await authSignOut(token); clearSession(); setSession(null); setProfile(null); setProfiles([]); setRequests([]); setHolidays([]); }, [token]);

  const loadData = useCallback(async () => {
    if (!token || !userId) return;
    setError("");
    try {
      const [profs, hols] = await Promise.all([fetchProfiles(token), fetchHolidays(token)]);
      setProfiles(Array.isArray(profs) ? profs : []);
      setHolidays(Array.isArray(hols) ? hols : []);
      const me = (profs || []).find(p => p.id === userId);
      setProfile(me || null);
      const reqs = me?.role === "admin" ? await fetchRequests(token) : await fetchRequests(token, userId);
      setRequests(Array.isArray(reqs) ? reqs : []);
    } catch (e) {
      setError(e.message);
      if (e.message?.includes("JWT") || e.message?.includes("expired")) { clearSession(); setSession(null); }
    }
  }, [token, userId]);

  useEffect(() => { if (session && token) loadData(); }, [session, token, loadData]);

  // Set default tab based on role once profile loads
  useEffect(() => { if (profile && tab === "timeoff") setTab("timeoff"); }, [profile]);

  const prevMonth = () => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y-1); } else setCalMonth(m => m-1); };
  const nextMonth = () => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y+1); } else setCalMonth(m => m+1); };
  const toggleDate = dk => setSelectedDates(p => p.includes(dk) ? p.filter(d => d !== dk) : [...p, dk].sort());

  const myApproved = (requests || []).filter(r => r.employee_id === userId && r.status === "approved").flatMap(r => r.dates || []);
  const myPendingReqs = (requests || []).filter(r => r.employee_id === userId && r.status === "pending");
  const myPendingDates = myPendingReqs.flatMap(r => r.dates || []);
  const usedDays = businessDays(myApproved, holidayDates);
  const pendDays = businessDays(myPendingDates, holidayDates);
  const remaining = profile ? profile.allowance_days - usedDays - pendDays : 0;

  const allEmpTimeOff = {};
  (requests || []).filter(r => r.status === "approved").forEach(r => { if (!allEmpTimeOff[r.employee_id]) allEmpTimeOff[r.employee_id] = []; allEmpTimeOff[r.employee_id].push(...(r.dates || [])); });
  const allPending = (requests || []).filter(r => r.status === "pending");

  const submitReq = async () => { if (!selectedDates.length) return; try { await postRequest(userId, selectedDates, requestNote, token); setSelectedDates([]); setRequestNote(""); await loadData(); } catch (e) { setError(e.message); } };
  const handleReq = async (id, action) => { try { if (action === "approve") await patchRequest(id, { status: "approved", reviewed_by: userId }, token); else await removeRequest(id, token); await loadData(); } catch (e) { setError(e.message); } };
  const handleAddHoliday = async (name, date) => { try { await addHoliday(name, date, userId, token); await loadData(); } catch (e) { setError(e.message); } };
  const handleDeleteHoliday = async (id) => { try { await deleteHoliday(id, token); await loadData(); } catch (e) { setError(e.message); } };
  const handleSaveProfile = async (id, updates) => { try { await patchProfile(id, updates, token); await loadData(); } catch (e) { setError(e.message); } };

  const exportICS = () => {
    const ics = generateICS(profiles, requests, holidays);
    const blob = new Blob([ics], { type: "text/calendar" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "team-time-off.ics"; a.click(); URL.revokeObjectURL(url);
  };

  // Tab definitions
  const empTabs = [
    { key: "timeoff", label: "Time Off" },
    { key: "myprofile", label: "My Profile" },
  ];
  const adminTabs = [
    { key: "timeoff", label: "My Time Off" },
    { key: "myprofile", label: "My Profile" },
    { key: "team", label: "Team" },
    { key: "requests", label: `Requests${allPending.length ? ` (${allPending.length})` : ""}` },
    { key: "holidays", label: "Holidays" },
    { key: "calendar", label: "Calendar" },
  ];
  const tabs = isAdmin ? adminTabs : empTabs;

  // ─── RENDER ───
  if (appState === "init") return <div style={{ ...sCont, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ fontFamily: "var(--serif)", fontSize: 20 }}>Loading...</div></div>;
  if (!session) return <AuthScreen onAuth={handleAuth} />;

  const sidebar = (
    <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #eee", padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--serif)", marginBottom: 8 }}>Upcoming</div>
      <UpcomingSidebar profiles={profiles} requests={requests} holidays={holidays} />
    </div>
  );

  return (
    <div style={sCont}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>

        {/* HEADER */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src="/logo.svg" alt="Mess" style={{ height: 20 }} />
            <div>
              <h1 style={{ fontFamily: "var(--serif)", fontSize: 20, fontWeight: 800, margin: 0 }}>{profile?.name || "Loading..."}</h1>
              {profile && <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: isAdmin ? "#2d6a4f" : "#888", background: isAdmin ? "#E8F5E9" : "#f0f0f0", padding: "2px 8px", borderRadius: 10 }}>{profile.role}</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={loadData} style={{ ...sNavBtn, fontSize: 13, padding: "5px 10px" }} title="Refresh">↻</button>
            <button onClick={doSignOut} style={{ ...sNavBtn, fontSize: 12, padding: "5px 12px", color: "#999" }}>Sign Out</button>
          </div>
        </div>

        {error && (
          <div style={{ background: "#FEE", border: "1px solid #FCC", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#C00" }}>
            {error}<button onClick={() => setError("")} style={{ float: "right", background: "none", border: "none", cursor: "pointer", fontSize: 16 }}>✕</button>
          </div>
        )}

        {!profile && !error && <div style={{ textAlign: "center", padding: 60, color: "#aaa", fontFamily: "var(--serif)", fontSize: 18 }}>Loading your profile...</div>}

        {!profile && error && (
          <div style={{ ...sCard, textAlign: "center", padding: 32 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Profile not found</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}><button onClick={loadData} style={sPrimBtn}>Retry</button><button onClick={doSignOut} style={sNavBtn}>Sign Out</button></div>
          </div>
        )}

        {profile && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 20, alignItems: "start" }}>
            <div style={{ minWidth: 0 }}>

              {/* TABS */}
              <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "2px solid #eee", flexWrap: "wrap" }}>
                {tabs.map(t => (
                  <button key={t.key} onClick={() => { setTab(t.key); setViewingProfile(null); }} style={{
                    background: "none", border: "none", padding: "10px 12px", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "var(--mono)",
                    color: tab === t.key ? "#2d6a4f" : "#999", borderBottom: tab === t.key ? "2px solid #2d6a4f" : "2px solid transparent", marginBottom: -2,
                  }}>{t.label}</button>
                ))}
                {isAdmin && <>
                  <div style={{ flex: 1 }} />
                  <button onClick={exportICS} style={{ ...sNavBtn, fontSize: 11, padding: "4px 10px", color: "#2d6a4f", borderColor: "#2d6a4f", alignSelf: "center" }}>📅 .ics</button>
                </>}
              </div>

              {/* TIME OFF */}
              {tab === "timeoff" && (
                <TimeOffPanel calYear={calYear} calMonth={calMonth} prevMonth={prevMonth} nextMonth={nextMonth}
                  selectedDates={selectedDates} toggleDate={toggleDate} myApproved={myApproved} myPendingDates={myPendingDates}
                  myPendingReqs={myPendingReqs} holidayDates={holidayDates} holidayNames={holidayNames}
                  remaining={remaining} usedDays={usedDays} pendDays={pendDays}
                  requestNote={requestNote} setRequestNote={setRequestNote} submitReq={submitReq} clearSelection={() => setSelectedDates([])} />
              )}

              {/* MY PROFILE */}
              {tab === "myprofile" && profile && (
                <ProfileDetail profile={profile} canEdit={true}
                  onSave={async (updates) => { await handleSaveProfile(profile.id, updates); }} />
              )}

              {/* TEAM (admin only) */}
              {tab === "team" && isAdmin && !viewingProfile && (
                (profiles || []).map((emp, idx) => {
                  const empApp = (requests || []).filter(r => r.employee_id === emp.id && r.status === "approved").flatMap(r => r.dates || []);
                  const empPend = (requests || []).filter(r => r.employee_id === emp.id && r.status === "pending").flatMap(r => r.dates || []);
                  const used = businessDays(empApp, holidayDates);
                  const pend = businessDays(empPend, holidayDates);
                  const pct = emp.allowance_days > 0 ? (used / emp.allowance_days) * 100 : 0;
                  return (
                    <div key={emp.id} style={{ ...sCard, marginBottom: 10, cursor: "pointer", transition: "box-shadow 0.15s" }}
                      onClick={() => setViewingProfile(emp.id)}
                      onMouseEnter={e => e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)"}
                      onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 10, background: EMP_COLORS[idx % EMP_COLORS.length], display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "var(--serif)", flexShrink: 0 }}>
                          {(emp.name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0,2)}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 15, fontWeight: 700 }}>{emp.name}</span>
                            {emp.role === "admin" && <span style={{ fontSize: 10, color: "#2d6a4f", fontFamily: "var(--mono)" }}>admin</span>}
                          </div>
                          {emp.title && <div style={{ fontSize: 12, color: "#888" }}>{emp.title}</div>}
                        </div>
                        <div style={{ fontSize: 12, color: "#999", fontFamily: "var(--mono)", textAlign: "right", flexShrink: 0 }}>
                          {emp.allowance_days - used - pend} left
                        </div>
                      </div>
                      <div style={{ background: "#f0f0f0", borderRadius: 4, height: 5, overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 4, width: `${Math.min(pct,100)}%`, background: pct > 90 ? "#E07A5F" : "#2d6a4f", transition: "width 0.3s" }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", fontFamily: "var(--mono)", marginTop: 4 }}>
                        <span>{used} used{pend > 0 ? ` · ${pend} pending` : ""}</span>
                        <span>{emp.allowance_days} total</span>
                      </div>
                    </div>
                  );
                })
              )}

              {/* TEAM MEMBER DETAIL */}
              {tab === "team" && isAdmin && viewingProfile && (() => {
                const emp = profiles.find(p => p.id === viewingProfile);
                if (!emp) return <div>Profile not found</div>;
                return (
                  <ProfileDetail profile={emp} canEdit={true} backLabel="Team"
                    onBack={() => setViewingProfile(null)}
                    onSave={async (updates) => { await handleSaveProfile(emp.id, updates); }} />
                );
              })()}

              {/* REQUESTS (admin) */}
              {tab === "requests" && isAdmin && (
                allPending.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 40, color: "#aaa" }}><div style={{ fontSize: 32, marginBottom: 8 }}>✓</div><div style={{ fontFamily: "var(--mono)", fontSize: 13 }}>No pending requests</div></div>
                ) : allPending.map(req => {
                  const emp = (profiles || []).find(p => p.id === req.employee_id);
                  return (
                    <div key={req.id} style={{ ...sCard, marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700 }}>{emp?.name || "Unknown"}</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#2d6a4f", marginTop: 2 }}>{businessDays(req.dates, holidayDates)} day{businessDays(req.dates, holidayDates)!==1?"s":""}</div>
                          <div style={{ fontSize: 11, color: "#888", fontFamily: "var(--mono)", marginTop: 4 }}>
                            {(req.dates||[]).slice(0,4).map(formatDate).join(", ")}{(req.dates||[]).length > 4 ? ` +${req.dates.length-4} more` : ""}
                          </div>
                          {req.note && <div style={{ fontSize: 12, color: "#666", marginTop: 6, fontStyle: "italic" }}>"{req.note}"</div>}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          <button onClick={() => handleReq(req.id, "approve")} style={{ ...sPrimBtn, padding: "6px 14px", fontSize: 12 }}>Approve</button>
                          <button onClick={() => handleReq(req.id, "deny")} style={{ ...sNavBtn, fontSize: 12, padding: "6px 14px", color: "#E07A5F", borderColor: "#E07A5F" }}>Deny</button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              {/* HOLIDAYS (admin) */}
              {tab === "holidays" && isAdmin && (
                <div>
                  <div style={{ ...sCard, marginBottom: 16 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, fontFamily: "var(--serif)" }}>Add Company Holiday</div>
                    <AddHolidayForm onAdd={handleAddHoliday} />
                    <p style={{ fontSize: 11, color: "#999", marginTop: 8, fontFamily: "var(--mono)" }}>Holidays don't count against vacation allowances.</p>
                  </div>
                  {(holidays || []).length === 0 ? (
                    <div style={{ textAlign: "center", padding: 32, color: "#bbb" }}><div style={{ fontSize: 32, marginBottom: 8 }}>🏢</div><div style={{ fontFamily: "var(--mono)", fontSize: 13 }}>No holidays added yet</div></div>
                  ) : (holidays || []).map(h => (
                    <div key={h.id} style={{ ...sCard, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div><div style={{ fontSize: 14, fontWeight: 600 }}>{h.name}</div><div style={{ fontSize: 12, color: "#888", fontFamily: "var(--mono)", marginTop: 2 }}>{formatDate(h.date)}</div></div>
                      <button onClick={() => handleDeleteHoliday(h.id)} style={sIconBtn}>🗑</button>
                    </div>
                  ))}
                </div>
              )}

              {/* CALENDAR (admin) */}
              {tab === "calendar" && isAdmin && (
                <div style={sCard}>
                  <CalNav year={calYear} month={calMonth} onPrev={prevMonth} onNext={nextMonth} />
                  <MiniCalendar year={calYear} month={calMonth} selectedDates={[]} approvedDates={[]} pendingDates={[]}
                    holidayDates={holidayDates} holidayNames={holidayNames}
                    allEmpTimeOff={allEmpTimeOff} isAdmin={true} employees={profiles} />
                  <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {(profiles || []).map((emp, idx) => (
                      <div key={emp.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#666" }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: EMP_COLORS[idx % EMP_COLORS.length] }} /> {emp.name}
                      </div>
                    ))}
                    <Legend color="#EDE9FE" label="Holiday" border="#6A4C93" />
                  </div>
                </div>
              )}
            </div>

            {/* SIDEBAR */}
            <div style={{ position: "sticky", top: 24 }}>{sidebar}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function AddHolidayForm({ onAdd }) {
  const [name, setName] = useState(""); const [date, setDate] = useState("");
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <input placeholder="Holiday name" value={name} onChange={e => setName(e.target.value)} style={{ ...sInput, flex: 2, minWidth: 140, fontSize: 13 }} />
      <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...sInput, fontSize: 13 }} />
      <button onClick={() => { if (name.trim() && date) { onAdd(name.trim(), date); setName(""); setDate(""); } }} style={{ ...sPrimBtn, padding: "8px 16px", fontSize: 12 }}>Add</button>
    </div>
  );
}

export default function VacationTracker() {
  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      <style>{`:root { --serif: 'Fraunces', serif; --mono: 'JetBrains Mono', monospace; }`}</style>
      <ErrorBoundary><App /></ErrorBoundary>
    </>
  );
}

// ─── Styles ───
const sCont = { minHeight: "100vh", background: "#fafaf8", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: "#1a1a1a" };
const sCard = { background: "#fff", borderRadius: 12, padding: 18, border: "1px solid #eee" };
const sStatCard = { background: "#fff", borderRadius: 12, padding: "14px 10px", textAlign: "center", border: "1px solid #eee" };
const sStatLabel = { fontSize: 10, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: 1, marginTop: 2, fontFamily: "var(--mono)" };
const sInput = { padding: "10px 12px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 14, outline: "none", background: "#fff", boxSizing: "border-box" };
const sPrimBtn = { background: "#2d6a4f", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const sNavBtn = { background: "none", border: "1.5px solid #ddd", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 16, color: "#555", fontWeight: 600 };
const sIconBtn = { background: "none", border: "none", cursor: "pointer", fontSize: 14, padding: 2 };
const sFieldLabel = { fontSize: 10, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: 1, marginBottom: 3, fontFamily: "var(--mono)" };
