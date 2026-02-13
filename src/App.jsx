import { useState, useEffect, useCallback } from "react";

// ═══════════════════════════════════════════════════════
// CONFIGURATION — Replace with your Supabase project details
// ═══════════════════════════════════════════════════════
const SUPABASE_URL = "https://hhobwuwautnddjzewizo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhob2J3dXdhdXRuZGRqemV3aXpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5NTEyMjIsImV4cCI6MjA4NjUyNzIyMn0.xCTHExXgBiEFMzzr1T-APrejG2vHJ3CNIMVUy1pqp4A";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const EMP_COLORS = [
  "#E07A5F","#3D405B","#81B29A","#F2CC8F","#6A4C93",
  "#1982C4","#FF595E","#8AC926","#CA6702","#9B5DE5"
];

// ─── Utilities ───
function getDaysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function getFirstDayOfMonth(y, m) { return new Date(y, m, 1).getDay(); }
function dateKey(y, m, d) { return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }
function isWeekend(y, m, d) { const day = new Date(y, m, d).getDay(); return day === 0 || day === 6; }

function businessDays(dates) {
  return dates.filter(dk => {
    const [y,m,d] = dk.split("-").map(Number);
    return !isWeekend(y, m-1, d);
  }).length;
}

function formatDate(dk) {
  const [y,m,d] = dk.split("-").map(Number);
  return `${MONTHS[m-1]} ${d}, ${y}`;
}

function toICSDate(dk) { return dk.replace(/-/g, ""); }

function generateICS(employees, requests) {
  let ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//VacationTracker//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:Team Time Off\r\n`;
  const approved = requests.filter(r => r.status === "approved");

  approved.forEach((req, i) => {
    const emp = employees.find(e => e.id === req.employee_id);
    if (!emp) return;
    const dates = (req.dates || []).sort();
    if (!dates.length) return;

    let ranges = [], start = dates[0], prev = dates[0];
    for (let j = 1; j < dates.length; j++) {
      if ((new Date(dates[j]) - new Date(prev)) / 86400000 <= 3) { prev = dates[j]; }
      else { ranges.push([start, prev]); start = dates[j]; prev = dates[j]; }
    }
    ranges.push([start, prev]);

    ranges.forEach((r, k) => {
      const end = new Date(r[1]); end.setDate(end.getDate() + 1);
      const endStr = `${end.getFullYear()}${String(end.getMonth()+1).padStart(2,"0")}${String(end.getDate()).padStart(2,"0")}`;
      ics += `BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:${toICSDate(r[0])}\r\nDTEND;VALUE=DATE:${endStr}\r\nSUMMARY:${emp.name} - Time Off\r\nUID:${req.id}-${k}@vacationtracker\r\nSTATUS:CONFIRMED\r\nTRANSP:TRANSPARENT\r\nEND:VEVENT\r\n`;
    });
  });
  ics += `END:VCALENDAR`;
  return ics;
}

// ─── Supabase API Helpers ───
async function sbFetch(path, { method = "GET", body, token, headers: extra = {} } = {}) {
  const url = `${SUPABASE_URL}${path}`;
  const headers = {
    "apikey": SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
    ...extra,
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  else headers["Authorization"] = `Bearer ${SUPABASE_ANON_KEY}`;

  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(typeof data === "object" ? (data.error_description || data.msg || data.message || JSON.stringify(data)) : data);
  return data;
}

async function authSignUp(email, password, name) {
  return sbFetch("/auth/v1/signup", { method: "POST", body: { email, password, data: { name } } });
}
async function authSignIn(email, password) {
  return sbFetch("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
}
async function authSignOut(token) {
  try { await sbFetch("/auth/v1/logout", { method: "POST", token }); } catch {}
}

async function fetchProfiles(token) {
  return sbFetch("/rest/v1/profiles?select=*&order=name", { token });
}
async function patchProfile(id, updates, token) {
  return sbFetch(`/rest/v1/profiles?id=eq.${id}`, { method: "PATCH", body: updates, token, headers: { "Prefer": "return=representation" } });
}
async function removeProfile(id, token) {
  return sbFetch(`/rest/v1/profiles?id=eq.${id}`, { method: "DELETE", token });
}
async function fetchRequests(token, empId) {
  const filter = empId ? `&employee_id=eq.${empId}` : "";
  return sbFetch(`/rest/v1/time_off_requests?select=*${filter}&order=created_at.desc`, { token });
}
async function postRequest(empId, dates, note, token) {
  return sbFetch("/rest/v1/time_off_requests", { method: "POST", body: { employee_id: empId, dates, note: note || null }, token, headers: { "Prefer": "return=representation" } });
}
async function patchRequest(id, updates, token) {
  return sbFetch(`/rest/v1/time_off_requests?id=eq.${id}`, { method: "PATCH", body: updates, token, headers: { "Prefer": "return=representation" } });
}
async function removeRequest(id, token) {
  return sbFetch(`/rest/v1/time_off_requests?id=eq.${id}`, { method: "DELETE", token });
}

// ─── Calendar ───
function MiniCalendar({ year, month, selectedDates, approvedDates, pendingDates, onToggleDate, allEmpTimeOff, isAdmin, employees }) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const today = new Date();
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
        {DAYS_SHORT.map(d => (
          <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 600, color: "#8a8a8a", padding: "4px 0", fontFamily: "var(--mono)" }}>{d}</div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {cells.map((d, i) => {
          if (!d) return <div key={`e${i}`} />;
          const dk = dateKey(year, month, d);
          const weekend = isWeekend(year, month, d);
          const isToday = dk === todayKey;
          const isPast = new Date(year, month, d) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
          const isSel = selectedDates?.includes(dk);
          const isApp = approvedDates?.includes(dk);
          const isPend = pendingDates?.includes(dk);

          let bg = "transparent", clr = weekend ? "#ccc" : isPast ? "#bbb" : "#2d2d2d", bdr = "1.5px solid transparent";
          if (isSel) { bg = "#2d6a4f"; clr = "#fff"; }
          else if (isApp) { bg = "#d4edda"; clr = "#155724"; }
          else if (isPend) { bg = "#fff3cd"; clr = "#856404"; }
          if (isToday && !isSel && !isApp) bdr = "1.5px solid #2d6a4f";

          let dots = [];
          if (isAdmin && employees) {
            employees.forEach((emp, idx) => {
              if ((allEmpTimeOff?.[emp.id] || []).includes(dk)) dots.push(EMP_COLORS[idx % EMP_COLORS.length]);
            });
          }

          return (
            <div key={dk} onClick={() => !weekend && !isPast && onToggleDate?.(dk)}
              title={dots.length ? employees.filter((e,idx) => (allEmpTimeOff?.[e.id]||[]).includes(dk)).map(e=>e.name).join(", ") : undefined}
              style={{ position: "relative", textAlign: "center", padding: "6px 2px", fontSize: 13, fontFamily: "var(--mono)", borderRadius: 6, border: bdr, cursor: weekend || isPast || !onToggleDate ? "default" : "pointer", background: bg, color: clr, fontWeight: isToday ? 700 : 400, opacity: isPast && !isApp && !isPend ? 0.5 : 1, transition: "all 0.15s" }}>
              {d}
              {dots.length > 0 && (
                <div style={{ display: "flex", justifyContent: "center", gap: 2, marginTop: 2 }}>
                  {dots.slice(0,3).map((c,j) => <div key={j} style={{ width: 5, height: 5, borderRadius: "50%", background: c }} />)}
                </div>
              )}
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
      <span style={{ fontSize: 18, fontWeight: 700, fontFamily: "var(--serif)", color: "#1a1a1a" }}>{MONTHS[month]} {year}</span>
      <button onClick={onNext} style={sNavBtn}>→</button>
    </div>
  );
}

function Legend({ color, label, border }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#888" }}>
      <div style={{ width: 10, height: 10, borderRadius: 3, background: color, border: border ? `1px solid ${border}` : "none" }} /> {label}
    </div>
  );
}

function EditForm({ emp, onSave, onCancel }) {
  const [name, setName] = useState(emp.name);
  const [days, setDays] = useState(emp.allowance_days);
  const [role, setRole] = useState(emp.role);
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <input value={name} onChange={e => setName(e.target.value)} style={{ ...sInput, flex: 2, minWidth: 120 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input type="number" value={days} onChange={e => setDays(parseInt(e.target.value)||0)} style={{ ...sInput, width: 55, textAlign: "center" }} />
        <span style={{ fontSize: 12, color: "#888" }}>days</span>
      </div>
      <select value={role} onChange={e => setRole(e.target.value)} style={{ ...sInput, padding: "8px 6px", fontSize: 12 }}>
        <option value="employee">employee</option>
        <option value="admin">admin</option>
      </select>
      <button onClick={() => onSave({ name, allowance_days: days, role })} style={{ ...sPrimBtn, padding: "6px 14px", fontSize: 12 }}>Save</button>
      <button onClick={onCancel} style={{ ...sNavBtn, fontSize: 12, padding: "6px 10px" }}>✕</button>
    </div>
  );
}

// ─── Config Screen ───
function ConfigScreen() {
  return (
    <div style={{ ...sCont, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ maxWidth: 460, padding: 32, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⚙️</div>
        <h2 style={{ fontFamily: "var(--serif)", fontSize: 24, marginBottom: 8 }}>Setup Required</h2>
        <p style={{ color: "#666", lineHeight: 1.6, marginBottom: 20, fontSize: 14 }}>
          Add your Supabase project URL and anon key at the top of the file. Find them in <strong>Settings → API</strong>.
        </p>
        <div style={{ background: "#f4f4f4", borderRadius: 8, padding: 16, fontFamily: "var(--mono)", fontSize: 12, textAlign: "left", lineHeight: 1.8 }}>
          <div style={{ color: "#888" }}>// Top of file</div>
          <div><span style={{ color: "#2d6a4f" }}>const</span> SUPABASE_URL = <span style={{ color: "#E07A5F" }}>"https://xyz.supabase.co"</span>;</div>
          <div><span style={{ color: "#2d6a4f" }}>const</span> SUPABASE_ANON_KEY = <span style={{ color: "#E07A5F" }}>"eyJ..."</span>;</div>
        </div>
      </div>
    </div>
  );
}

// ─── Auth Screen ───
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const go = async () => {
    setError(""); setLoading(true);
    try {
      if (mode === "signup") {
        if (!name.trim()) { setError("Name required"); setLoading(false); return; }
        const data = await authSignUp(email, password, name.trim());
        if (data.access_token) onAuth(data);
        else setDone(true);
      } else {
        onAuth(await authSignIn(email, password));
      }
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  if (done) return (
    <div style={{ ...sCont, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ maxWidth: 400, padding: 32, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✉️</div>
        <h2 style={{ fontFamily: "var(--serif)", fontSize: 22, marginBottom: 8 }}>Check your email</h2>
        <p style={{ color: "#666", fontSize: 14, marginBottom: 20 }}>Click the confirmation link, then come back and sign in.</p>
        <button onClick={() => { setMode("login"); setDone(false); }} style={sPrimBtn}>Go to Sign In</button>
      </div>
    </div>
  );

  return (
    <div style={{ ...sCont, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ maxWidth: 400, width: "100%", padding: "40px 24px" }}>
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🌴</div>
          <h1 style={{ fontFamily: "var(--serif)", fontSize: 28, fontWeight: 800, margin: 0, letterSpacing: -0.5 }}>Time Off Tracker</h1>
          <p style={{ color: "#888", fontSize: 13, marginTop: 6, fontFamily: "var(--mono)" }}>
            {mode === "login" ? "Sign in to continue" : "Create your account"}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          {mode === "signup" && <input placeholder="Full name" value={name} onChange={e => setName(e.target.value)} style={sInput} />}
          <input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} style={sInput} />
          <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && go()} style={sInput} />
        </div>
        {error && <p style={{ color: "#E07A5F", fontSize: 12, marginBottom: 12 }}>{error}</p>}
        <button onClick={go} disabled={loading} style={{ ...sPrimBtn, width: "100%", padding: "12px 0", opacity: loading ? 0.6 : 1 }}>
          {loading ? "..." : mode === "login" ? "Sign In" : "Create Account"}
        </button>
        <p style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: "#888" }}>
          {mode === "login" ? "No account? " : "Have an account? "}
          <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
            style={{ background: "none", border: "none", color: "#2d6a4f", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
            {mode === "login" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════
export default function VacationTracker() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [selectedDates, setSelectedDates] = useState([]);
  const [requestNote, setRequestNote] = useState("");

  const [adminTab, setAdminTab] = useState("employees");
  const [editingEmp, setEditingEmp] = useState(null);

  const token = session?.access_token;
  const isAdmin = profile?.role === "admin";

  const fonts = (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
      <style>{`:root { --serif: 'Fraunces', serif; --mono: 'JetBrains Mono', monospace; }`}</style>
    </>
  );

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return <>{fonts}<ConfigScreen /></>;
  if (!session) return <>{fonts}<AuthScreen onAuth={setSession} /></>;

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const profs = await fetchProfiles(token);
      setProfiles(profs);
      const me = profs.find(p => p.id === session.user.id);
      setProfile(me);
      // Admins get all requests, employees get their own
      const reqs = me?.role === "admin"
        ? await fetchRequests(token)
        : await fetchRequests(token, session.user.id);
      setRequests(reqs);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [token, session?.user?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  const doSignOut = async () => {
    await authSignOut(token);
    setSession(null); setProfile(null); setProfiles([]); setRequests([]);
  };

  const prevMonth = () => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y-1); } else setCalMonth(m => m-1); };
  const nextMonth = () => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y+1); } else setCalMonth(m => m+1); };
  const toggleDate = (dk) => setSelectedDates(p => p.includes(dk) ? p.filter(d => d !== dk) : [...p, dk].sort());

  // Employee computed
  const myApproved = requests.filter(r => r.employee_id === session?.user?.id && r.status === "approved").flatMap(r => r.dates);
  const myPendingReqs = requests.filter(r => r.employee_id === session?.user?.id && r.status === "pending");
  const myPendingDates = myPendingReqs.flatMap(r => r.dates);
  const usedDays = businessDays(myApproved);
  const pendDays = businessDays(myPendingDates);
  const remaining = profile ? profile.allowance_days - usedDays - pendDays : 0;

  // Admin computed
  const allEmpTimeOff = {};
  requests.filter(r => r.status === "approved").forEach(r => {
    if (!allEmpTimeOff[r.employee_id]) allEmpTimeOff[r.employee_id] = [];
    allEmpTimeOff[r.employee_id].push(...r.dates);
  });
  const allPending = requests.filter(r => r.status === "pending");

  const submitReq = async () => {
    if (!selectedDates.length) return;
    try {
      await postRequest(session.user.id, selectedDates, requestNote, token);
      setSelectedDates([]); setRequestNote("");
      await loadData();
    } catch (e) { setError(e.message); }
  };

  const handleReq = async (id, action) => {
    try {
      if (action === "approve") await patchRequest(id, { status: "approved", reviewed_by: session.user.id }, token);
      else await removeRequest(id, token);
      await loadData();
    } catch (e) { setError(e.message); }
  };

  const exportICS = () => {
    const ics = generateICS(profiles, requests);
    const blob = new Blob([ics], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "team-time-off.ics"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {fonts}
      <div style={sCont}>
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "24px 16px" }}>

          {/* HEADER */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
            <div>
              <h1 style={{ fontFamily: "var(--serif)", fontSize: 20, fontWeight: 800, margin: 0 }}>{profile?.name || "Loading..."}</h1>
              <span style={{ fontSize: 11, fontFamily: "var(--mono)", color: isAdmin ? "#2d6a4f" : "#888", background: isAdmin ? "#E8F5E9" : "#f0f0f0", padding: "2px 8px", borderRadius: 10 }}>
                {isAdmin ? "admin" : "employee"}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={loadData} style={{ ...sNavBtn, fontSize: 13, padding: "5px 10px" }} title="Refresh">↻</button>
              <button onClick={doSignOut} style={{ ...sNavBtn, fontSize: 12, padding: "5px 12px", color: "#999" }}>Sign Out</button>
            </div>
          </div>

          {error && (
            <div style={{ background: "#FEE", border: "1px solid #FCC", borderRadius: 8, padding: "8px 12px", marginBottom: 16, fontSize: 12, color: "#C00" }}>
              {error} <button onClick={() => setError("")} style={{ float: "right", background: "none", border: "none", cursor: "pointer" }}>✕</button>
            </div>
          )}

          {loading && !profile && <div style={{ textAlign: "center", padding: 60, color: "#aaa", fontFamily: "var(--serif)", fontSize: 18 }}>Loading...</div>}

          {/* ═══ EMPLOYEE VIEW ═══ */}
          {profile && !isAdmin && (
            <>
              {/* Balance cards */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 24 }}>
                {[
                  { val: remaining, label: "Available", color: "#2d6a4f" },
                  { val: usedDays, label: "Used", color: "#E07A5F" },
                  { val: pendDays, label: "Pending", color: "#F2CC8F" },
                ].map(s => (
                  <div key={s.label} style={sStatCard}>
                    <div style={{ fontSize: 28, fontWeight: 800, fontFamily: "var(--serif)", color: s.color }}>{s.val}</div>
                    <div style={sStatLabel}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Calendar */}
              <div style={sCard}>
                <CalNav year={calYear} month={calMonth} onPrev={prevMonth} onNext={nextMonth} />
                <MiniCalendar year={calYear} month={calMonth}
                  selectedDates={selectedDates} approvedDates={myApproved} pendingDates={myPendingDates}
                  onToggleDate={(dk) => { if (!myApproved.includes(dk) && !myPendingDates.includes(dk)) toggleDate(dk); }}
                />
                <div style={{ marginTop: 12, display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <Legend color="#2d6a4f" label="Selected" />
                  <Legend color="#d4edda" label="Approved" border="#155724" />
                  <Legend color="#fff3cd" label="Pending" border="#856404" />
                </div>
              </div>

              {/* Request form */}
              {selectedDates.length > 0 && (
                <div style={{ ...sCard, marginTop: 16, background: "#f0f7f2" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, fontFamily: "var(--serif)" }}>
                    Request {businessDays(selectedDates)} day{businessDays(selectedDates) !== 1 ? "s" : ""} off
                  </div>
                  <div style={{ fontSize: 12, color: "#666", marginBottom: 12, fontFamily: "var(--mono)" }}>
                    {selectedDates.map(formatDate).join(", ")}
                  </div>
                  <input placeholder="Add a note (optional)" value={requestNote} onChange={e => setRequestNote(e.target.value)} style={{ ...sInput, marginBottom: 10, fontSize: 13 }} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={submitReq} style={sPrimBtn}>Submit Request</button>
                    <button onClick={() => setSelectedDates([])} style={{ ...sNavBtn, fontSize: 13, padding: "8px 16px" }}>Clear</button>
                  </div>
                </div>
              )}

              {/* Pending requests */}
              {myPendingReqs.length > 0 && (
                <div style={{ ...sCard, marginTop: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, fontFamily: "var(--serif)" }}>Pending Requests</div>
                  {myPendingReqs.map(req => (
                    <div key={req.id} style={{ padding: "10px 0", borderBottom: "1px solid #eee" }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{businessDays(req.dates)} day{businessDays(req.dates)!==1?"s":""}</div>
                      <div style={{ fontSize: 11, color: "#888", fontFamily: "var(--mono)", marginTop: 2 }}>
                        {req.dates.slice(0,3).map(formatDate).join(", ")}{req.dates.length > 3 ? ` +${req.dates.length-3} more` : ""}
                      </div>
                      {req.note && <div style={{ fontSize: 12, color: "#666", marginTop: 4, fontStyle: "italic" }}>"{req.note}"</div>}
                      <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, fontFamily: "var(--mono)", background: "#FFF3CD", color: "#856404", marginTop: 6 }}>⏳ Awaiting approval</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Approved history */}
              {myApproved.length > 0 && (
                <div style={{ ...sCard, marginTop: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, fontFamily: "var(--serif)" }}>Approved Time Off</div>
                  <div style={{ fontSize: 12, color: "#666", fontFamily: "var(--mono)", lineHeight: 1.8 }}>
                    {[...myApproved].sort().map(formatDate).join(" · ")}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ═══ ADMIN VIEW ═══ */}
          {profile && isAdmin && (
            <>
              {/* Tabs */}
              <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "2px solid #eee" }}>
                {[
                  { key: "employees", label: "Team" },
                  { key: "requests", label: `Requests${allPending.length ? ` (${allPending.length})` : ""}` },
                  { key: "calendar", label: "Calendar" },
                ].map(t => (
                  <button key={t.key} onClick={() => setAdminTab(t.key)} style={{
                    background: "none", border: "none", padding: "10px 18px", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "var(--mono)",
                    color: adminTab === t.key ? "#2d6a4f" : "#999", borderBottom: adminTab === t.key ? "2px solid #2d6a4f" : "2px solid transparent", marginBottom: -2, transition: "all 0.15s",
                  }}>{t.label}</button>
                ))}
                <div style={{ flex: 1 }} />
                <button onClick={exportICS} style={{ ...sNavBtn, fontSize: 11, padding: "4px 10px", color: "#2d6a4f", borderColor: "#2d6a4f", alignSelf: "center" }}>📅 .ics</button>
              </div>

              {/* TEAM TAB */}
              {adminTab === "employees" && profiles.map((emp, idx) => {
                const empApp = requests.filter(r => r.employee_id === emp.id && r.status === "approved").flatMap(r => r.dates);
                const empPend = requests.filter(r => r.employee_id === emp.id && r.status === "pending").flatMap(r => r.dates);
                const used = businessDays(empApp);
                const pend = businessDays(empPend);
                const pct = emp.allowance_days > 0 ? (used / emp.allowance_days) * 100 : 0;

                return (
                  <div key={emp.id} style={{ ...sCard, marginBottom: 10 }}>
                    {editingEmp === emp.id ? (
                      <EditForm emp={emp}
                        onSave={async (u) => { await patchProfile(emp.id, u, token); setEditingEmp(null); await loadData(); }}
                        onCancel={() => setEditingEmp(null)} />
                    ) : (
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 10, height: 10, borderRadius: "50%", background: EMP_COLORS[idx % EMP_COLORS.length] }} />
                            <span style={{ fontSize: 15, fontWeight: 700 }}>{emp.name}</span>
                            {emp.role === "admin" && <span style={{ fontSize: 10, color: "#2d6a4f", fontFamily: "var(--mono)" }}>admin</span>}
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => setEditingEmp(emp.id)} style={sIconBtn}>✏️</button>
                            {emp.id !== session.user.id && <button onClick={() => { if (confirm(`Remove ${emp.name}?`)) { removeProfile(emp.id, token).then(loadData); }}} style={sIconBtn}>🗑</button>}
                          </div>
                        </div>
                        <div style={{ background: "#f0f0f0", borderRadius: 4, height: 6, marginBottom: 6, overflow: "hidden" }}>
                          <div style={{ height: "100%", borderRadius: 4, width: `${Math.min(pct,100)}%`, background: pct > 90 ? "#E07A5F" : "#2d6a4f", transition: "width 0.3s" }} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#888", fontFamily: "var(--mono)" }}>
                          <span>{used} used{pend > 0 ? ` · ${pend} pending` : ""} · {emp.allowance_days - used - pend} left</span>
                          <span>{emp.allowance_days} total</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* REQUESTS TAB */}
              {adminTab === "requests" && (
                allPending.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 40, color: "#aaa" }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 13 }}>No pending requests</div>
                  </div>
                ) : allPending.map(req => {
                  const emp = profiles.find(p => p.id === req.employee_id);
                  return (
                    <div key={req.id} style={{ ...sCard, marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 700 }}>{emp?.name || "Unknown"}</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#2d6a4f", marginTop: 2 }}>{businessDays(req.dates)} day{businessDays(req.dates)!==1?"s":""}</div>
                          <div style={{ fontSize: 11, color: "#888", fontFamily: "var(--mono)", marginTop: 4 }}>
                            {req.dates.slice(0,4).map(formatDate).join(", ")}{req.dates.length > 4 ? ` +${req.dates.length-4} more` : ""}
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

              {/* CALENDAR TAB */}
              {adminTab === "calendar" && (
                <div style={sCard}>
                  <CalNav year={calYear} month={calMonth} onPrev={prevMonth} onNext={nextMonth} />
                  <MiniCalendar year={calYear} month={calMonth}
                    selectedDates={[]} approvedDates={[]} pendingDates={[]}
                    allEmpTimeOff={allEmpTimeOff} isAdmin={true} employees={profiles} />
                  <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {profiles.map((emp, idx) => (
                      <div key={emp.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#666" }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: EMP_COLORS[idx % EMP_COLORS.length] }} /> {emp.name}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Styles ───
const sCont = { minHeight: "100vh", background: "#fafaf8", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: "#1a1a1a" };
const sCard = { background: "#fff", borderRadius: 12, padding: 18, border: "1px solid #eee" };
const sStatCard = { background: "#fff", borderRadius: 12, padding: "14px 10px", textAlign: "center", border: "1px solid #eee" };
const sStatLabel = { fontSize: 10, fontWeight: 600, color: "#999", textTransform: "uppercase", letterSpacing: 1, marginTop: 2, fontFamily: "var(--mono)" };
const sInput = { padding: "10px 12px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: 14, outline: "none", background: "#fff", transition: "border-color 0.15s", boxSizing: "border-box" };
const sPrimBtn = { background: "#2d6a4f", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "all 0.15s" };
const sNavBtn = { background: "none", border: "1.5px solid #ddd", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 16, color: "#555", fontWeight: 600, transition: "all 0.15s" };
const sIconBtn = { background: "none", border: "none", cursor: "pointer", fontSize: 14, padding: 2 };
