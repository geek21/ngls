/* =====================================================================
   CONFIGURATION — REPLACE THESE TWO VALUES
   ===================================================================== */
const SUPABASE_URL = "https://uuibgvymzrzwakhixheh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1aWJndnltenJ6d2FraGl4aGVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3OTk3NTksImV4cCI6MjEwNjM3NTc1OX0.AZW5m3exi5-jfJDk3LgyfP7h6edU4jZdZiEzBy_VN-g";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Generic sequential day labels. Each department only shows its own first
// `days_per_week` of these, so "Day One" for Religion (2 days) and "Day One"
// for Math (5 days) are independent of each other and of the calendar.
const DAYS = [
  { code: "D1", ar: "اليوم الأول",   en: "Day One" },
  { code: "D2", ar: "اليوم الثاني",  en: "Day Two" },
  { code: "D3", ar: "اليوم الثالث",  en: "Day Three" },
  { code: "D4", ar: "اليوم الرابع",  en: "Day Four" },
  { code: "D5", ar: "اليوم الخامس",  en: "Day Five" },
];

let STATE = {
  settings: {},
  departments: [],
  subSubjects: [],
  currentDept: null,
  isAdmin: false,
  lockedContext: null,   // { term, week_number } when teacher arrived via a smart weekly link
  _currentLinks: [],      // access_links rows for the week currently shown in Admin dashboard
  _adminPin: null,        // kept in memory only (never persisted) after a successful admin login,
                           // so admin-only actions (add subject, change PINs) don't re-prompt every time
  teacherDirty: false,    // true while the teacher has unsaved edits in the entry form
  _loadedMaxUpdatedAt: null, // for optimistic-concurrency conflict detection on save
};

function makeToken() {
  // Short random token used in shareable URLs (?token=...)
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function baseAppUrl() {
  return window.location.origin + window.location.pathname;
}

// Escapes user-typed free text before it is ever inserted via innerHTML,
// to prevent stored HTML/script injection through classwork/homework/etc.
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// Logs to the on-page debug panel (see the 🐞 button) — mainly for
// troubleshooting from a phone where a real browser console isn't handy.
function debugLog(msg) {
  const panel = document.getElementById("debugLogContent");
  if (!panel) return;
  const time = new Date().toLocaleTimeString();
  const line = document.createElement("div");
  line.textContent = `[${time}] ${typeof msg === "string" ? msg : JSON.stringify(msg)}`;
  panel.appendChild(line);
  panel.scrollTop = panel.scrollHeight;
  document.getElementById("debugPanel")?.classList.remove("hidden");
}

window.addEventListener("error", (e) => debugLog("JS Error: " + e.message));
window.addEventListener("unhandledrejection", (e) => {
  debugLog("Unhandled rejection: " + (e.reason?.message || e.reason));
});

// Disables a button and swaps its label while an async action runs, so a
// slow connection can't be double-submitted by an impatient tap.
async function runWithLoading(buttonEl, loadingText, fn) {
  if (!buttonEl) return fn();
  const original = buttonEl.innerText;
  buttonEl.disabled = true;
  buttonEl.classList.add("opacity-60", "cursor-not-allowed");
  buttonEl.innerText = loadingText;
  try {
    return await fn();
  } finally {
    buttonEl.disabled = false;
    buttonEl.classList.remove("opacity-60", "cursor-not-allowed");
    buttonEl.innerText = original;
  }
}

// Computes the Sunday–Thursday date range for a given academic week.
// `school_start_date` is the Sunday of Week 1 (stored in school_settings).
// Returns { from: "Sun DD/MM/YYYY", to: "Thu DD/MM/YYYY" } or null if no start date set.
function weekDateRange(weekNumber) {
  const startStr = STATE.settings.school_start_date;
  if (!startStr) return null;

  // Parse YYYY-MM-DD and force it to be treated as local (not UTC)
  const [y, m, d] = startStr.split("-").map(Number);
  const weekOne = new Date(y, m - 1, d); // local midnight

  // Offset by (weekNumber - 1) full weeks
  const sunday = new Date(weekOne);
  sunday.setDate(weekOne.getDate() + (weekNumber - 1) * 7);

  const thursday = new Date(sunday);
  thursday.setDate(sunday.getDate() + 4);

  const fmt = (dt) =>
    dt.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });

  const fmtAr = (dt) =>
    dt.toLocaleDateString("ar-EG", { day: "numeric", month: "long", year: "numeric" });

  return {
    fromDate: sunday,
    toDate: thursday,
    fromEn: fmt(sunday),
    toEn: fmt(thursday),
    fromAr: fmtAr(sunday),
    toAr: fmtAr(thursday),
    label: `${fmt(sunday)} — ${fmt(thursday)}`,
    labelAr: `${fmtAr(sunday)} — ${fmtAr(thursday)}`,
  };
}

window.addEventListener("beforeunload", (e) => {
  if (STATE.teacherDirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

/* ------------------------- INIT ------------------------- */
// Use window.onload instead of DOMContentLoaded to guarantee ALL scripts
// (utils.js, teacher.js, admin.js, export.js) are fully parsed before init() runs.
window.addEventListener("load", () => {
  if (typeof init === "function") {
    init();
  } else {
    // Fallback: wait for all scripts to finish executing
    setTimeout(() => {
      if (typeof init === "function") {
        init();
      } else {
        debugLog("ERROR: init() still not found — check that js/utils.js loaded correctly");
      }
    }, 500);
  }
});
