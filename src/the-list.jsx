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
const SHORT_MONTHS = [3,4,5,6];
function smartDate(date, includeWeekday) {
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
function friendlyDateLong(dateKey) {
  const d = parseDateKey(dateKey);
  const month = d.getMonth();
  const monthStyle = [3,4,5,6].includes(month) ? "long" : "short";
  return d.toLocaleDateString("en-US", { weekday:"long", month:monthStyle, day:"numeric" });
}
function friendlyDateTime(time, dateKey) {
  return time + ", " + friendlyDateLong(dateKey);
}
function dayOfWeek(dateKey) { return parseDateKey(dateKey).getDay(); }

const VIEWS = ["Day","3-Day","Wknd","Week","Month"];

function getNthWeekday(year, month, weekday, n) {
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
  const [recurringModal, setRecurringModal] = useState(null);
  const [checkoffModal, setCheckoffModal] = useState(null);
  const [nudgedDate, setNudgedDate] = useState(null);
  const [conflictModal, setConflictModal] = useState(null);
  const [reassignMode, setReassignMode] = useState(null);
  const [reassignApplyAll, setReassignApplyAll] = useState(null);
  const [groupConfirm, setGroupConfirm] = useState(null);
  const [groupRecurModal, setGroupRecurModal] = useState(null);
  const [clientMemory, setClientMemory] = useState(() => loadFromStorage("tl_clients", []));
  const [customHolidays, setCustomHolidays] = useState(() => loadFromStorage("tl_holidays", []));
  const [holidayModal, setHolidayModal] = useState(null);
  const [newHolidayName, setNewHolidayName] = useState("");
  const [newHolidayYearly, setNewHolidayYearly] = useState(false);
  const [blockLabelModal, setBlockLabelModal] = useState(null);
  const [blockLabel, setBlockLabel] = useState("Lunch");
  const [clientProfile, setClientProfile] = useState(null);
  const [checkoffCalMonth, setCheckoffCalMonth] = useState(null);
  const longPressTimer = useRef(null);
  const [monthLongPress, setMonthLongPress] = useState(null);

  const editingRef = useRef(null);
  const editValuesRef = useRef(editValues);
  editValuesRef.current = editValues;
  const touchStart = useRef(null);

  useEffect(() => { try { localStorage.setItem("tl_schedules", JSON.stringify(schedules)); } catch(e) {} }, [schedules]);
  useEffect(() => { try { localStorage.setItem("tl_clients", JSON.stringify(clientMemory)); } catch(e) {} }, [clientMemory]);
  useEffect(() => { try { localStorage.setItem("tl_holidays", JSON.stringify(customHolidays)); } catch(e) {} }, [customHolidays]);
  useEffect(() => { try { localStorage.setItem("tl_history", JSON.stringify(history)); } catch(e) {} }, [history]);

  useEffect(() => {
    if (checkoffModal && !checkoffCalMonth) {
      var startKey = checkoffModal.nextDateKey || toDateKey(addWeeks(parseDateKey(checkoffModal.dateKey), 2));
      var d = parseDateKey(startKey);
      setCheckoffCalMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    }
  }, [checkoffModal]);

  const getHolidayForDate = (dateKey) => {
    const d = parseDateKey(dateKey);
    const year = d.getFullYear();
    const usHolidays = getUSHolidays(year);
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
  const schedulesRef = useRef(schedules);
  schedulesRef.current = schedules;

  const getDayCount = () => view==="Day"?1:view==="3-Day"?3:view==="Wknd"?2:7;
  const getDates = () => {
    if (view==="Week") {
      return Array.from({length:7},function(_,i){ return addDays(baseDate,i); });
    }
    if (view==="Wknd") {
      return [baseDate, addDays(baseDate,1)];
    }
    if (view==="Month") return [];
    return Array.from({length:getDayCount()},function(_,i){ return addDays(baseDate,i); });
  };
  const getMonthDays = () => {
    const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    const days = [];
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
    if (entry.type === "added" || entry.type === "recurring_set") {
      const slots = getSlots(entry.dateKey);
      const idx = slots.findIndex(s=>s.time===entry.time&&s.name===entry.name);
      if (idx<0) { alert("Can't undo — "+entry.name+" is no longer at "+entry.time+" on "+friendlyDate(entry.dateKey)+"."); return; }
    }
    if (entry.type === "removed") {
      const slots = getSlots(entry.dateKey);
      const idx = slots.findIndex(s=>s.time===entry.time);
      if (idx>=0 && slots[idx].name && slots[idx].name!==entry.name) {
        if (!window.confirm("⚠ "+slots[idx].name+" is now in that slot. Undoing will displace them. Continue?")) return;
      }
    }
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
      const newSchedules = {...schedulesRef.current};
      const sixMonthsOut = new Date(); sixMonthsOut.setMonth(sixMonthsOut.getMonth()+6);
      Object.keys(newSchedules).forEach(dk => {
        if (dk <= entry.dateKey) return;
        const dSlots = [...newSchedules[dk]];
        const si = dSlots.findIndex(s=>s.time===entry.time&&s.name===entry.name&&s.recurWeeks===entry.weeks);
        if (si>=0) {
          if (dSlots[si].done) return;
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
    setTimeout(function(){ if (editingRef.current) doCommit(editingRef.current.dateKey,editingRef.current.idx,editValuesRef.current); },100);
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
      const gid = currentSlot.groupId || (idx > 0 && slots[idx-1].groupId) || newGroupId();
      slots[idx] = {...currentSlot, name:newName, price:newPrice, groupId:gid};
      var nextIdx = idx + 1;
      while (nextIdx < slots.length && slots[nextIdx].name) {
        nextIdx++;
      }
      if (nextIdx < slots.length) {
        slots[nextIdx] = {...slots[nextIdx], name:newName, price:newPrice, groupId:gid};
        setSlots(dateKey, slots);
        addHistoryEntry({type:"added", time:slots[idx].time, name:newName, price:newPrice, dateKey});
        editingRef.current = null;
        setEditingCell(null);
        setTimeout(function(){ startEdit(dateKey, nextIdx); }, 80);
      } else {
        setSlots(dateKey, slots);
        addHistoryEntry({type:"added", time:slots[idx].time, name:newName, price:newPrice, dateKey});
        editingRef.current = null;
        setEditingCell(null);
      }
    } else if (e.key==="Enter") {
      e.preventDefault(); doCommit(dateKey,idx,editValuesRef.current);
    } else if (e.key==="ArrowDown") {
      e.preventDefault();
      doCommit(dateKey,idx,editValuesRef.current);
      const s=getSlots(dateKey);
      var nextEmpty = idx+1;
      while (nextEmpty < s.length && s[nextEmpty].name) { nextEmpty++; }
      if (nextEmpty < s.length) setTimeout(function(){ startEdit(dateKey,nextEmpty); },80);
    } else if (e.key==="ArrowUp") {
      e.preventDefault();
      doCommit(dateKey,idx,editValuesRef.current);
      var prevEmpty = idx-1;
      while (prevEmpty >= 0 && getSlots(dateKey)[prevEmpty].name) { prevEmpty--; }
      if (prevEmpty >= 0) setTimeout(function(){ startEdit(dateKey,prevEmpty); },80);
    } else if (e.key==="Escape") { editingRef.current=null; setEditingCell(null); }
  };

  const getNextDateKey = (fromDateKey, weeks) => {
    const next = addWeeks(parseDateKey(fromDateKey), weeks);
    return formatDateKey(next);
  };

  const isSlotTaken = (dateKey, time, excludeName) => {
    const slots = getSlots(dateKey);
    return slots.some(function(s) {
      return s.time===time && s.name && (!excludeName || s.name.toLowerCase()!==excludeName.toLowerCase());
    });
  };

  const handleCheckoff = (dateKey, idx) => {
    const slots = getSlots(dateKey);
    const slot = slots[idx];
    if (!slot.name) return;
    if (!slot.done) {
      const updated = [...slots];
      updated[idx] = {...slot, done:true};
      setSlots(dateKey, updated);
      return;
    }
    if (slot.recurWeeks) {
      const nextKey = getNextDateKey(dateKey, slot.recurWeeks);
      const conflict = isSlotTaken(nextKey, slot.time, slot.name);
      setNudgedDate(nextKey);
      setCheckoffCalMonth(null);
      setCheckoffModal({dateKey, idx, slot, nextDateKey:nextKey, conflict, notRecurring:false});
    } else {
      setNudgedDate(null);
      setCheckoffCalMonth(null);
      setCheckoffModal({dateKey, idx, slot, nextDateKey:null, conflict:false, notRecurring:true});
    }
  };

  const confirmNextBooking = (targetDateKey) => {
    if (!checkoffModal) return;
    const {slot} = checkoffModal;
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
    setCheckoffCalMonth(null);
  };

  const jumpToDate = (dateKey) => {
    setBaseDate(parseDateKey(dateKey));
    setView("Day");
    setCheckoffModal(null);
    setNudgedDate(null);
    setCheckoffCalMonth(null);
  };

  const jumpToDateForBooking = (targetDateKey, slot) => {
    setCheckoffModal(null);
    setNudgedDate(null);
    setCheckoffCalMonth(null);
    setBaseDate(parseDateKey(targetDateKey));
    setView("Day");
    setReassignMode({client:{name:slot.name,price:slot.price,recurWeeks:slot.recurWeeks},currentDateKey:targetDateKey,remainingConflicts:[]});
  };

  const openClientProfile = (name) => {
    const today = toDateKey(new Date());
    const bookings = [];
    Object.entries(schedulesRef.current).forEach(([dateKey, slots]) => {
      if (dateKey < today) return;
      slots.forEach(slot => {
        if (slot.name === name) {
          bookings.push({dateKey, time:slot.time, price:slot.price, recurWeeks:slot.recurWeeks, isException:slot.isException||false, done:slot.done||false});
        }
      });
    });
    bookings.sort((a,b)=>a.dateKey.localeCompare(b.dateKey));
    const nonException = bookings.filter(b=>!b.isException);
    const usualTime = nonException.length>0 ? nonException[0].time : (bookings[0] && bookings[0].time) || "";
    const recurWeeks = bookings.find(b=>b.recurWeeks) ? bookings.find(b=>b.recurWeeks).recurWeeks : null;
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
    setClientProfile(prev => prev ? {...prev, bookings: prev.bookings.filter(b=>b.dateKey!==dateKey)} : null);
  };

  const startLongPress = (name) => {
    longPressTimer.current = setTimeout(function() { openClientProfile(name); }, 600);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };

  const handleReassignSlotTap = (dateKey, idx) => {
    if (!reassignMode) return;
    if (reassignMode.currentDateKey !== dateKey) return;
    const {client, remainingConflicts} = reassignMode;
    const slots = [...getSlots(dateKey)];
    const slot = slots[idx];
    if (slot.name) return;
    const newSlots = [...slots];
    newSlots[idx] = {...slot, name:client.name, price:client.price, recurWeeks:client.recurWeeks, isException:true, done:false};
    setSlots(dateKey, newSlots);
    addHistoryEntry({type:"added", time:slot.time, name:client.name, price:client.price, dateKey, note:"conflict exception"});
    setReassignMode(null);
    if (remainingConflicts.length > 0) {
      setReassignApplyAll({altTime:slot.time, remainingConflicts, client});
    }
  };

  const applyAltTimeToConflicts = (altTime, conflicts, client) => {
    const newSchedules = {...schedulesRef.current};
    conflicts.forEach(c => {
      const daySlots = newSchedules[c.dateKey]
        ? [...newSchedules[c.dateKey]]
        : DEFAULT_TIMES.map(t=>({time:t,name:"",price:"",done:false,recurWeeks:null}));
      const targetIdx = daySlots.findIndex(s=>s.time===altTime);
      if (targetIdx>=0 && !daySlots[targetIdx].name) {
        daySlots[targetIdx] = {...daySlots[targetIdx],name:client.name,price:client.price,recurWeeks:client.recurWeeks,isException:true,done:false};
        newSchedules[c.dateKey] = daySlots;
        addHistoryEntry({type:"added",time:altTime,name:client.name,price:client.price,dateKey:c.dateKey,note:"conflict exception"});
      }
    });
    setSchedules(newSchedules);
    setReassignApplyAll(null);
  };

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
      const slot = slots[onlyIdx];
      slots[onlyIdx] = {...slot, name:"", price:"", done:false, recurWeeks:null, isException:false, groupId:null};
      const remaining = slots.filter(s=>s.groupId===groupId&&s.name);
      if (remaining.length === 1) {
        const ri = slots.findIndex(s=>s.groupId===groupId&&s.name);
        if (ri>=0) slots[ri] = {...slots[ri], groupId:null};
      }
      addHistoryEntry({type:"removed", time:slot.time, name:slot.name, dateKey});
    } else {
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
    slots[idx] = {...slots[idx], name:"", price:"", done:false, recurWeeks:null, isException:false};
    setSlots(dateKey,slots);
    addHistoryEntry({type:"removed",time:slot.time,name:slot.name,price:slot.price,dateKey});
    const key = (dateKey+"-"+idx);
    setRecentlyRemoved(r=>({...r,[key]:true}));
    setTimeout(function(){ setRecentlyRemoved(r=>{const n={...r};delete n[key];return n;}); },8000);
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
      slots[idx] = {...slot, blocked:false, blockLabel:""};
      addHistoryEntry({type:"unblocked", time:slot.time, name:slot.blockLabel||"Blocked", dateKey});
    } else {
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
        setBlockLabelModal({dateKey, idx});
        setBlockLabel("Lunch");
      } else if (slot.blocked) {
        toggleBlockSlot(dateKey, idx, null);
      } else {
        setSwipedSlot((dateKey+"-"+idx));
      }
    } else if (dx>30) setSwipedSlot(null);
    touchStart.current=null;
  };

  const unreadRemovals = history.filter(h=>h.type==="removed"||h.type==="slot_removed").length;
  const dates = getDates();

  const effectiveNextDate = nudgedDate || (checkoffModal && checkoffModal.nextDateKey);
  const nudgeConflict = effectiveNextDate ? isSlotTaken(effectiveNextDate, checkoffModal && checkoffModal.slot && checkoffModal.slot.time, checkoffModal && checkoffModal.slot && checkoffModal.slot.name) : false;

  const renderCheckoffCalendar = () => {
    if (!checkoffModal || !checkoffCalMonth) return null;
    const slot = checkoffModal.slot;
    const today = new Date();
    const sixMonthsOut = new Date();
    sixMonthsOut.setMonth(sixMonthsOut.getMonth()+6);

    const year = checkoffCalMonth.getFullYear();
    const month = checkoffCalMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month+1, 0);
    const startDow = firstDay.getDay()===0?6:firstDay.getDay()-1;
    const cells = [];
    for (var i=0; i<startDow; i++) cells.push(null);
    for (var d=1; d<=lastDay.getDate(); d++) cells.push(new Date(year,month,d));

    const monthLabel = checkoffCalMonth.toLocaleDateString("en-US",{month:"long",year:"numeric"});
    const canGoPrev = new Date(year,month-1,1) >= new Date(today.getFullYear(),today.getMonth(),1);
    const canGoNext = new Date(year,month+1,1) <= new Date(sixMonthsOut.getFullYear(),sixMonthsOut.getMonth(),1);

    return (
      <div style={{marginTop:"4px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"8px"}}>
          <button onClick={function(){ if(canGoPrev) setCheckoffCalMonth(new Date(year,month-1,1)); }} style={{background:"none",border:"none",color:canGoPrev?"#666":"#ddd",cursor:canGoPrev?"pointer":"default",fontSize:"16px",padding:"2px 8px",fontFamily:"inherit"}}>‹</button>
          <div style={{fontSize:"12px",color:"#1a1a1a",letterSpacing:"0.05em"}}>{monthLabel}</div>
          <button onClick={function(){ if(canGoNext) setCheckoffCalMonth(new Date(year,month+1,1)); }} style={{background:"none",border:"none",color:canGoNext?"#666":"#ddd",cursor:canGoNext?"pointer":"default",fontSize:"16px",padding:"2px 8px",fontFamily:"inherit"}}>›</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"1px",marginBottom:"2px"}}>
          {["M","T","W","T","F","S","S"].map(function(d,i){ return (
            <div key={i} style={{textAlign:"center",fontSize:"9px",color:"#aaa",letterSpacing:"0.05em",padding:"2px 0"}}>{d}</div>
          ); })}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"2px"}}>
          {cells.map(function(day, i) {
            if (!day) return <div key={"e"+i} style={{height:"34px"}}/>;
            const dk = toDateKey(day);
            const isPast = day < today && !isToday(day);
            const isFuture = day > sixMonthsOut;
            const holiday = getHolidayForDate(dk);
            const daySlots = getSlots(dk);
            const bookedSlots = daySlots.filter(function(s){ return s.name; });
            const targetSlotData = daySlots.find(function(s){ return s.time===slot.time; });
            const slotFree = !targetSlotData || !targetSlotData.name;
            const slotTakenByOther = targetSlotData && targetSlotData.name && targetSlotData.name.toLowerCase()!==slot.name.toLowerCase();
            const isT = isToday(day);
            const disabled = isPast || isFuture;

            var bgColor = "#ffffff";
            if (disabled) bgColor = "#f8f8f8";
            else if (holiday) bgColor = "#fffbf0";
            else if (isT) bgColor = "#fffbf0";

            var borderTop = isT ? "2px solid #a07830" : "2px solid transparent";

            return (
              <div key={dk}
                onClick={function(){ if(disabled) return; jumpToDateForBooking(dk, slot); }}
                style={{height:"34px",background:bgColor,borderTop:borderTop,padding:"3px 4px",cursor:disabled?"default":"pointer",borderRadius:"2px",position:"relative",opacity:disabled?0.35:1}}
              >
                <div style={{fontSize:"11px",color:isT?"#a07830":disabled?"#ccc":"#1a1a1a",fontWeight:isT?"bold":"normal",lineHeight:1}}>{day.getDate()}</div>
                {!disabled && holiday && <div style={{fontSize:"7px",color:"#a07830",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",marginTop:"1px"}}>{holiday}</div>}
                {!disabled && !holiday && bookedSlots.length > 0 && (
                  <div style={{display:"flex",flexWrap:"wrap",gap:"1px",marginTop:"2px"}}>
                    {bookedSlots.slice(0,3).map(function(s,j){
                      return <div key={j} style={{width:"4px",height:"4px",borderRadius:"50%",background:s.recurWeeks?"#6a8aaa":"#c9a96e"}}/>;
                    })}
                  </div>
                )}
                {!disabled && slotTakenByOther && (
                  <div style={{position:"absolute",top:"2px",right:"2px",width:"5px",height:"5px",borderRadius:"50%",background:"#c0392b"}}/>
                )}
              </div>
            );
          })}
        </div>
        <div style={{display:"flex",gap:"12px",marginTop:"8px",paddingTop:"6px",borderTop:"1px solid #f0f0ee"}}>
          <div style={{display:"flex",alignItems:"center",gap:"4px"}}><div style={{width:"6px",height:"6px",borderRadius:"50%",background:"#6a8aaa"}}/><span style={{fontSize:"9px",color:"#aaa"}}>recurring</span></div>
          <div style={{display:"flex",alignItems:"center",gap:"4px"}}><div style={{width:"6px",height:"6px",borderRadius:"50%",background:"#c9a96e"}}/><span style={{fontSize:"9px",color:"#aaa"}}>booked</span></div>
          <div style={{display:"flex",alignItems:"center",gap:"4px"}}><div style={{width:"6px",height:"6px",borderRadius:"50%",background:"#c0392b"}}/><span style={{fontSize:"9px",color:"#aaa"}}>{slot.time} taken</span></div>
        </div>
      </div>
    );
  };

  return (
    <div style={{minHeight:"100vh",background:"#ffffff",fontFamily:"Georgia,serif",color:"#1a1a1a",paddingTop:reassignMode?"52px":"0"}}
      onClick={function(){ if(swipedSlot) setSwipedSlot(null); }}>

      {monthLongPress && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}}
          onClick={function(){ setMonthLongPress(null); }}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(280px,90vw)"}}
            onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"13px",color:"#888",marginBottom:"16px",textAlign:"center"}}>
              {smartDate(monthLongPress.day)}
            </div>
            <button onClick={function(){ setBaseDate(monthLongPress.day);setView("Day");setMonthLongPress(null); }} style={{display:"block",width:"100%",padding:"12px",background:"#1a1a1a",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"14px",marginBottom:"10px"}}>
              Add appointment
            </button>
            <button onClick={function(){ setHolidayModal({dateKey:monthLongPress.dateKey});setMonthLongPress(null); }} style={{display:"block",width:"100%",padding:"12px",background:"#fff",border:"1px solid #d8d8d6",borderRadius:"8px",color:"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"14px",marginBottom:"10px"}}>
              Mark as holiday
            </button>
            <button onClick={function(){ setMonthLongPress(null); }} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#bbb",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>
              Cancel
            </button>
          </div>
        </div>
      )}

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
            <button onClick={function(){
              if(groupConfirm.action==="cancel") cancelGroupSlots(groupConfirm.dateKey,groupConfirm.groupId,groupConfirm.idx);
              else rescheduleGroupSlots(groupConfirm.dateKey,groupConfirm.groupId,groupConfirm.idx,null);
            }} style={{display:"block",width:"100%",padding:"11px",background:"#1a1a1a",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",marginBottom:"8px"}}>
              Just this one slot
            </button>
            <button onClick={function(){
              if(groupConfirm.action==="cancel") cancelGroupSlots(groupConfirm.dateKey,groupConfirm.groupId,undefined);
              else rescheduleGroupSlots(groupConfirm.dateKey,groupConfirm.groupId,undefined,null);
            }} style={{display:"block",width:"100%",padding:"11px",background:"#fff",border:"1px solid #d8d8d6",borderRadius:"8px",color:"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",marginBottom:"8px"}}>
              All of {groupConfirm.name}'s slots
            </button>
            <button onClick={function(){ setGroupConfirm(null); }} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#bbb",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>
              Never mind
            </button>
          </div>
        </div>
      )}

      {groupRecurModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(340px,92vw)"}}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>Set Recurring</div>
            <div style={{fontSize:"16px",color:"#1a1a1a",marginBottom:"6px"}}>{groupRecurModal.slot.name}</div>
            <div style={{fontSize:"12px",color:"#888",marginBottom:"16px"}}>
              This slot is part of a group of {groupRecurModal.groupSlots.length}. How many slots should recur?
            </div>
            <div style={{display:"flex",gap:"8px",marginBottom:"16px"}}>
              <button onClick={function(){ setGroupRecurModal(function(prev){ return {...prev,recurCount:1}; }); }} style={{flex:1,padding:"10px",background:groupRecurModal.recurCount===1?"#1a1a1a":"#f4f4f2",border:(groupRecurModal.recurCount===1?"1px solid #1a1a1a":"1px solid #d8d8d6"),borderRadius:"8px",color:groupRecurModal.recurCount===1?"#fff":"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Just this slot</button>
              {groupRecurModal.groupSlots.map(function(_,i){ return i===0 ? null : (
                <button key={i+1} onClick={function(){ setGroupRecurModal(function(prev){ return {...prev,recurCount:i+1}; }); }} style={{flex:1,padding:"10px",background:groupRecurModal.recurCount===i+1?"#1a1a1a":"#f4f4f2",border:(groupRecurModal.recurCount===i+1?"1px solid #1a1a1a":"1px solid #d8d8d6"),borderRadius:"8px",color:groupRecurModal.recurCount===i+1?"#fff":"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>All {i+1} slots</button>
              ); })}
            </div>
            {groupRecurModal.recurCount && (
              <div>
                <div style={{fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>Every how many weeks?</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:"6px",marginBottom:"16px"}}>
                  {[1,2,3,4,5,6,7,8].map(function(w){ return (
                    <button key={w} onClick={function(){ setGroupRecurModal(function(prev){ return {...prev,weeks:w}; }); }} style={{padding:"7px 12px",borderRadius:"6px",border:"1px solid",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",background:groupRecurModal.weeks===w?"#1a1a1a":"#f4f4f2",borderColor:groupRecurModal.weeks===w?"#1a1a1a":"#d8d8d6",color:groupRecurModal.weeks===w?"#fff":"#666"}}>{w===1?"Weekly":(w+"w")}</button>
                  ); })}
                </div>
                {groupRecurModal.weeks && (
                  <button onClick={function(){
                    const gd = groupRecurModal;
                    if(gd.recurCount===1){
                      setRecurringModal({dateKey:gd.dateKey,idx:gd.idx,slot:gd.slot});
                      setGroupRecurModal(null);
                      setTimeout(function(){ setRecurring(gd.dateKey,gd.idx,gd.weeks); },50);
                    } else {
                      const slotsToRecur = gd.groupSlots.slice(0, gd.recurCount);
                      slotsToRecur.forEach(function(gs){ setRecurring(gd.dateKey, gs.i, gd.weeks); });
                      setGroupRecurModal(null);
                    }
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
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(300px,90vw)"}}>
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
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(320px,90vw)"}}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>Mark Holiday</div>
            <div style={{fontSize:"13px",color:"#888",marginBottom:"14px"}}>{friendlyDate(holidayModal.dateKey)}</div>
            <input autoFocus value={newHolidayName} onChange={function(e){ setNewHolidayName(e.target.value); }}
              placeholder="Holiday name" style={{...inputStyle,width:"100%",boxSizing:"border-box",marginBottom:"10px"}} />
            <label style={{display:"flex",alignItems:"center",gap:"8px",fontSize:"13px",color:"#666",marginBottom:"16px",cursor:"pointer"}}>
              <input type="checkbox" checked={newHolidayYearly} onChange={function(e){ setNewHolidayYearly(e.target.checked); }} />
              Repeat every year
            </label>
            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={function(){
                if (!newHolidayName.trim()) return;
                setCustomHolidays(function(prev){ return [...prev,{dateKey:holidayModal.dateKey,name:newHolidayName.trim(),yearly:newHolidayYearly}]; });
                setHolidayModal(null); setNewHolidayName(""); setNewHolidayYearly(false);
              }} style={{flex:1,padding:"10px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Save</button>
              <button onClick={function(){ setHolidayModal(null);setNewHolidayName("");setNewHolidayYearly(false); }} style={{padding:"10px 16px",background:"none",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {conflictModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#ffffff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"28px 28px 24px",width:"min(400px,92vw)",maxHeight:"80vh",overflowY:"auto"}}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#c0392b",marginBottom:"8px"}}>Scheduling Conflicts</div>
            <div style={{fontSize:"15px",color:"#1a1a1a",marginBottom:"6px"}}>Some slots are already taken</div>
            <div style={{fontSize:"12px",color:"#888",marginBottom:"16px"}}>
              {conflictModal.conflicts[0] && conflictModal.conflicts[0].name} will be placed on all open dates. The following dates need your attention.
            </div>
            <div style={{marginBottom:"20px"}}>
              {conflictModal.conflicts.map(function(c,i){ return (
                <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 10px",marginBottom:"4px",background:"#fff5f4",border:"1px solid #f0d0cc",borderRadius:"6px"}}>
                  <div>
                    <div style={{fontSize:"12px",color:"#1a1a1a"}}>{friendlyDate(c.dateKey)} · {c.time}</div>
                    <div style={{fontSize:"11px",color:"#c0392b",marginTop:"2px"}}>{c.existingName} is already here</div>
                  </div>
                  <button onClick={function(){
                    const remaining = conflictModal.conflicts.filter(function(_,j){ return j!==i; });
                    conflictModal.onCancel();
                    setReassignMode({client:{name:c.name,price:c.price||"",recurWeeks:c.recurWeeks},currentDateKey:c.dateKey,remainingConflicts:remaining});
                    jumpToDate(c.dateKey);
                  }} style={{padding:"6px 12px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",letterSpacing:"0.05em",flexShrink:0,marginLeft:"10px"}}>Jump</button>
                </div>
              ); })}
            </div>
            <button onClick={conflictModal.onCancel} style={{width:"100%",padding:"10px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",marginBottom:"8px"}}>
              Place on open dates only
            </button>
            <button onClick={function(){ setConflictModal(null); }} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#aaa",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {reassignMode && (
        <div style={{position:"fixed",top:0,left:0,right:0,zIndex:900,background:"#1a1a1a",color:"#fff",padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:"11px",letterSpacing:"0.15em",textTransform:"uppercase",color:"#c9a96e",marginBottom:"2px"}}>Reassigning</div>
            <div style={{fontSize:"14px"}}>Tap any open slot for <strong>{reassignMode.client.name}</strong> on {friendlyDate(reassignMode.currentDateKey)}</div>
          </div>
          <button onClick={function(){ setReassignMode(null); }} style={{background:"none",border:"1px solid #444",borderRadius:"6px",color:"#888",padding:"6px 12px",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Cancel</button>
        </div>
      )}

      {reassignApplyAll && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#ffffff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"28px 28px 24px",width:"min(380px,92vw)"}}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#a07830",marginBottom:"8px"}}>Other Conflicts</div>
            <div style={{fontSize:"15px",color:"#1a1a1a",marginBottom:"8px"}}>{reassignApplyAll.client.name} has {reassignApplyAll.remainingConflicts.length} more conflict{reassignApplyAll.remainingConflicts.length!==1?"s":""}</div>
            <div style={{fontSize:"12px",color:"#888",marginBottom:"16px"}}>
              Use <strong>{reassignApplyAll.altTime}</strong> for the other conflicted dates too?
            </div>
            <div style={{marginBottom:"20px"}}>
              {reassignApplyAll.remainingConflicts.map(function(c,i){ return (
                <div key={i} style={{padding:"7px 10px",marginBottom:"3px",background:"#fff5f4",border:"1px solid #f0d0cc",borderRadius:"6px",fontSize:"12px"}}>
                  <span style={{color:"#888"}}>{friendlyDate(c.dateKey)}</span>
                  <span style={{color:"#c0392b",marginLeft:"8px"}}>{c.existingName} at {c.time}</span>
                </div>
              ); })}
            </div>
            <div style={{display:"flex",gap:"8px",marginBottom:"8px"}}>
              <button onClick={function(){ applyAltTimeToConflicts(reassignApplyAll.altTime,reassignApplyAll.remainingConflicts,reassignApplyAll.client); }} style={{flex:1,padding:"10px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>
                Yes — use {reassignApplyAll.altTime} for all
              </button>
              <button onClick={function(){ setReassignApplyAll(null); }} style={{flex:1,padding:"10px",background:"#fff",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>
                No — handle individually
              </button>
            </div>
          </div>
        </div>
      )}

      {clientProfile && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#ffffff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"28px 28px 24px",width:"min(400px,92vw)",maxHeight:"80vh",display:"flex",flexDirection:"column"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"6px"}}>
              <div>
                <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#aaa",marginBottom:"4px"}}>Client Profile</div>
                <div style={{fontSize:"20px",color:"#1a1a1a"}}>{clientProfile.name}</div>
              </div>
              <button onClick={function(){ setClientProfile(null); }} style={{background:"none",border:"none",color:"#aaa",fontSize:"20px",cursor:"pointer",padding:"0 4px"}}>×</button>
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
              {clientProfile.bookings.map(function(b,i){ return (
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
                      <button onClick={function(){ setClientProfile(null);setReassignMode({client:{name:clientProfile.name,price:b.price,recurWeeks:b.recurWeeks},currentDateKey:b.dateKey,remainingConflicts:[]});jumpToDate(b.dateKey); }}
                        style={{background:"none",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",padding:"5px 10px",fontFamily:"inherit",fontSize:"11px"}}
                        onMouseEnter={function(e){ e.currentTarget.style.borderColor="#1a1a1a";e.currentTarget.style.color="#1a1a1a"; }}
                        onMouseLeave={function(e){ e.currentTarget.style.borderColor="#d8d8d6";e.currentTarget.style.color="#888"; }}
                      >Edit</button>
                      <button onClick={function(){ removeClientBooking(b.dateKey, clientProfile.name); }}
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
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#f8f8f6",border:"1px solid #d8d8d6",borderRadius:"12px",padding:"28px 28px 24px",width:"min(340px,92vw)"}}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#999",marginBottom:"8px"}}>Recurring Schedule</div>
            <div style={{fontSize:"17px",marginBottom:"4px"}}>{recurringModal.slot.name}</div>
            <div style={{fontSize:"12px",color:"#999",marginBottom:"20px"}}>{recurringModal.slot.time} · {friendlyDate(recurringModal.dateKey)}</div>
            <div style={{fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#999",marginBottom:"10px"}}>Every how many weeks?</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:"8px",marginBottom:"20px"}}>
              {WEEK_OPTIONS.map(function(w){ return (
                <button key={w} onClick={function(){ setRecurring(recurringModal.dateKey,recurringModal.idx,w); }} style={{padding:"8px 14px",borderRadius:"6px",border:"1px solid",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",background:recurringModal.slot.recurWeeks===w?"#1a1a1a":"#f4f4f2",borderColor:recurringModal.slot.recurWeeks===w?"#1a1a1a":"#d8d8d6",color:recurringModal.slot.recurWeeks===w?"#ffffff":"#666"}}>
                  {w === 1 ? "Weekly" : (w+"w")}
                </button>
              ); })}
            </div>
            {recurringModal.slot.recurWeeks && (
              <button onClick={function(){ setRecurring(recurringModal.dateKey,recurringModal.idx,null); }} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#999",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"12px"}}>
                Remove recurring
              </button>
            )}
            <button onClick={function(){ setRecurringModal(null); }} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#aaa",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Cancel</button>
          </div>
        </div>
      )}

      {checkoffModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1000,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
          <div style={{background:"#f8f8f6",border:"1px solid #d8d8d6",borderRadius:"16px 16px 0 0",padding:"24px 20px 32px",width:"100%",maxWidth:"600px",maxHeight:"92vh",overflowY:"auto"}}>
            <div style={{width:"36px",height:"4px",background:"#ddd",borderRadius:"2px",margin:"0 auto 20px",flexShrink:0}}/>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#4a8a5a",marginBottom:"6px"}}>Done</div>
            <div style={{fontSize:"20px",marginBottom:"4px"}}>{checkoffModal.slot.name}</div>
            <div style={{fontSize:"12px",color:"#999",marginBottom:"20px"}}>
              {checkoffModal.slot.time} · {friendlyDate(checkoffModal.dateKey)}
            </div>

            {checkoffModal.notRecurring ? (
              <div>
                <div style={{fontSize:"13px",color:"#888",marginBottom:"16px"}}>Not recurring. When's the next one?</div>
                <div style={{fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>Quick book</div>
                <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"20px"}}>
                  {[2,3,4,5,6].map(function(w){
                    const d = addWeeks(parseDateKey(checkoffModal.dateKey), w);
                    const dk = toDateKey(d);
                    const mo = d.getMonth();
                    const dateStr = [3,4,5,6].includes(mo) ? d.toLocaleDateString("en-US",{month:"long",day:"numeric"}) : d.toLocaleDateString("en-US",{month:"short",day:"numeric"});
                    return (
                      <button key={w} onClick={function(){
                        const slot = checkoffModal.slot;
                        jumpToDateForBooking(dk, slot);
                      }} style={{padding:"8px 14px",background:"#f4f4f2",border:"1px solid #d8d8d6",borderRadius:"8px",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",color:"#1a1a1a"}}>
                        {w}w · {dateStr}
                      </button>
                    );
                  })}
                </div>
                <div style={{fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#aaa",marginBottom:"10px"}}>Or pick a date</div>
                {renderCheckoffCalendar()}
              </div>
            ) : (
              <div>
                <div style={{fontSize:"12px",color:"#999",marginBottom:"16px"}}>Every {checkoffModal.slot.recurWeeks === 1 ? "week" : (checkoffModal.slot.recurWeeks+" weeks")} · {checkoffModal.slot.time} · {DAYS[dayOfWeek(checkoffModal.dateKey)]}s</div>

                <div style={{fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#999",marginBottom:"8px"}}>Next appointment</div>

                {effectiveNextDate && !nudgeConflict && (
                  <div style={{background:"#f0fff0",border:"1px solid #a0d0a0",borderRadius:"8px",padding:"10px 14px",marginBottom:"14px",fontSize:"13px",color:"#2a7a2a"}}>
                    ✓ {friendlyDateTime(checkoffModal.slot.time, effectiveNextDate)} is open
                  </div>
                )}
                {effectiveNextDate && nudgeConflict && (
                  <div style={{background:"#fff0ee",border:"1px solid #e0b0a8",borderRadius:"8px",padding:"10px 14px",marginBottom:"14px",fontSize:"13px",color:"#1a1a1a"}}>
                    ⚠ That slot is already taken on {friendlyDateTime(checkoffModal.slot.time, effectiveNextDate)}
                  </div>
                )}

                {nudgedDate && nudgedDate !== checkoffModal.nextDateKey && (
                  <div style={{fontSize:"11px",color:"#a07830",marginBottom:"10px"}}>
                    Nudged — schedule resumes every {checkoffModal.slot.recurWeeks === 1 ? "week" : (checkoffModal.slot.recurWeeks+" weeks")} after this
                  </div>
                )}

                <div style={{display:"flex",gap:"8px",marginBottom:"16px"}}>
                  <button onClick={function(){ confirmNextBooking(effectiveNextDate); }} style={{flex:1,padding:"11px",background:nudgeConflict?"#5a2a1a":"#c9a96e",border:"none",borderRadius:"8px",color:nudgeConflict?"#e8b84b":"#0f0f0f",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>
                    {nudgeConflict ? "Book anyway" : ("Book " + friendlyDateTime(checkoffModal.slot.time, effectiveNextDate))}
                  </button>
                  <button onClick={function(){ jumpToDate(effectiveNextDate); }} style={{padding:"11px 16px",background:"#efefed",border:"1px solid #d8d8d6",borderRadius:"8px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>
                    Jump
                  </button>
                </div>

                <div style={{fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#aaa",marginBottom:"10px"}}>Change date</div>
                {renderCheckoffCalendar()}
              </div>
            )}

            <button onClick={function(){ setCheckoffModal(null);setNudgedDate(null);setCheckoffCalMonth(null); }} style={{display:"block",width:"100%",padding:"10px",background:"none",border:"none",color:"#aaa",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",marginTop:"16px"}}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#f8f8f6",border:"1px solid #d8d8d6",borderRadius:"10px",padding:"28px 32px",maxWidth:"320px",width:"90%",textAlign:"center"}}>
            <div style={{fontSize:"11px",letterSpacing:"0.15em",textTransform:"uppercase",color:"#888",marginBottom:"12px"}}>Cancel Appointment</div>
            <div style={{fontSize:"16px",marginBottom:"6px"}}>
              {confirmDelete.slot.name ? <span style={{color:"#1a1a1a"}}>{confirmDelete.slot.name} at {confirmDelete.slot.time}</span> : <span>Empty slot at {confirmDelete.slot.time}</span>}
            </div>
            <div style={{fontSize:"12px",color:"#999",marginBottom:"24px"}}>This will be logged in your history.</div>
            <div style={{display:"flex",gap:"10px",justifyContent:"center"}}>
              <button onClick={function(){ setConfirmDelete(null); }} style={{padding:"9px 20px",background:"#e8e8e6",border:"1px solid #d8d8d6",color:"#888",borderRadius:"6px",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Keep</button>
              <button onClick={confirmRemoveSlot} style={{padding:"9px 20px",background:"#c0392b",border:"1px solid #c0392b",color:"#fff",borderRadius:"6px",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Cancel appointment</button>
            </div>
          </div>
        </div>
      )}

      {showHistory && (
        <div style={{position:"fixed",top:0,right:0,bottom:0,width:"min(340px,90vw)",zIndex:500,background:"#fafaf8",borderLeft:"1px solid #e4e4e2",overflowY:"auto",padding:"24px 20px",boxShadow:"-4px 0 20px rgba(0,0,0,0.08)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"20px"}}>
            <div style={{fontSize:"11px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#888"}}>Change History</div>
            <button onClick={function(){ setShowHistory(false); }} style={{background:"none",border:"none",color:"#999",fontSize:"18px",cursor:"pointer"}}>×</button>
          </div>
          {clientMemory.length>0 && (
            <div style={{marginBottom:"24px"}}>
              <div style={{fontSize:"10px",letterSpacing:"0.15em",textTransform:"uppercase",color:"#aaa",marginBottom:"10px"}}>Saved Clients</div>
              {clientMemory.map(function(c,i){ return (
                <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",marginBottom:"3px",background:"#f8f8f6",border:"1px solid #e8e8e6",borderRadius:"6px"}}>
                  <div>
                    <span style={{fontSize:"13px",color:"#1a1a1a"}}>{c.name}</span>
                    {c.price&&<span style={{fontSize:"11px",color:"#a07830",marginLeft:"8px"}}>{c.price}</span>}
                  </div>
                  <button onClick={function(){ setClientMemory(function(mem){ return mem.filter(function(_,j){ return j!==i; }); }); }}
                    style={{background:"none",border:"none",color:"#ccc",cursor:"pointer",fontSize:"14px",padding:"2px 6px",fontFamily:"inherit"}}
                    onMouseEnter={function(e){ e.currentTarget.style.color="#c0392b"; }}
                    onMouseLeave={function(e){ e.currentTarget.style.color="#ccc"; }}
                  >×</button>
                </div>
              ); })}
            </div>
          )}
          <div style={{fontSize:"10px",letterSpacing:"0.15em",textTransform:"uppercase",color:"#aaa",marginBottom:"10px"}}>Change Log</div>
          {history.length===0 && <div style={{color:"#bbb",fontSize:"13px",fontStyle:"italic"}}>No changes yet.</div>}
          {history.map(function(entry,i){ return (
            <div key={i} style={{padding:"10px 12px",marginBottom:"6px",borderRadius:"6px",background:(entry.type==="removed"||entry.type==="slot_removed")?"#fff0ee":"#fafaf8",border:((entry.type==="removed"||entry.type==="slot_removed")?"1px solid #e0b0a8":"1px solid #e4e4e2")}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"3px"}}>
                <span style={{fontSize:"10px",letterSpacing:"0.1em",textTransform:"uppercase",color:entry.type==="added"?"#4a8a5a":(entry.type==="removed"||entry.type==="slot_removed")?"#8a3a2a":entry.type==="recurring_set"?"#c9a96e":"#666"}}>
                  {entry.type==="added"?"Added":entry.type==="removed"?"Removed":entry.type==="slot_removed"?"Slot Deleted":entry.type==="slot_added"?"Slot Added":entry.type==="recurring_set"?("Set Recurring ("+entry.weeks+"w)"):entry.type==="blocked"?"Blocked":entry.type==="unblocked"?"Unblocked":"Edited"}
                </span>
                <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                  <span style={{fontSize:"10px",color:"#bbb"}}>{entry.timestamp}</span>
                  {["added","removed","edited","recurring_set","blocked"].includes(entry.type) && (
                    <button onClick={function(){ undoHistoryEntry(entry); }}
                      style={{background:"none",border:"1px solid #d8d8d6",borderRadius:"4px",color:"#888",cursor:"pointer",fontSize:"9px",padding:"2px 6px",fontFamily:"inherit",letterSpacing:"0.05em"}}
                      onMouseEnter={function(e){ e.currentTarget.style.borderColor="#1a1a1a";e.currentTarget.style.color="#1a1a1a"; }}
                      onMouseLeave={function(e){ e.currentTarget.style.borderColor="#d8d8d6";e.currentTarget.style.color="#888"; }}
                    >Undo</button>
                  )}
                </div>
              </div>
              <div style={{fontSize:"13px",color:"#888"}}>
                {entry.time} {entry.name&&<span style={{color:"#1a1a1a"}}>— {entry.name}</span>}
                {entry.prevName&&<span style={{color:"#aaa"}}> (was {entry.prevName})</span>}
                {entry.dateKey&&<span style={{color:"#ccc",fontSize:"11px"}}> · {friendlyDate(entry.dateKey)}</span>}
              </div>
            </div>
          ); })}
        </div>
      )}

      {/* HEADER */}
      <div style={{borderBottom:"1px solid #e8e8e6",padding:"18px 20px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,background:"#ffffff",zIndex:100}}>
        <div style={{display:"flex",gap:"2px",background:"#e8e8e6",padding:"3px",borderRadius:"6px"}}>
          {VIEWS.map(function(v){ return (
            <button key={v} onClick={function(){ setView(v); }} style={{padding:"5px 12px",fontSize:"10px",letterSpacing:"0.1em",textTransform:"uppercase",border:"none",borderRadius:"4px",cursor:"pointer",background:view===v?"#1a1a1a":"transparent",color:view===v?"#ffffff":"#999",fontFamily:"inherit",transition:"all 0.15s"}}>{v}</button>
          ); })}
        </div>
        {view==="Month" && (
          <div style={{fontSize:"14px",color:"#1a1a1a",letterSpacing:"0.01em"}}>
            {baseDate.toLocaleDateString("en-US",{month:"long",year:"numeric"})}
          </div>
        )}
        <div style={{display:"flex",gap:"4px",alignItems:"center"}}>
          {view!=="Month" && (
            <button onClick={function(){ setBaseDate(function(d){ return addDays(d,-7); }); }} style={{...navBtn,fontSize:"11px",letterSpacing:"-1px"}}>‹‹</button>
          )}
          <button onClick={function(){
            if(view==="Month"){const d=new Date(baseDate);d.setMonth(d.getMonth()-1);setBaseDate(d);}
            else setBaseDate(function(d){ return addDays(d,-1); });
          }} style={navBtn}>‹</button>
          <button onClick={function(){ setBaseDate(new Date()); }} style={{...navBtn,fontSize:"9px",letterSpacing:"0.1em",padding:"0 12px"}}>TODAY</button>
          <button onClick={function(){
            if(view==="Month"){const d=new Date(baseDate);d.setMonth(d.getMonth()+1);setBaseDate(d);}
            else setBaseDate(function(d){ return addDays(d,1); });
          }} style={navBtn}>›</button>
          {view!=="Month" && (
            <button onClick={function(){ setBaseDate(function(d){ return addDays(d,7); }); }} style={{...navBtn,fontSize:"11px",letterSpacing:"-1px"}}>››</button>
          )}
          <button onClick={function(){ setShowHistory(true); }} style={{...navBtn,background:"#f0f0ee",border:"1px solid #d8d8d6",color:"#666"}}>≡</button>
        </div>
      </div>

      {view==="Month" && (function(){
        const monthDays = getMonthDays();
        return (
          <div style={{padding:"0"}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",background:"#e8e8e6",gap:"1px",borderBottom:"1px solid #e8e8e6"}}>
              {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(function(d){ return (
                <div key={d} style={{padding:"8px 0",textAlign:"center",fontSize:"10px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#aaa",background:"#fafaf8"}}>{d}</div>
              ); })}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"1px",background:"#e8e8e6"}}>
              {monthDays.map(function(day,i){
                if (!day) return <div key={"empty-"+i} style={{background:"#f8f8f6",minHeight:"80px"}}/>;
                const dk = toDateKey(day);
                const slots = getSlots(dk);
                const booked = slots.filter(function(s){ return s.name; });
                const isT = isToday(day);
                return (
                  <div key={dk}
                    onClick={function(){ setBaseDate(day); setView("Day"); }}
                    onMouseDown={function(){ longPressTimer.current = setTimeout(function(){ setMonthLongPress({dateKey:dk, day}); }, 600); }}
                    onMouseUp={cancelLongPress}
                    onMouseLeave={function(e){ cancelLongPress(); e.currentTarget.style.background=isT?"#fffbf0":"#ffffff"; }}
                    onTouchStart={function(){ longPressTimer.current = setTimeout(function(){ setMonthLongPress({dateKey:dk, day}); }, 600); }}
                    onTouchEnd={cancelLongPress}
                    onTouchMove={cancelLongPress}
                    style={{background:isT?"#fffbf0":"#ffffff",minHeight:"80px",padding:"6px 8px",cursor:"pointer",borderTop:isT?"2px solid #a07830":"2px solid transparent",transition:"background 0.1s",userSelect:"none"}}
                    onMouseEnter={function(e){ e.currentTarget.style.background=isT?"#fff8e8":"#f4f4f2"; }}
                  >
                    <div style={{display:"flex",alignItems:"baseline",gap:"5px",marginBottom:"3px"}}>
                      <div style={{fontSize:"13px",color:isT?"#a07830":"#1a1a1a",fontWeight:isT?"bold":"normal"}}>{day.getDate()}</div>
                      {getHolidayForDate(dk)&&<div style={{fontSize:"8px",color:"#a07830",letterSpacing:"0.04em",textTransform:"uppercase",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{getHolidayForDate(dk)}</div>}
                    </div>
                    {booked.slice(0,3).map(function(s,j){ return (
                      <div key={j} style={{fontSize:"10px",color:s.recurWeeks?"#6a8aaa":"#666",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",marginBottom:"1px",letterSpacing:"0.02em"}}>
                        {s.recurWeeks?"↺ ":""}{s.name}
                      </div>
                    ); })}
                    {booked.length>3&&<div style={{fontSize:"9px",color:"#bbb"}}>+{booked.length-3} more</div>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {view!=="Month" && (
        <div style={{display:"grid",gridTemplateColumns:("repeat("+getDayCount()+",1fr)"),gap:"1px",background:"#d8d8d6"}}>
          {dates.map(function(date){
            const dateKey = toDateKey(date);
            const slots = getSlots(dateKey);
            return (
              <div key={dateKey} style={{background:"#ffffff",display:"flex",flexDirection:"column"}}>
                <div style={{padding:"12px 14px 10px",borderBottom:"1px solid #ebebea",display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
                  <div>
                    {(function(){
                      const sz = view==="Day"?"22px":"16px";
                      const mo = date.getMonth();
                      const monthStr = [3,4,5,6].includes(mo)
                        ? date.toLocaleDateString("en-US",{month:"long",day:"numeric"})
                        : date.toLocaleDateString("en-US",{month:"short",day:"numeric"});
                      const wdStr = isToday(date)?"Today":date.toLocaleDateString("en-US",{weekday:"short"});
                      return (
                        <div>
                          <div style={{fontSize:sz,color:isToday(date)?"#c9893a":"#b89a5a",lineHeight:1.25}}>{wdStr}</div>
                          <div style={{fontSize:sz,color:"#1a1a1a",lineHeight:1.25}}>{monthStr}</div>
                          {getHolidayForDate(dateKey)&&<div style={{fontSize:"9px",color:"#a07830",letterSpacing:"0.08em",textTransform:"uppercase",marginTop:"3px"}}>{getHolidayForDate(dateKey)}</div>}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                <div style={{flex:1,padding:"6px 0"}}>
                  {slots.map(function(slot,idx){
                    const isEditing = editingCell&&editingCell.dateKey===dateKey&&editingCell.idx===idx;
                    const filled = !!slot.name;
                    const wasRemoved = recentlyRemoved[(dateKey+"-"+idx)];
                    const isSwiped = swipedSlot===(dateKey+"-"+idx);
                    const rowKey = (dateKey+"-"+idx);
                    return (
                      <div key={rowKey} style={{position:"relative",overflow:"hidden",borderBottom:"1px solid #efefed"}}>
                        {filled && (
                          <div style={{position:"absolute",right:0,top:0,bottom:0,width:"160px",display:"flex",alignItems:"stretch",opacity:isSwiped?1:0,pointerEvents:isSwiped?"auto":"none",transition:"opacity 0.2s"}}>
                            <button onClick={function(){
                              setSwipedSlot(null);
                              if(slot.groupId){const gs=getSlots(dateKey).filter(function(s){ return s.groupId===slot.groupId&&s.name; });if(gs.length>1){setGroupConfirm({action:'reschedule',dateKey,idx,name:slot.name,groupId:slot.groupId});return;}}
                              setReassignMode({client:{name:slot.name,price:slot.price,recurWeeks:slot.recurWeeks},currentDateKey:dateKey,remainingConflicts:[]});
                              jumpToDate(dateKey);
                            }} style={{flex:1,background:"#2a6a9a",border:"none",color:"#fff",fontSize:"11px",letterSpacing:"0.08em",textTransform:"uppercase",cursor:"pointer",fontFamily:"inherit"}}>Move</button>
                            <button onClick={function(){ requestRemoveSlot(dateKey,idx); }} style={{flex:1,background:"#c0392b",border:"none",color:"#fff",fontSize:"11px",letterSpacing:"0.08em",textTransform:"uppercase",cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
                          </div>
                        )}
                        <div
                          style={{display:"flex",alignItems:"center",padding:"0 14px",height:"46px",background:slot.blocked?"#f4f4f2":wasRemoved?"#fff0ee":slot.done?"#f4faf4":isEditing?"#f0f0ee":filled?"#fcfcfa":"transparent",transition:"transform 0.2s, background 0.3s",transform:isSwiped?"translateX(-160px)":"translateX(0)",position:"relative",opacity:slot.blocked?0.6:1}}
                          onTouchStart={function(e){ handleTouchStart(e,dateKey,idx); }}
                          onTouchEnd={function(e){ handleTouchEnd(e,dateKey,idx); }}
                        >
                          {wasRemoved&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:"3px",background:"#c0392b"}}/>}
                          {slot.groupId&&!wasRemoved&&(function(){
                            const daySlots = getSlots(dateKey);
                            const gSlots = daySlots.map(function(s,i){ return {...s,i}; }).filter(function(s){ return s.groupId===slot.groupId&&s.name; });
                            const first = gSlots[0] && gSlots[0].i === idx;
                            const last = gSlots[gSlots.length-1] && gSlots[gSlots.length-1].i === idx;
                            const inGroup = gSlots.some(function(s){ return s.i===idx; });
                            if (!inGroup) return null;
                            return (
                              <div style={{position:"absolute",left:0,top:first?"50%":"0",bottom:last?"50%":"0",width:"3px",background:"#a07830",borderRadius:first?"3px 3px 0 0":last?"0 0 3px 3px":"0"}}/>
                            );
                          })()}
                          <button onClick={function(){ handleCheckoff(dateKey,idx); }} style={{width:"18px",height:"18px",borderRadius:"50%",border:(slot.done?"1.5px solid #2a7a2a":filled?"1.5px solid #aaaaaa":"1.5px solid #dddddd"),background:slot.done?"#2a7a2a":"transparent",cursor:filled?"pointer":"default",flexShrink:0,marginRight:"10px",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s"}}>
                            {slot.done&&<span style={{color:"#fff",fontSize:"10px",lineHeight:1}}>✓</span>}
                          </button>
                          <div style={{fontSize:"12px",color:filled?"#c9a96e":"#2e2e2e",width:"40px",flexShrink:0,fontVariantNumeric:"tabular-nums",letterSpacing:"0.02em"}}>
                            {slot.time}
                          </div>
                          {slot.recurWeeks&&!isEditing&&(
                            <div onClick={function(){ if(filled) openClientProfile(slot.name); }} style={{fontSize:"9px",color:slot.isException?"#a07830":"#6a8aaa",marginRight:"6px",flexShrink:0,letterSpacing:"0.05em",cursor:filled?"pointer":"default"}}>
                              {"↺"+(slot.recurWeeks===1?"w":(slot.recurWeeks+"w"))+(slot.isException?"*":"")}
                            </div>
                          )}
                          {slot.blocked ? (
                            <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                              <span style={{fontSize:"12px",color:"#aaa",fontStyle:"italic",letterSpacing:"0.05em"}}>{slot.blockLabel||"Blocked"}</span>
                              <span style={{fontSize:"9px",color:"#ccc",letterSpacing:"0.1em",textTransform:"uppercase"}}>swipe to unblock</span>
                            </div>
                          ) : reassignMode&&!filled&&reassignMode.currentDateKey===dateKey ? (
                            <div onClick={function(){ handleReassignSlotTap(dateKey,idx); }} style={{flex:1,fontSize:"13px",color:"#2a7a2a",cursor:"pointer",padding:"0 2px"}}>
                              tap to place
                            </div>
                          ) : (
                            <div style={{flex:1,display:"flex",alignItems:"center",gap:"4px"}}>
                              {isEditing && slot.name && capitalizeFirst(editValues.name.trim())!==slot.name && editValues.name && (
                                <div style={{position:"absolute",top:"2px",left:"70px",fontSize:"9px",color:"#c0392b"}}>Replacing {slot.name}</div>
                              )}
                              <input
                                value={isEditing ? editValues.name : (wasRemoved?"":slot.name)}
                                readOnly={!isEditing}
                                onFocus={function(){ if(!isEditing) startEdit(dateKey,idx); }}
                                onChange={function(e){ if(isEditing) setEditValues(function(v){ return {...v,name:e.target.value}; }); }}
                                onKeyDown={function(e){ if(isEditing) handleKeyDown(e,dateKey,idx); }}
                                onBlur={function(e){ if(isEditing) handleBlur(e); }}
                                onMouseDown={function(){ if(filled&&!isEditing) startLongPress(slot.name); }}
                                onMouseUp={cancelLongPress}
                                onTouchStart={function(){ if(filled&&!isEditing) startLongPress(slot.name); }}
                                onTouchEnd={cancelLongPress}
                                onTouchMove={cancelLongPress}
                                placeholder=""
                                data-rowkey={rowKey}
                                style={{flex:1,fontSize:"13px",color:wasRemoved?"#c0392b":slot.done?"#2a6a2a":filled?"#1a1a1a":"#999",textDecoration:slot.done?"line-through":"none",background:"transparent",border:"none",outline:"none",padding:"0 2px",fontFamily:"Georgia,serif",cursor:isEditing?"text":"pointer",caretColor:isEditing?"#444":"transparent",WebkitUserSelect:isEditing?"text":"none"}}
                              />
                              {!isEditing && (
                                <div style={{display:"flex",alignItems:"center",gap:"6px",flexShrink:0}}>
                                  {filled&&slot.price&&<span style={{fontSize:"12px",color:slot.done?"#3a5a3a":"#a07830"}}>{slot.price}</span>}
                                  {filled&&(
                                    <button onClick={function(e){
                                      e.stopPropagation();
                                      if(slot.groupId){const allSlots=getSlots(dateKey);const gSlots=allSlots.map(function(s,i){ return {...s,i}; }).filter(function(s){ return s.groupId===slot.groupId&&s.name; });if(gSlots.length>1){setGroupRecurModal({dateKey,idx,slot,groupSlots:gSlots,weeks:null});return;}}
                                      setRecurringModal({dateKey,idx,slot});
                                    }} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 4px",color:slot.recurWeeks?"#4a8a9a":"#ccc",fontSize:"13px",lineHeight:1}}>↺</button>
                                  )}
                                </div>
                              )}
                              {isEditing && (
                                <input value={editValues.price} onChange={function(e){ setEditValues(function(v){ return {...v,price:e.target.value}; }); }} onKeyDown={function(e){ handleKeyDown(e,dateKey,idx); }} onBlur={handleBlur} data-rowkey={rowKey} placeholder="$" style={{width:"52px",fontSize:"13px",color:"#1a1a1a",background:"#f0f0ee",border:"1px solid #d8d8d6",borderRadius:"4px",outline:"none",padding:"2px 5px",fontFamily:"Georgia,serif"}} />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {addSlotDay===dateKey ? (
                    <div style={{display:"flex",gap:"6px",padding:"10px 14px",alignItems:"center"}}>
                      <input autoFocus value={newSlotTime} onChange={function(e){ setNewSlotTime(e.target.value); }}
                        onKeyDown={function(e){ if(e.key==="Enter") addCustomSlot(dateKey); if(e.key==="Escape") setAddSlotDay(null); }}
                        placeholder="9:47" style={{...inputStyle,width:"72px"}}/>
                      <button onClick={function(){ addCustomSlot(dateKey); }} style={actionBtn("#c9a96e","#0f0f0f")}>Add</button>
                      <button onClick={function(){ setAddSlotDay(null); }} style={actionBtn("#1a1a1a","#555")}>Cancel</button>
                    </div>
                  ) : (
                    <button onClick={function(){ setAddSlotDay(dateKey); }} style={{display:"block",width:"100%",padding:"11px 14px",background:"none",border:"none",color:"#ddd",fontSize:"10px",letterSpacing:"0.15em",textTransform:"uppercase",cursor:"pointer",textAlign:"left",fontFamily:"inherit"}}
                      onMouseEnter={function(e){ e.target.style.color="#444"; }} onMouseLeave={function(e){ e.target.style.color="#222"; }}>
                      + Add slot
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const navBtn = {background:"#e8e8e6",border:"1px solid #d8d8d6",color:"#777",padding:"0 10px",height:"32px",lineHeight:"32px",borderRadius:"4px",cursor:"pointer",fontSize:"15px",fontFamily:"inherit",display:"inline-flex",alignItems:"center",justifyContent:"center"};
const inputStyle = {background:"#efefed",border:"1px solid #d8d8d6",color:"#1a1a1a",padding:"5px 7px",borderRadius:"4px",fontSize:"13px",fontFamily:"Georgia,serif",flex:1,outline:"none"};
const actionBtn = (bg,color) => ({background:bg,border:"none",color,padding:"5px 10px",borderRadius:"4px",cursor:"pointer",fontSize:"11px",fontFamily:"inherit",flexShrink:0});
