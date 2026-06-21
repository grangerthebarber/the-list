import { useState, useRef, useCallback, useEffect } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from "firebase/auth";
import { getFirestore, doc, onSnapshot, setDoc, serverTimestamp } from "firebase/firestore";

var firebaseConfig = {
  apiKey: "AIzaSyBJhakukEUD2n84bo6ccdV4I2bwVYY8arM",
  authDomain: "the-list-9efdb.firebaseapp.com",
  projectId: "the-list-9efdb",
  storageBucket: "the-list-9efdb.firebasestorage.app",
  messagingSenderId: "17185461265",
  appId: "1:17185461265:web:fda3224257665a88964db0"
};
var fbApp = initializeApp(firebaseConfig);
var fbAuth = getAuth(fbApp);
var fbDb = getFirestore(fbApp);

const ALL_TIMES = [
  "4:59","5:21","5:43","6:06","6:28","6:51",
  "7:13","7:36","7:58",
  "8:21","8:43","9:06","9:28","9:51","10:13","10:36","10:58",
  "11:21","11:43","12:06","12:28","12:51",
  "1:13","1:36","1:58","2:21",
  "2:43","3:06","3:28","3:51","4:13","4:36","4:58"
];

const DEFAULT_TIMES = [
  "7:13","7:36","7:58",
  "8:21","8:43","9:06","9:28","9:51","10:13","10:36","10:58",
  "11:21","11:43","12:06","12:28","12:51",
  "1:13","1:36","1:58","2:21","2:43"
];

// #15: 3:06 / 3:28 / 3:51 were retired from the auto-populated grid so the
// remaining rows get more height (no scrolling). They stay in ALL_TIMES, so the
// user can still hand-add one as a custom +PM slot. Existing saved days that
// still carry these as EMPTY default placeholders are trimmed on load (named,
// blocked, custom, marked, or noted slots at these times are always preserved —
// we never silently delete a booked appointment).
const REMOVED_TAIL_TIMES = ["3:06","3:28","3:51"];
function trimRemovedTail(slots) {
  if (!slots || !slots.length) return slots;
  var out = [];
  for (var i = 0; i < slots.length; i++) {
    var s = slots[i];
    var isRemoved = REMOVED_TAIL_TIMES.indexOf(s.time) !== -1;
    var isEmptyPlaceholder = !s.name && !s.blocked && !s.isCustom && !s.availStatus && !s.note;
    if (isRemoved && isEmptyPlaceholder) continue;
    out.push(s);
  }
  return out;
}

const OLD_DEFAULT_TIMES_A = [
  "6:51","7:13","7:36","7:58",
  "8:21","8:43","9:06","9:28","9:51","10:13","10:36","10:58",
  "11:21","11:43","12:06","12:28","12:51",
  "1:13","1:36","1:58","2:21","2:43","3:06","3:28"
];
const OLD_DEFAULT_TIMES_B = [
  "7:13","7:36","7:58",
  "8:21","8:43","9:06","9:28","9:51","10:13","10:36","10:58",
  "11:21","11:43","12:06","12:28","12:51",
  "1:13","1:36","1:58","2:21"
];
const OLD_DEFAULT_TIMES_C = [
  "7:13","7:36","7:58",
  "8:21","8:43","9:06","9:28","9:51","10:13","10:36","10:58",
  "11:21","11:43","12:06","12:28","12:51",
  "1:13","1:36"
];


const WEEK_OPTIONS = [1,2,3,4,5,6,7,8];

// One blue for every "off the default" cue: an earlier-or-later nudged time AND
// the vertical bar that marks linked/grouped slots. Matched to the recurring-↺
// arrow's blue so adjusted times, links, and recurring all read as one color.
const ADJ_BLUE = "#4a8a9a";

// parseTime is used ONLY as a chronological sort comparator. The barber day runs
// 7am→3pm, so 1:00–4:00 are afternoon and must sort AFTER 12:xx. Delegate to the
// afternoon-aware mapper (hoisted) so every sort agrees on the same ordering;
// otherwise recurring placement put 1:13–3:06 at the top and "ended" the day at 12:51.
function parseTime(t) { return timeToAbsMinutes(t); }

// When re-placing a recurring client onto FUTURE days, ignore any one-off time
// tweak made to a single appointment (e.g. a default 7:58 nudged to 7:48) and use
// the slot's ORIGINAL default time, so the booking drops into the existing default
// slot on each future day instead of spawning a second, off-grid time. A genuinely
// custom slot has no defaultBaseTime, so it keeps its own time. (defaultBaseTime is
// stamped the first time a default slot's minutes are edited — see commitTimeEdit.)
function placementTime(slot) { return (slot && slot.defaultBaseTime) ? slot.defaultBaseTime : (slot ? slot.time : ""); }

var _gid = 1;
function newGroupId() { return "g"+(_gid++); }
const SHORT_MONTHS = [3,4,5,6];
function smartDate(date, includeWeekday) {
  var month = date.getMonth();
  var monthStyle = SHORT_MONTHS.includes(month) ? "long" : "short";
  var opts = {month:monthStyle, day:"numeric"};
  if (includeWeekday) opts.weekday = "long";
  return date.toLocaleDateString("en-US", opts);
}
function toDateKey(date) {
  var y=date.getFullYear();
  var m=String(date.getMonth()+1).padStart(2,"0");
  var d=String(date.getDate()).padStart(2,"0");
  return y+"-"+m+"-"+d;
}
function addDays(date, n) { var d = new Date(date); d.setDate(d.getDate()+n); return d; }
function addWeeks(date, n) { return addDays(date, n*7); }
function isToday(date) { return date.toDateString() === new Date().toDateString(); }
// A day counts as "done" once the LAST person actually typed onto the list is
// checked off (ignores empty default slots and blocked/lunch slots).
function isDayComplete(slots) {
  if (!slots || !slots.length) return false;
  var named = slots.filter(function(s){ return s.name && !s.blocked; });
  if (named.length === 0) return false;
  return !!named[named.length-1].done;
}
function capitalizeFirst(str) { if (!str) return str; return str.charAt(0).toUpperCase()+str.slice(1); }
function stripLeadingNumbers(str) { if (!str) return str; return str.replace(/^\s*\d+\s*[.)\-]\s*/, "").replace(/^\s*\d+\s+(?=\D)/, ""); }
function isLunchName(str) { var v = str ? str.trim().toLowerCase() : ""; return v==="lunch" || v==="l"; }
function isBlockName(str) { var v = str ? str.trim().toLowerCase() : ""; return v==="block" || v==="b"; }
function parseDateKey(key) { var parts = key.split("-").map(Number); return new Date(parts[0],parts[1]-1,parts[2]); }
function formatDateKey(date) { return toDateKey(date); }
function friendlyDate(dateKey) {
  var d = parseDateKey(dateKey);
  var month = d.getMonth();
  var monthStyle = [3,4,5,6].includes(month) ? "long" : "short";
  return d.toLocaleDateString("en-US", {weekday:"short", month:monthStyle, day:"numeric"});
}
function friendlyDateLong(dateKey) {
  var d = parseDateKey(dateKey);
  var month = d.getMonth();
  var monthStyle = [3,4,5,6].includes(month) ? "long" : "short";
  return d.toLocaleDateString("en-US", {weekday:"long", month:monthStyle, day:"numeric"});
}
function friendlyDateTime(time, dateKey) { return time + ", " + friendlyDateLong(dateKey); }
function dayOfWeek(dateKey) { return parseDateKey(dateKey).getDay(); }

function isOldDefault(slots) {
  var checkOld = function(old) {
    if (!slots || slots.length !== old.length) return false;
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].time !== old[i]) return false;
      if (slots[i].name) return false;
    }
    return true;
  };
  return checkOld(OLD_DEFAULT_TIMES_A) || checkOld(OLD_DEFAULT_TIMES_B) || checkOld(OLD_DEFAULT_TIMES_C);
}

// A day the user already edited keeps an OLD short default tail (it stops at
// 1:13, 1:36, or the previous 2:21 end) because it has names, so isOldDefault
// skips it. If the day is still made only of standard default times (no custom
// rows), top it back up to the full default tail (now ends 3:51). Idempotent: a
// full day (ends 3:51) is left untouched.
function extendDefaultTail(slots) {
  if (!slots || !slots.length) return slots;
  var present = {};
  var maxAbs = 0;
  for (var i = 0; i < slots.length; i++) {
    var s = slots[i];
    if (s.isCustom) return slots;
    if (DEFAULT_TIMES.indexOf(s.time) === -1) return slots;
    present[s.time] = true;
    var a = timeToAbsMinutes(s.time);
    if (a > maxAbs) maxAbs = a;
  }
  var abs113 = timeToAbsMinutes("1:13");
  var abs136 = timeToAbsMinutes("1:36");
  var abs221 = timeToAbsMinutes("2:21");
  if (maxAbs !== abs113 && maxAbs !== abs136 && maxAbs !== abs221) return slots;
  var out = slots.slice();
  for (var k = 0; k < DEFAULT_TIMES.length; k++) {
    var dt = DEFAULT_TIMES[k];
    if (present[dt]) continue;
    if (timeToAbsMinutes(dt) > maxAbs) {
      out.push({time:dt,name:"",price:"",done:false,recurWeeks:null,isCustom:false});
    }
  }
  return out;
}

// Catch-all that guarantees every day carries the current default afternoon tail
// (now ending 3:51). extendDefaultTail is conservative — it skips any day that has
// names, time-nudged slots, or custom rows — so days the user actually uses would
// otherwise never gain the two new tail slots. This appends any missing default
// times that fall after the day's latest slot, as empty default slots. It bails the
// moment a day already reaches 3:28+ (extended by default OR by a custom +PM slot),
// so a user-stretched afternoon is never touched, and present[] guards against ever
// duplicating a time that is already on the day.
function topUpAfternoonTail(slots) {
  if (!slots || !slots.length) return slots;
  var present = {};
  var maxAbs = 0;
  var i;
  for (i = 0; i < slots.length; i++) {
    present[slots[i].time] = true;
    var a = timeToAbsMinutes(slots[i].time);
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs >= timeToAbsMinutes("3:28")) return slots;
  var out = slots.slice();
  var k;
  for (k = 0; k < DEFAULT_TIMES.length; k++) {
    var dt = DEFAULT_TIMES[k];
    if (present[dt]) continue;
    if (timeToAbsMinutes(dt) > maxAbs) {
      out.push({time:dt,name:"",price:"",done:false,recurWeeks:null,isCustom:false});
    }
  }
  out.sort(function(a,b){ return timeToAbsMinutes(a.time)-timeToAbsMinutes(b.time); });
  return out;
}

function migrateSchedules(raw) {
  var result = {};
  var keys = Object.keys(raw);
  for (var i = 0; i < keys.length; i++) {
    var dk = keys[i];
    if (isOldDefault(raw[dk])) {
      result[dk] = DEFAULT_TIMES.map(function(t){ return {time:t,name:"",price:"",done:false,recurWeeks:null,isCustom:false}; });
    } else {
      result[dk] = trimRemovedTail(topUpAfternoonTail(extendDefaultTail(raw[dk])));
    }
  }
  return result;
}

function getBannerColor(type) {
  if (type==="penciled") return "#a07830";
  if (type==="added"||type==="slot_added"||type==="unblocked"||type==="checkoff") return "#2a7a2a";
  if (type==="removed"||type==="slot_removed"||type==="blocked") return "#c0392b";
  if (type==="rescheduled") return "#2a4fd6";
  return "#555";
}

function describeBanner(entry) {
  if (!entry) return "";
  if (entry.msg) return entry.msg;
  var type = entry.type;
  if (type==="added" && entry.name && entry.time && entry.dateKey) {
    return entry.name + " is locked in for " + entry.time + " • " + friendlyDateLong(entry.dateKey);
  }
  if (type==="rescheduled" && entry.name && entry.time && entry.dateKey) {
    return entry.name + " rescheduled to " + entry.time + " • " + friendlyDateLong(entry.dateKey);
  }
  if (type==="penciled" && entry.name && entry.time) {
    return entry.name + " penciled in for " + entry.time + (entry.dateKey ? (" • " + friendlyDateLong(entry.dateKey)) : "");
  }
  var prefix = type==="added"?"Locked in":type==="checkoff"?"Checked off":type==="removed"?"Canceled":type==="rescheduled"?"Rescheduled":type==="edited"?"Edited":type==="recurring_set"?"Set recurring":type==="blocked"?"Blocked":type==="unblocked"?"Unblocked":type==="slot_added"?"Added slot":type==="slot_removed"?"Removed slot":type==="undo"?"Undone":type==="redo"?"Redone":"Changed";
  var name = entry.name ? (" " + entry.name) : "";
  var time = entry.time ? (" at " + entry.time) : "";
  var date = entry.dateKey ? (" · " + friendlyDate(entry.dateKey)) : "";
  return prefix + name + time + date;
}

const VIEWS = ["Day","3-Day","Wknd","Week","Month"];

// Compare two schedule snapshots and return the single most salient slot that
// differs, preferring one where a name appears or disappears. Used to label
// undo/redo ("Undone James at 2:30") and to jump to the affected day.
function describeScheduleDiff(fromSch, toSch) {
  fromSch = fromSch || {}; toSch = toSch || {};
  var keyset = {};
  Object.keys(fromSch).forEach(function(k){ keyset[k]=true; });
  Object.keys(toSch).forEach(function(k){ keyset[k]=true; });
  var allKeys = Object.keys(keyset).sort();
  var namedHit = null; var otherHit = null;
  allKeys.forEach(function(dk){
    if (namedHit) return;
    var a = fromSch[dk] || []; var b = toSch[dk] || [];
    var amap = {}; var bmap = {}; var times = {};
    a.forEach(function(s){ amap[s.time]=s; times[s.time]=true; });
    b.forEach(function(s){ bmap[s.time]=s; times[s.time]=true; });
    Object.keys(times).forEach(function(t){
      var sa = amap[t]; var sb = bmap[t];
      var an = (sa&&sa.name)||""; var bn = (sb&&sb.name)||"";
      if (an !== bn) {
        var nm = an || bn;
        if (nm && !namedHit) namedHit = {dateKey:dk, time:t, name:nm, hasName:true};
      } else if (sa && sb && (!!sa.done)!==(!!sb.done)) {
        if (!otherHit) otherHit = {dateKey:dk, time:t, name:an||bn||"", hasName:!!(an||bn)};
      } else if ((!!sa) !== (!!sb)) {
        if (!otherHit) otherHit = {dateKey:dk, time:t, name:(sa&&sa.name)||(sb&&sb.name)||"", hasName:false};
      }
    });
  });
  return namedHit || otherHit || null;
}

function getNthWeekday(year, month, weekday, n) {
  if (n === -1) {
    var last = new Date(year, month, 0);
    var d = last.getDay();
    var diff = (d - weekday + 7) % 7;
    return new Date(year, month-1, last.getDate()-diff);
  }
  var first = new Date(year, month-1, 1);
  var fd = first.getDay();
  var fdiff = (weekday - fd + 7) % 7;
  return new Date(year, month-1, 1 + fdiff + (n-1)*7);
}
function getUSHolidays(year) {
  var h = {};
  var add = function(date, name) { if(date) h[toDateKey(date)] = name; };
  add(new Date(year,0,1), "New Year's Day");
  add(getNthWeekday(year,1,1,3), "MLK Day");
  add(getNthWeekday(year,2,1,3), "Presidents Day");
  add(getNthWeekday(year,5,1,-1), "Memorial Day");
  add(new Date(year,5,19), "Juneteenth");
  add(new Date(year,6,4), "Independence Day");
  add(getNthWeekday(year,9,1,1), "Labor Day");
  add(getNthWeekday(year,11,4,4), "Thanksgiving");
  add(new Date(getNthWeekday(year,11,4,4).getTime()+86400000), "Day after Thanksgiving");
  add(new Date(year,11,24), "Christmas Eve");
  add(new Date(year,11,25), "Christmas Day");
  add(new Date(year,11,31), "New Year's Eve");
  return h;
}
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function loadFromStorage(key, fallback) {
  try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch(e) { return fallback; }
}

function getUpcomingWeekend() {
  var today = new Date();
  var dow = today.getDay();
  var daysToSat;
  if (dow === 6) daysToSat = 7;
  else if (dow === 5) daysToSat = 8;
  else daysToSat = 6 - dow;
  return addDays(today, daysToSat);
}

function playSound(type) {
  try {
    var ctx=new (window.AudioContext||window.webkitAudioContext)();
    var osc=ctx.createOscillator(); var gain=ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if(type==="tap") {
      osc.frequency.setValueAtTime(440,ctx.currentTime); osc.type="sine";
      gain.gain.setValueAtTime(0.07,ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.08);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime+0.08);
    } else if(type==="lock") {
      osc.frequency.setValueAtTime(523,ctx.currentTime); osc.frequency.setValueAtTime(659,ctx.currentTime+0.06);
      osc.type="sine"; gain.gain.setValueAtTime(0.09,ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.18);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime+0.18);
    } else if(type==="delete") {
      osc.frequency.setValueAtTime(300,ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(120,ctx.currentTime+0.15);
      osc.type="sine"; gain.gain.setValueAtTime(0.09,ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.18);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime+0.18);
    }
  } catch(e){}
}

// Thin circular-arrow icons (fuller circle, lighter weight than the ↺/↻ glyphs).
function UndoIcon(props) {
  var size = props.size || 18; var color = props.color || "#555";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{display:"block"}}>
      <polyline points="1 4 1 10 7 10"/>
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
    </svg>
  );
}
function RedoIcon(props) {
  var size = props.size || 18; var color = props.color || "#555";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{display:"block"}}>
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  );
}
function LockIcon(props) {
  var size = props.size || 15; var color = props.color || "#0f0f0f";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block"}}>
      <rect x="5" y="11" width="14" height="9" rx="2"/>
      <path d="M8 11V8a4 4 0 0 1 8 0v3"/>
    </svg>
  );
}

function UnlockIcon(props) {
  var size = props.size || 15; var color = props.color || "#0f0f0f";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block"}}>
      <rect x="5" y="11" width="14" height="9" rx="2"/>
      <path d="M8 11V8a4 4 0 0 1 7.6-1.5"/>
    </svg>
  );
}

// #17: Apple-style speech-bubble (rounded bubble with a small tail). Stroke-based
// so its line weight matches the pencil/recurring glyphs. Color is passed in:
// app-blue when a number is on file, gray when it isn't.
function MessageIcon(props) {
  var size = props.size || 20; var color = props.color || "#4a8a9a";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{display:"block"}}>
      <path d="M12 4 C6.48 4 2 7.58 2 12 C2 14.05 2.94 15.9 4.5 17.3 C4.32 18.95 3.62 20.42 2.5 21.5 C4.56 21.4 6.42 20.74 7.96 19.64 C9.2 20.08 10.56 20.3 12 20.3 C17.52 20.3 22 16.42 22 12 C22 7.58 17.52 4 12 4 Z"/>
    </svg>
  );
}

// Salon day runs morning (hours 5–12) into afternoon (hours 1–4 = PM). Map a
// displayed "H:MM" to an absolute minute-of-day so nudging/ordering behave.
function timeToAbsMinutes(t) {
  var parts = t.split(":").map(Number); var h = parts[0]; var m = parts[1] || 0;
  var absH = (h >= 1 && h <= 4) ? h + 12 : h; // 1–4 are afternoon; 5–12 are morning/noon
  return absH * 60 + m;
}
function absMinutesToTime(min) {
  while (min < 0) min += 1440; min = min % 1440;
  var absH = Math.floor(min / 60); var m = min % 60;
  var dispH = absH > 12 ? absH - 12 : absH; if (dispH === 0) dispH = 12;
  return dispH + ":" + String(m).padStart(2, "0");
}

export default function TheList() {
  const [view, setView] = useState(function() { try { return (typeof window!=="undefined" && window.innerWidth<=430) ? "Day" : "3-Day"; } catch(e) { return "3-Day"; } });
  const [isSplitView, setIsSplitView] = useState(false);
  const [isPhone, setIsPhone] = useState(function() { try { return typeof window!=="undefined" && window.innerWidth<=430; } catch(e) { return false; } });
  const [baseDate, setBaseDate] = useState(new Date());
  const [schedules, setSchedules] = useState(function() {
    var raw = loadFromStorage("tl_schedules", {});
    return migrateSchedules(raw);
  });
  const [editingCell, setEditingCell] = useState(null);
  const [editValues, setEditValues] = useState({name:"", price:""});
  const [history, setHistory] = useState(function() { return loadFromStorage("tl_history", []); });
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [recentlyRemoved, setRecentlyRemoved] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [swipedSlot, setSwipedSlot] = useState(null);
  const [recurringModal, setRecurringModal] = useState(null);
  const [checkoffModal, setCheckoffModal] = useState(null);
  const [nudgedDate, setNudgedDate] = useState(null);
  const [conflictModal, setConflictModal] = useState(null);
  const [reassignMode, setReassignMode] = useState(null);
  const [reassignApplyAll, setReassignApplyAll] = useState(null);
  const [groupConfirm, setGroupConfirm] = useState(null);
  const [groupRecurModal, setGroupRecurModal] = useState(null);
  const [clientMemory, setClientMemory] = useState(function() { return loadFromStorage("tl_clients", []); });
  const [customHolidays, setCustomHolidays] = useState(function() { return loadFromStorage("tl_holidays", []); });
  const [holidayModal, setHolidayModal] = useState(null);
  const [newHolidayName, setNewHolidayName] = useState("");
  const [newHolidayYearly, setNewHolidayYearly] = useState(false);
  const [blockLabelModal, setBlockLabelModal] = useState(null);
  const [blockLabel, setBlockLabel] = useState("Lunch");
  const [clientProfile, setClientProfile] = useState(null);
  const [phoneModal, setPhoneModal] = useState(null);
  const [checkoffCalMonth, setCheckoffCalMonth] = useState(null);
  const [editingOccupied, setEditingOccupied] = useState(false);
  const [monthLongPress, setMonthLongPress] = useState(null);
  const [banner, setBanner] = useState(null);
  const [clientSearch, setClientSearch] = useState("");
  const [showAllClients, setShowAllClients] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [noteModal, setNoteModal] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [dayNotes, setDayNotes] = useState(function() { return loadFromStorage("tl_daynotes", {}); });
  const [groupScheduleModal, setGroupScheduleModal] = useState(null);
  const [entryUndoConflict, setEntryUndoConflict] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedSlots, setSelectedSlots] = useState({});
  const [dragState, setDragState] = useState(null);
  const [placingClient, setPlacingClient] = useState(null);
  const [dragCalOpen, setDragCalOpen] = useState(false);
  const [dragCalMonth, setDragCalMonth] = useState(null);
  const [dragCalHover, setDragCalHover] = useState(false);
  const [reassignQueue, setReassignQueue] = useState([]);
  const [isLiveDragging, setIsLiveDragging] = useState(false);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [timeEditModal, setTimeEditModal] = useState(null);
  const [timeEditMinutes, setTimeEditMinutes] = useState(0);
  const [dailyExportPrompt, setDailyExportPrompt] = useState(false);
  const [seriesEditModal, setSeriesEditModal] = useState(null);
  const [renameRequiredModal, setRenameRequiredModal] = useState(null);
  const [navAnim, setNavAnim] = useState({n:0,dir:0});
  const [bannerSwipeY, setBannerSwipeY] = useState(0);
  const bannerTouchStart = useRef(null);
  const dragChipRef = useRef(null);
  const dragPosRef = useRef({x:0,y:0});
  const dragOverRef = useRef(null);
  const dragStateRef = useRef(null);
  // Persistent element + pointer id used to pointer-capture a live drag so that
  // switching views mid-drag (which unmounts the source row) can't abort the
  // gesture. Capture is taken on the app root, which never unmounts.
  const appRootRef = useRef(null);
  const dragPointerId = useRef(null);
  const bannerTimer = useRef(null);
  const longPressTimer = useRef(null);
  const checkoffLongPress = useRef(null);
  const dragLongPress = useRef(null);
  const editingRef = useRef(null);
  const editValuesRef = useRef(editValues);
  editValuesRef.current = editValues;
  const touchStart = useRef(null);
  const swipeNavStart = useRef(null);
  const dragTouchStart = useRef(null);
  const selectDragAnchor = useRef(null);
  const schedulesRef = useRef(schedules);
  schedulesRef.current = schedules;
  dragStateRef.current = dragState;
  const viewRef = useRef(view);
  viewRef.current = view;
  const slotTapRef = useRef({key:null,count:0,timer:null});
  // Pencil "arm" mode: clicking the pencil with an empty field arms it so the
  // next Enter pencils the person in; clicking it again disarms.
  const [pencilArmed, setPencilArmed] = useState(false);
  const pencilArmedRef = useRef(false);
  pencilArmedRef.current = pencilArmed;
  // editChromeReady defers the visual "editing" chrome (pink row, price box,
  // pencil) for a beat after a single tap on a plain empty slot, so a quick
  // double/triple tap (available/overtime) never flashes the edit layout.
  const [editChromeReady, setEditChromeReady] = useState(true);
  const settleTimer = useRef(null);
  const isLiveDraggingRef = useRef(false);
  isLiveDraggingRef.current = isLiveDragging;
  // #5: ring buffer of the last few JSON payloads WE pushed to the cloud, so the
  // matching onSnapshot echo can be recognised and ignored (a single lastSyncRef
  // loses the race when undo writes the old state right after a booked-state push).
  const recentWritesRef = useRef([]);
  // #6: navigation history so a Back button can return to the previous view/date.
  // navStackRef holds prior {view,baseDate}; navSuppressRef marks a goBack() in
  // flight (so the [view,baseDate] effect doesn't re-push it); lastLocRef tracks
  // the location the effect last saw.
  const navStackRef = useRef([]);
  const navFwdRef = useRef([]);
  const navSuppressRef = useRef(false);
  const lastLocRef = useRef(null);
  const [navCanBack, setNavCanBack] = useState(false);
  const [navCanFwd, setNavCanFwd] = useState(false);
  // #11: iOS standalone PWAs resolve CSS height:100% against a box that can be
  // shorter than the visible area, leaving dead space below the +AM/+PM footer and
  // pushing the last rows out of view. Measuring window.innerHeight and pinning the
  // app root to it makes the flex column fill the real viewport exactly.
  const [vpH, setVpH] = useState(0);
  // Measured Y of the top of the first list row, used to vertically center the change-log banner.
  const [listTopY, setListTopY] = useState(0);
  // Measured Y of the top of the day columns (the date header), so the banner can sit
  // halfway between the very top of the screen and where the day's column begins —
  // higher than listTopY (which starts below the column header).
  const [gridTopY, setGridTopY] = useState(0);
  // When set (2-8), the next booking made from the checkoff/quick-book modal recurs every N weeks.
  const [checkoffRecur, setCheckoffRecur] = useState(null);
  const [recurPickerOpen, setRecurPickerOpen] = useState(false);
  // --- Firebase auth + cloud-sync state (cloud migration) ---
  const [authChecked, setAuthChecked] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [hydrated, setHydrated] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMode, setAuthMode] = useState("signin");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const clientMemoryRef = useRef(clientMemory);
  clientMemoryRef.current = clientMemory;
  const customHolidaysRef = useRef(customHolidays);
  customHolidaysRef.current = customHolidays;
  const historyRef = useRef(history);
  historyRef.current = history;
  const dayNotesRef = useRef(dayNotes);
  dayNotesRef.current = dayNotes;
  const lastSyncRef = useRef(null);
  const saveTimer = useRef(null);

  // Single source of truth for two layout concerns that CSS can't handle on iOS:
  //  1. Phantom scrolling — toggle each list column's overflowY to "auto" ONLY when
  //     its content actually overflows, else "hidden", so a full-but-not-overflowing
  //     column can't rubber-band.
  //  2. Measure the top of the first list column so the change-log banner can sit
  //     exactly halfway between the top of the screen and the first row.
  const syncLayout = useCallback(function() {
    if (isLiveDraggingRef.current) return;
    var scrollers = document.querySelectorAll("[data-slotscroll]");
    for (var i=0;i<scrollers.length;i++) {
      var el = scrollers[i];
      var want = (el.scrollHeight - el.clientHeight) > 2 ? "auto" : "hidden";
      if (el.style.overflowY !== want) el.style.overflowY = want;
    }
    if (scrollers[0]) {
      var y = scrollers[0].getBoundingClientRect().top;
      setListTopY(function(prev){ return Math.abs(prev-y) > 1 ? y : prev; });
    }
    var gridEl = document.querySelector("[data-gridtop]");
    if (gridEl) {
      var gy = gridEl.getBoundingClientRect().top;
      setGridTopY(function(prev){ return Math.abs(prev-gy) > 1 ? gy : prev; });
    }
  }, []);

  useEffect(function() { try { localStorage.setItem("tl_schedules", JSON.stringify(schedules)); } catch(e) {} }, [schedules]);
  useEffect(function() { try { localStorage.setItem("tl_clients", JSON.stringify(clientMemory)); } catch(e) {} }, [clientMemory]);
  // Keep the saved-clients roster complete: any name written to the schedule by ANY
  // path (Shift+Enter groups, book-next, drag, recurring fill-out) gets folded in.
  // Previously only the plain type-a-name path saved to the roster, so father/son
  // links and booked-forward names never showed up under Saved Clients.
  useEffect(function() {
    setClientMemory(function(mem){
      var have = {};
      for (var i=0;i<mem.length;i++) { if(mem[i]&&mem[i].name) have[mem[i].name.toLowerCase()]=true; }
      var additions = []; var seen = {};
      var keys = Object.keys(schedules);
      for (var k=0;k<keys.length;k++) {
        var day = schedules[keys[k]];
        for (var j=0;j<day.length;j++) {
          var s = day[j];
          if (s.name && !s.blocked) {
            var lc = s.name.toLowerCase();
            if (!have[lc] && !seen[lc]) { seen[lc]=true; additions.push({name:s.name,price:s.price||""}); }
          }
        }
      }
      if (additions.length===0) return mem;
      return mem.concat(additions);
    });
  }, [schedules]);
  useEffect(function() { try { localStorage.setItem("tl_holidays", JSON.stringify(customHolidays)); } catch(e) {} }, [customHolidays]);
  useEffect(function() { try { localStorage.setItem("tl_history", JSON.stringify(history)); } catch(e) {} }, [history]);
  useEffect(function() { try { localStorage.setItem("tl_daynotes", JSON.stringify(dayNotes)); } catch(e) {} }, [dayNotes]);

  useEffect(function() {
    var unsub = onAuthStateChanged(fbAuth, function(u) {
      if (u) { setAuthUser({uid:u.uid, email:u.email}); }
      else { setAuthUser(null); setHydrated(false); lastSyncRef.current = null; }
      setAuthChecked(true);
    });
    return function() { try { unsub(); } catch(e) {} };
  }, []);

  useEffect(function() {
    if (!authUser) return;
    var userDoc = doc(fbDb, "users", authUser.uid);
    var first = true;
    var unsub = onSnapshot(userDoc, function(snap) {
      if (!snap.exists()) {
        if (first) {
          first = false;
          var seedSch = migrateSchedules(schedulesRef.current || {});
          var seeded = {schedules:seedSch, clients:clientMemoryRef.current, holidays:customHolidaysRef.current, history:historyRef.current, dayNotes:dayNotesRef.current};
          lastSyncRef.current = JSON.stringify(seeded);
          recentWritesRef.current.push(lastSyncRef.current);
          try { setDoc(userDoc, {schedules:seedSch, clients:seeded.clients, holidays:seeded.holidays, history:seeded.history, dayNotes:seeded.dayNotes, updatedAt:serverTimestamp()}, {merge:true}); } catch(e) {}
          setHydrated(true);
        }
        return;
      }
      var data = snap.data() || {};
      var migrated = migrateSchedules(data.schedules || {});
      var applied = {schedules:migrated, clients:data.clients||[], holidays:data.holidays||[], history:data.history||[], dayNotes:data.dayNotes||{}};
      var json = JSON.stringify(applied);
      if (recentWritesRef.current.indexOf(json) >= 0) { lastSyncRef.current = json; return; }
      if (!first && json === lastSyncRef.current) return;
      first = false;
      lastSyncRef.current = json;
      setSchedules(migrated);
      setClientMemory(applied.clients);
      setCustomHolidays(applied.holidays);
      setHistory(applied.history);
      setDayNotes(applied.dayNotes);
      setHydrated(true);
    }, function(err) { setHydrated(true); });
    return function() { try { unsub(); } catch(e) {} };
  }, [authUser]);

  useEffect(function() {
    if (!hydrated || !authUser) return;
    var payload = {schedules:schedules, clients:clientMemory, holidays:customHolidays, history:history, dayNotes:dayNotes};
    var json = JSON.stringify(payload);
    if (json === lastSyncRef.current) return;
    lastSyncRef.current = json;
    recentWritesRef.current.push(json);
    if (recentWritesRef.current.length > 12) recentWritesRef.current.shift();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    var uid = authUser.uid;
    saveTimer.current = setTimeout(function() {
      try { setDoc(doc(fbDb, "users", uid), {schedules:payload.schedules, clients:payload.clients, holidays:payload.holidays, history:payload.history, dayNotes:payload.dayNotes, updatedAt:serverTimestamp()}, {merge:true}); } catch(e) {}
    }, 600);
  }, [schedules, clientMemory, customHolidays, history, dayNotes, hydrated, authUser]);

  // Stop the whole page from bouncing/scrolling when there is nothing under the
  // list. iOS standalone PWAs ignore CSS overscroll-behavior, so the only thing
  // that actually works is intercepting touchmove and preventing the default
  // unless the finger is genuinely scrolling *inside* a scrollable area that has
  // room left to move. (The live-drag effect manages its own touchmove, so we
  // bow out while a drag is in progress.)
  useEffect(function() {
    var de = document.documentElement;
    var bd = document.body;
    var prev = {
      htmlOver: de.style.overscrollBehaviorY,
      bodyOver: bd.style.overscrollBehaviorY,
      bodyOverflow: bd.style.overflow,
      htmlOverflow: de.style.overflow
    };
    de.style.overscrollBehaviorY = "none";
    bd.style.overscrollBehaviorY = "none";
    de.style.overflow = "hidden";
    bd.style.overflow = "hidden";

    var startY = 0;
    var onTouchStart = function(e) {
      if (e.touches && e.touches[0]) startY = e.touches[0].clientY;
    };
    var onTouchMove = function(e) {
      if (isLiveDraggingRef.current) return;          // the drag effect owns this gesture
      if (!e.touches || e.touches.length > 1) return; // leave pinch/zoom alone
      var t = e.touches[0];
      if (!t) return;
      var dy = t.clientY - startY;                    // >0 dragging finger DOWN (content moves down)
      var tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // Walk up from where the touch began to the nearest vertical scroller.
      var el = e.target;
      var scroller = null;
      while (el && el !== bd && el.nodeType === 1) {
        if (el.scrollHeight - el.clientHeight > 1) {
          var oy = window.getComputedStyle(el).overflowY;
          if (oy === "auto" || oy === "scroll") { scroller = el; break; }
        }
        el = el.parentElement;
      }
      if (!scroller) {
        // Nothing here scrolls — block the bounce entirely.
        if (e.cancelable) e.preventDefault();
        return;
      }
      var atTop = scroller.scrollTop <= 0;
      var atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      // Pulling down at the very top, or up at the very bottom, is overscroll: block it.
      if ((atTop && dy > 0) || (atBottom && dy < 0)) {
        if (e.cancelable) e.preventDefault();
      }
    };
    document.addEventListener("touchstart", onTouchStart, {passive:true});
    document.addEventListener("touchmove", onTouchMove, {passive:false});

    return function() {
      de.style.overscrollBehaviorY = prev.htmlOver;
      bd.style.overscrollBehaviorY = prev.bodyOver;
      bd.style.overflow = prev.bodyOverflow;
      de.style.overflow = prev.htmlOverflow;
      document.removeEventListener("touchstart", onTouchStart, {passive:true});
      document.removeEventListener("touchmove", onTouchMove, {passive:false});
    };
  }, []);

  // When an iPad app shares the screen (Split View / Stage Manager) the system
  // window controls sit over our top-left. Detect "not full width on a touch
  // device" so we can scoot the view tabs clear of them.
  // Also detect phone-width so the header can compact into two rows.
  useEffect(function() {
    var check = function() {
      var touch = (navigator.maxTouchPoints||0) > 0 || ("ontouchstart" in window);
      var sw = (window.screen && window.screen.width) ? window.screen.width : window.innerWidth;
      setIsSplitView(touch && window.innerWidth < (sw - 20));
      setIsPhone(window.innerWidth <= 430);
    };
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return function() {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);

  // First app-open each morning: offer a one-click export. We record the date the
  // moment we SHOW it (in localStorage) so it only appears once per calendar day,
  // even across reopens, and never re-fires after the user exports or dismisses.
  useEffect(function() {
    if (!authUser || !hydrated) return;
    if (isPhone) return; // export prompt is iPad-only
    try {
      var todayKey = toDateKey(new Date());
      var last = null;
      try { last = window.localStorage.getItem("tl_lastExportPrompt"); } catch(e) { last = null; }
      if (last !== todayKey) {
        try { window.localStorage.setItem("tl_lastExportPrompt", todayKey); } catch(e) {}
        setDailyExportPrompt(true);
      }
    } catch(e) {}
  }, [authUser, hydrated]);

  // Safety net: the phone header only exposes Day / Wknd / Month. If the stored view
  // is ever one of the iPad-only views while on a phone, snap to Day so nothing breaks.
  useEffect(function() {
    if (isPhone && (view === "3-Day" || view === "Week")) setView(isPhone?"Day":"3-Day");
  }, [isPhone, view]);

  // Re-run the scroll/banner sync after every render (content can change without a
  // dependency we'd otherwise list), plus on resize/orientation and a couple of
  // post-layout timeouts to catch async font/layout settling.
  useEffect(function() { syncLayout(); });

  useEffect(function() {
    var t1 = setTimeout(syncLayout, 80);
    var t2 = setTimeout(syncLayout, 260);
    window.addEventListener("resize", syncLayout);
    window.addEventListener("orientationchange", syncLayout);
    return function() {
      clearTimeout(t1); clearTimeout(t2);
      window.removeEventListener("resize", syncLayout);
      window.removeEventListener("orientationchange", syncLayout);
    };
  }, [syncLayout]);

  useEffect(function() {
    if (checkoffModal && !checkoffCalMonth) {
      var startKey = checkoffModal.nextDateKey || toDateKey(addWeeks(parseDateKey(checkoffModal.dateKey), 2));
      var d = parseDateKey(startKey);
      setCheckoffCalMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    }
    if (!checkoffModal) { setCheckoffRecur(null); setRecurPickerOpen(false); }
  }, [checkoffModal]);

  useEffect(function() {
    var handler = function(e) {
      if ((e.ctrlKey||e.metaKey) && e.key==="z" && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if ((e.ctrlKey||e.metaKey) && (e.key==="y" || (e.key==="z" && e.shiftKey))) { e.preventDefault(); handleRedo(); }
      // Left/Right arrows page through days (months in Month view), mirroring the
      // on-screen ‹ / › buttons. Ignored while a field is focused — there the arrows
      // move the text cursor / hop slot rows, and Shift+Arrow nudges the time.
      if ((e.key==="ArrowLeft"||e.key==="ArrowRight") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (editingRef.current) return;
        var ae = (typeof document!=="undefined") ? document.activeElement : null;
        // Only bail when focus sits in an EDITABLE field (live text entry). After
        // adding/deleting someone, focus can linger on a now-readOnly slot input;
        // that used to swallow the arrows until the user changed views. A readOnly
        // input has no cursor to move, so let the arrows page the day.
        if (ae && (ae.tagName==="INPUT" || ae.tagName==="TEXTAREA") && !ae.readOnly && !ae.disabled) return;
        e.preventDefault();
        var back = e.key==="ArrowLeft";
        if (view==="Month") { var dm=new Date(baseDate); dm.setMonth(dm.getMonth()+(back?-1:1)); setBaseDate(dm); }
        else { var step = e.shiftKey ? 7 : 1; setBaseDate(function(prev){ return addDays(prev, back?-step:step); }); }
      }
    };
    window.addEventListener("keydown", handler);
    return function() { window.removeEventListener("keydown", handler); };
  });

  // #6: record view/date navigation so the Back button can return to where we were.
  // Each time the location changes we push the PREVIOUS one. A goBack() sets
  // navSuppressRef so the resulting change isn't itself recorded.
  useEffect(function() {
    var loc = {view:view, baseDate:new Date(baseDate)};
    if (navSuppressRef.current) {
      navSuppressRef.current = false;
      lastLocRef.current = loc;
      return;
    }
    var prev = lastLocRef.current;
    lastLocRef.current = loc;
    if (prev && (prev.view!==loc.view || (+prev.baseDate)!==(+loc.baseDate))) {
      navStackRef.current.push(prev);
      if (navStackRef.current.length>50) navStackRef.current.shift();
      if (!navCanBack) setNavCanBack(true);
      // A fresh navigation (not a Back/Forward) clears the forward history.
      if (navFwdRef.current.length) { navFwdRef.current = []; setNavCanFwd(false); }
    }
  }, [view, baseDate]);

  const goBack = function() {
    if (navStackRef.current.length===0) return;
    var dest = navStackRef.current.pop();
    if (navStackRef.current.length===0) setNavCanBack(false);
    var sameView = dest.view===view;
    var sameDate = (+dest.baseDate)===(+baseDate);
    if (sameView && sameDate) return;
    // Remember where we are so Forward can return here.
    navFwdRef.current.push({view:view, baseDate:new Date(baseDate)});
    if (!navCanFwd) setNavCanFwd(true);
    navSuppressRef.current = true;
    if (!sameView) setView(dest.view);
    if (!sameDate) setBaseDate(dest.baseDate);
  };

  const goFwd = function() {
    if (navFwdRef.current.length===0) return;
    var dest = navFwdRef.current.pop();
    if (navFwdRef.current.length===0) setNavCanFwd(false);
    var sameView = dest.view===view;
    var sameDate = (+dest.baseDate)===(+baseDate);
    if (sameView && sameDate) return;
    // Pushing current onto the back stack so Back returns here.
    navStackRef.current.push({view:view, baseDate:new Date(baseDate)});
    if (!navCanBack) setNavCanBack(true);
    navSuppressRef.current = true;
    if (!sameView) setView(dest.view);
    if (!sameDate) setBaseDate(dest.baseDate);
  };

  useEffect(function() {
    var apply = function(){ setVpH(window.innerHeight); };
    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return function(){ window.removeEventListener("resize", apply); window.removeEventListener("orientationchange", apply); };
  }, []);

  const showBanner = function(entry, overrideType) {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    var displayEntry = overrideType ? {...entry, type:overrideType} : entry;
    setBannerSwipeY(0);
    setBanner(displayEntry);
    bannerTimer.current = setTimeout(function(){ setBanner(null); }, 10000);
  };
  // Dismiss helper shared by the swipe gesture and any programmatic close.
  const dismissBanner = function() {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBannerSwipeY(0);
    setBanner(null);
  };

  const getHolidayForDate = function(dateKey) {
    var d = parseDateKey(dateKey);
    var year = d.getFullYear();
    var usHolidays = getUSHolidays(year);
    if (usHolidays[dateKey]) return usHolidays[dateKey];
    for (var hi = 0; hi < customHolidays.length; hi++) {
      var h = customHolidays[hi];
      if (h.dateKey === dateKey) return h.name;
      if (h.yearly) {
        var hd = parseDateKey(h.dateKey);
        if (hd.getMonth() === d.getMonth() && hd.getDate() === d.getDate()) return h.name;
      }
    }
    return null;
  };

  const getDayCount = function() { return view==="Day"?1:view==="3-Day"?3:view==="Wknd"?2:7; };
  const getDates = function() {
    if (view==="Week") return Array.from({length:7},function(_,i){ return addDays(baseDate,i); });
    if (view==="Wknd") return [baseDate, addDays(baseDate,1)];
    if (view==="Month") return [];
    return Array.from({length:getDayCount()},function(_,i){ return addDays(baseDate,i); });
  };
  const getMonthDays = function() {
    var year = baseDate.getFullYear(), month = baseDate.getMonth();
    var first = new Date(year, month, 1);
    var firstDay = first.getDay()===0?6:first.getDay()-1; // Monday-based leading count
    var dim = new Date(year, month+1, 0).getDate();
    var days = [];
    // Trailing days of the previous month fill the leading blanks.
    for (var i=firstDay; i>0; i--) days.push(new Date(year, month, 1-i));
    // This month.
    for (var j=1; j<=dim; j++) days.push(new Date(year, month, j));
    // Leading days of the next month fill out the final week.
    var rem = days.length % 7;
    if (rem !== 0) { for (var k=1; k<=7-rem; k++) days.push(new Date(year, month, dim+k)); }
    return days;
  };

  // Is a given date currently on screen in the active view? (Month = same month.)
  const isDateKeyVisible = function(dateKey) {
    if (!dateKey) return true;
    if (view==="Month") {
      var d = parseDateKey(dateKey);
      return d.getFullYear()===baseDate.getFullYear() && d.getMonth()===baseDate.getMonth();
    }
    var vis = getDates().map(function(dt){ return toDateKey(dt); });
    return vis.indexOf(dateKey) >= 0;
  };
  // Jump so an affected day is visible (becomes the first column / its month) only
  // if it isn't already showing — used after undo/redo so the change is in view.
  const goToDateKeyIfHidden = function(dateKey) {
    if (!dateKey) return;
    if (isDateKeyVisible(dateKey)) return;
    setBaseDate(parseDateKey(dateKey));
  };

  const getSlots = useCallback(function(dateKey) {
    var custom = schedulesRef.current[dateKey];
    if (!custom) return DEFAULT_TIMES.map(function(t){ return {time:t,name:"",price:"",done:false,recurWeeks:null,isCustom:false}; });
    return custom;
  }, []);

  const setSlots = function(dateKey, slots) { setSchedules(function(prev){ return {...prev,[dateKey]:slots}; }); };

  // The day/3-day/week views are anchored on today — but once today's last
  // person is checked off, the anchor rolls forward to tomorrow.
  const getAnchorStart = function() {
    var today = new Date();
    if (isDayComplete(getSlots(toDateKey(today)))) return addDays(today, 1);
    return today;
  };

  // Live roll-forward: the moment today's last person gets checked off (while you're
  // sitting on today in a day/3-day/week view), advance the first column to tomorrow.
  // Only fires on the incomplete→complete transition, so you can still arrow back to
  // review a finished day without being bounced forward again.
  const todayCompleteRef = useRef(false);
  useEffect(function() {
    var today = new Date();
    var complete = isDayComplete(getSlots(toDateKey(today)));
    var was = todayCompleteRef.current;
    todayCompleteRef.current = complete;
    if (view==="Month" || view==="Wknd") return;
    if (complete && !was && toDateKey(baseDate)===toDateKey(today)) {
      setBaseDate(addDays(today, 1));
    }
  }, [schedules, view, baseDate]);

  const addHistoryEntry = function(entry) {
    var full = {...entry, timestamp:new Date().toLocaleTimeString(), id:Date.now()+Math.random()};
    setHistory(function(prev){ return [full,...prev].slice(0,200); });
    showBanner(full, entry.bannerType);
    if(entry.type==="added"||entry.type==="slot_added"||entry.type==="checkoff") playSound("lock");
    else if(entry.type==="removed"||entry.type==="slot_removed") playSound("delete");
    else playSound("tap");
  };

  // #11: flash a just-emptied slot red for 8 seconds so a cancel is visible no matter
  // how it happened (swipe-delete, name cleared by editing, or undone).
  var flashRemoved = function(dateKey, idx) {
    var fk = dateKey + "-" + idx;
    setRecentlyRemoved(function(r){ var n={...r}; n[fk]=true; return n; });
    setTimeout(function(){ setRecentlyRemoved(function(r){ var n={...r}; delete n[fk]; return n; }); }, 8000);
  };

  const pushUndo = function(snapshot) {
    setUndoStack(function(prev){ return [...prev, snapshot].slice(-50); });
    setRedoStack([]);
  };

  var findSlotIdxByTime = function(slots, time) {
    for (var i=0;i<slots.length;i++) { if (slots[i].time===time) return i; }
    return -1;
  };

  var performEntryUndo = function(entry, override) {
    var dk = entry.dateKey;
    if (!dk || !entry.time) { showBanner({type:"undo",name:"that change",dateKey:null,time:null}); return; }
    var slots = [...getSlots(dk)];
    var idx = findSlotIdxByTime(slots, entry.time);
    if (idx < 0) { showBanner({type:"undo",name:"that change",dateKey:null,time:null}); return; }
    var cur = slots[idx];
    goToDateKeyIfHidden(dk);
    var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};

    if (entry.type==="added"||entry.type==="checkoff"||entry.type==="rescheduled") {
      // expected: this slot holds entry.name. If someone else is here now, conflict.
      if (!override && cur.name && entry.name && cur.name.toLowerCase()!==entry.name.toLowerCase()) {
        setEntryUndoConflict({entry, current:cur, dateKey:dk}); return;
      }
      pushUndo(snapshot);
      slots[idx] = {...cur,name:"",price:"",done:false,recurWeeks:null,isException:false,blocked:false,blockLabel:"",note:""};
      setSlots(dk, slots);
      flashRemoved(dk, idx);
      showBanner({type:"undo",name:entry.name,time:entry.time,dateKey:dk});
    } else if (entry.type==="removed"||entry.type==="slot_removed") {
      // expected: slot is empty now. Restore the name. If occupied by someone else, conflict.
      if (!override && cur.name && entry.name && cur.name.toLowerCase()!==entry.name.toLowerCase()) {
        setEntryUndoConflict({entry, current:cur, dateKey:dk}); return;
      }
      pushUndo(snapshot);
      slots[idx] = {...cur,name:entry.name||"",price:entry.price||cur.price||"",done:false};
      setSlots(dk, slots);
      showBanner({type:"undo",name:entry.name,time:entry.time,dateKey:dk});
    } else if (entry.type==="edited") {
      if (!override && cur.name && entry.name && cur.name.toLowerCase()!==entry.name.toLowerCase()) {
        setEntryUndoConflict({entry, current:cur, dateKey:dk}); return;
      }
      pushUndo(snapshot);
      slots[idx] = {...cur,name:entry.prevName||""};
      setSlots(dk, slots);
      showBanner({type:"undo",name:entry.prevName||entry.name,time:entry.time,dateKey:dk});
    } else if (entry.type==="blocked") {
      pushUndo(snapshot);
      slots[idx] = {...cur,blocked:false,blockLabel:""};
      setSlots(dk, slots);
      showBanner({type:"undo",name:entry.name,time:entry.time,dateKey:dk});
    } else if (entry.type==="unblocked") {
      pushUndo(snapshot);
      slots[idx] = {...cur,blocked:true,blockLabel:entry.name||"Lunch",name:"",done:false};
      setSlots(dk, slots);
      showBanner({type:"undo",name:entry.name,time:entry.time,dateKey:dk});
    } else if (entry.type==="recurring_set") {
      pushUndo(snapshot);
      slots[idx] = {...cur,recurWeeks:null};
      setSlots(dk, slots);
      showBanner({type:"undo",name:entry.name,time:entry.time,dateKey:dk});
    } else {
      showBanner({type:"undo",name:"that change",dateKey:null,time:null});
    }
  };

  var handleEntryUndo = function(entry) { performEntryUndo(entry, false); };

  const getDayTimeRange = function(dateKey) {
    var slots = getSlots(dateKey);
    var booked = slots.filter(function(s){ return s.name && !s.blocked; });
    if (booked.length === 0) return null;
    var sorted = booked.slice().sort(function(a,b){ return parseTime(a.time)-parseTime(b.time); });
    if (sorted.length === 1) return sorted[0].time;
    return sorted[0].time + "–" + sorted[sorted.length-1].time;
  };

  const handleUndo = function() {
    if (undoStack.length === 0) return;
    var snapshot = undoStack[undoStack.length-1];
    var diff = describeScheduleDiff(schedulesRef.current, snapshot.schedules);
    setRedoStack(function(prev){ return [...prev, {schedules: JSON.parse(JSON.stringify(schedulesRef.current))}]; });
    setUndoStack(function(prev){ return prev.slice(0,-1); });
    setSchedules(snapshot.schedules);
    if (diff && diff.dateKey) goToDateKeyIfHidden(diff.dateKey);
    showBanner({type:"undo", name:(diff&&diff.name)?diff.name:"last change", time:(diff&&diff.hasName)?diff.time:null, dateKey:(diff&&diff.dateKey)?diff.dateKey:null});
  };

  const handleRedo = function() {
    if (redoStack.length === 0) return;
    var snapshot = redoStack[redoStack.length-1];
    var diff = describeScheduleDiff(schedulesRef.current, snapshot.schedules);
    setUndoStack(function(prev){ return [...prev, {schedules: JSON.parse(JSON.stringify(schedulesRef.current))}]; });
    setRedoStack(function(prev){ return prev.slice(0,-1); });
    setSchedules(snapshot.schedules);
    if (diff && diff.dateKey) goToDateKeyIfHidden(diff.dateKey);
    showBanner({type:"redo", name:(diff&&diff.name)?diff.name:"last change", time:(diff&&diff.hasName)?diff.time:null, dateKey:(diff&&diff.dateKey)?diff.dateKey:null});
  };

  const snapshotAndChange = function(changeFn, historyEntry) {
    var snapshot = {schedules: JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    changeFn();
    if (historyEntry) addHistoryEntry(historyEntry);
  };

  const startEdit = function(dateKey, idx, defer) {
    var slot = getSlots(dateKey)[idx];
    var occupied = !!slot.name;
    // If this slot was just emptied, drop its "recently removed" pink the instant
    // an edit starts. Otherwise the pink wins the background and the user gets no
    // visual confirmation the field is live, so they keep tapping the already-
    // focused input — which is what summons the iOS AutoFill callout.
    var rmKey = dateKey + "-" + idx;
    setRecentlyRemoved(function(r){ if(!r[rmKey]) return r; var n={...r}; delete n[rmKey]; return n; });
    editingRef.current = {dateKey,idx};
    setEditingCell({dateKey,idx});
    setEditValues({name:slot.name||"",price:slot.price||""});
    setEditingOccupied(occupied);
    setSwipedSlot(null);
    setPencilArmed(false);
    if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current=null; }
    if (defer) {
      // Hold the edit chrome back briefly so a fast double/triple tap doesn't flash it.
      setEditChromeReady(false);
      settleTimer.current = setTimeout(function(){ settleTimer.current=null; setEditChromeReady(true); }, 140);
    } else {
      setEditChromeReady(true);
    }
    setTimeout(function(){
      var inputs = document.querySelectorAll("[data-rowkey='" + dateKey + "-" + idx + "']");
      if (inputs && inputs[0]) { inputs[0].focus(); }
    }, 50);
  };

  const doCommit = useCallback(function(dateKey, idx, values) {
    var slots = [...getSlots(dateKey)];
    var prev = slots[idx];
    var rawName = stripLeadingNumbers((values.name||"").trim());
    var newPrice = (values.price||"").trim();
    var asLunch = isLunchName(rawName);
    var asBlock = isBlockName(rawName);
    var newName = (asLunch||asBlock) ? "" : capitalizeFirst(rawName);
    // Removing the name removes the price along with it (a price never outlives
    // its person). Clearing only the price, though, leaves the name in place.
    if (!newName) newPrice = "";
    // 6C: changing the name or price of an already-recurring person asks whether to
    // apply the change to just this appointment or the whole future series. (Clearing
    // the name entirely is treated as a normal one-off removal, not a series edit;
    // use "Remove recurring" to clear an entire series.)
    if (prev.recurWeeks && prev.name && newName && (newName!==prev.name || newPrice!==prev.price)) {
      editingRef.current = null; setEditingCell(null); setEditingOccupied(false);
      setPencilArmed(false); setEditChromeReady(true);
      setSeriesEditModal({field:"nameprice", dateKey:dateKey, idx:idx, oldName:prev.name, newName:newName, newPrice:newPrice, time:prev.time});
      return true;
    }
    if (asLunch || asBlock) {
      // Typing "lunch" / "block" turns the slot into a block (no client memory).
      // "lunch" labels it Lunch; "block" labels it Blocked. Single slot either way here.
      var blkLabel = asBlock ? "Blocked" : "Lunch";
      if (!prev.blocked) {
        var snapL = {schedules: JSON.parse(JSON.stringify(schedulesRef.current))};
        pushUndo(snapL);
        slots[idx] = {...prev,name:"",price:"",done:false,recurWeeks:null,isException:false,blocked:true,blockLabel:blkLabel};
        setSlots(dateKey,slots);
        addHistoryEntry({type:"blocked",time:prev.time,name:blkLabel,dateKey});
      }
      editingRef.current = null;
      setEditingCell(null);
      setEditingOccupied(false);
      setPencilArmed(false); setEditChromeReady(true);
      return;
    }
    if (newName!==prev.name || newPrice!==prev.price || prev.availStatus) {
      var snapshot = {schedules: JSON.parse(JSON.stringify(schedulesRef.current))};
      pushUndo(snapshot);
      slots[idx] = {...prev,name:newName,price:newPrice,availStatus:null,pending:false};
      setSlots(dateKey,slots);
      if (prev.name&&!newName) { addHistoryEntry({type:"removed",time:prev.time,name:prev.name,dateKey}); flashRemoved(dateKey,idx); }
      else if (!prev.name&&newName) {
        addHistoryEntry({type:"added",time:slots[idx].time,name:newName,price:newPrice,dateKey});
        setClientMemory(function(mem) {
          var existing = mem.findIndex(function(c){ return c.name.toLowerCase()===newName.toLowerCase(); });
          if (existing>=0) { var updated=[...mem]; updated[existing]={...updated[existing],name:newName,price:newPrice||mem[existing].price}; return updated; }
          return [...mem,{name:newName,price:newPrice}];
        });
      } else if (prev.name&&newName) addHistoryEntry({type:"edited",time:slots[idx].time,name:newName,prevName:prev.name,dateKey});
    }
    editingRef.current = null;
    setEditingCell(null);
    setEditingOccupied(false);
    setPencilArmed(false); setEditChromeReady(true);
  },[getSlots]);

  // Save a name as "penciled in" (tentative) — offered but not yet confirmed.
  const commitPenciled = function(dateKey, idx) {
    var slots = [...getSlots(dateKey)];
    var prev = slots[idx];
    var cv = editValuesRef.current;
    var rawName = stripLeadingNumbers((cv.name||"").trim());
    if (!rawName && prev.name) rawName = prev.name; // blur may have committed already
    if (isLunchName(rawName) || isBlockName(rawName) || !rawName) { doCommit(dateKey, idx, cv); return; }
    var newName = capitalizeFirst(rawName);
    var newPrice = (cv.price||"").trim() || prev.price || "";
    var snapshot = {schedules: JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    slots[idx] = {...prev,name:newName,price:newPrice,pending:true,done:false};
    setSlots(dateKey,slots);
    if (!prev.name) {
      setClientMemory(function(mem) {
        var existing = mem.findIndex(function(c){ return c.name.toLowerCase()===newName.toLowerCase(); });
        if (existing>=0) { var u=[...mem]; u[existing]={...u[existing],name:newName,price:newPrice||mem[existing].price}; return u; }
        return [...mem,{name:newName,price:newPrice}];
      });
    }
    addHistoryEntry({type:"added",time:prev.time,name:newName,price:newPrice,dateKey,bannerType:"penciled"});
    editingRef.current = null;
    setEditingCell(null);
    setEditingOccupied(false);
    setPencilArmed(false); setEditChromeReady(true);
  };

  // One-tap confirm: turn a penciled-in slot into a locked-in appointment.
  const lockInSlot = function(dateKey, idx) {
    var slots = [...getSlots(dateKey)];
    var prev = slots[idx];
    if (!prev.name || !prev.pending) return;
    // A penciled occurrence of a recurring series: ask whether to lock just this one
    // or every future penciled occurrence at once.
    if (prev.recurWeeks != null) {
      setSeriesEditModal({field:"lock", dateKey:dateKey, idx:idx, name:prev.name, time:prev.time, price:prev.price, recurWeeks:prev.recurWeeks});
      return;
    }
    var snapshot = {schedules: JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    slots[idx] = {...prev,pending:false};
    setSlots(dateKey,slots);
    addHistoryEntry({type:"added",time:prev.time,name:prev.name,price:prev.price,dateKey});
  };

  const openTimeEdit = function(dateKey, idx) {
    var slot = getSlots(dateKey)[idx];
    setTimeEditMinutes(timeToAbsMinutes(slot.time));
    setTimeEditModal({dateKey, idx, original:slot.time});
  };

  const commitTimeEdit = function() {
    if (!timeEditModal) return;
    var dateKey = timeEditModal.dateKey; var idx = timeEditModal.idx;
    var newTime = absMinutesToTime(timeEditMinutes);
    var slots = [...getSlots(dateKey)];
    var prev = slots[idx];
    if (newTime === prev.time) { setTimeEditModal(null); return; }
    // 6C: nudging the time of an already-recurring person asks whether to move just
    // this appointment or the whole future series.
    if (prev.recurWeeks && prev.name) {
      setTimeEditModal(null);
      setSeriesEditModal({field:"time", dateKey:dateKey, idx:idx, oldTime:prev.time, newTime:newTime, name:prev.name});
      return;
    }
    // Block collisions with another existing slot at that exact time.
    if (slots.some(function(s,i){ return i!==idx && s.time===newTime; })) { setTimeEditModal(null); return; }
    var snapshot = {schedules: JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    var isStillDefault = DEFAULT_TIMES.indexOf(newTime) >= 0;
    // Editing the minutes of a slot does NOT change whether it's a default slot
    // or a custom one. Only genuinely custom-added slots (isCustom===true, or
    // legacy off-grid slots with no flag) keep the custom time styling.
    var wasCustom = prev.isCustom===true || (prev.isCustom===undefined && DEFAULT_TIMES.indexOf(prev.time) === -1);
    // For default (non-custom) slots, remember the original default time the first
    // time it's nudged, so the render layer can color it cobalt (earlier) or purple (later).
    var baseTime = prev.defaultBaseTime || (!wasCustom ? prev.time : null);
    slots[idx] = {...prev,time:newTime,isCustom:wasCustom,customTime: wasCustom && !isStillDefault,defaultBaseTime:(!wasCustom?baseTime:prev.defaultBaseTime)};
    slots.sort(function(a,b){ return timeToAbsMinutes(a.time)-timeToAbsMinutes(b.time); });
    setSlots(dateKey,slots);
    setTimeEditModal(null);
  };

  const handleBlur = useCallback(function(e) {
    var related = e.relatedTarget;
    if (related && related.dataset && related.dataset.rowkey===((editingRef.current&&editingRef.current.dateKey)+"-"+(editingRef.current&&editingRef.current.idx))) return;
    setTimeout(function(){
      if (!editingRef.current) return;
      var er = editingRef.current;
      // Tap-away commits exactly like Enter: if the pencil is armed and a name was
      // typed, pencil them in; otherwise do the normal commit.
      if (pencilArmedRef.current && stripLeadingNumbers((editValuesRef.current.name||"").trim())) { commitPenciled(er.dateKey,er.idx); }
      else { doCommit(er.dateKey,er.idx,editValuesRef.current); }
    },100);
  },[doCommit]);

  // Shift+Arrow while a slot's name field is focused nudges THAT slot's time by 5
  // minutes (Up = earlier, Down = later) without leaving the edit: the keyboard
  // stays up and the half-typed name is preserved. Plain Up/Down still hops rows.
  const nudgeEditingSlotTime = function(dateKey, idx, delta, doSnapshot) {
    var slots = [...getSlots(dateKey)];
    var prev = slots[idx];
    if (!prev || prev.blocked) return;
    var newTime = absMinutesToTime(timeToAbsMinutes(prev.time) + delta);
    if (newTime === prev.time) return;
    // Don't let a nudge land exactly on another slot's time (fails silently, no popup).
    var clash = false; var ci;
    for (ci=0; ci<slots.length; ci++) { if (ci!==idx && slots[ci].time===newTime) { clash=true; break; } }
    if (clash) return;
    // One undo step per discrete press; holding the key (auto-repeat) keeps adjusting
    // but doesn't flood the stack.
    if (doSnapshot) pushUndo({schedules:JSON.parse(JSON.stringify(schedulesRef.current))});
    var isStillDefault = DEFAULT_TIMES.indexOf(newTime) >= 0;
    var wasCustom = prev.isCustom===true || (prev.isCustom===undefined && DEFAULT_TIMES.indexOf(prev.time) === -1);
    var baseTime = prev.defaultBaseTime || (!wasCustom ? prev.time : null);
    var moved = {...prev,time:newTime,isCustom:wasCustom,customTime: wasCustom && !isStillDefault,defaultBaseTime:(!wasCustom?baseTime:prev.defaultBaseTime)};
    // A recurring occurrence nudged this way moves only itself (marked an exception),
    // never the whole series — popping the series modal would interrupt typing.
    if (prev.recurWeeks && prev.name) moved.isException = true;
    slots[idx] = moved;
    slots.sort(function(a,b){ return timeToAbsMinutes(a.time)-timeToAbsMinutes(b.time); });
    var newIdx = -1; var fi;
    for (fi=0; fi<slots.length; fi++) { if (slots[fi].time===newTime) { newIdx=fi; break; } }
    setSlots(dateKey,slots);
    // If the row changed position, re-aim the live edit at its new index and refocus
    // so typing continues seamlessly. A 5-min nudge almost never crosses a neighbor,
    // so normally the index is unchanged and nothing remounts.
    if (newIdx>=0 && newIdx!==idx) {
      editingRef.current = {dateKey:dateKey, idx:newIdx};
      setEditingCell({dateKey:dateKey, idx:newIdx});
      setTimeout(function(){
        var el = document.querySelectorAll("[data-rowkey='" + dateKey + "-" + newIdx + "']");
        if (el && el[0]) el[0].focus();
      }, 30);
    }
  };

  const handleKeyDown = function(e, dateKey, idx) {
    if (e.key==="Tab") return;
    if (e.key==="Enter" && e.shiftKey) {
      e.preventDefault();
      var cv = editValuesRef.current;
      var slots = [...getSlots(dateKey)];
      var curSlot = slots[idx];
      var newName = capitalizeFirst(stripLeadingNumbers((cv.name||"").trim()));
      var newPrice = (cv.price||"").trim();
      var nextIdx = idx+1;
      var nextSlot = nextIdx<slots.length ? slots[nextIdx] : null;
      // If this slot is already linked to the one directly below, Shift+Enter UNLINKS
      // that pair instead of linking. Splits the contiguous group at this boundary:
      // everything from here up keeps the old group, everything below gets its own
      // (and any side left with a single member is ungrouped entirely).
      var linkedBelow = !!(curSlot.groupId && nextSlot && nextSlot.groupId===curSlot.groupId);
      if (linkedBelow) {
        var gidU = curSlot.groupId;
        var runStart = idx; while (runStart>0 && slots[runStart-1].groupId===gidU) runStart--;
        var runEnd = idx; while (runEnd<slots.length-1 && slots[runEnd+1].groupId===gidU) runEnd++;
        var snapU = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
        pushUndo(snapU);
        // commit any in-progress name edit on this slot before unlinking
        if (newName) slots[idx] = {...slots[idx],name:newName,price:newPrice};
        var upperCount = idx - runStart + 1;
        var lowerCount = runEnd - (idx+1) + 1;
        var lowerGid = lowerCount>=2 ? newGroupId() : null;
        var ui;
        for (ui=runStart; ui<=runEnd; ui++) {
          if (ui<=idx) { if (upperCount<2) slots[ui]={...slots[ui],groupId:null}; }
          else { slots[ui]={...slots[ui],groupId:lowerGid}; }
        }
        setSlots(dateKey,slots);
        editingRef.current=null; setEditingCell(null); setEditingOccupied(false);
        setPencilArmed(false); setEditChromeReady(true);
        return;
      }
      if (!newName) return;
      // #16: typing "lunch" + Shift+Enter doesn't book a person named Lunch — it
      // blocks this slot AND the one directly below as a single linked Lunch break.
      // (If the slot below is occupied/blocked, just block this one.)
      if (isLunchName(newName)) {
        var snapL = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
        pushUndo(snapL);
        var canPairL = nextIdx<slots.length && !slots[nextIdx].name && !slots[nextIdx].blocked;
        var gidL = canPairL ? (curSlot.groupId || newGroupId()) : (curSlot.groupId || null);
        slots[idx] = {...curSlot,name:"",price:"",done:false,recurWeeks:null,isException:false,blocked:true,blockLabel:"Lunch",groupId:gidL};
        if (canPairL) slots[nextIdx] = {...slots[nextIdx],name:"",price:"",done:false,recurWeeks:null,isException:false,blocked:true,blockLabel:"Lunch",groupId:gidL};
        setSlots(dateKey,slots);
        addHistoryEntry({type:"blocked",time:curSlot.time,name:"Lunch",dateKey});
        editingRef.current=null; setEditingCell(null); setEditingOccupied(false);
        setPencilArmed(false); setEditChromeReady(true);
        return;
      }
      // Typing "block" + Shift+Enter blocks this slot AND the one directly below as a
      // single linked Blocked pair (mirrors the lunch mechanic). If the slot below is
      // occupied/blocked, just block this one.
      if (isBlockName(newName)) {
        var snapB = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
        pushUndo(snapB);
        var canPairB = nextIdx<slots.length && !slots[nextIdx].name && !slots[nextIdx].blocked;
        var gidB = canPairB ? (curSlot.groupId || newGroupId()) : (curSlot.groupId || null);
        slots[idx] = {...curSlot,name:"",price:"",done:false,recurWeeks:null,isException:false,blocked:true,blockLabel:"Blocked",groupId:gidB};
        if (canPairB) slots[nextIdx] = {...slots[nextIdx],name:"",price:"",done:false,recurWeeks:null,isException:false,blocked:true,blockLabel:"Blocked",groupId:gidB};
        setSlots(dateKey,slots);
        addHistoryEntry({type:"blocked",time:curSlot.time,name:"Blocked",dateKey});
        editingRef.current=null; setEditingCell(null); setEditingOccupied(false);
        setPencilArmed(false); setEditChromeReady(true);
        return;
      }
      var hasNext = nextIdx<slots.length && !slots[nextIdx].blocked;
      var nextEmpty = hasNext && !slots[nextIdx].name;
      var nextFilled = hasNext && !!slots[nextIdx].name;
      var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
      pushUndo(snapshot);
      if (nextEmpty) {
        // Empty slot below: carry this name down and link the two into a group.
        // NOTE: only ever reuse THIS slot's own group — never the slot above's, or a
        // fresh entry sitting under an existing pair would get swallowed into it.
        var gid = curSlot.groupId || newGroupId();
        slots[idx] = {...curSlot,name:newName,price:newPrice,groupId:gid};
        slots[nextIdx] = {...slots[nextIdx],name:newName,price:newPrice,groupId:gid};
        setSlots(dateKey,slots);
        addHistoryEntry({type:"added",time:slots[idx].time,name:newName,price:newPrice,dateKey});
        editingRef.current=null; setEditingCell(null); setEditingOccupied(false);
        setTimeout(function(){ startEdit(dateKey,nextIdx); },80);
      } else if (nextFilled) {
        // Slot below already has someone written in it (re-editing an existing
        // list): link the two appointments into one group without overwriting
        // the name already below, then keep chaining down. (Links downward only.)
        var gid2 = curSlot.groupId || slots[nextIdx].groupId || newGroupId();
        slots[idx] = {...curSlot,name:newName,price:newPrice,groupId:gid2};
        slots[nextIdx] = {...slots[nextIdx],groupId:gid2};
        setSlots(dateKey,slots);
        addHistoryEntry({type:"added",time:slots[idx].time,name:newName,price:newPrice,dateKey});
        editingRef.current=null; setEditingCell(null); setEditingOccupied(false);
        setTimeout(function(){ startEdit(dateKey,nextIdx); },80);
      } else {
        // No usable slot directly below — just save this one, no link formed.
        slots[idx] = {...curSlot,name:newName,price:newPrice};
        setSlots(dateKey,slots);
        addHistoryEntry({type:"added",time:slots[idx].time,name:newName,price:newPrice,dateKey});
        editingRef.current=null; setEditingCell(null); setEditingOccupied(false);
      }
    } else if (e.key==="Enter") {
      e.preventDefault();
      // If the pencil was armed before a name was typed, Enter pencils them in.
      var cvE = editValuesRef.current;
      if (pencilArmedRef.current && stripLeadingNumbers((cvE.name||"").trim())) {
        commitPenciled(dateKey,idx);
      } else {
        doCommit(dateKey,idx,editValuesRef.current);
      }
    } else if (e.key==="ArrowDown") {
      e.preventDefault();
      if (e.shiftKey) { nudgeEditingSlotTime(dateKey, idx, 5, !e.repeat); return; }
      var curVals = editValuesRef.current;
      var curDateKey = dateKey; var curIdx = idx;
      if (doCommit(curDateKey,curIdx,curVals)) return;
      var s = getSlots(curDateKey);
      if (curIdx < s.length-1) {
        setTimeout(function(){ startEdit(curDateKey, curIdx+1); }, 80);
      }
    } else if (e.key==="ArrowUp") {
      e.preventDefault();
      if (e.shiftKey) { nudgeEditingSlotTime(dateKey, idx, -5, !e.repeat); return; }
      var curVals2 = editValuesRef.current;
      var curDateKey2 = dateKey; var curIdx2 = idx;
      if (doCommit(curDateKey2,curIdx2,curVals2)) return;
      if (curIdx2 > 0) {
        setTimeout(function(){ startEdit(curDateKey2, curIdx2-1); }, 80);
      }
    } else if (e.key==="Escape") {
      editingRef.current=null; setEditingCell(null); setEditingOccupied(false);
      setPencilArmed(false); setEditChromeReady(true);
    }
  };

  const getNextDateKey = function(fromDateKey, weeks) {
    return formatDateKey(addWeeks(parseDateKey(fromDateKey), weeks));
  };

  const isSlotTaken = function(dateKey, time, excludeName) {
    var slots = getSlots(dateKey);
    return slots.some(function(s){ return s.time===time&&s.name&&(!excludeName||s.name.toLowerCase()!==excludeName.toLowerCase()); });
  };

  const startCheckoffLongPress = function() {};
  const cancelCheckoffLongPress = function() {};

  // Tapping the circle simply toggles done <-> not done (no long-press behavior).
  const handleCheckoff = function(dateKey, idx) {
    var slots = getSlots(dateKey);
    var slot = slots[idx];
    if (!slot.name && !slot.blocked) return;
    var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    var newDone = !slot.done;
    // Decide every row that should flip together. Two appointments check off as one
    // when they're either (a) explicitly linked (shared groupId) or (b) an unbroken
    // run of the same name in adjacent rows — a back-to-back booking for one client,
    // which is what "all members of the group" means visually even if they were never
    // formally linked. Any empty/blocked/different-name row breaks the adjacent run.
    var flip = {};
    flip[idx] = true;
    var gid = slot.groupId;
    var nm = (slot.name||"").toLowerCase();
    var gi;
    for (gi=0; gi<slots.length; gi++) {
      if (gid && slots[gi].groupId===gid && (slots[gi].name || slots[gi].blocked)) flip[gi] = true;
    }
    if (nm) {
      var up = idx; while (up>0 && (slots[up-1].name||"").toLowerCase()===nm) { flip[up-1]=true; up--; }
      var dn = idx; while (dn<slots.length-1 && (slots[dn+1].name||"").toLowerCase()===nm) { flip[dn+1]=true; dn++; }
    }
    var updated = slots.map(function(s, i){ return flip[i] ? {...s,done:newDone} : s; });
    setSlots(dateKey,updated);
    if (newDone) {
      playSound("lock");
    } else {
      playSound("tap");
    }
  };

  // Mark an empty slot as AVAILABLE / OVERTIME (or clear it). Never touches a
  // slot that already has someone or is blocked.
  const cycleSlotMark = function(dateKey, idx, mark) {
    var probe = schedulesRef.current[dateKey] ? schedulesRef.current[dateKey][idx] : getSlots(dateKey)[idx];
    if (!probe || probe.name || probe.blocked) return;
    var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    // Build the new day off the LATEST committed state (prev), not a value captured
    // before this click. Tapping several ×'s faster than React can re-render used to
    // let a later click overwrite the whole day from stale data and silently drop an
    // earlier restore ("skips one"). Functional updaters chain, so each one lands.
    setSchedules(function(prev){
      var day = prev[dateKey] ? prev[dateKey].slice() : DEFAULT_TIMES.map(function(t){ return {time:t,name:"",price:"",done:false,recurWeeks:null,isCustom:false}; });
      var s = day[idx];
      if (!s || s.name || s.blocked) return prev;
      day[idx] = {...s,availStatus:mark,done:false};
      return {...prev,[dateKey]:day};
    });
  };

  // Taps on an open slot: 1 = edit (handled live by the input focus), 2 =
  // AVAILABLE, 3 = OVERTIME. On the 2nd tap we back out of the edit the first
  // tap started so the keyboard goes away, then settle the label after a beat.
  const handleOpenSlotTap = function(dateKey, idx) {
    var key = dateKey+"-"+idx;
    var st = slotTapRef.current;
    if (st.key !== key) { if (st.timer) clearTimeout(st.timer); st.key=key; st.count=0; st.timer=null; }
    st.count += 1;
    if (st.count >= 2) {
      // If the first tap opened an edit and they've started writing a name, this
      // is real typing/cursor work — leave it alone instead of marking the slot.
      var cv = editValuesRef.current;
      if (editingRef.current && cv && (cv.name||"").trim().length>0) {
        if (st.timer) clearTimeout(st.timer);
        slotTapRef.current = {key:null,count:0,timer:null};
        return;
      }
      editingRef.current=null; setEditingCell(null); setEditingOccupied(false);
      if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current=null; }
      setEditChromeReady(true); setPencilArmed(false);
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }
    if (st.timer) clearTimeout(st.timer);
    var dk = dateKey; var ix = idx;
    st.timer = setTimeout(function(){
      var c = slotTapRef.current.count;
      slotTapRef.current = {key:null,count:0,timer:null};
      if (c >= 3) cycleSlotMark(dk, ix, "overtime");
      else if (c === 2) cycleSlotMark(dk, ix, "available");
    }, 200);
  };

  // Build the list of times that share a slot's group on a given day (sorted by time).
  const getGroupTimes = function(dateKey, slot) {
    return getSlots(dateKey)
      .filter(function(s){ return s.groupId && s.groupId===slot.groupId && s.name; })
      .sort(function(a,b){ return parseTime(a.time)-parseTime(b.time); })
      .map(function(s){ return {time:s.time,price:s.price,recurWeeks:s.recurWeeks,defaultBaseTime:s.defaultBaseTime,name:s.name}; });
  };

  // Earliest date AFTER fromDateKey on which this client already has something booked
  // (used to warn "already booked for ..." when scheduling their next one).
  var findExistingFutureBooking = function(name, fromDateKey) {
    var keys = Object.keys(schedulesRef.current);
    var best = null;
    for (var i=0;i<keys.length;i++) {
      var dk = keys[i];
      if (dk <= fromDateKey) continue;
      var day = schedulesRef.current[dk];
      for (var j=0;j<day.length;j++) {
        if (day[j].name===name && !day[j].blocked) {
          if (!best || dk < best) best = dk;
          break;
        }
      }
    }
    return best;
  };

  const openCheckoffSchedule = function(dateKey, idx, slot, groupTimes) {
    var alreadyBookedKey = findExistingFutureBooking(slot.name, dateKey);
    if (slot.recurWeeks) {
      var nextKey = getNextDateKey(dateKey,slot.recurWeeks);
      var conflict = isSlotTaken(nextKey,placementTime(slot),slot.name);
      setNudgedDate(nextKey); setCheckoffCalMonth(null);
      setCheckoffModal({dateKey,idx,slot,nextDateKey:nextKey,conflict,notRecurring:false,groupTimes:groupTimes||null,alreadyBookedKey:alreadyBookedKey});
    } else {
      setNudgedDate(null); setCheckoffCalMonth(null);
      setCheckoffModal({dateKey,idx,slot,nextDateKey:null,conflict:false,notRecurring:true,groupTimes:groupTimes||null,alreadyBookedKey:alreadyBookedKey});
    }
  };

  // Tapping anywhere on a checked-off (crossed) slot starts scheduling the next one.
  const handleDoneRowTap = function(dateKey, idx) {
    var slot = getSlots(dateKey)[idx];
    if (!slot.name || !slot.done) return;
    if (slot.groupId) {
      var gT = getGroupTimes(dateKey, slot);
      if (gT.length > 1) { setGroupScheduleModal({dateKey,idx,slot,groupTimes:gT}); return; }
    }
    openCheckoffSchedule(dateKey, idx, slot, null);
  };

  const confirmNextBooking = function(targetDateKey) {
    if (!checkoffModal) return;
    var slot = checkoffModal.slot;
    var times = (checkoffModal.groupTimes && checkoffModal.groupTimes.length>0)
      ? checkoffModal.groupTimes.map(function(t){ return {time:(t.defaultBaseTime||t.time),price:t.price,recurWeeks:t.recurWeeks,name:t.name}; })
      : [{time:placementTime(slot),price:slot.price,recurWeeks:slot.recurWeeks,name:slot.name}];
    var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    var newSchedules = {...schedulesRef.current};
    var placeOnDate = function(dk, allowOverwriteSame) {
      var daySlots = newSchedules[dk]
        ? [...newSchedules[dk]]
        : DEFAULT_TIMES.map(function(t){ return {time:t,name:"",price:"",done:false,recurWeeks:null}; });
      var dgid = times.length>1 ? newGroupId() : null;
      times.forEach(function(t){
        var nm = t.name || slot.name;
        var si = daySlots.findIndex(function(s){ return s.time===t.time; });
        if (si>=0) {
          var taken = daySlots[si].name && daySlots[si].name.toLowerCase()!==nm.toLowerCase();
          if (!taken && (allowOverwriteSame || !daySlots[si].name)) {
            daySlots[si] = {...daySlots[si],name:nm,price:t.price,recurWeeks:t.recurWeeks,done:false,groupId:dgid};
          }
        } else {
          daySlots.push({time:t.time,name:nm,price:t.price,recurWeeks:t.recurWeeks,done:false,groupId:dgid});
        }
      });
      daySlots.sort(function(a,b){ return parseTime(a.time)-parseTime(b.time); });
      newSchedules[dk] = daySlots;
    };
    placeOnDate(targetDateKey, true);
    if (slot.recurWeeks) {
      var sixMo = new Date(); sixMo.setMonth(sixMo.getMonth()+6);
      var cur = parseDateKey(targetDateKey);
      while (true) {
        cur = addWeeks(cur,slot.recurWeeks);
        if (cur>sixMo) break;
        placeOnDate(formatDateKey(cur), false);
      }
    }
    setSchedules(newSchedules);
    addHistoryEntry({type:"added",time:placementTime(slot),name:slot.name,price:slot.price,dateKey:targetDateKey});
    setCheckoffModal(null); setNudgedDate(null); setCheckoffCalMonth(null);
    // #1: after a quick-book, land on the date we just placed them on.
    setBaseDate(parseDateKey(targetDateKey)); setView(isPhone?"Day":"3-Day");
  };

  // Book the client at the chosen date AND every N weeks for six months, mark the
  // original slot recurring, and close the modal. Used when the quick-book modal's
  // recurring toggle (checkoffRecur) is armed.
  const bookRecurringFromModal = function(targetDateKey, weeks) {
    if (!checkoffModal || !weeks) return;
    var slot = checkoffModal.slot;
    var srcDateKey = checkoffModal.dateKey;
    var srcIdx = checkoffModal.idx;
    var times = (checkoffModal.groupTimes && checkoffModal.groupTimes.length>0)
      ? checkoffModal.groupTimes.map(function(t){ return {time:(t.defaultBaseTime||t.time),price:t.price,recurWeeks:weeks,name:t.name}; })
      : [{time:placementTime(slot),price:slot.price,recurWeeks:weeks,name:slot.name}];
    var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    var newSchedules = {...schedulesRef.current};
    var placeOnDate = function(dk, allowOverwriteSame) {
      var daySlots = newSchedules[dk]
        ? [...newSchedules[dk]]
        : DEFAULT_TIMES.map(function(t){ return {time:t,name:"",price:"",done:false,recurWeeks:null}; });
      var dgid = times.length>1 ? newGroupId() : null;
      times.forEach(function(t){
        var nm = t.name || slot.name;
        var si = daySlots.findIndex(function(s){ return s.time===t.time; });
        if (si>=0) {
          var taken = daySlots[si].name && daySlots[si].name.toLowerCase()!==nm.toLowerCase();
          if (!taken && (allowOverwriteSame || !daySlots[si].name)) {
            daySlots[si] = {...daySlots[si],name:nm,price:t.price,recurWeeks:t.recurWeeks,done:false,groupId:dgid};
          }
        } else {
          daySlots.push({time:t.time,name:nm,price:t.price,recurWeeks:t.recurWeeks,done:false,groupId:dgid});
        }
      });
      daySlots.sort(function(a,b){ return parseTime(a.time)-parseTime(b.time); });
      newSchedules[dk] = daySlots;
    };
    placeOnDate(targetDateKey, true);
    var sixMo = new Date(); sixMo.setMonth(sixMo.getMonth()+6);
    var cur = parseDateKey(targetDateKey);
    while (true) {
      cur = addWeeks(cur,weeks);
      if (cur>sixMo) break;
      placeOnDate(formatDateKey(cur), false);
    }
    // Mark the originating slot recurring as well, so its row shows the recurring badge.
    if (newSchedules[srcDateKey]) {
      var ss = [...newSchedules[srcDateKey]];
      if (ss[srcIdx] && ss[srcIdx].name && ss[srcIdx].name.toLowerCase()===slot.name.toLowerCase()) {
        ss[srcIdx] = {...ss[srcIdx],recurWeeks:weeks};
        newSchedules[srcDateKey] = ss;
      }
    }
    setSchedules(newSchedules);
    addHistoryEntry({type:"added",time:placementTime(slot),name:slot.name,price:slot.price,dateKey:targetDateKey});
    setCheckoffModal(null); setNudgedDate(null); setCheckoffCalMonth(null); setCheckoffRecur(null); setRecurPickerOpen(false);
    // #1: after a recurring quick-book, land on the date we just placed them on.
    setBaseDate(parseDateKey(targetDateKey)); setView(isPhone?"Day":"3-Day");
  };

  // Recurring, pick-the-slot flow: instead of asking for a start date in the
  // modal, jump straight to (source date + N weeks) in Day view and let the user
  // tap the exact open slot. The tapped slot becomes the recurring anchor.
  const startRecurringPlacement = function(weeks) {
    if (!checkoffModal || !weeks) return;
    var slot = checkoffModal.slot;
    var srcDateKey = checkoffModal.dateKey;
    var srcIdx = checkoffModal.idx;
    var targetDate = addWeeks(parseDateKey(srcDateKey), weeks);
    var gTimes = (checkoffModal.groupTimes && checkoffModal.groupTimes.length>1)
      ? checkoffModal.groupTimes.map(function(t){ return {time:t.time,price:t.price,defaultBaseTime:t.defaultBaseTime,name:t.name}; })
      : null;
    setPlacingClient({
      name:slot.name, price:slot.price,
      originalDateKey:null, originalIdx:null,
      recurBook:true, weeks:weeks,
      srcDateKey:srcDateKey, srcIdx:srcIdx,
      groupTimes:gTimes
    });
    setBaseDate(targetDate); setView(isPhone?"Day":"3-Day");
    setCheckoffModal(null); setNudgedDate(null); setCheckoffCalMonth(null); setCheckoffRecur(null); setRecurPickerOpen(false);
  };

  // Book a recurring series anchored on a tapped slot. Single bookings recur at
  // the tapped slot's own time; group bookings keep their original spread of
  // times on the chosen day. Series runs six months out, every N weeks.
  const bookRecurringFromPlacement = function(targetDateKey, targetIdx, client) {
    var weeks = client.weeks;
    if (!weeks) return false;
    var anchor = getSlots(targetDateKey)[targetIdx];
    if (!anchor || anchor.name || anchor.blocked) return false;
    // 6B: don't let a NEW recurring booking reuse a name already held by a different
    // recurring client. (Extending an already-recurring client is fine.) Block softly
    // with a banner rather than a modal, matching the quiet-failure feel of placement.
    var srcWasRecurring = false;
    if (client.srcDateKey!=null && client.srcIdx!=null) { var ssx=getSlots(client.srcDateKey)[client.srcIdx]; if (ssx && ssx.recurWeeks!=null) srcWasRecurring=true; }
    if (!srcWasRecurring && recurringNameConflict(client.name, client.srcDateKey, client.srcIdx)) {
      showBanner({type:"info", msg:client.name + " is already a recurring client — give this one a more specific name first."});
      setPlacingClient(null);
      return false;
    }
    // #2: a tap-to-placed recurring booking ALWAYS lands on the slot the user
    // tapped — never the original anchor time. For a single person that's the
    // tapped slot's time. For a linked group, re-anchor the whole group onto the
    // tapped slot: the earliest member moves to the tapped time and every other
    // member keeps its original minute-offset from that earliest member, so the
    // group keeps its shape but starts where you tapped (this also makes the
    // placement agree with the banner, which already reports the tapped time).
    var times;
    if (client.groupTimes && client.groupTimes.length>1) {
      var sortedG = client.groupTimes.slice().sort(function(a,b){ return timeToAbsMinutes(a.time)-timeToAbsMinutes(b.time); });
      var baseMin = timeToAbsMinutes(sortedG[0].time);
      var anchorMin = timeToAbsMinutes(anchor.time);
      times = sortedG.map(function(t){
        var offset = timeToAbsMinutes(t.time) - baseMin;
        return {time:absMinutesToTime(anchorMin+offset),price:t.price,recurWeeks:weeks,name:t.name};
      });
    } else {
      times = [{time:anchor.time,price:client.price,recurWeeks:weeks,name:client.name}];
    }
    var nameLower = (client.name||"").toLowerCase();
    var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    var newSchedules = {...schedulesRef.current};
    var placeOnDate = function(dk, allowOverwriteSame) {
      var daySlots = newSchedules[dk]
        ? [...newSchedules[dk]]
        : DEFAULT_TIMES.map(function(t){ return {time:t,name:"",price:"",done:false,recurWeeks:null}; });
      var dgid = times.length>1 ? newGroupId() : null;
      times.forEach(function(t){
        var nm = t.name || client.name;
        var si = daySlots.findIndex(function(s){ return s.time===t.time; });
        if (si>=0) {
          var taken = daySlots[si].name && daySlots[si].name.toLowerCase()!==nm.toLowerCase();
          if (!taken && (allowOverwriteSame || !daySlots[si].name)) {
            daySlots[si] = {...daySlots[si],name:nm,price:t.price,recurWeeks:t.recurWeeks,isException:false,done:false,groupId:dgid};
          }
        } else {
          daySlots.push({time:t.time,name:nm,price:t.price,recurWeeks:t.recurWeeks,isException:false,done:false,groupId:dgid});
        }
      });
      daySlots.sort(function(a,b){ return parseTime(a.time)-parseTime(b.time); });
      newSchedules[dk] = daySlots;
    };
    placeOnDate(targetDateKey, true);
    var sixMo = new Date(); sixMo.setMonth(sixMo.getMonth()+6);
    var cur = parseDateKey(targetDateKey);
    while (true) {
      cur = addWeeks(cur,weeks);
      if (cur>sixMo) break;
      placeOnDate(formatDateKey(cur), false);
    }
    // Mark the originating (just-checked-off) slot recurring too, so its row badges.
    if (client.srcDateKey && newSchedules[client.srcDateKey]) {
      var ss = [...newSchedules[client.srcDateKey]];
      var sIdx = client.srcIdx;
      if (ss[sIdx] && ss[sIdx].name && ss[sIdx].name.toLowerCase()===nameLower) {
        ss[sIdx] = {...ss[sIdx],recurWeeks:weeks};
        newSchedules[client.srcDateKey] = ss;
      }
    }
    setSchedules(newSchedules);
    addHistoryEntry({type:"added",time:anchor.time,name:client.name,price:client.price,dateKey:targetDateKey});
    return true;
  };

  const jumpToDate = function(dateKey) {
    setBaseDate(parseDateKey(dateKey)); setView(isPhone?"Day":"3-Day");
    setCheckoffModal(null); setNudgedDate(null); setCheckoffCalMonth(null);
  };

  const jumpToDateForBooking = function(targetDateKey, slot) {
    setCheckoffModal(null); setNudgedDate(null); setCheckoffCalMonth(null);
    setBaseDate(parseDateKey(targetDateKey)); setView(isPhone?"Day":"3-Day");
    setReassignMode({client:{name:slot.name,price:slot.price,recurWeeks:slot.recurWeeks},currentDateKey:targetDateKey,remainingConflicts:[]});
  };

  const openClientProfile = function(name) {
    var today = toDateKey(new Date());
    var bookings = [];
    Object.entries(schedulesRef.current).forEach(function(entry) {
      var dateKey=entry[0]; var slots=entry[1];
      if (dateKey < today) return; // only what's still on the books going forward
      slots.forEach(function(slot) {
        if (slot.name===name && !slot.blocked) bookings.push({dateKey,time:slot.time,price:slot.price,recurWeeks:slot.recurWeeks,isException:slot.isException||false,done:slot.done||false,isPast:false});
      });
    });
    bookings.sort(function(a,b){ return a.dateKey.localeCompare(b.dateKey); });
    var nonEx = bookings.filter(function(b){ return !b.isException; });
    var usualTime = nonEx.length>0?nonEx[0].time:(bookings[0]&&bookings[0].time)||"";
    var recurFound = bookings.find(function(b){ return b.recurWeeks; });
    var recurWeeks = recurFound ? recurFound.recurWeeks : null;
    setClientProfile({name,recurWeeks,usualTime,bookings,phone:getClientPhone(name)});
  };

  // #9: optional phone number kept on the client-memory entry so the profile can offer
  // Message / Call. iOS PWAs can't read Contacts, so this is a manual field. Keyed by
  // lower-cased name (imperfect when two clients share a first name — note for later).
  const getClientPhone = function(name) {
    var lower=(name||"").toLowerCase();
    var e=clientMemoryRef.current.find(function(c){ return c.name && c.name.toLowerCase()===lower; });
    return (e && e.phone) ? e.phone : "";
  };
  const setClientPhone = function(name, phone) {
    if (!name) return;
    setClientMemory(function(mem) {
      var i=mem.findIndex(function(c){ return c.name && c.name.toLowerCase()===name.toLowerCase(); });
      if (i>=0) { var u=[...mem]; u[i]={...u[i],phone:phone}; return u; }
      return [...mem,{name:name,price:"",phone:phone}];
    });
  };

  const removeClientBooking = function(dateKey, name) {
    var slots=[...getSlots(dateKey)];
    var idx=slots.findIndex(function(s){ return s.name===name; });
    if (idx<0) return;
    var slot=slots[idx];
    var snapshot={schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    slots[idx]={...slot,name:"",price:"",recurWeeks:null,isException:false,done:false};
    setSlots(dateKey,slots);
    addHistoryEntry({type:"removed",time:slot.time,name,dateKey});
    setClientProfile(function(prev){ return prev?{...prev,bookings:prev.bookings.filter(function(b){ return b.dateKey!==dateKey; })}:null; });
  };

  const startLongPress = function(name) { longPressTimer.current=setTimeout(function(){ openClientProfile(name); },600); };
  const cancelLongPress = function() { if(longPressTimer.current){ clearTimeout(longPressTimer.current); longPressTimer.current=null; } };

  const handleReassignSlotTap = function(dateKey, idx) {
    if (!reassignMode||reassignMode.currentDateKey!==dateKey) return;
    var client=reassignMode.client; var rc=reassignMode.remainingConflicts;
    var slots=[...getSlots(dateKey)];
    var slot=slots[idx];
    if (slot.name) return;
    var snapshot={schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    var newSlots=[...slots];
    newSlots[idx]={...slot,name:client.name,price:client.price,recurWeeks:client.recurWeeks,isException:true,done:false};
    setSlots(dateKey,newSlots);
    addHistoryEntry({type:"added",time:slot.time,name:client.name,price:client.price,dateKey});
    if (reassignMode.originalDateKey&&reassignMode.originalIdx!==undefined) {
      var origSlots=[...getSlots(reassignMode.originalDateKey)];
      var origSlot=origSlots[reassignMode.originalIdx];
      origSlots[reassignMode.originalIdx]={...origSlot,name:"",price:"",done:false,recurWeeks:null,isException:false};
      setSlots(reassignMode.originalDateKey,origSlots);
      addHistoryEntry({type:"removed",time:origSlot.time,name:client.name,dateKey:reassignMode.originalDateKey});
    }
    setReassignMode(null);
    if (rc.length>0) setReassignApplyAll({altTime:slot.time,remainingConflicts:rc,client});
  };

  const applyAltTimeToConflicts = function(altTime, conflicts, client) {
    var snapshot={schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    var newSch={...schedulesRef.current};
    conflicts.forEach(function(c) {
      var ds=newSch[c.dateKey]?[...newSch[c.dateKey]]:DEFAULT_TIMES.map(function(t){ return {time:t,name:"",price:"",done:false,recurWeeks:null}; });
      var ti=ds.findIndex(function(s){ return s.time===altTime; });
      if (ti>=0&&!ds[ti].name) { ds[ti]={...ds[ti],name:client.name,price:client.price,recurWeeks:client.recurWeeks,isException:true,done:false}; newSch[c.dateKey]=ds; addHistoryEntry({type:"added",time:altTime,name:client.name,price:client.price,dateKey:c.dateKey}); }
    });
    setSchedules(newSch); setReassignApplyAll(null);
  };

  const buildRecurringSchedules = function(baseSch, dateKey, sourceSlot, weeks) {
    var newSch={...baseSch}; var conflicts=[];
    var sixMo=new Date(); sixMo.setMonth(sixMo.getMonth()+6);
    var cursor=parseDateKey(dateKey);
    // Match future days by the source's ANCHOR time (defaultBaseTime||time), not its
    // displayed time. A recurring client whose default was nudged (e.g. anchored at
    // 9:51 but shown as 9:46) must fill the one anchored row and relabel it — not
    // spawn a second 9:46 row and leave the empty 9:51 default behind. (#13)
    var anchor=placementTime(sourceSlot);
    var isCust=sourceSlot.isCustom===true||(sourceSlot.isCustom===undefined&&!sourceSlot.defaultBaseTime&&DEFAULT_TIMES.indexOf(sourceSlot.time)===-1);
    var srcBase=isCust?null:(sourceSlot.defaultBaseTime||sourceSlot.time);
    var lower=(sourceSlot.name||"").toLowerCase();
    while (true) {
      cursor=addWeeks(cursor,weeks);
      if (cursor>sixMo) break;
      var fk=formatDateKey(cursor);
      var ds=newSch[fk]?[...newSch[fk]]:DEFAULT_TIMES.map(function(t){ return {time:t,name:"",price:"",done:false,recurWeeks:null}; });
      var ei=ds.findIndex(function(s){ return placementTime(s)===anchor; });
      if (ei>=0&&ds[ei].name&&ds[ei].name.toLowerCase()!==lower) conflicts.push({dateKey:fk,time:sourceSlot.time,name:sourceSlot.name,price:sourceSlot.price,recurWeeks:weeks,existingName:ds[ei].name});
      else if (ei>=0) { ds[ei]={...ds[ei],time:sourceSlot.time,name:sourceSlot.name,price:sourceSlot.price,recurWeeks:weeks,done:false,pending:!!sourceSlot.pending,groupId:sourceSlot.groupId||null,isCustom:sourceSlot.isCustom,customTime:sourceSlot.customTime,defaultBaseTime:srcBase}; ds.sort(function(a,b){return parseTime(a.time)-parseTime(b.time);}); newSch[fk]=ds; }
      else { ds.push({time:sourceSlot.time,name:sourceSlot.name,price:sourceSlot.price,recurWeeks:weeks,done:false,pending:!!sourceSlot.pending,groupId:sourceSlot.groupId||null,isCustom:sourceSlot.isCustom,customTime:sourceSlot.customTime,defaultBaseTime:srcBase}); ds.sort(function(a,b){return parseTime(a.time)-parseTime(b.time);}); newSch[fk]=ds; }
    }
    return {newSchedules:newSch,conflicts};
  };

  // 6B: true if some OTHER slot anywhere already uses this name AND is recurring.
  // (A non-recurring duplicate name is allowed; only recurring names must be unique.)
  const recurringNameConflict = function(name, exDateKey, exIdx) {
    var lower=(name||"").toLowerCase();
    if (!lower) return false;
    // Only an ACTIVELY recurring client reserves a name. A past occurrence, or one
    // that was already checked off, or a series that's since been cancelled, must NOT
    // force a rename — otherwise a returning client (e.g. James McGuinness coming back
    // to recurring after cancelling) gets told his own name is "taken."
    var todayKey=toDateKey(new Date());
    var found=false;
    Object.keys(schedulesRef.current).forEach(function(dk){
      if (dk < todayKey) return;
      var ds=schedulesRef.current[dk]; if(!ds) return;
      ds.forEach(function(s,si){
        if (dk===exDateKey && si===exIdx) return;
        if (s.name && s.name.toLowerCase()===lower && s.recurWeeks!=null && !s.done) found=true;
      });
    });
    return found;
  };

  // 6C (time, "apply to all"): move every future occurrence of a recurring client
  // to a new time. Sweeps ALL dates from fromDateKey forward (immune to occurrences
  // whose times were individually nudged). Returns collected conflicts where the new
  // time is already taken by someone else on that day.
  const buildSeriesTimeShift = function(name, fromDateKey, newTime) {
    var lower=(name||"").toLowerCase();
    var newSch={...schedulesRef.current};
    var conflicts=[];
    Object.keys(newSch).forEach(function(dk){
      if (dk < fromDateKey) return;
      var ds=newSch[dk]?[...newSch[dk]]:DEFAULT_TIMES.map(function(t){ return {time:t,name:"",price:"",done:false,recurWeeks:null}; });
      var occIdx=ds.findIndex(function(s){ return s.name && s.name.toLowerCase()===lower && !s.done; });
      if (occIdx<0) return;
      var occ=ds[occIdx];
      if (occ.time===newTime) { newSch[dk]=ds; return; }
      var tIdx=ds.findIndex(function(s){ return s.time===newTime; });
      if (tIdx>=0 && tIdx!==occIdx && ds[tIdx].name && ds[tIdx].name.toLowerCase()!==lower) {
        conflicts.push({dateKey:dk,time:newTime,name:name,price:occ.price,recurWeeks:occ.recurWeeks,existingName:ds[tIdx].name});
        return;
      }
      var isStillDefault=DEFAULT_TIMES.indexOf(newTime)>=0;
      var wasCustom=occ.isCustom===true||(occ.isCustom===undefined&&DEFAULT_TIMES.indexOf(occ.time)===-1);
      var baseTime=occ.defaultBaseTime||(!wasCustom?occ.time:null);
      if (tIdx>=0 && tIdx!==occIdx && !ds[tIdx].name) {
        ds[tIdx]={...ds[tIdx],name:occ.name,price:occ.price,recurWeeks:occ.recurWeeks,isException:true,done:false,groupId:occ.groupId||null,customTime:wasCustom&&!isStillDefault,defaultBaseTime:(!wasCustom?baseTime:occ.defaultBaseTime)};
        if (DEFAULT_TIMES.indexOf(occ.time)>=0) ds[occIdx]={time:occ.time,name:"",price:"",done:false,recurWeeks:null};
        else ds.splice(occIdx,1);
      } else {
        ds[occIdx]={...occ,time:newTime,isException:true,customTime:wasCustom&&!isStillDefault,defaultBaseTime:(!wasCustom?baseTime:occ.defaultBaseTime)};
        if (DEFAULT_TIMES.indexOf(occ.time)>=0 && !ds.some(function(s){ return s.time===occ.time; })) ds.push({time:occ.time,name:"",price:"",done:false,recurWeeks:null});
      }
      ds.sort(function(a,b){ return timeToAbsMinutes(a.time)-timeToAbsMinutes(b.time); });
      newSch[dk]=ds;
    });
    return {newSchedules:newSch,conflicts:conflicts};
  };

  const setRecurring = function(dateKey, idx, weeks) {
    var srcSlots=[...getSlots(dateKey)]; var srcSlot=srcSlots[idx];
    if (weeks && !srcSlot.recurWeeks && srcSlot.name && recurringNameConflict(srcSlot.name, dateKey, idx)) {
      setRenameRequiredModal({dateKey:dateKey, idx:idx, weeks:weeks, name:srcSlot.name, draft:srcSlot.name});
      setRecurringModal(null);
      return;
    }
    srcSlots[idx]={...srcSlot,recurWeeks:weeks};
    var baseSch={...schedulesRef.current,[dateKey]:srcSlots};
    var snapshot={schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    if (weeks) {
      var res=buildRecurringSchedules(baseSch,dateKey,srcSlot,weeks);
      if (res.conflicts.length>0) {
        setRecurringModal(null);
        setConflictModal({conflicts:res.conflicts, pending:res.newSchedules, client:{name:srcSlot.name,price:srcSlot.price||"",recurWeeks:weeks}, history:{type:"recurring_set",time:srcSlot.time,name:srcSlot.name,weeks:weeks,dateKey:dateKey}});
      } else { setSchedules(res.newSchedules); addHistoryEntry({type:"recurring_set",time:srcSlot.time,name:srcSlot.name,weeks,dateKey}); setRecurringModal(null); }
    } else {
      // 6A: removing recurring clears THIS person's future recurring appointments.
      // Sweep every date strictly after the source date and clear any slot carrying
      // this name that is still recurring and not yet done — matched by NAME only, so
      // occurrences whose times were individually nudged are no longer missed.
      var newSch2={...schedulesRef.current,[dateKey]:srcSlots};
      var nameLowerR=(srcSlot.name||"").toLowerCase();
      if (nameLowerR) {
        Object.keys(newSch2).forEach(function(dk){
          if (dk <= dateKey) return;
          var ds2=[...newSch2[dk]]; var touched=false;
          ds2.forEach(function(s,si){
            if (s.name && s.name.toLowerCase()===nameLowerR && s.recurWeeks!=null && !s.done) {
              ds2[si]={...s,name:"",price:"",done:false,recurWeeks:null,isException:false,groupId:null,pending:false,availStatus:null};
              touched=true;
            }
          });
          if (touched) newSch2[dk]=ds2;
        });
      }
      setSchedules(newSch2); addHistoryEntry({type:"recurring_set",time:srcSlot.time,name:srcSlot.name,weeks,dateKey}); setRecurringModal(null);
    }
  };

  // #10: cancel a recurring series for an entire linked group in a single pass.
  // (Calling setRecurring once per member would clobber state, since each call
  // rebuilds from the same pre-update snapshot.) Matches the single-person rule:
  // on the source day the booking stays but loses its recurring flag; every
  // future occurrence of any group member's name is cleared.
  const cancelRecurringForGroup = function(dateKey, groupSlots) {
    var snap={schedules:JSON.parse(JSON.stringify(schedulesRef.current))}; pushUndo(snap);
    var names={};
    groupSlots.forEach(function(gs){ if(gs.name) names[gs.name.toLowerCase()]=true; });
    var newSch={...schedulesRef.current};
    Object.keys(newSch).forEach(function(dk){
      if (dk < dateKey) return;
      var ds=[...newSch[dk]]; var touched=false;
      ds.forEach(function(s,si){
        if (s.name && names[s.name.toLowerCase()] && s.recurWeeks!=null && !s.done) {
          if (dk===dateKey) { ds[si]={...s,recurWeeks:null}; }
          else { ds[si]={...s,name:"",price:"",done:false,recurWeeks:null,isException:false,groupId:null,pending:false,availStatus:null}; }
          touched=true;
        }
      });
      if (touched) newSch[dk]=ds;
    });
    setSchedules(newSch);
    addHistoryEntry({type:"recurring_set",time:(groupSlots[0]&&groupSlots[0].time)||"",name:(groupSlots[0]&&groupSlots[0].name)||"group",weeks:null,dateKey:dateKey});
    setGroupRecurModal(null);
  };

  // TEMP (v23): one-time clean wipe of a single tangled client (James McGinness).
  // His record won't cancel because some rows lost the recurring flag / were checked
  // off / were saved under a slightly different spelling, so the normal cancel skips
  // them. This matches him by a loose name pattern (covers McGinness AND McGuinness),
  // on EVERY date past and future, regardless of those flags. Default-time rows are
  // emptied back to placeholders; custom-time rows that only existed to hold him
  // (e.g. the stray 7:48) are dropped so no ghost rows remain. Undo-able. Remove the
  // button and this helper once he's confirmed gone and re-booked clean.
  const matchTangledClient = function(nm) {
    if (!nm) return false;
    var s = nm.toLowerCase().replace(/[^a-z]/g, "");
    return s.indexOf("james") === 0 && s.indexOf("mcg") !== -1 && s.indexOf("ness") !== -1;
  };
  const wipeTangledClient = function() {
    var src = schedulesRef.current;
    var removed = 0; var daysTouched = 0;
    var clean = {};
    Object.keys(src).forEach(function(dk) {
      var ds = src[dk] || [];
      var out = []; var touched = false;
      ds.forEach(function(s) {
        if (s && s.name && matchTangledClient(s.name)) {
          removed++; touched = true;
          if (DEFAULT_TIMES.indexOf(s.time) !== -1) out.push({time:s.time,name:"",price:"",done:false,recurWeeks:null});
        } else {
          out.push(s);
        }
      });
      if (touched) daysTouched++;
      clean[dk] = out;
    });
    if (removed === 0) { showBanner({type:"info", msg:"No James rows found — nothing to remove."}); return; }
    var ok = (typeof window === "undefined") ? true : window.confirm("Remove " + removed + " James rows across " + daysTouched + " days? You can undo right after.");
    if (!ok) return;
    var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    setSchedules(clean);
    showBanner({type:"info", msg:"Removed " + removed + " James rows across " + daysTouched + " days. Re-book him fresh."});
  };

  // ---- 6C/6D series-edit + conflict-resolution helpers ----
  // 6C name/price: apply a rename/price change to just this occurrence or to the
  // whole future series.
  const applySeriesNamePrice = function(scope) {
    var m=seriesEditModal; if(!m) return;
    var snap={schedules:JSON.parse(JSON.stringify(schedulesRef.current))}; pushUndo(snap);
    if (scope==="one") {
      var slots=[...getSlots(m.dateKey)]; var p=slots[m.idx];
      slots[m.idx]={...p,name:m.newName,price:m.newPrice,availStatus:null,pending:false,isException:true};
      setSlots(m.dateKey,slots);
      addHistoryEntry({type:"edited",time:p.time,name:m.newName,prevName:m.oldName,dateKey:m.dateKey});
    } else {
      var lowerS=(m.oldName||"").toLowerCase();
      var newSch={...schedulesRef.current};
      Object.keys(newSch).forEach(function(dk){
        if (dk < m.dateKey) return;
        var ds=[...newSch[dk]]; var changed=false;
        ds.forEach(function(s,si){
          if (s.name && s.name.toLowerCase()===lowerS && !s.done) { ds[si]={...s,name:m.newName,price:m.newPrice}; changed=true; }
        });
        if (changed) newSch[dk]=ds;
      });
      setSchedules(newSch);
      addHistoryEntry({type:"edited",time:m.time||"",name:m.newName,prevName:m.oldName,dateKey:m.dateKey});
      setClientMemory(function(mem){ var ex=mem.findIndex(function(c){ return c.name.toLowerCase()===m.newName.toLowerCase(); }); if(ex>=0){ var u=[...mem]; u[ex]={...u[ex],name:m.newName,price:m.newPrice||mem[ex].price}; return u; } return [...mem,{name:m.newName,price:m.newPrice}]; });
    }
    setSeriesEditModal(null);
    editingRef.current=null; setEditingCell(null); setEditingOccupied(false); setPencilArmed(false); setEditChromeReady(true);
  };

  // 6C time: move just this occurrence, or the whole future series (which may collect
  // conflicts that then route through the shared conflict modal).
  const applySeriesTime = function(scope) {
    var m=seriesEditModal; if(!m) return;
    if (scope==="one") {
      var slots=[...getSlots(m.dateKey)]; var p=slots[m.idx];
      if (slots.some(function(s,i){ return i!==m.idx && s.time===m.newTime; })) { setSeriesEditModal(null); return; }
      var snap={schedules:JSON.parse(JSON.stringify(schedulesRef.current))}; pushUndo(snap);
      var isStillDefault=DEFAULT_TIMES.indexOf(m.newTime)>=0;
      var wasCustom=p.isCustom===true||(p.isCustom===undefined&&DEFAULT_TIMES.indexOf(p.time)===-1);
      var baseTime=p.defaultBaseTime||(!wasCustom?p.time:null);
      slots[m.idx]={...p,time:m.newTime,isException:true,customTime:wasCustom&&!isStillDefault,defaultBaseTime:(!wasCustom?baseTime:p.defaultBaseTime)};
      slots.sort(function(a,b){ return timeToAbsMinutes(a.time)-timeToAbsMinutes(b.time); });
      setSlots(m.dateKey,slots);
      setSeriesEditModal(null);
    } else {
      var cur=getSlots(m.dateKey)[m.idx]||{};
      var occName=cur.name||m.name||"";
      var snap2={schedules:JSON.parse(JSON.stringify(schedulesRef.current))}; pushUndo(snap2);
      var resT=buildSeriesTimeShift(occName, m.dateKey, m.newTime);
      setSeriesEditModal(null);
      if (resT.conflicts.length>0) {
        setConflictModal({conflicts:resT.conflicts, pending:resT.newSchedules, client:{name:occName,price:cur.price||"",recurWeeks:cur.recurWeeks}, history:{type:"edited",time:m.newTime,name:occName,prevName:occName,dateKey:m.dateKey}});
      } else { setSchedules(resT.newSchedules); }
    }
  };

  // Drop of a recurring occurrence onto a new slot. "Just this one" makes it a single
  // exception sitting at the dropped slot (this week only); "All" shifts the whole
  // future series to the dropped time, keeping each occurrence on its own day. (A
  // cross-day drop therefore only changes the time for "All" — it can't relocate a
  // weekly series to a different weekday.)
  const applySeriesDrop = function(scope) {
    var m=seriesEditModal; if(!m||m.field!=="drop") return;
    if (scope==="one") {
      var snap={schedules:JSON.parse(JSON.stringify(schedulesRef.current))}; pushUndo(snap);
      var tgt=[...getSlots(m.targetDateKey)]; var tslot=tgt[m.targetIdx];
      if (tslot && !tslot.name && !tslot.blocked) {
        tgt[m.targetIdx]={...tslot,name:m.name,price:m.price,recurWeeks:m.recurWeeks,isException:true,done:false,groupId:null,pending:!!m.pending};
        if (m.targetDateKey===m.dateKey) {
          tgt[m.idx]={...tgt[m.idx],name:"",price:"",done:false,recurWeeks:null,isException:false,groupId:null,pending:false,availStatus:null};
          setSlots(m.targetDateKey,tgt);
        } else {
          setSlots(m.targetDateKey,tgt);
          var src=[...getSlots(m.dateKey)];
          src[m.idx]={...src[m.idx],name:"",price:"",done:false,recurWeeks:null,isException:false,groupId:null,pending:false,availStatus:null};
          setSlots(m.dateKey,src);
        }
        addHistoryEntry({type:"rescheduled",time:m.newTime,name:m.name,price:m.price,dateKey:m.targetDateKey});
      }
      setSeriesEditModal(null);
    } else {
      var snap2={schedules:JSON.parse(JSON.stringify(schedulesRef.current))}; pushUndo(snap2);
      var res=buildSeriesTimeShift(m.name, m.dateKey, m.newTime);
      setSeriesEditModal(null);
      if (res.conflicts.length>0) {
        setConflictModal({conflicts:res.conflicts, pending:res.newSchedules, client:{name:m.name,price:m.price||"",recurWeeks:m.recurWeeks}, history:{type:"edited",time:m.newTime,name:m.name,prevName:m.name,dateKey:m.dateKey}});
      } else { setSchedules(res.newSchedules); }
    }
  };

  // Locking a penciled occurrence of a recurring series: confirm just this one, or
  // lock in every future penciled occurrence of the series at once.
  const applySeriesLock = function(scope) {
    var m=seriesEditModal; if(!m||m.field!=="lock") return;
    var snap={schedules:JSON.parse(JSON.stringify(schedulesRef.current))}; pushUndo(snap);
    if (scope==="one") {
      var slots=[...getSlots(m.dateKey)]; var p=slots[m.idx];
      if (p) { slots[m.idx]={...p,pending:false}; setSlots(m.dateKey,slots); addHistoryEntry({type:"added",time:p.time,name:p.name,price:p.price,dateKey:m.dateKey}); }
    } else {
      var lower=(m.name||"").toLowerCase();
      var newSch={...schedulesRef.current};
      Object.keys(newSch).forEach(function(dk){
        if (dk < m.dateKey) return;
        var ds=[...newSch[dk]]; var changed=false;
        ds.forEach(function(s,si){
          if (s.name && s.name.toLowerCase()===lower && !s.done && s.pending) { ds[si]={...s,pending:false}; changed=true; }
        });
        if (changed) newSch[dk]=ds;
      });
      setSchedules(newSch);
      addHistoryEntry({type:"added",time:m.time||"",name:m.name,dateKey:m.dateKey});
    }
    setSeriesEditModal(null);
  };

  // 6D conflict resolution. The conflict modal carries {conflicts, pending, client, history}.
  const commitConflictPending = function() {
    if(!conflictModal) return;
    setSchedules(conflictModal.pending);
    if(conflictModal.history) addHistoryEntry(conflictModal.history);
    setConflictModal(null);
  };
  const shareSlotInto = function(pend, c, client) {
    var ds=pend[c.dateKey]?[...pend[c.dateKey]]:DEFAULT_TIMES.map(function(t){ return {time:t,name:"",price:"",done:false,recurWeeks:null}; });
    ds.push({time:c.time,name:client.name,price:client.price||"",recurWeeks:client.recurWeeks,done:false,isException:true,groupId:null});
    ds.sort(function(a,b){ return parseTime(a.time)-parseTime(b.time); });
    pend[c.dateKey]=ds;
    return pend;
  };
  const conflictShareOne = function(i) {
    if(!conflictModal) return;
    var c=conflictModal.conflicts[i];
    var pend=shareSlotInto({...conflictModal.pending}, c, conflictModal.client);
    var rem=conflictModal.conflicts.filter(function(_,j){ return j!==i; });
    if (rem.length>0) { setConflictModal({...conflictModal,conflicts:rem,pending:pend}); }
    else { setSchedules(pend); if(conflictModal.history) addHistoryEntry(conflictModal.history); setConflictModal(null); }
  };
  const conflictShareAll = function() {
    if(!conflictModal) return;
    var pend={...conflictModal.pending};
    conflictModal.conflicts.forEach(function(c){ pend=shareSlotInto(pend, c, conflictModal.client); });
    setSchedules(pend); if(conflictModal.history) addHistoryEntry(conflictModal.history); setConflictModal(null);
  };
  const conflictJump = function(i) {
    if(!conflictModal) return;
    var c=conflictModal.conflicts[i];
    var rem=conflictModal.conflicts.filter(function(_,j){ return j!==i; });
    var cl=conflictModal.client;
    setSchedules(conflictModal.pending);
    if(conflictModal.history) addHistoryEntry(conflictModal.history);
    setConflictModal(null);
    setReassignMode({client:{name:cl.name,price:cl.price||"",recurWeeks:cl.recurWeeks},currentDateKey:c.dateKey,remainingConflicts:rem});
    jumpToDate(c.dateKey);
  };

  // 6B: confirm a unique rename, then make recurring.
  const confirmRenameRecurring = function() {
    var m=renameRequiredModal; if(!m) return;
    var nm=capitalizeFirst(stripLeadingNumbers((m.draft||"").trim()));
    if (!nm) return;
    if (recurringNameConflict(nm, m.dateKey, m.idx)) { return; }
    var slots=[...getSlots(m.dateKey)]; var p=slots[m.idx];
    var snap={schedules:JSON.parse(JSON.stringify(schedulesRef.current))}; pushUndo(snap);
    slots[m.idx]={...p,name:nm};
    setSlots(m.dateKey,slots);
    var dk=m.dateKey, ix=m.idx, wk=m.weeks;
    setRenameRequiredModal(null);
    setTimeout(function(){ setRecurring(dk, ix, wk); }, 60);
  };

  const requestRemoveSlot = function(dateKey, idx) {
    var slot=getSlots(dateKey)[idx];
    if (!slot.name) { setSwipedSlot(null); return; }
    if (slot.groupId) {
      var gs=getSlots(dateKey).filter(function(s){ return s.groupId===slot.groupId&&s.name; });
      if (gs.length>1) { setGroupConfirm({action:'cancel',dateKey,idx,name:slot.name,groupId:slot.groupId}); setSwipedSlot(null); return; }
    }
    setConfirmDelete({dateKey,idx,slot}); setSwipedSlot(null);
  };

  const cancelGroupSlots = function(dateKey, groupId, onlyIdx) {
    var slots=[...getSlots(dateKey)];
    var snapshot={schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    if (onlyIdx!==undefined) {
      var s=slots[onlyIdx];
      slots[onlyIdx]={...s,name:"",price:"",done:false,recurWeeks:null,isException:false,groupId:null,pending:false,availStatus:null};
      var rem=slots.filter(function(x){ return x.groupId===groupId&&x.name; });
      if (rem.length===1) { var ri=slots.findIndex(function(x){ return x.groupId===groupId&&x.name; }); if(ri>=0) slots[ri]={...slots[ri],groupId:null}; }
      addHistoryEntry({type:"removed",time:s.time,name:s.name,dateKey});
      if (editingRef.current && editingRef.current.dateKey===dateKey && editingRef.current.idx===onlyIdx) {
        editingRef.current=null; setEditingCell(null); setEditingOccupied(false);
      }
      try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch(e) {}
      var gk=dateKey+"-"+onlyIdx;
      setRecentlyRemoved(function(r){ return {...r,[gk]:true}; });
      setTimeout(function(){ setRecentlyRemoved(function(r){ var n={...r}; delete n[gk]; return n; }); },8000);
    } else {
      slots.forEach(function(s,i){ if(s.groupId===groupId&&s.name){ addHistoryEntry({type:"removed",time:s.time,name:s.name,dateKey}); slots[i]={...s,name:"",price:"",done:false,recurWeeks:null,isException:false,groupId:null,pending:false,availStatus:null}; } });
    }
    setSlots(dateKey,slots); setGroupConfirm(null); setConfirmDelete(null);
  };

  const rescheduleGroupSlots = function(dateKey, groupId, onlyIdx) {
    var ts=getSlots(dateKey)[onlyIdx];
    setReassignMode({client:{name:ts.name,price:ts.price,recurWeeks:ts.recurWeeks},currentDateKey:dateKey,originalDateKey:dateKey,originalIdx:onlyIdx,remainingConflicts:[],groupId:onlyIdx!==undefined?null:groupId,groupDateKey:dateKey});
    setGroupConfirm(null); jumpToDate(dateKey);
  };

  const confirmRemoveSlot = function(allFuture) {
    if (!confirmDelete) return;
    var dateKey=confirmDelete.dateKey; var idx=confirmDelete.idx; var slot=confirmDelete.slot;
    var snapshot={schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    var slots=[...getSlots(dateKey)];
    slots[idx]={...slots[idx],name:"",price:"",done:false,recurWeeks:null,isException:false,pending:false,availStatus:null};
    var working={...schedulesRef.current,[dateKey]:slots};
    // #2: "all future" also sweeps every later occurrence of this recurring client
    // (matched by name, exactly like "Remove recurring"), so cancelling a series no
    // longer leaves its future appointments stranded on the calendar.
    if (allFuture && slot.name) {
      var nameLowerD=slot.name.toLowerCase();
      Object.keys(working).forEach(function(dk){
        if (dk <= dateKey) return;
        var ds2=[...working[dk]]; var touched=false;
        ds2.forEach(function(s,si){
          if (s.name && s.name.toLowerCase()===nameLowerD && s.recurWeeks!=null && !s.done) {
            ds2[si]={...s,name:"",price:"",done:false,recurWeeks:null,isException:false,groupId:null,pending:false,availStatus:null};
            touched=true;
          }
        });
        if (touched) working[dk]=ds2;
      });
    }
    setSchedules(working);
    addHistoryEntry({type:"removed",time:slot.time,name:slot.name,price:slot.price,dateKey});
    // Drop any stale edit focus on the slot being emptied so iOS doesn't keep a
    // hidden focused input around (which is what triggers the AutoFill callout).
    if (editingRef.current && editingRef.current.dateKey===dateKey && editingRef.current.idx===idx) {
      editingRef.current=null; setEditingCell(null); setEditingOccupied(false);
    }
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch(e) {}
    var key=dateKey+"-"+idx;
    setRecentlyRemoved(function(r){ return {...r,[key]:true}; });
    setTimeout(function(){ setRecentlyRemoved(function(r){ var n={...r}; delete n[key]; return n; }); },8000);
    setConfirmDelete(null);
  };

  const addSlotToBeginning = function(dateKey) {
    var cur=getSlots(dateKey);
    var first=cur.length>0?cur[0].time:DEFAULT_TIMES[0];
    var fi=ALL_TIMES.indexOf(first);
    if (fi<=0) return;
    var nt=ALL_TIMES[fi-1];
    if (cur.some(function(s){ return s.time===nt; })) return;
    var snapshot={schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    setSlots(dateKey,[{time:nt,name:"",price:"",done:false,recurWeeks:null,isCustom:true}].concat(cur));
    addHistoryEntry({type:"slot_added",time:nt,dateKey});
  };

  const addSlotToEnd = function(dateKey) {
    var cur=getSlots(dateKey);
    var last=cur.length>0?cur[cur.length-1].time:DEFAULT_TIMES[DEFAULT_TIMES.length-1];
    var li=ALL_TIMES.indexOf(last);
    if (li<0||li>=ALL_TIMES.length-1) return;
    var nt=ALL_TIMES[li+1];
    if (cur.some(function(s){ return s.time===nt; })) return;
    var snapshot={schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    setSlots(dateKey,cur.concat([{time:nt,name:"",price:"",done:false,recurWeeks:null,isCustom:true}]));
    addHistoryEntry({type:"slot_added",time:nt,dateKey});
  };

  const removeCustomSlot = function(dateKey, idx) {
    var slots=[...getSlots(dateKey)];
    var slot=slots[idx];
    var snapshot={schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    slots.splice(idx,1);
    setSlots(dateKey,slots);
    addHistoryEntry({type:"slot_removed",time:slot.time,dateKey});
    setSwipedSlot(null);
  };

  const toggleBlockSlot = function(dateKey, idx, label) {
    var slots=[...getSlots(dateKey)]; var slot=slots[idx];
    var snapshot={schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    if (slot.blocked) {
      slots[idx]={...slot,blocked:false,blockLabel:"",done:false}; addHistoryEntry({type:"unblocked",time:slot.time,name:slot.blockLabel||"Blocked",dateKey});
    } else {
      slots[idx]={...slot,blocked:true,blockLabel:label||"Lunch",name:"",done:false,recurWeeks:null,isException:false}; addHistoryEntry({type:"blocked",time:slot.time,name:label||"Lunch",dateKey});
    }
    setSlots(dateKey,slots); setBlockLabelModal(null); setBlockLabel("Lunch"); setSwipedSlot(null);
  };

  const exportData = function() {
    var data = {schedules:schedulesRef.current, clients:clientMemory, holidays:customHolidays, history:history, dayNotes:dayNotes, exportedAt:new Date().toISOString()};
    var blob = new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href=url; a.download="the-list-backup-"+(new Date().toISOString().split("T")[0])+".json"; a.click();
    URL.revokeObjectURL(url);
    showBanner({type:"added",msg:"Backup exported",time:null,dateKey:null});
  };

  const importData = function(e) {
    var file=e.target.files&&e.target.files[0];
    if (!file) return;
    var reader=new FileReader();
    reader.onload=function(ev) {
      try {
        var data=JSON.parse(ev.target.result);
        if (data.schedules) { setSchedules(migrateSchedules(data.schedules)); }
        if (data.clients) setClientMemory(data.clients);
        if (data.holidays) setCustomHolidays(data.holidays);
        if (data.history) setHistory(data.history);
        if (data.dayNotes) setDayNotes(data.dayNotes);
        showBanner({type:"added",name:"Backup restored",time:null,dateKey:null});
      } catch(err) { alert("Couldn't read that file."); }
    };
    reader.readAsText(file);
    e.target.value="";
  };

  const handleTouchStart = function(e,dateKey,idx) { touchStart.current={x:e.touches[0].clientX,dateKey,idx}; };
  const handleTouchEnd = function(e,dateKey,idx) {
    // Swipe gestures removed. Touch end no longer cancels/moves/blocks via swipe.
    touchStart.current=null;
  };

  // Redirect all subsequent pointer events for the active drag to the app root,
  // so a view switch that unmounts the source row can't fire pointercancel and
  // kill the drag. Wrapped in try/catch: if iOS refuses capture, the drag simply
  // degrades to the previous window-listener behavior.
  const captureDragPointer = function() {
    try {
      if (appRootRef.current && dragPointerId.current!=null && appRootRef.current.setPointerCapture) {
        appRootRef.current.setPointerCapture(dragPointerId.current);
      }
    } catch(e) {}
  };
  const releaseDragPointer = function() {
    try {
      if (appRootRef.current && dragPointerId.current!=null && appRootRef.current.releasePointerCapture) {
        appRootRef.current.releasePointerCapture(dragPointerId.current);
      }
    } catch(e) {}
    dragPointerId.current = null;
  };

  const startDragLongPress = function(dateKey, idx, touchX, touchY, isTouch) {
    if (dragLongPress.current) { clearTimeout(dragLongPress.current); dragLongPress.current = null; }
    dragTouchStart.current = {x: touchX||0, y: touchY||0};
    dragLongPress.current = setTimeout(function() {
      dragLongPress.current = null;
      var startX = dragTouchStart.current ? dragTouchStart.current.x : (touchX||0);
      var startY = dragTouchStart.current ? dragTouchStart.current.y : (touchY||0);
      dragTouchStart.current = null;
      var slot = getSlots(dateKey)[idx];
      if (!slot.name) return;
      var isMulti = selectMode && selectedSlots[dateKey+"-"+idx];
      if (isMulti) {
        var entries = Object.keys(selectedSlots).filter(function(k){ return selectedSlots[k]; });
        var mClients = entries.map(function(k){
          var parts = k.split("-"); var di = parseInt(parts[parts.length-1]); var dk2 = parts.slice(0,parts.length-1).join("-");
          var sl = getSlots(dk2)[di]; return {name:sl.name,price:sl.price,recurWeeks:sl.recurWeeks,originalTime:sl.time,originalDateKey:dk2,originalIdx:di};
        }).filter(function(c){ return c.name; });
        setDragState({clients:mClients,sourceKey:dateKey+"-"+idx,multi:true});
        if (isTouch) {
          dragPosRef.current = {x:startX, y:startY};
          dragOverRef.current = null; setDragOverKey(null);
          setIsLiveDragging(true);
          captureDragPointer();
        } else {
          setDragCalOpen(true); setDragCalMonth(new Date()); setDragCalHover(true);
        }
        playSound("lock");
        return;
      }
      // If this slot belongs to a group, the whole group travels together.
      if (slot.groupId) {
        var daySlots = getSlots(dateKey);
        var groupClients = daySlots.map(function(s,i){ return {s:s,i:i}; })
          .filter(function(o){ return o.s.groupId===slot.groupId && o.s.name; })
          .map(function(o){ return {name:o.s.name,price:o.s.price,recurWeeks:o.s.recurWeeks,originalTime:o.s.time,originalDateKey:dateKey,originalIdx:o.i}; });
        if (groupClients.length > 1) {
          setDragState({clients:groupClients,sourceKey:dateKey+"-"+idx,multi:true,group:true,label:slot.name});
          if (isTouch) {
            dragPosRef.current = {x:startX, y:startY};
            dragOverRef.current = null; setDragOverKey(null);
            setIsLiveDragging(true);
            captureDragPointer();
          } else {
            setDragCalOpen(true); setDragCalMonth(new Date()); setDragCalHover(true);
          }
          playSound("lock");
          return;
        }
      }
      var clients = [{name:slot.name,price:slot.price,recurWeeks:slot.recurWeeks,originalTime:slot.time,originalDateKey:dateKey,originalIdx:idx}];
      setDragState({clients,sourceKey:dateKey+"-"+idx,multi:false});
      if (isTouch) {
        // True drag-and-drop: lift the appointment and let it follow the finger.
        dragPosRef.current = {x:startX, y:startY};
        dragOverRef.current = null; setDragOverKey(null);
        setIsLiveDragging(true);
        captureDragPointer();
        playSound("lock");
      } else {
        // Mouse / desktop fallback: open the date picker.
        setDragCalOpen(true); setDragCalMonth(new Date()); setDragCalHover(true);
        playSound("lock");
      }
    }, 500);
  };
  const cancelDragLongPress = function() {
    if (dragLongPress.current) { clearTimeout(dragLongPress.current); dragLongPress.current = null; }
    dragTouchStart.current = null;
  };
  const cancelDragLongPressIfMoved = function(touchX, touchY) {
    if (!dragTouchStart.current) return;
    var dx = Math.abs(touchX - dragTouchStart.current.x);
    var dy = Math.abs(touchY - dragTouchStart.current.y);
    if (dx > 12 || dy > 12) { cancelDragLongPress(); }
  };
  const cancelDragPickup = function() {
    setDragState(null); setDragCalOpen(false); setDragCalHover(false);
  };

  // Tap-to-place: finish a single appointment move by tapping any open slot.
  // Used when a live drag crosses into another view (which can interrupt touch
  // tracking) so the move still lands reliably on whatever slot is tapped.
  const placeClientInSlot = function(targetDateKey, targetIdx) {
    var client = placingClient;
    if (!client) return;
    var targetSlot = getSlots(targetDateKey)[targetIdx];
    if (!targetSlot || targetSlot.name || targetSlot.blocked) return;
    // Recurring placement: the tapped slot anchors a whole series. No original
    // slot to vacate (this came from the check-off flow, not a move).
    if (client.recurBook) {
      var ok = bookRecurringFromPlacement(targetDateKey, targetIdx, client);
      if (ok) setPlacingClient(null);
      return;
    }
    if (client.originalDateKey === targetDateKey && client.originalIdx === targetIdx) { setPlacingClient(null); return; }
    var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    if (client.originalDateKey === targetDateKey) {
      var arr = [...getSlots(targetDateKey)];
      arr[targetIdx] = {...arr[targetIdx],name:client.name,price:client.price,recurWeeks:client.recurWeeks,isException:true,done:false};
      arr[client.originalIdx] = {...arr[client.originalIdx],name:"",price:"",done:false,recurWeeks:null,isException:false,groupId:null};
      setSlots(targetDateKey, arr);
    } else {
      var ts = [...getSlots(targetDateKey)];
      ts[targetIdx] = {...ts[targetIdx],name:client.name,price:client.price,recurWeeks:client.recurWeeks,isException:true,done:false};
      setSlots(targetDateKey, ts);
      var os = [...getSlots(client.originalDateKey)];
      os[client.originalIdx] = {...os[client.originalIdx],name:"",price:"",done:false,recurWeeks:null,isException:false,groupId:null};
      setSlots(client.originalDateKey, os);
    }
    addHistoryEntry({type:"rescheduled",time:targetSlot.time,name:client.name,price:client.price,dateKey:targetDateKey});
    setPlacingClient(null);
  };

  // Drop a picked-up appointment onto a visible empty slot (handles same-day and cross-day).
  const dropPickedUpOnSlot = function(targetDateKey, targetIdx) {
    var ds = dragStateRef.current;
    if (!ds || ds.multi) return false;
    var client = ds.clients[0];
    if (!client) return false;
    if (client.originalDateKey === targetDateKey && client.originalIdx === targetIdx) return false;
    var targetSlot = getSlots(targetDateKey)[targetIdx];
    if (!targetSlot || targetSlot.name || targetSlot.blocked) return false;
    // A recurring occurrence being dragged: don't move silently — ask whether this is
    // just this one or the whole series. Return true (handled); the caller clears the
    // drag UI and applySeriesDrop performs the move once the user chooses.
    if (client.recurWeeks != null) {
      var srcR = getSlots(client.originalDateKey)[client.originalIdx] || {};
      setSeriesEditModal({field:"drop", dateKey:client.originalDateKey, idx:client.originalIdx, targetDateKey:targetDateKey, targetIdx:targetIdx, name:client.name, price:client.price, recurWeeks:client.recurWeeks, pending:!!srcR.pending, oldTime:srcR.time||"", newTime:targetSlot.time});
      return true;
    }
    var sameDay = client.originalDateKey === targetDateKey;
    var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    if (sameDay) {
      var arr = [...getSlots(targetDateKey)];
      arr[targetIdx] = {...arr[targetIdx],name:client.name,price:client.price,recurWeeks:client.recurWeeks,isException:true,done:false};
      arr[client.originalIdx] = {...arr[client.originalIdx],name:"",price:"",done:false,recurWeeks:null,isException:false,groupId:null};
      setSlots(targetDateKey, arr);
    } else {
      var ts = [...getSlots(targetDateKey)];
      ts[targetIdx] = {...ts[targetIdx],name:client.name,price:client.price,recurWeeks:client.recurWeeks,isException:true,done:false};
      setSlots(targetDateKey, ts);
      var os = [...getSlots(client.originalDateKey)];
      os[client.originalIdx] = {...os[client.originalIdx],name:"",price:"",done:false,recurWeeks:null,isException:false,groupId:null};
      setSlots(client.originalDateKey, os);
    }
    addHistoryEntry({type:"rescheduled",time:targetSlot.time,name:client.name,price:client.price,dateKey:targetDateKey});
    return true;
  };

  // Drop a multi-selection onto a day: keep each person's own time where it's open,
  // and hand any conflicts to the existing reassign (tap-to-place) flow.
  const dropMultiOnDay = function(targetDateKey) {
    var ds = dragStateRef.current;
    if (!ds || !ds.multi) return false;
    var clients = ds.clients.filter(function(c){ return c.name; });
    if (clients.length === 0) return false;
    var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    var newSch = {...schedulesRef.current};
    var getDay = function(dk){ return newSch[dk] ? [...newSch[dk]] : DEFAULT_TIMES.map(function(t){ return {time:t,name:"",price:"",done:false,recurWeeks:null}; }); };
    // First lift everyone off their original slot so same-day moves don't collide with themselves.
    clients.forEach(function(c){
      var od = getDay(c.originalDateKey);
      if (od[c.originalIdx] && od[c.originalIdx].name===c.name) {
        od[c.originalIdx] = {...od[c.originalIdx],name:"",price:"",done:false,recurWeeks:null,isException:false,groupId:null};
        newSch[c.originalDateKey] = od;
      }
    });
    var placed = 0; var conflicts = [];
    clients.forEach(function(c){
      var day = getDay(targetDateKey);
      var targetTime = (c.originalTime||c.time);
      var ti = day.findIndex(function(s){ return s.time===targetTime; });
      if (ti < 0) ti = day.findIndex(function(s){ return !s.name && !s.blocked; });
      if (ti >= 0 && !day[ti].name && !day[ti].blocked) {
        day[ti] = {...day[ti],name:c.name,price:c.price,recurWeeks:c.recurWeeks,isException:true,done:false};
        newSch[targetDateKey] = day;
        placed++;
      } else {
        conflicts.push(c);
      }
    });
    setSchedules(newSch);
    setSelectMode(false); setSelectedSlots({});
    if (conflicts.length > 0) {
      var first = conflicts[0]; var rest = conflicts.slice(1);
      setBaseDate(parseDateKey(targetDateKey)); setView(isPhone?"Day":"3-Day");
      setReassignQueue(rest);
      setReassignMode({client:{name:first.name,price:first.price,recurWeeks:first.recurWeeks},currentDateKey:targetDateKey,remainingConflicts:[],originalDateKey:first.originalDateKey,originalIdx:first.originalIdx});
    } else {
      var mvNames = clients.map(function(c){ return c.name; }).filter(function(n){ return !!n; });
      var mvLabel = mvNames.length<=2 ? mvNames.join(" & ") : (mvNames.slice(0,-1).join(", ")+" & "+mvNames[mvNames.length-1]);
      showBanner({type:"rescheduled",msg:(mvLabel||(placed+" appointment"+(placed!==1?"s":"")))+" rescheduled",time:null,dateKey:null});
    }
    return true;
  };

  // Drop a same-day group onto a specific slot: pack the members into the open
  // slots starting at the one they were dropped on (instead of snapping them
  // back to their original times). Overflow goes to the tap-to-place picker.
  const dropGroupAtSlot = function(targetDateKey, targetIdx) {
    var ds = dragStateRef.current;
    if (!ds || !ds.multi) return false;
    var clients = ds.clients.filter(function(c){ return c.name; });
    if (clients.length === 0) return false;
    clients = clients.slice().sort(function(a,b){
      return timeToAbsMinutes(a.originalTime||a.time) - timeToAbsMinutes(b.originalTime||b.time);
    });
    var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    var newSch = {...schedulesRef.current};
    var getDay = function(dk){ return newSch[dk] ? [...newSch[dk]] : DEFAULT_TIMES.map(function(t){ return {time:t,name:"",price:"",done:false,recurWeeks:null}; }); };
    // Lift everyone off first so their old slots become available to repack into.
    clients.forEach(function(c){
      var od = getDay(c.originalDateKey);
      if (od[c.originalIdx] && od[c.originalIdx].name===c.name) {
        od[c.originalIdx] = {...od[c.originalIdx],name:"",price:"",done:false,recurWeeks:null,isException:false,groupId:null};
        newSch[c.originalDateKey] = od;
      }
    });
    var gid = clients.length > 1 ? newGroupId() : null;
    var day = getDay(targetDateKey);
    var cursor = targetIdx;
    var placed = 0; var conflicts = [];
    clients.forEach(function(c){
      while (cursor < day.length && (day[cursor].name || day[cursor].blocked)) cursor++;
      if (cursor < day.length) {
        day[cursor] = {...day[cursor],name:c.name,price:c.price,recurWeeks:c.recurWeeks,isException:true,done:false,groupId:gid};
        cursor++;
        placed++;
      } else {
        conflicts.push(c);
      }
    });
    newSch[targetDateKey] = day;
    setSchedules(newSch);
    setSelectMode(false); setSelectedSlots({});
    if (conflicts.length > 0) {
      var first = conflicts[0]; var rest = conflicts.slice(1);
      setBaseDate(parseDateKey(targetDateKey)); setView(isPhone?"Day":"3-Day");
      setReassignQueue(rest);
      setReassignMode({client:{name:first.name,price:first.price,recurWeeks:first.recurWeeks},currentDateKey:targetDateKey,remainingConflicts:[],originalDateKey:first.originalDateKey,originalIdx:first.originalIdx});
    } else {
      var mvNames2 = clients.map(function(c){ return c.name; }).filter(function(n){ return !!n; });
      var mvLabel2 = mvNames2.length<=2 ? mvNames2.join(" & ") : (mvNames2.slice(0,-1).join(", ")+" & "+mvNames2[mvNames2.length-1]);
      showBanner({type:"rescheduled",msg:(mvLabel2||(placed+" appointment"+(placed!==1?"s":"")))+" rescheduled",time:null,dateKey:null});
    }
    return true;
  };

  useEffect(function() {
    if (!isLiveDragging) return;
    if (dragChipRef.current) {
      dragChipRef.current.style.transform = "translate(" + (dragPosRef.current.x + 14) + "px," + (dragPosRef.current.y - 22) + "px)";
    }
    var findDropKey = function(x, y) {
      var el = document.elementFromPoint(x, y);
      while (el && !(el.dataset && el.dataset.droprow)) el = el.parentElement;
      if (el && el.dataset && el.dataset.droprow && el.dataset.dropfilled === "0" && el.dataset.dropblocked === "0") return el.dataset.droprow;
      return null;
    };
    // Forgiving version: if the exact point lands on a border/gap, sample just
    // above and below so a near-miss still finds the open slot.
    var findDropKeyNear = function(x, y) {
      var k = findDropKey(x, y);
      if (k) return k;
      var offs = [-9, 9, -18, 18];
      for (var i=0;i<offs.length;i++){ k = findDropKey(x, y+offs[i]); if (k) return k; }
      return null;
    };
    var findAnyRowKey = function(x, y) {
      var el = document.elementFromPoint(x, y);
      while (el && !(el.dataset && el.dataset.droprow)) el = el.parentElement;
      return (el && el.dataset && el.dataset.droprow) ? el.dataset.droprow : null;
    };
    var dayKeyFromRow = function(rowKey) {
      if (!rowKey) return null;
      var parts = rowKey.split("-"); parts.pop(); return parts.join("-");
    };
    var findViewTab = function(x, y) {
      var el = document.elementFromPoint(x, y);
      while (el && !(el.dataset && el.dataset.viewtab)) el = el.parentElement;
      return (el && el.dataset && el.dataset.viewtab) ? el.dataset.viewtab : null;
    };
    // A drop that lands on a Month-view day cell: open that day so the move can be
    // finished with a single tap-to-place.
    var findMonthDayKey = function(x, y) {
      var el = document.elementFromPoint(x, y);
      while (el && !(el.dataset && el.dataset.monthday)) el = el.parentElement;
      return (el && el.dataset && el.dataset.monthday) ? el.dataset.monthday : null;
    };
    // Only act on the pointer that started this drag (ignore stray pointers).
    var mine = function(e) { return dragPointerId.current==null || e.pointerId===dragPointerId.current; };
    var onMove = function(e) {
      if (!mine(e)) return;
      var px = e.clientX; var py = e.clientY;
      dragPosRef.current = {x:px, y:py};
      if (dragChipRef.current) dragChipRef.current.style.transform = "translate(" + (px + 14) + "px," + (py - 22) + "px)";
      // Hovering a view tab while dragging jumps into that view so off-screen days
      // become reachable. Pointer capture keeps the gesture alive across the switch.
      var vt = findViewTab(px, py);
      if (vt && vt !== viewRef.current) {
        if (vt === "Wknd") setBaseDate(getUpcomingWeekend());
        setView(vt);
      }
      var ds = dragStateRef.current;
      var key = (ds && ds.multi) ? findAnyRowKey(px, py) : findDropKeyNear(px, py);
      if (key !== dragOverRef.current) { dragOverRef.current = key; setDragOverKey(key); }
    };
    var onEnd = function(e) {
      if (!mine(e)) return;
      var ds = dragStateRef.current;
      var px = (e.clientX!=null) ? e.clientX : (dragPosRef.current ? dragPosRef.current.x : null);
      var py = (e.clientY!=null) ? e.clientY : (dragPosRef.current ? dragPosRef.current.y : null);
      var landed = false;
      if (ds && ds.multi) {
        var anyKey = dragOverRef.current || (px!=null ? findAnyRowKey(px, py) : null);
        var dayKey = dayKeyFromRow(anyKey);
        if (dayKey) {
          var allSameDay = ds.clients.every(function(c){ return c.originalDateKey === dayKey; });
          if (allSameDay && anyKey) {
            var gp = anyKey.split("-"); var gi = parseInt(gp[gp.length-1]);
            landed = dropGroupAtSlot(dayKey, gi);
          } else {
            landed = dropMultiOnDay(dayKey);
          }
        }
        // Dropped on a Month-view day: drop everyone onto that day.
        if (!landed && px!=null) {
          var mdkM = findMonthDayKey(px, py);
          if (mdkM) landed = dropMultiOnDay(mdkM);
        }
      } else {
        var key = dragOverRef.current;
        if (!key && px!=null) key = findDropKeyNear(px, py);
        if (key) {
          var parts = key.split("-"); var di = parseInt(parts[parts.length-1]); var dk2 = parts.slice(0,parts.length-1).join("-");
          landed = dropPickedUpOnSlot(dk2, di);
        }
        // Dropped on a Month-view day cell: open that day in Day view and finish
        // the move with one tap-to-place on whatever open slot they choose.
        if (!landed && px!=null) {
          var mdk = findMonthDayKey(px, py);
          if (mdk) {
            setBaseDate(parseDateKey(mdk)); setView(isPhone?"Day":"3-Day");
            if (ds && ds.clients && ds.clients[0]) setPlacingClient(ds.clients[0]);
            landed = true;
          }
        }
        // Released somewhere that wasn't an open slot (e.g. mid-switch): don't drop
        // the move on the floor. Hand the still-intact appointment to tap-to-place
        // so the next tap on any open slot — in any view — completes it.
        if (!landed && ds && ds.clients && ds.clients[0]) {
          setPlacingClient(ds.clients[0]);
        }
      }
      releaseDragPointer();
      setIsLiveDragging(false);
      dragOverRef.current = null; setDragOverKey(null);
      setDragState(null);
    };
    var onCancel = function(e) {
      if (!mine(e)) return;
      // Rare with pointer capture, but if the OS still aborts: complete the drop if
      // the finger was over an open slot, otherwise hand a single move to
      // tap-to-place and a group/multi move to the picker.
      releaseDragPointer();
      setIsLiveDragging(false);
      var overKey = dragOverRef.current;
      dragOverRef.current = null; setDragOverKey(null);
      var ds = dragStateRef.current;
      if (!ds) return;
      if (ds.multi) {
        setDragCalOpen(true); setDragCalMonth(new Date()); setDragCalHover(true);
      } else {
        var landedCancel = false;
        if (overKey) {
          var cp = overKey.split("-"); var ci = parseInt(cp[cp.length-1]); var cdk = cp.slice(0,cp.length-1).join("-");
          landedCancel = dropPickedUpOnSlot(cdk, ci);
        }
        if (!landedCancel) setPlacingClient(ds.clients[0]);
        setDragState(null);
      }
    };
    // Suppress Safari's scroll-takeover for the duration of the drag. Pointer
    // capture mostly handles this, but a non-passive touchmove block is the only
    // thing iOS standalone PWAs reliably honor.
    var touchBlocker = function(ev) { if (ev.cancelable) ev.preventDefault(); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("touchmove", touchBlocker, {passive:false});
    return function() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("touchmove", touchBlocker, {passive:false});
    };
  }, [isLiveDragging]);

  const selectRangeInDay = function(dateKey, fromIdx, toIdx) {
    var lo=Math.min(fromIdx,toIdx); var hi=Math.max(fromIdx,toIdx);
    var slots=getSlots(dateKey);
    setSelectedSlots(function(prev){
      var n={...prev};
      for (var i=lo;i<=hi;i++) { if (slots[i]&&slots[i].name) n[dateKey+"-"+i]=true; }
      return n;
    });
  };
  const startSelectDrag = function(dateKey, idx) {
    selectDragAnchor.current={dateKey,idx};
    setSelectedSlots(function(prev){ var n={...prev}; if(n[dateKey+"-"+idx]) delete n[dateKey+"-"+idx]; else n[dateKey+"-"+idx]=true; return n; });
  };
  const extendSelectDrag = function(dateKey, idx) {
    var a=selectDragAnchor.current;
    if (!a || a.dateKey!==dateKey) return;
    selectRangeInDay(dateKey, a.idx, idx);
  };
  const endSelectDrag = function() { selectDragAnchor.current=null; };

  const handleDragDrop = function(targetDateKey) {
    if (!dragState) return;
    var clients = dragState.clients;
    setDragCalOpen(false); setDragState(null); setDragCalHover(false);
    setSelectMode(false); setSelectedSlots({});
    setBaseDate(parseDateKey(targetDateKey)); setView(isPhone?"Day":"3-Day");
    var first = clients[0]; var rest = clients.slice(1);
    setReassignQueue(rest);
    setReassignMode({client:{name:first.name,price:first.price,recurWeeks:first.recurWeeks},currentDateKey:targetDateKey,remainingConflicts:[],originalDateKey:first.originalDateKey,originalIdx:first.originalIdx});
  };

  const handleSlotDrop = function(targetDateKey, targetIdx) {
    if (!dragState || dragState.multi) return;
    var client = dragState.clients[0];
    if (client.originalDateKey===targetDateKey && client.originalIdx===targetIdx) { setDragState(null); setDragCalOpen(false); return; }
    var targetSlot = getSlots(targetDateKey)[targetIdx];
    if (targetSlot.name || targetSlot.blocked) { setDragState(null); setDragCalOpen(false); return; }
    if (client.recurWeeks != null) {
      var srcM = getSlots(client.originalDateKey)[client.originalIdx] || {};
      setSeriesEditModal({field:"drop", dateKey:client.originalDateKey, idx:client.originalIdx, targetDateKey:targetDateKey, targetIdx:targetIdx, name:client.name, price:client.price, recurWeeks:client.recurWeeks, pending:!!srcM.pending, oldTime:srcM.time||"", newTime:targetSlot.time});
      setDragState(null); setDragCalOpen(false);
      return;
    }
    var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))}; pushUndo(snapshot);
    var ts = [...getSlots(targetDateKey)];
    ts[targetIdx] = {...ts[targetIdx],name:client.name,price:client.price,recurWeeks:client.recurWeeks,done:false};
    setSlots(targetDateKey, ts);
    var os = [...getSlots(client.originalDateKey)];
    os[client.originalIdx] = {...os[client.originalIdx],name:"",price:"",done:false,recurWeeks:null,isException:false};
    setSlots(client.originalDateKey, os);
    addHistoryEntry({type:"added",time:ts[targetIdx].time,name:client.name,price:client.price,dateKey:targetDateKey});
    setDragState(null); setDragCalOpen(false);
  };

  const handleReassignSlotTapWithQueue = function(dateKey, idx) {
    if (!reassignMode || reassignMode.currentDateKey !== dateKey) return;
    var client = reassignMode.client; var rc = reassignMode.remainingConflicts;
    var slots = [...getSlots(dateKey)]; var slot = slots[idx];
    if (slot.name) return;
    var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))}; pushUndo(snapshot);
    var ns = [...slots]; ns[idx] = {...slot,name:client.name,price:client.price,recurWeeks:client.recurWeeks,isException:true,done:false};
    setSlots(dateKey, ns); addHistoryEntry({type:"added",time:slot.time,name:client.name,price:client.price,dateKey});
    if (reassignMode.originalDateKey && reassignMode.originalIdx !== undefined) {
      var os = [...getSlots(reassignMode.originalDateKey)]; var os2 = os[reassignMode.originalIdx];
      os[reassignMode.originalIdx] = {...os2,name:"",price:"",done:false,recurWeeks:null,isException:false};
      setSlots(reassignMode.originalDateKey, os);
      addHistoryEntry({type:"removed",time:os2.time,name:client.name,dateKey:reassignMode.originalDateKey});
    }
    if (reassignQueue.length > 0) {
      var next = reassignQueue[0]; var rest = reassignQueue.slice(1);
      setReassignQueue(rest);
      setReassignMode({client:{name:next.name,price:next.price,recurWeeks:next.recurWeeks},currentDateKey:dateKey,remainingConflicts:[],originalDateKey:next.originalDateKey,originalIdx:next.originalIdx});
    } else {
      setReassignMode(null);
      if (rc.length > 0) setReassignApplyAll({altTime:slot.time,remainingConflicts:rc,client});
    }
  };

  const dates = getDates();
  const effectiveNextDate = nudgedDate||(checkoffModal&&checkoffModal.nextDateKey);
  const nudgeConflict = effectiveNextDate?isSlotTaken(effectiveNextDate,checkoffModal&&checkoffModal.slot&&placementTime(checkoffModal.slot),checkoffModal&&checkoffModal.slot&&checkoffModal.slot.name):false;
  // #11: if this same person already has a (not-done) booking on the proposed next
  // date, never tell Granger the slot "is open" — it isn't; they're in it. Report the
  // exact day/time they're already on instead.
  const bookedTimeOnNextDate = (function(){
    if (!effectiveNextDate||!checkoffModal||!checkoffModal.slot||!checkoffModal.slot.name) return null;
    var dsN = schedulesRef.current[effectiveNextDate]; if (!dsN) return null;
    var lnN = checkoffModal.slot.name.toLowerCase(); var bi;
    for (bi=0; bi<dsN.length; bi++) { if (dsN[bi].name && dsN[bi].name.toLowerCase()===lnN && !dsN[bi].done) return dsN[bi].time; }
    return null;
  })();
  const alreadyBookedNextDate = bookedTimeOnNextDate!=null;

  const renderCheckoffCalendar = function() {
    if (!checkoffModal||!checkoffCalMonth) return null;
    var slot=checkoffModal.slot;
    var today=new Date(); var sixMo=new Date(); sixMo.setMonth(sixMo.getMonth()+6);
    var year=checkoffCalMonth.getFullYear(); var month=checkoffCalMonth.getMonth();
    var firstDay=new Date(year,month,1); var lastDay=new Date(year,month+1,0);
    var startDow=firstDay.getDay()===0?6:firstDay.getDay()-1;
    var cells=[];
    for (var i=0;i<startDow;i++) cells.push(null);
    for (var d=1;d<=lastDay.getDate();d++) cells.push(new Date(year,month,d));
    var monthLabel=checkoffCalMonth.toLocaleDateString("en-US",{month:"long",year:"numeric"});
    var canGoPrev=new Date(year,month-1,1)>=new Date(today.getFullYear(),today.getMonth(),1);
    var canGoNext=new Date(year,month+1,1)<=new Date(sixMo.getFullYear(),sixMo.getMonth(),1);
    // #14: mark where 2/4/6/8 weeks land, counted from the appointment day being
    // rebooked (checkoffModal.dateKey — usually today, but not always).
    var weekMarks={};
    if (checkoffModal&&checkoffModal.dateKey) {
      [2,4,6,8].forEach(function(w){ weekMarks[toDateKey(addWeeks(parseDateKey(checkoffModal.dateKey),w))]=w; });
    }
    return (
      <div style={{marginTop:"4px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"10px"}}>
          <button onClick={function(){ if(canGoPrev) setCheckoffCalMonth(new Date(year,month-1,1)); }} style={{background:"none",border:"none",color:canGoPrev?"#666":"#ddd",cursor:canGoPrev?"pointer":"default",fontSize:"20px",padding:"2px 10px",fontFamily:"inherit"}}>{"‹"}</button>
          <div style={{fontSize:"13px",color:"#1a1a1a",letterSpacing:"0.05em"}}>{monthLabel}</div>
          <button onClick={function(){ if(canGoNext) setCheckoffCalMonth(new Date(year,month+1,1)); }} style={{background:"none",border:"none",color:canGoNext?"#666":"#ddd",cursor:canGoNext?"pointer":"default",fontSize:"20px",padding:"2px 10px",fontFamily:"inherit"}}>{"›"}</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"1px",marginBottom:"3px"}}>
          {["M","T","W","T","F","S","S"].map(function(lbl,i){ return <div key={i} style={{textAlign:"center",fontSize:"10px",color:"#aaa",padding:"3px 0"}}>{lbl}</div>; })}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"3px"}}>
          {cells.map(function(day,i) {
            if (!day) return <div key={"e"+i} style={{height:"44px"}}/>;
            var dk=toDateKey(day); var isPast=day<today&&!isToday(day); var isFuture=day>sixMo;
            var holiday=getHolidayForDate(dk); var daySlots=getSlots(dk);
            var bookedSlots=daySlots.filter(function(s){ return s.name; });
            var isT=isToday(day); var disabled=isPast||isFuture;
            var range=getDayTimeRange(dk);
            return (
              <div key={dk} onClick={function(){ if(!disabled){ if(checkoffRecur) bookRecurringFromModal(dk,checkoffRecur); else if(checkoffModal.groupTimes&&checkoffModal.groupTimes.length>1) confirmNextBooking(dk); else jumpToDateForBooking(dk,slot); } }}
                style={{position:"relative",height:"44px",background:disabled?"#f8f8f8":holiday?"#fffbf0":isT?"#fffbf0":"#ffffff",borderTop:isT?"2px solid #a07830":"2px solid transparent",padding:"4px 5px",cursor:disabled?"default":"pointer",borderRadius:"3px",opacity:disabled?0.35:1,boxSizing:"border-box"}}>
                {!disabled&&weekMarks[dk]&&<div style={{position:"absolute",top:"2px",right:"2px",fontSize:"8px",fontWeight:"bold",color:"#a07830",background:"#fdf3df",borderRadius:"3px",padding:"1px 2px",lineHeight:1}}>{weekMarks[dk]+"w"}</div>}
                <div style={{fontSize:"12px",color:isT?"#a07830":disabled?"#ccc":"#1a1a1a",fontWeight:isT?"bold":"normal",lineHeight:1}}>{day.getDate()}</div>
                {!disabled&&(
                  <div style={{marginTop:"3px"}}>
                    <div style={{display:"flex",flexWrap:"wrap",gap:"2px",marginBottom:"1px"}}>
                      {bookedSlots.slice(0,4).map(function(s,j){ return <div key={j} style={{width:"5px",height:"5px",borderRadius:"50%",background:s.recurWeeks?"#6a8aaa":"#c9a96e"}}/>; })}
                    </div>
                    {range&&<div style={{fontSize:"7px",color:"#aaa",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{range}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{display:"flex",gap:"14px",marginTop:"10px",paddingTop:"8px",borderTop:"1px solid #f0f0ee"}}>
          <div style={{display:"flex",alignItems:"center",gap:"4px"}}><div style={{width:"7px",height:"7px",borderRadius:"50%",background:"#6a8aaa"}}/><span style={{fontSize:"10px",color:"#aaa"}}>recurring</span></div>
          <div style={{display:"flex",alignItems:"center",gap:"4px"}}><div style={{width:"7px",height:"7px",borderRadius:"50%",background:"#c9a96e"}}/><span style={{fontSize:"10px",color:"#aaa"}}>booked</span></div>
        </div>
      </div>
    );
  };

  var canUndo = undoStack.length>0;
  var canRedo = redoStack.length>0;

  var screenWrap = {height:"100dvh",display:"flex",alignItems:"center",justifyContent:"center",background:"#ffffff",fontFamily:"Georgia,serif",color:"#1a1a1a",padding:"24px",boxSizing:"border-box"};
  if (!authChecked) {
    return (<div style={screenWrap}><div style={{color:"#999",fontSize:"14px",letterSpacing:"0.08em"}}>Loading…</div></div>);
  }
  if (!authUser) {
    var doSignIn = function() {
      if (authBusy) return;
      setAuthError(""); setAuthNotice(""); setAuthBusy(true);
      signInWithEmailAndPassword(fbAuth, authEmail.trim(), authPassword).then(function(){ setAuthBusy(false); setAuthPassword(""); }).catch(function(err){ setAuthBusy(false); setAuthError(err && err.message ? err.message : "Could not sign in."); });
    };
    var doSignUp = function() {
      if (authBusy) return;
      setAuthError(""); setAuthNotice(""); setAuthBusy(true);
      createUserWithEmailAndPassword(fbAuth, authEmail.trim(), authPassword).then(function(){ setAuthBusy(false); setAuthPassword(""); }).catch(function(err){ setAuthBusy(false); setAuthError(err && err.message ? err.message : "Could not create account."); });
    };
    var doReset = function() {
      if (!authEmail.trim()) { setAuthError("Enter your email first, then tap reset."); return; }
      setAuthError(""); setAuthNotice("");
      sendPasswordResetEmail(fbAuth, authEmail.trim()).then(function(){ setAuthNotice("Password reset email sent."); }).catch(function(err){ setAuthError(err && err.message ? err.message : "Could not send reset email."); });
    };
    var onAuthKey = function(e) { if (e.key==="Enter") { if (authMode==="signup") doSignUp(); else doSignIn(); } };
    return (
      <div style={screenWrap}>
        <div style={{width:"min(360px,92vw)",border:"1px solid #e4e4e2",borderRadius:"16px",padding:"32px 28px",boxShadow:"0 8px 32px rgba(0,0,0,0.06)"}}>
          <div style={{fontSize:"11px",letterSpacing:"0.25em",textTransform:"uppercase",color:"#c9a96e",marginBottom:"6px"}}>The List</div>
          <div style={{fontSize:"22px",marginBottom:"20px"}}>{authMode==="signup"?"Create your account":"Sign in"}</div>
          <input value={authEmail} onChange={function(e){ setAuthEmail(e.target.value); }} onKeyDown={onAuthKey} placeholder="Email" type="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} style={{width:"100%",boxSizing:"border-box",marginBottom:"10px",background:"#efefed",border:"1px solid #d8d8d6",borderRadius:"8px",padding:"11px 12px",fontSize:"15px",fontFamily:"Georgia,serif",color:"#1a1a1a",outline:"none"}}/>
          <input value={authPassword} onChange={function(e){ setAuthPassword(e.target.value); }} onKeyDown={onAuthKey} placeholder="Password" type="password" style={{width:"100%",boxSizing:"border-box",marginBottom:"16px",background:"#efefed",border:"1px solid #d8d8d6",borderRadius:"8px",padding:"11px 12px",fontSize:"15px",fontFamily:"Georgia,serif",color:"#1a1a1a",outline:"none"}}/>
          {authError && (<div style={{fontSize:"12px",color:"#c0392b",marginBottom:"12px"}}>{authError}</div>)}
          {authNotice && (<div style={{fontSize:"12px",color:"#2a7a2a",marginBottom:"12px"}}>{authNotice}</div>)}
          <button onClick={authMode==="signup"?doSignUp:doSignIn} style={{width:"100%",padding:"12px",background:"#c9a96e",border:"none",borderRadius:"8px",color:"#0f0f0f",cursor:"pointer",fontFamily:"inherit",fontSize:"14px",marginBottom:"12px",opacity:authBusy?0.6:1}}>{authBusy?"Please wait…":(authMode==="signup"?"Create account":"Sign in")}</button>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <button onClick={function(){ setAuthError(""); setAuthNotice(""); setAuthMode(authMode==="signup"?"signin":"signup"); }} style={{background:"none",border:"none",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",padding:0}}>{authMode==="signup"?"Have an account? Sign in":"New here? Create account"}</button>
            <button onClick={doReset} style={{background:"none",border:"none",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",padding:0}}>Forgot password?</button>
          </div>
        </div>
      </div>
    );
  }
  if (!hydrated) {
    return (<div style={screenWrap}><div style={{color:"#999",fontSize:"14px",letterSpacing:"0.08em"}}>Loading your schedule…</div></div>);
  }

  return (
    <div ref={appRootRef} style={{height:"100dvh",overflow:"hidden",boxSizing:"border-box",display:"flex",flexDirection:"column",background:"#ffffff",fontFamily:"Georgia,serif",color:"#1a1a1a",paddingTop:(reassignMode||placingClient)?"calc(env(safe-area-inset-top,0px) + 52px)":"0"}}
      onMouseUp={function(){ endSelectDrag(); if(dragState&&!dragCalHover) { setDragState(null); setDragCalOpen(false); } }}
      onTouchStart={function(e){
        // Record touch start for swipe-to-navigate (horizontal swipe on the app chrome,
        // not inside a slot row or modal). Only track single-finger touches.
        if (isLiveDraggingRef.current) return;
        if (e.touches.length !== 1) return;
        swipeNavStart.current = {x:e.touches[0].clientX, y:e.touches[0].clientY};
      }}
      onTouchEnd={function(e){
        endSelectDrag();
        // Swipe-to-navigate: require ≥55px horizontal travel and mostly horizontal
        // direction (horizontal travel > 2× the vertical travel). Bail out if a drag
        // is active or a slot is being edited. A drag needs a 500ms long-press to lift
        // and any finger movement cancels that timer, so a quick horizontal swipe can
        // never start a drag — it is safe to let the swipe run even over slot rows.
        if (swipeNavStart.current && !isLiveDraggingRef.current && !dragState && !editingCell && e.changedTouches.length===1) {
          var dx = e.changedTouches[0].clientX - swipeNavStart.current.x;
          var dy = e.changedTouches[0].clientY - swipeNavStart.current.y;
          if (Math.abs(dx) >= 55 && Math.abs(dx) > Math.abs(dy) * 2) {
            if (dx < 0) {
              // Swipe left → go forward (next day/period)
              if (view==="Month") { setBaseDate(function(d){ var nd=new Date(d); nd.setMonth(nd.getMonth()+1); return nd; }); }
              else { setBaseDate(function(d){ return addDays(d,1); }); setNavAnim(function(p){ return {n:p.n+1,dir:1}; }); }
            } else {
              // Swipe right → go back (previous day/period)
              if (view==="Month") { setBaseDate(function(d){ var nd=new Date(d); nd.setMonth(nd.getMonth()-1); return nd; }); }
              else { setBaseDate(function(d){ return addDays(d,-1); }); setNavAnim(function(p){ return {n:p.n+1,dir:-1}; }); }
            }
          }
        }
        swipeNavStart.current = null;
      }}>

      {/* Build stamp — lets the deploy be verified at a glance. Bump on each push.
          TEMP (v16): tap it to show/hide the measurement readout. */}
      <div style={{position:"fixed",left:"4px",bottom:"calc(env(safe-area-inset-bottom,0px) + 2px)",zIndex:2700,fontSize:"9px",letterSpacing:"0.08em",color:"rgba(140,140,140,0.55)",fontFamily:"Georgia,serif"}}>v23</div>

      {/* TEMP (v23): one-time wipe for the tangled James record. Tap once, confirm,
          verify he's gone everywhere, then this button is removed next build. */}
      <button onClick={function(){ wipeTangledClient(); }} style={{position:"fixed",left:"40px",bottom:"calc(env(safe-area-inset-bottom,0px) + 1px)",zIndex:2700,background:"#b03a3a",color:"#fff",border:"none",borderRadius:"6px",padding:"4px 9px",fontSize:"10px",fontFamily:"inherit",letterSpacing:"0.04em",boxShadow:"0 2px 8px rgba(0,0,0,0.3)"}}>Wipe James (1×)</button>

      {/* Kill the browser's double-tap-to-zoom and the legacy 300ms tap delay so the app
          feels native and our own double-tap-to-mark-available gesture wins. "manipulation"
          still allows normal one-finger panning and two-finger pinch-zoom. */}
      <style>{"html,body,#root{height:100%;margin:0;padding:0}body{overflow:hidden}html,body,#root,*{touch-action:manipulation;-webkit-text-size-adjust:100%}@keyframes tlInRight{from{transform:translateX(42px);opacity:0.35}to{transform:translateX(0);opacity:1}}@keyframes tlInLeft{from{transform:translateX(-42px);opacity:0.35}to{transform:translateX(0);opacity:1}}"}</style>

      {banner && (
        <div
          onTouchStart={function(e){ if(e.touches&&e.touches.length===1){ bannerTouchStart.current=e.touches[0].clientY; } }}
          onTouchMove={function(e){ if(bannerTouchStart.current==null||!e.touches||!e.touches.length) return; var dy=e.touches[0].clientY-bannerTouchStart.current; setBannerSwipeY(Math.min(0,dy)); }}
          onTouchEnd={function(){ var dy=bannerSwipeY; bannerTouchStart.current=null; if(dy<-30){ dismissBanner(); } else { setBannerSwipeY(0); } }}
          style={{position:"fixed",left:"50%",top:isPhone?"auto":(gridTopY>0?(gridTopY/2+"px"):listTopY>0?(listTopY/2+"px"):"calc(env(safe-area-inset-top,0px) + 8px)"),bottom:isPhone?"calc(env(safe-area-inset-bottom,0px) + 18px)":"auto",transform:((!isPhone&&(gridTopY>0||listTopY>0))?"translate(-50%,-50%)":"translateX(-50%)")+" translateY("+bannerSwipeY+"px)",opacity:Math.max(0.2,1+bannerSwipeY/80),transition:bannerSwipeY===0?"transform 0.2s ease, opacity 0.2s ease":"none",zIndex:2000,background:getBannerColor(banner.type),color:"#fff",padding:"6px 14px",borderRadius:"20px",fontSize:"12px",letterSpacing:"0.04em",boxShadow:"0 2px 12px rgba(0,0,0,0.2)",display:"flex",alignItems:"center",gap:"10px",maxWidth:"90vw",pointerEvents:"auto",touchAction:"none"}}>
          <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{describeBanner(banner)}</span>
          {(banner.type!=="undo"&&banner.type!=="redo"&&canUndo)&&(
            <button onClick={handleUndo} title="Undo" style={{background:"rgba(255,255,255,0.22)",border:"none",borderRadius:"10px",color:"#fff",padding:"4px 9px",cursor:"pointer",fontFamily:"inherit",flexShrink:0,display:"flex",alignItems:"center"}}><UndoIcon size={15} color="#fff"/></button>
          )}
        </div>
      )}

      {isLiveDragging && dragState && (
        <div ref={dragChipRef}
          style={{position:"fixed",left:0,top:0,zIndex:3000,pointerEvents:"none",background:"#1a1a1a",color:"#fff",padding:"8px 14px",borderRadius:"9px",fontSize:"14px",fontFamily:"Georgia,serif",boxShadow:"0 8px 24px rgba(0,0,0,0.35)",whiteSpace:"nowrap",transform:"translate(" + (dragPosRef.current.x + 14) + "px," + (dragPosRef.current.y - 22) + "px)"}}>
          {dragState.clients.length>1 ? (dragState.clients.length+" appointments") : dragState.clients[0].name}
        </div>
      )}

      {dragCalOpen && dragState && (
        <div style={{position:"fixed",inset:0,zIndex:1500,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}}
          onClick={cancelDragPickup}>
          <div
            style={{background:"#fff",border:"1px solid #d8d8d6",borderRadius:"16px",boxShadow:"0 8px 32px rgba(0,0,0,0.18)",padding:"20px",width:"min(340px,92vw)",boxSizing:"border-box"}}
            onClick={function(e){ e.stopPropagation(); }}
          >
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#c9a96e",marginBottom:"4px"}}>Move to…</div>
            <div style={{fontSize:"16px",color:"#1a1a1a",marginBottom:"4px"}}>
              {dragState.clients.length>1 ? (dragState.clients.length+" appointments") : dragState.clients[0].name}
            </div>
            <div style={{fontSize:"12px",color:"#999",marginBottom:"16px"}}>Tap a date to reschedule</div>
            {dragCalMonth && (function(){
              var year=dragCalMonth.getFullYear(); var month=dragCalMonth.getMonth();
              var firstDay=new Date(year,month,1); var lastDay=new Date(year,month+1,0);
              var sdow=firstDay.getDay()===0?6:firstDay.getDay()-1;
              var cells=[]; for(var i=0;i<sdow;i++) cells.push(null);
              for(var d=1;d<=lastDay.getDate();d++) cells.push(new Date(year,month,d));
              var ml=dragCalMonth.toLocaleDateString("en-US",{month:"long",year:"numeric"});
              return (
                <div>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"12px"}}>
                    <button onClick={function(){ setDragCalMonth(new Date(year,month-1,1)); }} style={{background:"#f4f4f2",border:"1px solid #e4e4e2",borderRadius:"6px",color:"#666",cursor:"pointer",fontSize:"18px",padding:"4px 12px",fontFamily:"inherit"}}>{"‹"}</button>
                    <div style={{fontSize:"14px",color:"#1a1a1a"}}>{ml}</div>
                    <button onClick={function(){ setDragCalMonth(new Date(year,month+1,1)); }} style={{background:"#f4f4f2",border:"1px solid #e4e4e2",borderRadius:"6px",color:"#666",cursor:"pointer",fontSize:"18px",padding:"4px 12px",fontFamily:"inherit"}}>{"›"}</button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"3px"}}>
                    {["M","T","W","T","F","S","S"].map(function(l,i){ return <div key={i} style={{textAlign:"center",fontSize:"10px",color:"#aaa",paddingBottom:"4px"}}>{l}</div>; })}
                    {cells.map(function(day,i){
                      if (!day) return <div key={"e"+i}/>;
                      var dk=toDateKey(day); var isT=isToday(day);
                      return (
                        <div key={dk}
                          onClick={function(){ handleDragDrop(dk); }}
                          style={{textAlign:"center",fontSize:"14px",color:isT?"#a07830":"#1a1a1a",fontWeight:isT?"bold":"normal",padding:"10px 2px",borderRadius:"6px",cursor:"pointer",background:isT?"#fffbf0":"#f8f8f6",border:"1px solid #efefed"}}
                          onMouseEnter={function(e){ e.currentTarget.style.background="#e8e8e6"; }}
                          onMouseLeave={function(e){ e.currentTarget.style.background=isT?"#fffbf0":"#f8f8f6"; }}
                        >{day.getDate()}</div>
                      );
                    })}
                  </div>
                  <button onClick={cancelDragPickup} style={{display:"block",width:"100%",marginTop:"16px",padding:"10px",background:"none",border:"1px solid #d8d8d6",borderRadius:"8px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Cancel</button>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {monthLongPress && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={function(){ setMonthLongPress(null); }}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(280px,90vw)"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"13px",color:"#888",marginBottom:"16px",textAlign:"center"}}>{smartDate(monthLongPress.day)}</div>
            <button onClick={function(){ setBaseDate(monthLongPress.day);setView(isPhone?"Day":"3-Day");setMonthLongPress(null); }} style={{display:"block",width:"100%",padding:"12px",background:"#1a1a1a",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"14px",marginBottom:"10px"}}>Add appointment</button>
            <button onClick={function(){ setHolidayModal({dateKey:monthLongPress.dateKey});setMonthLongPress(null); }} style={{display:"block",width:"100%",padding:"12px",background:"#fff",border:"1px solid #d8d8d6",borderRadius:"8px",color:"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"14px",marginBottom:"10px"}}>Mark as holiday</button>
            <button onClick={function(){ setMonthLongPress(null); }} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#bbb",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Cancel</button>
          </div>
        </div>
      )}

      {groupConfirm && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={function(){ setGroupConfirm(null); }}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(320px,92vw)"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>{groupConfirm.action==="cancel"?"Cancel Appointment":"Reschedule"}</div>
            <div style={{fontSize:"16px",color:"#1a1a1a",marginBottom:"6px"}}>{groupConfirm.name}</div>
            <div style={{fontSize:"12px",color:"#888",marginBottom:"20px"}}>This slot is part of a group. {groupConfirm.action==="cancel"?"Cancel":"Reschedule"} just this one, or all of {groupConfirm.name}'s slots?</div>
            <button onClick={function(){ if(groupConfirm.action==="cancel") cancelGroupSlots(groupConfirm.dateKey,groupConfirm.groupId,groupConfirm.idx); else rescheduleGroupSlots(groupConfirm.dateKey,groupConfirm.groupId,groupConfirm.idx); }} style={{display:"block",width:"100%",padding:"11px",background:"#1a1a1a",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",marginBottom:"8px"}}>Just this one slot</button>
            <button onClick={function(){ if(groupConfirm.action==="cancel") cancelGroupSlots(groupConfirm.dateKey,groupConfirm.groupId,undefined); else rescheduleGroupSlots(groupConfirm.dateKey,groupConfirm.groupId,undefined); }} style={{display:"block",width:"100%",padding:"11px",background:"#fff",border:"1px solid #d8d8d6",borderRadius:"8px",color:"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",marginBottom:"8px"}}>All of {groupConfirm.name}'s slots</button>
            <button onClick={function(){ setGroupConfirm(null); }} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#bbb",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Never mind</button>
          </div>
        </div>
      )}

      {groupRecurModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={function(){ setGroupRecurModal(null); }}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(340px,92vw)"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>Set Recurring</div>
            <div style={{fontSize:"16px",color:"#1a1a1a",marginBottom:"6px"}}>{groupRecurModal.slot.name}</div>
            <div style={{fontSize:"12px",color:"#888",marginBottom:"16px"}}>This slot is part of a group of {groupRecurModal.groupSlots.length}. How many slots should recur?</div>
            <div style={{display:"flex",gap:"8px",marginBottom:"16px"}}>
              <button onClick={function(){ setGroupRecurModal(function(p){ return {...p,recurCount:1}; }); }} style={{flex:1,padding:"10px",background:groupRecurModal.recurCount===1?"#1a1a1a":"#f4f4f2",border:groupRecurModal.recurCount===1?"1px solid #1a1a1a":"1px solid #d8d8d6",borderRadius:"8px",color:groupRecurModal.recurCount===1?"#fff":"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Just this slot</button>
              {groupRecurModal.groupSlots.map(function(_,i){ return i===0?null:(
                <button key={i+1} onClick={function(){ setGroupRecurModal(function(p){ return {...p,recurCount:i+1}; }); }} style={{flex:1,padding:"10px",background:groupRecurModal.recurCount===i+1?"#1a1a1a":"#f4f4f2",border:groupRecurModal.recurCount===i+1?"1px solid #1a1a1a":"1px solid #d8d8d6",borderRadius:"8px",color:groupRecurModal.recurCount===i+1?"#fff":"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>All {i+1} slots</button>
              ); })}
            </div>
            {groupRecurModal.recurCount && (
              <div>
                <div style={{fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>Every how many weeks?</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:"6px",marginBottom:"16px"}}>
                  {[1,2,3,4,5,6,7,8].map(function(w){ return (
                    <button key={w} onClick={function(){ setGroupRecurModal(function(p){ return {...p,weeks:w}; }); }} style={{padding:"7px 12px",borderRadius:"6px",border:"1px solid",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",background:groupRecurModal.weeks===w?"#1a1a1a":"#f4f4f2",borderColor:groupRecurModal.weeks===w?"#1a1a1a":"#d8d8d6",color:groupRecurModal.weeks===w?"#fff":"#666"}}>{w===1?"Weekly":(w+"w")}</button>
                  ); })}
                </div>
                {groupRecurModal.weeks && (
                  <button onClick={function(){
                    var gd=groupRecurModal;
                    if(gd.recurCount===1){ setRecurringModal({dateKey:gd.dateKey,idx:gd.idx,slot:gd.slot}); setGroupRecurModal(null); setTimeout(function(){ setRecurring(gd.dateKey,gd.idx,gd.weeks); },50); }
                    else { gd.groupSlots.slice(0,gd.recurCount).forEach(function(gs){ setRecurring(gd.dateKey,gs.i,gd.weeks); }); setGroupRecurModal(null); }
                  }} style={{width:"100%",padding:"11px",background:"#1a1a1a",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",marginBottom:"8px"}}>
                    Confirm — every {groupRecurModal.weeks===1?"week":(groupRecurModal.weeks+" weeks")}
                  </button>
                )}
              </div>
            )}
            {groupRecurModal.slot.recurWeeks!=null && (
              <button onClick={function(){ cancelRecurringForGroup(groupRecurModal.dateKey, groupRecurModal.groupSlots); }} style={{display:"block",width:"100%",padding:"10px",background:"none",border:"1px solid #e3b8b0",borderRadius:"8px",color:"#b0392b",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:"8px"}}>Cancel recurring for this group</button>
            )}
            <button onClick={function(){ setGroupRecurModal(null); }} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#bbb",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Cancel</button>
          </div>
        </div>
      )}

      {blockLabelModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={function(){ setBlockLabelModal(null); }}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(300px,90vw)"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>Block This Slot</div>
            <input autoFocus value={blockLabel} onChange={function(e){ setBlockLabel(e.target.value); }}
              onKeyDown={function(e){ if(e.key==="Enter") toggleBlockSlot(blockLabelModal.dateKey,blockLabelModal.idx,blockLabel); if(e.key==="Escape") setBlockLabelModal(null); }}
              placeholder="Lunch, Break, etc." style={{...inputStyle,width:"100%",boxSizing:"border-box",marginBottom:"14px",fontSize:"15px"}} />
            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={function(){ toggleBlockSlot(blockLabelModal.dateKey,blockLabelModal.idx,blockLabel); }} style={{flex:1,padding:"10px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Block</button>
              <button onClick={function(){ setBlockLabelModal(null); }} style={{padding:"10px 16px",background:"none",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {phoneModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}} onClick={function(){ setPhoneModal(null); }}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(320px,92vw)"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>Message</div>
            <div style={{fontSize:"16px",color:"#1a1a1a",marginBottom:"4px"}}>{phoneModal.name}</div>
            <div style={{fontSize:"12px",color:"#999",marginBottom:"14px"}}>Add a mobile number to text them. It's saved to their profile.</div>
            <input autoFocus type="tel" inputMode="tel" autoComplete="off" value={phoneModal.phone||""} placeholder="Phone number"
              onChange={function(e){ var v=e.target.value; setPhoneModal(function(p){ return p?{...p,phone:v}:p; }); setClientPhone(phoneModal.name, v); }}
              onKeyDown={function(e){ if(e.key==="Escape") setPhoneModal(null); }}
              style={{...inputStyle,width:"100%",boxSizing:"border-box",marginBottom:"14px",fontSize:"15px"}} />
            <div style={{display:"flex",gap:"8px"}}>
              {(phoneModal.phone||"").replace(/[^0-9+]/g,"")
                ? <button onClick={function(){ var d=(phoneModal.phone||"").replace(/[^0-9+]/g,""); setPhoneModal(null); window.location.href="sms:"+d; }} style={{flex:1,padding:"10px",background:"#4a8a9a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Message</button>
                : <button disabled style={{flex:1,padding:"10px",background:"#ececeb",border:"none",borderRadius:"6px",color:"#bbb",cursor:"default",fontFamily:"inherit",fontSize:"13px"}}>Message</button>}
              <button onClick={function(){ setPhoneModal(null); }} style={{padding:"10px 16px",background:"none",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Done</button>
            </div>
          </div>
        </div>
      )}

      {dailyExportPrompt && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={function(){ setDailyExportPrompt(false); }}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(320px,90vw)",textAlign:"center"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#aaa",marginBottom:"10px"}}>Good Morning</div>
            <div style={{fontSize:"15px",color:"#1a1a1a",marginBottom:"18px",lineHeight:1.4}}>Back up today's list?</div>
            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={function(){ exportData(); setDailyExportPrompt(false); }} style={{flex:1,padding:"12px",background:"#c9a96e",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"14px",fontWeight:"bold"}}>Export</button>
            </div>
          </div>
        </div>
      )}

      {holidayModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={function(){ setHolidayModal(null); }}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(320px,90vw)"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>Mark Holiday</div>
            <div style={{fontSize:"13px",color:"#888",marginBottom:"14px"}}>{friendlyDate(holidayModal.dateKey)}</div>
            <input autoFocus value={newHolidayName} onChange={function(e){ setNewHolidayName(e.target.value); }} placeholder="Holiday name" style={{...inputStyle,width:"100%",boxSizing:"border-box",marginBottom:"10px"}} />
            <label style={{display:"flex",alignItems:"center",gap:"8px",fontSize:"13px",color:"#666",marginBottom:"16px",cursor:"pointer"}}>
              <input type="checkbox" checked={newHolidayYearly} onChange={function(e){ setNewHolidayYearly(e.target.checked); }} />
              Repeat every year
            </label>
            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={function(){ if(!newHolidayName.trim()) return; setCustomHolidays(function(p){ return [...p,{dateKey:holidayModal.dateKey,name:newHolidayName.trim(),yearly:newHolidayYearly}]; }); setHolidayModal(null); setNewHolidayName(""); setNewHolidayYearly(false); }} style={{flex:1,padding:"10px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Save</button>
              <button onClick={function(){ setHolidayModal(null); setNewHolidayName(""); setNewHolidayYearly(false); }} style={{padding:"10px 16px",background:"none",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {conflictModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={function(){ setConflictModal(null); }}>
          <div style={{background:"#ffffff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"28px 28px 24px",width:"min(400px,92vw)",maxHeight:"80vh",overflowY:"auto"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#c0392b",marginBottom:"8px"}}>Scheduling Conflicts</div>
            <div style={{fontSize:"15px",color:"#1a1a1a",marginBottom:"6px"}}>Some slots are already taken</div>
            <div style={{fontSize:"12px",color:"#888",marginBottom:"16px"}}>{conflictModal.client&&conflictModal.client.name} will be placed on all open dates. For each clash below you can <strong>jump</strong> there to pick another open time, or <strong>share</strong> the slot (both names at once).</div>
            <div style={{marginBottom:"16px"}}>
              {conflictModal.conflicts.map(function(c,i){ return (
                <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 10px",marginBottom:"4px",background:"#fff5f4",border:"1px solid #f0d0cc",borderRadius:"6px"}}>
                  <div style={{minWidth:0,flex:"1 1 auto"}}>
                    <div style={{fontSize:"12px",color:"#1a1a1a"}}>{friendlyDate(c.dateKey)} · {c.time}</div>
                    <div style={{fontSize:"11px",color:"#c0392b",marginTop:"2px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.existingName} is already here</div>
                  </div>
                  <div style={{display:"flex",gap:"6px",flexShrink:0,marginLeft:"10px"}}>
                    <button onClick={function(){ conflictShareOne(i); }} style={{padding:"6px 11px",background:"#4a8a9a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"11px"}}>Share</button>
                    <button onClick={function(){ conflictJump(i); }} style={{padding:"6px 11px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"11px"}}>Jump</button>
                  </div>
                </div>
              ); })}
            </div>
            {conflictModal.conflicts.length>1&&<button onClick={conflictShareAll} style={{width:"100%",padding:"10px",background:"#4a8a9a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",marginBottom:"8px"}}>Share all {conflictModal.conflicts.length} slots</button>}
            <button onClick={commitConflictPending} style={{width:"100%",padding:"10px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",marginBottom:"8px"}}>Place on open dates only</button>
            <button onClick={function(){ setConflictModal(null); }} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#aaa",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Cancel</button>
          </div>
        </div>
      )}

      {seriesEditModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1150,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px",boxSizing:"border-box"}} onClick={function(){ setSeriesEditModal(null); }}>
          <div style={{background:"#f8f8f6",border:"1px solid #d8d8d6",borderRadius:"12px",padding:"26px 26px 22px",width:"min(360px,92vw)"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#4a8a9a",marginBottom:"8px"}}>Recurring appointment</div>
            <div style={{fontSize:"16px",color:"#1a1a1a",marginBottom:"6px"}}>{seriesEditModal.field==="time"?"Move this time for…":seriesEditModal.field==="drop"?"Move this appointment…":seriesEditModal.field==="lock"?"Lock in…":"Apply this change to…"}</div>
            <div style={{fontSize:"12px",color:"#888",marginBottom:"20px"}}>{seriesEditModal.field==="time"?((seriesEditModal.name||"This client")+" moves from "+seriesEditModal.oldTime+" to "+seriesEditModal.newTime+"."):seriesEditModal.field==="drop"?((seriesEditModal.name||"This client")+" moves to "+seriesEditModal.newTime+". \u201cAll\u201d shifts the whole series to this time (each stays on its own day)."):seriesEditModal.field==="lock"?((seriesEditModal.name||"This client")+" is penciled in"+(seriesEditModal.time?(" at "+seriesEditModal.time):"")+"."):((seriesEditModal.oldName||"This client")+(seriesEditModal.newName&&seriesEditModal.newName!==seriesEditModal.oldName?(" \u2192 "+seriesEditModal.newName):"")+".")}</div>
            <button onClick={function(){ if(seriesEditModal.field==="time"){ applySeriesTime("all"); } else if(seriesEditModal.field==="drop"){ applySeriesDrop("all"); } else if(seriesEditModal.field==="lock"){ applySeriesLock("all"); } else { applySeriesNamePrice("all"); } }} style={{display:"block",width:"100%",padding:"12px",background:"#1a1a1a",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"14px",marginBottom:"10px"}}>All of {(seriesEditModal.field==="nameprice"?seriesEditModal.oldName:seriesEditModal.name)||"this client"}'s appointments</button>
            <button onClick={function(){ if(seriesEditModal.field==="time"){ applySeriesTime("one"); } else if(seriesEditModal.field==="drop"){ applySeriesDrop("one"); } else if(seriesEditModal.field==="lock"){ applySeriesLock("one"); } else { applySeriesNamePrice("one"); } }} style={{display:"block",width:"100%",padding:"12px",background:"#ffffff",border:"1px solid #d0d0ce",borderRadius:"8px",color:"#1a1a1a",cursor:"pointer",fontFamily:"inherit",fontSize:"14px",marginBottom:"14px"}}>Just this one</button>
            <button onClick={function(){ setSeriesEditModal(null); }} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#aaa",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Cancel</button>
          </div>
        </div>
      )}

      {renameRequiredModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1150,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px",boxSizing:"border-box"}} onClick={function(){ setRenameRequiredModal(null); }}>
          <div style={{background:"#f8f8f6",border:"1px solid #d8d8d6",borderRadius:"12px",padding:"26px 26px 22px",width:"min(360px,92vw)"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#c0392b",marginBottom:"8px"}}>Name already recurring</div>
            <div style={{fontSize:"15px",color:"#1a1a1a",marginBottom:"6px"}}>Another recurring client is already called "{renameRequiredModal.name}"</div>
            <div style={{fontSize:"12px",color:"#888",marginBottom:"16px"}}>Give this one a more specific name so the two never get mixed up (for example a last initial).</div>
            <input value={renameRequiredModal.draft||""} onChange={function(e){ setRenameRequiredModal({...renameRequiredModal,draft:e.target.value}); }} onKeyDown={function(e){ if(e.key==="Enter"){ e.preventDefault(); confirmRenameRecurring(); } }} autoFocus={true} autoComplete="off" autoCorrect="off" autoCapitalize="words" spellCheck={false} style={{width:"100%",boxSizing:"border-box",padding:"10px 12px",fontSize:"15px",fontFamily:"inherit",border:"1px solid #d0d0ce",borderRadius:"8px",marginBottom:"6px",background:"#fff",color:"#1a1a1a"}} />
            {(renameRequiredModal.draft&&recurringNameConflict(capitalizeFirst(stripLeadingNumbers((renameRequiredModal.draft||"").trim())),renameRequiredModal.dateKey,renameRequiredModal.idx))?<div style={{fontSize:"11px",color:"#c0392b",marginBottom:"6px"}}>That name is still in use by a recurring client.</div>:<div style={{height:"6px"}} />}
            <button onClick={confirmRenameRecurring} style={{display:"block",width:"100%",padding:"12px",background:"#1a1a1a",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"14px",marginBottom:"10px",marginTop:"8px"}}>Rename &amp; make recurring</button>
            <button onClick={function(){ setRenameRequiredModal(null); }} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#aaa",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Cancel</button>
          </div>
        </div>
      )}

      {reassignMode && (
        <div style={{position:"fixed",top:0,left:0,right:0,zIndex:900,background:"#1a1a1a",color:"#fff",padding:"12px 20px",paddingTop:"calc(env(safe-area-inset-top,0px) + 12px)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:"11px",letterSpacing:"0.15em",textTransform:"uppercase",color:"#c9a96e",marginBottom:"2px"}}>Reassigning</div>
            <div style={{fontSize:"14px"}}>Tap any open slot for <strong>{reassignMode.client.name}</strong>{reassignQueue.length>0?(" (+"+(reassignQueue.length)+" more)"):""} on {friendlyDate(reassignMode.currentDateKey)}</div>
          </div>
          <button onClick={function(){ setReassignMode(null); setReassignQueue([]); }} style={{background:"none",border:"1px solid #444",borderRadius:"6px",color:"#888",padding:"6px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Cancel</button>
        </div>
      )}

      {placingClient && !reassignMode && (
        <div style={{position:"fixed",top:0,left:0,right:0,zIndex:900,background:"#1a1a1a",color:"#fff",padding:"12px 20px",paddingTop:"calc(env(safe-area-inset-top,0px) + 12px)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:"11px",letterSpacing:"0.15em",textTransform:"uppercase",color:"#c9a96e",marginBottom:"2px"}}>{placingClient.recurBook?"Recurring":"Moving"}</div>
            {placingClient.recurBook
              ? (<div style={{fontSize:"14px"}}>Tap a slot for <strong>{placingClient.name}</strong> — repeats every {placingClient.weeks===1?"week":(placingClient.weeks+" weeks")}</div>)
              : (<div style={{fontSize:"14px"}}>Tap any open slot to place <strong>{placingClient.name}</strong></div>)}
          </div>
          <button onClick={function(){ setPlacingClient(null); }} style={{background:"none",border:"1px solid #444",borderRadius:"6px",color:"#888",padding:"6px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Cancel</button>
        </div>
      )}

      {reassignApplyAll && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={function(){ setReassignApplyAll(null); }}>
          <div style={{background:"#ffffff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"28px 28px 24px",width:"min(380px,92vw)"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#a07830",marginBottom:"8px"}}>Other Conflicts</div>
            <div style={{fontSize:"15px",color:"#1a1a1a",marginBottom:"8px"}}>{reassignApplyAll.client.name} has {reassignApplyAll.remainingConflicts.length} more conflict{reassignApplyAll.remainingConflicts.length!==1?"s":""}</div>
            <div style={{fontSize:"12px",color:"#888",marginBottom:"16px"}}>Use <strong>{reassignApplyAll.altTime}</strong> for the other conflicted dates too?</div>
            <div style={{marginBottom:"20px"}}>
              {reassignApplyAll.remainingConflicts.map(function(c,i){ return (
                <div key={i} style={{padding:"7px 10px",marginBottom:"3px",background:"#fff5f4",border:"1px solid #f0d0cc",borderRadius:"6px",fontSize:"12px"}}>
                  <span style={{color:"#888"}}>{friendlyDate(c.dateKey)}</span>
                  <span style={{color:"#c0392b",marginLeft:"8px"}}>{c.existingName} at {c.time}</span>
                </div>
              ); })}
            </div>
            <div style={{display:"flex",gap:"8px",marginBottom:"8px"}}>
              <button onClick={function(){ applyAltTimeToConflicts(reassignApplyAll.altTime,reassignApplyAll.remainingConflicts,reassignApplyAll.client); }} style={{flex:1,padding:"10px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Yes — use {reassignApplyAll.altTime} for all</button>
              <button onClick={function(){ setReassignApplyAll(null); }} style={{flex:1,padding:"10px",background:"#fff",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>No — handle individually</button>
            </div>
          </div>
        </div>
      )}

      {clientProfile && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={function(){ setClientProfile(null); }}>
          <div style={{background:"#ffffff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"28px 28px 24px",width:"min(420px,92vw)",maxHeight:"82vh",display:"flex",flexDirection:"column"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"6px"}}>
              <div>
                <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#aaa",marginBottom:"4px"}}>Client Profile</div>
                <div style={{fontSize:"20px",color:"#1a1a1a"}}>{clientProfile.name}</div>
              </div>
              <button onClick={function(){ setClientProfile(null); }} style={{background:"none",border:"none",color:"#aaa",fontSize:"20px",cursor:"pointer",padding:"0 4px"}}>×</button>
            </div>
            {clientProfile.recurWeeks && <div style={{fontSize:"12px",color:"#6a8aaa",marginBottom:"12px"}}>{"↺"} Every {clientProfile.recurWeeks===1?"week":(clientProfile.recurWeeks+" weeks")} · usual time {clientProfile.usualTime}</div>}
            <button onClick={function(){ jumpToDateForBooking(toDateKey(addWeeks(new Date(),2)), clientProfile); setClientProfile(null); }} style={{padding:"10px",background:"#c9a96e",border:"none",borderRadius:"8px",color:"#0f0f0f",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",marginBottom:"14px"}}>Book next appointment</button>
            <div style={{display:"flex",gap:"6px",alignItems:"center",marginBottom:"14px"}}>
              <input type="tel" inputMode="tel" autoComplete="off" value={clientProfile.phone||""} placeholder="Phone number"
                onChange={function(e){ var v=e.target.value; setClientProfile(function(p){ return p?{...p,phone:v}:p; }); setClientPhone(clientProfile.name, v); }}
                style={{flex:1,padding:"8px 10px",border:"1px solid #d8d8d6",borderRadius:"8px",fontFamily:"inherit",fontSize:"13px",color:"#1a1a1a",background:"#fcfcfb",minWidth:0}} />
              {(clientProfile.phone||"").replace(/[^0-9+]/g,"")?<button onClick={function(){ window.location.href="sms:"+(clientProfile.phone||"").replace(/[^0-9+]/g,""); }} style={{padding:"8px 12px",background:"#2a6a2a",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",flexShrink:0}}>Message</button>:null}
              {(clientProfile.phone||"").replace(/[^0-9+]/g,"")?<button onClick={function(){ window.location.href="tel:"+(clientProfile.phone||"").replace(/[^0-9+]/g,""); }} style={{padding:"8px 12px",background:"#f0f0ee",border:"1px solid #d8d8d6",borderRadius:"8px",color:"#555",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",flexShrink:0}}>Call</button>:null}
            </div>
            <div style={{overflowY:"auto",flex:1}}>
              {clientProfile.bookings.length===0&&<div style={{fontSize:"13px",color:"#aaa",fontStyle:"italic"}}>No bookings.</div>}
              {clientProfile.bookings.map(function(b,i){ return (
                <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",marginBottom:"4px",background:b.done?"#f4faf4":"#f8f8f6",border:b.done?"1px solid #c0d8c0":"1px solid #e8e8e6",borderRadius:"8px"}}>
                  <div>
                    <div style={{fontSize:"13px",color:"#1a1a1a",marginBottom:"2px"}}>
                      {friendlyDate(b.dateKey)}
                      {b.done&&<span style={{fontSize:"10px",color:"#2a7a2a",marginLeft:"8px"}}>DONE</span>}
                    </div>
                    <div style={{fontSize:"12px",color:"#888"}}>{b.time}</div>
                  </div>
                  {!b.isPast&&!b.done&&(
                    <div style={{display:"flex",gap:"6px",marginLeft:"10px",flexShrink:0}}>
                      <button onClick={function(){ setClientProfile(null); setReassignMode({client:{name:clientProfile.name,price:b.price,recurWeeks:b.recurWeeks},currentDateKey:b.dateKey,remainingConflicts:[]}); jumpToDate(b.dateKey); }}
                        style={{background:"none",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",padding:"5px 10px",fontFamily:"inherit",fontSize:"11px"}}
                        onMouseEnter={function(e){ e.currentTarget.style.borderColor="#1a1a1a";e.currentTarget.style.color="#1a1a1a"; }}
                        onMouseLeave={function(e){ e.currentTarget.style.borderColor="#d8d8d6";e.currentTarget.style.color="#888"; }}
                      >Edit</button>
                      <button onClick={function(){ removeClientBooking(b.dateKey,clientProfile.name); }}
                        style={{background:"none",border:"1px solid #e8e8e6",borderRadius:"6px",color:"#ccc",cursor:"pointer",padding:"5px 10px",fontFamily:"inherit",fontSize:"11px"}}
                        onMouseEnter={function(e){ e.currentTarget.style.borderColor="#c0392b";e.currentTarget.style.color="#c0392b"; }}
                        onMouseLeave={function(e){ e.currentTarget.style.borderColor="#e8e8e6";e.currentTarget.style.color="#ccc"; }}
                      >Cancel</button>
                    </div>
                  )}
                </div>
              ); })}
            </div>
          </div>
        </div>
      )}

      {recurringModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={function(){ setRecurringModal(null); }}>
          <div style={{background:"#f8f8f6",border:"1px solid #d8d8d6",borderRadius:"12px",padding:"28px 28px 24px",width:"min(340px,92vw)"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#999",marginBottom:"8px"}}>Recurring Schedule</div>
            <div style={{fontSize:"17px",marginBottom:"4px"}}>{recurringModal.slot.name}</div>
            <div style={{fontSize:"12px",color:"#999",marginBottom:"20px"}}>{recurringModal.slot.time} · {friendlyDate(recurringModal.dateKey)}</div>
            <div style={{fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#999",marginBottom:"10px"}}>Every how many weeks?</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:"8px",marginBottom:"20px"}}>
              {WEEK_OPTIONS.map(function(w){ return (
                <button key={w} onClick={function(){ setRecurring(recurringModal.dateKey,recurringModal.idx,w); }} style={{padding:"8px 14px",borderRadius:"6px",border:"1px solid",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",background:recurringModal.slot.recurWeeks===w?"#1a1a1a":"#f4f4f2",borderColor:recurringModal.slot.recurWeeks===w?"#1a1a1a":"#d8d8d6",color:recurringModal.slot.recurWeeks===w?"#ffffff":"#666"}}>
                  {w===1?"Weekly":(w+"w")}
                </button>
              ); })}
            </div>
            {recurringModal.slot.recurWeeks&&<button onClick={function(){ setRecurring(recurringModal.dateKey,recurringModal.idx,null); }} style={{display:"block",width:"100%",padding:"10px",background:"none",border:"1px solid #e3b8b0",borderRadius:"6px",color:"#b0392b",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:"12px"}}>Cancel recurring</button>}
            <button onClick={function(){ setRecurringModal(null); }} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#aaa",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Cancel</button>
          </div>
        </div>
      )}

      {checkoffModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px",boxSizing:"border-box"}} onClick={function(){ setCheckoffModal(null);setNudgedDate(null);setCheckoffCalMonth(null);setCheckoffRecur(null);setRecurPickerOpen(false); }}>
          <div style={{background:"#f8f8f6",border:"1px solid #d8d8d6",borderRadius:"16px",padding:"24px 28px 28px",width:"100%",maxWidth:"700px",maxHeight:"92vh",overflowY:"auto",boxSizing:"border-box",position:"relative"}} onClick={function(e){ e.stopPropagation(); }}>
            <button onClick={function(){ setCheckoffModal(null);setNudgedDate(null);setCheckoffCalMonth(null);setCheckoffRecur(null);setRecurPickerOpen(false); }} style={{position:"absolute",top:"16px",right:"16px",background:"none",border:"none",color:"#aaa",fontSize:"22px",cursor:"pointer",lineHeight:1,padding:"0 4px"}}>×</button>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#4a8a5a",marginBottom:"4px"}}>Done</div>
            <div onClick={function(){ var nm=checkoffModal.slot.name; setCheckoffModal(null);setNudgedDate(null);setCheckoffCalMonth(null);setCheckoffRecur(null);setRecurPickerOpen(false); openClientProfile(nm); }} title="View profile" style={{fontSize:"22px",marginBottom:"2px",paddingRight:"32px",cursor:"pointer",textDecoration:"underline",textDecorationColor:"#dcd2bd",textUnderlineOffset:"3px"}}>{checkoffModal.slot.name}</div>
            <div style={{fontSize:"12px",color:"#999",marginBottom:"18px"}}>{checkoffModal.slot.time} · {friendlyDate(checkoffModal.dateKey)}</div>
            {checkoffModal.alreadyBookedKey&&(
              <div style={{background:"#eef3f9",border:"1px solid #b8cce0",borderRadius:"8px",padding:"10px 14px",marginBottom:"16px",fontSize:"13px",color:"#34434c",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px"}}>
                <span>Already booked for {friendlyDateLong(checkoffModal.alreadyBookedKey)}</span>
                <button onClick={function(){ var k=checkoffModal.alreadyBookedKey; setCheckoffModal(null);setNudgedDate(null);setCheckoffCalMonth(null); jumpToDate(k); }} style={{flexShrink:0,background:"#34434c",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",padding:"5px 11px",fontFamily:"inherit",fontSize:"12px"}}>Go there</button>
              </div>
            )}
            {checkoffModal.notRecurring ? (
              <div>
                <div style={{fontSize:"13px",color:"#888",marginBottom:"14px"}}>Not recurring. When's the next one?</div>
                <div style={{display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap",marginBottom:"16px",paddingBottom:"14px",borderBottom:"1px solid #ececea"}}>
                  {checkoffRecur ? (
                    <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:"6px",background:"#eaf4f6",border:"1px solid #b8dce2",borderRadius:"20px",padding:"6px 12px",fontSize:"12px",color:"#2a6a7a"}}><span style={{fontSize:"14px"}}>{"↺"}</span> Recurring every {checkoffRecur===1?"week":(checkoffRecur+" weeks")} — pick the first date</div>
                      <button onClick={function(){ setCheckoffRecur(null); setRecurPickerOpen(false); }} style={{background:"none",border:"none",color:"#aaa",fontSize:"16px",cursor:"pointer",padding:"2px 4px",lineHeight:1}}>{"×"}</button>
                    </div>
                  ) : recurPickerOpen ? (
                    <div style={{display:"flex",alignItems:"center",gap:"6px",flexWrap:"wrap"}}>
                      <span style={{fontSize:"12px",color:"#888"}}>Every</span>
                      {[1,2,3,4,5,6,7,8].map(function(n){
                        return <button key={n} onClick={function(){ startRecurringPlacement(n); }} style={{minWidth:"34px",padding:"7px 0",background:"#f4f4f2",border:"1px solid #d8d8d6",borderRadius:"8px",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",color:"#1a1a1a"}}>{n}w</button>;
                      })}
                      <button onClick={function(){ setRecurPickerOpen(false); }} style={{background:"none",border:"none",color:"#aaa",fontSize:"16px",cursor:"pointer",padding:"2px 4px",lineHeight:1}}>{"×"}</button>
                    </div>
                  ) : (
                    <button onClick={function(){ setRecurPickerOpen(true); }} style={{display:"flex",alignItems:"center",gap:"6px",background:"#fff",border:"1px solid #d8c8a8",borderRadius:"20px",padding:"6px 14px",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",color:"#9a7a30"}}><span style={{fontSize:"15px"}}>{"↺"}</span> Make this recurring</button>
                  )}
                </div>
                <div style={{fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>{checkoffRecur?"Start date":"Quick book"}</div>
                <div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"20px"}}>
                  {[2,3,4,5,6,7,8].map(function(w){
                    var d=addWeeks(parseDateKey(checkoffModal.dateKey),w); var dk=toDateKey(d); var mo=d.getMonth();
                    var ds=[3,4,5,6].includes(mo)?d.toLocaleDateString("en-US",{month:"long",day:"numeric"}):d.toLocaleDateString("en-US",{month:"short",day:"numeric"});
                    return <button key={w} onClick={function(){ if(checkoffRecur) bookRecurringFromModal(dk,checkoffRecur); else if(checkoffModal.groupTimes&&checkoffModal.groupTimes.length>1) confirmNextBooking(dk); else jumpToDateForBooking(dk,checkoffModal.slot); }} style={{padding:"9px 16px",background:"#f4f4f2",border:"1px solid #d8d8d6",borderRadius:"8px",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",color:"#1a1a1a"}}>{w}w · {ds}</button>;
                  })}
                </div>
                <div style={{fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#aaa",marginBottom:"12px"}}>Or pick a date</div>
                {renderCheckoffCalendar()}
              </div>
            ) : (
              <div>
                <div style={{fontSize:"12px",color:"#999",marginBottom:"16px"}}>Every {checkoffModal.slot.recurWeeks===1?"week":(checkoffModal.slot.recurWeeks+" weeks")} · {placementTime(checkoffModal.slot)} · {DAYS[dayOfWeek(checkoffModal.dateKey)]}s</div>
                {effectiveNextDate&&!nudgeConflict&&alreadyBookedNextDate&&<div style={{background:"#eef3f9",border:"1px solid #b8cce0",borderRadius:"8px",padding:"12px 16px",marginBottom:"14px",fontSize:"13px",color:"#34434c"}}>{"✓"} Already booked — {friendlyDateTime(bookedTimeOnNextDate,effectiveNextDate)}</div>}
                {effectiveNextDate&&!nudgeConflict&&!alreadyBookedNextDate&&<div style={{background:"#f0fff0",border:"1px solid #a0d0a0",borderRadius:"8px",padding:"12px 16px",marginBottom:"14px",fontSize:"13px",color:"#2a7a2a"}}>{"✓"} {friendlyDateTime(placementTime(checkoffModal.slot),effectiveNextDate)} is open</div>}
                {effectiveNextDate&&nudgeConflict&&<div style={{background:"#fff0ee",border:"1px solid #e0b0a8",borderRadius:"8px",padding:"12px 16px",marginBottom:"14px",fontSize:"13px",color:"#1a1a1a"}}>{"⚠"} That slot is already taken on {friendlyDateTime(placementTime(checkoffModal.slot),effectiveNextDate)}</div>}
                {nudgedDate&&nudgedDate!==checkoffModal.nextDateKey&&<div style={{fontSize:"11px",color:"#a07830",marginBottom:"10px"}}>Nudged — resumes every {checkoffModal.slot.recurWeeks===1?"week":(checkoffModal.slot.recurWeeks+" weeks")} after this</div>}
                <div style={{display:"flex",gap:"8px",marginBottom:"20px"}}>
                  <button onClick={function(){ confirmNextBooking(effectiveNextDate); }} style={{flex:1,padding:"12px",background:nudgeConflict?"#5a2a1a":"#c9a96e",border:"none",borderRadius:"8px",color:nudgeConflict?"#e8b84b":"#0f0f0f",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>{nudgeConflict?"Book anyway":("Book "+friendlyDateTime(placementTime(checkoffModal.slot),effectiveNextDate))}</button>
                  <button onClick={function(){ jumpToDate(effectiveNextDate); }} style={{padding:"12px 18px",background:"#efefed",border:"1px solid #d8d8d6",borderRadius:"8px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Jump</button>
                </div>
                <div style={{fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#aaa",marginBottom:"12px"}}>Change date</div>
                {renderCheckoffCalendar()}
                <button onClick={function(){
                  var dk=checkoffModal.dateKey; var ix=checkoffModal.idx; var sl=checkoffModal.slot;
                  setCheckoffModal(null);setNudgedDate(null);setCheckoffCalMonth(null);setCheckoffRecur(null);setRecurPickerOpen(false);
                  setTimeout(function(){
                    if(sl.groupId){ var aS=getSlots(dk); var gS=aS.map(function(s,i){ return {...s,i}; }).filter(function(s){ return s.groupId===sl.groupId&&s.name; }); if(gS.length>1){ cancelRecurringForGroup(dk,gS); return; } }
                    setRecurring(dk,ix,null);
                  },40);
                }} style={{display:"block",width:"100%",marginTop:"16px",padding:"10px",background:"none",border:"1px solid #e3b8b0",borderRadius:"8px",color:"#b0392b",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",letterSpacing:"0.08em",textTransform:"uppercase"}}>Cancel recurring series</button>
              </div>
            )}
          </div>
        </div>
      )}

      {groupScheduleModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={function(){ setGroupScheduleModal(null); }}>
          <div style={{background:"#f8f8f6",border:"1px solid #d8d8d6",borderRadius:"10px",padding:"28px 32px",maxWidth:"340px",width:"90%",textAlign:"center"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"11px",letterSpacing:"0.15em",textTransform:"uppercase",color:"#888",marginBottom:"12px"}}>Schedule Next</div>
            <div style={{fontSize:"16px",color:"#1a1a1a",marginBottom:"6px"}}>{groupScheduleModal.slot.name} has {groupScheduleModal.groupTimes.length} slots together this day.</div>
            <div style={{fontSize:"12px",color:"#999",marginBottom:"22px"}}>Book all of them again, or just this one?</div>
            <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
              <button onClick={function(){ var m=groupScheduleModal; setGroupScheduleModal(null); openCheckoffSchedule(m.dateKey,m.idx,m.slot,m.groupTimes); }} style={{padding:"11px",background:"#c9a96e",border:"none",borderRadius:"8px",color:"#0f0f0f",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>All {groupScheduleModal.groupTimes.length} slots</button>
              <button onClick={function(){ var m=groupScheduleModal; setGroupScheduleModal(null); openCheckoffSchedule(m.dateKey,m.idx,m.slot,null); }} style={{padding:"11px",background:"#f4f4f2",border:"1px solid #d8d8d6",color:"#1a1a1a",borderRadius:"8px",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Just this one slot</button>
              <button onClick={function(){ setGroupScheduleModal(null); }} style={{padding:"9px",background:"none",border:"none",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Never mind</button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={function(){ setConfirmDelete(null); }}>
          <div style={{background:"#f8f8f6",border:"1px solid #d8d8d6",borderRadius:"10px",padding:"28px 32px",maxWidth:"320px",width:"90%",textAlign:"center"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"11px",letterSpacing:"0.15em",textTransform:"uppercase",color:"#888",marginBottom:"12px"}}>Cancel Appointment</div>
            <div style={{fontSize:"16px",marginBottom:"6px"}}>{confirmDelete.slot.name?<span style={{color:"#1a1a1a"}}>{confirmDelete.slot.name} at {confirmDelete.slot.time}</span>:<span>Empty slot at {confirmDelete.slot.time}</span>}</div>
            <div style={{fontSize:"12px",color:"#999",marginBottom:"24px"}}>This will be logged in your history.</div>
            {confirmDelete.slot.name && confirmDelete.slot.recurWeeks ? (
              <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
                <button onClick={function(){ confirmRemoveSlot(true); }} style={{padding:"11px",background:"#c0392b",border:"1px solid #c0392b",color:"#fff",borderRadius:"6px",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Cancel this and all future</button>
                <button onClick={function(){ confirmRemoveSlot(false); }} style={{padding:"11px",background:"#ffffff",border:"1px solid #d0c4c2",color:"#c0392b",borderRadius:"6px",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Cancel only this one</button>
                <button onClick={function(){ setConfirmDelete(null); }} style={{padding:"9px",background:"none",border:"none",color:"#aaa",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Keep</button>
              </div>
            ) : (
              <div style={{display:"flex",gap:"10px",justifyContent:"center"}}>
                <button onClick={function(){ setConfirmDelete(null); }} style={{padding:"9px 20px",background:"#e8e8e6",border:"1px solid #d8d8d6",color:"#888",borderRadius:"6px",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Keep</button>
                <button onClick={function(){ confirmRemoveSlot(false); }} style={{padding:"9px 20px",background:"#c0392b",border:"1px solid #c0392b",color:"#fff",borderRadius:"6px",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Cancel appointment</button>
              </div>
            )}
          </div>
        </div>
      )}

      {noteModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1200,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}} onClick={function(){ setNoteModal(null); }}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(360px,92vw)"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#a07830",marginBottom:"8px"}}>{noteModal.isDay?"Day Note":"Note"}</div>
            <div style={{fontSize:"16px",color:"#1a1a1a",marginBottom:"14px"}}>{noteModal.name}</div>
            <textarea autoFocus value={noteDraft} onChange={function(e){ setNoteDraft(e.target.value); }} onKeyDown={function(e){ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); var nm=noteModal; if(nm.isDay){ var t=noteDraft.trim(); setDayNotes(function(prev){ var n={...prev}; if(t) n[nm.dayKey]=t; else delete n[nm.dayKey]; return n; }); } else { var slots=[...getSlots(nm.dateKey)]; var s=slots[nm.idx]; slots[nm.idx]={...s,note:noteDraft.trim()}; setSlots(nm.dateKey,slots); } setNoteModal(null); setNoteDraft(""); } }} placeholder={noteModal.isDay?"Write a note to yourself for this day...":"Add a note for this appointment..."} style={{width:"100%",boxSizing:"border-box",minHeight:"96px",resize:"vertical",background:"#efefed",border:"1px solid #d8d8d6",borderRadius:"6px",padding:"10px",fontSize:"14px",fontFamily:"Georgia,serif",color:"#1a1a1a",outline:"none",marginBottom:"14px"}}/>
            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={function(){
                var nm=noteModal;
                if (nm.isDay) {
                  var t=noteDraft.trim();
                  setDayNotes(function(prev){ var n={...prev}; if(t) n[nm.dayKey]=t; else delete n[nm.dayKey]; return n; });
                } else {
                  var slots=[...getSlots(nm.dateKey)]; var s=slots[nm.idx];
                  slots[nm.idx]={...s,note:noteDraft.trim()};
                  setSlots(nm.dateKey,slots);
                }
                setNoteModal(null); setNoteDraft("");
              }} style={{flex:1,padding:"10px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Save note</button>
              {noteModal && (function(){ if(noteModal.isDay) return !!dayNotes[noteModal.dayKey]; var s=getSlots(noteModal.dateKey)[noteModal.idx]; return s&&s.note; })() && (
                <button onClick={function(){
                  var nm=noteModal;
                  if (nm.isDay) {
                    setDayNotes(function(prev){ var n={...prev}; delete n[nm.dayKey]; return n; });
                  } else {
                    var slots=[...getSlots(nm.dateKey)]; var s=slots[nm.idx];
                    slots[nm.idx]={...s,note:""};
                    setSlots(nm.dateKey,slots);
                  }
                  setNoteModal(null); setNoteDraft("");
                }} style={{padding:"10px 14px",background:"none",border:"1px solid #e0b0a8",borderRadius:"6px",color:"#c0392b",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Clear</button>
              )}
              <button onClick={function(){ setNoteModal(null); setNoteDraft(""); }} style={{padding:"10px 14px",background:"none",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {timeEditModal && (function(){
        var workingTime = absMinutesToTime(timeEditMinutes);
        var slot = getSlots(timeEditModal.dateKey)[timeEditModal.idx] || {};
        // Color the working time the same way the main list does: cobalt when it's
        // earlier than this slot's default base, matched-purple when later. Custom
        // slots keep the teal "custom" treatment.
        var tmIsCustom = slot.isCustom===true || (slot.isCustom===undefined && DEFAULT_TIMES.indexOf(slot.time)===-1);
        var tmBase = slot.defaultBaseTime || timeEditModal.original;
        var tmShift = (!tmIsCustom && tmBase && workingTime!==tmBase) ? (timeToAbsMinutes(workingTime)<timeToAbsMinutes(tmBase) ? "earlier" : "later") : null;
        var tmColor = tmShift ? ADJ_BLUE : tmIsCustom ? "#2f7d8a" : "#1a1a1a";
        // Inverted on purpose: the +5/+1 buttons subtract and the −5/−1 buttons add,
        // keeping the same labels and positions but flipping the effect.
        var nudge = function(delta){ return function(){ setTimeEditMinutes(function(m){ return m - delta; }); }; };
        var nudgeBtn = {flex:1,padding:"12px 0",background:"#f4f4f2",border:"1px solid #d8d8d6",borderRadius:"8px",color:"#1a1a1a",cursor:"pointer",fontFamily:"inherit",fontSize:"15px"};
        return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1200,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}} onClick={function(){ setTimeEditModal(null); }}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(320px,92vw)"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#a07830",marginBottom:"8px"}}>Adjust Time</div>
            {slot.name&&<div style={{fontSize:"14px",color:"#1a1a1a",marginBottom:"2px"}}>{slot.name}</div>}
            <div style={{display:"flex",alignItems:"baseline",gap:"10px",marginBottom:"4px"}}>
              <div style={{fontSize:"34px",color:tmColor,fontWeight:(tmShift||tmIsCustom)?"bold":"normal",lineHeight:1.1}}>{workingTime}</div>
              {tmShift&&<div style={{fontSize:"10px",letterSpacing:"0.1em",textTransform:"uppercase",color:tmColor}}>{tmShift}</div>}
              {!tmShift&&tmIsCustom&&<div style={{fontSize:"10px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#2f7d8a"}}>custom</div>}
            </div>
            <div style={{fontSize:"12px",color:"#aaa",marginBottom:"18px"}}>Default was {timeEditModal.original}</div>
            <div style={{display:"flex",gap:"8px",marginBottom:"8px"}}>
              <button onClick={nudge(5)} style={nudgeBtn}>+5 min</button>
              <button onClick={nudge(-5)} style={nudgeBtn}>−5 min</button>
            </div>
            <div style={{display:"flex",gap:"8px",marginBottom:"18px"}}>
              <button onClick={nudge(1)} style={nudgeBtn}>+1 min</button>
              <button onClick={nudge(-1)} style={nudgeBtn}>−1 min</button>
            </div>
            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={commitTimeEdit} style={{flex:1,padding:"11px",background:"#1a1a1a",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Confirm</button>
              <button onClick={function(){ setTimeEditModal(null); }} style={{padding:"11px 14px",background:"none",border:"1px solid #d8d8d6",borderRadius:"8px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Cancel</button>
            </div>
          </div>
        </div>
        );
      })()}

      {entryUndoConflict && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1300,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}} onClick={function(){ setEntryUndoConflict(null); }}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"28px 28px 24px",width:"min(380px,92vw)"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#c0392b",marginBottom:"8px"}}>Conflict</div>
            <div style={{fontSize:"15px",color:"#1a1a1a",marginBottom:"8px"}}>That slot has changed since</div>
            <div style={{fontSize:"12px",color:"#888",marginBottom:"16px"}}>
              {entryUndoConflict.current.name
                ? (<span><strong>{entryUndoConflict.current.name}</strong> is now in {entryUndoConflict.entry.time} on {friendlyDate(entryUndoConflict.dateKey)}. Undoing this change will overwrite them.</span>)
                : (<span>The slot at {entryUndoConflict.entry.time} on {friendlyDate(entryUndoConflict.dateKey)} no longer matches. Undo anyway?</span>)}
            </div>
            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={function(){ var ec=entryUndoConflict; setEntryUndoConflict(null); performEntryUndo(ec.entry, true); }} style={{flex:1,padding:"10px",background:"#c0392b",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Undo anyway</button>
              <button onClick={function(){ setEntryUndoConflict(null); }} style={{padding:"10px 16px",background:"none",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Keep</button>
            </div>
          </div>
        </div>
      )}

      {showHistory && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:500,display:"flex",justifyContent:"flex-end"}} onClick={function(){ setShowHistory(false); }}>
          <div style={{width:"min(360px,90vw)",height:"100%",background:"#fafaf8",borderLeft:"1px solid #e4e4e2",overflowY:"auto",padding:"24px 20px",paddingTop:"calc(env(safe-area-inset-top,0px) + 24px)",boxShadow:"-4px 0 20px rgba(0,0,0,0.08)"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"16px"}}>
              <div style={{fontSize:"11px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#888"}}>Change History</div>
              <button onClick={function(){ setShowHistory(false); }} style={{background:"none",border:"none",color:"#999",fontSize:"18px",cursor:"pointer"}}>×</button>
            </div>
            <div style={{display:"flex",gap:"8px",marginBottom:"8px"}}>
              <button onClick={exportData} style={{flex:1,padding:"8px",background:"#f4f4f2",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",letterSpacing:"0.05em"}}>Export backup</button>
              <label style={{flex:1,padding:"8px",background:"#f4f4f2",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",letterSpacing:"0.05em",textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center"}}>
                Import backup
                <input type="file" accept=".json" onChange={importData} style={{display:"none"}}/>
              </label>
            </div>
            <button onClick={function(){ try { signOut(fbAuth); } catch(e) {} }} style={{width:"100%",padding:"8px",marginBottom:"8px",background:"none",border:"1px solid #e0b0a8",borderRadius:"6px",color:"#b04a3a",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",letterSpacing:"0.05em"}}>{authUser?("Sign out ("+authUser.email+")"):"Sign out"}</button>
            {clientMemory.length>0&&(
              <div style={{marginBottom:"20px",marginTop:"16px"}}>
                <div style={{fontSize:"10px",letterSpacing:"0.15em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>Saved Clients</div>
                <div style={{display:"flex",gap:"6px",marginBottom:"8px"}}>
                  <input value={clientSearch} onChange={function(e){ setClientSearch(e.target.value); }} placeholder="Search clients..." style={{...inputStyle,flex:1,boxSizing:"border-box",fontSize:"12px"}}/>
                  <button onClick={function(){ setShowAllClients(function(p){ return !p; }); }} title="Show all clients A–Z" style={{flexShrink:0,padding:"5px 12px",background:showAllClients?"#1a1a1a":"#f4f4f2",border:"1px solid #d8d8d6",borderRadius:"4px",color:showAllClients?"#fff":"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",letterSpacing:"0.08em"}}>A–Z</button>
                </div>
                {clientMemory.slice().sort(function(a,b){ return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); }).filter(function(c){ if(showAllClients) return true; return clientSearch&&c.name.toLowerCase().includes(clientSearch.toLowerCase()); }).map(function(c,i){ return (
                  <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",marginBottom:"3px",background:"#f8f8f6",border:"1px solid #e8e8e6",borderRadius:"6px"}}>
                    <div style={{cursor:"pointer",flex:1}} onClick={function(){ openClientProfile(c.name); setShowHistory(false); }}>
                      <span style={{fontSize:"13px",color:"#1a1a1a"}}>{c.name}</span>
                      {c.price&&<span style={{fontSize:"11px",color:"#a07830",marginLeft:"8px"}}>{c.price}</span>}
                    </div>
                    <button onClick={function(){ setClientMemory(function(mem){ return mem.filter(function(m){ return m.name!==c.name; }); }); }} style={{background:"none",border:"none",color:"#ccc",cursor:"pointer",fontSize:"14px",padding:"2px 6px",fontFamily:"inherit"}} onMouseEnter={function(e){ e.currentTarget.style.color="#c0392b"; }} onMouseLeave={function(e){ e.currentTarget.style.color="#ccc"; }}>×</button>
                  </div>
                ); })}
              </div>
            )}
            <div style={{fontSize:"10px",letterSpacing:"0.15em",textTransform:"uppercase",color:"#aaa",marginBottom:"10px"}}>Change Log</div>
            <input value={historySearch} onChange={function(e){ setHistorySearch(e.target.value); }} placeholder="Search change log..." style={{...inputStyle,width:"100%",boxSizing:"border-box",marginBottom:"10px",fontSize:"12px"}}/>
            {history.length===0&&<div style={{color:"#bbb",fontSize:"13px",fontStyle:"italic"}}>No changes yet.</div>}
            {history.filter(function(entry){
              if (!historySearch) return true;
              var q=historySearch.toLowerCase();
              var hay=((entry.name||"")+" "+(entry.prevName||"")+" "+(entry.time||"")+" "+(entry.dateKey?friendlyDate(entry.dateKey):"")+" "+(entry.type||"")).toLowerCase();
              return hay.indexOf(q)>=0;
            }).map(function(entry,i){
              var canEntryUndo=(entry.dateKey&&entry.time&&(entry.type==="added"||entry.type==="removed"||entry.type==="edited"||entry.type==="blocked"||entry.type==="unblocked"||entry.type==="recurring_set"||entry.type==="checkoff"||entry.type==="slot_removed"));
              return (
              <div key={entry.id||i} style={{padding:"10px 12px",marginBottom:"6px",borderRadius:"6px",background:(entry.type==="removed"||entry.type==="slot_removed")?"#fff0ee":"#fafaf8",border:(entry.type==="removed"||entry.type==="slot_removed")?"1px solid #e0b0a8":"1px solid #e4e4e2"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"3px"}}>
                  <span style={{fontSize:"10px",letterSpacing:"0.1em",textTransform:"uppercase",color:entry.type==="added"?"#4a8a5a":(entry.type==="removed"||entry.type==="slot_removed")?"#8a3a2a":entry.type==="recurring_set"?"#c9a96e":entry.type==="slot_added"?"#6a8aaa":entry.type==="checkoff"?"#4a8a5a":"#666"}}>
                    {entry.type==="added"?"Added":entry.type==="removed"?"Removed":entry.type==="slot_removed"?"Slot Removed":entry.type==="slot_added"?"Slot Added":entry.type==="recurring_set"?("Recurring ("+entry.weeks+"w)"):entry.type==="blocked"?"Blocked":entry.type==="unblocked"?"Unblocked":entry.type==="checkoff"?"Checked Off":"Edited"}
                  </span>
                  <span style={{fontSize:"10px",color:"#bbb"}}>{entry.timestamp}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:"8px"}}>
                  <div style={{fontSize:"13px",color:"#888"}}>
                    {entry.time} {entry.name&&<span style={{color:"#1a1a1a"}}>— {entry.name}</span>}
                    {entry.prevName&&<span style={{color:"#aaa"}}> (was {entry.prevName})</span>}
                    {entry.dateKey&&<span style={{color:"#ccc",fontSize:"11px"}}> · {friendlyDate(entry.dateKey)}</span>}
                  </div>
                  {canEntryUndo&&<button onClick={function(){ handleEntryUndo(entry); }} title="Undo" style={{background:"none",border:"1px solid #d8d8d6",borderRadius:"5px",color:"#888",cursor:"pointer",padding:"4px 8px",fontFamily:"inherit",flexShrink:0,display:"flex",alignItems:"center"}} onMouseEnter={function(e){ e.currentTarget.style.borderColor="#1a1a1a"; }} onMouseLeave={function(e){ e.currentTarget.style.borderColor="#d8d8d6"; }}><UndoIcon size={13} color="#888"/></button>}
                </div>
              </div>
            ); })}
          </div>
        </div>
      )}

      {/* HEADER — phone gets one compact row (shifters · tabs · undo/redo); iPad keeps its single row */}
      {isPhone ? (
        <div data-apphdr="1" style={{borderBottom:"1px solid #e8e8e6",paddingTop:"env(safe-area-inset-top,0px)",position:"sticky",top:0,background:"#ffffff",zIndex:100,flexShrink:0}}>
          {/* Single compact row: day-shifters · view tabs · undo/redo/menu */}
          <div style={{display:"flex",gap:"3px",alignItems:"center",padding:"3px 8px",justifyContent:"space-between"}}>
            <div style={{display:"flex",gap:"3px",alignItems:"center"}}>
              <button onClick={function(){ if(view==="Month"){var d=new Date(baseDate);d.setMonth(d.getMonth()-1);setBaseDate(d);}else setBaseDate(function(d){ return addDays(d,-7); }); }} style={{...navBtnSm,fontSize:"11px",letterSpacing:"-1px"}}>{"‹‹"}</button>
              <button onClick={function(){ if(view==="Month"){var d=new Date(baseDate);d.setMonth(d.getMonth()+1);setBaseDate(d);}else setBaseDate(function(d){ return addDays(d,7); }); }} style={{...navBtnSm,fontSize:"11px",letterSpacing:"-1px"}}>{"››"}</button>
              <button onClick={function(){ if(navCanBack) goBack(); }} title="Back" style={{...navBtnSm,fontSize:"13px",width:"26px",padding:"0",opacity:navCanBack?1:0.35,cursor:navCanBack?"pointer":"default"}}>{"←"}</button>
              <button onClick={function(){ if(navCanFwd) goFwd(); }} title="Forward" style={{...navBtnSm,fontSize:"13px",width:"26px",padding:"0",opacity:navCanFwd?1:0.35,cursor:navCanFwd?"pointer":"default"}}>{"→"}</button>
            </div>
            <div style={{display:"flex",gap:"2px",background:"#e8e8e6",padding:"2px",borderRadius:"5px"}}>
              {["Day","Wknd","Month"].map(function(v){ return (
                <button key={v} data-viewtab={v} onClick={function(){
                  if (v==="Wknd") { setBaseDate(view==="Wknd" ? getAnchorStart() : getUpcomingWeekend()); setView(v); return; }
                  if (view==="Wknd") { setBaseDate(v==="Month" ? new Date() : getAnchorStart()); }
                  else if (v===view && (v==="Day"||v==="3-Day"||v==="Week")) { setBaseDate(getAnchorStart()); }
                  else if (v===view && v==="Month") { setBaseDate(new Date()); }
                  setView(v);
                }} style={{padding:"5px 7px",fontSize:"9px",letterSpacing:"0.04em",textTransform:"uppercase",border:"none",borderRadius:"4px",cursor:"pointer",background:view===v?"#1a1a1a":"transparent",color:view===v?"#ffffff":"#999",fontFamily:"inherit",transition:"all 0.15s"}}>{v}</button>
              ); })}
            </div>
            <div style={{display:"flex",gap:"2px",alignItems:"center"}}>
              <button onClick={handleUndo} title="Undo" style={{...navBtnSm,background:canUndo?"#f0f0ee":"#f8f8f6",border:"1px solid #d8d8d6",width:"26px",padding:"0"}}><UndoIcon size={14} color={canUndo?"#555":"#ccc"}/></button>
              <button onClick={handleRedo} title="Redo" style={{...navBtnSm,background:canRedo?"#f0f0ee":"#f8f8f6",border:"1px solid #d8d8d6",width:"26px",padding:"0"}}><RedoIcon size={14} color={canRedo?"#555":"#ccc"}/></button>
              <button onClick={function(){ setShowHistory(true); }} style={{...navBtnSm,background:"#f0f0ee",border:"1px solid #d8d8d6",color:"#666"}}>{"≡"}</button>
            </div>
          </div>
          {view==="Month"&&<div style={{textAlign:"center",fontSize:"12px",color:"#1a1a1a",paddingBottom:"4px"}}>{baseDate.toLocaleDateString("en-US",{month:"long",year:"numeric"})}</div>}
        </div>
      ) : (
        <div data-apphdr="1" style={{borderBottom:"1px solid #e8e8e6",padding:"2px 20px",paddingTop:"env(safe-area-inset-top,0px)",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,background:"#ffffff",zIndex:100,flexShrink:0}}>
          <div style={{display:"flex",gap:"2px",background:"#e8e8e6",padding:"3px",borderRadius:"6px",marginLeft:isSplitView?"48px":"0"}}>
            {VIEWS.map(function(v){ return (
              <button key={v} data-viewtab={v} onClick={function(){
                if (v==="Wknd") { setBaseDate(view==="Wknd" ? getAnchorStart() : getUpcomingWeekend()); setView(v); return; }
                if (view==="Wknd") {
                  setBaseDate(v==="Month" ? new Date() : getAnchorStart());
                } else if (v===view && (v==="Day"||v==="3-Day"||v==="Week")) {
                  setBaseDate(getAnchorStart());
                } else if (v===view && v==="Month") {
                  setBaseDate(new Date());
                }
                setView(v);
              }} style={{padding:"5px 12px",fontSize:"10px",letterSpacing:"0.1em",textTransform:"uppercase",border:"none",borderRadius:"4px",cursor:"pointer",background:view===v?"#1a1a1a":"transparent",color:view===v?"#ffffff":"#999",fontFamily:"inherit",transition:"all 0.15s"}}>{v}</button>
            ); })}
          </div>
          {view==="Month"&&<div style={{fontSize:"14px",color:"#1a1a1a"}}>{baseDate.toLocaleDateString("en-US",{month:"long",year:"numeric"})}</div>}
          <div style={{display:"flex",gap:"4px",alignItems:"center"}}>
            <button onClick={function(){ if(view==="Month"){var d=new Date(baseDate);d.setMonth(d.getMonth()-1);setBaseDate(d);}else setBaseDate(function(d){ return addDays(d,-7); }); }} style={{...navBtn,fontSize:"11px",letterSpacing:"-1px"}}>{"‹‹"}</button>
            <button onClick={function(){ if(view==="Month"){var d=new Date(baseDate);d.setMonth(d.getMonth()+1);setBaseDate(d);}else setBaseDate(function(d){ return addDays(d,7); }); }} style={{...navBtn,fontSize:"11px",letterSpacing:"-1px"}}>{"››"}</button>
            <button onClick={function(){ if(navCanBack) goBack(); }} title="Back to previous view" style={{...navBtn,fontSize:"16px",width:"32px",padding:"0",opacity:navCanBack?1:0.35,cursor:navCanBack?"pointer":"default"}}>{"←"}</button>
            <button onClick={function(){ if(navCanFwd) goFwd(); }} title="Forward to next view" style={{...navBtn,fontSize:"16px",width:"32px",padding:"0",opacity:navCanFwd?1:0.35,cursor:navCanFwd?"pointer":"default"}}>{"→"}</button>
            <div style={{width:"10px"}}/>
            <button onClick={handleUndo} title="Undo" style={{...navBtn,background:canUndo?"#f0f0ee":"#f8f8f6",border:"1px solid #d8d8d6",width:"32px",padding:"0"}}><UndoIcon size={17} color={canUndo?"#555":"#ccc"}/></button>
            <button onClick={handleRedo} title="Redo" style={{...navBtn,background:canRedo?"#f0f0ee":"#f8f8f6",border:"1px solid #d8d8d6",width:"32px",padding:"0"}}><RedoIcon size={17} color={canRedo?"#555":"#ccc"}/></button>
            <button onClick={function(){ setShowHistory(true); }} style={{...navBtn,background:"#f0f0ee",border:"1px solid #d8d8d6",color:"#666"}}>{"≡"}</button>
          </div>
        </div>
      )}

      {view==="Month"&&(function(){
        var monthDays=getMonthDays();
        return (
          <div style={{width:"100vw",position:"relative",left:"50%",right:"50%",marginLeft:"-50vw",marginRight:"-50vw",boxSizing:"border-box",textAlign:"left",flex:"1 1 auto",display:"flex",flexDirection:"column",minHeight:0}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,minmax(0,1fr))",background:"#e8e8e6",gap:"1px",borderBottom:"1px solid #e8e8e6",flexShrink:0}}>
              {(isPhone?["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]:["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]).map(function(d){ return <div key={d} style={{padding:"8px 0",textAlign:"center",fontSize:isPhone?"9px":"10px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#aaa",background:"#fafaf8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d}</div>; })}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,minmax(0,1fr))",gap:"1px",background:"#e8e8e6",flex:"1 1 auto",gridAutoRows:"1fr",minHeight:0}}>
              {monthDays.map(function(day,i){
                var outside = day.getMonth() !== baseDate.getMonth();
                var dk=toDateKey(day); var slots=getSlots(dk); var booked=slots.filter(function(s){ return s.name; });
                var isT=isToday(day); var holiday=getHolidayForDate(dk); var range=getDayTimeRange(dk);
                var cellBg = outside ? "#f6f6f4" : (isT?"#fffbf0":"#ffffff");
                return (
                  <div key={dk} data-monthday={dk}
                    onClick={function(){ setBaseDate(day);setView(isPhone?"Day":"3-Day"); }}
                    onMouseDown={function(){ longPressTimer.current=setTimeout(function(){ setMonthLongPress({dateKey:dk,day}); },600); }}
                    onMouseUp={cancelLongPress} onMouseLeave={function(e){ cancelLongPress();e.currentTarget.style.background=cellBg; }}
                    onTouchStart={function(){ longPressTimer.current=setTimeout(function(){ setMonthLongPress({dateKey:dk,day}); },600); }}
                    onTouchEnd={cancelLongPress} onTouchMove={cancelLongPress}
                    style={{position:"relative",background:cellBg,minHeight:isPhone?"50px":"64px",padding:isPhone?"4px 4px":"7px 8px",cursor:"pointer",borderTop:isT?"2px solid #a07830":"2px solid transparent",transition:"background 0.1s",userSelect:"none",boxSizing:"border-box",overflow:"hidden",opacity:outside?0.85:1}}
                    onMouseEnter={function(e){ e.currentTarget.style.background=outside?"#efefec":(isT?"#fff8e8":"#f4f4f2"); }}
                  >
                    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:"6px",marginBottom:"3px"}}>
                      <div style={{fontSize:"14px",color:isT?"#a07830":(outside?"#bdbdbb":"#1a1a1a"),fontWeight:isT?"bold":"normal",flexShrink:0}}>{day.getDate()}</div>
                      {holiday&&<div style={{fontSize:"11px",color:outside?"#cbb98e":"#a07830",textAlign:"right",lineHeight:1.2,letterSpacing:"0.08em",textTransform:"uppercase",marginTop:"4px",minWidth:0,overflow:"hidden"}}>{holiday}</div>}
                    </div>
                    {booked.length>0&&(
                      <div style={{opacity:outside?0.55:1}}>
                        <div style={{display:"flex",flexWrap:"wrap",gap:"3px",marginBottom:"3px"}}>
                          {booked.map(function(s,j){ return <div key={j} style={{width:"8px",height:"8px",borderRadius:"50%",background:s.recurWeeks?"#6a8aaa":"#c9a96e"}}/>; })}
                        </div>
                        {range&&<div style={{fontSize:"9px",color:"#aaa"}}>{range}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {view!=="Month"&&(
        <div style={{flex:"1 1 auto",minHeight:0,overflow:"hidden",display:"flex",flexDirection:"column"}}>
        <div key={"grid-"+navAnim.n} data-gridtop="1" style={{display:"grid",gridTemplateColumns:("repeat("+getDayCount()+",minmax(0,1fr))"),gap:"1px",background:"#d8d8d6",flex:"1 1 auto",minHeight:0,gridAutoRows:"1fr",animation:navAnim.dir===1?"tlInRight 0.32s ease-out":navAnim.dir===-1?"tlInLeft 0.32s ease-out":"none"}}>
          {dates.map(function(date){
            var dateKey=toDateKey(date); var slots=getSlots(dateKey);
            return (
              <div key={dateKey} style={{background:"#ffffff",display:"flex",flexDirection:"column",minHeight:0,overflow:"hidden"}}>
                <div style={{padding:"2px 10px 2px",borderBottom:"1px solid #ebebea",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"4px",flex:"1 0 0px",minHeight:"26px"}}>
                  {(function(){
                    var sz=view==="Day"?"17px":"16px"; if(isPhone) sz=view==="Day"?"15px":"13px";
                    var mo=date.getMonth();
                    var monthStr=[3,4,5,6].includes(mo)?date.toLocaleDateString("en-US",{month:"long",day:"numeric"}):date.toLocaleDateString("en-US",{month:"short",day:"numeric"});
                    var wdStr=date.toLocaleDateString("en-US",{weekday:"long"})+(isToday(date)?" (Today)":"");
                    var hol=getHolidayForDate(dateKey);
                    if (view==="Week") {
                      // Week view columns are narrow, so the weekday and date stay stacked.
                      return (
                        <div style={{minWidth:0,overflow:"hidden",flex:1}}>
                          <div style={{display:"flex",alignItems:"baseline",gap:"6px",minWidth:0,marginBottom:"3px"}}>
                            <span style={{fontSize:sz,color:isToday(date)?"#c9893a":"#b89a5a",lineHeight:1.1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",flexShrink:1,textTransform:"uppercase",letterSpacing:"0.06em"}}>{wdStr}</span>
                            {hol&&<span style={{fontSize:sz,color:"#a07830",letterSpacing:"0.08em",textTransform:"uppercase",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minWidth:0,flexShrink:1}}>{hol}</span>}
                          </div>
                          <div style={{fontSize:sz,color:"#1a1a1a",lineHeight:1.1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",textTransform:"uppercase",letterSpacing:"0.06em"}}>{monthStr}</div>
                        </div>
                      );
                    }
                    // Day / 3-Day / Wknd: weekday and date sit side by side on one line.
                    return (
                      <div style={{minWidth:0,overflow:"hidden",flex:1,display:"flex",alignItems:"baseline",gap:"9px"}}>
                        <span style={{fontSize:sz,color:isToday(date)?"#c9893a":"#b89a5a",lineHeight:1.1,whiteSpace:"nowrap",flexShrink:0,textTransform:"uppercase",letterSpacing:"0.06em"}}>{wdStr+","}</span>
                        <span style={{fontSize:sz,color:"#1a1a1a",lineHeight:1.1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minWidth:0,flexShrink:1,textTransform:"uppercase",letterSpacing:"0.06em"}}>{monthStr}</span>
                        {hol&&<span style={{fontSize:sz,color:"#a07830",letterSpacing:"0.08em",textTransform:"uppercase",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minWidth:0,flexShrink:2,alignSelf:"center"}}>{hol}</span>}
                      </div>
                    );
                  })()}
                  <button onClick={function(e){ e.stopPropagation(); setNoteDraft(dayNotes[dateKey]||""); setNoteModal({dayKey:dateKey,isDay:true,name:friendlyDateLong(dateKey)}); }} title="Note for the day" style={{background:"none",border:"none",cursor:"pointer",padding:(getDayCount()>3?"0 2px":"0 9px 0 2px"),color:dayNotes[dateKey]?"#c9a96e":"#bbb",fontSize:"22px",lineHeight:1,flexShrink:0,WebkitTextStroke:"0.5px currentColor"}}>{"✎"}</button>
                </div>
                <div data-slotscroll="1" style={{flex:(slots.length+" 1 0px"),minHeight:0,paddingBottom:"0px",overflowX:"hidden",overscrollBehavior:"contain",display:"flex",flexDirection:"column"}}
                  onTouchMove={function(e){
                    if (!selectDragAnchor.current) return;
                    var t=e.touches[0]; if(!t) return;
                    var el=document.elementFromPoint(t.clientX,t.clientY);
                    while (el && !(el.dataset&&el.dataset.selrow)) { el=el.parentElement; }
                    if (el && el.dataset && el.dataset.selrow) {
                      var parts=el.dataset.selrow.split("-"); var di=parseInt(parts[parts.length-1]); var dk2=parts.slice(0,parts.length-1).join("-");
                      extendSelectDrag(dk2,di);
                    }
                  }}
                >
                  {slots.map(function(slot,idx){
                    var isEditing=editingCell&&editingCell.dateKey===dateKey&&editingCell.idx===idx;
                    var filled=!!slot.name; var wasRemoved=recentlyRemoved[dateKey+"-"+idx]&&!slot.name;
                    var isSwiped=swipedSlot===(dateKey+"-"+idx); var rowKey=dateKey+"-"+idx;
                    // On a phone, a plain open slot must be a *real* editable field so the
                    // very first tap (a true user gesture) raises the keyboard. Programmatic
                    // focus 50ms later — which is what iPad leans on — is ignored by iOS on
                    // iPhone, which is why the keyboard never appeared. iPad stays read-only.
                    var phoneEmptyTypable = isPhone && !filled && !slot.blocked && !slot.availStatus && !slot.done;
                    var isOccEdit=isEditing&&editingOccupied;
                    var isSelected=selectMode&&!!selectedSlots[rowKey];
                    var isDragging=dragState&&dragState.sourceKey===rowKey;
                    var slotBg=slot.blocked?"#f4f4f2":(wasRemoved&&!isEditing)?"#fff0ee":isOccEdit?"#fff0ee":isSelected?"#f0f4ff":slot.done?"#f4faf4":(isEditing&&editChromeReady)?"#f0f0ee":filled?"#fcfcfa":"transparent";
                    var isCustomSlot=slot.isCustom===true||(slot.isCustom===undefined&&!slot.defaultBaseTime&&!DEFAULT_TIMES.includes(slot.time));
                    var defShift=(!isCustomSlot&&slot.defaultBaseTime&&slot.time!==slot.defaultBaseTime)?(timeToAbsMinutes(slot.time)<timeToAbsMinutes(slot.defaultBaseTime)?"earlier":"later"):null;
                    var compactIcons=(view==="Week")||(isPhone&&view==="Wknd");
                    var isDropTarget=isLiveDragging&&dragOverKey===rowKey&&!filled&&!slot.blocked;
                    var showDropHint=(isLiveDragging||placingClient)&&!filled&&!slot.blocked&&!isEditing&&!(dragState&&dragState.sourceKey===rowKey);
                    if (isDropTarget) slotBg="#e3f3e3";
                    else if (placingClient&&!filled&&!slot.blocked&&!isEditing) slotBg="#f4faf4";
                    else if (!filled&&!slot.blocked&&slot.availStatus&&!isEditing) slotBg="#e7f6e7";
                    return (
                      <div key={rowKey} style={{position:"relative",overflow:"hidden",borderBottom:"1px solid #efefed",opacity:isDragging?0.4:1,flex:"1 1 0px",minHeight:"26px",display:"flex",flexDirection:"column"}}>
                        {!filled&&!slot.blocked&&!isEditing&&!(reassignMode&&reassignMode.currentDateKey===dateKey)&&!placingClient&&isCustomSlot&&(
                          <div style={{position:"absolute",right:"10px",top:0,bottom:0,display:"flex",alignItems:"center",gap:"4px",pointerEvents:"auto",zIndex:1}}>
                            <button onClick={function(e){ e.stopPropagation(); removeCustomSlot(dateKey,idx); }} style={{background:"none",border:"none",color:"#ddd",fontSize:"12px",cursor:"pointer",fontFamily:"inherit",padding:"2px 4px"}} onMouseEnter={function(e){ e.currentTarget.style.color="#c0392b"; }} onMouseLeave={function(e){ e.currentTarget.style.color="#ddd"; }}>{"× slot"}</button>
                          </div>
                        )}
                        {!filled&&!slot.blocked&&!isEditing&&!(reassignMode&&reassignMode.currentDateKey===dateKey)&&!placingClient&&slot.availStatus&&(
                          <div style={{position:"absolute",right:"10px",top:0,bottom:0,display:"flex",alignItems:"center",pointerEvents:"auto",zIndex:2}}>
                            <button onClick={function(e){ e.stopPropagation(); cycleSlotMark(dateKey,idx,null); }} title="Restore to an open slot" style={{background:"#fff",border:"1px solid #cfe6cf",borderRadius:"50%",width:"20px",height:"20px",display:"flex",alignItems:"center",justifyContent:"center",color:"#3a7a3a",fontSize:"13px",lineHeight:1,cursor:"pointer",fontFamily:"inherit",padding:0}}>{"×"}</button>
                          </div>
                        )}
                        <div
                          data-droprow={rowKey} data-dropfilled={filled?"1":"0"} data-dropblocked={slot.blocked?"1":"0"}
                          style={{display:"flex",alignItems:"center",padding:(getDayCount()>3?"0 7px":"0 14px"),flex:"1 1 auto",minHeight:0,background:slotBg,transition:"background 0.2s",position:"relative",opacity:slot.blocked?0.6:1,userSelect:"none",WebkitUserSelect:"none",outline:isDropTarget?"2px solid #5a9a5a":(showDropHint?"1px dashed #cdddcd":"none"),outlineOffset:"-3px",borderRadius:isDropTarget?"6px":"0"}}
                          onTouchStart={function(e){ handleTouchStart(e,dateKey,idx); }}
                          onTouchEnd={function(e){ handleTouchEnd(e,dateKey,idx); }}
                          onMouseUp={function(){ if(dragState&&!dragState.multi&&!dragCalHover) handleSlotDrop(dateKey,idx); }}
                        >
                          {(wasRemoved||isOccEdit)&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:"3px",background:"#c0392b"}}/>}
                          {isSelected&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:"3px",background:"#4a7aaa"}}/>}
                          {slot.groupId&&!wasRemoved&&(function(){
                            var ds=getSlots(dateKey); var gS=ds.map(function(s,i){ return {...s,i}; }).filter(function(s){ return s.groupId===slot.groupId&&s.name; });
                            var first=gS[0]&&gS[0].i===idx; var last=gS[gS.length-1]&&gS[gS.length-1].i===idx; var inG=gS.some(function(s){ return s.i===idx; });
                            if (!inG) return null;
                            return <div style={{position:"absolute",left:0,top:first?"50%":"0",bottom:last?"50%":"0",width:"3px",background:ADJ_BLUE,borderRadius:first?"3px 3px 0 0":last?"0 0 3px 3px":"0"}}/>;
                          })()}
                          {selectMode&&filled ? (
                            <div
                              onMouseDown={function(e){ e.preventDefault(); startSelectDrag(dateKey,idx); }}
                              onMouseEnter={function(){ if(selectDragAnchor.current) extendSelectDrag(dateKey,idx); }}
                              onMouseUp={endSelectDrag}
                              onTouchStart={function(){ startSelectDrag(dateKey,idx); }}
                              onTouchEnd={endSelectDrag}
                              data-selrow={rowKey}
                              style={{width:"18px",height:"18px",borderRadius:"4px",border:isSelected?"1.5px solid #4a7aaa":"1.5px solid #ccc",background:isSelected?"#4a7aaa":"transparent",flexShrink:0,marginRight:"8px",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
                              {isSelected&&<span style={{color:"#fff",fontSize:"11px",lineHeight:1}}>{"✓"}</span>}
                            </div>
                          ) : (
                          <button
                            onClick={function(){ handleCheckoff(dateKey,idx); }}
                            style={{width:"18px",height:"18px",borderRadius:"50%",border:slot.done?"1.5px solid #2a7a2a":filled?"1.5px solid #aaaaaa":slot.blocked?"1.5px solid #cccccc":"1.5px solid #dddddd",background:slot.done?"#2a7a2a":"transparent",cursor:(filled||slot.blocked)?"pointer":"default",flexShrink:0,marginRight:"10px",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s"}}>
                            {slot.done&&<span style={{color:"#fff",fontSize:"10px",lineHeight:1}}>{"✓"}</span>}
                          </button>
                          )}
                          <div
                            onClick={function(e){ e.stopPropagation(); if(placingClient){ if(!filled) placeClientInSlot(dateKey,idx); return; } if(filled&&slot.done){ handleDoneRowTap(dateKey,idx); return; } if(!isEditing&&!selectMode&&!isLiveDragging&&!(reassignMode&&reassignMode.currentDateKey===dateKey)) openTimeEdit(dateKey,idx); }}
                            onMouseDown={function(e){ e.stopPropagation(); }}
                            onTouchStart={function(e){ e.stopPropagation(); }}
                            style={{fontSize:"12px",color:defShift?ADJ_BLUE:slot.customTime?"#2f7d8a":(filled?"#c9a96e":"#2e2e2e"),fontWeight:(slot.customTime||defShift)?"bold":"normal",width:"40px",flexShrink:0,fontVariantNumeric:"tabular-nums",letterSpacing:"0.02em",userSelect:"none",WebkitUserSelect:"none",cursor:"pointer"}}>{slot.time}</div>
                          {slot.blocked?(
                            <div onClick={function(){ toggleBlockSlot(dateKey,idx,null); }} style={{flex:1,display:"flex",alignItems:"center",cursor:"pointer"}}>
                              <span style={{fontSize:"12px",color:slot.done?"#3a5a3a":"#aaa",fontStyle:"italic"}}>{slot.blockLabel||"Blocked"}</span>
                            </div>
                          ):reassignMode&&!filled&&reassignMode.currentDateKey===dateKey?(
                            <div onClick={function(){ handleReassignSlotTapWithQueue(dateKey,idx); }} style={{flex:1,fontSize:"13px",color:"#2a7a2a",cursor:"pointer",padding:"0 2px"}}>tap to place</div>
                          ):placingClient&&!filled?(
                            <div onClick={function(){ placeClientInSlot(dateKey,idx); }} style={{flex:1,fontSize:"13px",color:"#2a7a2a",cursor:"pointer",padding:"0 2px"}}>tap to place</div>
                          ):(
                            <div style={{flex:1,minWidth:0,display:"flex",alignItems:"center",gap:"4px"}}
                              onClick={function(){ if(filled&&slot.done) handleDoneRowTap(dateKey,idx); else if(!filled&&!slot.blocked){ if(slot.availStatus) startEdit(dateKey,idx,false); else handleOpenSlotTap(dateKey,idx); } }}
                              onPointerDown={function(e){ dragPointerId.current=e.pointerId; }}
                              onMouseDown={function(){ if(filled&&!slot.done&&!isEditing&&(!selectMode||selectedSlots[rowKey])) startDragLongPress(dateKey,idx,0,0); }}
                              onMouseUp={function(){ cancelDragLongPress(); }}
                              onMouseLeave={cancelDragLongPress}
                              onTouchStart={function(e){ if(filled&&!slot.done&&!isEditing&&(!selectMode||selectedSlots[rowKey])){ startDragLongPress(dateKey,idx,e.touches[0].clientX,e.touches[0].clientY,true); } }}
                              onTouchMove={function(e){ if(e.touches[0]) cancelDragLongPressIfMoved(e.touches[0].clientX,e.touches[0].clientY); }}
                              onTouchEnd={function(e){ var wasTap=!!dragLongPress.current; cancelDragLongPress(); handleTouchEnd(e,dateKey,idx); if(wasTap&&filled&&!slot.done&&!isEditing&&!selectMode) startEdit(dateKey,idx); }}
                            >
                              {isOccEdit&&<div style={{position:"absolute",top:"2px",left:"70px",fontSize:"9px",color:"#c0392b"}}>Editing {slot.name}</div>}
                              <input
                                value={isEditing?editValues.name:(wasRemoved?"":(slot.name||((!filled&&slot.availStatus)?(slot.availStatus==="overtime"?"OVERTIME PREMIUM":"AVAILABLE"):"")))}
                                readOnly={!isEditing && !phoneEmptyTypable}
                                name="tlentry" inputMode="text" data-lpignore="true" data-1p-ignore="true" data-form-type="other" data-bwignore="true"
                                autoComplete="off" autoCorrect="off" autoCapitalize="words" spellCheck={false}
                                onFocus={function(){ if(!isEditing&&!selectMode&&!isLiveDragging&&!dragState&&!slot.done) startEdit(dateKey,idx,(!filled&&!slot.availStatus)); }}
                                onChange={function(e){ if(!isEditing){ if(!selectMode&&!isLiveDragging&&!dragState&&!slot.done) startEdit(dateKey,idx,(!filled&&!slot.availStatus)); } setEditValues(function(v){ return {...v,name:e.target.value}; }); if(!editChromeReady) setEditChromeReady(true); }}
                                onKeyDown={function(e){ if(isEditing) handleKeyDown(e,dateKey,idx); }}
                                onBlur={function(e){ if(isEditing) handleBlur(e); }}
                                onMouseDown={function(){ if(filled&&!slot.done&&!isEditing&&!selectMode) startDragLongPress(dateKey,idx,0,0); }}
                                onMouseUp={function(){ cancelDragLongPress(); }}
                                placeholder="" data-rowkey={rowKey}
                                style={{flex:1,minWidth:0,pointerEvents:slot.done?"none":"auto",fontSize:isPhone?"16px":"13px",color:wasRemoved?"#c0392b":slot.done?"#2a6a2a":slot.pending?"#9a8458":(!filled&&slot.availStatus&&!isEditing)?"#1f7a33":filled?"#1a1a1a":"#999",fontWeight:(!filled&&slot.availStatus&&!isEditing)?"600":"normal",fontStyle:slot.pending?"italic":"normal",textDecoration:"none",background:"transparent",border:"none",outline:"none",padding:"0 2px",fontFamily:"Georgia,serif",cursor:isEditing?"text":"pointer",caretColor:(isEditing&&editChromeReady)?"#444":"transparent",WebkitUserSelect:isEditing?"text":"none",userSelect:isEditing?"text":"none",WebkitAppearance:"none",appearance:"none"}}
                              />
                              {!isEditing&&(
                                <div style={{display:"flex",alignItems:"center",gap:"6px",flexShrink:0}}
                                  onMouseDown={function(e){ e.stopPropagation(); }}
                                  onTouchStart={function(e){ e.stopPropagation(); }}
                                  onTouchEnd={function(e){ e.stopPropagation(); }}
                                >
                                  {filled&&slot.pending&&!slot.done&&<button onClick={function(e){ e.stopPropagation(); lockInSlot(dateKey,idx); }} title="Lock in" style={{display:"flex",alignItems:"center",justifyContent:"center",background:"#fff",border:"1px solid #d8c08a",borderRadius:"6px",cursor:"pointer",padding:compactIcons?"3px 5px":"3px 7px",lineHeight:1,flexShrink:0}}><UnlockIcon size={12} color="#9a7a30"/></button>}
                                  {!compactIcons&&filled&&slot.price&&<span style={{fontSize:"12px",color:slot.done?"#3a5a3a":"#a07830"}}>{slot.price}</span>}
                                  {!compactIcons&&filled&&(slot.recurWeeks?(
                                    <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:"2px",width:"50px",flexShrink:0}}>
                                      <span onClick={function(e){ e.stopPropagation(); openClientProfile(slot.name); }} style={{fontSize:"12px",fontWeight:"500",color:"#4a8a9a",cursor:"pointer",lineHeight:1,letterSpacing:"0.01em"}}>{(slot.recurWeeks===1?"1w":(slot.recurWeeks+"w"))+(slot.isException?"*":"")}</span>
                                      <button onClick={function(e){ e.stopPropagation(); if(slot.groupId){var aS=getSlots(dateKey);var gS=aS.map(function(s,i){ return {...s,i}; }).filter(function(s){ return s.groupId===slot.groupId&&s.name; });if(gS.length>1){setGroupRecurModal({dateKey,idx,slot,groupSlots:gS,weeks:null});return;}} setRecurringModal({dateKey,idx,slot}); }} title="Recurring — tap to manage" style={{background:"none",border:"none",cursor:"pointer",padding:"0 1px",color:"#4a8a9a",fontSize:"16px",fontWeight:"500",lineHeight:1}}>{"↺"}</button>
                                    </div>
                                  ):<div style={{width:"50px",flexShrink:0}}/>)}
                                  {!compactIcons&&filled&&(function(){
                                    var digits=getClientPhone(slot.name).replace(/[^0-9+]/g,"");
                                    if (digits) {
                                      return <button onClick={function(e){ e.stopPropagation(); window.location.href="sms:"+digits; }} title={"Message "+slot.name} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 4px",lineHeight:1,flexShrink:0,display:"flex",alignItems:"center"}}><MessageIcon size={20} color="#4a8a9a"/></button>;
                                    }
                                    return <button onClick={function(e){ e.stopPropagation(); setPhoneModal({name:slot.name,phone:""}); }} title={"Add a number for "+slot.name} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 4px",lineHeight:1,flexShrink:0,display:"flex",alignItems:"center"}}><MessageIcon size={20} color="#c6c6c6"/></button>;
                                  })()}
                                  {!compactIcons&&filled&&<button onClick={function(e){ e.stopPropagation(); setNoteDraft(slot.note||""); setNoteModal({dateKey,idx,name:slot.name}); }} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 5px",color:slot.note?"#c9a96e":"#bbb",fontSize:"22px",fontWeight:"bold",lineHeight:1,WebkitTextStroke:"0.6px currentColor"}}>{"✎"}</button>}
                                </div>
                              )}
                              {isEditing&&editChromeReady&&<input value={editValues.price} onChange={function(e){ setEditValues(function(v){ return {...v,price:e.target.value}; }); }} onKeyDown={function(e){ handleKeyDown(e,dateKey,idx); }} onBlur={handleBlur} data-rowkey={rowKey} placeholder="$" style={{width:"52px",fontSize:isPhone?"16px":"13px",color:"#1a1a1a",background:"#f0f0ee",border:"1px solid #d8d8d6",borderRadius:"4px",outline:"none",padding:"2px 5px",fontFamily:"Georgia,serif",WebkitAppearance:"none",appearance:"none"}}/>}
                              {isEditing&&editChromeReady&&<button data-rowkey={rowKey} onMouseDown={function(e){ e.preventDefault(); }} onClick={function(e){ e.preventDefault(); var nm=stripLeadingNumbers(((editValuesRef.current&&editValuesRef.current.name)||"").trim()); if(nm){ commitPenciled(dateKey,idx); } else { setPencilArmed(function(p){ return !p; }); } }} title={pencilArmed?"Pencil mode on — type a name, then Enter to pencil them in":"Penciled in — offered, waiting to hear back"} style={{flexShrink:0,marginLeft:"4px",display:"flex",alignItems:"center",gap:"3px",background:pencilArmed?"#c9a96e":"#fff",border:pencilArmed?"1px solid #c9a96e":"1px solid #d8c08a",borderRadius:"6px",cursor:"pointer",padding:"3px 7px",fontFamily:"Georgia,serif",fontSize:"11px",color:pencilArmed?"#2a2009":"#9a7a30",lineHeight:1,whiteSpace:"nowrap"}}>{"✎ Pencil"}</button>}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div data-footer="1" style={{display:"flex",gap:"6px",padding:isPhone?"2px 10px 2px":"2px 12px 2px",paddingBottom:"2px",flexShrink:0}}>
                  <button onClick={function(){ addSlotToBeginning(dateKey); }} style={{flex:1,padding:isPhone?"5px":"5px",background:"#f4f4f2",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",letterSpacing:"0.08em"}} onMouseEnter={function(e){ e.currentTarget.style.background="#e8e8e6"; }} onMouseLeave={function(e){ e.currentTarget.style.background="#f4f4f2"; }}>+ AM</button>
                  <button onClick={function(){ addSlotToEnd(dateKey); }} style={{flex:1,padding:isPhone?"5px":"5px",background:"#f4f4f2",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",letterSpacing:"0.08em"}} onMouseEnter={function(e){ e.currentTarget.style.background="#e8e8e6"; }} onMouseLeave={function(e){ e.currentTarget.style.background="#f4f4f2"; }}>+ PM</button>
                </div>
              </div>
            );
          })}
        </div>
        </div>
      )}
    </div>
  );
}

const navBtn = {background:"#e8e8e6",border:"1px solid #d8d8d6",color:"#777",padding:"0 10px",height:"32px",lineHeight:"32px",borderRadius:"4px",cursor:"pointer",fontSize:"15px",fontFamily:"inherit",display:"inline-flex",alignItems:"center",justifyContent:"center"};
const navBtnSm = {background:"#e8e8e6",border:"1px solid #d8d8d6",color:"#777",padding:"0 8px",height:"26px",lineHeight:"26px",borderRadius:"4px",cursor:"pointer",fontSize:"14px",fontFamily:"inherit",display:"inline-flex",alignItems:"center",justifyContent:"center"};
const inputStyle = {background:"#efefed",border:"1px solid #d8d8d6",color:"#1a1a1a",padding:"5px 7px",borderRadius:"4px",fontSize:"13px",fontFamily:"Georgia,serif",flex:1,outline:"none"};
