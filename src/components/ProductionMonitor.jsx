// PG GROUP — Production Monitor
// Fully migrated from Google Apps Script to Aiven MySQL REST API
// All callServer() and getSheet() calls replaced with apiFetch()

import { useState, useEffect, useRef, useCallback } from "react";
import { Chart, registerables } from "chart.js";

Chart.register(...registerables);
if (typeof window !== "undefined") window.Chart = Chart;

// ─── Constants ────────────────────────────────────────────────────────────────
// FIX 1: API_BASE was missing its fallback value — fixed
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3000";

// ─── apiFetch — single source of truth for all HTTP calls ────────────────────
const apiFetch = async (method, path, body) => {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}/production${path}`, opts);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { success:false, message:`Server returned ${res.status} ${res.statusText}` };
  }
  if (!res.ok && data.success !== false) {
    data.success = false;
    data.message = data.message || `Server returned ${res.status} ${res.statusText}`;
  }
  return data;
};

// ─── callServer — maps legacy Apps Script action names → REST endpoints ───────
const callServer = async (action, payload = {}) => {
  switch (action) {
    case "serverGetAllSettings":
      return apiFetch("GET", "/settings");
    case "serverSaveSetting":
      return apiFetch("POST", "/settings", { key: payload.key, value: payload.value });

    case "serverAddSerial":
      return apiFetch("POST", "/serial", {
        date: payload.date, serial: payload.serial,
        model: payload.model, timestamp: payload.timestamp,
      });
    case "serverGetLastSerial":
      return apiFetch("GET", `/serial/last?model=${encodeURIComponent(payload.model)}&date=${encodeURIComponent(payload.date)}`);

    case "serverAddIdleTime":
      return apiFetch("POST", "/idle", {
        date: payload.date, fromTime: payload.fromTime, toTime: payload.toTime,
        duration: payload.duration, department: payload.department,
        reason: payload.reason, slot: payload.slot,
      });

    case "serverAddReload":
      return apiFetch("POST", "/reload", {
        date: payload.date, slot: payload.slot,
        type: payload.type, count: payload.count, timestamp: payload.timestamp,
      });

    case "serverSetManpower":
      return apiFetch("POST", "/manpower", { date: payload.date, manpower: payload.manpower });

    case "serverSetSerialRange":
      return apiFetch("POST", "/ranges", {
        date: payload.date, model: payload.model,
        start: payload.start, end: payload.end,
        expected: payload.expected, scanned: payload.scanned, missing: payload.missing,
      });

    case "serverSaveModel":
      return apiFetch("POST", "/models", { modelName: payload.modelName, customer: payload.customer });
    case "serverDeleteModel":
      return apiFetch("DELETE", `/models/${encodeURIComponent(payload.modelName)}`);

    // FIX 2: verifyAdmin response is { success, verified } — was checking bare truthy
    case "serverVerifyAdmin":
      return apiFetch("POST", "/admin/verify", { password: payload.password });

    // FIX 3: logout is client-side only — no server call needed
    case "serverLogout":
      return { success: true };

    case "serverAddUser":
      return apiFetch("POST", "/users", { email: payload.email, name: payload.name, role: payload.role });

    default:
      console.warn("callServer: unknown action", action);
      return { success: false, message: "Unknown action: " + action };
  }
};

// ─── getSheet — maps legacy sheet names → REST endpoints ─────────────────────
// Returns { data: [[header], [row], ...] } — same shape the old code expected
const getSheet = async (sheetName) => {
  const today = todayStr();
  switch (sheetName) {
    case "ProductionData":
      return apiFetch("GET", `/data?date=${encodeURIComponent(today)}`);
    case "Idle_Records":
      return apiFetch("GET", `/idle?date=${encodeURIComponent(today)}`);
    case "Reloads":
      return apiFetch("GET", `/reloads?date=${encodeURIComponent(today)}`);
    case "Models":
      return apiFetch("GET", "/models");
    case "Serial_Ranges":
      return apiFetch("GET", `/ranges?date=${encodeURIComponent(today)}`);
    // FIX 4: Contents (manpower) now returns { manpower } directly — handled in loadMP
    case "Contents":
      return apiFetch("GET", `/manpower?date=${encodeURIComponent(today)}`);
    case "AuthUsers":
      return apiFetch("GET", "/users");
    default:
      return { data: [], error: "Unknown sheet: " + sheetName };
  }
};

// ─── Download sheet helpers — map old sheet names to API download paths ───────
// FIX 5: dlSheet used old Google Sheets names; now maps to correct API endpoints
const SHEET_DOWNLOAD_MAP = {
  ProductionData: (today) => `/data?date=${encodeURIComponent(today)}`,
  Idle_Records:   (today) => `/idle?date=${encodeURIComponent(today)}`,
  Reloads:        (today) => `/reloads?date=${encodeURIComponent(today)}`,
};

// ─── Slots & defaults ─────────────────────────────────────────────────────────
const SLOTS = [
  "07:00-08:00","08:00-09:00","09:00-10:00","10:00-11:00",
  "11:00-12:00","12:00-13:00","13:00-14:00","14:00-15:00",
  "15:00-16:00","16:00-17:00","17:00-18:00","18:00-19:00",
];
const DEF_TARGETS = [170, 200, 200, 170, 200, 200, 100, 200, 200, 170, 200, 100];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function todayStr() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
function parseSheetDate(cell) {
  const s = String(cell || "").trim();
  if (!s) return "";
  if (s.indexOf("T") !== -1) {
    try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(s)); } catch (e) {}
  }
  return s.substring(0, 10);
}
function pad5(n) { return String(n).padStart(5, "0"); }
function pad2(n) { return String(n).padStart(2, "0"); }
function normSlot(s) {
  s = String(s || "").trim();
  const m = s.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
  return m ? pad2(m[1]) + ":" + pad2(m[2]) + "-" + pad2(m[3]) + ":" + pad2(m[4]) : s;
}
function extractNum(serial) {
  if (!serial) return null;
  const m = String(serial).match(/(\d{1,10})$/);
  return m ? parseInt(m[1]) : null;
}
function buildExpectedLabel(refSerial, expectedNum) {
  if (!refSerial) return String(expectedNum);
  const m = refSerial.match(/(\d{1,10})$/);
  if (!m) return String(expectedNum);
  const padded = String(expectedNum).padStart(m[1].length, "0");
  return refSerial.replace(/(\d{1,10})$/, padded);
}
function parseModel(s) {
  s = s.trim().toUpperCase();
  const ps = [/25([A-Z]{2}\d{4})/, /\d{2}([A-Z]{2}\d{4})/, /([A-Z]{2}\d{4})P/, /([A-Z]{2}\d{4})/];
  for (let p of ps) { const m = s.match(p); if (m && m[1]) return m[1]; }
  return null;
}
function tsToSlot(ts) {
  if (!ts) return -1;
  ts = String(ts).trim();
  if (ts.indexOf("T") !== -1 || (ts.length > 16 && ts.indexOf(":") !== -1)) {
    try {
      const d = new Date(ts);
      if (!isNaN(d.getTime())) {
        const hr = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(d));
        const idx = hr - 7;
        return idx >= 0 && idx < 12 ? idx : -1;
      }
    } catch (e) {}
  }
  if (/am|pm/i.test(ts)) {
    const m = ts.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)/i);
    if (!m) return -1;
    let hr = parseInt(m[1]);
    const p = m[3].toLowerCase();
    if (p === "pm" && hr !== 12) hr += 12;
    if (p === "am" && hr === 12) hr = 0;
    return hr - 7 >= 0 && hr - 7 < 12 ? hr - 7 : -1;
  }
  const m = ts.match(/(\d{1,2}):(\d{2})/);
  if (!m) return -1;
  const idx = parseInt(m[1]) - 7;
  return idx >= 0 && idx < 12 ? idx : -1;
}
function beep(ok) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = ok ? 880 : 220;
    osc.type = ok ? "sine" : "square";
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (ok ? 0.15 : 0.25));
    osc.start(); osc.stop(ctx.currentTime + (ok ? 0.15 : 0.25));
  } catch (e) {}
}

// ─── Serial date decode (Atomberg barcode table) ──────────────────────────────
const DATE_CODE_MAP = {
  1:"1",2:"2",3:"3",4:"4",5:"5",6:"6",7:"7",8:"8",9:"9",
  10:"A",11:"C",12:"D",13:"E",14:"F",15:"H",16:"J",17:"K",
  18:"L",19:"M",20:"N",21:"P",22:"R",23:"T",24:"U",25:"W",
  26:"X",27:"Y",28:"B",29:"G",30:"S",31:"Z",
};
const CODE_TO_DATES = {};
Object.entries(DATE_CODE_MAP).forEach(([d, c]) => {
  if (!CODE_TO_DATES[c]) CODE_TO_DATES[c] = [];
  CODE_TO_DATES[c].push(parseInt(d));
});
const MONTH_CODE_MAP = { 1:"A",2:"C",3:"D",4:"E",5:"F",6:"H",7:"J",8:"K",9:"L",10:"M",11:"N",12:"P" };
const CODE_TO_MONTH = {};
Object.entries(MONTH_CODE_MAP).forEach(([m, c]) => { CODE_TO_MONTH[c] = parseInt(m); });

function parseSerialDate(serial) {
  const s = String(serial).toUpperCase().trim();
  const m = s.match(/^([A-Z0-9])([A-Z])(\d{2})/);
  if (!m) return null;
  const possibleDates = CODE_TO_DATES[m[1]];
  const month = CODE_TO_MONTH[m[2]];
  if (!possibleDates || !month) return null;
  return { possibleDates, month, year: 2000 + parseInt(m[3]), year2: parseInt(m[3]) };
}
function getTodayIST() {
  const ist = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return { date: ist.getDate(), month: ist.getMonth() + 1, year: ist.getFullYear(), year2: ist.getFullYear() % 100 };
}
function checkSerialDateStatus(serial) {
  const parsed = parseSerialDate(serial);
  if (!parsed) return "today";
  const today = getTodayIST();
  if (parsed.year < today.year) return "past";
  if (parsed.year > today.year) return "future";
  if (parsed.month < today.month) return "past";
  if (parsed.month > today.month) return "future";
  const allPast   = parsed.possibleDates.every(d => d < today.date);
  const allFuture = parsed.possibleDates.every(d => d > today.date);
  if (allPast)   return "past";
  if (allFuture) return "future";
  return "today";
}
function decodeSerialDateLabel(serial) {
  const parsed = parseSerialDate(serial);
  if (!parsed) return "";
  const monthNames = ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return parsed.possibleDates.join(" or ") + " " + (monthNames[parsed.month] || "") + " " + parsed.year;
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
  :root {
    --navy:#1a1a2e; --accent:#C41E4E; --teal:#0d9488;
    --green:#10b981; --amber:#f59e0b; --red:#ef4444;
    --g50:#f9fafb; --g100:#f3f4f6; --g200:#e5e7eb;
    --g400:#9ca3af; --g600:#6b7280; --g700:#374151; --g900:#111827;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Inter',sans-serif;background:linear-gradient(135deg,var(--navy) 0%,#0f3460 100%);height:100vh;overflow:hidden;padding:5px}
  .pg-app{width:100%;height:calc(100vh - 10px);background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 25px 70px rgba(0,0,0,.35);display:flex;flex-direction:column}
  .hdr{background:linear-gradient(135deg,var(--navy) 0%,#0f3460 100%);color:#fff;padding:8px 18px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0;gap:10px;border-bottom:2px solid var(--accent)}
  .hdr-l{display:flex;align-items:center;gap:10px;min-width:0}
  .hdr-r{display:flex;gap:8px;align-items:center;flex-shrink:0}
  .logo-btn{flex-shrink:0;cursor:pointer;border:none;background:none;padding:0}
  .live-badge{background:var(--green);padding:3px 9px;border-radius:20px;font-size:10px;font-weight:700;animation:pulse 2s infinite;white-space:nowrap}
  .cust-badge{font-size:11px;color:#fde68a;font-weight:600;background:rgba(0,0,0,.25);padding:3px 8px;border-radius:5px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .hdr-title{font-size:16px;font-weight:800;white-space:nowrap;display:flex;flex-direction:column;line-height:1.2}
  .hdr-title .co{font-size:10px;opacity:.8;color:#fca5a5;font-weight:600}
  .hdr-kpi{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:7px;padding:5px 12px;text-align:center;min-width:80px}
  .hdr-kpi .v{font-size:20px;font-weight:800;line-height:1}
  .hdr-kpi .l{font-size:9px;opacity:.85;margin-top:1px;font-weight:500}
  .time-d .t{font-size:13px;font-weight:700}
  .time-d .d{font-size:9px;opacity:.8}
  .logout-btn{background:rgba(196,30,78,.3);color:#fff;border:1px solid rgba(196,30,78,.5);padding:5px 12px;border-radius:7px;cursor:pointer;font-size:11px;font-weight:600;font-family:Inter,sans-serif;transition:.2s}
  .logout-btn:hover{background:rgba(196,30,78,.6)}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
  .pg-tabs{display:flex;background:var(--g100);border-bottom:2px solid var(--g200);flex-shrink:0;overflow-x:auto}
  .pg-tabs::-webkit-scrollbar{display:none}
  .pg-tab{padding:10px 16px;cursor:pointer;background:none;border:none;font-size:12px;font-weight:600;font-family:Inter,sans-serif;color:var(--g600);transition:.2s;white-space:nowrap;flex-shrink:0;border-bottom:3px solid transparent}
  .pg-tab:hover{background:var(--g200)}
  .pg-tab.active{background:#fff;color:var(--navy);border-bottom:3px solid var(--accent)}
  .tab-pane{padding:14px 16px;flex:1;overflow-y:auto}
  .kpi-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:12px}
  .kpi-card{background:#fff;border-radius:9px;padding:12px 10px;box-shadow:0 2px 6px rgba(0,0,0,.07);text-align:center;border:1px solid var(--g200);transition:.15s}
  .kpi-card:hover{transform:translateY(-2px)}
  .kpi-card .v{font-size:28px;font-weight:800;color:var(--g900);line-height:1.1}
  .kpi-card .l{color:var(--g600);margin-top:4px;font-size:10px;font-weight:600}
  .kpi-card.green{background:linear-gradient(135deg,#d1fae5,#a7f3d0);border-color:#6ee7b7}
  .kpi-card.amber{background:linear-gradient(135deg,#fef3c7,#fde68a);border-color:#fbbf24}
  .kpi-card.red{background:linear-gradient(135deg,#fee2e2,#fecaca);border-color:#fca5a5}
  .tbl-wrap{overflow-x:auto;border-radius:8px;border:1px solid var(--g200);margin:8px 0}
  table{width:100%;border-collapse:collapse;font-size:12px}
  thead th{background:var(--navy);color:#fff;padding:9px 10px;text-align:left;font-size:11px;font-weight:600}
  tbody td{padding:8px 10px;border-bottom:1px solid var(--g200);font-weight:500}
  tbody tr:last-child td{border-bottom:none}
  tbody tr:hover{background:var(--g50)}
  .row-green{background:#d1fae5!important}
  .row-amber{background:#fef3c7!important}
  .row-red{background:#fee2e2!important}
  .fg{margin-bottom:11px}
  .fl{display:block;margin-bottom:4px;font-weight:600;color:var(--g700);font-size:11px}
  .fi,.fs{width:100%;padding:8px 10px;border:2px solid var(--g200);border-radius:7px;font-size:12px;font-family:Inter,sans-serif;transition:.2s;background:#fff}
  .fi:focus,.fs:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(196,30,78,.1)}
  .btn{padding:7px 14px;border:none;border-radius:7px;font-weight:600;cursor:pointer;transition:.2s;font-size:11px;font-family:Inter,sans-serif;display:inline-flex;align-items:center;gap:4px}
  .btn:hover{opacity:.88;transform:translateY(-1px)}
  .btn-navy{background:var(--navy);color:#fff}
  .btn-red{background:var(--accent);color:#fff}
  .btn-grn{background:var(--green);color:#fff}
  .btn-dngr{background:var(--red);color:#fff}
  .btn-amb{background:var(--amber);color:#fff}
  .btn-teal{background:var(--teal);color:#fff}
  .btn-row{display:flex;gap:7px;margin-top:10px;flex-wrap:wrap;align-items:center}
  .modal-overlay{display:flex;position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:1000;align-items:center;justify-content:center}
  .m-box{background:#fff;padding:26px;border-radius:14px;max-width:440px;width:90%;max-height:85vh;overflow-y:auto;box-shadow:0 24px 56px rgba(0,0,0,.28)}
  .m-title{font-size:16px;font-weight:800;margin-bottom:14px;color:var(--g900)}
  .al{padding:9px 11px;border-radius:7px;margin-bottom:9px;font-size:12px;font-weight:500}
  .al-err{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5}
  .al-ok{background:#d1fae5;color:#065f46;border:1px solid #6ee7b7}
  .al-warn{background:#fef3c7;color:#92400e;border:1px solid #fbbf24}
  .al-info{background:#dbeafe;color:#1e40af;border:1px solid #93c5fd}
  .section{background:var(--g50);padding:14px;border-radius:9px;margin-bottom:14px;border:1px solid var(--g200)}
  .sec-title{font-size:13px;font-weight:700;color:var(--g900);margin-bottom:10px}
  .scan-box{background:var(--g50);padding:14px;border-radius:9px;margin-bottom:12px;border:1px solid var(--g200);transition:.3s}
  .scan-box.locked{opacity:.5;pointer-events:none;filter:grayscale(.5)}
  .ss-lbl{display:inline-block;margin-left:7px;font-size:11px;font-weight:700}
  .ss-ok{color:var(--green)}
  .ss-err{color:var(--red)}
  .recent{background:var(--g50);padding:10px;border-radius:9px;max-height:200px;overflow-y:auto;border:1px solid var(--g200)}
  .fi-green{background:#d1fae5!important;border-color:var(--green)!important}
  .fi-red{background:#fee2e2!important;border-color:var(--red)!important}
  .mpbox{background:linear-gradient(135deg,#fef3c7,#fde68a);padding:14px;border-radius:9px;margin-top:12px;border:2px solid var(--amber)}
  .model-wrap{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}
  .model-tag{background:var(--g100);padding:4px 10px;border-radius:20px;display:flex;align-items:center;gap:7px;font-size:12px;font-weight:500;border:1px solid var(--g200)}
  .del-btn{background:var(--red);color:#fff;border:none;width:16px;height:16px;border-radius:50%;cursor:pointer;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center}
  .tgt-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
  .rng-disp{margin-top:10px;padding:10px;background:#fff;border-radius:7px;border:1px solid var(--g200)}
  .sync-bar{position:fixed;bottom:10px;right:10px;background:#fff;padding:6px 12px;border-radius:28px;box-shadow:0 4px 10px rgba(0,0,0,.13);display:flex;align-items:center;gap:6px;font-size:11px;z-index:500;font-weight:500;border:1px solid var(--g200)}
  .sync-dot{width:7px;height:7px;border-radius:50%;background:var(--green);flex-shrink:0}
  .sync-dot.syncing{background:var(--amber);animation:pulse 1s infinite}
  .sync-dot.error{background:var(--red)}
  .seq-banner{padding:8px 12px;border-radius:7px;margin-bottom:10px;font-size:12px;font-weight:600;border:2px solid}
  .seq-banner.ok{background:#d1fae5;color:#065f46;border-color:#6ee7b7}
  .seq-banner.warn{background:#fef3c7;color:#92400e;border-color:#fbbf24}
  .seq-banner.err{background:#fee2e2;color:#991b1b;border-color:#fca5a5}
  .save-toast{position:fixed;bottom:50px;right:12px;z-index:600;padding:7px 14px;border-radius:20px;font-size:11px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,.2);display:flex;align-items:center;gap:6px}
  .lo-overlay{position:fixed;inset:0;background:linear-gradient(135deg,#1a1a2e,#0f3460);z-index:9999;display:flex;align-items:center;justify-content:center}
  .lo-card{background:#fff;padding:36px 40px;border-radius:18px;text-align:center;max-width:340px;width:90%;box-shadow:0 24px 60px rgba(0,0,0,.5)}
  .spin{width:18px;height:18px;border:2px solid #fca5a5;border-top-color:#C41E4E;border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
  @keyframes spin{to{transform:rotate(360deg)}}
  .chart-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px}
  .ch-card{background:#fff;padding:12px;border-radius:9px;box-shadow:0 2px 6px rgba(0,0,0,.07);border:1px solid var(--g200)}
  .ch-card h4{font-size:11px;font-weight:700;color:var(--g700);margin-bottom:8px}
  .ch-wrap{position:relative;height:180px}
`;

// ─── Session helpers ──────────────────────────────────────────────────────────
const SESSION_KEY = "pg_session";
const saveSession  = (d) => { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(d)); } catch (e) {} };
const loadSession  = () => { try { const r = sessionStorage.getItem(SESSION_KEY); if (!r) return null; const p = JSON.parse(r); return p?.token ? p : null; } catch (e) { return null; } };
const clearSession = () => { try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {} };

// ─── Login popup CSS ──────────────────────────────────────────────────────────
const POPUP_CSS = `
  .lp-overlay{position:fixed;inset:0;z-index:9999;background:rgba(10,10,30,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px;animation:lp-fadein .25s ease}
  @keyframes lp-fadein{from{opacity:0}to{opacity:1}}
  .lp-card-wrap{animation:lp-slidein .28s cubic-bezier(.16,1,.3,1)}
  @keyframes lp-slidein{from{opacity:0;transform:translateY(24px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
`;

const LOGIN_CSS = `
  .lg-body{font-family:'Inter',sans-serif;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px}
  .lg-body-plain{font-family:'Inter',sans-serif}
  .lg-card{background:#fff;border-radius:22px;padding:40px 36px;max-width:420px;width:100%;box-shadow:0 32px 80px rgba(0,0,0,.45)}
  .lg-logo{text-align:center;margin-bottom:8px}
  .lg-brand{text-align:center;font-size:24px;font-weight:800;color:#1a1a2e;margin:8px 0 2px}
  .lg-sub{text-align:center;color:#6b7280;font-size:12px;margin-bottom:20px}
  .lg-hr{border:none;border-top:1px solid #f0f0f0;margin:0 0 20px}
  .lg-fg{margin-bottom:14px}
  .lg-lbl{display:block;margin-bottom:5px;font-weight:600;color:#374151;font-size:12px}
  .lg-inp{width:100%;padding:11px 13px;border:2px solid #e5e7eb;border-radius:9px;font-size:14px;font-family:'Inter',sans-serif;color:#111;box-sizing:border-box;outline:none;transition:.2s}
  .lg-inp:focus{border-color:#C41E4E;box-shadow:0 0 0 3px rgba(196,30,78,.1)}
  .lg-btn{width:100%;padding:12px;border:none;border-radius:9px;font-size:14px;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif;transition:.2s;margin-top:4px;background:linear-gradient(135deg,#C41E4E,#a01840);color:#fff}
  .lg-btn:hover{opacity:.9;transform:translateY(-1px)}
  .lg-btn:disabled{opacity:.6;cursor:not-allowed;transform:none}
  .lg-ghost{background:none;color:#C41E4E;font-size:12px;padding:7px;text-decoration:underline;cursor:pointer;font-weight:500;border:none;font-family:'Inter',sans-serif}
  .lg-al{padding:10px 12px;border-radius:8px;margin-bottom:12px;font-size:12px;font-weight:500}
  .lg-err{background:#fee2e2;color:#991b1b;border:1px solid #ef4444}
  .lg-ok{background:#d1fae5;color:#065f46;border:1px solid #10b981}
  .lg-info{background:#fef3f8;color:#9b1939;border:1px solid #f0adc2}
  .lg-otp-row{display:flex;gap:6px;justify-content:center;margin:12px 0}
  .lg-otp-inp{width:46px;text-align:center;font-size:22px;font-weight:800;padding:8px 0;border-radius:8px;border:2px solid #e5e7eb;font-family:'Inter',sans-serif;outline:none;transition:.2s}
  .lg-otp-inp:focus{border-color:#C41E4E;box-shadow:0 0 0 3px rgba(196,30,78,.1)}
  .lg-timer{text-align:center;color:#6b7280;font-size:11px;margin-top:6px}
  .lg-ebox{background:#fef3f8;padding:9px 12px;border-radius:7px;font-size:12px;color:#374151;margin-bottom:12px;border:1px solid #f0adc2;word-break:break-all}
  .lg-foot{text-align:center;margin-top:16px;padding-top:14px;border-top:1px solid #f0f0f0;color:#9ca3af;font-size:10px}
  .lg-row2{display:flex;gap:8px;margin-top:8px}
  .lg-spin{display:inline-block;width:16px;height:16px;border:2px solid #fca5a5;border-top-color:#C41E4E;border-radius:50%;animation:lgspin .7s linear infinite;vertical-align:middle;margin-right:6px}
  @keyframes lgspin{to{transform:rotate(360deg)}}
`;

// ═══════════════════════════════════════════════════════════════════════════════
// APP ROOT
// ═══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [checking,  setChecking]  = useState(true);
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    const saved = loadSession();
    if (saved) { setShowLogin(false); }
    else        { setShowLogin(true); }
    setChecking(false);
  }, []);

  const handleLogin  = (d) => { saveSession(d); setShowLogin(false); };
  const handleLogout = ()  => { clearSession(); setShowLogin(true); };

  if (checking) return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#1a1a2e,#0f3460)", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ color:"#fff", fontSize:14, fontWeight:600 }}>Loading...</div>
    </div>
  );

  return (
    <>
      <ProductionMonitor onLogout={handleLogout} />
      {showLogin && <LoginPopup onLogin={handleLogin} />}
    </>
  );
}

// ─── Login popup wrapper ──────────────────────────────────────────────────────
function LoginPopup({ onLogin }) {
  return (
    <>
      <style>{POPUP_CSS}</style>
      <div className="lp-overlay">
        <div className="lp-card-wrap">
          <LoginPage onLogin={onLogin} insidePopup />
        </div>
      </div>
    </>
  );
}

// ─── Login page ───────────────────────────────────────────────────────────────
function LoginPage({ onLogin, insidePopup = false }) {
  const [step,    setStep]    = useState(1);
  const [email,   setEmail]   = useState("");
  const [otp,     setOtp]     = useState(["","","","","",""]);
  const [loading, setLoading] = useState(false);
  const [loadTxt, setLoadTxt] = useState("");
  const [err1,    setErr1]    = useState("");
  const [err2,    setErr2]    = useState("");
  const [otpMsg,  setOtpMsg]  = useState("");
  const [timer,   setTimer]   = useState(600);
  const timerRef = useRef(null);
  const otpRefs  = [useRef(), useRef(), useRef(), useRef(), useRef(), useRef()];

  const startTimer = () => {
    setTimer(600);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimer(t => { if (t <= 1) { clearInterval(timerRef.current); return 0; } return t - 1; });
    }, 1000);
  };
  useEffect(() => () => clearInterval(timerRef.current), []);
  const timerStr = `${String(Math.floor(timer / 60)).padStart(2,"0")}:${String(timer % 60).padStart(2,"0")}`;

  // FIX 6: All auth URLs now consistently use /api/auth prefix
  const sendOTP = async () => {
    const v = email.trim();
    if (!v || !v.includes("@")) { setErr1("Please enter a valid email address."); return; }
    setErr1(""); setLoading(true); setLoadTxt(`Sending OTP to ${v}...`);
    try {
      const res  = await fetch(`${API_BASE}/auth/login?email=${encodeURIComponent(v)}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setOtpMsg(data.message || "OTP sent to your email!");
        setStep(2); startTimer();
        setTimeout(() => { otpRefs[0].current?.focus(); }, 300);
      } else { setErr1(data.message || "Failed to send OTP. Check if your email is registered."); }
    } catch { setErr1("Network error — could not reach server."); }
    finally { setLoading(false); setLoadTxt(""); }
  };

  const verify = async () => {
    const otpVal = otp.join("");
    if (otpVal.length !== 6) { setErr2("Please enter all 6 digits."); return; }
    setErr2(""); setLoading(true); setLoadTxt("Verifying OTP...");
    try {
      const res  = await fetch(`${API_BASE}/auth/verify/otp?email=${encodeURIComponent(email.trim())}&otp=${encodeURIComponent(otpVal)}`);
      const data = await res.json();
      if (res.ok && data.success) {
        clearInterval(timerRef.current);
        setLoadTxt("Login successful! Loading dashboard...");
        setTimeout(() => {
          onLogin({ token: data.token, name: data.name || email, role: data.role || "user", email: email.trim().toLowerCase() });
        }, 700);
      } else {
        setErr2(data.message || "Incorrect OTP. Please try again.");
        setLoading(false); setLoadTxt("");
      }
    } catch { setErr2("Network error — could not reach server."); setLoading(false); setLoadTxt(""); }
  };

  const resend = async () => {
    clearInterval(timerRef.current); setErr2("");
    setLoading(true); setLoadTxt("Resending OTP...");
    try {
      const res  = await fetch(`${API_BASE}/api/auth/login?email=${encodeURIComponent(email.trim())}`);
      const data = await res.json();
      if (res.ok && data.success) {
        setOtpMsg("New OTP sent!"); setOtp(["","","","","",""]);
        startTimer(); setTimeout(() => { otpRefs[0].current?.focus(); }, 200);
      } else { setErr2(data.message || "Resend failed."); }
    } catch { setErr2("Network error — could not reach server."); }
    finally { setLoading(false); setLoadTxt(""); }
  };

  const handleOtpInput = (i, val) => {
    const clean = val.replace(/[^0-9]/g, "").slice(-1);
    const n = [...otp]; n[i] = clean; setOtp(n);
    if (clean && i < 5) setTimeout(() => { otpRefs[i+1].current?.focus(); }, 0);
    if (i === 5 && clean && [...n].join("").length === 6) setTimeout(verify, 100);
  };
  const handleOtpKey   = (i, e) => { if (e.key === "Backspace" && !otp[i] && i > 0) otpRefs[i-1].current?.focus(); };
  const handleOtpPaste = (e) => {
    e.preventDefault();
    const t = (e.clipboardData || window.clipboardData).getData("text").replace(/[^0-9]/g,"").slice(0,6).split("");
    const n = ["","","","","",""]; t.forEach((c, i) => { n[i] = c; }); setOtp(n);
    if (t.length === 6) setTimeout(verify, 100);
    else otpRefs[Math.min(t.length, 5)].current?.focus();
  };

  const card = (
    <div className="lg-card">
      <div className="lg-logo">
        <img src="https://cms-complaint-avidence.s3.eu-north-1.amazonaws.com/pg-logo-Photoroom.png"
          height="70" style={{ display:"inline-block", borderRadius:10, padding:4, background:"#fff" }} alt="PG Logo" />
      </div>
      <div className="lg-brand">PG GROUP</div>
      <div className="lg-sub">Production Monitor — Secure Login</div>
      <hr className="lg-hr" />
      {loading && (
        <div style={{ textAlign:"center", padding:"24px 0" }}>
          <div className="lg-spin" />
          <span style={{ fontSize:13, color:"#374151", fontWeight:600 }}>{loadTxt || "Please wait..."}</span>
        </div>
      )}
      {!loading && step === 1 && (
        <div>
          <div className="lg-al lg-info">Enter your registered email to receive a one-time password (OTP).</div>
          <div className="lg-fg">
            <label className="lg-lbl">Email Address</label>
            <input className="lg-inp" type="email" placeholder="you@company.com" value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyPress={e => { if (e.key === "Enter") sendOTP(); }}
              autoComplete="email" />
          </div>
          {err1 && <div className="lg-al lg-err">{err1}</div>}
          <button className="lg-btn" onClick={sendOTP}>Send OTP →</button>
        </div>
      )}
      {!loading && step === 2 && (
        <div>
          <div className="lg-al lg-ok">{otpMsg || "OTP sent!"}</div>
          <div className="lg-ebox">{email}</div>
          <div className="lg-fg">
            <label className="lg-lbl">Enter 6-Digit OTP</label>
            <div className="lg-otp-row" onPaste={handleOtpPaste}>
              {otp.map((v, i) => (
                <input key={i} ref={otpRefs[i]} className="lg-otp-inp" type="text" maxLength="1"
                  inputMode="numeric" value={v}
                  onChange={e => handleOtpInput(i, e.target.value)}
                  onKeyDown={e => handleOtpKey(i, e)} />
              ))}
            </div>
            <div className="lg-timer">Expires in <b style={{ color:"#C41E4E" }}>{timerStr}</b></div>
          </div>
          {err2 && <div className="lg-al lg-err">{err2}</div>}
          <button className="lg-btn" onClick={verify}>Verify &amp; Login</button>
          <div className="lg-row2">
            <button className="lg-ghost" onClick={() => { setStep(1); setOtp(["","","","","",""]); clearInterval(timerRef.current); }}>← Change Email</button>
            <button className="lg-ghost" onClick={resend}>Resend OTP</button>
          </div>
        </div>
      )}
      <div className="lg-foot">PG GROUP © 2025 — Production Monitor v2.4</div>
    </div>
  );

  return (
    <>
      <style>{LOGIN_CSS}</style>
      {insidePopup ? <div className="lg-body-plain">{card}</div> : <div className="lg-body">{card}</div>}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTION MONITOR
// ═══════════════════════════════════════════════════════════════════════════════
function ProductionMonitor({ onLogout }) {
  const [activeTab,          setActiveTab]          = useState("dashboard");
  const [adminUnlocked,      setAdminUnlocked]      = useState(false);
  const [showLogoutConfirm,  setShowLogoutConfirm]  = useState(false);
  const [showLogoutOverlay,  setShowLogoutOverlay]  = useState(false);
  const [showAdminModal,     setShowAdminModal]     = useState(false);
  const [showIdleModal,      setShowIdleModal]      = useState(false);
  const [idleMinutes,        setIdleMinutes]        = useState(0);
  const [adminPwd,           setAdminPwd]           = useState("");
  const [idleDept,           setIdleDept]           = useState("");
  const [idleRsn,            setIdleRsn]            = useState("");
  const [clockTime,          setClockTime]          = useState("--:--:--");
  const [clockDate,          setClockDate]          = useState("");
  const [syncState,          setSyncState]          = useState({ dot:"syncing", txt:"Connecting..." });
  const [toast,              setToast]              = useState({ show:false, msg:"", isErr:false });
  const [appSettings,        setAppSettings]        = useState({ targets:DEF_TARGETS.slice(), idleThr:2, lotMode:false });
  const [manpower,           setManpower]           = useState(0);
  const [curModel,           setCurModel]           = useState("");
  const [sRange,             setSRange]             = useState({ model:"", start:0, end:0, date:"" });
  const [scanLocked,         setScanLocked]         = useState(true);
  const [scanInputsVisible,  setScanInputsVisible]  = useState(false);
  const [seqBanner,          setSeqBanner]          = useState({ show:false, type:"", msg:"" });
  const [boxSer,             setBoxSer]             = useState("");
  const [prdSer,             setPrdSer]             = useState("");
  const [cstSer,             setCstSer]             = useState("");
  const [prdDisabled,        setPrdDisabled]        = useState(true);
  const [cstDisabled,        setCstDisabled]        = useState(true);
  const [st1, setSt1] = useState({ cls:"", msg:"" });
  const [st2, setSt2] = useState({ cls:"", msg:"" });
  const [st3, setSt3] = useState({ cls:"", msg:"" });
  const [boxClass,  setBoxClass]  = useState("");
  const [prdClass,  setPrdClass]  = useState("");
  const [cstClass,  setCstClass]  = useState("");
  const [rldSlot,   setRldSlot]   = useState(SLOTS[0]);
  const [rldType,   setRldType]   = useState("Material");
  const [rldCnt,    setRldCnt]    = useState(1);
  const [rngModel,  setRngModel]  = useState("");
  const [rngStart,  setRngStart]  = useState("");
  const [rngEnd,    setRngEnd]    = useState("");
  const [rngDisp,   setRngDisp]   = useState(false);
  const [lotMode,   setLotMode]   = useState(false);
  const [newMdl,    setNewMdl]    = useState("");
  const [newCust,   setNewCust]   = useState("");
  const [mpInput,   setMpInput]   = useState("");
  const [idleThrInput, setIdleThrInput] = useState(2);
  const [targets,      setTargets]      = useState(DEF_TARGETS.slice());
  const [uEmail,    setUEmail]    = useState("");
  const [uName,     setUName]     = useState("");
  const [usersList, setUsersList] = useState([]);
  const [rptContent, setRptContent] = useState(null);

  const initHourly = (tgts) => SLOTS.map((s, i) => ({
    slot:s, prod:0,
    target: tgts ? (tgts[i] !== undefined ? tgts[i] : DEF_TARGETS[i]) : DEF_TARGETS[i],
    idle:0, dept:"", reason:"", reloads:0,
  }));

  const [S, setS] = useState({
    date:todayStr(), totalProd:0, hourly:initHourly(DEF_TARGETS),
    serials:[], reloads:[], idles:[], models:[], manpower:0,
  });

  const scannedRef      = useRef(new Set());
  const syncedRef       = useRef(new Set());
  const manpowerRef     = useRef(0);
  const mpSetRef        = useRef(false);
  const lastScanRef     = useRef(null);
  const idleOpenRef     = useRef(false);
  const curModelRef     = useRef("");
  const sRangeRef       = useRef({ model:"", start:0, end:0, date:"" });
  const adClicksRef     = useRef(0);
  const loadingRef      = useRef(false);
  const loadTimerRef    = useRef(null);
  const lastScanTimeRef = useRef(0);
  const nextExpRef      = useRef(null);
  const lastSerRef      = useRef(null);
  const seqLoadRef      = useRef(false);
  const boxRef          = useRef(null);
  const prdRef          = useRef(null);
  const cstRef          = useRef(null);
  const scanT1          = useRef(null);
  const scanT2          = useRef(null);
  const scanT3          = useRef(null);

  const setSyncUI = useCallback((state, msg) => setSyncState({ dot:state, txt:msg || "" }), []);

  const showSaveToast = useCallback((msg, isErr = false) => {
    setToast({ show:true, msg, isErr });
    setTimeout(() => setToast(t => ({ ...t, show:false })), 3000);
  }, []);

  useEffect(() => {
    const tick = () => {
      const n = new Date();
      setClockTime(n.toLocaleTimeString("en-IN"));
      setClockDate(n.toLocaleDateString("en-IN", { weekday:"short", year:"numeric", month:"short", day:"numeric" }));
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, []);

  const saveSetting = useCallback((key, value) => {
    const strVal = typeof value === "object" ? JSON.stringify(value) : String(value);
    callServer("serverSaveSetting", { key, value: strVal }).catch(e => console.error("saveSetting error:", key, e));
  }, []);

  const loadSettings = useCallback((callback) => {
    callServer("serverGetAllSettings", {}).then(result => {
      const ns = { targets:DEF_TARGETS.slice(), idleThr:2, lotMode:false };
      if (result?.success && result.settings) {
        const s = result.settings;
        if (s.targets) { try { const t = JSON.parse(s.targets); if (Array.isArray(t) && t.length === 12) ns.targets = t; } catch (e) {} }
        if (s.idleThr) { const thr = parseInt(s.idleThr); if (thr > 0) ns.idleThr = thr; }
        if (s.lotMode) ns.lotMode = s.lotMode === "true";
      }
      setAppSettings(ns); setIdleThrInput(ns.idleThr); setLotMode(ns.lotMode); setTargets(ns.targets.slice());
      if (callback) callback(ns);
    }).catch(() => { if (callback) callback(appSettings); });
  }, []);

  const countRange = useCallback((serials, sr) => {
    if (!sr.model) return 0;
    return serials.filter(s => {
      if (s.model !== sr.model) return false;
      const n = parseInt((s.serial.match(/(\d+)$/) || [0,"0"])[1]);
      return n >= sr.start && n <= sr.end;
    }).length;
  }, []);

  const recalcHourlyProd = useCallback((hourly, serials) => {
    const h = hourly.map(r => ({ ...r, prod:0 }));
    serials.forEach(s => { const idx = tsToSlot(s.ts); if (idx >= 0 && idx < 12) h[idx].prod++; });
    return h;
  }, []);

  const refreshNextExpected = useCallback((model, serials) => {
    if (!model) { nextExpRef.current = null; lastSerRef.current = null; return; }
    let maxNum = 0, maxSer = null;
    serials.forEach(s => {
      if (s.model !== model) return;
      const n = extractNum(s.serial);
      if (n !== null && n > maxNum) { maxNum = n; maxSer = s.serial; }
    });
    if (maxSer) {
      lastSerRef.current = maxSer; nextExpRef.current = maxNum + 1;
      setSeqBanner({ show:true, type:"ok", msg:"✅ Next expected: " + buildExpectedLabel(maxSer, maxNum+1) });
    } else {
      lastSerRef.current = null; nextExpRef.current = null;
      setSeqBanner({ show:true, type:"warn", msg:"⚡ No serials scanned yet for " + model + " today. First scan sets the sequence." });
    }
  }, []);

  const loadLastSerial = useCallback((model, serials) => {
    if (!model) return;
    seqLoadRef.current = true;
    setSeqBanner({ show:true, type:"warn", msg:"⏳ Loading sequence info..." });
    callServer("serverGetLastSerial", { model, date:todayStr() }).then(res => {
      seqLoadRef.current = false;
      if (res?.success) {
        if (res.lastNum > 0) {
          lastSerRef.current = res.lastSerial; nextExpRef.current = res.lastNum + 1;
          setSeqBanner({ show:true, type:"ok", msg:"✅ Next expected: " + buildExpectedLabel(res.lastSerial, res.lastNum+1) + "   (last scanned: " + res.lastSerial + ")" });
        } else {
          lastSerRef.current = null; nextExpRef.current = null;
          setSeqBanner({ show:true, type:"warn", msg:"⚡ No serials scanned yet for " + model + " today. First scan sets the sequence." });
        }
      } else { refreshNextExpected(model, serials); }
    }).catch(() => {
      seqLoadRef.current = false;
      setSeqBanner({ show:true, type:"warn", msg:"⚠️ Server unavailable. Using local data." });
      refreshNextExpected(model, serials);
    });
  }, [refreshNextExpected]);

  const loadAll = useCallback(() => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    clearTimeout(loadTimerRef.current);
    loadTimerRef.current = setTimeout(() => {
      if (loadingRef.current) { loadingRef.current = false; setSyncUI("error", "Load timeout — will retry"); }
    }, 30000);
    const today = todayStr();
    setSyncUI("syncing", "Loading data...");
    const newSerials = [], newIdles = [], newReloads = [], newScanned = new Set();
    const newHourly = SLOTS.map((s, i) => ({
      slot:s, prod:0,
      target: appSettings.targets[i] !== undefined ? appSettings.targets[i] : DEF_TARGETS[i],
      idle:0, dept:"", reason:"", reloads:0,
    }));

    const p1 = getSheet("ProductionData").then(res => {
      if (!res.data || res.data.length < 2) return;
      for (let i = 1; i < res.data.length; i++) {
        const r = res.data[i];
        if (parseSheetDate(r[1]) !== today) continue;
        const ser = String(r[3] || "").trim(); if (!ser) continue;
        if (newSerials.find(x => x.serial === ser)) continue;
        newSerials.push({ serial:ser, model:String(r[2]||"").trim(), ts:String(r[0]||"").trim() });
      }
      newSerials.forEach(s => {
        newScanned.add(s.serial);
        const idx = tsToSlot(s.ts);
        if (idx >= 0 && idx < 12) newHourly[idx].prod++;
      });
    }).catch(e => console.error("ProductionData load error:", e));

    const p2 = getSheet("Idle_Records").then(res => {
      if (!res.data || res.data.length < 2) return;
      for (let i = 1; i < res.data.length; i++) {
        const r = res.data[i];
        if (parseSheetDate(r[0]) !== today) continue;
        const slot = normSlot(String(r[6]||"").trim());
        if (SLOTS.indexOf(slot) < 0) continue;
        const dur = parseFloat(r[3]) || 0, ft = String(r[1]||"").trim(), tt = String(r[2]||"").trim();
        if (newIdles.find(x => x.slot === slot && x.from === ft && x.to === tt)) continue;
        newIdles.push({ from:ft, to:tt, duration:dur, dept:String(r[4]||"").trim(), reason:String(r[5]||"").trim(), slot });
      }
      newIdles.forEach(r => {
        const idx = SLOTS.indexOf(r.slot); if (idx < 0) return;
        newHourly[idx].idle = (newHourly[idx].idle || 0) + (parseFloat(r.duration) || 0);
        if (r.dept   && !newHourly[idx].dept)   newHourly[idx].dept   = r.dept;
        if (r.reason && !newHourly[idx].reason) newHourly[idx].reason = r.reason;
      });
    }).catch(e => console.error("Idle_Records load error:", e));

    const p3 = getSheet("Reloads").then(res => {
      if (!res.data || res.data.length < 2) return;
      for (let i = 1; i < res.data.length; i++) {
        const r = res.data[i];
        if (parseSheetDate(r[0]) !== today) continue;
        const slot = normSlot(String(r[1]||"").trim()), ts_ = String(r[4]||"").trim(), cnt = parseInt(r[3]) || 1;
        if (newReloads.find(x => x.slot === slot && x.type === r[2] && x.ts === ts_)) continue;
        newReloads.push({ slot, type:String(r[2]||"").trim(), count:cnt, ts:ts_ });
      }
      newReloads.forEach(r => { const idx = SLOTS.indexOf(r.slot); if (idx >= 0) newHourly[idx].reloads = (newHourly[idx].reloads || 0) + (parseInt(r.count) || 1); });
    }).catch(e => console.error("Reloads load error:", e));

    Promise.all([p1, p2, p3]).then(() => {
      scannedRef.current = newScanned;
      const totalProd = newHourly.reduce((a, h) => a + (h.prod || 0), 0);
      setS({ date:today, totalProd, hourly:newHourly, serials:newSerials, reloads:newReloads, idles:newIdles, models:S.models, manpower:manpowerRef.current });
      loadingRef.current = false; clearTimeout(loadTimerRef.current);
      if (curModelRef.current) refreshNextExpected(curModelRef.current, newSerials);
      setSyncUI("", "Loaded " + totalProd + " units ✓");
      setTimeout(() => setSyncUI("", "Connected ✓"), 3000);
    }).catch(e => {
      loadingRef.current = false; clearTimeout(loadTimerRef.current);
      console.error("loadAll error:", e);
      setSyncUI("error", "Reload failed — showing cached data");
    });
  }, [appSettings, S.models, refreshNextExpected, setSyncUI]);

  const loadModels = useCallback(() => {
    getSheet("Models").then(res => {
      if (res.data && res.data.length > 1) {
        const models = [];
        for (let i = 1; i < res.data.length; i++) {
          const n = String(res.data[i][0]||"").trim(), c = String(res.data[i][1]||"").trim();
          if (n) models.push({ name:n, customer:c });
        }
        setS(prev => ({ ...prev, models }));
      }
    }).catch(() => {});
  }, []);

  const loadRange = useCallback(() => {
    const today = todayStr();
    getSheet("Serial_Ranges").then(res => {
      if (res.data && res.data.length > 1) {
        for (let i = res.data.length - 1; i >= 1; i--) {
          if (parseSheetDate(res.data[i][0]) === today) {
            const sr = { model:res.data[i][1], start:parseInt(res.data[i][2]), end:parseInt(res.data[i][3]), date:today };
            setSRange(sr); sRangeRef.current = sr; setRngDisp(true); return;
          }
        }
      }
      setSRange({ model:"", start:0, end:0, date:"" }); sRangeRef.current = { model:"", start:0, end:0, date:"" };
    }).catch(() => {});
  }, []);

  // FIX 7: loadMP now reads the direct { manpower } field from the new API response
  const loadMP = useCallback(() => {
    getSheet("Contents").then(res => {
      // New API returns { success, manpower } directly
      const v = parseFloat(res.manpower) || 0;
      if (v > 0) {
        manpowerRef.current = v; mpSetRef.current = true;
        setManpower(v); setMpInput(String(v)); setScanLocked(false);
        setS(prev => ({ ...prev, manpower:v }));
      }
    }).catch(() => {});
  }, []);

  const checkIdle = useCallback(() => {
    if (!lastScanRef.current) { lastScanRef.current = new Date(); return; }
    const mins = Math.floor((Date.now() - lastScanRef.current.getTime()) / 60000);
    if (mins >= appSettings.idleThr) { idleOpenRef.current = true; setIdleMinutes(mins); setShowIdleModal(true); }
  }, [appSettings.idleThr]);

  const resetDay = useCallback(() => {
    scannedRef.current = new Set(); syncedRef.current = new Set();
    nextExpRef.current = null; lastSerRef.current = null; lastScanTimeRef.current = 0;
    setSeqBanner({ show:false, type:"", msg:"" });
    manpowerRef.current = 0; mpSetRef.current = false;
    setManpower(0); setMpInput(""); setScanLocked(true);
    setSRange({ model:"", start:0, end:0, date:"" }); sRangeRef.current = { model:"", start:0, end:0, date:"" };
    setS(prev => ({
      ...prev, date:todayStr(), totalProd:0, serials:[], reloads:[], idles:[],
      hourly: SLOTS.map((s, i) => ({ slot:s, prod:0, target:appSettings.targets[i] !== undefined ? appSettings.targets[i] : DEF_TARGETS[i], idle:0, dept:"", reason:"", reloads:0 })),
      manpower:0,
    }));
  }, [appSettings.targets]);

  const pushSerial = useCallback((serial, model, ts, totalProd) => {
    if (syncedRef.current.has(serial)) return;
    setSyncUI("syncing", "Saving #" + totalProd + "...");
    const body = { action:"addSerial", date:todayStr(), serial, model, timestamp:ts };
    const try_ = (n) => {
      callServer("serverAddSerial", body).then(res => {
        if (res && res.success === false) {
          if (res.code === "SEQUENCE_ERROR") {
            setSyncUI("error", "Sequence error from server!");
            showSaveToast("⚠️ Server rejected: " + res.message, true);
            setSeqBanner({ show:true, type:"err", msg:"❌ Server rejected: " + res.message });
            scannedRef.current.delete(serial);
            setS(prev => {
              const serials = prev.serials.filter(s => s.serial !== serial);
              const hourly  = recalcHourlyProd(prev.hourly, serials);
              return { ...prev, serials, hourly, totalProd:hourly.reduce((a,h) => a+(h.prod||0), 0) };
            });
            loadLastSerial(model, []);
            setTimeout(() => setSyncUI("", "Connected ✓"), 4000);
            return;
          }
          if (res.message && /busy/i.test(res.message) && n > 0) { setTimeout(() => try_(n-1), 1500); return; }
          if (res.message && /duplicate/i.test(res.message)) {
            syncedRef.current.add(serial);
            setSyncUI("", "Already in database ✓"); showSaveToast("Serial already in database");
            setTimeout(() => setSyncUI("", "Connected ✓"), 2000); return;
          }
          setSyncUI("error", "Save error: " + (res.message || "unknown"));
          showSaveToast("Save error: " + (res.message || "unknown"), true);
          setTimeout(() => setSyncUI("", "Connected ✓"), 4000); return;
        }
        syncedRef.current.add(serial);
        // FIX 8: Toast messages updated — removed "Google Sheets" references
        setSyncUI("", "#" + totalProd + " saved ✓");
        showSaveToast("✓ Serial #" + totalProd + " saved to database");
        setTimeout(() => setSyncUI("", "Connected ✓"), 2500);
      }).catch(() => {
        if (n > 0) { setTimeout(() => try_(n-1), 2000); return; }
        setSyncUI("error", "Could not save — check connection");
        showSaveToast("❌ Could not save to database", true);
      });
    };
    try_(3);
  }, [setSyncUI, showSaveToast, recalcHourlyProd, loadLastSerial]);

  const recordProd = useCallback((serial) => {
    lastScanTimeRef.current = Date.now();
    scannedRef.current.add(serial);
    const incomingNum = extractNum(serial);
    lastSerRef.current    = serial;
    nextExpRef.current    = incomingNum !== null ? incomingNum + 1 : null;
    const ts = new Date().toLocaleString("en-IN", { timeZone:"Asia/Kolkata" });
    const model    = curModelRef.current;
    const expLabel = nextExpRef.current !== null ? buildExpectedLabel(serial, nextExpRef.current) : "—";
    setSeqBanner({ show:true, type:"ok", msg:"✅ Accepted: " + serial + "   Next expected: " + expLabel });
    setS(prev => {
      const serials   = [...prev.serials, { serial, model, ts }];
      const hourly    = recalcHourlyProd(prev.hourly.map(h => ({ ...h })), serials);
      const totalProd = hourly.reduce((a, h) => a + (h.prod || 0), 0);
      pushSerial(serial, model, ts, totalProd);
      lastScanRef.current = new Date();
      return { ...prev, serials, hourly, totalProd };
    });
    setBoxSer(""); setPrdSer(""); setCstSer("");
    setPrdDisabled(true); setCstDisabled(true);
    setSt1({ cls:"", msg:"" }); setSt2({ cls:"", msg:"" }); setSt3({ cls:"", msg:"" });
    setBoxClass(""); setPrdClass(""); setCstClass("");
    setTimeout(() => { if (boxRef.current) boxRef.current.focus(); }, 400);
  }, [recalcHourlyProd, pushSerial]);

  const handleBoxInput = useCallback((val) => {
    setBoxSer(val);
    clearTimeout(scanT1.current);
    scanT1.current = setTimeout(() => {
      const v = val.trim().toUpperCase();
      if (!v || v.length < 5) return;
      checkIdle();
      const dateStatus = checkSerialDateStatus(v);
      if (dateStatus === "past") {
        const lbl = decodeSerialDateLabel(v);
        setSt1({ cls:"err", msg:"❌ DUPLICATE!" }); setBoxSer("");
        setBoxClass("fi-red"); setTimeout(() => setBoxClass(""), 1800); beep(false);
        alert("⚠️ DUPLICATE SERIAL!\n" + v + "\n\nEncoded date: " + lbl + "\nThis serial is from a past date.\nAlready scanned in a previous production run.");
        return;
      }
      if (dateStatus === "future") {
        const lbl = decodeSerialDateLabel(v);
        setSt1({ cls:"err", msg:"❌ Invalid sequence!" }); setBoxSer("");
        setBoxClass("fi-red"); setTimeout(() => setBoxClass(""), 1800); beep(false);
        setSeqBanner({ show:true, type:"err", msg:"❌ Invalid sequence! Serial date (" + lbl + ") is in the future." });
        const t = getTodayIST();
        alert("⚠️ INVALID SEQUENCE!\n\nYou scanned:    " + v + "\nEncoded date:   " + lbl + "\nToday's date:   " + t.date + " (" + ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][t.month] + ") " + t.year + "\n\nThis serial is from a future date. Please check the barcode.");
        return;
      }
      if (scannedRef.current.has(v)) {
        setSt1({ cls:"err", msg:"❌ DUPLICATE!" }); setBoxSer("");
        setBoxClass("fi-red"); setTimeout(() => setBoxClass(""), 1800); beep(false);
        alert("⚠️ DUPLICATE SERIAL!\n" + v + "\nAlready scanned today."); return;
      }
      const model = parseModel(v);
      if (!model) { setSt1({ cls:"err", msg:"❌ Invalid format" }); setBoxSer(""); beep(false); alert("⚠️ INVALID FORMAT!\n" + v); return; }
      const sr = sRangeRef.current;
      if (sr.model && sr.date === todayStr() && model === sr.model) {
        const sn = parseInt((v.match(/(\d+)$/) || ["","0"])[1]);
        if (sn < sr.start || sn > sr.end) {
          setSt1({ cls:"err", msg:"❌ Out of Range!" }); setBoxSer("");
          setBoxClass("fi-red"); setTimeout(() => setBoxClass(""), 1800); beep(false);
          alert("⚠️ SERIAL OUT OF RANGE!\nExpected: " + pad5(sr.start) + " – " + pad5(sr.end) + "\nScanned: " + pad5(sn)); return;
        }
      }
      if (model !== curModelRef.current) {
        setSt1({ cls:"err", msg:"❌ Wrong Model: " + curModelRef.current }); setBoxSer("");
        setBoxClass("fi-red"); setTimeout(() => setBoxClass(""), 1800); beep(false);
        alert("⚠️ WRONG MODEL!\nExpected: " + curModelRef.current + "\nDetected: " + model); return;
      }
      if (nextExpRef.current !== null && !seqLoadRef.current) {
        const incomingNum = extractNum(v);
        if (incomingNum !== null && incomingNum !== nextExpRef.current) {
          const expLabel = buildExpectedLabel(lastSerRef.current, nextExpRef.current);
          setSt1({ cls:"err", msg:"❌ Wrong sequence!" }); setBoxSer("");
          setBoxClass("fi-red"); setTimeout(() => setBoxClass(""), 1800); beep(false);
          setSeqBanner({ show:true, type:"err", msg:"❌ Invalid sequence! Expected: " + expLabel + "   (last scanned: " + (lastSerRef.current || "none") + ")" });
          alert("⚠️ INVALID SEQUENCE!\n\nYou scanned:   " + v + "\nExpected next: " + expLabel + "\nLast scanned:  " + (lastSerRef.current || "none") + "\n\nPlease scan " + expLabel + " first."); return;
        }
      }
      setSt1({ cls:"ok", msg:"✓ Valid — " + model });
      setBoxClass("fi-green"); setTimeout(() => setBoxClass(""), 1400);
      setPrdDisabled(false); beep(true);
      setTimeout(() => { if (prdRef.current) prdRef.current.focus(); }, 150);
    }, 130);
  }, [checkIdle]);

  const handleProdInput = useCallback((val) => {
    setPrdSer(val);
    clearTimeout(scanT2.current);
    scanT2.current = setTimeout(() => {
      const v = val.trim().toUpperCase(), bv = boxSer.trim().toUpperCase();
      if (!v || v.length < 5) return;
      if (v !== bv) {
        setSt2({ cls:"err", msg:"❌ Mismatch!" }); setPrdSer("");
        setPrdClass("fi-red"); setTimeout(() => setPrdClass(""), 1800); beep(false);
        alert("⚠️ MISMATCH!\nBox: " + bv + "\nProduct: " + v); return;
      }
      setSt2({ cls:"ok", msg:"✓ Matched" });
      setPrdClass("fi-green"); setTimeout(() => setPrdClass(""), 1400);
      setCstDisabled(false); beep(true);
      setTimeout(() => { if (cstRef.current) cstRef.current.focus(); }, 150);
    }, 130);
  }, [boxSer]);

  const handleCustInput = useCallback((val) => {
    setCstSer(val);
    clearTimeout(scanT3.current);
    scanT3.current = setTimeout(() => {
      const v = val.trim().toUpperCase(), bv = boxSer.trim().toUpperCase();
      if (!v || v.length < 5) return;
      if (v !== bv) {
        setSt3({ cls:"err", msg:"❌ Mismatch!" }); setCstSer("");
        setCstClass("fi-red"); setTimeout(() => setCstClass(""), 1800); beep(false);
        alert("⚠️ MISMATCH!\nBox: " + bv + "\nCustomer: " + v); return;
      }
      setSt3({ cls:"ok", msg:"✓ All 3 Match — Saving..." });
      setCstClass("fi-green"); setPrdClass("fi-green"); setBoxClass("fi-green"); beep(true);
      setTimeout(() => recordProd(bv), 400);
    }, 130);
  }, [boxSer, recordProd]);

  const saveIdle = useCallback(() => {
    if (!idleDept || !idleRsn.trim()) { alert("Select department and enter reason."); return; }
    const now = new Date(new Date().toLocaleString("en-US", { timeZone:"Asia/Kolkata" }));
    const hr = now.getHours(), idx = Math.max(0, Math.min(hr-7, 11));
    const from = lastScanRef.current || now;
    const dur  = Math.floor((now.getTime() - from.getTime()) / 60000);
    const slot = SLOTS[idx];
    const rec  = { from:from.toLocaleTimeString("en-IN"), to:now.toLocaleTimeString("en-IN"), duration:dur, dept:idleDept, reason:idleRsn, slot };
    setS(prev => {
      const idles  = [...prev.idles, rec];
      const hourly = prev.hourly.map((h, i) => i === idx ? { ...h, idle:(h.idle||0)+dur, dept:idleDept, reason:idleRsn } : h);
      return { ...prev, idles, hourly };
    });
    callServer("serverAddIdleTime", { action:"addIdleTime", date:todayStr(), fromTime:rec.from, toTime:rec.to, duration:dur, department:idleDept, reason:idleRsn, slot })
      .then(r => { if (r && r.success !== false) showSaveToast("✓ Idle record saved"); else showSaveToast("⚠️ Idle save error", true); })
      .catch(() => showSaveToast("⚠️ Idle sync failed", true));
    lastScanRef.current = now; setShowIdleModal(false); idleOpenRef.current = false;
    setIdleDept(""); setIdleRsn("");
  }, [idleDept, idleRsn, showSaveToast]);

  const addReload = useCallback(() => {
    const ts = new Date().toLocaleString("en-IN", { timeZone:"Asia/Kolkata" });
    const rec = { slot:rldSlot, type:rldType, count:rldCnt, ts };
    setS(prev => {
      const reloads = [...prev.reloads, rec];
      const hourly  = prev.hourly.map((h, i) => SLOTS[i] === rldSlot ? { ...h, reloads:(h.reloads||0)+rldCnt } : h);
      return { ...prev, reloads, hourly };
    });
    callServer("serverAddReload", { action:"addReload", date:todayStr(), slot:rldSlot, type:rldType, count:rldCnt, timestamp:ts })
      .then(r => { if (r && r.success !== false) showSaveToast("✓ Reload saved"); else showSaveToast("⚠️ Reload error", true); })
      .catch(() => showSaveToast("⚠️ Reload sync failed", true));
    setRldCnt(1);
  }, [rldSlot, rldType, rldCnt, showSaveToast]);

  const setMP = useCallback(() => {
    const v = parseInt(mpInput);
    if (!v || v < 1) { alert("Enter valid worker count (min 1)."); return; }
    manpowerRef.current = v; mpSetRef.current = true;
    setManpower(v); setScanLocked(false); setS(prev => ({ ...prev, manpower:v }));
    callServer("serverSetManpower", { action:"setManpower", date:todayStr(), manpower:v })
      .catch(e => console.error("setManpower:", e));
    alert("✅ Manpower set: " + v + " workers. Scanning enabled!");
  }, [mpInput]);

  const setRange = useCallback(() => {
    if (!rngModel || !rngStart || !rngEnd) { alert("All fields required."); return; }
    const sn = parseInt(rngStart.replace(/\D/g,"").slice(-5));
    const en = parseInt(rngEnd.replace(/\D/g,"").slice(-5));
    if (isNaN(sn) || isNaN(en) || sn === 0) { alert("Invalid serial numbers."); return; }
    if (sn >= en) { alert("End serial must be greater than start."); return; }
    const sr = { model:rngModel, start:sn, end:en, date:todayStr() };
    setSRange(sr); sRangeRef.current = sr; setRngDisp(true);
    callServer("serverSetSerialRange", { action:"setSerialRange", date:sr.date, model:rngModel, start:sn, end:en, expected:en-sn+1, scanned:0, missing:en-sn+1 }).catch(() => {});
    alert("✅ Range set!\nModel: " + rngModel + "\nRange: " + pad5(sn) + " → " + pad5(en));
  }, [rngModel, rngStart, rngEnd]);

  const addModel = useCallback(() => {
    const n = newMdl.trim(), c = newCust.trim();
    if (!n || !c) { alert("Enter both model name and customer name."); return; }
    if (S.models.find(m => m.name === n)) { alert("Model already exists."); return; }
    callServer("serverSaveModel", { action:"saveModel", modelName:n, customer:c })
      .then(() => { setS(prev => ({ ...prev, models:[...prev.models, { name:n, customer:c }] })); setNewMdl(""); setNewCust(""); alert("✅ Model saved!"); })
      .catch(() => { setS(prev => ({ ...prev, models:[...prev.models, { name:n, customer:c }] })); setNewMdl(""); setNewCust(""); alert("⚠️ Saved locally."); });
  }, [newMdl, newCust, S.models]);

  const delModel = useCallback((name) => {
    if (!confirm("Remove model " + name + "?")) return;
    callServer("serverDeleteModel", { action:"deleteModel", modelName:name })
      .finally(() => { setS(prev => ({ ...prev, models:prev.models.filter(m => m.name !== name) })); });
  }, []);

  const adminClick = useCallback(() => {
    adClicksRef.current++;
    if (adClicksRef.current >= 5) { adClicksRef.current = 0; setShowAdminModal(true); }
    setTimeout(() => { adClicksRef.current = Math.max(0, adClicksRef.current - 1); }, 3000);
  }, []);

  // FIX 9: doAdmin now reads res.verified instead of bare truthy (res was always an object)
  const doAdmin = useCallback(() => {
    if (!adminPwd) { alert("Enter admin password."); return; }
    callServer("serverVerifyAdmin", { password:adminPwd })
      .then(res => {
        if (res?.verified || res?.success) {
          setAdminUnlocked(true); setShowAdminModal(false); setAdminPwd(""); setActiveTab("admin");
        } else { alert("Incorrect password."); setAdminPwd(""); }
      })
      .catch(() => { alert("Incorrect password."); setAdminPwd(""); });
  }, [adminPwd]);

  const saveTargets = useCallback(() => {
    const newT = targets.slice();
    setS(prev => ({ ...prev, hourly:prev.hourly.map((h, i) => ({ ...h, target:newT[i] })) }));
    setAppSettings(prev => ({ ...prev, targets:newT }));
    saveSetting("targets", newT);
    alert("✅ Targets saved!");
  }, [targets, saveSetting]);

  const saveSettings = useCallback(() => {
    const thr = parseInt(idleThrInput) || 2;
    setAppSettings(prev => ({ ...prev, idleThr:thr }));
    saveSetting("idleThr", thr);
    alert("✅ Settings saved!");
  }, [idleThrInput, saveSetting]);

  const addUser = useCallback(() => {
    if (!uEmail || !uName) { alert("Enter both email and name."); return; }
    callServer("serverAddUser", { action:"addUser", email:uEmail, name:uName })
      .then(res => {
        if (res.success === false) { alert(res.message || "Error adding user."); return; }
        alert("✅ User added: " + uName); setUEmail(""); setUName(""); loadUsersList();
      })
      .catch(e => alert("Error: " + (e.message || e)));
  }, [uEmail, uName]);

  const loadUsersList = useCallback(() => {
    getSheet("AuthUsers").then(data => {
      if (!data.data || data.data.length <= 1) { setUsersList([]); return; }
      setUsersList(data.data.slice(1));
    }).catch(() => setUsersList([]));
  }, []);

  // ── Reports ─────────────────────────────────────────────────────────────────
  const rptDaily = useCallback(() => {
    const ti  = (S.idles||[]).reduce((a,h) => a+(h.duration||0), 0);
    const tr  = (S.reloads||[]).reduce((a,r) => a+(r.count||1), 0);
    const tt  = (S.hourly||[]).reduce((a,h) => a+(h.target||0), 0);
    const ach = tt > 0 ? Math.round(S.totalProd/tt*100) : 0;
    setRptContent(
      <div className="al al-ok">
        <strong>Daily Production Report — {S.date}</strong><br/><br/>
        Total Production: <strong>{S.totalProd||0}</strong><br/>
        Total Target: <strong>{tt}</strong><br/>
        Achievement: <strong>{ach}%</strong><br/>
        Manpower: <strong>{manpower||0}</strong><br/>
        Total Idle Time: <strong>{ti} min</strong><br/>
        Total Reloads: <strong>{tr}</strong>
      </div>
    );
  }, [S, manpower]);

  const rptSerials = useCallback(() => {
    if (!(S.serials||[]).length) { setRptContent(<div className="al al-info">No serials recorded yet.</div>); return; }
    setRptContent(<>
      <div className="sec-title">Serial Numbers — {S.date} ({S.serials.length} total)</div>
      <div className="tbl-wrap"><table><thead><tr><th>#</th><th>Serial</th><th>Model</th><th>Time</th></tr></thead>
      <tbody>{S.serials.map((s,i)=><tr key={i}><td>{i+1}</td><td><strong>{s.serial}</strong></td><td>{s.model}</td><td>{s.ts}</td></tr>)}</tbody>
      </table></div>
    </>);
  }, [S]);

  const rptIdle = useCallback(() => {
    if (!(S.idles||[]).length) { setRptContent(<div className="al al-ok">No idle time recorded today! 🎉</div>); return; }
    setRptContent(<>
      <div className="sec-title">Idle Time Analysis — {S.date}</div>
      <div className="tbl-wrap"><table><thead><tr><th>From</th><th>To</th><th>Duration</th><th>Department</th><th>Reason</th></tr></thead>
      <tbody>{S.idles.map((r,i)=><tr key={i}><td>{r.from}</td><td>{r.to}</td><td><strong style={{color:"var(--red)"}}>{r.duration} min</strong></td><td>{r.dept}</td><td>{r.reason}</td></tr>)}</tbody>
      </table></div>
    </>);
  }, [S]);

  const rptMissing = useCallback(() => {
    if (!sRange.model || sRange.date !== todayStr()) { setRptContent(<div className="al al-warn">No serial range set for today.</div>); return; }
    const sc = new Set();
    (S.serials||[]).forEach(s => {
      if (s.model !== sRange.model) return;
      const n = parseInt((s.serial.match(/(\d+)$/) || ["","0"])[1]);
      if (n >= sRange.start && n <= sRange.end) sc.add(n);
    });
    const miss = [];
    for (let i = sRange.start; i <= sRange.end; i++) { if (!sc.has(i)) miss.push(pad5(i)); }
    if (!miss.length) { setRptContent(<div className="al al-ok">✅ All serials scanned! No missing.</div>); return; }
    setRptContent(<>
      <div className="al al-warn"><strong>Missing Serials — Model: {sRange.model} — Total: {miss.length}</strong></div>
      <div className="tbl-wrap"><table><thead><tr><th>#</th><th>Missing Serial</th></tr></thead>
      <tbody>{miss.map((s,i)=><tr key={i}><td>{i+1}</td><td><strong>{s}</strong></td></tr>)}</tbody>
      </table></div>
    </>);
  }, [S, sRange]);

  // ── Export ───────────────────────────────────────────────────────────────────
  const dlFile = (content, name, mime) => {
    const blob = new Blob([content], { type:mime }), url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportCSV = () => {
    let csv = "Time Slot,Production,Target,Achievement %,Idle Time (min),Department,Reloads\n";
    (S.hourly||[]).forEach(h => {
      const a = (h.target||0) > 0 ? Math.round(((h.prod||0)/(h.target||0))*100) : 0;
      csv += h.slot+","+(h.prod||0)+","+(h.target||0)+","+a+"%,"+(h.idle||0)+","+(h.dept||"-")+","+(h.reloads||0)+"\n";
    });
    dlFile(csv, "Hourly_"+S.date+".csv", "text/csv");
  };

  const dlBackup = () => dlFile(JSON.stringify({ date:S.date, totalProd:S.totalProd, manpower, hourly:S.hourly }, null, 2), "Backup_"+S.date+".json", "application/json");

  // FIX 10: dlSheet now uses the new API path map instead of calling getSheet with old sheet names
  const dlSheet = (sheetName) => {
    const pathFn = SHEET_DOWNLOAD_MAP[sheetName];
    if (!pathFn) { alert("Download not available for: " + sheetName); return; }
    setSyncUI("syncing", "Downloading " + sheetName + "...");
    apiFetch("GET", pathFn(todayStr())).then(res => {
      if (res.error) { alert("Error: " + res.error); setSyncUI("error", "Download failed"); return; }
      const csv = (res.data||[]).map(row =>
        (row||[]).map(cell => { const s = cell == null ? "" : ("" + cell); return (s.includes(",") || s.includes('"') || s.includes("\n")) ? '"' + s.replace(/"/g,'""') + '"' : s; }).join(",")
      ).join("\n");
      dlFile(csv, sheetName+"_"+todayStr()+".csv", "text/csv");
      setSyncUI("", sheetName + " downloaded ✓");
      setTimeout(() => setSyncUI("", "Connected ✓"), 2500);
    }).catch(() => { setSyncUI("error", "Download failed"); alert("Download failed: " + sheetName); });
  };

  const newDayReset = () => {
    if (!confirm("⚠️ RESET FOR NEW DAY?\n\nDashboard will clear.\nAll database data is safe.\n\nContinue?")) return;
    if (!confirm("Final confirmation: Reset now?")) return;
    resetDay(); alert("✅ Reset complete! All database data is safe.");
  };

  // FIX 11: confirmLogout now calls onLogout() (shows login popup) instead of window.location.replace
  const confirmLogout = () => {
    setShowLogoutConfirm(false);
    setShowLogoutOverlay(true);
    setTimeout(() => {
      setShowLogoutOverlay(false);
      onLogout();
    }, 1400);
  };

  const onModelSel = (val) => {
    if (!mpSetRef.current || !manpowerRef.current) { alert("⚠️ Please set manpower count first!"); return; }
    curModelRef.current = val; setCurModel(val);
    setScanInputsVisible(!!val);
    nextExpRef.current = null; lastSerRef.current = null;
    if (val) { loadLastSerial(val, S.serials); setTimeout(() => { if (boxRef.current) boxRef.current.focus(); }, 100); }
    else { setSeqBanner({ show:false, type:"", msg:"" }); }
  };

  const getDashKPIs = () => {
    const now  = new Date(new Date().toLocaleString("en-US", { timeZone:"Asia/Kolkata" }));
    const hr   = now.getHours(), mins = now.getMinutes();
    const wh   = hr >= 7 ? Math.min(((hr-7)*60+mins)/60, 12) : 0;
    const tp   = S.totalProd;
    const tr   = (S.reloads||[]).reduce((a,r) => a+(r.count||1), 0);
    const uph  = wh > 0 ? Math.round(tp/wh) : 0;
    const upph = (wh > 0 && manpower > 0) ? (tp/wh/manpower).toFixed(1) : "0.0";
    let proT = 0;
    (S.hourly||[]).forEach((h, i) => {
      const sh = 7+i;
      if (sh < hr)      proT += (h.target||0);
      else if (sh === hr) proT += Math.round((h.target||0)*(mins/60));
    });
    const ach = proT > 0 ? Math.round((tp/proT)*100) : 0;
    return { tp, tr, uph, upph, ach };
  };
  const kpi = getDashKPIs();

  const getCustBadge = () => {
    if (!S.serials || !S.serials.length) return "No Model Selected";
    const recent = S.serials.slice(-20), counts = {};
    recent.forEach(s => { counts[s.model] = (counts[s.model]||0)+1; });
    let best = "", max = 0;
    Object.keys(counts).forEach(k => { if (counts[k] > max) { max = counts[k]; best = k; } });
    if (best) { const md = (S.models||[]).find(m => m.name === best); return md ? (md.customer+" ("+best+")") : "Model: "+best; }
    return "No Model Selected";
  };

  // ── Init ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadSettings((settings) => {
      setS(prev => ({ ...prev, hourly:initHourly(settings.targets) }));
      setSyncUI("syncing", "Loading data...");
      loadModels(); loadRange(); loadMP();
      setTimeout(loadAll, 500);
    });
    const idleIv = setInterval(() => { if (!idleOpenRef.current && lastScanRef.current) checkIdle(); }, 10000);
    const dayIv  = setInterval(() => { if (S.date !== todayStr()) resetDay(); }, 60000);
    return () => { clearInterval(idleIv); clearInterval(dayIv); };
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      if (idleOpenRef.current || loadingRef.current) return;
      const secsSinceScan = (Date.now()-lastScanTimeRef.current)/1000;
      if (secsSinceScan < 10) return;
      loadAll();
    }, 45000);
    return () => clearInterval(iv);
  }, [loadAll]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{CSS}</style>

      {showLogoutOverlay && (
        <div className="lo-overlay">
          <div className="lo-card">
            <div style={{fontSize:44,marginBottom:12}}>🔒</div>
            <h3 style={{fontSize:18,fontWeight:800,color:"#111",marginBottom:6}}>Session Ended</h3>
            <p style={{fontSize:12,color:"#6b7280",marginBottom:0}}>You have been securely logged out.</p>
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginTop:16,color:"#C41E4E",fontSize:12,fontWeight:600}}>
              <div className="spin" /><span>Returning to login...</span>
            </div>
          </div>
        </div>
      )}

      {showLogoutConfirm && (
        <div className="modal-overlay" style={{background:"rgba(0,0,0,0.7)"}}>
          <div style={{background:"#fff",padding:"32px 28px",borderRadius:16,maxWidth:360,width:"90%",textAlign:"center",boxShadow:"0 20px 60px rgba(0,0,0,0.4)"}}>
            <div style={{fontSize:40,marginBottom:12}}>🔐</div>
            <h4 style={{fontSize:17,fontWeight:800,color:"#111827",marginBottom:8}}>Confirm Logout</h4>
            <p style={{fontSize:13,color:"#6b7280",marginBottom:22,lineHeight:1.5}}>Are you sure you want to log out from PG GROUP Production Monitor?</p>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setShowLogoutConfirm(false)} style={{flex:1,padding:11,border:"none",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer",background:"#f3f4f6",color:"#374151",fontFamily:"Inter,sans-serif"}}>Cancel</button>
              <button onClick={confirmLogout} style={{flex:1,padding:11,border:"none",borderRadius:10,fontSize:14,fontWeight:700,cursor:"pointer",background:"#C41E4E",color:"white",fontFamily:"Inter,sans-serif"}}>Yes, Logout</button>
            </div>
          </div>
        </div>
      )}

      {showIdleModal && (
        <div className="modal-overlay">
          <div className="m-box">
            <div className="m-title" style={{color:"var(--red)"}}>⚠️ Production Line Idle Detected</div>
            <div className="al al-err">Line idle for <strong>{idleMinutes}</strong> minutes. Enter department and reason to continue.</div>
            <div className="fg">
              <label className="fl">Responsible Department *</label>
              <select className="fs" value={idleDept} onChange={e=>setIdleDept(e.target.value)}>
                <option value="">-- Select Department --</option>
                {["Store","Maintenance","Molding","QA","Purchase","Production","Quality Control","Material Handling","Engineering","Planning"].map(d=><option key={d}>{d}</option>)}
              </select>
            </div>
            <div className="fg">
              <label className="fl">Reason *</label>
              <textarea className="fi" rows="3" placeholder="e.g., RM shortage, Machine breakdown..." value={idleRsn} onChange={e=>setIdleRsn(e.target.value)}/>
            </div>
            <button className="btn btn-red" onClick={saveIdle} style={{width:"100%",padding:11,fontSize:13}}>Save &amp; Continue →</button>
          </div>
        </div>
      )}

      {showAdminModal && (
        <div className="modal-overlay">
          <div className="m-box">
            <div className="m-title">🔐 Admin Access</div>
            <div className="fg">
              <label className="fl">Admin Password</label>
              <input type="password" className="fi" placeholder="Enter admin password" value={adminPwd}
                onChange={e=>setAdminPwd(e.target.value)}
                onKeyPress={e=>{if(e.key==="Enter")doAdmin();}}/>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-red" onClick={doAdmin} style={{flex:1,padding:9}}>Verify</button>
              <button className="btn btn-dngr" onClick={()=>{setShowAdminModal(false);setAdminPwd("");}} style={{flex:1,padding:9}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="pg-app">
        <div className="hdr">
          <div className="hdr-l">
            <button className="logo-btn" onClick={adminClick} title="Click 5x for admin">
              <img src="https://cms-complaint-avidence.s3.eu-north-1.amazonaws.com/pg-logo-Photoroom.png"
                height="44" style={{display:"block",borderRadius:6,background:"white",padding:3}} alt="PG Logo"/>
            </button>
            <div className="hdr-title"><span className="co">PG GROUP</span><span>Production Monitor</span></div>
            <div className="live-badge">● LIVE</div>
            <div className="cust-badge">{getCustBadge()}</div>
          </div>
          <div className="hdr-r">
            <div className="time-d"><div className="t">{clockTime}</div><div className="d">{clockDate}</div></div>
            <div className="hdr-kpi"><div className="v">{S.totalProd}</div><div className="l">Total Production</div></div>
            <button className="logout-btn" onClick={()=>setShowLogoutConfirm(true)}>Logout</button>
          </div>
        </div>

        {(() => {
          const tabs = [
            { id:"dashboard", label:"📊 Dashboard", show:true },
            { id:"scanning",  label:"🔍 Scanning",  show:true },
            { id:"reports",   label:"📋 Reports",   show:true },
            { id:"charts",    label:"📈 Charts",    show:true },
            { id:"settings",  label:"⚙️ Settings",  show:true },
          ];
          return (
            <div className="pg-tabs">
              {tabs.filter(t => t.show).map(t => (
                <button key={t.id} className={`pg-tab${activeTab===t.id?" active":""}`} onClick={()=>setActiveTab(t.id)}>
                  {t.label}
                </button>
              ))}
             {adminUnlocked && (
           <button className={`pg-tab${activeTab==="admin"?" active":""}`} onClick={()=>{setActiveTab("admin");loadUsersList();}}>🔐 Admin</button>
          )}
            </div>
          );
        })()}

        {activeTab==="dashboard" && <DashboardTab S={S} kpi={kpi} exportCSV={exportCSV} loadAll={loadAll} dlBackup={dlBackup} dlSheet={dlSheet} newDayReset={newDayReset}/>}
        {activeTab==="scanning" && (
          <ScanningTab
            S={S} scanLocked={scanLocked} seqBanner={seqBanner}
            scanInputsVisible={scanInputsVisible} curModel={curModel} onModelSel={onModelSel}
            boxSer={boxSer} prdSer={prdSer} cstSer={cstSer}
            boxClass={boxClass} prdClass={prdClass} cstClass={cstClass}
            prdDisabled={prdDisabled} cstDisabled={cstDisabled}
            st1={st1} st2={st2} st3={st3}
            boxRef={boxRef} prdRef={prdRef} cstRef={cstRef}
            handleBoxInput={handleBoxInput} handleProdInput={handleProdInput} handleCustInput={handleCustInput}
            rldSlot={rldSlot} setRldSlot={setRldSlot} rldType={rldType} setRldType={setRldType}
            rldCnt={rldCnt} setRldCnt={setRldCnt} addReload={addReload}
            mpInput={mpInput} setMpInput={setMpInput} manpower={manpower} setMP={setMP}
          />
        )}
        {activeTab==="reports"  && <ReportsTab rptDaily={rptDaily} rptSerials={rptSerials} rptIdle={rptIdle} rptMissing={rptMissing} rptContent={rptContent}/>}
        {activeTab==="charts"   && <ChartsTab S={S} manpower={manpower}/>}
        {activeTab==="settings" && (
          <SettingsTab
            S={S} sRange={sRange} rngDisp={rngDisp}
            rngModel={rngModel} setRngModel={setRngModel}
            rngStart={rngStart} setRngStart={setRngStart}
            rngEnd={rngEnd} setRngEnd={setRngEnd}
            setRange={setRange} countRange={countRange}
            lotMode={lotMode} setLotMode={v=>{setLotMode(v);saveSetting("lotMode",v);}}
            newMdl={newMdl} setNewMdl={setNewMdl}
            newCust={newCust} setNewCust={setNewCust}
            addModel={addModel} delModel={delModel}
          />
        )}
        {activeTab==="admin" && adminUnlocked && (
          <AdminTab
            S={S} targets={targets} setTargets={setTargets}
            idleThrInput={idleThrInput} setIdleThrInput={setIdleThrInput}
            saveTargets={saveTargets} defaultTargets={()=>setTargets(DEF_TARGETS.slice())}
            saveSettings={saveSettings}
            uEmail={uEmail} setUEmail={setUEmail}
            uName={uName} setUName={setUName}
            addUser={addUser} usersList={usersList}
          />
        )}
      </div>

      <div className="sync-bar">
        <div className={`sync-dot${syncState.dot==="syncing"?" syncing":syncState.dot==="error"?" error":""}`}/>
        <span>{syncState.txt}</span>
      </div>

      {toast.show && (
        <div className="save-toast" style={{background:toast.isErr?"#991b1b":"#065f46",color:"white"}}>
          <span>{toast.msg}</span>
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD TAB
// ═══════════════════════════════════════════════════════════════════════════════
function DashboardTab({ S, kpi, exportCSV, loadAll, dlBackup, dlSheet, newDayReset }) {
  const now    = new Date(new Date().toLocaleString("en-US", { timeZone:"Asia/Kolkata" }));
  const curHr  = now.getHours();
  const achCls = kpi.ach >= 100 ? "kpi-card green" : kpi.ach >= 80 ? "kpi-card amber" : "kpi-card red";
  return (
    <div className="tab-pane">
      <div className="kpi-grid">
        <div className="kpi-card"><div className="v">{kpi.tp}</div><div className="l">Today's Production</div></div>
        <div className="kpi-card"><div className="v">{kpi.tr}</div><div className="l">Total Reloads</div></div>
        <div className="kpi-card"><div className="v">{kpi.uph}</div><div className="l">UPH (Units/Hour)</div></div>
        <div className="kpi-card"><div className="v">{kpi.upph}</div><div className="l">UPPH (Units/Person/Hr)</div></div>
        <div className={achCls}><div className="v">{kpi.ach}%</div><div className="l">Achievement</div></div>
      </div>
      <div className="tbl-wrap">
        <table>
          <thead><tr><th>Time Slot</th><th>Production</th><th>Target</th><th>Achievement</th><th>Idle (min)</th><th>Department</th><th>Reloads</th></tr></thead>
          <tbody>
            {(S.hourly||[]).map((h,i)=>{
              const sh  = 7+i;
              const ach = h.target>0 ? Math.round(((h.prod||0)/h.target)*100) : -1;
              const rowCls = sh<=curHr ? (ach>=100?"row-green":ach>=80?"row-amber":(ach>=0&&h.target>0?"row-red":"")) : "";
              const achStr = h.target>0 ? (ach+"%") : "—";
              const achCol = ach>=100?"#059669":ach>=80?"#d97706":"#dc2626";
              return (
                <tr key={i} className={rowCls}>
                  <td><strong>{h.slot}</strong></td>
                  <td><strong style={{color:"var(--navy)"}}>{h.prod||0}</strong></td>
                  <td>{h.target||0}</td>
                  <td><strong style={{color:h.target>0&&sh<=curHr?achCol:"#6b7280"}}>{achStr}</strong></td>
                  <td style={{color:(h.idle||0)>0?"var(--red)":"var(--g600)",fontWeight:600}}>{h.idle||0}</td>
                  <td style={{fontSize:11}}>{h.dept||"—"}</td>
                  <td>{h.reloads||0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="btn-row">
        <button className="btn btn-grn" onClick={exportCSV}>⬇ Hourly CSV</button>
        <button className="btn btn-navy" onClick={loadAll}>🔄 Refresh</button>
        <button className="btn btn-amb" onClick={dlBackup}>💾 Backup JSON</button>
        <button className="btn btn-grn" onClick={()=>dlSheet("ProductionData")}>⬇ Serials CSV</button>
        <button className="btn btn-grn" onClick={()=>dlSheet("Idle_Records")}>⬇ Idle CSV</button>
        <button className="btn btn-grn" onClick={()=>dlSheet("Reloads")}>⬇ Reloads CSV</button>
        <button className="btn btn-dngr" onClick={newDayReset}>🔄 New Day Reset</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCANNING TAB
// ═══════════════════════════════════════════════════════════════════════════════
function ScanningTab({ S, scanLocked, seqBanner, scanInputsVisible, curModel, onModelSel,
  boxSer, prdSer, cstSer, boxClass, prdClass, cstClass, prdDisabled, cstDisabled,
  st1, st2, st3, boxRef, prdRef, cstRef,
  handleBoxInput, handleProdInput, handleCustInput,
  rldSlot, setRldSlot, rldType, setRldType, rldCnt, setRldCnt, addReload,
  mpInput, setMpInput, manpower, setMP }) {
  return (
    <div className="tab-pane">
      <div className={`scan-box${scanLocked?" locked":""}`}>
        <div className="sec-title">🔍 3-Step Serial Validation</div>
        {seqBanner.show && <div className={`seq-banner ${seqBanner.type}`}>{seqBanner.msg}</div>}
        <div className="fg">
          <label className="fl">Select Model</label>
          <select className="fs" value={curModel} onChange={e=>onModelSel(e.target.value)}>
            <option value="">-- Select Model --</option>
            {(S.models||[]).map(m=><option key={m.name} value={m.name}>{m.name} — {m.customer}</option>)}
          </select>
        </div>
        {scanInputsVisible && (<>
          <div className="fg">
            <label className="fl">Step 1 — Box Serial <span className={`ss-lbl ${st1.cls==="ok"?"ss-ok":"ss-err"}`}>{st1.msg}</span></label>
            <input ref={boxRef} type="text" className={`fi ${boxClass}`} placeholder="Scan box serial" value={boxSer}
              onChange={e=>handleBoxInput(e.target.value)}
              onKeyPress={e=>{if(e.keyCode===13){e.preventDefault();handleBoxInput(boxSer);}}}/>
          </div>
          <div className="fg">
            <label className="fl">Step 2 — Product Serial <span className={`ss-lbl ${st2.cls==="ok"?"ss-ok":"ss-err"}`}>{st2.msg}</span></label>
            <input ref={prdRef} type="text" className={`fi ${prdClass}`} placeholder="Scan product serial" disabled={prdDisabled} value={prdSer}
              onChange={e=>handleProdInput(e.target.value)}/>
          </div>
          <div className="fg">
            <label className="fl">Step 3 — Customer Serial <span className={`ss-lbl ${st3.cls==="ok"?"ss-ok":"ss-err"}`}>{st3.msg}</span></label>
            <input ref={cstRef} type="text" className={`fi ${cstClass}`} placeholder="Scan customer serial" disabled={cstDisabled} value={cstSer}
              onChange={e=>handleCustInput(e.target.value)}/>
          </div>
        </>)}
      </div>

      <div className="recent">
        <div className="sec-title" style={{marginBottom:6}}>Recent Scanned Serials</div>
        {!(S.serials||[]).length
          ? <p style={{color:"var(--g400)",fontSize:12}}>No serials scanned yet.</p>
          : S.serials.slice(-12).reverse().map((s,i)=>(
            <div key={i} style={{padding:"4px 9px",background:i===0?"#d1fae5":"#fff",marginBottom:2,borderRadius:5,fontSize:11,border:"1px solid #e5e7eb",fontWeight:500}}>
              <strong>#{S.serials.length-i}</strong> — {s.serial} <span style={{color:"var(--g600)"}}>({s.model})</span>
              <br/><span style={{color:"var(--g400)",fontSize:10}}>{s.ts}</span>
            </div>
          ))
        }
      </div>

      <div className="section" style={{marginTop:12}}>
        <div className="sec-title">Reload Entry</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr auto",gap:8,alignItems:"end"}}>
          <div className="fg" style={{margin:0}}><label className="fl">Time Slot</label><select className="fs" value={rldSlot} onChange={e=>setRldSlot(e.target.value)}>{SLOTS.map(s=><option key={s}>{s}</option>)}</select></div>
          <div className="fg" style={{margin:0}}><label className="fl">Type</label><select className="fs" value={rldType} onChange={e=>setRldType(e.target.value)}>{["Material","Broken","Warpage","Scratch"].map(t=><option key={t}>{t}</option>)}</select></div>
          <div className="fg" style={{margin:0}}><label className="fl">Count</label><input type="number" className="fi" value={rldCnt} min="1" onChange={e=>setRldCnt(parseInt(e.target.value)||1)}/></div>
          <button className="btn btn-red" onClick={addReload}>+ Add</button>
        </div>
        <div style={{marginTop:8}}>
          {(S.reloads||[]).slice(-5).reverse().map((r,i)=>(
            <div key={i} style={{padding:"6px 9px",background:"#fff",marginBottom:3,borderRadius:6,fontSize:11,border:"1px solid #e5e7eb"}}>
              <strong>{r.slot}</strong> — {r.type} × {r.count}
              <br/><span style={{color:"#9ca3af"}}>{r.ts}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mpbox">
        <div className="sec-title" style={{color:"#92400e"}}>⚠️ Daily Manpower — Required Before Scanning</div>
        <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
          <div>
            <label className="fl">Number of Workers</label>
            <input type="number" className="fi" style={{width:120,fontSize:16,fontWeight:700}} placeholder="0" min="1" value={mpInput} onChange={e=>setMpInput(e.target.value)}/>
          </div>
          <button className="btn btn-red" onClick={setMP} style={{padding:"9px 18px"}}>Set Manpower</button>
          <div style={{padding:"6px 14px",background:"#fff",borderRadius:7,border:"1px solid var(--g200)"}}>
            <span style={{fontSize:11,color:"var(--g600)"}}>Current:</span>
            <span style={{fontSize:18,color:"var(--navy)",fontWeight:800,marginLeft:5}}>{manpower}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTS TAB
// ═══════════════════════════════════════════════════════════════════════════════
function ReportsTab({ rptDaily, rptSerials, rptIdle, rptMissing, rptContent }) {
  return (
    <div className="tab-pane">
      <div className="sec-title" style={{fontSize:14,marginBottom:12}}>Production Reports</div>
      <div className="btn-row" style={{marginBottom:14}}>
        <button className="btn btn-navy" onClick={rptDaily}>📊 Daily Report</button>
        <button className="btn btn-grn"  onClick={rptSerials}>🔢 Serial Report</button>
        <button className="btn btn-amb"  onClick={rptIdle}>⏱ Idle Analysis</button>
        <button className="btn btn-teal" onClick={rptMissing}>🔍 Missing Serials</button>
      </div>
      <div>{rptContent}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHARTS TAB
// ═══════════════════════════════════════════════════════════════════════════════
function ChartsTab({ S, manpower }) {
  const refs   = { prod:useRef(), upph:useRef(), uph:useRef(), ach:useRef(), idle:useRef(), rld:useRef() };
  const charts = useRef({});
  const lbls   = SLOTS.map(s => s.split("-")[0]);

  const build = useCallback(() => {
    if (!window.Chart) return;
    const C    = window.Chart;
    const base = { responsive:true, maintainAspectRatio:false, animation:{duration:350}, plugins:{legend:{labels:{font:{size:10},boxWidth:10}}} };
    const destroy = (k) => { try { if (charts.current[k]) { charts.current[k].destroy(); charts.current[k] = null; } } catch (e) {} };
    Object.keys(charts.current).forEach(destroy);

    if (refs.prod.current) charts.current.prod = new C(refs.prod.current.getContext("2d"), { type:"bar", data:{ labels:lbls, datasets:[{ label:"Production", data:(S.hourly||[]).map(h=>h.prod||0), backgroundColor:"rgba(196,30,78,.7)", borderColor:"#C41E4E", borderWidth:1, borderRadius:3 },{ label:"Target", data:(S.hourly||[]).map(h=>h.target||0), type:"line", borderColor:"#1a1a2e", borderWidth:2, pointRadius:2, fill:false, tension:.3 }]}, options:{...base,scales:{y:{beginAtZero:true}}}});
    if (refs.ach.current) { const tt=( S.hourly||[]).reduce((a,h)=>a+(h.target||0),0); const pct=tt>0?Math.min(Math.round(S.totalProd/tt*100),100):0; charts.current.ach=new C(refs.ach.current.getContext("2d"),{type:"doughnut",data:{labels:["Achieved ("+pct+"%)","Gap ("+(100-pct)+"%)"],datasets:[{data:[pct,Math.max(0,100-pct)],backgroundColor:["#10b981","#fee2e2"],borderWidth:2}]},options:{...base,cutout:"65%"}}); }
    if (refs.idle.current) { const dm={}; (S.idles||[]).forEach(r=>{if(r.dept&&r.duration)dm[r.dept]=(dm[r.dept]||0)+parseFloat(r.duration);}); const iL=Object.keys(dm),iV=iL.map(k=>dm[k]); charts.current.idle=new C(refs.idle.current.getContext("2d"),{type:"bar",data:{labels:iL.length?iL:["No Data"],datasets:[{label:"Idle (min)",data:iV.length?iV:[0],backgroundColor:["#ef4444","#f59e0b","#10b981","#667eea","#8b5cf6","#ec4899"].slice(0,Math.max(1,iL.length)),borderRadius:3}]},options:{...base,scales:{y:{beginAtZero:true}},plugins:{...base.plugins,legend:{display:false}}}}); }
    if (refs.rld.current) { const rm={}; (S.reloads||[]).forEach(r=>{rm[r.type]=(rm[r.type]||0)+(r.count||1);}); const rL=Object.keys(rm),rV=rL.map(k=>rm[k]); charts.current.rld=new C(refs.rld.current.getContext("2d"),{type:"pie",data:{labels:rL.length?rL:["No Data"],datasets:[{data:rV.length?rV:[1],backgroundColor:["#ef4444","#f59e0b","#10b981","#667eea","#8b5cf6"].slice(0,Math.max(1,rL.length)),borderWidth:2}]},options:{...base}}); }
    if (refs.upph.current) charts.current.upph = new C(refs.upph.current.getContext("2d"), { type:"line", data:{ labels:lbls, datasets:[{ label:"UPPH", data:(S.hourly||[]).map(h=>(manpower>0&&(h.prod||0)>0)?parseFloat(((h.prod||0)/manpower).toFixed(2)):0), borderColor:"#10b981", backgroundColor:"rgba(16,185,129,.1)", borderWidth:2, fill:true, tension:.4, pointRadius:3 }]}, options:{...base,scales:{y:{beginAtZero:true}}}});
    if (refs.uph.current)  charts.current.uph  = new C(refs.uph.current.getContext("2d"),  { type:"line", data:{ labels:lbls, datasets:[{ label:"UPH",  data:(S.hourly||[]).map(h=>h.prod||0), borderColor:"#C41E4E", backgroundColor:"rgba(196,30,78,.1)", borderWidth:2, fill:true, tension:.4, pointRadius:3 }]}, options:{...base,scales:{y:{beginAtZero:true}}}});
  }, [S, manpower, lbls]);

  useEffect(() => {
    setTimeout(build, 150);
    return () => { Object.keys(charts.current).forEach(k => { try { if (charts.current[k]) charts.current[k].destroy(); } catch (e) {} }); };
  }, [build]);

  return (
    <div className="tab-pane">
      <div className="chart-grid">
        <div className="ch-card"><h4>📊 Hourly Production vs Target</h4><div className="ch-wrap"><canvas ref={refs.prod}/></div></div>
        <div className="ch-card"><h4>📈 UPPH by Hour</h4><div className="ch-wrap"><canvas ref={refs.upph}/></div></div>
        <div className="ch-card"><h4>📈 UPH by Hour</h4><div className="ch-wrap"><canvas ref={refs.uph}/></div></div>
      </div>
      <div className="chart-grid">
        <div className="ch-card"><h4>🎯 Plan vs Achievement</h4><div className="ch-wrap"><canvas ref={refs.ach}/></div></div>
        <div className="ch-card"><h4>⏱ Idle by Department</h4><div className="ch-wrap"><canvas ref={refs.idle}/></div></div>
        <div className="ch-card"><h4>🔄 Reload Types</h4><div className="ch-wrap"><canvas ref={refs.rld}/></div></div>
      </div>
      <div style={{textAlign:"right"}}><button className="btn btn-navy" onClick={build}>🔄 Refresh Charts</button></div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS TAB
// ═══════════════════════════════════════════════════════════════════════════════
function SettingsTab({ S, sRange, rngDisp, rngModel, setRngModel, rngStart, setRngStart, rngEnd, setRngEnd, setRange, countRange, lotMode, setLotMode, newMdl, setNewMdl, newCust, setNewCust, addModel, delModel }) {
  const sc  = rngDisp ? countRange(S.serials, sRange) : 0;
  const exp = sRange.end - sRange.start + 1;
  return (
    <div className="tab-pane">
      <div className="section">
        <div className="sec-title">Serial Range Management</div>
        <div className="al al-warn">Set today's serial range before production starts.</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr auto",gap:8,alignItems:"end",marginTop:8}}>
          <div className="fg" style={{margin:0}}>
            <label className="fl">Model</label>
            <select className="fs" value={rngModel} onChange={e=>setRngModel(e.target.value)}>
              <option value="">-- Select Model --</option>
              {(S.models||[]).map(m=><option key={m.name} value={m.name}>{m.name} — {m.customer}</option>)}
            </select>
          </div>
          <div className="fg" style={{margin:0}}><label className="fl">Start Serial</label><input type="text" className="fi" placeholder="e.g., 00001" value={rngStart} onChange={e=>setRngStart(e.target.value)}/></div>
          <div className="fg" style={{margin:0}}><label className="fl">End Serial</label><input type="text" className="fi" placeholder="e.g., 02000" value={rngEnd} onChange={e=>setRngEnd(e.target.value)}/></div>
          <button className="btn btn-red" onClick={setRange}>Set Range</button>
        </div>
        {rngDisp && (
          <div className="rng-disp">
            <strong>Today's Active Range:</strong>
            <div style={{marginTop:6,fontSize:12,fontWeight:600}}>
              Model: <span style={{color:"var(--navy)"}}>{sRange.model}</span> &nbsp;|&nbsp;
              Start: <span style={{color:"var(--green)"}}>{pad5(sRange.start)}</span> &nbsp;|&nbsp;
              End: <span style={{color:"var(--red)"}}>{pad5(sRange.end)}</span>
            </div>
            <div style={{marginTop:4,fontSize:12}}>
              Expected: <strong>{exp}</strong> &nbsp;|&nbsp;
              Scanned: <strong style={{color:"var(--green)"}}>{sc}</strong> &nbsp;|&nbsp;
              Missing: <strong style={{color:"var(--red)"}}>{Math.max(0,exp-sc)}</strong>
            </div>
          </div>
        )}
        <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12,fontWeight:500,marginTop:8}}>
          <input type="checkbox" checked={lotMode} onChange={e=>setLotMode(e.target.checked)} style={{width:14,height:14}}/>
          Enable Lot Mode (allow previous day serials)
        </label>
      </div>
      <div className="section">
        <div className="sec-title">Model Management</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,alignItems:"end"}}>
          <div className="fg" style={{margin:0}}><label className="fl">Model Name</label><input type="text" className="fi" placeholder="e.g., FG0498" value={newMdl} onChange={e=>setNewMdl(e.target.value)}/></div>
          <div className="fg" style={{margin:0}}><label className="fl">Customer Name</label><input type="text" className="fi" placeholder="Customer name" value={newCust} onChange={e=>setNewCust(e.target.value)}/></div>
          <button className="btn btn-grn" onClick={addModel}>+ Add</button>
        </div>
        <div className="model-wrap">
          {(S.models||[]).map(m=>(
            <div key={m.name} className="model-tag">
              <span>{m.name} — {m.customer}</span>
              <button className="del-btn" onClick={()=>delModel(m.name)}>×</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN TAB
// ═══════════════════════════════════════════════════════════════════════════════
function AdminTab({ S, targets, setTargets, idleThrInput, setIdleThrInput, saveTargets, defaultTargets, saveSettings, uEmail, setUEmail, uName, setUName, addUser, usersList }) {
  return (
    <div className="tab-pane">
      <div className="section">
        <div className="sec-title">Hourly Production Targets</div>
        <div className="al al-warn">Set target to 0 for break hours.</div>
        <div className="tgt-grid" style={{marginTop:10}}>
          {SLOTS.map((slot,i)=>(
            <div key={i}>
              <label style={{fontSize:10,color:"#6b7280",fontWeight:600,display:"block",marginBottom:2}}>{slot}</label>
              <input type="number" className="fi" value={targets[i]||0} min="0"
                onChange={e=>{const t=[...targets];t[i]=parseInt(e.target.value)||0;setTargets(t);}}/>
            </div>
          ))}
        </div>
        <div className="btn-row" style={{marginTop:12}}>
          <button className="btn btn-red" onClick={saveTargets}>💾 Save Targets</button>
          <button className="btn btn-amb" onClick={defaultTargets}>↺ Defaults</button>
        </div>
      </div>
      <div className="section">
        <div className="sec-title">System Settings</div>
        <div className="fg" style={{maxWidth:220}}>
          <label className="fl">Idle Alert Threshold (minutes)</label>
          <input type="number" className="fi" value={idleThrInput} min="1" onChange={e=>setIdleThrInput(parseInt(e.target.value)||2)}/>
        </div>
        <button className="btn btn-navy" onClick={saveSettings}>Save Settings</button>
      </div>
      <div className="section">
        <div className="sec-title">User Management</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,alignItems:"end",marginBottom:12}}>
          <div className="fg" style={{margin:0}}><label className="fl">Email</label><input type="email" className="fi" placeholder="user@company.com" value={uEmail} onChange={e=>setUEmail(e.target.value)}/></div>
          <div className="fg" style={{margin:0}}><label className="fl">Full Name</label><input type="text" className="fi" placeholder="Full name" value={uName} onChange={e=>setUName(e.target.value)}/></div>
          <button className="btn btn-grn" onClick={addUser}>+ Add</button>
        </div>
        {usersList.length > 0 && (
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Email</th><th>Name</th><th>Role</th></tr></thead>
              <tbody>
                {usersList.map((r,i)=>(
                  <tr key={i}><td>{r[0]||""}</td><td>{r[1]||""}</td><td>{r[2]||"operator"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
