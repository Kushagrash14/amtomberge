// ═══════════════════════════════════════════════════════════════════════════════
// PACKING TAB — Incremental Saving Version
// ═══════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback, useMemo  } from "react";
import { qzService } from "../utils/qzService";


import {
  validateSerial,
  expectedCodesForDate,
  buildSerial,
  buildSerialPrefix,
  extractPackModel,
  extractSeqNum,
  localTodayStr,
  PLANT_CODES,
} from "../utils/serialFormat";

// ─── Constants ────────────────────────────────────────────────────────────────
const DEMO_MODE = false;

// Default units-per-box if not configured (can be overridden per model)
const DEFAULT_UPB = 12;

// Model → units per box lookup. Default fallback when unconfigured.
const MODEL_UPB_DEFAULTS = {
  FG0482: 8, FG0483: 8, FG0484: 8,
  FG0494: 8, FG0495: 8, FG0496: 8,
};

// Demo serial prefix generator
const DEMO_PREFIXES = {
  FG0482: "4L26FG0482P", FG0483: "4L26FG0483P", FG0484: "4L26FG0484P",
  FG0494: "4L26FG0494P", FG0495: "4L26FG0495P", FG0496: "4L26FG0496P",
};

// CSS for Packing Tab
const PACK_CSS = `
  .pk-wrap { padding: 12px 16px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
  .pk-grid { display: grid; grid-template-columns: 260px 1fr; gap: 12px; flex: 1; min-height: 0; }
  @media (max-width: 900px) { .pk-grid { grid-template-columns: 1fr; } }

  .pk-sidebar { display: flex; flex-direction: column; gap: 8px; }
  .pk-sidebar-title { font-size: 11px; font-weight: 700; color: var(--g600); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 2px; }
  .pk-model-card {
    background: #fff; border: 2px solid var(--g200); border-radius: 9px;
    padding: 10px 12px; cursor: pointer; transition: .15s;
  }
  .pk-model-card:hover { border-color: var(--navy); background: var(--g50); }
  .pk-model-card.selected { border-color: var(--accent); background: #fff0f4; }
  .pk-model-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px; }
  .pk-model-code { font-size: 13px; font-weight: 800; color: var(--navy); }
  .pk-model-badge {
    font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 10px;
    background: var(--g100); color: var(--g700); border: 1px solid var(--g200);
  }
  .pk-model-badge.badge-6 { background: #dbeafe; color: #1e40af; border-color: #93c5fd; }
  .pk-model-badge.badge-8 { background: #d1fae5; color: #065f46; border-color: #6ee7b7; }
  .pk-model-qty { font-size: 11px; color: var(--g600); font-weight: 500; margin-top: 2px; }

  .pk-panel { display: flex; flex-direction: column; gap: 10px; min-width: 0; }

  .pk-box-header {
    background: linear-gradient(135deg, var(--navy), #0f3460);
    color: #fff; border-radius: 9px; padding: 12px 16px;
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
  }
  .pk-box-label { font-size: 16px; font-weight: 800; }
  .pk-box-sub { font-size: 11px; opacity: .7; margin-top: 2px; }
  .pk-progress-wrap { flex: 1; max-width: 300px; }
  .pk-progress-track {
    height: 10px; background: rgba(255,255,255,.2); border-radius: 10px; overflow: hidden; margin-bottom: 4px;
  }
  .pk-progress-fill {
    height: 100%; border-radius: 10px; background: var(--green);
    transition: width .3s ease; position: relative;
  }
  .pk-progress-fill.full { background: #fbbf24; animation: pk-pulse 1s infinite; }
  @keyframes pk-pulse { 0%,100%{opacity:1}50%{opacity:.6} }
  .pk-progress-label { font-size: 12px; font-weight: 700; text-align: right; opacity: .9; }

  .pk-scan-zone {
    background: #fff; border: 2px solid var(--g200); border-radius: 9px;
    padding: 12px 14px; transition: .2s;
  }
  .pk-scan-zone.locked { opacity: .5; pointer-events: none; filter: grayscale(.4); }
  .pk-scan-zone-title { font-size: 12px; font-weight: 700; color: var(--g700); margin-bottom: 8px; }
  .pk-scan-input-row { display: flex; gap: 8px; }
  .pk-serial-input {
    flex: 1; padding: 10px 12px; border: 2px solid var(--g200); border-radius: 7px;
    font-size: 13px; font-weight: 600; font-family: 'JetBrains Mono', 'Courier New', monospace;
    transition: .2s; outline: none; background: var(--g50);
  }
  .pk-serial-input:focus { border-color: var(--accent); background: #fff; box-shadow: 0 0 0 3px rgba(196,30,78,.1); }
  .pk-serial-input.input-ok { border-color: var(--green); background: #d1fae5; }
  .pk-serial-input.input-err { border-color: var(--red); background: #fee2e2; }
  .pk-inline-error {
    margin-top: 7px; padding: 7px 10px; background: #fee2e2; border: 1px solid #fca5a5;
    border-radius: 6px; font-size: 11px; font-weight: 600; color: #991b1b; display: none;
  }

  .pk-slots-section { background: #fff; border: 1px solid var(--g200); border-radius: 9px; padding: 12px 14px; }
  .pk-slots-title { font-size: 12px; font-weight: 700; color: var(--g700); margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
  .pk-slots-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .pk-slot {
    border-radius: 7px; padding: 8px 10px; min-height: 56px;
    display: flex; flex-direction: column; justify-content: center; position: relative;
  }
  .pk-slot.filled {
    background: #d1fae5; border: 1px solid #6ee7b7;
  }
  .pk-slot.empty {
    background: var(--g50); border: 2px dashed var(--g200);
  }
  .pk-slot-num { font-size: 9px; font-weight: 700; color: var(--g400); margin-bottom: 2px; }
  .pk-slot-serial {
    font-size: 11px; font-weight: 700; color: var(--navy);
    font-family: 'JetBrains Mono', monospace; word-break: break-all; line-height: 1.3;
  }
  .pk-slot-serial.hint { color: var(--g400); font-weight: 400; font-family: Inter, sans-serif; font-size: 10px; }
  .pk-slot-time { font-size: 9px; color: var(--g400); margin-top: 2px; }
  .pk-slot-remove {
    position: absolute; top: 5px; right: 6px; background: #ef4444; color: #fff;
    border: none; width: 15px; height: 15px; border-radius: 50%; cursor: pointer;
    font-size: 9px; font-weight: 700; display: flex; align-items: center; justify-content: center;
    opacity: 0; transition: .15s;
  }
  .pk-slot:hover .pk-slot-remove { opacity: 1; }

  .pk-print-modal-overlay {
    display: none; position: fixed; inset: 0; background: rgba(0,0,0,.65);
    z-index: 1100; align-items: center; justify-content: center;
  }
  .pk-print-modal-overlay.visible { display: flex; }
  .pk-print-modal {
    background: #fff; border-radius: 14px; padding: 24px 26px;
    max-width: 460px; width: 92%; box-shadow: 0 24px 56px rgba(0,0,0,.3);
    max-height: 90vh; overflow-y: auto;
  }
  .pk-print-title { font-size: 16px; font-weight: 800; color: var(--g900); margin-bottom: 4px; }
  .pk-print-sub { font-size: 11px; color: var(--g600); margin-bottom: 14px; }
  .pk-label-preview {
    background: linear-gradient(135deg, var(--navy), #0f3460);
    color: #fff; border-radius: 10px; padding: 16px; margin-bottom: 16px;
  }
  .pk-label-brand { font-size: 18px; font-weight: 900; letter-spacing: .06em; margin-bottom: 2px; }
  .pk-label-model { font-size: 11px; opacity: .7; margin-bottom: 12px; }
  .pk-label-serials { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 12px; }
  .pk-label-serial-item {
    background: rgba(255,255,255,.1); padding: 3px 7px; border-radius: 4px;
    font-size: 9px; font-family: 'JetBrains Mono', monospace; font-weight: 600;
  }
  .pk-label-footer { display: flex; justify-content: space-between; font-size: 10px; opacity: .6; }
  .pk-print-actions { display: flex; gap: 8px; justify-content: flex-end; }

  .pk-detail-modal-overlay {
    display: none; position: fixed; inset: 0; background: rgba(0,0,0,.65);
    z-index: 1100; align-items: center; justify-content: center;
  }
  .pk-detail-modal-overlay.visible { display: flex; }
  .pk-detail-modal {
    background: #fff; border-radius: 14px; padding: 24px 26px;
    max-width: 550px; width: 92%; box-shadow: 0 24px 56px rgba(0,0,0,.3);
    max-height: 90vh; overflow-y: auto;
  }
  .pk-detail-title { font-size: 18px; font-weight: 800; color: var(--g900); margin-bottom: 4px; }
  .pk-detail-sub { font-size: 12px; color: var(--g600); margin-bottom: 20px; border-bottom: 1px solid var(--g200); padding-bottom: 12px; }
  .pk-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
  .pk-detail-item { display: flex; flex-direction: column; gap: 2px; }
  .pk-detail-label { font-size: 11px; font-weight: 700; color: var(--g500); text-transform: uppercase; }
  .pk-detail-value { font-size: 13px; font-weight: 600; color: var(--navy); }

  .pk-item-list { width: 100%; border-collapse: collapse; margin-top: 10px; }
  .pk-item-list th { text-align: left; font-size: 11px; color: var(--g600); padding: 8px; border-bottom: 2px solid var(--g200); }
  .pk-item-list td { padding: 8px; font-size: 12px; border-bottom: 1px solid var(--g100); }
  .pk-item-serial { font-family: 'JetBrains Mono', monospace; font-weight: 700; color: var(--navy); }
  .pk-item-time { color: var(--g500); font-size: 11px; }

  .pk-detail-actions { display: flex; justify-content: flex-end; margin-top: 24px; }

  .pk-history-bar { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
  .pk-history-search {
    width: 200px; padding: 7px 10px; border: 2px solid var(--g200); border-radius: 7px;
    font-size: 12px; outline: none; transition: .2s; font-family: Inter, sans-serif;
  }
  .pk-history-search:focus { border-color: var(--accent); }

  .pk-filter-group { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; color: var(--g600); }
  .pk-filter-select {
    padding: 6px 10px; border: 2px solid var(--g200); border-radius: 7px;
    font-size: 12px; outline: none; background: #fff; color: var(--navy); cursor: pointer;
  }
  .pk-filter-select:focus { border-color: var(--accent); }
  .pk-date-input {
    padding: 6px 8px; border: 2px solid var(--g200); border-radius: 7px;
    font-size: 12px; outline: none;
  }

  .pk-config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  @media (max-width: 700px) { .pk-config-grid { grid-template-columns: 1fr; } }

  .pk-vlog { background: var(--g50); border: 1px solid var(--g200); border-radius: 9px; padding: 10px 12px; max-height: 140px; overflow-y: auto; }
  .pk-vlog-entry { font-size: 11px; padding: 3px 0; border-bottom: 1px solid var(--g200); display: flex; gap: 7px; align-items: flex-start; }
  .pk-vlog-entry:last-child { border-bottom: none; }
  .pk-vlog-time { color: var(--g400); font-family: monospace; white-space: nowrap; flex-shrink: 0; }
  .pk-vlog-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; margin-top: 4px; }
  .pk-vlog-dot.ok { background: var(--green); }
  .pk-vlog-dot.err { background: var(--red); }
  .pk-vlog-dot.warn { background: var(--amber); }
  .pk-vlog-dot.info { background: #3b82f6; }
  .pk-vlog-msg { color: var(--g700); font-weight: 500; }
  .btn-row { display: flex; gap: 7px; margin-top: 10px; flex-wrap: wrap; align-items: center; }
  .pk-stats { display: flex; gap: 8px; flex-wrap: wrap; }
  .pk-stat { background: #fff; border: 1px solid var(--g200); border-radius: 8px; padding: 8px 14px; text-align: center; min-width: 80px; }
  .pk-stat-v { font-size: 22px; font-weight: 800; color: var(--navy); line-height: 1; }
  .pk-stat-l { font-size: 10px; color: var(--g600); font-weight: 600; margin-top: 3px; }

  .pk-tabs { display: flex; gap: 2px; background: var(--g100); border: 1px solid var(--g200); border-radius: 7px; padding: 3px; margin-bottom: 2px; width: fit-content; }
  .pk-tab-btn { padding: 5px 14px; border-radius: 5px; font-size: 11px; font-weight: 600; cursor: pointer; background: none; border: none; color: var(--g600); font-family: Inter, sans-serif; transition: .15s; }
  .pk-tab-btn.active { background: #fff; color: var(--navy); box-shadow: 0 1px 3px rgba(0,0,0,.08); }

  .pk-ready-banner {
    background: linear-gradient(135deg, #d1fae5, #a7f3d0); border: 2px solid #6ee7b7;
    border-radius: 9px; padding: 12px 16px; display: flex; align-items: center; gap: 12px;
    animation: pk-slide-in .25s ease;
  }
  @keyframes pk-slide-in { from { opacity:0; transform:translateY(-8px);} to {opacity:1;transform:translateY(0);} }
  .pk-ready-icon { font-size: 28px; flex-shrink: 0; }
  .pk-ready-text { flex: 1; }
  .pk-ready-title { font-size: 14px; font-weight: 800; color: #065f46; }
  .pk-history-table {
    border-collapse: separate;
    border-spacing: 0;
  }
  .pk-history-table thead th {
    position: sticky;
    top: 0;
    z-index: 10;
    background: var(--g100);
    color: var(--navy);
    font-weight: 700;
    box-shadow: 0 2px 2px -1px rgba(0,0,0,0.1);
  }

  /* ─── Open-box loading state ───────────────────────── */
  .pk-syncing-banner {
    background: linear-gradient(135deg, #eff6ff, #dbeafe);
    border: 2px solid #93c5fd;
    border-radius: 9px;
    padding: 11px 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    font-weight: 600;
    color: #1e40af;
    animation: pk-slide-in .2s ease;
  }
  .pk-spin {
    width: 18px; height: 18px;
    border: 3px solid #93c5fd;
    border-top-color: #1d4ed8;
    border-radius: 50%;
    animation: pk-rotate .7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes pk-rotate { to { transform: rotate(360deg); } }

  .pk-model-card.loading {
    opacity: .6;
    pointer-events: none;
    position: relative;
    overflow: hidden;
  }
  .pk-model-card.loading::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.5), transparent);
    animation: pk-shimmer 1s infinite;
  }
  @keyframes pk-shimmer {
    from { transform: translateX(-100%); }
    to   { transform: translateX(100%); }
  }

  /* ─── Unprinted box warning banner ─────────────────── */
  .pk-unprinted-banner {
    background: linear-gradient(135deg, #fffbeb, #fef3c7);
    border: 2px solid #f59e0b;
    border-radius: 9px;
    padding: 12px 16px;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    animation: pk-slide-in .25s ease;
  }
  .pk-unprinted-icon { font-size: 22px; flex-shrink: 0; line-height: 1; }
  .pk-unprinted-body { flex: 1; }
  .pk-unprinted-title { font-size: 13px; font-weight: 800; color: #92400e; margin-bottom: 2px; }
  .pk-unprinted-sub { font-size: 11px; color: #b45309; font-weight: 500; margin-bottom: 8px; }
  .pk-unprinted-actions { display: flex; gap: 8px; flex-wrap: wrap; }
`;
// ─── Helper: current time string ──────────────────────────────────────────────
function nowStr() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, "0")).join(":");
}

function formatDateInd(dateStr) {
  if (!dateStr) return "N/A";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const dayName = days[d.getDay()];

  return `${dd}/${mm}/${yyyy} : ${hh}:${min}:${ss} : ${dayName}`;
}

// // ─── Helper: extract model code from serial (positions 4-10) ─────────────────
// function extractPackModel(serial) {
//   const s = String(serial).trim().toUpperCase();
//   return s.length >= 10 ? s.substring(4, 10) : "";
// }

// ─── Helper: extract last 5 digits as sequence number ────────────────────────
// function extractSeqNum(serial) {
//   const s = String(serial).trim();
//   return s.length >= 5 ? parseInt(s.slice(-5)) : 0;
// }

// ─── Helper: everything before last 5 digits ─────────────────────────────────
function extractPrefix(serial) {
  const s = String(serial).trim();
  return s.length > 5 ? s.slice(0, -5) : s;
}

// ─── Helper: beep ─────────────────────────────────────────────────────────────
// Module-level singleton — created once, reused for every beep for the life of the tab
let sharedAudioCtx = null;
function getAudioCtx() {
  if (!sharedAudioCtx) {
    try {
      sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      return null;
    }
  }
  // Browsers suspend contexts that were created/left idle without user interaction;
  // resume() is a no-op if already running.
  if (sharedAudioCtx.state === "suspended") sharedAudioCtx.resume().catch(() => {});
  return sharedAudioCtx;
}

function packBeep(ok) {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = ok ? 880 : 200;
    osc.type = ok ? "sine" : "square";
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (ok ? 0.15 : 0.3));
    osc.start(); osc.stop(ctx.currentTime + (ok ? 0.15 : 0.3));
  } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// PACKING TAB COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
// ─── localStorage keys for persisted state ───────────────────────────────────
const STORAGE_KEY_MODEL = "packing_selected_model";
const STORAGE_KEY_CONFIG = "packing_config_cache";

export default function PackingTab({ models = [], apiFetch, todayStr, sRange, appSettings = {} }) {
  // ─── Sub-tab state ──────────────────────────────────────────────────────────
  const [activeSubTab, setActiveSubTab] = useState("scan"); // "scan" | "history" | "config"

  // ─── Model & packing state ──────────────────────────────────────────────────
  // Restore last selected model from localStorage on first mount
  const [selectedModel, setSelectedModel] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_MODEL);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [currentSerials, setCurrentSerials] = useState([]);   // [{id, serial, ...}, ...] in current box
  const [boxNumber, setBoxNumber] = useState(1);
  const [history, setHistory] = useState([]);                 // completed boxes
  // Restore cached pack configs immediately so box size never defaults back to 4 on tab switch
  const [packConfig, setPackConfig] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CONFIG);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Track the authoritative last scanned serial for the selected model
  const [lastScanned, setLastScanned] = useState(null); // { serial, box_number, scanned_at }

  // ─── Stats ──────────────────────────────────────────────────────────────────
  const [stats, setStats] = useState({ boxes: 0, units: 0, errors: 0 });

  // ─── UI state ───────────────────────────────────────────────────────────────
  const [serialInput, setSerialInput] = useState("");
  const [inputState, setInputState] = useState(""); // "" | "ok" | "err"
  const [inlineError, setInlineError] = useState("");
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [selectedHistoryBox, setSelectedHistoryBox] = useState(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyModelFilter, setHistoryModelFilter] = useState("all");
  const [historyDateFilter, setHistoryDateFilter] = useState("today");
  const [customDateRange, setCustomDateRange] = useState({ start: "", end: "" });
  const [vlog, setVlog] = useState([{ type: "info", msg: "Packing module ready.", time: nowStr() }]);
  const [lastCompletedBox, setLastCompletedBox] = useState(null);
  const [lastZpl, setLastZpl] = useState(null);
  const [lastBoxId, setLastBoxId] = useState(null);
  const [loadingOpenBox, setLoadingOpenBox] = useState(false);
  const [unprintedBox, setUnprintedBox] = useState(null);
  const [printError, setPrintError] = useState(null);

  // Production date validation
  const productionDate = todayStr ? todayStr() : localTodayStr();
  const plantCode      = (appSettings.plantCode || "").toUpperCase(); // "S" | "P" | "" = accept both

  // ─── Config state (per-model upb) ───────────────────────────────────────────
  const [configModel, setConfigModel] = useState("");
  const [configUpb, setConfigUpb] = useState(12);
  const [configDesc, setConfigDesc] = useState("");
  const [configSaving, setConfigSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  // ─── Demo seq counters & input refs ─────────────────────────────────────────
  const demoCounters = useRef({});
  const inputRef = useRef(null);

  // ─── Async Queue Refs for Rapid, Non-Blocking Scans ─────────────────────────
  const scanQueueRef = useRef([]);
  const isProcessingQueueRef = useRef(false);
  const lastScannedTimeRef = useRef(0);
  const lastScannedSerialRef = useRef("");

  // ─── Log helper ─────────────────────────────────────────────────────────────
  const addLog = useCallback((type, msg) => {
    setVlog(prev => [{ type, msg, time: nowStr() }, ...prev].slice(0, 60));
  }, []);

  // ─── Units per box lookup for model ─────────────────────────────────────────
  const getUpb = useCallback((modelName) => {
    if (!modelName) return DEFAULT_UPB;
    if (packConfig[modelName]) {
      const cfg = packConfig[modelName];
      return typeof cfg === 'object' ? cfg.units_per_box : cfg;
    }
    if (MODEL_UPB_DEFAULTS[modelName]) return MODEL_UPB_DEFAULTS[modelName];
    return DEFAULT_UPB;
  }, [packConfig]);

  // ─── Load history from API ──────────────────────────────────────────────────
  const loadHistory = useCallback(async (startDate, endDate) => {
    if (DEMO_MODE) return;

    let url = `/pack/boxes`;
    if (startDate && endDate) {
      url += `?startDate=${startDate}&endDate=${endDate}`;
    } else {
      const today = todayStr ? todayStr() : new Date().toISOString().slice(0, 10);
      url += `?date=${today}`;
    }

    try {
      const res = await apiFetch("GET", url);
      if (res?.success && res.boxes?.length) {
      const sorted = [...res.boxes].sort((a, b) =>
        new Date(b.packed_at) - new Date(a.packed_at)
      );
      setHistory(sorted.map(b => ({
        id: b.id,
        boxNum: b.box_number,
        boxCode: b.box_code,
        model: b.model,
        upb: b.units_per_box,
        serials: Array.isArray(b.serials) ? b.serials.map(s => typeof s === 'object' ? s : { serial: s }) : [],
        timestamp: b.packed_at,
        status: b.status === 'printed' ? 'Printed' : b.status === 'closed' ? 'Closed (Unprinted)' : 'Open',
      })));
        setStats(prev => ({
          ...prev,
          boxes: res.boxes.length,
          units: res.boxes.reduce((a, b) => a + (b.serials?.length || 0), 0)
        }));
      } else {
        setHistory([]);
      }
    } catch (e) {
      console.error(`[BOX HISTORY FRONTEND] Error:`, e);
      addLog("warn", "Could not load box history from server.");
    }
  }, [apiFetch, todayStr, addLog]);

  useEffect(() => {
    if (activeSubTab !== "history") return;

    const now = new Date();
    const startOfDay = (d) => { const date = new Date(d); date.setHours(0, 0, 0, 0); return date; };
    const endOfDay = (d) => { const date = new Date(d); date.setHours(23, 59, 59, 999); return date; };

    let startDate, endDate;
    if (historyDateFilter === "today") {
      startDate = startOfDay(now);
      endDate = endOfDay(now);
    } else if (historyDateFilter === "yesterday") {
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      startDate = startOfDay(yesterday);
      endDate = endOfDay(yesterday);
    } else if (historyDateFilter === "7days") {
      startDate = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7));
      endDate = endOfDay(now);
    } else if (historyDateFilter === "30days") {
      startDate = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30));
      endDate = endOfDay(now);
    } else if (historyDateFilter === "custom") {
      if (!customDateRange.start || !customDateRange.end) return;
      startDate = startOfDay(new Date(customDateRange.start));
      endDate = endOfDay(new Date(customDateRange.end));
    }

    if (startDate && endDate) {
      const toIso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      loadHistory(toIso(startDate), toIso(endDate));
    }
  }, [historyDateFilter, customDateRange, activeSubTab, loadHistory]);

  // ─── Load history & config from API on mount ───────────────────────────────
  useEffect(() => {
    if (DEMO_MODE) return;
    loadHistory();

    apiFetch("GET", "/pack/config")
      .then(res => {
        if (res?.success && res.configs?.length) {
          const map = {};
          res.configs.forEach(c => { map[c.model] = { units_per_box: c.units_per_box, description: c.description }; });
          setPackConfig(map);
          try { localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(map)); } catch {}

          // Ensure selectedModel instantly reflects server pack_config box size
          setSelectedModel(prev => {
            if (!prev) return prev;
            const cfgUpb = map[prev.name]?.units_per_box;
            if (cfgUpb && cfgUpb !== prev.upb) {
              const updated = { ...prev, upb: cfgUpb };
              try { localStorage.setItem(STORAGE_KEY_MODEL, JSON.stringify(updated)); } catch {}
              return updated;
            }
            return prev;
          });
        }
      })
      .catch(() => {});
  }, [loadHistory, apiFetch]);

  // ─── Fetch current open box state & last scanned value from server ───────────
  const syncOpenBox = useCallback(async (m) => {
    if (!m || DEMO_MODE) return;
    const today = productionDate || (todayStr ? todayStr() : localTodayStr());

    setLoadingOpenBox(true);
    setUnprintedBox(null);

    try {
      const res = await apiFetch("GET", `/pack/open-box?model=${encodeURIComponent(m.name)}&date=${today}`);

      if (res?.success) {
        // Enforce server-configured box size so it never defaults to 4
        const targetUpb = res.config_upb || (res.openBox && res.openBox.units_per_box) || m.upb;
        if (targetUpb && targetUpb !== m.upb) {
          const refreshed = { ...m, upb: targetUpb };
          setSelectedModel(refreshed);
          try { localStorage.setItem(STORAGE_KEY_MODEL, JSON.stringify(refreshed)); } catch {}
        }

        // Always sync last scanned item for this model
        if (res.lastScanned) {
          setLastScanned(res.lastScanned);
        }

        if (res.openBox) {
          // ── Case A: Partial open box — resume scanning ──
          setBoxNumber(res.openBox.box_number);
          setCurrentSerials(res.openBox.serials || []);
          setLastBoxId(res.openBox.id);

          if (res.openBox.serials && res.openBox.serials.length > 0) {
            const lastItem = res.openBox.serials[res.openBox.serials.length - 1];
            setLastScanned({
              serial: typeof lastItem === 'object' ? lastItem.serial : lastItem,
              box_number: res.openBox.box_number,
              scanned_at: typeof lastItem === 'object' ? lastItem.scanned_at : null,
            });
          }

          if (res.closedUnprintedBox) {
            setUnprintedBox(res.closedUnprintedBox);
            setLastZpl(res.closedUnprintedBox.zpl);
          } else {
            setUnprintedBox(null);
          }
          const count = (res.openBox.serials || []).length;
          addLog("info", `Resumed: Box #${res.openBox.box_number} — ${count}/${targetUpb} scanned`);

        } else if (res.closedUnprintedBox) {
          // ── Case B: Last box closed but label never printed ──
          setCurrentSerials([]);
          setBoxNumber(res.nextBoxNumber ?? 1);
          setUnprintedBox(res.closedUnprintedBox);
          setLastZpl(res.closedUnprintedBox.zpl);
          setLastBoxId(res.closedUnprintedBox.id);

          if (res.closedUnprintedBox.serials && res.closedUnprintedBox.serials.length > 0) {
            const lastItem = res.closedUnprintedBox.serials[res.closedUnprintedBox.serials.length - 1];
            setLastScanned({
              serial: typeof lastItem === 'object' ? lastItem.serial : lastItem,
              box_number: res.closedUnprintedBox.box_number,
              scanned_at: typeof lastItem === 'object' ? lastItem.scanned_at : null,
            });
          }

          addLog("warn", `⚠️ Box #${res.closedUnprintedBox.box_number} closed but NOT printed — reprint required`);

        } else {
          // ── Case C: All clear — start fresh from next box number ──
          setCurrentSerials([]);
          setBoxNumber(res.nextBoxNumber ?? 1);
          setUnprintedBox(null);
          addLog("info", `Ready: starting Box #${res.nextBoxNumber ?? 1}`);
        }
      }
    } catch (e) {
      addLog("warn", "Could not sync open box state from server.");
    } finally {
      setLoadingOpenBox(false);
    }
  }, [apiFetch, todayStr, productionDate, addLog]);

  // ─── Select model ───────────────────────────────────────────────────────────
  const handleSelectModel = useCallback(async (m) => {
    if (currentSerials.length > 0) {
      if (!confirm(`Switching model will clear current box (${currentSerials.length} serial(s)). Continue?`)) return;
    }
    const upb = getUpb(m.name);
    const modelToSave = { ...m, upb };
    setSelectedModel(modelToSave);
    try { localStorage.setItem(STORAGE_KEY_MODEL, JSON.stringify(modelToSave)); } catch {}
    setCurrentSerials([]);
    setInlineError("");
    setInputState("");
    addLog("info", `Model selected: ${m.name} — ${upb} units per box`);

    await syncOpenBox(modelToSave);

    setTimeout(() => inputRef.current?.focus(), 50);
  }, [currentSerials, getUpb, addLog, syncOpenBox]);

  // ─── On mount / tab restore: sync open box for model from localStorage ───────
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    if (!selectedModel) return;

    const upb = getUpb(selectedModel.name);
    const refreshed = { ...selectedModel, upb };
    setSelectedModel(refreshed);
    try { localStorage.setItem(STORAGE_KEY_MODEL, JSON.stringify(refreshed)); } catch {}

    syncOpenBox(refreshed);
    addLog("info", `Restored session for model: ${selectedModel.name}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Asynchronous Queue Processor: Saves Scans Sequentially in Background ───
  const processQueue = useCallback(async () => {
    if (isProcessingQueueRef.current) return;
    isProcessingQueueRef.current = true;

    while (scanQueueRef.current.length > 0) {
      const item = scanQueueRef.current[0];
      try {
        const t0 = performance.now();
        const res = await apiFetch("POST", "/pack/scan", {
          date: item.date,
          model: item.model,
          serial: item.serial,
          plant: item.plant,
          units_per_box: item.units_per_box,
        });

        const netMs = +(performance.now() - t0).toFixed(1);

        if (!res || res.success === false) {
          addLog("err", `Server rejected "${item.serial}": ${res?.message || "unknown"}`);
          setInlineError(`✗ Server rejected: ${res?.message || "Scan save failed"}`);
          setInputState("err");
          packBeep(false);
          // Rollback the optimistic item from the current box
          setCurrentSerials(prev => prev.filter(s => s.id !== item.tempId && s.serial !== item.serial));
          setStats(p => ({ ...p, units: Math.max(0, p.units - 1), errors: p.errors + 1 }));
          scanQueueRef.current.shift();
          continue;
        }

        addLog("info", `⏱ Saved "${item.serial}" in ${netMs}ms (server reported: ${res?._timings?.total ?? netMs}ms)`);

        // Reconcile server ID into currentSerials
        setCurrentSerials(prev => prev.map(s => {
          if (s.id === item.tempId || s.serial === item.serial) {
            return { ...s, id: res.lastScanned?.id || s.id, pending: false };
          }
          return s;
        }));

        if (res.lastScanned) {
          setLastScanned(res.lastScanned);
        }

        // Auto-print master label when box is full
        if (res.print?.shouldPrint && res.print?.zpl) {
          addLog("ok", `Box #${res.box_number} completed. Sending master label to printer...`);
          try {
            const printerName = appSettings.printerName || "ZDesigner ZT231-300dpi ZPL";
            await qzService.printZPL(res.print.zpl, printerName);
            addLog("ok", `✅ Master label sent to ${printerName} for Box #${res.print.boxNumber}`);
            if (res.print.box_id) {
              apiFetch("POST", `/pack/boxes/${res.print.box_id}/printed`, {}).catch(() => {});
            }
          } catch (printError) {
            console.error("Auto Print Error:", printError);
            addLog("err", `❌ Box completed, but printing failed: ${printError.message}`);
            setUnprintedBox({
              id:            res.print.box_id,
              box_number:    res.print.boxNumber,
              box_code:      res.print.boxCode,
              units_per_box: res.units_per_box,
              serials:       res.serials || [],
              zpl:           res.print.zpl,
            });
          }

          setLastCompletedBox(res.serials);
          setLastZpl(res.print.zpl);
          setLastBoxId(res.print.box_id ?? res.box_id ?? null);
          setCurrentSerials([]);
          setBoxNumber(res.box_number + 1);
          setShowPrintModal(true);
          loadHistory();
        }

      } catch (err) {
        addLog("err", `Network error saving scan: ${err.message}`);
      } finally {
        scanQueueRef.current.shift();
      }
    }

    isProcessingQueueRef.current = false;
  }, [apiFetch, addLog, appSettings, loadHistory]);

  // ─── Instant Scan Handler: Instant UI feedback, 0ms input clearing ──────────
  const addSerial = useCallback((customSerial) => {
    const raw = typeof customSerial === "string" ? customSerial : serialInput;
    const serial = (raw || "").trim().toUpperCase().replace(/[\r\n\t]/g, "");

    if (!serial) return;
    if (!selectedModel) {
      setInlineError("✗ Select a model first.");
      setInputState("err");
      return;
    }

    // Debounce rapid duplicate trigger within 400ms (e.g. 16-char auto trigger + enter key)
    if (serial === lastScannedSerialRef.current && Date.now() - lastScannedTimeRef.current < 400) {
      return;
    }

    const m = selectedModel;
    if (currentSerials.length >= m.upb) {
      setInlineError(`✗ Box #${boxNumber} is already full (${m.upb} units). Print label or wait for next box.`);
      setInputState("err");
      packBeep(false);
      return;
    }

    setInlineError("");

    // 1. Barcode format & date check
    const check = validateSerial(serial, {
      productionDate,
      model: m.name,
      plant: plantCode || undefined,
    });

    if (!check.ok) {
      setInputState("err");
      setInlineError(`✗ ${check.error}`);
      addLog("err", `Rejected "${serial}" — ${check.error}`);
      setStats(p => ({ ...p, errors: p.errors + 1 }));
      packBeep(false);
      setSerialInput("");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    // 2. Range enforcement
    const currentNum = extractSeqNum(serial);
    if (sRange?.model && sRange.model === m.name) {
      if (currentNum === 0 || currentNum < sRange.start || currentNum > sRange.end) {
        setInputState("err");
        setInlineError(`✗ Out of Range! Expected: ${sRange.start} - ${sRange.end}`);
        addLog("err", `Rejected "${serial}" — out of range (${sRange.start}-${sRange.end})`);
        setStats(p => ({ ...p, errors: p.errors + 1 }));
        packBeep(false);
        setSerialInput("");
        if (inputRef.current) inputRef.current.value = "";
        return;
      }
    }

    // 3. Duplicate check (Current box + in-flight queue + day's history)
    const isDupInCurrent = currentSerials.some(s => (typeof s === 'object' ? s.serial : s) === serial);
    const isDupInQueue = scanQueueRef.current.some(q => q.serial === serial);
    const isDupInHistory = history.some(b =>
      b.model === m.name && b.serials.some(s => (typeof s === 'object' ? s.serial : s) === serial)
    );

    if (isDupInCurrent || isDupInQueue || isDupInHistory) {
      setInputState("err");
      setInlineError("✗ Duplicate Serial! Already packed today.");
      addLog("err", `Rejected "${serial}" — duplicate found`);
      setStats(p => ({ ...p, errors: p.errors + 1 }));
      packBeep(false);
      setSerialInput("");
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    // 4. Sequence validation
    if (currentSerials.length > 0) {
      const lastItem = currentSerials[currentSerials.length - 1];
      const lastNum = extractSeqNum(typeof lastItem === 'object' ? lastItem.serial : lastItem);

      if (lastNum <= 0) {
        setInputState("err");
        setInlineError("✗ Could not verify sequence — previous slot unreadable.");
        addLog("err", `Rejected "${serial}" — previous slot unreadable`);
        setStats(p => ({ ...p, errors: p.errors + 1 }));
        packBeep(false);
        setSerialInput("");
        if (inputRef.current) inputRef.current.value = "";
        return;
      }
      if (currentNum !== lastNum + 1) {
        setInputState("err");
        setInlineError(`✗ Sequence Gap! Expected ${lastNum + 1}, got ${currentNum}`);
        addLog("err", `Rejected "${serial}" — gap in box sequence (Expected ${lastNum + 1})`);
        setStats(p => ({ ...p, errors: p.errors + 1 }));
        packBeep(false);
        setSerialInput("");
        if (inputRef.current) inputRef.current.value = "";
        return;
      }
    } else {
      let prevLastNum = null;
      let prevBoxNum = null;

      if (lastScanned?.serial) {
        prevLastNum = extractSeqNum(lastScanned.serial);
        prevBoxNum = lastScanned.box_number || (boxNumber > 1 ? boxNumber - 1 : 1);
      } else if (lastCompletedBox && lastCompletedBox.length > 0) {
        const lastItem = lastCompletedBox[lastCompletedBox.length - 1];
        prevLastNum = extractSeqNum(typeof lastItem === 'object' ? lastItem.serial : lastItem);
        prevBoxNum = boxNumber > 1 ? boxNumber - 1 : 1;
      }

      if (prevLastNum !== null && prevLastNum > 0) {
        const expectedNext = prevLastNum + 1;
        if (currentNum !== expectedNext) {
          setInputState("err");
          setInlineError(`✗ Cross-box Gap! Expected ${expectedNext} (Box #${prevBoxNum} ended at ${prevLastNum}), got ${currentNum}`);
          addLog("err", `Rejected "${serial}" — cross-box gap (Expected ${expectedNext} after Box #${prevBoxNum})`);
          setStats(p => ({ ...p, errors: p.errors + 1 }));
          packBeep(false);
          setSerialInput("");
          if (inputRef.current) inputRef.current.value = "";
          return;
        }
      }
    }

    // ── All client validations PASSED! ────────────────────────
    lastScannedSerialRef.current = serial;
    lastScannedTimeRef.current = Date.now();

    // 1. CLEAR INPUT & REFOCUS IMMEDIATELY (0ms delay!)
    setSerialInput("");
    if (inputRef.current) inputRef.current.value = "";
    setInputState("ok");
    setInlineError("");
    setTimeout(() => setInputState(""), 500);
    inputRef.current?.focus();

    // 2. PLAY SUCCESS SOUND IMMEDIATELY (0ms delay!)
    packBeep(true);

    // 3. OPTIMISTIC UI UPDATE (<2ms delay!)
    const tempId = "temp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    const optimisticItem = { id: tempId, serial, scanned_at: new Date().toISOString(), pending: true };
    setCurrentSerials(prev => [...prev, optimisticItem]);
    setStats(p => ({ ...p, units: p.units + 1 }));
    setLastScanned({ serial, box_number: boxNumber, scanned_at: optimisticItem.scanned_at });
    addLog("ok", `Accepted: ${serial} (${currentSerials.length + 1}/${m.upb})`);

    // 4. ENQUEUE BACKGROUND SAVE
    scanQueueRef.current.push({
      serial,
      tempId,
      model: m.name,
      plant: check.parsed.plant,
      units_per_box: m.upb,
      date: productionDate,
    });
    processQueue();

  }, [serialInput, selectedModel, currentSerials, boxNumber, productionDate, plantCode, sRange, history, lastScanned, lastCompletedBox, addLog, processQueue]);



  // ─── Remove serial from current box ─────────────────────────────────────────
  const removeSerial = useCallback(async (idx) => {
    const item = currentSerials[idx];
    if (!item) return;

    const itemId = typeof item === 'object' ? item.id : null;
    if (!itemId) {
      addLog("err", "Could not find item ID to remove.");
      return;
    }

    try {
      const res = await apiFetch("DELETE", `/pack/scan/${itemId}`);
      if (res?.success) {
        setCurrentSerials(prev => {
          const next = [...prev];
          next.splice(idx, 1);
          if (next.length > 0) {
            const last = next[next.length - 1];
            setLastScanned({
              serial: typeof last === 'object' ? last.serial : last,
              box_number: boxNumber,
            });
          }
          return next;
        });
        addLog("warn", `Serial ${item.serial} removed from box.`);
        setStats(p => ({ ...p, units: Math.max(0, p.units - 1) }));
      } else {
        alert("⚠️ Delete failed: " + (res?.message || "unknown error"));
      }
    } catch (e) {
      alert("⚠️ Network error while removing serial.");
    }
  }, [currentSerials, apiFetch, addLog, boxNumber]);

  const demoScan = useCallback(() => {
    if (!selectedModel) return;
    const m = selectedModel;
    if (!demoCounters.current[m.name]) demoCounters.current[m.name] = 1;
    const seq = demoCounters.current[m.name]++;
    const gen = buildSerial(productionDate, m.name, plantCode || "S", seq);
    addSerial(gen);
  }, [selectedModel, productionDate, plantCode, addSerial]);

  // ─── Auto-close print modal after 8s only on SUCCESS (keep open if error) ──
  useEffect(() => {
    const hasIssue = !!printError || (unprintedBox && unprintedBox.id === lastBoxId);
    if (showPrintModal && !hasIssue) {
      const timer = setTimeout(() => {
        setShowPrintModal(false);
        setLastCompletedBox(null);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [showPrintModal, printError, unprintedBox, lastBoxId]);

  // ─── Manual / reprint ───────────────────────────────────────────────────────
  const handleManualPrint = useCallback(async (overrideZpl, overrideBoxId) => {
    let zpl   = overrideZpl   ?? lastZpl;
    let boxId = overrideBoxId ?? lastBoxId;

    const printerName = appSettings.printerName || "ZDesigner ZT231-300dpi ZPL";

    if (!zpl) {
      if (!selectedModel) {
        addLog("err", "Select a model before printing.");
        return;
      }
      try {
        addLog("info", `Requesting label for Box #${boxNumber} (${selectedModel.name}) from server…`);
        const today = todayStr ? todayStr() : new Date().toISOString().slice(0, 10);
        const svr = await apiFetch("POST", "/pack/manual-print", {
          date: today,
          model: selectedModel.name,
          box_id: boxId || (unprintedBox?.id ?? null),
          box_number: boxNumber,
          units_per_box: selectedModel.upb,
        });
        if (!svr || !svr.success || !svr.zpl) {
          throw new Error(svr?.message || "Server could not generate label.");
        }
        zpl   = svr.zpl;
        boxId = svr.box_id;
        setLastZpl(zpl);
        setLastBoxId(boxId);
        if (svr.serials) setLastCompletedBox(svr.serials);
      } catch (err) {
        addLog("err", `❌ Could not generate label: ${err.message}`);
        setPrintError(`❌ Could not generate label: ${err.message}`);
        setShowPrintModal(true);
        return;
      }
    }

    try {
      addLog("info", `Sending label to ${printerName}…`);
      await qzService.printZPL(zpl, printerName);
      addLog("ok", "✅ Label sent to printer successfully!");
      setPrintError(null);

      if (boxId) {
        try {
          await apiFetch("POST", `/pack/boxes/${boxId}/printed`, {});
          setUnprintedBox(null);
          addLog("ok", `Box marked as printed.`);
        } catch {}
      }

      setCurrentSerials([]);
      setUnprintedBox(null);
      setShowPrintModal(true);
      loadHistory();
      if (selectedModel) syncOpenBox(selectedModel);

    } catch (e) {
      addLog("err", `❌ Print failed: ${e.message}`);
      setPrintError(`❌ Print failed: ${e.message} — Please ensure QZ Tray is running.`);
      setShowPrintModal(true);
    }
  }, [lastZpl, lastBoxId, appSettings, apiFetch, addLog, selectedModel, boxNumber, todayStr, unprintedBox, loadHistory, syncOpenBox]);

  const handleReprintUnprinted = useCallback(() => {
    if (!unprintedBox) {
      addLog("err", "No unprinted box data available.");
      return;
    }
    return handleManualPrint(unprintedBox.zpl, unprintedBox.id);
  }, [unprintedBox, handleManualPrint, addLog]);

  const handleTestPrint = async () => {
    try {
      addLog("info", "Testing QZ Tray connection...");
      await qzService.printTest();
      addLog("ok", "✅ QZ Tray connection verified! Test print sent.");
      alert("✅ QZ Tray connected and test print sent successfully!");
    } catch (e) {
      addLog("err", `❌ QZ Tray Error: ${e.message}`);
      alert(`❌ QZ Tray Error: ${e.message}\n\nPlease ensure QZ Tray is running on your machine.`);
    }
  };

  const handleCheckPrinters = async () => {
    try {
      const printers = await qzService.getPrinters();
      alert(`Printers Found:\n\n${printers.join("\n")}`);
    } catch (error) {
      console.error(error);
      alert(`Failed to get printers:\n${error.message}`);
    }
  };

  const handleZPLTestPrint = async () => {
    try {
      const printerName = appSettings.printerName || "ZDesigner ZT231-300dpi ZPL";
      const testZPL = `
      ^XA
      ^PW812
      ^LL600
      ^FO50,50^A0N,50,50^FDATOMBERG^FS
      ^FO50,130^A0N,35,35^FDQZ TRAY TEST PRINT^FS
      ^FO50,200^A0N,30,30^FDCONNECTION SUCCESS!^FS
      ^FO50,300^BY2,2,80^BCN,80,Y,N,N^FDTEST123456^FS
      ^XZ
      `;
      await qzService.printZPL(testZPL, printerName);
      addLog("ok", `✅ Test ZPL sent to ${printerName}`);
      alert(`✅ Test ZPL sent to ${printerName}!`);
    } catch (error) {
      console.error("❌ Test Print Error:", error);
      addLog("err", `❌ Test print failed: ${error.message}`);
      alert(`❌ Print Failed:\n${error.message}`);
    }
  };

  const handleEditConfig = useCallback((model, upb, desc) => {
    setConfigModel(model);
    setConfigUpb(upb);
    setConfigDesc(desc || "");
    setIsEditing(true);
    setActiveSubTab("config");
    addLog("info", `Editing config for ${model}`);
  }, [addLog]);

  const deleteConfig = useCallback(async (model) => {
    if (!confirm(`Remove packing configuration for ${model}?`)) return;
    try {
      const res = await apiFetch("DELETE", `/pack/config/${encodeURIComponent(model)}`);
      if (res?.success) {
        setPackConfig(prev => {
          const next = { ...prev };
          delete next[model];
          try { localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(next)); } catch {}
          return next;
        });
        addLog("ok", `Config deleted for ${model}`);
        alert(`✅ Config for ${model} deleted`);
      } else {
        alert("⚠️ Delete failed: " + (res?.message || "unknown error"));
      }
    } catch (e) {
      alert("⚠️ Network error while deleting config.");
    }
  }, [apiFetch, addLog]);

  const saveConfig = useCallback(async () => {
    if (!configModel || !configUpb) return;
    setConfigSaving(true);
    if (!DEMO_MODE) {
      try {
        await apiFetch("POST", "/pack/config", {
          model: configModel,
          units_per_box: configUpb,
          description: configDesc
        });
      } catch (e) {}
    }
    const nextMap = { ...packConfig, [configModel]: { units_per_box: configUpb, description: configDesc } };
    setPackConfig(nextMap);
    try { localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(nextMap)); } catch {}

    if (selectedModel?.name === configModel && selectedModel.upb !== configUpb) {
      const updated = { ...selectedModel, upb: configUpb };
      setSelectedModel(updated);
      try { localStorage.setItem(STORAGE_KEY_MODEL, JSON.stringify(updated)); } catch {}
    }

    addLog("info", `Pack config ${isEditing ? 'updated' : 'saved'}: ${configModel} → ${configUpb} units/box`);
    setConfigSaving(false);
    setIsEditing(false);
    setConfigModel("");
    setConfigUpb(12);
    setConfigDesc("");
    alert(`✅ Config ${isEditing ? 'updated' : 'saved'}: ${configModel} = ${configUpb} units per box`);
  }, [configModel, configUpb, configDesc, addLog, apiFetch, isEditing, packConfig, selectedModel]);

  const pct = selectedModel && selectedModel.upb > 0
    ? Math.round((currentSerials.length / selectedModel.upb) * 100)
    : 0;

  const filteredHistory = useMemo(() => {
    let result = history;
    if (historySearch.trim()) {
      const term = historySearch.toLowerCase();
      result = result.filter(b =>
        String(b.boxNum).toLowerCase().includes(term) ||
        String(b.model).toLowerCase().includes(term) ||
        JSON.stringify(b.serials).toLowerCase().includes(term)
      );
    }
    if (historyModelFilter !== "all") {
      result = result.filter(b => b.model === historyModelFilter);
    }
    return result;
  }, [history, historySearch, historyModelFilter]);

  const allModels = models.length > 0? models : Object.keys(MODEL_UPB_DEFAULTS).map(name => ({ name, customer: "ATOMBERG" }));

  const activeRanges = useMemo(
    () => (Array.isArray(sRange) ? sRange : (sRange?.model ? [sRange] : [])),
    [sRange]
  );

  const activeModelNames = useMemo(
    () => new Set(activeRanges.map(r => r.model)),
    [activeRanges]
  );

  const productionModels = useMemo(
    () => allModels.filter(m => activeModelNames.has(m.name)),
    [allModels, activeModelNames]
  );

  const PrintModal = () => {
    if (!showPrintModal || !selectedModel) return null;
    const m = selectedModel;
    const ts = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const serialsToPrint = lastCompletedBox || currentSerials;
    const hasPrintIssue = !!printError || (unprintedBox && unprintedBox.id === lastBoxId);

    const closeModal = () => {
      setShowPrintModal(false);
      setLastCompletedBox(null);
      setPrintError(null);
    };

    return (
      <div className="pk-print-modal-overlay visible" onClick={closeModal}>
        <div className="pk-print-modal" onClick={e => e.stopPropagation()}>

          {/* ── Header ── */}
          <div className="pk-print-title">
            {hasPrintIssue ? "⚠️ Box Completed — Print Pending" : "📦 Box Completed"}
          </div>
          <div className="pk-print-sub" style={{ color: hasPrintIssue ? "#b45309" : undefined }}>
            {hasPrintIssue
              ? "The box has been closed and saved. Click Reprint Label to print the master label."
              : "The box has been saved and the label was sent to the printer."
            }
          </div>

          {/* ── Error banner (inline, no alert) ── */}
          {printError && (
            <div style={{
              background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 7,
              padding: "8px 12px", fontSize: 11, color: "#991b1b", marginTop: 8
            }}>
              {printError}
            </div>
          )}

          {/* ── Label preview ── */}
          {serialsToPrint.length > 0 && (
            <div className="pk-label-preview">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <div>
                  <div className="pk-label-brand">ATOMBERG</div>
                  <div className="pk-label-model">{m.name} · {m.customer}</div>
                </div>
                <div style={{ textAlign: "right", opacity: .7, fontSize: 11 }}>
                  <div>Box #{unprintedBox?.box_number || boxNumber}</div>
                  <div>{serialsToPrint.length} units</div>
                </div>
              </div>
              <div className="pk-label-serials">
                {serialsToPrint.map((s, i) => (
                  <div key={i} className="pk-label-serial-item">S{i + 1}: {typeof s === 'object' ? s.serial : s}</div>
                ))}
              </div>
              <div className="pk-label-footer">
                <span>QR: {serialsToPrint[0]?.serial?.slice(-5) || (typeof serialsToPrint[0] === 'string' ? serialsToPrint[0].slice(-5) : "…")}…{serialsToPrint[serialsToPrint.length - 1]?.serial?.slice(-5) || (typeof serialsToPrint[serialsToPrint.length - 1] === 'string' ? serialsToPrint[serialsToPrint.length - 1].slice(-5) : "…")}</span>
                <span>{ts}</span>
              </div>
            </div>
          )}

          {/* ── Action buttons ── */}
          <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "flex-end" }}>
            <button
              className="btn btn-amb"
              style={{ padding: "8px 18px", fontSize: 12 }}
              onClick={() => handleManualPrint(lastZpl, lastBoxId)}
            >
              🖨️ {hasPrintIssue ? "Reprint Label" : "Reprint"}
            </button>
            <button
              className="btn"
              style={{ padding: "8px 14px", fontSize: 12, background: "var(--g100)", color: "var(--g700)", border: "1px solid var(--g300)" }}
              onClick={closeModal}
            >
              Close
            </button>
          </div>

        </div>
      </div>
    );
  };

  const [reprintingBoxCode, setReprintingBoxCode] = useState(null);

  const handleReprintMaster = useCallback(async (box) => {
    setReprintingBoxCode(box.boxCode);
    try {
      const printerName = appSettings.printerName || "ZDesigner ZT231-300dpi ZPL";
      const dateStr = box.timestamp
        ? new Date(box.timestamp).toISOString().slice(0, 10)
        : (todayStr ? todayStr() : localTodayStr());

      const svr = await apiFetch("POST", "/pack/manual-print", {
        date: dateStr,
        model: box.model,
        box_id: box.id,
        box_number: box.boxNum,
        units_per_box: box.upb,
      });

      if (!svr || !svr.success || !svr.zpl) {
        throw new Error(svr?.message || "Server could not generate label.");
      }

      await qzService.printZPL(svr.zpl, printerName);
      addLog("ok", `✅ Reprinted master label — Box ${box.boxCode}`);
    } catch (err) {
      console.error("Reprint failed:", err);
      addLog("err", `❌ Reprint failed for ${box.boxCode}: ${err.message}`);
      alert("Reprint failed: " + (err.message || err));
    } finally {
      setReprintingBoxCode(null);
    }
  }, [apiFetch, appSettings, addLog, todayStr]);


  // Add near your other history state
const [refreshingHistory, setRefreshingHistory] = useState(false);

const refreshCurrentHistory = useCallback(async () => {
  setRefreshingHistory(true);
  try {
    // re-run the same date-range logic the useEffect uses
    const now = new Date();
    const startOfDay = (d) => { const date = new Date(d); date.setHours(0,0,0,0); return date; };
    const endOfDay   = (d) => { const date = new Date(d); date.setHours(23,59,59,999); return date; };
    let startDate, endDate;

    if (historyDateFilter === "today") { startDate = startOfDay(now); endDate = endOfDay(now); }
    else if (historyDateFilter === "yesterday") {
      const y = new Date(now); y.setDate(now.getDate() - 1);
      startDate = startOfDay(y); endDate = endOfDay(y);
    } else if (historyDateFilter === "7days") {
      startDate = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7));
      endDate = endOfDay(now);
    } else if (historyDateFilter === "30days") {
      startDate = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30));
      endDate = endOfDay(now);
    } else if (historyDateFilter === "custom" && customDateRange.start && customDateRange.end) {
      startDate = startOfDay(new Date(customDateRange.start));
      endDate = endOfDay(new Date(customDateRange.end));
    }

    if (startDate && endDate) {
      const toIso = (d) => d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
      await loadHistory(toIso(startDate), toIso(endDate));
    }
  } finally {
    setRefreshingHistory(false);
  }
}, [historyDateFilter, customDateRange, loadHistory]);

// Auto-poll every 20s while sitting on the History tab
useEffect(() => {
  if (activeSubTab !== "history") return;
  const iv = setInterval(refreshCurrentHistory, 20000);
  return () => clearInterval(iv);
}, [activeSubTab, refreshCurrentHistory]);
  
  const BoxDetailModal = () => {
    if (!selectedHistoryBox) return null;
    const b = selectedHistoryBox;
    return (
      <div className="pk-detail-modal-overlay visible">
        <div className="pk-detail-modal">
          <div className="pk-detail-title">📦 Box Detail: #{b.boxNum}</div>
          <div className="pk-detail-sub">Comprehensive view of packed units and timing.</div>

          <div className="pk-detail-grid">
            <div className="pk-detail-item">
              <span className="pk-detail-label">Box Code</span>
              <span className="pk-detail-value" style={{ color: "var(--accent)", fontSize: 15 }}>{b.boxCode || "N/A"}</span>
            </div>
            <div className="pk-detail-item">
              <span className="pk-detail-label">Model</span>
              <span className="pk-detail-value">{b.model}</span>
            </div>
            <div className="pk-detail-item">
              <span className="pk-detail-label">Units Packed</span>
              <span className="pk-detail-value">{b.serials.length} / {b.upb}</span>
            </div>
            <div className="pk-detail-item">
              <span className="pk-detail-label">Packed At</span>
              <span className="pk-detail-value">{formatDateInd(b.timestamp)}</span>
            </div>
            <div className="pk-detail-item">
              <span className="pk-detail-label">Status</span>
              <span className="pk-detail-value" style={{ color: "var(--green)" }}>✓ {b.status}</span>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="pk-item-list">
              <thead>
                <tr>
                  <th>Slot</th>
                  <th>Serial Number</th>
                  <th>Scanned At</th>
                </tr>
              </thead>
              <tbody>
                {b.serials.map((s, i) => (
                  <tr key={i}>
                    <td style={{ color: "var(--g500)", fontSize: 11 }}>{i + 1}</td>
                    <td className="pk-item-serial">{typeof s === 'object' ? s.serial : s}</td>
                    <td className="pk-item-time">{formatDateInd(s?.scanned_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pk-detail-actions">
            <button className="btn btn-navy" onClick={() => setSelectedHistoryBox(null)}>Close Details</button>
          </div>
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (!selectedModel) return;
    if (activeModelNames.size === 0) return; // no ranges configured yet, don't force-clear
    if (!activeModelNames.has(selectedModel.name)) {
      addLog("warn", `Production range for ${selectedModel.name} is no longer active. Deselecting.`);
      setSelectedModel(null);
      setCurrentSerials([]);
      try { localStorage.removeItem(STORAGE_KEY_MODEL); } catch {}
    }
  }, [activeModelNames, selectedModel, addLog]);

  return (
    <>
      <style>{PACK_CSS}</style>
      <PrintModal />
      <BoxDetailModal />

      <div className="pk-wrap">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div className="pk-tabs">
            {[
              { id: "scan", label: "📦 Scan & Pack" },
              { id: "history", label: `📋 Box History (${history.length})` },
              { id: "config", label: "⚙️ Pack Config" },
            ].map(t => (
              <button key={t.id} className={`pk-tab-btn${activeSubTab === t.id ? " active" : ""}`} onClick={() => setActiveSubTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="pk-stats">
          <div className="pk-stat">
            <div className="pk-stat-v">{filteredHistory.length}</div>
            <div className="pk-stat-l">Boxes Packed</div>
          </div>
          <div className="pk-stat">
            <div className="pk-stat-v">{filteredHistory.reduce((a, b) => a + b.serials.length, 0)}</div>
            <div className="pk-stat-l">Total Units</div>
          </div>
            <div className="pk-stat" style={{ background: stats.errors > 0 ? "#fee2e2" : "#fff" }}>
              <div className="pk-stat-v" style={{ color: stats.errors > 0 ? "#dc2626" : "var(--navy)" }}>{stats.errors}</div>
              <div className="pk-stat-l">Scan Errors</div>
            </div>

            {selectedModel && (
              <div className="pk-stat" style={{ background: "#eff6ff", border: "1px solid #bfdbfe" }}>
                <div className="pk-stat-v" style={{ color: "#1d4ed8" }}>{currentSerials.length}/{selectedModel.upb}</div>
                <div className="pk-stat-l">Current Box</div>
              </div>
            )}

            <div className="pk-history-bar">
          
          </div>
            <button className="btn btn-navy" style={{ padding: "8px 12px", fontSize: 11, height: 'fit-content' }} onClick={handleZPLTestPrint}>
              🖨️ Test Printer
            </button>
            <button className="btn btn-navy" style={{ padding: "8px 12px", fontSize: 11, height: 'fit-content' }} onClick={handleCheckPrinters}>
              🖨️ Check Printers
            </button>
          </div>
        </div>

        {activeSubTab === "scan" && (
          <div className="pk-grid">
            <div className="pk-sidebar">

               <div className="pk-sidebar-title">Active Model</div>
                {productionModels.length === 0 && (
                  <div style={{
                    fontSize: 12, color: "var(--g500)", background: "var(--g50)",
                    border: "1px dashed var(--g200)", borderRadius: 8, padding: "14px 12px",
                    textAlign: "center"
                  }}>
                    No model has an active serial range set.<br />
                    Set a production range in Settings to begin scanning.
                  </div>
                )}
              {productionModels.map((m, i) => {
                const upb = getUpb(m.name);
                const isSelected = selectedModel?.name === m.name;
                const isLoading = isSelected && loadingOpenBox;
                const is8inch = ["FG0494", "FG0495", "FG0496"].includes(m.name);
                const is6inch = ["FG0482", "FG0483", "FG0484"].includes(m.name);
                const hasActiveRange = sRange?.model === m.name && sRange?.start && sRange?.end;
                return (
                  <div
                    key={m.name}
                    className={`pk-model-card${isSelected ? " selected" : ""}${isLoading ? " loading" : ""}`}
                    onClick={() => handleSelectModel({ ...m, upb })}
                  >
                    <div className="pk-model-top">
                      <span className="pk-model-code">{m.name}</span>
                      {isLoading
                        ? <span style={{ fontSize: 10, color: "#1e40af", fontWeight: 600 }}>⟳ syncing…</span>
                        : is6inch ? <span className="pk-model-badge badge-6">6 INCH</span>
                        : is8inch ? <span className="pk-model-badge badge-8">8 INCH</span>
                        : <span className="pk-model-badge">{m.customer}</span>
                      }
                    </div>
                    {hasActiveRange && (
                      <div style={{ fontSize: 9, fontWeight: 700, color: "#065f46", background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: 4, padding: "1px 5px", marginTop: 3, display: "inline-block" }}>
                        ✓ RANGE SET: {sRange.start}–{sRange.end}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: "var(--g600)", marginTop: 2 }}>{m.customer}</div>
                    <div className="pk-model-qty">{upb} units / box</div>
                  </div>
                );
              })}
            </div>

            <div className="pk-panel">
              {selectedModel ? (
                <div className="pk-box-header">
                  <div>
                    <div className="pk-box-label">Box #{boxNumber} — {selectedModel.name}</div>
                    <div className="pk-box-sub">{selectedModel.customer} · {selectedModel.upb} units per box</div>
                  </div>
                  <div className="pk-progress-wrap">
                    <div className="pk-progress-track">
                      <div className={`pk-progress-fill${pct >= 100 ? " full" : ""}`} style={{ width: pct + "%" }} />
                    </div>
                    <div className="pk-progress-label">{currentSerials.length} / {selectedModel.upb} units</div>
                  </div>
                </div>
              ) : (
                <div className="al al-info">👈 Select a model on the left to start packing.</div>
              )}

              {/* ── Loading banner shown while syncing open box from server ── */}
              {loadingOpenBox && selectedModel && (
                <div className="pk-syncing-banner">
                  <div className="pk-spin" />
                  <div>
                    <div>Checking for open box…</div>
                    <div style={{ fontWeight: 400, fontSize: 11, opacity: .75 }}>
                      Fetching last scan session for <strong>{selectedModel.name}</strong>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Unprinted box warning — shown when last closed box has no printed_at ── */}
              {unprintedBox && !loadingOpenBox && (
                <div className="pk-unprinted-banner">
                  <div className="pk-unprinted-icon">⚠️</div>
                  <div className="pk-unprinted-body">
                    <div className="pk-unprinted-title">
                      Box #{unprintedBox.box_number} was completed but the label was NOT printed
                    </div>
                    <div className="pk-unprinted-sub">
                      {unprintedBox.box_code} · {unprintedBox.units_per_box} units packed
                      &nbsp;— Print the label before scanning the next box to keep records accurate.
                    </div>
                    <div className="pk-unprinted-actions">
                      <button className="btn btn-amb" style={{ padding: "6px 14px", fontSize: 11 }} onClick={handleReprintUnprinted}>
                        🖨️ Reprint Label
                      </button>
                      <button className="btn" style={{ padding: "6px 12px", fontSize: 11, background: "var(--g100)", color: "var(--g700)", border: "1px solid var(--g300)" }} onClick={() => { setUnprintedBox(null); addLog("warn", `Unprinted label for Box #${unprintedBox.box_number} dismissed by operator.`); }}>
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {selectedModel && currentSerials.length >= selectedModel.upb && (
                <div className="pk-ready-banner">
                  <div className="pk-ready-icon">📦</div>
                  <div className="pk-ready-text">
                    <div className="pk-ready-title">Box Full — Ready to Print</div>
                    <div className="pk-ready-sub">{selectedModel.upb} serials packed in Box #{boxNumber}. Print modal will open automatically.</div>
                  </div>
                  <button className="btn btn-grn" style={{ padding: "8px 16px" }} onClick={() => handleManualPrint()}>🖨️ Print Label</button>
                </div>
              )}

              <div className={`pk-scan-zone${!selectedModel || loadingOpenBox ? " locked" : ""}`}>
                <div className="pk-scan-zone-title">📷 Scan Serial Number</div>

                {lastScanned && (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    background: "#f0fdf4",
                    border: "1px solid #86efac",
                    borderRadius: 7,
                    padding: "7px 12px",
                    marginBottom: 10,
                    fontSize: 12,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ color: "#16a34a", fontWeight: 700 }}>✓ Last Scanned:</span>
                      <code style={{ fontWeight: 800, color: "var(--navy)", fontSize: 13, background: "#fff", padding: "2px 6px", borderRadius: 4, border: "1px solid #bbf7d0" }}>
                        {lastScanned.serial}
                      </code>
                      <span style={{ fontSize: 10, color: "#166534", background: "#dcfce7", padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>
                        Box #{lastScanned.box_number || boxNumber}
                      </span>
                    </div>
                    {extractSeqNum(lastScanned.serial) > 0 && (
                      <div style={{ fontSize: 11, color: "var(--g700)" }}>
                        Next expected: <strong style={{ color: "var(--navy)" }}>{extractSeqNum(lastScanned.serial) + 1}</strong>
                      </div>
                    )}
                  </div>
                )}

                <div className="pk-scan-input-row">
                  <input
                    ref={inputRef}
                    type="text"
                    className={`pk-serial-input${inputState === "ok" ? " input-ok" : inputState === "err" ? " input-err" : ""}`}
                    placeholder={selectedModel ? (loadingOpenBox ? "Restoring session…" : "Scan or type serial number…") : "Select a model first"}
                    value={serialInput}
                    disabled={!selectedModel || loadingOpenBox || currentSerials.length >= (selectedModel?.upb || 0)}
                    onChange={e => {
                      const val = e.target.value;
                      setSerialInput(val);
                      setInlineError("");
                      setInputState("");
                      const cleaned = val.trim().toUpperCase().replace(/[\r\n\t]/g, "");
                      if (cleaned.length === 16) {
                        addSerial(cleaned);
                      }
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault();
                        const cleaned = serialInput.trim().toUpperCase().replace(/[\r\n\t]/g, "");
                        if (cleaned) {
                          addSerial(cleaned);
                        }
                      }
                    }}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button className="btn btn-red" style={{ padding: "8px 14px" }} onClick={() => addSerial()} disabled={!selectedModel || loadingOpenBox || !serialInput.trim()}>
                    Add
                  </button>
                  {DEMO_MODE && (
                    <button className="btn btn-navy" style={{ padding: "8px 12px", fontSize: 10 }} onClick={demoScan} disabled={!selectedModel || currentSerials.length >= (selectedModel?.upb || 0)} title="Auto-generate a valid demo serial">
                      Demo
                    </button>
                  )}
                </div>
                {inlineError && <div className="pk-inline-error" style={{ display: "block" }}>{inlineError}</div>}
                  {selectedModel && (
                    <div style={{ fontSize: 11, color: "var(--g600)", marginBottom: 8, marginTop: 8 }}>
                      Expected for {productionDate}:{" "}
                      <code style={{ fontWeight: 700, color: "var(--navy)" }}>
                        {buildSerialPrefix(productionDate, selectedModel.name, plantCode || "S/P")}
                        <span style={{ color: "var(--g400)" }}>#####</span>
                      </code>
                      {!plantCode && (
                        <span style={{ marginLeft: 6, color: "var(--g500)" }}>
                          (S = Sonipat, P = Pune)
                        </span>
                      )}
                    </div>
                  )}
              </div>

              {selectedModel && (
                <div className="pk-slots-section">
                  <div className="pk-slots-title">
                    <span>Slot Positions — Box #{boxNumber}</span>
                    {currentSerials.length > 0 && (
                      <button className="btn btn-dngr" style={{ padding: "3px 9px", fontSize: 10 }}
                        onClick={() => { if (confirm("Clear all serials in current box?")) { setStats(p => ({ ...p, units: Math.max(0, p.units - currentSerials.length) })); setCurrentSerials([]); addLog("warn", "Current box cleared by operator."); } }}>
                        Clear Box
                      </button>
                    )}
                  </div>
                  <div className="pk-slots-grid">
                    {Array.from({ length: selectedModel.upb }, (_, i) => {
                      const item = currentSerials[i];
                      return (
                        <div key={i} className={`pk-slot${item ? " filled" : " empty"}`}>
                          <div className="pk-slot-num">Slot {i + 1}</div>
                          {item ? (
                            <>
                              <div className="pk-slot-serial">{typeof item === 'object' ? item.serial : item}</div>
                              <div className="pk-slot-time">
                                {item.pending ? "saving…" : (item.scanned_at ? formatDateInd(item.scanned_at).split(" : ")[1] || "saved" : "saved")}
                              </div>
                              <button className="pk-slot-remove" onClick={() => removeSerial(i)}>✕</button>
                            </>
                          ) : (
                            <div className="pk-slot-serial hint">awaiting scan…</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--g600)", marginBottom: 5 }}>VALIDATION LOG</div>
                <div className="pk-vlog">
                  {vlog.length === 0 && <div style={{ fontSize: 11, color: "var(--g400)" }}>No events yet.</div>}
                  {vlog.map((entry, i) => (
                    <div key={i} className="pk-vlog-entry">
                      <span className="pk-vlog-time">{entry.time}</span>
                      <span className={`pk-vlog-dot ${entry.type}`} />
                      <span className="pk-vlog-msg">{entry.msg}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSubTab === "history" && (
          <div className="pk-panel">
            <div className="pk-history-bar">
              <input
                className="pk-history-search"
                placeholder="Search box, model, serial..."
                value={historySearch}
                onChange={e => setHistorySearch(e.target.value)}
              />
              <div className="pk-filter-group">
                <span>Model:</span>
                <select className="pk-filter-select" value={historyModelFilter} onChange={e => setHistoryModelFilter(e.target.value)}>
                  <option value="all">All Models</option>
                  {allModels.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                </select>
              </div>
              <div className="pk-filter-group">
                <span>Date:</span>
                <select className="pk-filter-select" value={historyDateFilter} onChange={e => setHistoryDateFilter(e.target.value)}>
                  <option value="today">Today</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="7days">Last 7 Days</option>
                  <option value="30days">Last 30 Days</option>
                  <option value="custom">Custom Range</option>
                </select>
              </div>
              <button className="btn btn-navy" style={{ padding: "6px 12px", fontSize: 11 }} onClick={refreshCurrentHistory} disabled={refreshingHistory}>
                {refreshingHistory ? "⏳ Refreshing…" : "🔄 Refresh"}
              </button>
              {historyDateFilter === "custom" && (
                <div className="pk-filter-group">
                  <input type="date" className="pk-date-input" value={customDateRange.start} onChange={e => setCustomDateRange(prev => ({ ...prev, start: e.target.value }))} />
                  <span>to</span>
                  <input type="date" className="pk-date-input" value={customDateRange.end} onChange={e => setCustomDateRange(prev => ({ ...prev, end: e.target.value }))} />
                </div>
              )}
            </div>

            <div className="tbl-wrap" style={{ background: "#fff", borderRadius: 9, border: "1px solid var(--g200)", overflowY: "auto", maxHeight: "70vh" }}>
              <table className="pk-history-table">
                <thead>
                  <tr>
                    <th>Box #</th>
                    <th>Box Code</th>
                    <th>Model</th>
                    <th>Units</th>
                    <th>Timestamp</th>
                    <th style={{ textAlign: "center" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.length > 0 ? (
                    filteredHistory.map((b, i) => (
                      <tr key={i} style={{ cursor: "pointer" }} onClick={() => setSelectedHistoryBox(b)}>
                        <td><strong>#{b.boxNum}</strong></td>
                        <td><code style={{ fontSize: 12, fontWeight: 700 }}>{b.boxCode}</code></td>
                        <td>{b.model}</td>
                        <td>{b.serials.length} / {b.upb}</td>
                        <td style={{ fontSize: 11, color: "var(--g500)" }}>{formatDateInd(b.timestamp)}</td>
                        <td style={{ textAlign: "center" }}>
                        <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                          <button
                            className="btn btn-navy"
                            style={{ padding: "3px 8px", fontSize: 10 }}
                            onClick={(e) => { e.stopPropagation(); setSelectedHistoryBox(b); }}
                          >
                            👁️ View
                          </button>
                          <button
                            className="btn btn-teal"
                            style={{ padding: "3px 8px", fontSize: 10 }}
                            onClick={(e) => { e.stopPropagation(); handleReprintMaster(b); }}
                            disabled={reprintingBoxCode === b.boxCode}
                          >
                            {reprintingBoxCode === b.boxCode ? "⏳ Printing..." : "🖨️ Reprint"}
                          </button>
                        </div>
                      </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="6" style={{ textAlign: "center", padding: "20px", color: "var(--g400)", fontSize: 13 }}>
                        No completed boxes found for the selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeSubTab === "config" && (
          <div className="pk-panel">
            <div className="section">
              <div className="sec-title">Units Per Box — Per Model Configuration</div>
              <div className="al al-warn" style={{ marginBottom: 12 }}>
                Set the number of fans packed per master box for each model. This overrides the default.
              </div>
              <div className="pk-config-grid" style={{ gridTemplateColumns: "1fr 1fr 2fr" }}>
                <div className="fg" style={{ margin: 0 }}>
                  <label className="fl">Model</label>
                  <select className="fs" value={configModel} onChange={e => setConfigModel(e.target.value)}>
                    <option value="">-- Select Model --</option>
                    {allModels.map(m => (
                      <option key={m.name} value={m.name}>{m.name} — {m.customer}</option>
                    ))}
                  </select>
                </div>
                <div className="fg" style={{ margin: 0 }}>
                  <label className="fl">Units Per Box</label>
                  <input type="number" className="fi" min="1" max="50" value={configUpb} onChange={e => setConfigUpb(parseInt(e.target.value) || 1)} />
                </div>
                <div className="fg" style={{ margin: 0 }}>
                  <label className="fl">Description</label>
                  <input type="text" className="fi" placeholder="e.g. Standard Packaging" value={configDesc} onChange={e => setConfigDesc(e.target.value)} />
                </div>
              </div>
              <div className="btn-row" style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <button className="btn btn-red" onClick={saveConfig} disabled={!configModel || configSaving}>
                  {configSaving ? "Saving…" : isEditing ? "🔄 Update Config" : "💾 Save Config"}
                </button>
                {isEditing && (
                  <button className="btn btn-navy" onClick={() => { setIsEditing(false); setConfigModel(""); setConfigUpb(12); }}>
                    ❌ Cancel
                  </button>
                )}
              </div>

              {Object.keys(packConfig).length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--g700)", marginBottom: 8 }}>Active Custom Configurations</div>
                  <div className="tbl-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Model Name</th>
                          <th>Customer</th>
                          <th>Units / Box</th>
                          <th>Description</th>
                          <th>Config Source</th>
                          <th style={{ textAlign: "center" }}>Edit Action</th>
                          <th style={{ textAlign: "center" }}>Delete Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allModels.filter(m => packConfig[m.name]).map(m => {
                          const cfg = packConfig[m.name];
                          const upb = typeof cfg === 'object' ? cfg.units_per_box : cfg;
                          const desc = typeof cfg === 'object' ? cfg.description : "";
                          const source = "Saved";
                          return (
                            <tr key={m.name}>
                              <td><strong>{m.name}</strong></td>
                              <td>{m.customer}</td>
                              <td><strong style={{ color: "var(--navy)" }}>{upb}</strong></td>
                              <td>{desc || "- "}</td>
                              <td>
                                <span style={{ fontSize: 10, background: "#d1fae5", color: "#065f46", padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>
                                  {source}
                                </span>
                              </td>
                              <td style={{ textAlign: "center" }}>
                                <button className="btn btn-navy" style={{ padding: "3px 8px", fontSize: 10 }} onClick={() => handleEditConfig(m.name, upb, desc)}>✏️ Edit</button>
                              </td>
                              <td style={{ textAlign: "center" }}>
                                <button className="btn btn-dngr" style={{ padding: "3px 8px", fontSize: 10 }} onClick={() => deleteConfig(m.name)}>🗑️ Delete</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {DEMO_MODE && (
                <div className="al al-warn">
                  <strong>Demo Mode Active</strong> — All data is local only. Set <code style={{color: 'var(--navy)'}}>DEMO_MODE = false</code> in PackingTab.jsx after adding the backend routes.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
