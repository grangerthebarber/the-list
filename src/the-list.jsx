import { useState, useRef, useCallback, useEffect } from "react";

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
  "1:13","1:36","1:58","2:21"
];

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

function parseTime(t) { var parts = t.split(":").map(Number); return parts[0]*60+parts[1]; }
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
function capitalizeFirst(str) { if (!str) return str; return str.charAt(0).toUpperCase()+str.slice(1); }
function stripLeadingNumbers(str) { if (!str) return str; return str.replace(/^\s*\d+\s*[.)\-]\s*/, "").replace(/^\s*\d+\s+(?=\D)/, ""); }
function isLunchName(str) { return !!str && str.trim().toLowerCase()==="lunch"; }
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

function migrateSchedules(raw) {
  var result = {};
  var keys = Object.keys(raw);
  for (var i = 0; i < keys.length; i++) {
    var dk = keys[i];
    if (isOldDefault(raw[dk])) {
      result[dk] = DEFAULT_TIMES.map(function(t){ return {time:t,name:"",price:"",done:false,recurWeeks:null,isCustom:false}; });
    } else {
      result[dk] = raw[dk];
    }
  }
  return result;
}

function getBannerColor(type) {
  if (type==="penciled") return "#a07830";
  if (type==="added"||type==="slot_added"||type==="unblocked"||type==="checkoff") return "#2a7a2a";
  if (type==="removed"||type==="slot_removed"||type==="blocked") return "#c0392b";
  return "#555";
}

function describeBanner(entry) {
  if (!entry) return "";
  var type = entry.type;
  if (type==="added" && entry.name && entry.time && entry.dateKey) {
    return entry.name + " is locked in for " + entry.time + " • " + friendlyDateLong(entry.dateKey);
  }
  if (type==="penciled" && entry.name && entry.time) {
    return entry.name + " penciled in for " + entry.time + (entry.dateKey ? (" • " + friendlyDateLong(entry.dateKey)) : "");
  }
  var prefix = type==="added"?"Added":type==="checkoff"?"Checked off":type==="removed"?"Removed":type==="edited"?"Edited":type==="recurring_set"?"Set recurring":type==="blocked"?"Blocked":type==="unblocked"?"Unblocked":type==="slot_added"?"Added slot":type==="slot_removed"?"Removed slot":type==="undo"?"Undone":type==="redo"?"Redone":"Changed";
  var name = entry.name ? (" " + entry.name) : "";
  var time = entry.time ? (" at " + entry.time) : "";
  var date = entry.dateKey ? (" · " + friendlyDate(entry.dateKey)) : "";
  return prefix + name + time + date;
}

const VIEWS = ["Day","3-Day","Wknd","Week","Month"];

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
  const [view, setView] = useState("Week");
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
  const [checkoffCalMonth, setCheckoffCalMonth] = useState(null);
  const [editingOccupied, setEditingOccupied] = useState(false);
  const [monthLongPress, setMonthLongPress] = useState(null);
  const [banner, setBanner] = useState(null);
  const [clientSearch, setClientSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [noteModal, setNoteModal] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [dayNotes, setDayNotes] = useState(function() { return loadFromStorage("tl_daynotes", {}); });
  const [groupScheduleModal, setGroupScheduleModal] = useState(null);
  const [entryUndoConflict, setEntryUndoConflict] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedSlots, setSelectedSlots] = useState({});
  const [dragState, setDragState] = useState(null);
  const [dragCalOpen, setDragCalOpen] = useState(false);
  const [dragCalMonth, setDragCalMonth] = useState(null);
  const [dragCalHover, setDragCalHover] = useState(false);
  const [reassignQueue, setReassignQueue] = useState([]);
  const [isLiveDragging, setIsLiveDragging] = useState(false);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [timeEditModal, setTimeEditModal] = useState(null);
  const [timeEditMinutes, setTimeEditMinutes] = useState(0);
  const dragChipRef = useRef(null);
  const dragPosRef = useRef({x:0,y:0});
  const dragOverRef = useRef(null);
  const dragStateRef = useRef(null);
  const bannerTimer = useRef(null);
  const longPressTimer = useRef(null);
  const checkoffLongPress = useRef(null);
  const dragLongPress = useRef(null);
  const editingRef = useRef(null);
  const editValuesRef = useRef(editValues);
  editValuesRef.current = editValues;
  const touchStart = useRef(null);
  const dragTouchStart = useRef(null);
  const selectDragAnchor = useRef(null);
  const schedulesRef = useRef(schedules);
  schedulesRef.current = schedules;
  dragStateRef.current = dragState;

  useEffect(function() { try { localStorage.setItem("tl_schedules", JSON.stringify(schedules)); } catch(e) {} }, [schedules]);
  useEffect(function() { try { localStorage.setItem("tl_clients", JSON.stringify(clientMemory)); } catch(e) {} }, [clientMemory]);
  useEffect(function() { try { localStorage.setItem("tl_holidays", JSON.stringify(customHolidays)); } catch(e) {} }, [customHolidays]);
  useEffect(function() { try { localStorage.setItem("tl_history", JSON.stringify(history)); } catch(e) {} }, [history]);
  useEffect(function() { try { localStorage.setItem("tl_daynotes", JSON.stringify(dayNotes)); } catch(e) {} }, [dayNotes]);

  useEffect(function() {
    if (checkoffModal && !checkoffCalMonth) {
      var startKey = checkoffModal.nextDateKey || toDateKey(addWeeks(parseDateKey(checkoffModal.dateKey), 2));
      var d = parseDateKey(startKey);
      setCheckoffCalMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    }
  }, [checkoffModal]);

  useEffect(function() {
    var handler = function(e) {
      if ((e.ctrlKey||e.metaKey) && e.key==="z" && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      if ((e.ctrlKey||e.metaKey) && (e.key==="y" || (e.key==="z" && e.shiftKey))) { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener("keydown", handler);
    return function() { window.removeEventListener("keydown", handler); };
  });

  const showBanner = function(entry, overrideType) {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    var displayEntry = overrideType ? {...entry, type:overrideType} : entry;
    setBanner(displayEntry);
    bannerTimer.current = setTimeout(function(){ setBanner(null); }, 8000);
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
    var d = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    var days = [];
    var firstDay = d.getDay()===0?6:d.getDay()-1;
    for (var i=0;i<firstDay;i++) days.push(null);
    var dim = new Date(baseDate.getFullYear(), baseDate.getMonth()+1, 0).getDate();
    for (var j=1;j<=dim;j++) days.push(new Date(baseDate.getFullYear(),baseDate.getMonth(),j));
    return days;
  };

  const getSlots = useCallback(function(dateKey) {
    var custom = schedulesRef.current[dateKey];
    if (!custom) return DEFAULT_TIMES.map(function(t){ return {time:t,name:"",price:"",done:false,recurWeeks:null,isCustom:false}; });
    return custom;
  }, []);

  const setSlots = function(dateKey, slots) { setSchedules(function(prev){ return {...prev,[dateKey]:slots}; }); };

  const addHistoryEntry = function(entry) {
    var full = {...entry, timestamp:new Date().toLocaleTimeString(), id:Date.now()+Math.random()};
    setHistory(function(prev){ return [full,...prev].slice(0,200); });
    showBanner(full, entry.bannerType);
    if(entry.type==="added"||entry.type==="slot_added"||entry.type==="checkoff") playSound("lock");
    else if(entry.type==="removed"||entry.type==="slot_removed") playSound("delete");
    else playSound("tap");
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
    var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};

    if (entry.type==="added"||entry.type==="checkoff") {
      // expected: this slot holds entry.name. If someone else is here now, conflict.
      if (!override && cur.name && entry.name && cur.name.toLowerCase()!==entry.name.toLowerCase()) {
        setEntryUndoConflict({entry, current:cur, dateKey:dk}); return;
      }
      pushUndo(snapshot);
      slots[idx] = {...cur,name:"",price:"",done:false,recurWeeks:null,isException:false,blocked:false,blockLabel:"",note:""};
      setSlots(dk, slots);
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
    setRedoStack(function(prev){ return [...prev, {schedules: JSON.parse(JSON.stringify(schedulesRef.current))}]; });
    setUndoStack(function(prev){ return prev.slice(0,-1); });
    setSchedules(snapshot.schedules);
    showBanner({type:"undo", name:"last change", dateKey:null, time:null});
  };

  const handleRedo = function() {
    if (redoStack.length === 0) return;
    var snapshot = redoStack[redoStack.length-1];
    setUndoStack(function(prev){ return [...prev, {schedules: JSON.parse(JSON.stringify(schedulesRef.current))}]; });
    setRedoStack(function(prev){ return prev.slice(0,-1); });
    setSchedules(snapshot.schedules);
    showBanner({type:"redo", name:"last change", dateKey:null, time:null});
  };

  const snapshotAndChange = function(changeFn, historyEntry) {
    var snapshot = {schedules: JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    changeFn();
    if (historyEntry) addHistoryEntry(historyEntry);
  };

  const startEdit = function(dateKey, idx) {
    var slot = getSlots(dateKey)[idx];
    var occupied = !!slot.name;
    editingRef.current = {dateKey,idx};
    setEditingCell({dateKey,idx});
    setEditValues({name:slot.name||"",price:slot.price||""});
    setEditingOccupied(occupied);
    setSwipedSlot(null);
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
    var newName = asLunch ? "" : capitalizeFirst(rawName);
    if (asLunch) {
      // Typing "lunch" turns the slot into a Lunch block (fully a block, no client memory).
      if (!prev.blocked) {
        var snapL = {schedules: JSON.parse(JSON.stringify(schedulesRef.current))};
        pushUndo(snapL);
        slots[idx] = {...prev,name:"",price:"",done:false,recurWeeks:null,isException:false,blocked:true,blockLabel:"Lunch"};
        setSlots(dateKey,slots);
        addHistoryEntry({type:"blocked",time:prev.time,name:"Lunch",dateKey});
      }
      editingRef.current = null;
      setEditingCell(null);
      setEditingOccupied(false);
      return;
    }
    if (newName!==prev.name || newPrice!==prev.price) {
      var snapshot = {schedules: JSON.parse(JSON.stringify(schedulesRef.current))};
      pushUndo(snapshot);
      slots[idx] = {...prev,name:newName,price:newPrice};
      setSlots(dateKey,slots);
      if (prev.name&&!newName) addHistoryEntry({type:"removed",time:prev.time,name:prev.name,dateKey});
      else if (!prev.name&&newName) {
        addHistoryEntry({type:"added",time:slots[idx].time,name:newName,price:newPrice,dateKey});
        setClientMemory(function(mem) {
          var existing = mem.findIndex(function(c){ return c.name.toLowerCase()===newName.toLowerCase(); });
          if (existing>=0) { var updated=[...mem]; updated[existing]={name:newName,price:newPrice||mem[existing].price}; return updated; }
          return [...mem,{name:newName,price:newPrice}];
        });
      } else if (prev.name&&newName) addHistoryEntry({type:"edited",time:slots[idx].time,name:newName,prevName:prev.name,dateKey});
    }
    editingRef.current = null;
    setEditingCell(null);
    setEditingOccupied(false);
  },[getSlots]);

  // Save a name as "penciled in" (tentative) — offered but not yet confirmed.
  const commitPenciled = function(dateKey, idx) {
    var slots = [...getSlots(dateKey)];
    var prev = slots[idx];
    var cv = editValuesRef.current;
    var rawName = stripLeadingNumbers((cv.name||"").trim());
    if (!rawName && prev.name) rawName = prev.name; // blur may have committed already
    if (isLunchName(rawName) || !rawName) { doCommit(dateKey, idx, cv); return; }
    var newName = capitalizeFirst(rawName);
    var newPrice = (cv.price||"").trim() || prev.price || "";
    var snapshot = {schedules: JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    slots[idx] = {...prev,name:newName,price:newPrice,pending:true,done:false};
    setSlots(dateKey,slots);
    if (!prev.name) {
      setClientMemory(function(mem) {
        var existing = mem.findIndex(function(c){ return c.name.toLowerCase()===newName.toLowerCase(); });
        if (existing>=0) { var u=[...mem]; u[existing]={name:newName,price:newPrice||mem[existing].price}; return u; }
        return [...mem,{name:newName,price:newPrice}];
      });
    }
    addHistoryEntry({type:"added",time:prev.time,name:newName,price:newPrice,dateKey,bannerType:"penciled"});
    editingRef.current = null;
    setEditingCell(null);
    setEditingOccupied(false);
  };

  // One-tap confirm: turn a penciled-in slot into a locked-in appointment.
  const lockInSlot = function(dateKey, idx) {
    var slots = [...getSlots(dateKey)];
    var prev = slots[idx];
    if (!prev.name || !prev.pending) return;
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
    // Block collisions with another existing slot at that exact time.
    if (slots.some(function(s,i){ return i!==idx && s.time===newTime; })) { setTimeEditModal(null); return; }
    var snapshot = {schedules: JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    var isStillDefault = DEFAULT_TIMES.indexOf(newTime) >= 0;
    slots[idx] = {...prev,time:newTime,customTime:!isStillDefault};
    slots.sort(function(a,b){ return timeToAbsMinutes(a.time)-timeToAbsMinutes(b.time); });
    setSlots(dateKey,slots);
    setTimeEditModal(null);
  };

  const handleBlur = useCallback(function(e) {
    var related = e.relatedTarget;
    if (related && related.dataset && related.dataset.rowkey===((editingRef.current&&editingRef.current.dateKey)+"-"+(editingRef.current&&editingRef.current.idx))) return;
    setTimeout(function(){ if (editingRef.current) doCommit(editingRef.current.dateKey,editingRef.current.idx,editValuesRef.current); },100);
  },[doCommit]);

  const handleKeyDown = function(e, dateKey, idx) {
    if (e.key==="Tab") return;
    if (e.key==="Enter" && e.shiftKey) {
      e.preventDefault();
      var cv = editValuesRef.current;
      var slots = [...getSlots(dateKey)];
      var curSlot = slots[idx];
      var newName = capitalizeFirst(stripLeadingNumbers((cv.name||"").trim()));
      var newPrice = (cv.price||"").trim();
      if (!newName) return;
      var nextIdx = idx+1;
      var canLink = nextIdx<slots.length && !slots[nextIdx].name && !slots[nextIdx].blocked;
      var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
      pushUndo(snapshot);
      if (canLink) {
        // Two adjacent slots are linked into a group. Filled slots are never skipped/linked.
        var gid = curSlot.groupId || (idx>0&&slots[idx-1].groupId) || newGroupId();
        slots[idx] = {...curSlot,name:newName,price:newPrice,groupId:gid};
        slots[nextIdx] = {...slots[nextIdx],name:newName,price:newPrice,groupId:gid};
        setSlots(dateKey,slots);
        addHistoryEntry({type:"added",time:slots[idx].time,name:newName,price:newPrice,dateKey});
        editingRef.current=null; setEditingCell(null); setEditingOccupied(false);
        setTimeout(function(){ startEdit(dateKey,nextIdx); },80);
      } else {
        // No empty slot directly below — just save this one, no link formed.
        slots[idx] = {...curSlot,name:newName,price:newPrice};
        setSlots(dateKey,slots);
        addHistoryEntry({type:"added",time:slots[idx].time,name:newName,price:newPrice,dateKey});
        editingRef.current=null; setEditingCell(null); setEditingOccupied(false);
      }
    } else if (e.key==="Enter") {
      e.preventDefault();
      doCommit(dateKey,idx,editValuesRef.current);
    } else if (e.key==="ArrowDown") {
      e.preventDefault();
      var curVals = editValuesRef.current;
      var curDateKey = dateKey; var curIdx = idx;
      doCommit(curDateKey,curIdx,curVals);
      var s = getSlots(curDateKey);
      if (curIdx < s.length-1) {
        setTimeout(function(){ startEdit(curDateKey, curIdx+1); }, 80);
      }
    } else if (e.key==="ArrowUp") {
      e.preventDefault();
      var curVals2 = editValuesRef.current;
      var curDateKey2 = dateKey; var curIdx2 = idx;
      doCommit(curDateKey2,curIdx2,curVals2);
      if (curIdx2 > 0) {
        setTimeout(function(){ startEdit(curDateKey2, curIdx2-1); }, 80);
      }
    } else if (e.key==="Escape") {
      editingRef.current=null; setEditingCell(null); setEditingOccupied(false);
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
    var updated = [...slots];
    updated[idx] = {...slot,done:!slot.done};
    setSlots(dateKey,updated);
    if (!slot.done) {
      showBanner({type:"checkoff",name:slot.name||slot.blockLabel||"Lunch",time:slot.time,dateKey});
    } else {
      playSound("tap");
    }
  };

  // Build the list of times that share a slot's group on a given day (sorted by time).
  const getGroupTimes = function(dateKey, slot) {
    return getSlots(dateKey)
      .filter(function(s){ return s.groupId && s.groupId===slot.groupId && s.name; })
      .sort(function(a,b){ return parseTime(a.time)-parseTime(b.time); })
      .map(function(s){ return {time:s.time,price:s.price,recurWeeks:s.recurWeeks}; });
  };

  const openCheckoffSchedule = function(dateKey, idx, slot, groupTimes) {
    if (slot.recurWeeks) {
      var nextKey = getNextDateKey(dateKey,slot.recurWeeks);
      var conflict = isSlotTaken(nextKey,slot.time,slot.name);
      setNudgedDate(nextKey); setCheckoffCalMonth(null);
      setCheckoffModal({dateKey,idx,slot,nextDateKey:nextKey,conflict,notRecurring:false,groupTimes:groupTimes||null});
    } else {
      setNudgedDate(null); setCheckoffCalMonth(null);
      setCheckoffModal({dateKey,idx,slot,nextDateKey:null,conflict:false,notRecurring:true,groupTimes:groupTimes||null});
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
      ? checkoffModal.groupTimes
      : [{time:slot.time,price:slot.price,recurWeeks:slot.recurWeeks}];
    var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    var newSchedules = {...schedulesRef.current};
    var placeOnDate = function(dk, allowOverwriteSame) {
      var daySlots = newSchedules[dk]
        ? [...newSchedules[dk]]
        : DEFAULT_TIMES.map(function(t){ return {time:t,name:"",price:"",done:false,recurWeeks:null}; });
      var dgid = times.length>1 ? newGroupId() : null;
      times.forEach(function(t){
        var si = daySlots.findIndex(function(s){ return s.time===t.time; });
        if (si>=0) {
          var taken = daySlots[si].name && daySlots[si].name.toLowerCase()!==slot.name.toLowerCase();
          if (!taken && (allowOverwriteSame || !daySlots[si].name)) {
            daySlots[si] = {...daySlots[si],name:slot.name,price:t.price,recurWeeks:t.recurWeeks,done:false,groupId:dgid};
          }
        } else {
          daySlots.push({time:t.time,name:slot.name,price:t.price,recurWeeks:t.recurWeeks,done:false,groupId:dgid});
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
    addHistoryEntry({type:"added",time:slot.time,name:slot.name,price:slot.price,dateKey:targetDateKey});
    setCheckoffModal(null); setNudgedDate(null); setCheckoffCalMonth(null);
  };

  const jumpToDate = function(dateKey) {
    setBaseDate(parseDateKey(dateKey)); setView("Day");
    setCheckoffModal(null); setNudgedDate(null); setCheckoffCalMonth(null);
  };

  const jumpToDateForBooking = function(targetDateKey, slot) {
    setCheckoffModal(null); setNudgedDate(null); setCheckoffCalMonth(null);
    setBaseDate(parseDateKey(targetDateKey)); setView("Day");
    setReassignMode({client:{name:slot.name,price:slot.price,recurWeeks:slot.recurWeeks},currentDateKey:targetDateKey,remainingConflicts:[]});
  };

  const openClientProfile = function(name) {
    var today = toDateKey(new Date());
    var bookings = [];
    Object.entries(schedulesRef.current).forEach(function(entry) {
      var dateKey=entry[0]; var slots=entry[1];
      slots.forEach(function(slot) {
        if (slot.name===name) bookings.push({dateKey,time:slot.time,price:slot.price,recurWeeks:slot.recurWeeks,isException:slot.isException||false,done:slot.done||false,isPast:dateKey<today});
      });
    });
    bookings.sort(function(a,b){ return a.dateKey.localeCompare(b.dateKey); });
    var nonEx = bookings.filter(function(b){ return !b.isException&&!b.isPast; });
    var usualTime = nonEx.length>0?nonEx[0].time:(bookings[0]&&bookings[0].time)||"";
    var recurWeeks = bookings.find(function(b){ return b.recurWeeks; })&&bookings.find(function(b){ return b.recurWeeks; }).recurWeeks;
    setClientProfile({name,recurWeeks,usualTime,bookings});
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
    while (true) {
      cursor=addWeeks(cursor,weeks);
      if (cursor>sixMo) break;
      var fk=formatDateKey(cursor);
      var ds=newSch[fk]?[...newSch[fk]]:DEFAULT_TIMES.map(function(t){ return {time:t,name:"",price:"",done:false,recurWeeks:null}; });
      var ei=ds.findIndex(function(s){ return s.time===sourceSlot.time; });
      if (ei>=0&&ds[ei].name&&ds[ei].name!==sourceSlot.name) conflicts.push({dateKey:fk,time:sourceSlot.time,name:sourceSlot.name,price:sourceSlot.price,recurWeeks:weeks,existingName:ds[ei].name});
      else if (ei>=0&&!ds[ei].name) { ds[ei]={...ds[ei],name:sourceSlot.name,price:sourceSlot.price,recurWeeks:weeks,done:false,groupId:sourceSlot.groupId||null}; newSch[fk]=ds; }
      else if (ei<0) { ds.push({time:sourceSlot.time,name:sourceSlot.name,price:sourceSlot.price,recurWeeks:weeks,done:false,groupId:sourceSlot.groupId||null}); ds.sort(function(a,b){return parseTime(a.time)-parseTime(b.time);}); newSch[fk]=ds; }
    }
    return {newSchedules:newSch,conflicts};
  };

  const setRecurring = function(dateKey, idx, weeks) {
    var srcSlots=[...getSlots(dateKey)]; var srcSlot=srcSlots[idx];
    srcSlots[idx]={...srcSlot,recurWeeks:weeks};
    var baseSch={...schedulesRef.current,[dateKey]:srcSlots};
    var snapshot={schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    if (weeks) {
      var res=buildRecurringSchedules(baseSch,dateKey,srcSlot,weeks);
      if (res.conflicts.length>0) {
        setConflictModal({conflicts:res.conflicts,onCancel:function(){ setSchedules(res.newSchedules); addHistoryEntry({type:"recurring_set",time:srcSlot.time,name:srcSlot.name,weeks,dateKey}); setConflictModal(null); setRecurringModal(null); }});
      } else { setSchedules(res.newSchedules); addHistoryEntry({type:"recurring_set",time:srcSlot.time,name:srcSlot.name,weeks,dateKey}); setRecurringModal(null); }
    } else {
      var newSch2={...schedulesRef.current,[dateKey]:srcSlots};
      var oldW=srcSlot.recurWeeks;
      if (oldW) {
        var sixMo2=new Date(); sixMo2.setMonth(sixMo2.getMonth()+6);
        var cur2=parseDateKey(dateKey);
        while (true) { cur2=addWeeks(cur2,oldW); if(cur2>sixMo2) break;
          var fk2=formatDateKey(cur2);
          if (newSch2[fk2]) { var ds2=[...newSch2[fk2]]; var si2=ds2.findIndex(function(s){ return s.time===srcSlot.time&&s.name===srcSlot.name&&s.recurWeeks===oldW&&!s.done; }); if(si2>=0){ds2[si2]={...ds2[si2],name:"",price:"",recurWeeks:null,done:false};newSch2[fk2]=ds2;} }
        }
      }
      setSchedules(newSch2); addHistoryEntry({type:"recurring_set",time:srcSlot.time,name:srcSlot.name,weeks,dateKey}); setRecurringModal(null);
    }
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
      slots[onlyIdx]={...s,name:"",price:"",done:false,recurWeeks:null,isException:false,groupId:null};
      var rem=slots.filter(function(x){ return x.groupId===groupId&&x.name; });
      if (rem.length===1) { var ri=slots.findIndex(function(x){ return x.groupId===groupId&&x.name; }); if(ri>=0) slots[ri]={...slots[ri],groupId:null}; }
      addHistoryEntry({type:"removed",time:s.time,name:s.name,dateKey});
      var gk=dateKey+"-"+onlyIdx;
      setRecentlyRemoved(function(r){ return {...r,[gk]:true}; });
      setTimeout(function(){ setRecentlyRemoved(function(r){ var n={...r}; delete n[gk]; return n; }); },8000);
    } else {
      slots.forEach(function(s,i){ if(s.groupId===groupId&&s.name){ addHistoryEntry({type:"removed",time:s.time,name:s.name,dateKey}); slots[i]={...s,name:"",price:"",done:false,recurWeeks:null,isException:false,groupId:null}; } });
    }
    setSlots(dateKey,slots); setGroupConfirm(null); setConfirmDelete(null);
  };

  const rescheduleGroupSlots = function(dateKey, groupId, onlyIdx) {
    var ts=getSlots(dateKey)[onlyIdx];
    setReassignMode({client:{name:ts.name,price:ts.price,recurWeeks:ts.recurWeeks},currentDateKey:dateKey,originalDateKey:dateKey,originalIdx:onlyIdx,remainingConflicts:[],groupId:onlyIdx!==undefined?null:groupId,groupDateKey:dateKey});
    setGroupConfirm(null); jumpToDate(dateKey);
  };

  const confirmRemoveSlot = function() {
    if (!confirmDelete) return;
    var dateKey=confirmDelete.dateKey; var idx=confirmDelete.idx; var slot=confirmDelete.slot;
    var snapshot={schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    var slots=[...getSlots(dateKey)];
    slots[idx]={...slots[idx],name:"",price:"",done:false,recurWeeks:null,isException:false};
    setSlots(dateKey,slots);
    addHistoryEntry({type:"removed",time:slot.time,name:slot.name,price:slot.price,dateKey});
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
    var data = {schedules:schedulesRef.current, clients:clientMemory, holidays:customHolidays, exportedAt:new Date().toISOString()};
    var blob = new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href=url; a.download="the-list-backup-"+(new Date().toISOString().split("T")[0])+".json"; a.click();
    URL.revokeObjectURL(url);
    showBanner({type:"added",name:"Backup exported",time:null,dateKey:null});
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
        } else {
          setDragCalOpen(true); setDragCalMonth(new Date()); setDragCalHover(true);
        }
        playSound("lock");
        return;
      }
      var clients = [{name:slot.name,price:slot.price,recurWeeks:slot.recurWeeks,originalDateKey:dateKey,originalIdx:idx}];
      setDragState({clients,sourceKey:dateKey+"-"+idx,multi:false});
      if (isTouch) {
        // True drag-and-drop: lift the appointment and let it follow the finger.
        dragPosRef.current = {x:startX, y:startY};
        dragOverRef.current = null; setDragOverKey(null);
        setIsLiveDragging(true);
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

  // Drop a picked-up appointment onto a visible empty slot (handles same-day and cross-day).
  const dropPickedUpOnSlot = function(targetDateKey, targetIdx) {
    var ds = dragStateRef.current;
    if (!ds || ds.multi) return false;
    var client = ds.clients[0];
    if (!client) return false;
    if (client.originalDateKey === targetDateKey && client.originalIdx === targetIdx) return false;
    var targetSlot = getSlots(targetDateKey)[targetIdx];
    if (!targetSlot || targetSlot.name || targetSlot.blocked) return false;
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
    addHistoryEntry({type:"added",time:targetSlot.time,name:client.name,price:client.price,dateKey:targetDateKey});
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
      setBaseDate(parseDateKey(targetDateKey)); setView("Day");
      setReassignQueue(rest);
      setReassignMode({client:{name:first.name,price:first.price,recurWeeks:first.recurWeeks},currentDateKey:targetDateKey,remainingConflicts:[],originalDateKey:first.originalDateKey,originalIdx:first.originalIdx});
    } else {
      showBanner({type:"added",name:placed+" appointment"+(placed!==1?"s":"")+" moved",time:null,dateKey:null});
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
    var onMove = function(e) {
      var t = e.touches && e.touches[0];
      if (!t) return;
      e.preventDefault();
      dragPosRef.current = {x:t.clientX, y:t.clientY};
      if (dragChipRef.current) dragChipRef.current.style.transform = "translate(" + (t.clientX + 14) + "px," + (t.clientY - 22) + "px)";
      // Hovering a view tab while dragging jumps into that view so off-screen days become reachable.
      var vt = findViewTab(t.clientX, t.clientY);
      if (vt) { setView(vt); }
      var ds = dragStateRef.current;
      var key = (ds && ds.multi) ? findAnyRowKey(t.clientX, t.clientY) : findDropKey(t.clientX, t.clientY);
      if (key !== dragOverRef.current) { dragOverRef.current = key; setDragOverKey(key); }
    };
    var onEnd = function(e) {
      if (e.cancelable) e.preventDefault();
      var ds = dragStateRef.current;
      // Figure out where the finger actually let go.
      var t = e.changedTouches && e.changedTouches[0];
      var px = t ? t.clientX : (dragPosRef.current ? dragPosRef.current.x : null);
      var py = t ? t.clientY : (dragPosRef.current ? dragPosRef.current.y : null);
      var landed = false;
      if (ds && ds.multi) {
        var anyKey = dragOverRef.current || (px!=null ? findAnyRowKey(px, py) : null);
        var dayKey = dayKeyFromRow(anyKey);
        if (dayKey) { landed = dropMultiOnDay(dayKey); }
      } else {
        var key = dragOverRef.current;
        if (!key && px!=null) key = findDropKey(px, py);
        if (key) {
          var parts = key.split("-"); var di = parseInt(parts[parts.length-1]); var dk2 = parts.slice(0,parts.length-1).join("-");
          landed = dropPickedUpOnSlot(dk2, di);
        }
      }
      // A deliberate release that didn't land on an open slot just forfeits — no popup.
      setIsLiveDragging(false);
      dragOverRef.current = null; setDragOverKey(null);
      setDragState(null);
    };
    var onCancel = function() {
      // The OS aborted the touch (often when a view switch unmounts the source row).
      // Don't lose the appointment — drop into the date picker so the move can finish.
      setIsLiveDragging(false);
      dragOverRef.current = null; setDragOverKey(null);
      if (dragStateRef.current) { setDragCalOpen(true); setDragCalMonth(new Date()); setDragCalHover(true); }
    };
    window.addEventListener("touchmove", onMove, {passive:false});
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onCancel);
    return function() {
      window.removeEventListener("touchmove", onMove, {passive:false});
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
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
    setBaseDate(parseDateKey(targetDateKey)); setView("Day");
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
  const nudgeConflict = effectiveNextDate?isSlotTaken(effectiveNextDate,checkoffModal&&checkoffModal.slot&&checkoffModal.slot.time,checkoffModal&&checkoffModal.slot&&checkoffModal.slot.name):false;

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
            var takenByOther=daySlots.some(function(s){ return s.time===slot.time&&s.name&&s.name.toLowerCase()!==slot.name.toLowerCase(); });
            var isT=isToday(day); var disabled=isPast||isFuture;
            var range=getDayTimeRange(dk);
            return (
              <div key={dk} onClick={function(){ if(!disabled){ if(checkoffModal.groupTimes&&checkoffModal.groupTimes.length>1) confirmNextBooking(dk); else jumpToDateForBooking(dk,slot); } }}
                style={{height:"44px",background:disabled?"#f8f8f8":holiday?"#fffbf0":isT?"#fffbf0":"#ffffff",borderTop:isT?"2px solid #a07830":"2px solid transparent",padding:"4px 5px",cursor:disabled?"default":"pointer",borderRadius:"3px",opacity:disabled?0.35:1,boxSizing:"border-box"}}>
                <div style={{fontSize:"12px",color:isT?"#a07830":disabled?"#ccc":"#1a1a1a",fontWeight:isT?"bold":"normal",lineHeight:1}}>{day.getDate()}</div>
                {!disabled&&(
                  <div style={{marginTop:"3px"}}>
                    <div style={{display:"flex",flexWrap:"wrap",gap:"2px",marginBottom:"1px"}}>
                      {bookedSlots.slice(0,4).map(function(s,j){ return <div key={j} style={{width:"5px",height:"5px",borderRadius:"50%",background:s.recurWeeks?"#6a8aaa":"#c9a96e"}}/>; })}
                      {takenByOther&&<div style={{width:"5px",height:"5px",borderRadius:"50%",background:"#c0392b"}}/>}
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
          <div style={{display:"flex",alignItems:"center",gap:"4px"}}><div style={{width:"7px",height:"7px",borderRadius:"50%",background:"#c0392b"}}/><span style={{fontSize:"10px",color:"#aaa"}}>{slot.time} taken</span></div>
        </div>
      </div>
    );
  };

  var canUndo = undoStack.length>0;
  var canRedo = redoStack.length>0;

  return (
    <div style={{height:"100dvh",overflow:"hidden",boxSizing:"border-box",display:"flex",flexDirection:"column",background:"#ffffff",fontFamily:"Georgia,serif",color:"#1a1a1a",paddingTop:reassignMode?"calc(env(safe-area-inset-top,0px) + 52px)":"0"}}
      onMouseUp={function(){ endSelectDrag(); if(dragState&&!dragCalHover) { setDragState(null); setDragCalOpen(false); } }}
      onTouchEnd={function(){ endSelectDrag(); }}>

      {banner && (
        <div style={{position:"fixed",top:"calc(env(safe-area-inset-top,0px) + 60px)",left:"50%",transform:"translateX(-50%)",zIndex:2000,background:getBannerColor(banner.type),color:"#fff",padding:"9px 16px",borderRadius:"20px",fontSize:"12px",letterSpacing:"0.04em",boxShadow:"0 2px 12px rgba(0,0,0,0.2)",display:"flex",alignItems:"center",gap:"12px",maxWidth:"90vw",pointerEvents:"auto"}}>
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
            <button onClick={function(){ setBaseDate(monthLongPress.day);setView("Day");setMonthLongPress(null); }} style={{display:"block",width:"100%",padding:"12px",background:"#1a1a1a",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"14px",marginBottom:"10px"}}>Add appointment</button>
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
            <div style={{fontSize:"12px",color:"#888",marginBottom:"16px"}}>{conflictModal.conflicts[0]&&conflictModal.conflicts[0].name} will be placed on all open dates. The following dates need attention.</div>
            <div style={{marginBottom:"20px"}}>
              {conflictModal.conflicts.map(function(c,i){ return (
                <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 10px",marginBottom:"4px",background:"#fff5f4",border:"1px solid #f0d0cc",borderRadius:"6px"}}>
                  <div>
                    <div style={{fontSize:"12px",color:"#1a1a1a"}}>{friendlyDate(c.dateKey)} · {c.time}</div>
                    <div style={{fontSize:"11px",color:"#c0392b",marginTop:"2px"}}>{c.existingName} is already here</div>
                  </div>
                  <button onClick={function(){ var rem=conflictModal.conflicts.filter(function(_,j){ return j!==i; }); conflictModal.onCancel(); setReassignMode({client:{name:c.name,price:c.price||"",recurWeeks:c.recurWeeks},currentDateKey:c.dateKey,remainingConflicts:rem}); jumpToDate(c.dateKey); }} style={{padding:"6px 12px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",flexShrink:0,marginLeft:"10px"}}>Jump</button>
                </div>
              ); })}
            </div>
            <button onClick={conflictModal.onCancel} style={{width:"100%",padding:"10px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",marginBottom:"8px"}}>Place on open dates only</button>
            <button onClick={function(){ setConflictModal(null); }} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#aaa",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Cancel</button>
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
            <div style={{overflowY:"auto",flex:1}}>
              {clientProfile.bookings.length===0&&<div style={{fontSize:"13px",color:"#aaa",fontStyle:"italic"}}>No bookings.</div>}
              {clientProfile.bookings.map(function(b,i){ return (
                <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",marginBottom:"4px",background:b.isPast?"#f8f8f6":b.isException?"#fffbf0":b.done?"#f4faf4":"#f8f8f6",border:b.isPast?"1px solid #e8e8e6":b.isException?"1px solid #e8d8a0":b.done?"1px solid #c0d8c0":"1px solid #e8e8e6",borderRadius:"8px",opacity:b.isPast?0.55:1}}>
                  <div>
                    <div style={{fontSize:"13px",color:"#1a1a1a",marginBottom:"2px"}}>
                      {friendlyDate(b.dateKey)}
                      {b.isPast&&<span style={{fontSize:"10px",color:"#aaa",marginLeft:"8px"}}>PAST</span>}
                      {b.isException&&<span style={{fontSize:"10px",color:"#a07830",marginLeft:"8px"}}>MOVED</span>}
                      {b.done&&<span style={{fontSize:"10px",color:"#2a7a2a",marginLeft:"8px"}}>DONE</span>}
                    </div>
                    <div style={{fontSize:"12px",color:b.isException?"#a07830":"#888"}}>{b.time}</div>
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
            {recurringModal.slot.recurWeeks&&<button onClick={function(){ setRecurring(recurringModal.dateKey,recurringModal.idx,null); }} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#999",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"12px"}}>Remove recurring</button>}
            <button onClick={function(){ setRecurringModal(null); }} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#aaa",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Cancel</button>
          </div>
        </div>
      )}

      {checkoffModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px",boxSizing:"border-box"}} onClick={function(){ setCheckoffModal(null);setNudgedDate(null);setCheckoffCalMonth(null); }}>
          <div style={{background:"#f8f8f6",border:"1px solid #d8d8d6",borderRadius:"16px",padding:"24px 28px 28px",width:"100%",maxWidth:"700px",maxHeight:"92vh",overflowY:"auto",boxSizing:"border-box",position:"relative"}} onClick={function(e){ e.stopPropagation(); }}>
            <button onClick={function(){ setCheckoffModal(null);setNudgedDate(null);setCheckoffCalMonth(null); }} style={{position:"absolute",top:"16px",right:"16px",background:"none",border:"none",color:"#aaa",fontSize:"22px",cursor:"pointer",lineHeight:1,padding:"0 4px"}}>×</button>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#4a8a5a",marginBottom:"4px"}}>Done</div>
            <div style={{fontSize:"22px",marginBottom:"2px",paddingRight:"32px"}}>{checkoffModal.slot.name}</div>
            <div style={{fontSize:"12px",color:"#999",marginBottom:"18px"}}>{checkoffModal.slot.time} · {friendlyDate(checkoffModal.dateKey)}</div>
            {checkoffModal.notRecurring ? (
              <div>
                <div style={{fontSize:"13px",color:"#888",marginBottom:"14px"}}>Not recurring. When's the next one?</div>
                <div style={{fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>Quick book</div>
                <div style={{display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"20px"}}>
                  {[2,3,4,5,6,7,8].map(function(w){
                    var d=addWeeks(parseDateKey(checkoffModal.dateKey),w); var dk=toDateKey(d); var mo=d.getMonth();
                    var ds=[3,4,5,6].includes(mo)?d.toLocaleDateString("en-US",{month:"long",day:"numeric"}):d.toLocaleDateString("en-US",{month:"short",day:"numeric"});
                    return <button key={w} onClick={function(){ if(checkoffModal.groupTimes&&checkoffModal.groupTimes.length>1) confirmNextBooking(dk); else jumpToDateForBooking(dk,checkoffModal.slot); }} style={{padding:"9px 16px",background:"#f4f4f2",border:"1px solid #d8d8d6",borderRadius:"8px",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",color:"#1a1a1a"}}>{w}w · {ds}</button>;
                  })}
                </div>
                <div style={{fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#aaa",marginBottom:"12px"}}>Or pick a date</div>
                {renderCheckoffCalendar()}
              </div>
            ) : (
              <div>
                <div style={{fontSize:"12px",color:"#999",marginBottom:"16px"}}>Every {checkoffModal.slot.recurWeeks===1?"week":(checkoffModal.slot.recurWeeks+" weeks")} · {checkoffModal.slot.time} · {DAYS[dayOfWeek(checkoffModal.dateKey)]}s</div>
                {effectiveNextDate&&!nudgeConflict&&<div style={{background:"#f0fff0",border:"1px solid #a0d0a0",borderRadius:"8px",padding:"12px 16px",marginBottom:"14px",fontSize:"13px",color:"#2a7a2a"}}>{"✓"} {friendlyDateTime(checkoffModal.slot.time,effectiveNextDate)} is open</div>}
                {effectiveNextDate&&nudgeConflict&&<div style={{background:"#fff0ee",border:"1px solid #e0b0a8",borderRadius:"8px",padding:"12px 16px",marginBottom:"14px",fontSize:"13px",color:"#1a1a1a"}}>{"⚠"} That slot is already taken on {friendlyDateTime(checkoffModal.slot.time,effectiveNextDate)}</div>}
                {nudgedDate&&nudgedDate!==checkoffModal.nextDateKey&&<div style={{fontSize:"11px",color:"#a07830",marginBottom:"10px"}}>Nudged — resumes every {checkoffModal.slot.recurWeeks===1?"week":(checkoffModal.slot.recurWeeks+" weeks")} after this</div>}
                <div style={{display:"flex",gap:"8px",marginBottom:"20px"}}>
                  <button onClick={function(){ confirmNextBooking(effectiveNextDate); }} style={{flex:1,padding:"12px",background:nudgeConflict?"#5a2a1a":"#c9a96e",border:"none",borderRadius:"8px",color:nudgeConflict?"#e8b84b":"#0f0f0f",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>{nudgeConflict?"Book anyway":("Book "+friendlyDateTime(checkoffModal.slot.time,effectiveNextDate))}</button>
                  <button onClick={function(){ jumpToDate(effectiveNextDate); }} style={{padding:"12px 18px",background:"#efefed",border:"1px solid #d8d8d6",borderRadius:"8px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Jump</button>
                </div>
                <div style={{fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#aaa",marginBottom:"12px"}}>Change date</div>
                {renderCheckoffCalendar()}
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
            <div style={{display:"flex",gap:"10px",justifyContent:"center"}}>
              <button onClick={function(){ setConfirmDelete(null); }} style={{padding:"9px 20px",background:"#e8e8e6",border:"1px solid #d8d8d6",color:"#888",borderRadius:"6px",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Keep</button>
              <button onClick={confirmRemoveSlot} style={{padding:"9px 20px",background:"#c0392b",border:"1px solid #c0392b",color:"#fff",borderRadius:"6px",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Cancel appointment</button>
            </div>
          </div>
        </div>
      )}

      {noteModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1200,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}} onClick={function(){ setNoteModal(null); }}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(360px,92vw)"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#a07830",marginBottom:"8px"}}>{noteModal.isDay?"Day Note":"Note"}</div>
            <div style={{fontSize:"16px",color:"#1a1a1a",marginBottom:"14px"}}>{noteModal.name}</div>
            <textarea autoFocus value={noteDraft} onChange={function(e){ setNoteDraft(e.target.value); }} placeholder={noteModal.isDay?"Write a note to yourself for this day...":"Add a note for this appointment..."} style={{width:"100%",boxSizing:"border-box",minHeight:"96px",resize:"vertical",background:"#efefed",border:"1px solid #d8d8d6",borderRadius:"6px",padding:"10px",fontSize:"14px",fontFamily:"Georgia,serif",color:"#1a1a1a",outline:"none",marginBottom:"14px"}}/>
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
        var isDefaultTime = DEFAULT_TIMES.indexOf(workingTime) >= 0;
        var nudge = function(delta){ return function(){ setTimeEditMinutes(function(m){ return m + delta; }); }; };
        var nudgeBtn = {flex:1,padding:"12px 0",background:"#f4f4f2",border:"1px solid #d8d8d6",borderRadius:"8px",color:"#1a1a1a",cursor:"pointer",fontFamily:"inherit",fontSize:"15px"};
        return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1200,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}} onClick={function(){ setTimeEditModal(null); }}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(320px,92vw)"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#a07830",marginBottom:"8px"}}>Adjust Time</div>
            {slot.name&&<div style={{fontSize:"14px",color:"#1a1a1a",marginBottom:"2px"}}>{slot.name}</div>}
            <div style={{display:"flex",alignItems:"baseline",gap:"10px",marginBottom:"4px"}}>
              <div style={{fontSize:"34px",color:isDefaultTime?"#1a1a1a":"#2f7d8a",fontWeight:isDefaultTime?"normal":"bold",lineHeight:1.1}}>{workingTime}</div>
              {!isDefaultTime&&<div style={{fontSize:"10px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#2f7d8a"}}>custom</div>}
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
              <button onClick={function(){ setTimeEditMinutes(timeToAbsMinutes(timeEditModal.original)); }} style={{padding:"11px 14px",background:"#fff",border:"1px solid #d8d8d6",borderRadius:"8px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Reset</button>
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
            {clientMemory.length>0&&(
              <div style={{marginBottom:"20px",marginTop:"16px"}}>
                <div style={{fontSize:"10px",letterSpacing:"0.15em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>Saved Clients</div>
                <input value={clientSearch} onChange={function(e){ setClientSearch(e.target.value); }} placeholder="Search clients..." style={{...inputStyle,width:"100%",boxSizing:"border-box",marginBottom:"8px",fontSize:"12px"}}/>
                {clientMemory.filter(function(c){ return clientSearch&&c.name.toLowerCase().includes(clientSearch.toLowerCase()); }).map(function(c,i){ return (
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

      {/* HEADER */}
      <div style={{borderBottom:"1px solid #e8e8e6",padding:"3px 20px 3px",paddingTop:"calc(env(safe-area-inset-top,0px) + 3px)",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,background:"#ffffff",zIndex:100,flexShrink:0}}>
        <div style={{display:"flex",gap:"2px",background:"#e8e8e6",padding:"3px",borderRadius:"6px"}}>
          {VIEWS.map(function(v){ return (
            <button key={v} data-viewtab={v} onClick={function(){ if(v==="Wknd") setBaseDate(getUpcomingWeekend()); else if(v==="3-Day"||v==="Week") setBaseDate(new Date()); setView(v); }} style={{padding:"5px 12px",fontSize:"10px",letterSpacing:"0.1em",textTransform:"uppercase",border:"none",borderRadius:"4px",cursor:"pointer",background:view===v?"#1a1a1a":"transparent",color:view===v?"#ffffff":"#999",fontFamily:"inherit",transition:"all 0.15s"}}>{v}</button>
          ); })}
        </div>
        {view==="Month"&&<div style={{fontSize:"14px",color:"#1a1a1a"}}>{baseDate.toLocaleDateString("en-US",{month:"long",year:"numeric"})}</div>}
        <div style={{display:"flex",gap:"4px",alignItems:"center"}}>
          {view!=="Month"&&<button onClick={function(){ setBaseDate(function(d){ return addDays(d,-7); }); }} style={{...navBtn,fontSize:"11px",letterSpacing:"-1px"}}>{"‹‹"}</button>}
          <button onClick={function(){ if(view==="Month"){var d=new Date(baseDate);d.setMonth(d.getMonth()-1);setBaseDate(d);}else setBaseDate(function(d){ return addDays(d,-1); }); }} style={navBtn}>{"‹"}</button>
          <button onClick={function(){ if(view==="Wknd") setBaseDate(getUpcomingWeekend()); else setBaseDate(new Date()); }} style={{...navBtn,fontSize:"9px",letterSpacing:"0.1em",padding:"0 12px"}}>TODAY</button>
          <button onClick={function(){ if(view==="Month"){var d=new Date(baseDate);d.setMonth(d.getMonth()+1);setBaseDate(d);}else setBaseDate(function(d){ return addDays(d,1); }); }} style={navBtn}>{"›"}</button>
          {view!=="Month"&&<button onClick={function(){ setBaseDate(function(d){ return addDays(d,7); }); }} style={{...navBtn,fontSize:"11px",letterSpacing:"-1px"}}>{"››"}</button>}
          <div style={{width:"10px"}}/>
          <button onClick={handleUndo} title="Undo" style={{...navBtn,background:canUndo?"#f0f0ee":"#f8f8f6",border:"1px solid #d8d8d6",width:"32px",padding:"0"}}><UndoIcon size={17} color={canUndo?"#555":"#ccc"}/></button>
          <button onClick={handleRedo} title="Redo" style={{...navBtn,background:canRedo?"#f0f0ee":"#f8f8f6",border:"1px solid #d8d8d6",width:"32px",padding:"0"}}><RedoIcon size={17} color={canRedo?"#555":"#ccc"}/></button>
          <button onClick={function(){ setShowHistory(true); }} style={{...navBtn,background:"#f0f0ee",border:"1px solid #d8d8d6",color:"#666"}}>{"≡"}</button>
        </div>
      </div>

      {view==="Month"&&(function(){
        var monthDays=getMonthDays();
        return (
          <div style={{width:"100vw",position:"relative",left:"50%",right:"50%",marginLeft:"-50vw",marginRight:"-50vw",boxSizing:"border-box",textAlign:"left",flex:"1 1 auto",display:"flex",flexDirection:"column",minHeight:0}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",background:"#e8e8e6",gap:"1px",borderBottom:"1px solid #e8e8e6",flexShrink:0}}>
              {["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map(function(d){ return <div key={d} style={{padding:"8px 0",textAlign:"center",fontSize:"10px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#aaa",background:"#fafaf8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d}</div>; })}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"1px",background:"#e8e8e6",flex:"1 1 auto",gridAutoRows:"1fr",minHeight:0}}>
              {monthDays.map(function(day,i){
                if (!day) return <div key={"empty-"+i} style={{background:"#f8f8f6",minHeight:"64px"}}/>;
                var dk=toDateKey(day); var slots=getSlots(dk); var booked=slots.filter(function(s){ return s.name; });
                var isT=isToday(day); var holiday=getHolidayForDate(dk); var range=getDayTimeRange(dk);
                return (
                  <div key={dk}
                    onClick={function(){ setBaseDate(day);setView("Day"); }}
                    onMouseDown={function(){ longPressTimer.current=setTimeout(function(){ setMonthLongPress({dateKey:dk,day}); },600); }}
                    onMouseUp={cancelLongPress} onMouseLeave={function(e){ cancelLongPress();e.currentTarget.style.background=isT?"#fffbf0":"#ffffff"; }}
                    onTouchStart={function(){ longPressTimer.current=setTimeout(function(){ setMonthLongPress({dateKey:dk,day}); },600); }}
                    onTouchEnd={cancelLongPress} onTouchMove={cancelLongPress}
                    style={{position:"relative",background:isT?"#fffbf0":"#ffffff",minHeight:"64px",padding:"7px 8px",cursor:"pointer",borderTop:isT?"2px solid #a07830":"2px solid transparent",transition:"background 0.1s",userSelect:"none",boxSizing:"border-box"}}
                    onMouseEnter={function(e){ e.currentTarget.style.background=isT?"#fff8e8":"#f4f4f2"; }}
                  >
                    {holiday&&<div style={{position:"absolute",top:"6px",right:"7px",maxWidth:"60%",fontSize:"8px",color:"#a07830",letterSpacing:"0.04em",textTransform:"uppercase",textAlign:"right",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",lineHeight:1.1}}>{holiday}</div>}
                    <div style={{fontSize:"14px",color:isT?"#a07830":"#1a1a1a",fontWeight:isT?"bold":"normal",marginBottom:"3px"}}>{day.getDate()}</div>
                    {booked.length>0&&(
                      <div>
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
        <div style={{flex:"1 1 auto",minHeight:0,overflowY:"auto",overflowX:"hidden",WebkitOverflowScrolling:"touch",overscrollBehavior:"contain"}}>
        <div style={{display:"grid",gridTemplateColumns:("repeat("+getDayCount()+",minmax(0,1fr))"),gap:"1px",background:"#d8d8d6",flexShrink:0}}>
          {dates.map(function(date){
            var dateKey=toDateKey(date); var slots=getSlots(dateKey);
            return (
              <div key={dateKey} style={{background:"#ffffff",display:"flex",flexDirection:"column"}}>
                <div style={{padding:"2px 10px 3px",borderBottom:"1px solid #ebebea",display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:"4px"}}>
                  {(function(){
                    var sz=view==="Day"?"20px":"16px"; var mo=date.getMonth();
                    var monthStr=[3,4,5,6].includes(mo)?date.toLocaleDateString("en-US",{month:"long",day:"numeric"}):date.toLocaleDateString("en-US",{month:"short",day:"numeric"});
                    var wdStr=isToday(date)?"Today":date.toLocaleDateString("en-US",{weekday:"long"});
                    var hol=getHolidayForDate(dateKey);
                    return (
                      <div style={{minWidth:0,overflow:"hidden",flex:1}}>
                        <div style={{display:"flex",alignItems:"baseline",gap:"6px",minWidth:0}}>
                          <span style={{fontSize:sz,color:isToday(date)?"#c9893a":"#b89a5a",lineHeight:1.2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",flexShrink:1}}>{wdStr}</span>
                          {hol&&<span style={{fontSize:"9px",color:"#a07830",letterSpacing:"0.06em",textTransform:"uppercase",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minWidth:0,flexShrink:1}}>{hol}</span>}
                        </div>
                        <div style={{fontSize:sz,color:"#1a1a1a",lineHeight:1.2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{monthStr}</div>
                      </div>
                    );
                  })()}
                  <button onClick={function(e){ e.stopPropagation(); setNoteDraft(dayNotes[dateKey]||""); setNoteModal({dayKey:dateKey,isDay:true,name:friendlyDateLong(dateKey)}); }} title="Note for the day" style={{background:"none",border:"none",cursor:"pointer",padding:"0 2px",color:dayNotes[dateKey]?"#c9a96e":"#bbb",fontSize:"26px",lineHeight:1,flexShrink:0,WebkitTextStroke:"0.5px currentColor"}}>{"✎"}</button>
                </div>
                <div style={{flex:1,padding:"0"}}
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
                    var filled=!!slot.name; var wasRemoved=recentlyRemoved[dateKey+"-"+idx];
                    var isSwiped=swipedSlot===(dateKey+"-"+idx); var rowKey=dateKey+"-"+idx;
                    var isOccEdit=isEditing&&editingOccupied;
                    var isSelected=selectMode&&!!selectedSlots[rowKey];
                    var isDragging=dragState&&dragState.sourceKey===rowKey;
                    var slotBg=slot.blocked?"#f4f4f2":wasRemoved?"#fff0ee":isOccEdit?"#fff0ee":isSelected?"#f0f4ff":slot.done?"#f4faf4":isEditing?"#f0f0ee":filled?"#fcfcfa":"transparent";
                    var isCustomSlot=slot.isCustom||!DEFAULT_TIMES.includes(slot.time);
                    var isDropTarget=isLiveDragging&&dragOverKey===rowKey&&!filled&&!slot.blocked;
                    var showDropHint=isLiveDragging&&!filled&&!slot.blocked&&!isEditing&&!(dragState&&dragState.sourceKey===rowKey);
                    if (isDropTarget) slotBg="#e3f3e3";
                    return (
                      <div key={rowKey} style={{position:"relative",overflow:"hidden",borderBottom:"1px solid #efefed",opacity:isDragging?0.4:1}}>
                        {!filled&&!slot.blocked&&!isEditing&&!(reassignMode&&reassignMode.currentDateKey===dateKey)&&isCustomSlot&&(
                          <div style={{position:"absolute",right:"10px",top:0,bottom:0,display:"flex",alignItems:"center",gap:"4px",pointerEvents:"auto",zIndex:1}}>
                            <button onClick={function(e){ e.stopPropagation(); removeCustomSlot(dateKey,idx); }} style={{background:"none",border:"none",color:"#ddd",fontSize:"12px",cursor:"pointer",fontFamily:"inherit",padding:"2px 4px"}} onMouseEnter={function(e){ e.currentTarget.style.color="#c0392b"; }} onMouseLeave={function(e){ e.currentTarget.style.color="#ddd"; }}>{"× slot"}</button>
                          </div>
                        )}
                        <div
                          data-droprow={rowKey} data-dropfilled={filled?"1":"0"} data-dropblocked={slot.blocked?"1":"0"}
                          style={{display:"flex",alignItems:"center",padding:(getDayCount()>3?"0 7px":"0 14px"),height:"42px",background:slotBg,transition:"background 0.2s",position:"relative",opacity:slot.blocked?0.6:1,userSelect:"none",WebkitUserSelect:"none",outline:isDropTarget?"2px solid #5a9a5a":(showDropHint?"1px dashed #cdddcd":"none"),outlineOffset:"-3px",borderRadius:isDropTarget?"6px":"0"}}
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
                            return <div style={{position:"absolute",left:0,top:first?"50%":"0",bottom:last?"50%":"0",width:"3px",background:"#a07830",borderRadius:first?"3px 3px 0 0":last?"0 0 3px 3px":"0"}}/>;
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
                            onClick={function(e){ e.stopPropagation(); if(!isEditing&&!selectMode&&!isLiveDragging&&!(reassignMode&&reassignMode.currentDateKey===dateKey)) openTimeEdit(dateKey,idx); }}
                            onMouseDown={function(e){ e.stopPropagation(); }}
                            onTouchStart={function(e){ e.stopPropagation(); }}
                            style={{fontSize:"12px",color:slot.customTime?"#2f7d8a":(filled?"#c9a96e":"#2e2e2e"),fontWeight:slot.customTime?"bold":"normal",width:"40px",flexShrink:0,fontVariantNumeric:"tabular-nums",letterSpacing:"0.02em",userSelect:"none",WebkitUserSelect:"none",cursor:"pointer"}}>{slot.time}</div>
                          {slot.blocked?(
                            <div onClick={function(){ toggleBlockSlot(dateKey,idx,null); }} style={{flex:1,display:"flex",alignItems:"center",cursor:"pointer"}}>
                              <span style={{fontSize:"12px",color:slot.done?"#3a5a3a":"#aaa",fontStyle:"italic"}}>{slot.blockLabel||"Blocked"}</span>
                            </div>
                          ):reassignMode&&!filled&&reassignMode.currentDateKey===dateKey?(
                            <div onClick={function(){ handleReassignSlotTapWithQueue(dateKey,idx); }} style={{flex:1,fontSize:"13px",color:"#2a7a2a",cursor:"pointer",padding:"0 2px"}}>tap to place</div>
                          ):(
                            <div style={{flex:1,minWidth:0,display:"flex",alignItems:"center",gap:"4px"}}
                              onClick={function(){ if(filled&&slot.done) handleDoneRowTap(dateKey,idx); }}
                              onMouseDown={function(){ if(filled&&!slot.done&&!isEditing&&(!selectMode||selectedSlots[rowKey])) startDragLongPress(dateKey,idx,0,0); }}
                              onMouseUp={function(){ cancelDragLongPress(); }}
                              onMouseLeave={cancelDragLongPress}
                              onTouchStart={function(e){ if(filled&&!slot.done&&!isEditing&&(!selectMode||selectedSlots[rowKey])){ startDragLongPress(dateKey,idx,e.touches[0].clientX,e.touches[0].clientY,true); } }}
                              onTouchMove={function(e){ if(e.touches[0]) cancelDragLongPressIfMoved(e.touches[0].clientX,e.touches[0].clientY); }}
                              onTouchEnd={function(e){ var wasTap=!!dragLongPress.current; cancelDragLongPress(); handleTouchEnd(e,dateKey,idx); if(wasTap&&filled&&!slot.done&&!isEditing&&!selectMode) startEdit(dateKey,idx); }}
                            >
                              {isOccEdit&&<div style={{position:"absolute",top:"2px",left:"70px",fontSize:"9px",color:"#c0392b"}}>Editing {slot.name}</div>}
                              <input
                                value={isEditing?editValues.name:(wasRemoved?"":slot.name)}
                                readOnly={!isEditing}
                                onFocus={function(){ if(!isEditing&&!selectMode&&!isLiveDragging&&!dragState&&!slot.done) startEdit(dateKey,idx); }}
                                onChange={function(e){ if(isEditing) setEditValues(function(v){ return {...v,name:e.target.value}; }); }}
                                onKeyDown={function(e){ if(isEditing) handleKeyDown(e,dateKey,idx); }}
                                onBlur={function(e){ if(isEditing) handleBlur(e); }}
                                onMouseDown={function(){ if(filled&&!slot.done&&!isEditing&&!selectMode) startDragLongPress(dateKey,idx,0,0); }}
                                onMouseUp={function(){ cancelDragLongPress(); }}
                                placeholder="" data-rowkey={rowKey}
                                style={{flex:1,minWidth:0,pointerEvents:slot.done?"none":"auto",fontSize:"13px",color:wasRemoved?"#c0392b":slot.done?"#2a6a2a":slot.pending?"#9a8458":filled?"#1a1a1a":"#999",fontStyle:slot.pending?"italic":"normal",textDecoration:"none",background:"transparent",border:"none",outline:"none",padding:"0 2px",fontFamily:"Georgia,serif",cursor:isEditing?"text":"pointer",caretColor:isEditing?"#444":"transparent",WebkitUserSelect:isEditing?"text":"none",userSelect:isEditing?"text":"none",WebkitAppearance:"none",appearance:"none"}}
                              />
                              {!isEditing&&(
                                <div style={{display:"flex",alignItems:"center",gap:"6px",flexShrink:0}}
                                  onMouseDown={function(e){ e.stopPropagation(); }}
                                  onTouchStart={function(e){ e.stopPropagation(); }}
                                  onTouchEnd={function(e){ e.stopPropagation(); }}
                                >
                                  {filled&&slot.pending&&!slot.done&&<button onClick={function(e){ e.stopPropagation(); lockInSlot(dateKey,idx); }} title="Lock in" style={{display:"flex",alignItems:"center",gap:"3px",background:"#c9a96e",border:"none",borderRadius:"6px",cursor:"pointer",padding:view==="Week"?"3px 5px":"3px 7px",lineHeight:1,flexShrink:0}}><LockIcon size={12} color="#0f0f0f"/>{view!=="Week"&&<span style={{fontSize:"10px",color:"#0f0f0f",letterSpacing:"0.04em"}}>Lock</span>}</button>}
                                  {view!=="Week"&&filled&&slot.price&&<span style={{fontSize:"12px",color:slot.done?"#3a5a3a":"#a07830"}}>{slot.price}</span>}
                                  {view!=="Week"&&filled&&(
                                    <div onClick={function(e){ e.stopPropagation(); if(slot.recurWeeks) openClientProfile(slot.name); }} style={{width:"26px",textAlign:"right",fontSize:"9px",color:slot.isException?"#a07830":"#6a8aaa",flexShrink:0,cursor:slot.recurWeeks?"pointer":"default",lineHeight:1}}>
                                      {slot.recurWeeks?((slot.recurWeeks===1?"1w":(slot.recurWeeks+"w"))+(slot.isException?"*":"")):""}
                                    </div>
                                  )}
                                  {view!=="Week"&&filled&&<button onClick={function(e){ e.stopPropagation(); if(slot.groupId){var aS=getSlots(dateKey);var gS=aS.map(function(s,i){ return {...s,i}; }).filter(function(s){ return s.groupId===slot.groupId&&s.name; });if(gS.length>1){setGroupRecurModal({dateKey,idx,slot,groupSlots:gS,weeks:null});return;}} setRecurringModal({dateKey,idx,slot}); }} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 5px",color:slot.recurWeeks?"#4a8a9a":"#bbb",fontSize:"16px",fontWeight:"normal",lineHeight:1}}>{"↺"}</button>}
                                  {view!=="Week"&&filled&&<button onClick={function(e){ e.stopPropagation(); setNoteDraft(slot.note||""); setNoteModal({dateKey,idx,name:slot.name}); }} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 5px",color:slot.note?"#c9a96e":"#bbb",fontSize:"22px",fontWeight:"bold",lineHeight:1,WebkitTextStroke:"0.6px currentColor"}}>{"✎"}</button>}
                                </div>
                              )}
                              {isEditing&&<input value={editValues.price} onChange={function(e){ setEditValues(function(v){ return {...v,price:e.target.value}; }); }} onKeyDown={function(e){ handleKeyDown(e,dateKey,idx); }} onBlur={handleBlur} data-rowkey={rowKey} placeholder="$" style={{width:"52px",fontSize:"13px",color:"#1a1a1a",background:"#f0f0ee",border:"1px solid #d8d8d6",borderRadius:"4px",outline:"none",padding:"2px 5px",fontFamily:"Georgia,serif",WebkitAppearance:"none",appearance:"none"}}/>}
                              {isEditing&&<button data-rowkey={rowKey} onMouseDown={function(e){ e.preventDefault(); }} onClick={function(e){ e.preventDefault(); commitPenciled(dateKey,idx); }} title="Penciled in — offered, waiting to hear back" style={{flexShrink:0,marginLeft:"4px",display:"flex",alignItems:"center",gap:"3px",background:"#fff",border:"1px solid #d8c08a",borderRadius:"6px",cursor:"pointer",padding:"3px 7px",fontFamily:"Georgia,serif",fontSize:"11px",color:"#9a7a30",lineHeight:1,whiteSpace:"nowrap"}}>{"✎ Pencil"}</button>}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div style={{display:"flex",gap:"6px",padding:"6px 14px 8px"}}>
                    <button onClick={function(){ addSlotToBeginning(dateKey); }} style={{flex:1,padding:"9px",background:"#f4f4f2",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",letterSpacing:"0.08em"}} onMouseEnter={function(e){ e.currentTarget.style.background="#e8e8e6"; }} onMouseLeave={function(e){ e.currentTarget.style.background="#f4f4f2"; }}>+ AM</button>
                    {selectMode ? (
                      <button onClick={function(){
                        var entries=Object.keys(selectedSlots).filter(function(k){ return selectedSlots[k]; });
                        if(entries.length===0){ setSelectMode(false); return; }
                        var clients=entries.map(function(k){
                          var parts=k.split("-"); var di=parseInt(parts[parts.length-1]); var dk2=parts.slice(0,parts.length-1).join("-");
                          var sl=getSlots(dk2)[di]; return {name:sl.name,price:sl.price,recurWeeks:sl.recurWeeks,originalTime:sl.time,originalDateKey:dk2,originalIdx:di};
                        }).filter(function(c){ return c.name; });
                        if(clients.length===0){ setSelectMode(false); setSelectedSlots({}); return; }
                        setDragState({clients,sourceKey:null,multi:true}); setDragCalOpen(true); setDragCalMonth(new Date()); setDragCalHover(true);
                      }} style={{flex:1,padding:"9px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"11px"}}>
                        Move {Object.keys(selectedSlots).filter(function(k){ return selectedSlots[k]; }).length}
                      </button>
                    ) : (
                      <button onClick={function(){ setSelectMode(true); setSelectedSlots({}); }} title="Select appointments" style={{flex:1,padding:"9px",background:"#f4f4f2",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center"}} onMouseEnter={function(e){ e.currentTarget.style.background="#e8e8e6"; }} onMouseLeave={function(e){ e.currentTarget.style.background="#f4f4f2"; }}><span style={{width:"15px",height:"15px",borderRadius:"50%",border:"1.5px solid #999",display:"inline-block"}}/></button>
                    )}
                    <button onClick={function(){ addSlotToEnd(dateKey); }} style={{flex:1,padding:"9px",background:"#f4f4f2",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",letterSpacing:"0.08em"}} onMouseEnter={function(e){ e.currentTarget.style.background="#e8e8e6"; }} onMouseLeave={function(e){ e.currentTarget.style.background="#f4f4f2"; }}>+ PM</button>
                  </div>
                  {selectMode && (
                    <div style={{display:"flex",gap:"6px",padding:"0 14px 8px"}}>
                      <button onClick={function(){
                        var all={}; slots.forEach(function(s,i){ if(s.name) all[dateKey+"-"+i]=true; });
                        setSelectedSlots(function(prev){ return {...prev,...all}; });
                      }} style={{fontSize:"10px",padding:"4px 10px",background:"#1a1a1a",border:"none",borderRadius:"4px",color:"#fff",cursor:"pointer",fontFamily:"inherit"}}>Select All</button>
                      <button onClick={function(){ setSelectMode(false); setSelectedSlots({}); }} style={{fontSize:"10px",padding:"4px 10px",background:"none",border:"1px solid #d8d8d6",borderRadius:"4px",color:"#aaa",cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
                    </div>
                  )}
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
const inputStyle = {background:"#efefed",border:"1px solid #d8d8d6",color:"#1a1a1a",padding:"5px 7px",borderRadius:"4px",fontSize:"13px",fontFamily:"Georgia,serif",flex:1,outline:"none"};
