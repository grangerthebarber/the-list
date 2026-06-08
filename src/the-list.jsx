import { useState, useRef, useCallback, useEffect } from "react";

const DEFAULT_TIMES = [
  "6:51", "7:13", "7:36", "7:58",
  "8:21", "8:43", "9:06", "9:28", "9:51", "10:13", "10:36", "10:58",
  "11:21", "11:43", "12:06", "12:28", "12:51",
  "1:13", "1:36", "1:58", "2:21", "2:43", "3:06", "3:28"
];

const WEEK_OPTIONS = [1,2,3,4,5,6,7,8];

function parseTime(t) { const [h,m] = t.split(":").map(Number); return h*60+m; }
let _gid = 1;
function newGroupId() { return "g"+(_gid++); }
const SHORT_MONTHS = [3,4,5,6]; // April(3), May(4), June(5), July(6) — 0-based
function smartDate(date, includeWeekday=false) {
  const month = date.getMonth();
  const monthStyle = SHORT_MONTHS.includes(month) ? "long" : "short";
  const opts = {month: monthStyle, day:"numeric"};
  if (includeWeekday) opts.weekday = "long";
  return date.toLocaleDateString("en-US", opts);
}
function toDateKey(date) { return date.toISOString().split("T")[0]; }
function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate()+n); return d; }
function addWeeks(date, n) { return addDays(date, n*7); }
function isToday(date) { return date.toDateString() === new Date().toDateString(); }
function capitalizeFirst(str) { if (!str) return str; return str.charAt(0).toUpperCase()+str.slice(1); }
function parseDateKey(key) { const [y,m,d] = key.split("-").map(Number); return new Date(y,m-1,d); }
function formatDateKey(date) { return toDateKey(date); }
function friendlyDate(dateKey) {
  const d = parseDateKey(dateKey);
  const month = d.getMonth();
  const monthStyle = [3,4,5,6].includes(month) ? "long" : "short";
  return d.toLocaleDateString("en-US", { weekday:"short", month:monthStyle, day:"numeric" });
}
function dayOfWeek(dateKey) { return parseDateKey(dateKey).getDay(); }

const VIEWS = ["Day","3-Day","Wknd","Week","Month"];

// US Federal Holidays (month is 1-based)
function getNthWeekday(year, month, weekday, n) {
  // weekday: 0=Sun,1=Mon,...  n: 1-based (or -1 for last)
  if (n === -1) {
    const last = new Date(year, month, 0);
    const d = last.getDay();
    const diff = (d - weekday + 7) % 7;
    return new Date(year, month-1, last.getDate()-diff);
  }
  const first = new Date(year, month-1, 1);
  const d = first.getDay();
  const diff = (weekday - d + 7) % 7;
  return new Date(year, month-1, 1 + diff + (n-1)*7);
}
function getUSHolidays(year) {
  const h = {};
  const add = (date, name) => { if(date) h[toDateKey(date)] = name; };
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

export default function TheList() {
  const [view, setView] = useState("Day");
  const [baseDate, setBaseDate] = useState(new Date());
  const [schedules, setSchedules] = useState(() => loadFromStorage("tl_schedules", {}));
  const [editingCell, setEditingCell] = useState(null);
  const [editValues, setEditValues] = useState({ name:"", price:"" });
  const [addSlotDay, setAddSlotDay] = useState(null);
  const [newSlotTime, setNewSlotTime] = useState("");
  const [history, setHistory] = useState(() => loadFromStorage("tl_history", []));
  const [showHistory, setShowHistory] = useState(false);
  const [recentlyRemoved, setRecentlyRemoved] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [swipedSlot, setSwipedSlot] = useState(null);
  const [recurringModal, setRecurringModal] = useState(null); // {dateKey, idx, slot}
  const [checkoffModal, setCheckoffModal] = useState(null); // {dateKey, idx, slot, nextDateKey, conflict, notRecurring}
  const [nudgedDate, setNudgedDate] = useState(null); // override dateKey for next booking
  const [conflictModal, setConflictModal] = useState(null); // {conflicts, onCancel}
  const [reassignMode, setReassignMode] = useState(null); // {client:{name,price,recurWeeks}, currentDateKey, remainingConflicts}
  const [reassignApplyAll, setReassignApplyAll] = useState(null);
  const [groupConfirm, setGroupConfirm] = useState(null);
  const [groupRecurModal, setGroupRecurModal] = useState(null); // {dateKey, idx, slot, groupSlots, recurCount, weeks}
  const [clientMemory, setClientMemory] = useState(() => loadFromStorage("tl_clients", []));
  const [customHolidays, setCustomHolidays] = useState(() => loadFromStorage("tl_holidays", [])); // [{dateKey, name, yearly}]
  const [holidayModal, setHolidayModal] = useState(null); // {dateKey} or null
  const [newHolidayName, setNewHolidayName] = useState("");
  const [newHolidayYearly, setNewHolidayYearly] = useState(false);
  const [blockLabelModal, setBlockLabelModal] = useState(null); // {dateKey, idx}
  const [blockLabel, setBlockLabel] = useState("Lunch");
  const [clientProfile, setClientProfile] = useState(null); // {name, price, recurWeeks, usualTime}
  const longPressTimer = useRef(null);
  const [monthLongPress, setMonthLongPress] = useState(null); // {dateKey, day}

  const editingRef = useRef(null);
  const editValuesRef = useRef(editValues);
  editValuesRef.current = editValues;
  const touchStart = useRef(null);

  // Save to localStorage whenever data changes
  useEffect(() => { try { localStorage.setItem("tl_schedules", JSON.stringify(schedules)); } catch(e) {} }, [schedules]);
  useEffect(() => { try { localStorage.setItem("tl_clients", JSON.stringify(clientMemory)); } catch(e) {} }, [clientMemory]);
  useEffect(() => { try { localStorage.setItem("tl_holidays", JSON.stringify(customHolidays)); } catch(e) {} }, [customHolidays]);
  useEffect(() => { try { localStorage.setItem("tl_history", JSON.stringify(history)); } catch(e) {} }, [history]);

  // Holiday lookup helpers
  const getHolidayForDate = (dateKey) => {
    const d = parseDateKey(dateKey);
    const year = d.getFullYear();
    const usHolidays = getUSHolidays(year);
    if (usHolidays[dateKey]) return usHolidays[dateKey];
    // Check custom holidays
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
  const schedulesRef = useRef(schedules);
  schedulesRef.current = schedules;

  const getDayCount = () => view==="Day"?1:view==="3-Day"?3:view==="Wknd"?2:7;
  const getDates = () => {
    if (view==="Week") {
      const d = new Date(baseDate);
      const day = d.getDay();
      const diff = day===0 ? -6 : 1-day;
      const monday = addDays(d, diff);
      return Array.from({length:7},(_,i)=>addDays(monday,i));
    }
    if (view==="Wknd") {
      // Show upcoming weekend. If Fri/Sat/Sun, show NEXT weekend.
      const d = new Date(baseDate);
      const day = d.getDay(); // 0=Sun,1=Mon,...,6=Sat
      let daysToSat;
      if (day === 6) daysToSat = 7;       // Sat -> next Sat
      else if (day === 0) daysToSat = 6;  // Sun -> next Sat
      else if (day === 5) daysToSat = 7;  // Fri -> next Sat
      else daysToSat = 6 - day;           // Mon-Thu -> this Sat
      const sat = addDays(d, daysToSat);
      return [sat, addDays(sat, 1)];
    }
    if (view==="Month") return [];
    return Array.from({length:getDayCount()},(_,i)=>addDays(baseDate,i));
  };
  const getMonthDays = () => {
    const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    const days = [];
    // Pad to Monday start
    const firstDay = d.getDay()===0?6:d.getDay()-1;
    for (let i=0;i<firstDay;i++) days.push(null);
    const daysInMonth = new Date(baseDate.getFullYear(), baseDate.getMonth()+1, 0).getDate();
    for (let i=1;i<=daysInMonth;i++) days.push(new Date(baseDate.getFullYear(),baseDate.getMonth(),i));
    return days;
  };

  const getSlots = useCallback((dateKey) => {
    const custom = schedulesRef.current[dateKey];
    if (!custom) return DEFAULT_TIMES.map(t=>({time:t,name:"",price:"",done:false,recurWeeks:null}));
    return custom;
  }, []);

  const setSlots = (dateKey, slots) => setSchedules(prev=>({...prev,[dateKey]:slots}));

  const addHistoryEntry = (entry) => {
    setHistory(prev=>[{...entry,timestamp:new Date().toLocaleTimeString(),id:Date.now()+Math.random()},...prev].slice(0,200));
  };

  const undoHistoryEntry = (entry) => {
    // Check if undoing would displace someone
    if (entry.type === "added" || entry.type === "recurring_set") {
      // We're removing someone who was added — check if slot still has them
      const slots = getSlots(entry.dateKey);
      const idx = slots.findIndex(s=>s.time===entry.time&&s.name===entry.name);
      if (idx<0) { alert("Can't undo — "+entry.name+" is no longer at "+entry.time+" on "+friendlyDate(entry.dateKey)+"."); return; }
    }
    if (entry.type === "removed") {
      // We're restoring someone — check if slot is now taken by someone else
      const slots = getSlots(entry.dateKey);
      const idx = slots.findIndex(s=>s.time===entry.time);
      if (idx>=0 && slots[idx].name && slots[idx].name!==entry.name) {
        if (!window.confirm("⚠ "+slots[idx].name+" is now in that slot. Undoing will displace them. Continue?")) return;
      }
    }
    // Perform undo
    if (entry.type === "added") {
      const slots = [...getSlots(entry.dateKey)];
      const idx = slots.findIndex(s=>s.time===entry.time&&s.name===entry.name);
      if (idx>=0) { slots[idx]={...slots[idx],name:"",price:"",done:false,recurWeeks:null,isException:false}; setSlots(entry.dateKey,slots); }
    } else if (entry.type === "removed") {
      const slots = [...getSlots(entry.dateKey)];
      const idx = slots.findIndex(s=>s.time===entry.time);
      if (idx>=0) { slots[idx]={...slots[idx],name:entry.name,price:entry.price||"",done:false}; setSlots(entry.dateKey,slots); }
    } else if (entry.type === "edited") {
      const slots = [...getSlots(entry.dateKey)];
      const idx = slots.findIndex(s=>s.time===entry.time);
      if (idx>=0) { slots[idx]={...slots[idx],name:entry.prevName}; setSlots(entry.dateKey,slots); }
    } else if (entry.type === "recurring_set") {
      // Remove all future placements for this person
      const newSchedules = {...schedulesRef.current};
      const sixMonthsOut = new Date(); sixMonthsOut.setMonth(sixMonthsOut.getMonth()+6);
      Object.keys(newSchedules).forEach(dk => {
        if (dk <= entry.dateKey) return;
        const dSlots = [...newSchedules[dk]];
        const si = dSlots.findIndex(s=>s.time===entry.time&&s.name===entry.name&&s.recurWeeks===entry.weeks);
        if (si>=0) {
          if (dSlots[si].done) return; // skip already-done slots
          dSlots[si]={...dSlots[si],name:"",price:"",recurWeeks:null,done:false};
          newSchedules[dk]=dSlots;
        }
      });
      setSchedules(newSchedules);
    } else if (entry.type === "blocked") {
      const slots = [...getSlots(entry.dateKey)];
      const idx = slots.findIndex(s=>s.time===entry.time);
      if (idx>=0) { slots[idx]={...slots[idx],blocked:false,blockLabel:""}; setSlots(entry.dateKey,slots); }
    }
    // Remove entry from history
    setHistory(prev=>prev.filter(h=>h.id!==entry.id));
  };

  const startEdit = (dateKey, idx) => {
    const slot = getSlots(dateKey)[idx];
    editingRef.current = {dateKey,idx};
    setEditingCell({dateKey,idx});
    setEditValues({name:slot.name||"",price:slot.price||""});
    setSwipedSlot(null);
  };

  const doCommit = useCallback((dateKey, idx, values) => {
    const slots = [...getSlots(dateKey)];
    const prev = slots[idx];
    const newName = capitalizeFirst((values.name||"").trim());
    const newPrice = (values.price||"").trim();
    if (newName!==prev.name || newPrice!==prev.price) {
      slots[idx] = {...prev,name:newName,price:newPrice};
      setSlots(dateKey,slots);
      if (prev.name&&!newName) addHistoryEntry({type:"removed",time:prev.time,name:prev.name,dateKey});
      else if (!prev.name&&newName) {
        addHistoryEntry({type:"added",time:slots[idx].time,name:newName,price:newPrice,dateKey});
        // Save to client memory
        setClientMemory(mem => {
          const existing = mem.findIndex(c=>c.name.toLowerCase()===newName.toLowerCase());
          if (existing>=0) {
            const updated = [...mem];
            updated[existing] = {name:newName, price:newPrice||mem[existing].price};
            return updated;
          }
          return [...mem, {name:newName, price:newPrice}];
        });
      }
      else if (prev.name&&newName) addHistoryEntry({type:"edited",time:slots[idx].time,name:newName,prevName:prev.name,dateKey});
    }
    editingRef.current = null;
    setEditingCell(null);
  },[getSlots]);

  const handleBlur = useCallback((e) => {
    const related = e.relatedTarget;
    if (related && related.dataset && related.dataset.rowkey===((editingRef.current && editingRef.current.dateKey)+"-"+(editingRef.current && editingRef.current.idx))) return;
    setTimeout(()=>{ if (editingRef.current) doCommit(editingRef.current.dateKey,editingRef.current.idx,editValuesRef.current); },100);
  },[doCommit]);

  const handleKeyDown = (e, dateKey, idx) => {
    if (e.key==="Tab") return;
    if (e.key==="Enter" && e.shiftKey) {
      e.preventDefault();
      const currentVals = editValuesRef.current;
      const slots = [...getSlots(dateKey)];
      const currentSlot = slots[idx];
      const newName = capitalizeFirst((currentVals.name||"").trim());
      const newPrice = (currentVals.price||"").trim();
      if (!newName) return;
      // Reuse existing groupId from this slot OR any adjacent grouped slot OR create new
      const gid = currentSlot.groupId ||
        (idx > 0 && slots[idx-1].groupId) ||
        newGroupId();
      slots[idx] = {...currentSlot, name:newName, price:newPrice, groupId:gid};
      if (idx < slots.length-1) {
        slots[idx+1] = {...slots[idx+1], name:newName, price:newPrice, groupId:gid};
      }
      setSlots(dateKey, slots);
      addHistoryEntry({type:"added", time:slots[idx].time, name:newName, price:newPrice, dateKey});
      editingRef.current = null;
      setEditingCell(null);
      if (idx < slots.length-1) {
        // Small delay to let state settle before opening next slot
        setTimeout(()=>startEdit(dateKey, idx+1), 80);
      }
    } else if (e.key==="Enter") {
      e.preventDefault(); doCommit(dateKey,idx,editValuesRef.current);
    } else if (e.key==="ArrowDown") {
      e.preventDefault();
      doCommit(dateKey,idx,editValuesRef.current);
      const s=getSlots(dateKey);
      if(idx<s.length-1) setTimeout(()=>startEdit(dateKey,idx+1),80);
    } else if (e.key==="ArrowUp") {
      e.preventDefault();
      doCommit(dateKey,idx,editValuesRef.current);
      if(idx>0) setTimeout(()=>startEdit(dateKey,idx-1),80);
    } else if (e.key==="Escape") { editingRef.current=null; setEditingCell(null); }
  };

  // Find next same-day-of-week date that is N weeks out
  const getNextDateKey = (fromDateKey, weeks) => {
    const next = addWeeks(parseDateKey(fromDateKey), weeks);
    return formatDateKey(next);
  };

  // Check if a slot time is taken on a given day
  const isSlotTaken = (dateKey, time) => {
    const slots = getSlots(dateKey);
    return slots.some(s=>s.time===time && s.name);
  };

  // Handle check-off tap
  // First tap = quietly mark done. Second tap = open booking/recurring modal.
  const handleCheckoff = (dateKey, idx) => {
    const slots = getSlots(dateKey);
    const slot = slots[idx];
    if (!slot.name) return;

    if (!slot.done) {
      // First tap — just mark done, no modal
      const updated = [...slots];
      updated[idx] = {...slot, done:true};
      setSlots(dateKey, updated);
      return;
    }

    // Second tap — open the next booking modal
    if (slot.recurWeeks) {
      const nextKey = getNextDateKey(dateKey, slot.recurWeeks);
      const conflict = isSlotTaken(nextKey, slot.time);
      setNudgedDate(nextKey);
      setCheckoffModal({dateKey, idx, slot, nextDateKey:nextKey, conflict, notRecurring:false});
    } else {
      // Not recurring — ask if they want to book again
      setNudgedDate(null);
      setCheckoffModal({dateKey, idx, slot, nextDateKey:null, conflict:false, notRecurring:true});
    }
  };

  const confirmNextBooking = (targetDateKey) => {
    if (!checkoffModal) return;
    const {slot} = checkoffModal;

    // Place the immediate next slot
    const newSchedules = {...schedulesRef.current};
    const daySlots = newSchedules[targetDateKey]
      ? [...newSchedules[targetDateKey]]
      : DEFAULT_TIMES.map(t=>({time:t,name:"",price:"",done:false,recurWeeks:null}));
    const slotIdx = daySlots.findIndex(s=>s.time===slot.time);
    if (slotIdx>=0) {
      daySlots[slotIdx] = {...daySlots[slotIdx], name:slot.name, price:slot.price, recurWeeks:slot.recurWeeks, done:false};
    } else {
      daySlots.push({time:slot.time,name:slot.name,price:slot.price,recurWeeks:slot.recurWeeks,done:false});
      daySlots.sort((a,b)=>parseTime(a.time)-parseTime(b.time));
    }
    newSchedules[targetDateKey] = daySlots;

    // If recurring, fill forward from the new anchor date
    if (slot.recurWeeks) {
      const sixMonthsOut = new Date();
      sixMonthsOut.setMonth(sixMonthsOut.getMonth()+6);
      let cursor = parseDateKey(targetDateKey);
      while (true) {
        cursor = addWeeks(cursor, slot.recurWeeks);
        if (cursor > sixMonthsOut) break;
        const futureKey = formatDateKey(cursor);
        const fSlots = newSchedules[futureKey]
          ? [...newSchedules[futureKey]]
          : DEFAULT_TIMES.map(t=>({time:t,name:"",price:"",done:false,recurWeeks:null}));
        const fi = fSlots.findIndex(s=>s.time===slot.time);
        if (fi>=0) {
          if (!fSlots[fi].name) fSlots[fi] = {...fSlots[fi],name:slot.name,price:slot.price,recurWeeks:slot.recurWeeks,done:false};
        } else {
          fSlots.push({time:slot.time,name:slot.name,price:slot.price,recurWeeks:slot.recurWeeks,done:false});
          fSlots.sort((a,b)=>parseTime(a.time)-parseTime(b.time));
        }
        newSchedules[futureKey] = fSlots;
      }
    }

    setSchedules(newSchedules);
    addHistoryEntry({type:"added",time:slot.time,name:slot.name,price:slot.price,dateKey:targetDateKey});
    setCheckoffModal(null);
    setNudgedDate(null);
  };

  const jumpToDate = (dateKey) => {
    setBaseDate(parseDateKey(dateKey));
    setView("Day");
    setCheckoffModal(null);
    setNudgedDate(null);
  };

  const openClientProfile = (name) => {
    // Find all future bookings for this client across all scheduled days
    const today = toDateKey(new Date());
    const bookings = [];
    // Check schedules
    Object.entries(schedulesRef.current).forEach(([dateKey, slots]) => {
      if (dateKey < today) return;
      slots.forEach(slot => {
        if (slot.name === name) {
          bookings.push({dateKey, time:slot.time, price:slot.price, recurWeeks:slot.recurWeeks, isException:slot.isException||false, done:slot.done||false});
        }
      });
    });
    // Also check default slots on days not yet in schedules — only if recurring
    // (default days won't have custom entries yet, so we rely on setRecurring having pre-populated)
    bookings.sort((a,b)=>a.dateKey.localeCompare(b.dateKey));
    // Find usual time (most common time among non-exception bookings)
    const nonException = bookings.filter(b=>!b.isException);
    const usualTime = nonException.length>0 ? nonException[0].time : bookings[0] && bookings[0].time || "";
    const recurWeeks = bookings.find(b=>b.recurWeeks) ? bookings.find(b=>b.recurWeeks).recurWeeks : null || null;
    setClientProfile({name, recurWeeks, usualTime, bookings});
  };

  const removeClientBooking = (dateKey, name) => {
    const slots = [...getSlots(dateKey)];
    const idx = slots.findIndex(s=>s.name===name);
    if (idx<0) return;
    const slot = slots[idx];
    slots[idx] = {...slot, name:"", price:"", recurWeeks:null, isException:false, done:false};
    setSlots(dateKey, slots);
    addHistoryEntry({type:"removed",time:slot.time,name,dateKey,note:"removed from profile"});
    // Refresh profile
    setClientProfile(prev => prev ? {...prev, bookings: prev.bookings.filter(b=>b.dateKey!==dateKey)} : null);
  };

  const startLongPress = (name) => {
    longPressTimer.current = setTimeout(() => {
      openClientProfile(name);
    }, 600);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // Called when user taps an open slot during reassign mode — instantly places client
  const handleReassignSlotTap = (dateKey, idx) => {
    if (!reassignMode) return;
    if (reassignMode.currentDateKey !== dateKey) return;
    const {client, remainingConflicts} = reassignMode;
    const slots = [...getSlots(dateKey)];
    const slot = slots[idx];
    if (slot.name) return; // slot taken, ignore

    // Instantly place client — keep recurWeeks, mark as exception
    const newSlots = [...slots];
    newSlots[idx] = {...slot, name:client.name, price:client.price, recurWeeks:client.recurWeeks, isException:true, done:false};
    setSlots(dateKey, newSlots);
    addHistoryEntry({type:"added", time:slot.time, name:client.name, price:client.price, dateKey, note:"conflict exception"});

    setReassignMode(null);

    if (remainingConflicts.length > 0) {
      setReassignApplyAll({altTime:slot.time, remainingConflicts, client});
    }
  };

  // Apply alternate time to all remaining conflicts — keeps recurWeeks so still shows as recurring
  const applyAltTimeToConflicts = (altTime, conflicts, client) => {
    const newSchedules = {...schedulesRef.current};
    conflicts.forEach(c => {
      const daySlots = newSchedules[c.dateKey]
        ? [...newSchedules[c.dateKey]]
        : DEFAULT_TIMES.map(t=>({time:t,name:"",price:"",done:false,recurWeeks:null}));
      const targetIdx = daySlots.findIndex(s=>s.time===altTime);
      if (targetIdx>=0 && !daySlots[targetIdx].name) {
        // Keep recurWeeks so badge still shows, mark as exception so we know time differs
        daySlots[targetIdx] = {...daySlots[targetIdx],name:client.name,price:client.price,recurWeeks:client.recurWeeks,isException:true,done:false};
        newSchedules[c.dateKey] = daySlots;
        addHistoryEntry({type:"added",time:altTime,name:client.name,price:client.price,dateKey:c.dateKey,note:"conflict exception"});
      }
    });
    setSchedules(newSchedules);
    setReassignApplyAll(null);
  };

  // Build new schedules for recurring, returns {newSchedules, conflicts}
  const buildRecurringSchedules = (baseSchedules, dateKey, sourceSlot, weeks) => {
    const newSchedules = {...baseSchedules};
    const conflicts = [];
    const sixMonthsOut = new Date();
    sixMonthsOut.setMonth(sixMonthsOut.getMonth() + 6);
    let cursor = parseDateKey(dateKey);
    while (true) {
      cursor = addWeeks(cursor, weeks);
      if (cursor > sixMonthsOut) break;
      const futureKey = formatDateKey(cursor);
      const daySlots = newSchedules[futureKey]
        ? [...newSchedules[futureKey]]
        : DEFAULT_TIMES.map(t=>({time:t,name:"",price:"",done:false,recurWeeks:null}));
      const existingIdx = daySlots.findIndex(s=>s.time===sourceSlot.time);
      if (existingIdx>=0 && daySlots[existingIdx].name && daySlots[existingIdx].name!==sourceSlot.name) {
        conflicts.push({dateKey:futureKey, time:sourceSlot.time, name:sourceSlot.name, price:sourceSlot.price, recurWeeks:weeks, existingName:daySlots[existingIdx].name});
      } else if (existingIdx>=0 && !daySlots[existingIdx].name) {
        daySlots[existingIdx] = {...daySlots[existingIdx],name:sourceSlot.name,price:sourceSlot.price,recurWeeks:weeks,done:false,groupId:sourceSlot.groupId||null};
        newSchedules[futureKey] = daySlots;
      } else if (existingIdx<0) {
        daySlots.push({time:sourceSlot.time,name:sourceSlot.name,price:sourceSlot.price,recurWeeks:weeks,done:false,groupId:sourceSlot.groupId||null});
        daySlots.sort((a,b)=>parseTime(a.time)-parseTime(b.time));
        newSchedules[futureKey] = daySlots;
      }
    }
    return {newSchedules, conflicts};
  };



  const setRecurring = (dateKey, idx, weeks) => {
    const sourceSlots = [...getSlots(dateKey)];
    const sourceSlot = sourceSlots[idx];
    sourceSlots[idx] = {...sourceSlot, recurWeeks: weeks};
    const baseSchedules = {...schedulesRef.current, [dateKey]: sourceSlots};

    if (weeks) {
      const {newSchedules, conflicts} = buildRecurringSchedules(baseSchedules, dateKey, sourceSlot, weeks);
      if (conflicts.length > 0) {
        setConflictModal({
          conflicts,
          onCancel: () => {
            // Place only on non-conflicting dates
            setSchedules(newSchedules);
            addHistoryEntry({type:"recurring_set",time:sourceSlot.time,name:sourceSlot.name,weeks,dateKey});
            setConflictModal(null);
            setRecurringModal(null);
          }
        });
      } else {
        setSchedules(newSchedules);
        addHistoryEntry({type:"recurring_set",time:sourceSlot.time,name:sourceSlot.name,weeks,dateKey});
        setRecurringModal(null);
      }
    } else {
      // Removing recurring
      const newSchedules = {...schedulesRef.current, [dateKey]: sourceSlots};
      const oldWeeks = sourceSlot.recurWeeks;
      if (oldWeeks) {
        const sixMonthsOut = new Date();
        sixMonthsOut.setMonth(sixMonthsOut.getMonth()+6);
        let cursor = parseDateKey(dateKey);
        while (true) {
          cursor = addWeeks(cursor, oldWeeks);
          if (cursor > sixMonthsOut) break;
          const futureKey = formatDateKey(cursor);
          if (newSchedules[futureKey]) {
            const daySlots = [...newSchedules[futureKey]];
            const si = daySlots.findIndex(s=>s.time===sourceSlot.time&&s.name===sourceSlot.name&&s.recurWeeks===oldWeeks&&!s.done);
            if (si>=0) { daySlots[si]={...daySlots[si],name:"",price:"",recurWeeks:null,done:false}; newSchedules[futureKey]=daySlots; }
          }
        }
      }
      setSchedules(newSchedules);
      addHistoryEntry({type:"recurring_set",time:sourceSlot.time,name:sourceSlot.name,weeks,dateKey});
      setRecurringModal(null);
    }
  };

  const requestRemoveSlot = (dateKey, idx) => {
    const slot = getSlots(dateKey)[idx];
    if (!slot.name) { setSwipedSlot(null); return; }
    if (slot.groupId) {
      // Check how many slots share this groupId
      const slots = getSlots(dateKey);
      const groupSlots = slots.filter(s=>s.groupId===slot.groupId&&s.name);
      if (groupSlots.length > 1) {
        setGroupConfirm({action:'cancel', dateKey, idx, name:slot.name, groupId:slot.groupId});
        setSwipedSlot(null);
        return;
      }
    }
    setConfirmDelete({dateKey,idx,slot});
    setSwipedSlot(null);
  };

  const cancelGroupSlots = (dateKey, groupId, onlyIdx) => {
    const slots = [...getSlots(dateKey)];
    if (onlyIdx !== undefined) {
      // Cancel just this one, remove its groupId linkage
      const slot = slots[onlyIdx];
      slots[onlyIdx] = {...slot, name:"", price:"", done:false, recurWeeks:null, isException:false, groupId:null};
      // If only one remains in group, unlink it too
      const remaining = slots.filter(s=>s.groupId===groupId&&s.name);
      if (remaining.length === 1) {
        const ri = slots.findIndex(s=>s.groupId===groupId&&s.name);
        if (ri>=0) slots[ri] = {...slots[ri], groupId:null};
      }
      addHistoryEntry({type:"removed", time:slot.time, name:slot.name, dateKey});
    } else {
      // Cancel all in group
      slots.forEach((s,i) => {
        if (s.groupId===groupId&&s.name) {
          addHistoryEntry({type:"removed", time:s.time, name:s.name, dateKey});
          slots[i] = {...s, name:"", price:"", done:false, recurWeeks:null, isException:false, groupId:null};
        }
      });
    }
    setSlots(dateKey, slots);
    setGroupConfirm(null);
    setConfirmDelete(null);
  };

  const rescheduleGroupSlots = (dateKey, groupId, onlyIdx, slot) => {
    // Enter reassign mode for this slot; pass groupId so reassign knows about group
    const targetSlot = getSlots(dateKey)[onlyIdx];
    setReassignMode({
      client:{name:targetSlot.name, price:targetSlot.price, recurWeeks:targetSlot.recurWeeks},
      currentDateKey: dateKey,
      remainingConflicts:[],
      groupId: onlyIdx !== undefined ? null : groupId,
      groupDateKey: dateKey,
    });
    setGroupConfirm(null);
    jumpToDate(dateKey);
  };

  const confirmRemoveSlot = () => {
    if (!confirmDelete) return;
    const {dateKey,idx,slot} = confirmDelete;
    const slots = [...getSlots(dateKey)];
    // Clear the person but keep the slot
    slots[idx] = {...slots[idx], name:"", price:"", done:false, recurWeeks:null, isException:false};
    setSlots(dateKey,slots);
    addHistoryEntry({type:"removed",time:slot.time,name:slot.name,price:slot.price,dateKey});
    const key = (dateKey+"-"+idx);
    setRecentlyRemoved(r=>({...r,[key]:true}));
    setTimeout(()=>setRecentlyRemoved(r=>{const n={...r};delete n[key];return n;}),8000);
    setConfirmDelete(null);
  };

  const addCustomSlot = (dateKey) => {
    if (!newSlotTime) return;
    const slots = [...getSlots(dateKey)];
    slots.push({time:newSlotTime,name:"",price:"",done:false,recurWeeks:null});
    slots.sort((a,b)=>parseTime(a.time)-parseTime(b.time));
    setSlots(dateKey,slots);
    setNewSlotTime(""); setAddSlotDay(null);
  };

  const toggleBlockSlot = (dateKey, idx, label) => {
    const slots = [...getSlots(dateKey)];
    const slot = slots[idx];
    if (slot.blocked) {
      // Unblock
      slots[idx] = {...slot, blocked:false, blockLabel:""};
      addHistoryEntry({type:"unblocked", time:slot.time, name:slot.blockLabel||"Blocked", dateKey});
    } else {
      // Block with label
      slots[idx] = {...slot, blocked:true, blockLabel:label||"Lunch", name:"", done:false, recurWeeks:null, isException:false};
      addHistoryEntry({type:"blocked", time:slot.time, name:label||"Lunch", dateKey});
    }
    setSlots(dateKey, slots);
    setBlockLabelModal(null);
    setBlockLabel("Lunch");
    setSwipedSlot(null);
  };

  const getDaySummary = (dateKey) => {
    const slots = getSlots(dateKey);
    const booked = slots.filter(s=>s.name);
    return {booked:booked.length};
  };

  const handleTouchStart = (e,dateKey,idx) => { touchStart.current={x:e.touches[0].clientX,dateKey,idx}; };
  const handleTouchEnd = (e,dateKey,idx) => {
    if (!touchStart.current) return;
    const dx = e.changedTouches[0].clientX-touchStart.current.x;
    if (dx<-50&&touchStart.current.dateKey===dateKey&&touchStart.current.idx===idx) {
      const slots = getSlots(dateKey);
      const slot = slots[idx];
      if (!slot.name && !slot.blocked) {
        // Empty slot — show block label modal
        setBlockLabelModal({dateKey, idx});
        setBlockLabel("Lunch");
      } else if (slot.blocked) {
        // Already blocked — unblock immediately
        toggleBlockSlot(dateKey, idx, null);
      } else {
        // Filled slot — show cancel confirmation
        setSwipedSlot((dateKey+"-"+idx));
      }
    } else if (dx>30) setSwipedSlot(null);
    touchStart.current=null;
  };

  const unreadRemovals = history.filter(h=>h.type==="removed"||h.type==="slot_removed").length;
  const dates = getDates();

  const effectiveNextDate = nudgedDate || (checkoffModal && checkoffModal.nextDateKey);
  const nudgeConflict = effectiveNextDate ? isSlotTaken(effectiveNextDate, checkoffModal && checkoffModal.slot && checkoffModal.slot.time) : false;

  return (
    <div style={{minHeight:"100vh",background:"#ffffff",fontFamily:"Georgia,serif",color:"#1a1a1a",paddingTop:reassignMode?"52px":"0"}}
      onClick={()=>swipedSlot&&setSwipedSlot(null)}>


      {/* MONTH LONG PRESS MODAL */}
      {monthLongPress && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}}
          onClick={()=>setMonthLongPress(null)}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(280px,90vw)"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:"13px",color:"#888",marginBottom:"16px",textAlign:"center"}}>
              {smartDate(monthLongPress.day)}
            </div>
            <button onClick={()=>{
              setBaseDate(monthLongPress.day);
              setView("Day");
              setMonthLongPress(null);
            }} style={{display:"block",width:"100%",padding:"12px",background:"#1a1a1a",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"14px",marginBottom:"10px"}}>
              Add appointment
            </button>
            <button onClick={()=>{
              setHolidayModal({dateKey:monthLongPress.dateKey});
              setMonthLongPress(null);
            }} style={{display:"block",width:"100%",padding:"12px",background:"#fff",border:"1px solid #d8d8d6",borderRadius:"8px",color:"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"14px",marginBottom:"10px"}}>
              Mark as holiday
            </button>
            <button onClick={()=>setMonthLongPress(null)} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#bbb",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* GROUP CONFIRM MODAL */}
      {groupConfirm && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(320px,92vw)"}}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>
              {groupConfirm.action==="cancel"?"Cancel Appointment":"Reschedule"}
            </div>
            <div style={{fontSize:"16px",color:"#1a1a1a",marginBottom:"6px"}}>{groupConfirm.name}</div>
            <div style={{fontSize:"12px",color:"#888",marginBottom:"20px"}}>
              This slot is part of a group. {groupConfirm.action==="cancel"?"Cancel":"Reschedule"} just this one, or all of {groupConfirm.name}'s slots?
            </div>
            <button onClick={()=>{
              if(groupConfirm.action==="cancel") cancelGroupSlots(groupConfirm.dateKey,groupConfirm.groupId,groupConfirm.idx);
              else rescheduleGroupSlots(groupConfirm.dateKey,groupConfirm.groupId,groupConfirm.idx,null);
            }} style={{display:"block",width:"100%",padding:"11px",background:"#1a1a1a",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",marginBottom:"8px"}}>
              Just this one slot
            </button>
            <button onClick={()=>{
              if(groupConfirm.action==="cancel") cancelGroupSlots(groupConfirm.dateKey,groupConfirm.groupId,undefined);
              else rescheduleGroupSlots(groupConfirm.dateKey,groupConfirm.groupId,undefined,null);
            }} style={{display:"block",width:"100%",padding:"11px",background:"#fff",border:"1px solid #d8d8d6",borderRadius:"8px",color:"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",marginBottom:"8px"}}>
              All of {groupConfirm.name}'s slots
            </button>
            <button onClick={()=>setGroupConfirm(null)} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#bbb",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>
              Never mind
            </button>
          </div>
        </div>
      )}

      {/* GROUP RECUR MODAL */}
      {groupRecurModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(340px,92vw)"}}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>Set Recurring</div>
            <div style={{fontSize:"16px",color:"#1a1a1a",marginBottom:"6px"}}>{groupRecurModal.slot.name}</div>
            <div style={{fontSize:"12px",color:"#888",marginBottom:"16px"}}>
              This slot is part of a group of {groupRecurModal.groupSlots.length}. How many slots should recur?
            </div>

            {/* Slot count options */}
            <div style={{display:"flex",gap:"8px",marginBottom:"16px"}}>
              <button
                onClick={()=>setGroupRecurModal(prev=>({...prev,recurCount:1}))}
                style={{flex:1,padding:"10px",background:groupRecurModal.recurCount===1?"#1a1a1a":"#f4f4f2",border:(groupRecurModal.recurCount===1?"1px solid #1a1a1a":"1px solid #d8d8d6"),borderRadius:"8px",color:groupRecurModal.recurCount===1?"#fff":"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}
              >Just this slot</button>
              {groupRecurModal.groupSlots.map((_,i)=> i===0 ? null : (
                <button key={i+1}
                  onClick={()=>setGroupRecurModal(prev=>({...prev,recurCount:i+1}))}
                  style={{flex:1,padding:"10px",background:groupRecurModal.recurCount===i+1?"#1a1a1a":"#f4f4f2",border:(groupRecurModal.recurCount===i+1?"1px solid #1a1a1a":"1px solid #d8d8d6"),borderRadius:"8px",color:groupRecurModal.recurCount===i+1?"#fff":"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}
                >All {i+1} slots</button>
              ))}
            </div>

            {/* Week interval picker */}
            {groupRecurModal.recurCount && (
              <>
                <div style={{fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>Every how many weeks?</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:"6px",marginBottom:"16px"}}>
                  {[1,2,3,4,5,6,7,8].map(w=>(
                    <button key={w}
                      onClick={()=>setGroupRecurModal(prev=>({...prev,weeks:w}))}
                      style={{padding:"7px 12px",borderRadius:"6px",border:"1px solid",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",background:groupRecurModal.weeks===w?"#1a1a1a":"#f4f4f2",borderColor:groupRecurModal.weeks===w?"#1a1a1a":"#d8d8d6",color:groupRecurModal.weeks===w?"#fff":"#666"}}
                    >{w===1?"Weekly":(w+"w")}</button>
                  ))}
                </div>
                {groupRecurModal.weeks && (
                  <button onClick={()=>{
                    const {dateKey,idx,slot,groupSlots,recurCount,weeks} = groupRecurModal;
                    if(recurCount===1){
                      // Just this slot
                      setRecurringModal({dateKey,idx,slot});
                      setGroupRecurModal(null);
                      // Pre-select the weeks
                      setTimeout(()=>setRecurring(dateKey,idx,weeks),50);
                    } else {
                      // Recur all slots in group — apply setRecurring to each, keeping groupId
                      const allSlots = [...getSlots(dateKey)];
                      const slotsToRecur = groupSlots.slice(0, recurCount);
                      // We'll call setRecurring for the first one, then manually handle the rest
                      // to preserve groupId linkage in future occurrences
                      const gid = slot.groupId;
                      slotsToRecur.forEach(gs => {
                        setRecurring(dateKey, gs.i, weeks);
                      });
                      setGroupRecurModal(null);
                    }
                  }} style={{width:"100%",padding:"11px",background:"#1a1a1a",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",marginBottom:"8px"}}>
                    Confirm — every {groupRecurModal.weeks===1?"week":(groupRecurModal.weeks+" weeks")}
                  </button>
                )}
              </>
            )}
            <button onClick={()=>setGroupRecurModal(null)} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#bbb",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Cancel</button>
          </div>
        </div>
      )}

      {/* BLOCK LABEL MODAL */}
      {blockLabelModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(300px,90vw)"}}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>Block This Slot</div>
            <input
              autoFocus
              value={blockLabel}
              onChange={e=>setBlockLabel(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter")toggleBlockSlot(blockLabelModal.dateKey,blockLabelModal.idx,blockLabel);if(e.key==="Escape"){setBlockLabelModal(null);}}}
              placeholder="Lunch, Break, etc."
              style={{...inputStyle,width:"100%",boxSizing:"border-box",marginBottom:"14px",fontSize:"15px"}}
            />
            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={()=>toggleBlockSlot(blockLabelModal.dateKey,blockLabelModal.idx,blockLabel)} style={{flex:1,padding:"10px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Block</button>
              <button onClick={()=>setBlockLabelModal(null)} style={{padding:"10px 16px",background:"none",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* HOLIDAY MODAL */}
      {holidayModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(320px,90vw)"}}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>Mark Holiday</div>
            <div style={{fontSize:"13px",color:"#888",marginBottom:"14px"}}>{friendlyDate(holidayModal.dateKey)}</div>
            <input
              autoFocus
              value={newHolidayName}
              onChange={e=>setNewHolidayName(e.target.value)}
              placeholder="Holiday name"
              style={{...inputStyle,width:"100%",boxSizing:"border-box",marginBottom:"10px"}}
            />
            <label style={{display:"flex",alignItems:"center",gap:"8px",fontSize:"13px",color:"#666",marginBottom:"16px",cursor:"pointer"}}>
              <input type="checkbox" checked={newHolidayYearly} onChange={e=>setNewHolidayYearly(e.target.checked)} />
              Repeat every year
            </label>
            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={()=>{
                if (!newHolidayName.trim()) return;
                setCustomHolidays(prev=>[...prev,{dateKey:holidayModal.dateKey,name:newHolidayName.trim(),yearly:newHolidayYearly}]);
                setHolidayModal(null); setNewHolidayName(""); setNewHolidayYearly(false);
              }} style={{flex:1,padding:"10px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Save</button>
              <button onClick={()=>{setHolidayModal(null);setNewHolidayName("");setNewHolidayYearly(false);}} style={{padding:"10px 16px",background:"none",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* CONFLICT MODAL */}
      {conflictModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#ffffff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"28px 28px 24px",width:"min(400px,92vw)",maxHeight:"80vh",overflowY:"auto"}}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#c0392b",marginBottom:"8px"}}>⚠ Scheduling Conflicts</div>
            <div style={{fontSize:"15px",color:"#1a1a1a",marginBottom:"6px"}}>Some slots are already taken</div>
            <div style={{fontSize:"12px",color:"#888",marginBottom:"16px"}}>
              {conflictModal.conflicts[0] && conflictModal.conflicts[0].name} will be placed on all open dates. The following dates need your attention — tap Jump to sort them out directly.
            </div>
            <div style={{marginBottom:"20px"}}>
              {conflictModal.conflicts.map((c,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 10px",marginBottom:"4px",background:"#fff5f4",border:"1px solid #f0d0cc",borderRadius:"6px"}}>
                  <div>
                    <div style={{fontSize:"12px",color:"#1a1a1a"}}>{friendlyDate(c.dateKey)} · {c.time}</div>
                    <div style={{fontSize:"11px",color:"#c0392b",marginTop:"2px"}}>{c.existingName} is already here</div>
                  </div>
                  <button
                    onClick={()=>{
                      const remaining = conflictModal.conflicts.filter((_,j)=>j!==i);
                      conflictModal.onCancel();
                      setReassignMode({
                        client:{name:c.name,price:c.price||"",recurWeeks:c.recurWeeks},
                        currentDateKey:c.dateKey,
                        remainingConflicts:remaining
                      });
                      jumpToDate(c.dateKey);
                    }}
                    style={{padding:"6px 12px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",letterSpacing:"0.05em",flexShrink:0,marginLeft:"10px"}}
                  >Jump →</button>
                </div>
              ))}
            </div>
            <button onClick={conflictModal.onCancel} style={{width:"100%",padding:"10px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",marginBottom:"8px"}}>
              Place on open dates only
            </button>
            <button onClick={()=>setConflictModal(null)} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#aaa",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>
              Cancel
            </button>
        </div>
      )}

      {/* REASSIGN MODE BANNER */}
      {reassignMode && (
        <div style={{position:"fixed",top:0,left:0,right:0,zIndex:900,background:"#1a1a1a",color:"#fff",padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:"11px",letterSpacing:"0.15em",textTransform:"uppercase",color:"#c9a96e",marginBottom:"2px"}}>Reassigning</div>
            <div style={{fontSize:"14px"}}>Tap any open slot for <strong>{reassignMode.client.name}</strong> on {friendlyDate(reassignMode.currentDateKey)}</div>
          </div>
          <button onClick={()=>setReassignMode(null)} style={{background:"none",border:"1px solid #444",borderRadius:"6px",color:"#888",padding:"6px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Cancel</button>
        </div>
      )}

      {/* APPLY ALT TIME TO ALL CONFLICTS */}
      {reassignApplyAll && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#ffffff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"28px 28px 24px",width:"min(380px,92vw)"}}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#a07830",marginBottom:"8px"}}>Other Conflicts</div>
            <div style={{fontSize:"15px",color:"#1a1a1a",marginBottom:"8px"}}>{reassignApplyAll.client.name} has {reassignApplyAll.remainingConflicts.length} more conflict{reassignApplyAll.remainingConflicts.length!==1?"s":""}</div>
            <div style={{fontSize:"12px",color:"#888",marginBottom:"16px"}}>
              Use <strong>{reassignApplyAll.altTime}</strong> for the other conflicted dates too?
            </div>
            <div style={{marginBottom:"20px"}}>
              {reassignApplyAll.remainingConflicts.map((c,i)=>(
                <div key={i} style={{padding:"7px 10px",marginBottom:"3px",background:"#fff5f4",border:"1px solid #f0d0cc",borderRadius:"6px",fontSize:"12px"}}>
                  <span style={{color:"#888"}}>{friendlyDate(c.dateKey)}</span>
                  <span style={{color:"#c0392b",marginLeft:"8px"}}>{c.existingName} at {c.time}</span>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:"8px",marginBottom:"8px"}}>
              <button
                onClick={()=>applyAltTimeToConflicts(reassignApplyAll.altTime,reassignApplyAll.remainingConflicts,reassignApplyAll.client)}
                style={{flex:1,padding:"10px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}
              >
                Yes — use {reassignApplyAll.altTime} for all
              </button>
              <button
                onClick={()=>setReassignApplyAll(null)}
                style={{flex:1,padding:"10px",background:"#fff",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}
              >
                No — handle individually
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CLIENT PROFILE MODAL */}
      {clientProfile && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#ffffff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"28px 28px 24px",width:"min(400px,92vw)",maxHeight:"80vh",display:"flex",flexDirection:"column"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"6px"}}>
              <div>
                <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#aaa",marginBottom:"4px"}}>Client Profile</div>
                <div style={{fontSize:"20px",color:"#1a1a1a"}}>{clientProfile.name}</div>
              </div>
              <button onClick={()=>setClientProfile(null)} style={{background:"none",border:"none",color:"#aaa",fontSize:"20px",cursor:"pointer",padding:"0 4px"}}>×</button>
            </div>
            {clientProfile.recurWeeks && (
              <div style={{fontSize:"12px",color:"#6a8aaa",marginBottom:"16px"}}>
                ↺ Every {clientProfile.recurWeeks===1?"week":(clientProfile.recurWeeks+" weeks")} · usual time {clientProfile.usualTime}
              </div>
            )}
            <div style={{overflowY:"auto",flex:1}}>
              {clientProfile.bookings.length===0 && (
                <div style={{fontSize:"13px",color:"#aaa",fontStyle:"italic"}}>No upcoming bookings.</div>
              )}
              {clientProfile.bookings.map((b,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",marginBottom:"4px",background:b.isException?"#fffbf0":b.done?"#f4faf4":"#f8f8f6",border:(b.isException?"1px solid #e8d8a0":b.done?"1px solid #c0d8c0":"1px solid #e8e8e6"),borderRadius:"8px"}}>
                  <div>
                    <div style={{fontSize:"13px",color:"#1a1a1a",marginBottom:"2px"}}>
                      {friendlyDate(b.dateKey)}
                      {b.isException&&<span style={{fontSize:"10px",color:"#a07830",marginLeft:"8px",letterSpacing:"0.05em"}}>MOVED</span>}
                      {b.done&&<span style={{fontSize:"10px",color:"#2a7a2a",marginLeft:"8px",letterSpacing:"0.05em"}}>DONE</span>}
                    </div>
                    <div style={{fontSize:"12px",color:b.isException?"#a07830":"#888"}}>
                      {b.time}
                      {b.isException&&clientProfile.usualTime&&b.time!==clientProfile.usualTime&&(
                        <span style={{color:"#bbb",marginLeft:"6px",textDecoration:"line-through"}}>{clientProfile.usualTime}</span>
                      )}
                    </div>
                  </div>
                  {!b.done&&(
                    <div style={{display:"flex",gap:"6px",marginLeft:"10px",flexShrink:0}}>
                      <button
                        onClick={()=>{
                          setClientProfile(null);
                          setReassignMode({client:{name:clientProfile.name,price:b.price,recurWeeks:b.recurWeeks},currentDateKey:b.dateKey,remainingConflicts:[]});
                          jumpToDate(b.dateKey);
                        }}
                        style={{background:"none",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",padding:"5px 10px",fontFamily:"inherit",fontSize:"11px"}}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor="#1a1a1a";e.currentTarget.style.color="#1a1a1a";}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor="#d8d8d6";e.currentTarget.style.color="#888";}}
                      >Edit</button>
                      <button
                        onClick={()=>removeClientBooking(b.dateKey, clientProfile.name)}
                        style={{background:"none",border:"1px solid #e8e8e6",borderRadius:"6px",color:"#ccc",cursor:"pointer",padding:"5px 10px",fontFamily:"inherit",fontSize:"11px"}}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor="#c0392b";e.currentTarget.style.color="#c0392b";}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor="#e8e8e6";e.currentTarget.style.color="#ccc";}}
                      >Cancel</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* RECURRING MODAL */}
      {recurringModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#f8f8f6",border:"1px solid #d8d8d6",borderRadius:"12px",padding:"28px 28px 24px",width:"min(340px,92vw)"}}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#999",marginBottom:"8px"}}>Recurring Schedule</div>
            <div style={{fontSize:"17px",marginBottom:"4px"}}>{recurringModal.slot.name}</div>
            <div style={{fontSize:"12px",color:"#999",marginBottom:"20px"}}>{recurringModal.slot.time} · {friendlyDate(recurringModal.dateKey)}</div>
            <div style={{fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#999",marginBottom:"10px"}}>Every how many weeks?</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:"8px",marginBottom:"20px"}}>
              {WEEK_OPTIONS.map(w=>(
                <button key={w} onClick={()=>setRecurring(recurringModal.dateKey,recurringModal.idx,w)} style={{
                  padding:"8px 14px",borderRadius:"6px",border:"1px solid",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",
                  background:recurringModal.slot.recurWeeks===w?"#1a1a1a":"#f4f4f2",
                  borderColor:recurringModal.slot.recurWeeks===w?"#1a1a1a":"#d8d8d6",
                  color:recurringModal.slot.recurWeeks===w?"#ffffff":"#666",
                }}>
                  {w === 1 ? "Weekly" : (w+"w")}
                </button>
              ))}
            </div>
            {recurringModal.slot.recurWeeks && (
              <button onClick={()=>setRecurring(recurringModal.dateKey,recurringModal.idx,null)} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#999",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"12px"}}>
                Remove recurring
              </button>
            )}
            <button onClick={()=>setRecurringModal(null)} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#aaa",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Cancel</button>
          </div>
        </div>
      )}

      {/* CHECKOFF MODAL */}
      {checkoffModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#f8f8f6",border:"1px solid #d8d8d6",borderRadius:"12px",padding:"28px 28px 24px",width:"min(360px,92vw)"}}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#4a8a5a",marginBottom:"8px"}}>✓ Done</div>
            <div style={{fontSize:"18px",marginBottom:"16px"}}>{checkoffModal.slot.name}</div>

            {checkoffModal.notRecurring ? (
              <>
                <div style={{fontSize:"13px",color:"#888",marginBottom:"20px"}}>Not recurring. When's the next one?</div>

                {/* Quick week options */}
                <div style={{fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>Quick book</div>
                <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"16px"}}>
                  {[2,3,4,5,6].map(w=>{
                    const d = addWeeks(parseDateKey(checkoffModal.dateKey), w);
                    const dk = toDateKey(d);
                    return (
                      <button key={w} onClick={()=>{
                        const slot = checkoffModal.slot;
                        setReassignMode({client:{name:slot.name,price:slot.price,recurWeeks:null},currentDateKey:dk,remainingConflicts:[]});
                        setCheckoffModal(null);
                        setNudgedDate(null);
                        jumpToDate(dk);
                      }} style={{padding:"7px 12px",background:"#f4f4f2",border:"1px solid #d8d8d6",borderRadius:"6px",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",color:"#1a1a1a"}}>
                        {w}w · {([3,4,5,6].includes(d.getMonth())?d.toLocaleDateString("en-US",{month:"long",day:"numeric"}):d.toLocaleDateString("en-US",{month:"short",day:"numeric"}))}
                      </button>
                    );
                  })}
                </div>

                {/* Calendar picker */}
                <div style={{fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>Or pick a date</div>
                <input
                  type="date"
                  value={nudgedDate||""}
                  onChange={e=>setNudgedDate(e.target.value)}
                  style={{...inputStyle,width:"100%",boxSizing:"border-box",marginBottom:"10px"}}
                />
                {nudgedDate && (
                  <button onClick={()=>{
                    const slot = checkoffModal.slot;
                    setReassignMode({client:{name:slot.name,price:slot.price,recurWeeks:null},currentDateKey:nudgedDate,remainingConflicts:[]});
                    setCheckoffModal(null);
                    setNudgedDate(null);
                    jumpToDate(nudgedDate);
                  }} style={{width:"100%",padding:"10px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",marginBottom:"8px"}}>
                    Go to {friendlyDate(nudgedDate)} →
                  </button>
                )}
              </>
            ) : (
              <>
                <div style={{fontSize:"12px",color:"#999",marginBottom:"6px"}}>Every {checkoffModal.slot.recurWeeks === 1 ? "week" : (checkoffModal.slot.recurWeeks+" weeks")} · {checkoffModal.slot.time} · {DAYS[dayOfWeek(checkoffModal.dateKey)]}s</div>

                {/* Nudge date */}
                <div style={{fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#999",margin:"16px 0 8px"}}>Next appointment</div>
                <input
                  type="date"
                  value={effectiveNextDate||""}
                  onChange={e=>setNudgedDate(e.target.value)}
                  style={{...inputStyle,width:"100%",boxSizing:"border-box",marginBottom:"10px"}}
                />

                {nudgedDate && nudgedDate !== checkoffModal.nextDateKey && (
                  <div style={{fontSize:"11px",color:"#a07830",marginBottom:"10px"}}>
                    ↳ Nudged by {Math.round((parseDateKey(nudgedDate)-parseDateKey(checkoffModal.nextDateKey))/(1000*60*60*24))} days · schedule resumes every {checkoffModal.slot.recurWeeks === 1 ? "week" : (checkoffModal.slot.recurWeeks+" weeks")} after this
                  </div>
                )}

                {nudgeConflict && (
                  <div style={{background:"#fff0ee",border:"1px solid #5a2a1a",borderRadius:"6px",padding:"10px 12px",marginBottom:"12px",fontSize:"12px",color:"#fff"}}>
                    ⚠ That slot is already taken on {friendlyDate(effectiveNextDate)}
                  </div>
                )}

                {!nudgeConflict && effectiveNextDate && (
                  <div style={{background:"#f0fff0",border:"1px solid #a0d0a0",borderRadius:"6px",padding:"10px 12px",marginBottom:"12px",fontSize:"12px",color:"#2a7a2a"}}>
                    ✓ {checkoffModal.slot.time} is open on {friendlyDate(effectiveNextDate)}
                  </div>
                )}

                <div style={{display:"flex",gap:"8px",marginBottom:"12px"}}>
                  <button onClick={()=>confirmNextBooking(effectiveNextDate)} style={{flex:1,padding:"10px",background:nudgeConflict?"#5a2a1a":"#c9a96e",border:"none",borderRadius:"6px",color:nudgeConflict?"#e8b84b":"#0f0f0f",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>
                    {nudgeConflict ? "Book anyway" : ("Book "+friendlyDate(effectiveNextDate))}
                  </button>
                  <button onClick={()=>jumpToDate(effectiveNextDate)} style={{padding:"10px 14px",background:"#efefed",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>
                    Jump →
                  </button>
                </div>
              </>
            )}

            <button onClick={()=>{setCheckoffModal(null);setNudgedDate(null);}} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#aaa",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE MODAL */}
      {confirmDelete && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#f8f8f6",border:"1px solid #d8d8d6",borderRadius:"10px",padding:"28px 32px",maxWidth:"320px",width:"90%",textAlign:"center"}}>
            <div style={{fontSize:"11px",letterSpacing:"0.15em",textTransform:"uppercase",color:"#888",marginBottom:"12px"}}>Remove Slot</div>
            <div style={{fontSize:"16px",marginBottom:"6px"}}>
              {confirmDelete.slot.name ? <><span style={{color:"#fff"}}>{confirmDelete.slot.name}</span> at {confirmDelete.slot.time}</> : <>Empty slot at {confirmDelete.slot.time}</>}
            </div>
            <div style={{fontSize:"12px",color:"#999",marginBottom:"24px"}}>This will be logged in your history.</div>
            <div style={{display:"flex",gap:"10px",justifyContent:"center"}}>
              <button onClick={()=>setConfirmDelete(null)} style={{padding:"9px 20px",background:"#e8e8e6",border:"1px solid #d8d8d6",color:"#888",borderRadius:"6px",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Cancel</button>
              <button onClick={confirmRemoveSlot} style={{padding:"9px 20px",background:"#c0392b",border:"1px solid #c0392b",color:"#fff",borderRadius:"6px",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {/* HISTORY DRAWER */}
      {showHistory && (
        <div style={{position:"fixed",top:0,right:0,bottom:0,width:"min(340px,90vw)",zIndex:500,background:"#fafaf8",borderLeft:"1px solid #e4e4e2",overflowY:"auto",padding:"24px 20px",boxShadow:"-4px 0 20px rgba(0,0,0,0.08)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"20px"}}>
              <div style={{fontSize:"11px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#888"}}>Change History</div>
              <button onClick={()=>setShowHistory(false)} style={{background:"none",border:"none",color:"#999",fontSize:"18px",cursor:"pointer"}}>×</button>
            </div>
            {history.length===0 && <div style={{color:"#bbb",fontSize:"13px",fontStyle:"italic"}}>No changes yet.</div>}
            {history.map((entry,i)=>(
              <div key={i} style={{padding:"10px 12px",marginBottom:"6px",borderRadius:"6px",background:(entry.type==="removed"||entry.type==="slot_removed")?"#fff0ee":"#fafaf8",border:((entry.type==="removed"||entry.type==="slot_removed")?"1px solid #e0b0a8":"1px solid #e4e4e2")}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:"3px"}}>
                  <span style={{fontSize:"10px",letterSpacing:"0.1em",textTransform:"uppercase",color:entry.type==="added"?"#4a8a5a":(entry.type==="removed"||entry.type==="slot_removed")?"#8a3a2a":entry.type==="recurring_set"?"#c9a96e":"#666"}}>
                    {entry.type==="added"?"Added":entry.type==="removed"?"Removed":entry.type==="slot_removed"?"Slot Deleted":entry.type==="slot_added"?"Slot Added":entry.type==="recurring_set"?("Set Recurring ("+entry.weeks+"w)"):"Edited"}
                  </span>
                  <span style={{fontSize:"10px",color:"#bbb"}}>{entry.timestamp}</span>
                </div>
                <div style={{fontSize:"13px",color:"#999"}}>
                  {entry.time} {entry.name&&<span style={{color:"#1a1a1a"}}>— {entry.name}</span>}
                  {entry.prevName&&<span style={{color:"#999"}}> (was {entry.prevName})</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* HEADER */}
      <div style={{borderBottom:"1px solid #e8e8e6",padding:"18px 20px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,background:"#ffffff",zIndex:100}}>
        <div style={{display:"flex",gap:"2px",background:"#e8e8e6",padding:"3px",borderRadius:"6px"}}>
          {VIEWS.map(v=>(
            <button key={v} onClick={()=>setView(v)} style={{padding:"5px 12px",fontSize:"10px",letterSpacing:"0.1em",textTransform:"uppercase",border:"none",borderRadius:"4px",cursor:"pointer",background:view===v?"#1a1a1a":"transparent",color:view===v?"#ffffff":"#999",fontFamily:"inherit",transition:"all 0.15s"}}>{v}</button>
          ))}
        </div>
        {view==="Month"&&(
          <div style={{fontSize:"14px",color:"#1a1a1a",letterSpacing:"0.01em"}}>
            {baseDate.toLocaleDateString("en-US",{month:"long",year:"numeric"})}
          </div>
        )}
        <div style={{display:"flex",gap:"4px",alignItems:"center"}}>
          {view!=="Month"&&(
            <button onClick={()=>setBaseDate(d=>addDays(d,-7))} style={{...navBtn,fontSize:"11px",letterSpacing:"-1px"}}>‹‹</button>
          )}
          <button onClick={()=>{
            if(view==="Month"){const d=new Date(baseDate);d.setMonth(d.getMonth()-1);setBaseDate(d);}
            else setBaseDate(d=>addDays(d,-1));
          }} style={navBtn}>‹</button>
          <button onClick={()=>setBaseDate(new Date())} style={{...navBtn,fontSize:"9px",letterSpacing:"0.1em",padding:"0 12px"}}>TODAY</button>
          <button onClick={()=>{
            if(view==="Month"){const d=new Date(baseDate);d.setMonth(d.getMonth()+1);setBaseDate(d);}
            else setBaseDate(d=>addDays(d,1));
          }} style={navBtn}>›</button>
          {view!=="Month"&&(
            <button onClick={()=>setBaseDate(d=>addDays(d,7))} style={{...navBtn,fontSize:"11px",letterSpacing:"-1px"}}>››</button>
          )}
          <button onClick={()=>setShowHistory(true)} style={{...navBtn,background:"#f0f0ee",border:"1px solid #d8d8d6",color:"#666"}}>≡</button>
        </div>
      </div>

      {/* MONTH VIEW */}
      {view==="Month" && (()=>{
        const monthDays = getMonthDays();
        const monthName = baseDate.toLocaleDateString("en-US",{month:"long",year:"numeric"});
        return (
          <div style={{padding:"0"}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",background:"#e8e8e6",gap:"1px",borderBottom:"1px solid #e8e8e6"}}>
              {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d=>(
                <div key={d} style={{padding:"8px 0",textAlign:"center",fontSize:"10px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#aaa",background:"#fafaf8"}}>{d}</div>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"1px",background:"#e8e8e6"}}>
              {monthDays.map((day,i)=>{
                if (!day) return <div key={("empty-"+i)} style={{background:"#f8f8f6",minHeight:"80px"}}/>;
                const dk = toDateKey(day);
                const slots = getSlots(dk);
                const booked = slots.filter(s=>s.name);
                const isT = isToday(day);
                return (
                  <div key={dk}
                    onClick={()=>{ setBaseDate(day); setView("Day"); }}
                    onMouseDown={()=>{ longPressTimer.current = setTimeout(()=>{ setMonthLongPress({dateKey:dk, day}); }, 600); }}
                    onMouseUp={cancelLongPress}
                    onMouseLeave={e=>{ cancelLongPress(); e.currentTarget.style.background=isT?"#fffbf0":"#ffffff"; }}
                    onTouchStart={()=>{ longPressTimer.current = setTimeout(()=>{ setMonthLongPress({dateKey:dk, day}); }, 600); }}
                    onTouchEnd={cancelLongPress}
                    onTouchMove={cancelLongPress}
                    style={{background:isT?"#fffbf0":"#ffffff",minHeight:"80px",padding:"6px 8px",cursor:"pointer",borderTop:isT?"2px solid #a07830":"2px solid transparent",transition:"background 0.1s",userSelect:"none"}}
                    onMouseEnter={e=>e.currentTarget.style.background=isT?"#fff8e8":"#f4f4f2"}
                  >
                    <div style={{display:"flex",alignItems:"baseline",gap:"5px",marginBottom:"3px"}}>
                      <div style={{fontSize:"13px",color:isT?"#a07830":"#1a1a1a",fontWeight:isT?"bold":"normal"}}>{day.getDate()}</div>
                      {getHolidayForDate(dk)&&<div style={{fontSize:"8px",color:"#a07830",letterSpacing:"0.04em",textTransform:"uppercase",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{getHolidayForDate(dk)}</div>}
                    </div>
                    {booked.slice(0,3).map((s,j)=>(
                      <div key={j} style={{fontSize:"10px",color:s.recurWeeks?"#6a8aaa":"#666",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",marginBottom:"1px",letterSpacing:"0.02em"}}>
                        {s.recurWeeks?"↺ ":""}{s.name}
                      </div>
                    ))}
                    {booked.length>3&&<div style={{fontSize:"9px",color:"#bbb"}}>+{booked.length-3} more</div>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* DAY COLUMNS */}
      {view!=="Month" && <div style={{display:"grid",gridTemplateColumns:("repeat("+getDayCount()+",1fr)"),gap:"1px",background:"#d8d8d6"}}>
        {dates.map(date=>{
          const dateKey = toDateKey(date);
          const slots = getSlots(dateKey);
          const summary = getDaySummary(dateKey);
          return (
            <div key={dateKey} style={{background:"#ffffff",display:"flex",flexDirection:"column"}}>
              {/* Day header */}
              <div style={{padding:"12px 14px 10px",borderBottom:"1px solid #ebebea",display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
                <div>
                  {(()=>{
                    const sz = view==="Day"?"22px":"16px";
                    const mo = date.getMonth();
                    const monthStr = [3,4,5,6].includes(mo)
                      ? date.toLocaleDateString("en-US",{month:"long",day:"numeric"})
                      : date.toLocaleDateString("en-US",{month:"short",day:"numeric"});
                    const wdStr = isToday(date)?"Today":date.toLocaleDateString("en-US",{weekday:"short"});
                    return (<>
                      <div style={{fontSize:sz,color:isToday(date)?"#c9893a":"#b89a5a",lineHeight:1.25}}>{wdStr}</div>
                      <div style={{fontSize:sz,color:"#1a1a1a",lineHeight:1.25}}>{monthStr}</div>
                      {getHolidayForDate(dateKey)&&<div style={{fontSize:"9px",color:"#a07830",letterSpacing:"0.08em",textTransform:"uppercase",marginTop:"3px"}}>{getHolidayForDate(dateKey)}</div>}
                    </>);
                  })()}
                </div>
              </div>



              <div style={{flex:1,padding:"6px 0"}}>
                {slots.map((slot,idx)=>{
                  const isEditing = editingCell&&editingCell.dateKey===dateKey&&editingCell.idx===idx;
                  const filled = !!slot.name;
                  const wasRemoved = recentlyRemoved[(dateKey+"-"+idx)];
                  const isSwiped = swipedSlot===(dateKey+"-"+idx);
                  const rowKey = (dateKey+"-"+idx);
                  return (
                    <div key={rowKey} style={{position:"relative",overflow:"hidden",borderBottom:"1px solid #efefed"}}>
                      {/* Swipe reveal — Reschedule + Cancel */}
                      {filled && (
                        <div style={{position:"absolute",right:0,top:0,bottom:0,width:"160px",display:"flex",alignItems:"stretch",opacity:isSwiped?1:0,pointerEvents:isSwiped?"auto":"none",transition:"opacity 0.2s"}}>
                          <button onClick={()=>{
                            setSwipedSlot(null);
                            if(slot.groupId){
                              const gs=getSlots(dateKey).filter(s=>s.groupId===slot.groupId&&s.name);
                              if(gs.length>1){setGroupConfirm({action:'reschedule',dateKey,idx,name:slot.name,groupId:slot.groupId});return;}
                            }
                            setReassignMode({client:{name:slot.name,price:slot.price,recurWeeks:slot.recurWeeks},currentDateKey:dateKey,remainingConflicts:[]});
                            jumpToDate(dateKey);
                          }} style={{flex:1,background:"#2a6a9a",border:"none",color:"#fff",fontSize:"11px",letterSpacing:"0.08em",textTransform:"uppercase",cursor:"pointer",fontFamily:"inherit"}}>Move</button>
                          <button onClick={()=>requestRemoveSlot(dateKey,idx)} style={{flex:1,background:"#c0392b",border:"none",color:"#fff",fontSize:"11px",letterSpacing:"0.08em",textTransform:"uppercase",cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
                        </div>
                      )}

                      <div
                        style={{display:"flex",alignItems:"center",padding:"0 14px",height:"46px",background:slot.blocked?"#f4f4f2":wasRemoved?"#fff0ee":slot.done?"#f4faf4":isEditing?"#f8f8f6":filled?"#fcfcfa":"transparent",transition:"transform 0.2s, background 0.3s",transform:isSwiped?"translateX(-160px)":"translateX(0)",position:"relative",opacity:slot.blocked?0.6:1}}
                        onTouchStart={e=>handleTouchStart(e,dateKey,idx)}
                        onTouchEnd={e=>handleTouchEnd(e,dateKey,idx)}
                      >
                        {wasRemoved&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:"3px",background:"#c0392b"}}/>}
                        {slot.groupId&&!wasRemoved&&(()=>{
                          const daySlots = getSlots(dateKey);
                          const gSlots = daySlots.map((s,i)=>({...s,i})).filter(s=>s.groupId===slot.groupId&&s.name);
                          const first = gSlots[0] && gSlots[0].i === idx;
                          const last = gSlots[gSlots.length-1] && gSlots[gSlots.length-1].i === idx;
                          const inGroup = gSlots.some(s=>s.i===idx);
                          if (!inGroup) return null;
                          return (
                            <div style={{
                              position:"absolute",left:0,
                              top: first ? "50%" : "0",
                              bottom: last ? "50%" : "0",
                              width:"3px",background:"#a07830",borderRadius: first?"3px 3px 0 0": last?"0 0 3px 3px":"0"
                            }}/>
                          );
                        })()}

                        {/* Checkoff button */}
                        <button
                          onClick={()=>handleCheckoff(dateKey,idx)}
                          style={{width:"18px",height:"18px",borderRadius:"50%",border:(slot.done?"1.5px solid #2a7a2a":filled?"1.5px solid #aaaaaa":"1.5px solid #dddddd"),background:slot.done?"#2a7a2a":"transparent",cursor:filled?"pointer":"default",flexShrink:0,marginRight:"10px",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s"}}
                        >
                          {slot.done&&<span style={{color:"#fff",fontSize:"10px",lineHeight:1}}>✓</span>}
                        </button>

                        {/* Time */}
                        <div style={{fontSize:"12px",color:filled?"#c9a96e":"#2e2e2e",width:"40px",flexShrink:0,fontVariantNumeric:"tabular-nums",letterSpacing:"0.02em"}}>
                          {slot.time}
                        </div>

                        {/* Recurring badge */}
                        {slot.recurWeeks&&!isEditing&&(
                          <div
                            onClick={()=>filled&&openClientProfile(slot.name)}
                            style={{fontSize:"9px",color:slot.isException?"#a07830":"#6a8aaa",marginRight:"6px",flexShrink:0,letterSpacing:"0.05em",cursor:filled?"pointer":"default"}}
                          >
                            ↺{slot.recurWeeks===1?"w":(slot.recurWeeks+"w")}{slot.isException?"*":""}
                          </div>
                        )}

                        {slot.blocked ? (
                          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                            <span style={{fontSize:"12px",color:"#aaa",fontStyle:"italic",letterSpacing:"0.05em"}}>{slot.blockLabel||"Blocked"}</span>
                            <span style={{fontSize:"9px",color:"#ccc",letterSpacing:"0.1em",textTransform:"uppercase"}}>swipe to unblock</span>
                          </div>
                        ) : reassignMode&&!filled&&reassignMode.currentDateKey===dateKey ? (
                          <div onClick={()=>handleReassignSlotTap(dateKey,idx)} style={{flex:1,fontSize:"13px",color:"#2a7a2a",cursor:"pointer",padding:"0 2px"}}>
                            tap to place
                          </div>
                        ) : (
                          <div style={{flex:1,display:"flex",alignItems:"center",gap:"4px"}}>
                            {isEditing && slot.name && capitalizeFirst(editValues.name.trim())!==slot.name && editValues.name && (
                              <div style={{position:"absolute",top:"2px",left:"70px",fontSize:"9px",color:"#c0392b"}}>⚠ Replacing {slot.name}</div>
                            )}
                            <input
                              value={isEditing ? editValues.name : (wasRemoved?"":slot.name)}
                              readOnly={!isEditing}
                              onFocus={()=>{ if(!isEditing) startEdit(dateKey,idx); }}
                              onChange={e=>{ if(isEditing) setEditValues(v=>({...v,name:e.target.value})); }}
                              onKeyDown={e=>{ if(isEditing) handleKeyDown(e,dateKey,idx); }}
                              onBlur={e=>{ if(isEditing) handleBlur(e); }}
                              onMouseDown={()=>{ if(filled&&!isEditing) startLongPress(slot.name); }}
                              onMouseUp={cancelLongPress}
                              onTouchStart={()=>{ if(filled&&!isEditing) startLongPress(slot.name); }}
                              onTouchEnd={cancelLongPress}
                              onTouchMove={cancelLongPress}
                              placeholder=""
                              data-rowkey={rowKey}
                              style={{
                                flex:1,
                                fontSize:"13px",
                                color:wasRemoved?"#c0392b":slot.done?"#2a6a2a":filled?"#1a1a1a":"#999",
                                textDecoration:slot.done?"line-through":"none",
                                background: isEditing?"#efefed":"transparent",
                                border:"none",
                                outline:"none",
                                padding: isEditing?"4px 6px":"0 2px",
                                borderRadius: isEditing?"4px":"0",
                                fontFamily:"Georgia,serif",
                                cursor:isEditing?"text":"pointer",
                                caretColor: isEditing?"auto":"transparent",
                                WebkitUserSelect: isEditing?"text":"none",
                                transition:"background 0.1s, padding 0.1s",
                              }}
                            />
                            {(!isEditing) && (
                              <div style={{display:"flex",alignItems:"center",gap:"6px",flexShrink:0}}>
                                {filled&&slot.price&&<span style={{fontSize:"12px",color:slot.done?"#3a5a3a":"#a07830"}}>{slot.price}</span>}
                                {filled&&(
                                  <button
                                    onClick={e=>{
                                      e.stopPropagation();
                                      if(slot.groupId){
                                        const allSlots=getSlots(dateKey);
                                        const gSlots=allSlots.map((s,i)=>({...s,i})).filter(s=>s.groupId===slot.groupId&&s.name);
                                        if(gSlots.length>1){setGroupRecurModal({dateKey,idx,slot,groupSlots:gSlots,weeks:null});return;}
                                      }
                                      setRecurringModal({dateKey,idx,slot});
                                    }}
                                    style={{background:"none",border:"none",cursor:"pointer",padding:"2px 4px",color:slot.recurWeeks?"#4a8a9a":"#ccc",fontSize:"13px",lineHeight:1}}
                                  >↺</button>
                                )}
                              </div>
                            )}
                            {isEditing && (
                              <input
                                value={editValues.price}
                                onChange={e=>setEditValues(v=>({...v,price:e.target.value}))}
                                onKeyDown={e=>handleKeyDown(e,dateKey,idx)}
                                onBlur={handleBlur}
                                data-rowkey={rowKey}
                                placeholder="$"
                                style={{width:"52px",fontSize:"13px",color:"#1a1a1a",background:"#f0f0ee",border:"1px solid #d8d8d6",borderRadius:"4px",outline:"none",padding:"2px 5px",fontFamily:"Georgia,serif"}}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {addSlotDay===dateKey?(
                  <div style={{display:"flex",gap:"6px",padding:"10px 14px",alignItems:"center"}}>
                    <input autoFocus value={newSlotTime} onChange={e=>setNewSlotTime(e.target.value)}
                      onKeyDown={e=>{if(e.key==="Enter")addCustomSlot(dateKey);if(e.key==="Escape")setAddSlotDay(null);}}
                      placeholder="9:47" style={{...inputStyle,width:"72px"}}/>
                    <button onClick={()=>addCustomSlot(dateKey)} style={actionBtn("#c9a96e","#0f0f0f")}>Add</button>
                    <button onClick={()=>setAddSlotDay(null)} style={actionBtn("#1a1a1a","#555")}>Cancel</button>
                  </div>
                ):(
                  <button onClick={()=>setAddSlotDay(dateKey)} style={{display:"block",width:"100%",padding:"11px 14px",background:"none",border:"none",color:"#ddd",fontSize:"10px",letterSpacing:"0.15em",textTransform:"uppercase",cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}
                    onMouseEnter={e=>e.target.style.color="#444"} onMouseLeave={e=>e.target.style.color="#222"}>
                    + Add slot
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>}
    </div>
  );
}

const navBtn = {background:"#e8e8e6",border:"1px solid #d8d8d6",color:"#777",padding:"0 10px",height:"32px",lineHeight:"32px",borderRadius:"4px",cursor:"pointer",fontSize:"15px",fontFamily:"inherit",display:"inline-flex",alignItems:"center",justifyContent:"center"};
const inputStyle = {background:"#efefed",border:"1px solid #d8d8d6",color:"#1a1a1a",padding:"5px 7px",borderRadius:"4px",fontSize:"13px",fontFamily:"Georgia,serif",flex:1,outline:"none"};
const actionBtn = (bg,color) => ({background:bg,border:"none",color,padding:"5px 10px",borderRadius:"4px",cursor:"pointer",fontSize:"11px",fontFamily:"inherit",flexShrink:0});
