 import { useState, useRef, useCallback, useEffect } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut } from "firebase/auth";
import { getFirestore, doc, onSnapshot, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

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
  "1:13","1:36","1:58","2:21","2:43","3:06"
];

// #15: 3:06 is BACK as a permanent default slot (Granger's decision) and ends the
// default day. Only 3:28 / 3:51 remain retired from the auto-populated grid so the
// rows keep their height (no scrolling). 3:28 / 3:51 stay in ALL_TIMES, so the user
// can still hand-add one as a custom +PM slot. Existing saved days that still carry
// 3:28 / 3:51 as EMPTY default placeholders are trimmed on load (named, blocked,
// custom, marked, or noted slots at these times are always preserved — we never
// silently delete a booked appointment). 3:06 is intentionally NOT in this list:
// every saved day is guaranteed a 3:06 by ensure306() in migrateSchedules.
const REMOVED_TAIL_TIMES = ["3:28","3:51"];
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

// When a person leaves a slot they were SHARING (two array entries at the same
// time, drawn as one paired row), the freed entry must be REMOVED from the day,
// not just blanked — a blanked duplicate renders as a phantom empty row stacked
// at the shared time (the "extra slot" bug). So: if the slot at idx still shares
// its time with another entry, splice it out and the slot collapses back to the
// one remaining person; otherwise blank it in place (keeps the lone default-time
// slot present). Pure — never mutates the input array. Callers apply this LAST on
// the array they hand to setSlots, AFTER any index-based writes, so the splice
// can't shift a still-needed index. Behaviorally identical to a plain blank
// whenever the time is NOT shared, which is the normal, overwhelmingly common case.
function vacateSlotCollapsing(arr, idx) {
  if (!arr || !arr[idx]) return arr;
  var t = arr[idx].time;
  var shares = false; var i;
  for (i = 0; i < arr.length; i++) { if (i !== idx && arr[i] && arr[i].time === t) { shares = true; break; } }
  if (shares) { return arr.slice(0, idx).concat(arr.slice(idx + 1)); }
  var out = arr.slice();
  // v95 THE STALE-ANCHOR FACTORY, closed at its source. Blanking IN PLACE kept BOTH the
  // nudged label and the hidden anchor, so an emptied 7:26 row went on displaying 7:26
  // forever while secretly still being the day's 7:36 grid row. That is where every
  // orphan "extra empty slot" in the book was born, and where the anchor collisions that
  // wreck a series move come from. An empty row has no reason to wear a nudge: the nudge
  // belonged to the PERSON, and the person is gone. So put the row back on the grid —
  // restore its real time and strip the anchor — unless that grid slot is already taken,
  // in which case this row is a duplicate and is spliced out instead.
  var vBase = out[idx].defaultBaseTime;
  if (vBase && vBase !== t && DEFAULT_TIMES.indexOf(vBase) >= 0) {
    var vTaken = false; var k;
    for (k = 0; k < out.length; k++) {
      if (k !== idx && out[k] && ((out[k].defaultBaseTime || out[k].time) === vBase || out[k].time === vBase)) { vTaken = true; break; }
    }
    if (vTaken) { return arr.slice(0, idx).concat(arr.slice(idx + 1)); }
    var vSnap = {...out[idx], time:vBase, name:"", price:"", done:false, recurWeeks:null, isException:false, groupId:null, pending:false, availStatus:null, isCustom:false, customTime:false};
    delete vSnap.defaultBaseTime;
    // v97: the row is going back on the grid, so the "he meant this nudge" flag goes with
    // it. Leaving it behind would permanently exempt an ordinary emptied row from the
    // sweeper — a ghost with a hall pass. Revert lever — delete this one line.
    delete vSnap.nudgeKept;
    out[idx] = vSnap;
    return out;
  }
  // Revert lever — the pre-v95 blank-in-place, which is still exactly what happens to a
  // clean grid row or a genuine hand-made custom row (neither carries a stale anchor):
  // out[idx] = {...out[idx], name:"", price:"", done:false, recurWeeks:null, isException:false, groupId:null, pending:false, availStatus:null};
  out[idx] = {...out[idx], name:"", price:"", done:false, recurWeeks:null, isException:false, groupId:null, pending:false, availStatus:null};
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
// Signature blue used to mark "today" (replaced the old today-gold, which read too
// close to the regular booked-gold). Single tuning knob for the today highlight.
const TODAY_BLUE = "#3a6ea5";

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

// v95. AN ANCHOR MUST NEVER LIE. The anchor exists to say "underneath this nudged label
// I am really the day's 7:36 row." It is meaningless — worse, actively dangerous — on a
// row whose label IS a real grid time already: such a row simply IS that grid row, and a
// leftover anchor pointing somewhere else makes it a second, invisible claimant on a slot
// it does not own. That is what left Bobby's 7:36 painted as an edited time and what made
// the series engine hunt down the wrong row. Strip the anchor when (a) it merely repeats
// the row's own time, or (b) the row's time is a default grid time that no OTHER row on
// the day already claims. Otherwise leave it completely alone — a genuine nudge (7:48
// standing in for 7:58) keeps its anchor, as it must. Pure; never mutates the input.
function unlieAnchor(slots, i) {
  var s = slots && slots[i];
  if (!s || !s.defaultBaseTime) return s;
  var out;
  if (s.defaultBaseTime === s.time) { out = {...s}; delete out.defaultBaseTime; out.customTime = false; return out; }
  if (DEFAULT_TIMES.indexOf(s.time) < 0) return s;
  var j;
  for (j = 0; j < slots.length; j++) {
    if (j !== i && slots[j] && (slots[j].defaultBaseTime || slots[j].time) === s.time) return s;
  }
  out = {...s}; delete out.defaultBaseTime; out.isCustom = false; out.customTime = false;
  return out;
}

// v96. AN EMPTY ROW MUST NEVER WEAR SOMEBODY ELSE'S NUDGE.
// A nudge belongs to a PERSON — "book him ten minutes early, at 7:26, in the 7:36 slot."
// When that person is cancelled the slot goes back to being the day's plain 7:36 opening,
// but older builds blanked the row in place, so it sat there empty and still LABELLED
// 7:26. On screen that is indistinguishable from a real open 7:26 slot (grey 7:26 vs grey
// 7:36 is one digit), and dropping a recurring client onto it hands the WHOLE SERIES the
// label "7:26" — which is precisely how Bobby ended up at 7:26 on every future Saturday,
// standing beside Kelly's 7:36 instead of sharing it.
//
// v95's vacateSlotCollapsing stopped these rows being BORN. This sweeps up the ones
// already written into the book (11 of them on 2026-07-12), and it runs inside
// migrateSchedules, so it heals on load, on every cloud snapshot, and on import — no
// separate repair file to remember.
//
// The rules are deliberately narrow. It only ever touches a row that is EMPTY, unblocked,
// unmarked, and carries an anchor:
//   - anchor === its own label  -> the anchor is pure noise; drop it, label untouched.
//   - anchor points elsewhere   -> the label is the stale nudge. Snap the row back to its
//                                 anchor (7:26 -> 7:36) and drop the anchor. If some OTHER
//                                 row on the day already claims that anchor, this row is a
//                                 duplicate of it and is spliced out instead.
// A NAMED row, a lunch/blocked row, an Available/Overtime-marked row, and a genuine
// hand-made custom row (no anchor at all) are all left exactly as they are. Pure — builds
// a new array and never mutates the input.
//
// v97 THE SWEEPER CANNOT READ MINDS, SO WE TELL IT. The rule above — "empty row + anchor
// means stale nudge" — was true of every row the OLD builds left behind, but it is NOT
// true of a nudge Granger makes ON PURPOSE. Move an empty 10:58 opening to 10:48 and the
// row is empty and carries an anchor, which is bit-for-bit what a ghost looks like. So the
// sweeper snapped it straight back to 10:58 on the very next cloud snapshot: the edit
// showed for a second and then undid itself, every single time. A deliberate retime now
// stamps the row nudgeKept:true (see retimeSlot) and the sweeper skips any row wearing it.
// Ghosts, written by builds that never knew about the flag, carry no flag and are still
// swept exactly as before. Revert lever — drop "|| s.nudgeKept" from the guard below to go
// back to sweeping every empty anchored row, deliberate or not.
// Revert lever — un-comment to make this a no-op and ship the old behavior:
// function deNudgeEmptyRows(arr) { return arr; }
function deNudgeEmptyRows(arr) {
  if (!arr || !arr.length) return arr;
  var out = []; var changed = false; var i, j, s, anchor, taken;
  for (i = 0; i < arr.length; i++) {
    s = arr[i];
    // v97 revert lever — the pre-v97 guard, with no respect for a deliberate nudge:
    // if (!s || !s.defaultBaseTime || (s.name && String(s.name).trim()) || s.blocked || s.availStatus) { out.push(s); continue; }
    if (!s || !s.defaultBaseTime || s.nudgeKept || (s.name && String(s.name).trim()) || s.blocked || s.availStatus) { out.push(s); continue; }
    anchor = s.defaultBaseTime;
    if (anchor === s.time) {
      var same = {...s}; delete same.defaultBaseTime; same.customTime = false;
      out.push(same); changed = true; continue;
    }
    taken = false;
    for (j = 0; j < arr.length; j++) {
      if (j !== i && arr[j] && ((arr[j].defaultBaseTime || arr[j].time) === anchor || arr[j].time === anchor)) { taken = true; break; }
    }
    if (taken) { changed = true; continue; }
    var snapped = {...s, time:anchor, isCustom:false, customTime:false};
    delete snapped.defaultBaseTime;
    out.push(snapped); changed = true;
  }
  if (!changed) return arr;
  out.sort(function(a,b){ return timeToAbsMinutes(a.time) - timeToAbsMinutes(b.time); });
  return out;
}

var _gid = 1;
function newGroupId() { return "g"+(_gid++); }

// v92 GROUP TIME CASCADE. Given a day's slots and the index being time-edited, return
// the indexes of the OTHER members of that slot's group — but ONLY when the edited slot
// is the group's FIRST (earliest) member. Move the first member and the whole group
// shifts with it by the same number of minutes; move the 2nd/3rd member and only that
// person moves. A slot with no groupId, or a group of one, returns [] (no cascade).
// Membership matches getGroupTimes: same groupId, and actually occupied (name) or a
// blocked/lunch member of the run. Pure — no state, no writes.
function groupCascadeIdxs(slots, idx) {
  if (!slots || !slots[idx]) return [];
  var g = slots[idx].groupId;
  if (!g) return [];
  var mem = [];
  for (var i = 0; i < slots.length; i++) {
    var s = slots[i];
    if (s && s.groupId === g && (s.name || s.blocked)) mem.push(i);
  }
  if (mem.length < 2) return [];
  mem.sort(function(a, b){ return timeToAbsMinutes(slots[a].time) - timeToAbsMinutes(slots[b].time); });
  if (mem[0] !== idx) return [];          // not the first member -> this person only
  return mem.slice(1);
}

// v92: the exact per-slot retime write commitTimeEdit has always done, lifted out
// verbatim so the cascade can apply the identical treatment to every group member
// (custom-slot detection, defaultBaseTime stamping, cobalt/purple shift coloring).
// extra lets the recurring "just this one" path stamp isException:true as it used to.
function retimeSlot(s, newTime, extra) {
  var isStillDefault = DEFAULT_TIMES.indexOf(newTime) >= 0;
  var wasCustom = s.isCustom === true || (s.isCustom === undefined && DEFAULT_TIMES.indexOf(s.time) === -1);
  var baseTime = s.defaultBaseTime || (!wasCustom ? s.time : null);
  var out = {...s, time:newTime, isCustom:wasCustom, customTime:(wasCustom && !isStillDefault), defaultBaseTime:(!wasCustom ? baseTime : s.defaultBaseTime)};
  // v95: nudge a 7:36 row to 7:26 and then edit it back to 7:36 and the anchor is now just
  // noise — it says "really 7:36" about a row that literally says 7:36. Harmless to look at
  // but it is one more row carrying an anchor it does not need, and every one of those is a
  // future collision. Drop it, and the row is a plain clean grid row again.
  // Revert lever — pre-v95 kept the redundant anchor forever:
  // if (extra) { out = {...out, ...extra}; } return out;
  if (out.defaultBaseTime && out.defaultBaseTime === newTime) { delete out.defaultBaseTime; out.customTime = false; }
  if (extra) { out = {...out, ...extra}; }
  // v97 A DELIBERATE NUDGE SIGNS ITS NAME. Judged on the FINAL row (after extra), because
  // extra is how the series engine drops a PERSON onto a row in the same breath as retiming
  // it. An empty row that still carries an anchor when the dust settles is an opening the
  // barber moved on purpose (10:58 -> 10:48), so flag it and deNudgeEmptyRows will leave it
  // alone. Anything else — a named row, or a row that landed back on a clean grid time and
  // shed its anchor above — must NOT carry the flag, so it is stripped. Keeping this in one
  // place means the flag is correct for the single edit, for every member of a group
  // cascade, and for every series retime, since all three go through retimeSlot.
  // Revert lever — delete this block and empty-row nudges go back to being swept away.
  if (out.defaultBaseTime && !(out.name && String(out.name).trim()) && !out.blocked) { out.nudgeKept = true; }
  else if (out.nudgeKept) { delete out.nudgeKept; }
  return out;
}
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
// Typing "a" / "available" marks an OPEN slot AVAILABLE; "o" / "overtime" marks it
// OVERTIME. Mirrors the single-letter "l" (lunch) / "b" (block) shortcuts. These
// only ever apply to a truly open slot (see doCommit) — they never overwrite a
// booked or blocked slot.
function isAvailName(str) { var v = str ? str.trim().toLowerCase() : ""; return v==="a" || v==="available"; }
function isOvertimeName(str) { var v = str ? str.trim().toLowerCase() : ""; return v==="o" || v==="overtime"; }
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

// v93: how far a drop moved somebody, in plain words. "" for a same-day drop, which is
// the signal everywhere that this is a pure retime and the old v92 behavior applies.
function dayShiftDelta(fromDateKey, toDateKey) {
  if (!fromDateKey || !toDateKey) return 0;
  return Math.round((parseDateKey(toDateKey).getTime() - parseDateKey(fromDateKey).getTime()) / 86400000);
}
function dayShiftPhrase(fromDateKey, toDateKey) {
  var d = dayShiftDelta(fromDateKey, toDateKey);
  if (d === 0) return "";
  var n = Math.abs(d);
  return n + (n === 1 ? " day " : " days ") + (d > 0 ? "later" : "earlier");
}
// The line under "Move this appointment…". A same-day drop keeps the exact v92 wording;
// a cross-day drop says out loud that "All" slides the whole ladder, which it now does.
function seriesDropBlurb(m) {
  var who = (m && m.name) || "This client";
  var ph = dayShiftPhrase(m.dateKey, m.targetDateKey);
  if (!ph) return who + " moves to " + m.newTime + ". \u201cAll\u201d shifts the whole series to this time (each stays on its own day).";
  return who + " moves to " + friendlyDate(m.targetDateKey) + " at " + m.newTime + ". \u201cAll\u201d slides every future visit " + ph + " as well \u2014 the gap between visits stays the same.";
}
// Turn a real Date (e.g. a backup's exportedAt) into "Today at 5:40 AM",
// "Yesterday at 5:40 AM", or "Mon, Jun 29 at 5:40 AM". Used by the import confirm.
function friendlyWhen(date) {
  if (!date || isNaN(date.getTime())) return "";
  var t = date.toLocaleTimeString("en-US", {hour:"numeric", minute:"2-digit"});
  var thatKey = toDateKey(date);
  var now = new Date();
  var todayKey = toDateKey(now);
  var y = new Date(now.getFullYear(), now.getMonth(), now.getDate()-1);
  var yestKey = toDateKey(y);
  var dayLabel = thatKey===todayKey ? "Today" : (thatKey===yestKey ? "Yesterday" : friendlyDate(thatKey));
  return dayLabel + " at " + t;
}
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

// #15: 3:06 PM is now a permanent default slot, and Granger wants it on EVERY saved
// day — past, completed, and future. Guarantee exactly one 3:06 per day without
// disturbing anything else. Idempotent: if the day already carries a 3:06 (default,
// hand-added custom, or a booked appointment), it is left completely alone — no
// duplicate. Otherwise an EMPTY / not-done / not-recurring 3:06 is inserted in
// chronological order (timeToAbsMinutes puts 3:06 after 2:43 and before any 3:28).
// A truly empty day ([]) is left empty, matching extendDefaultTail/topUpAfternoonTail.
function ensure306(slots) {
  if (!slots || !slots.length) return slots;
  for (var i = 0; i < slots.length; i++) {
    if (slots[i].time === "3:06") return slots;
  }
  var out = slots.slice();
  out.push({time:"3:06",name:"",price:"",done:false,recurWeeks:null,isCustom:false});
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
    // #15: applied to BOTH branches so the reset day and the topped-up day both
    // end up with 3:06; the idempotent guard means it is never added twice.
    result[dk] = ensure306(result[dk]);
    // v96: last, sweep off any stale nudge left on an EMPTY row (see deNudgeEmptyRows).
    // Idempotent — a clean day comes back byte-for-byte identical, so this cannot loop or
    // cause a needless cloud write. Revert lever — un-comment to skip the sweep entirely:
    // /* v96 sweep off */
    result[dk] = deNudgeEmptyRows(result[dk]);
  }
  return result;
}

// One family per banner/flash type so the banner color and the row flash color
// can never drift apart. added -> green, canceled -> red, edited/moved -> gold.
function bannerFamily(type) {
  if (type==="added"||type==="slot_added"||type==="unblocked"||type==="checkoff") return "green";
  if (type==="removed"||type==="slot_removed"||type==="blocked") return "red";
  if (type==="rescheduled"||type==="edited"||type==="recurring_set"||type==="penciled") return "gold";
  return "neutral";
}
function getBannerColor(type) {
  var f = bannerFamily(type);
  if (f==="green") return "#2a7a2a";
  if (f==="red") return "#c0392b";
  if (f==="gold") return "#a07830";
  return "#555";
}
// Flash (row pulse) styling per family. tint = the light resting background that
// sits under the dark row text; anim = the keyframe that pulses strong<->tint;
// bar = the left accent stripe. Same family as the banner, so colors always agree.
function flashTintFor(fam) {
  if (fam==="green") return "#e0f4e0";
  if (fam==="red") return "#f6dbd6";
  if (fam==="gold") return "#f1e6c6";
  return "#ececec";
}
function flashAnimFor(fam) {
  if (fam==="green") return "tlFlashG";
  if (fam==="red") return "tlFlashR";
  if (fam==="gold") return "tlFlashD";
  return "tlFlashN";
}
function flashBarFor(fam) {
  if (fam==="green") return "#2a7a2a";
  if (fam==="red") return "#c0392b";
  if (fam==="gold") return "#a07830";
  return "#888";
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

// v82 change-log wording (SPEC LOCKED, display-only): maps a stored history entry to
// the corrected category word (for the colored chip) and the main-line action phrase.
// Reads ONLY the stored action type/flags already on the entry — no write-path or
// engine involvement. See Kickoff "Change-log wording accuracy" for the full table.
function logEntryWords(entry) {
  var t = entry ? entry.type : "";
  var nm = (entry && entry.name) ? entry.name : "";
  var prev = (entry && entry.prevName) ? entry.prevName : "";
  var isPencil = !!(entry && entry.bannerType === "penciled");
  var isLunch = (t === "blocked") && (nm === "Lunch");
  // A profile-level rename carries no slot: type "edited" with no dateKey and no time.
  var isProfileRename = (t === "edited") && !(entry && entry.dateKey) && !(entry && entry.time);
  // A slot name-edit that actually changed the name reads as "replaced <old>". The app
  // can't tell a typo-fix from a genuine swap, so every real slot name-edit says "replaced."
  var isSlotSwap = (t === "edited") && !!(entry && entry.dateKey) && !!prev && prev !== nm;
  var chip, action;
  if (t === "added") { chip = isPencil ? "penciled in" : "locked in"; action = chip; }
  else if (t === "removed") { chip = "canceled"; action = chip; }
  else if (t === "rescheduled") { chip = "rescheduled"; action = chip; }
  else if (t === "checkoff") { chip = "checked off"; action = chip; }
  else if (t === "blocked") { chip = isLunch ? "lunch" : "blocked"; action = chip; }
  else if (t === "unblocked") { chip = "unblocked"; action = chip; }
  else if (t === "recurring_set") { chip = "set recurring" + ((entry && entry.weeks) ? (" (" + entry.weeks + "w)") : ""); action = chip; }
  else if (t === "slot_added") { chip = "slot added"; action = chip; }
  else if (t === "slot_removed") { chip = "slot removed"; action = chip; }
  else if (isProfileRename) { chip = "renamed"; action = "renamed"; }
  else if (isSlotSwap) { chip = "replaced"; action = "replaced " + prev; }
  else if (t === "edited") { chip = "edited"; action = "edited"; }
  else if (t === "backup") { chip = "backup"; action = "backup"; }
  else { chip = "changed"; action = "changed"; }
  return {chip: chip, action: action, isProfileRename: isProfileRename};
}

const VIEWS = ["Day","3-Day","Wknd","Week","Month"];

// When the iPad is in Split View and our app is at least this wide (CSS px), the
// change banner rides inline in the header gap (covers the ~3/4 layout). Below it,
// the header is too cramped so the banner falls back to floating. Tune this one
// number if it flips inline at the wrong split size on the actual iPad.
var SPLIT_INLINE_MIN_W = 900;
// Default "Share openings" intro drafts. {{OT_AMT}} is replaced with the live OT
// surcharge number at copy time, independent of which draft is active. "full" is
// word-for-word the original always-on intro; "short" skips the OT explainer for
// people who already know the deal.
// #9: a day with zero bookings pre-offers these three (whichever are actually open).
// The instant any slot on that day gets filled, the regular one-either-side rule takes
// over (that path is keyed on hasBookings in computeShareDays).
var ZERO_DAY_DEFAULTS = ["9:06","9:28","9:51"];

const DEFAULT_SHARE_DRAFTS = [
  {id:"full", name:"Full", text:"Hello! All my current openings are listed below.\n\n\"OT (Overtime)\" indicates appointments outside of my regular schedule. (I offer to come in early or stay late to accommodate, for an additional ${{OT_AMT}})\n\n(All the unmarked times are during regular hours, and are therefore regular price)", footer:""},
  {id:"short", name:"Short", text:"Hello! Here are my current openings:", footer:""}
];

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
function SearchIcon(props) {
  var size = props.size || 15; var color = props.color || "#888";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block"}}>
      <circle cx="11" cy="11" r="7"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
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
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" style={{display:"block"}}>
      <path d="M12 4 C6.48 4 2 7.58 2 12 C2 14.05 2.94 15.9 4.5 17.3 C4.32 18.95 3.62 20.42 2.5 21.5 C4.56 21.4 6.42 20.74 7.96 19.64 C9.2 20.08 10.56 20.3 12 20.3 C17.52 20.3 22 16.42 22 12 C22 7.58 17.52 4 12 4 Z"/>
    </svg>
  );
}

// Two overlapping squares — the universal copy/paste glyph.
function CopyIcon(props) {
  var size = props.size || 18; var color = props.color || "#888";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" style={{display:"block"}}>
      <rect x="9" y="9" width="12" height="12" rx="2"/>
      <path d="M5 15 L4 15 C2.9 15 2 14.1 2 13 L2 4 C2 2.9 2.9 2 4 2 L13 2 C14.1 2 15 2.9 15 4 L15 5"/>
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
  const [splitBannerRoom, setSplitBannerRoom] = useState(false);
  const [isPhone, setIsPhone] = useState(function() { try { return typeof window!=="undefined" && window.innerWidth<=430; } catch(e) { return false; } });
  const [baseDate, setBaseDate] = useState(new Date());
  const [schedules, setSchedules] = useState(function() {
    var raw = loadFromStorage("tl_schedules", {});
    return migrateSchedules(raw);
  });
  const [editingCell, setEditingCell] = useState(null);
  const [editValues, setEditValues] = useState({name:"", price:""});
  // #4 type-ahead: which saved-client suggestion is highlighted (-1 = none), and a
  // flag to keep the dropdown closed after a pick/Escape until the next keystroke.
  const [suggestIdx, setSuggestIdx] = useState(-1);
  const [suggestHide, setSuggestHide] = useState(false);
  const [history, setHistory] = useState(function() { return loadFromStorage("tl_history", []); });
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [recentlyRemoved, setRecentlyRemoved] = useState({});
  // B1: green twin of recentlyRemoved. A just-LANDED spot (a move's destination)
  // glows green for 8s, mirroring the way a just-VACATED spot glows red. Keyed the
  // same way (dateKey-idx). Purely visual; no payload, no move logic.
  const [recentlyPlaced, setRecentlyPlaced] = useState({});
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
  const [renamingProfile, setRenamingProfile] = useState(false);
  const [renameValue, setRenameValue] = useState("");
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
  const [noteKind, setNoteKind] = useState(null); // null | "personal" | "business" — colors the note (blue / gold)
  const [noteRepeat, setNoteRepeat] = useState(0); // v63: 0 once | 1 weekly | 2/3/4 every N weeks (selected interval in the day-note modal)
  const [noteWasRepeat, setNoteWasRepeat] = useState(false); // v63: true if the opened day-note is governed by a repeat rule
  const [noteScopeAsk, setNoteScopeAsk] = useState(null); // v63: null | "save" | "clear" — pending action awaiting "this day / all repeats"
  const [wlInput, setWlInput] = useState(""); // v83: day-note standby list — text of the pending (not-yet-added) new entry
  // v89: standby search now behaves exactly like the all-contacts search — arrow keys walk
  // the suggestion list and each row shows the client's price. wlIdx = highlighted row
  // (-1 = none, so Enter falls through to adding the free-typed text, same as before).
  const [wlIdx, setWlIdx] = useState(-1);
  // v88 per-line day notes. Each day-note line is edited as its own structured row with
  // its own repeat setting (once | every N weeks | every N months). noteLines is the
  // working set of rows in the open day-note modal; noteOrigLines is the snapshot taken
  // at open (used to detect which recurring rules a Save removed); noteRepeatPopup holds
  // the row id whose repeat mini-popup is open (or null).
  const [noteLines, setNoteLines] = useState([]);
  const [noteOrigLines, setNoteOrigLines] = useState([]);
  const [noteRepeatPopup, setNoteRepeatPopup] = useState(null);
  const [dayNotes, setDayNotes] = useState(function() { return loadFromStorage("tl_daynotes", {}); });
  // #13 accounting: per-day takings keyed by dateKey -> {cash,venmo,applepay,square,services,hours}.
  // Rides the same Firebase sync as the other data fields (added as the LAST key in the
  // seed / snapshot / push objects so the echo-guard JSON strings still line up).
  const [accounting, setAccounting] = useState(function() { return loadFromStorage("tl_accounting", {}); });
  const [acctModal, setAcctModal] = useState(null);
  const [acctAdd, setAcctAdd] = useState({});
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
  // v70: a live drag is "armed" the moment a hold is picked up, but stays visually
  // silent (no chip, no lock sound, no drop hints) until the finger actually moves.
  // dragLifted flips true on first real movement (or immediately for multi/group).
  const [dragLifted, setDragLifted] = useState(false);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [timeEditModal, setTimeEditModal] = useState(null);
  const [timeEditMinutes, setTimeEditMinutes] = useState(0);
  const [dailyExportPrompt, setDailyExportPrompt] = useState(false);
  // Second step of the morning prompt: after the backup exports, offer the readable
  // schedule download as its own tap (iPad Safari only allows one download per tap).
  const [dailyDownloadPrompt, setDailyDownloadPrompt] = useState(false);
  // ── Share openings ───────────────────────────────────────────────────────────
  // The "Share openings" sheet: gather open times across the coming week, pre-check
  // the ones worth offering (gaps between bookings + the single slot just before the
  // first booking and just after the last), let Granger trim/add, toggle overtime,
  // pad the times, then copy a customer-ready message to the clipboard.
  const [shareModal, setShareModal] = useState(false);
  // Which "dateKey|time" rows are checked (offered) and which are flagged OT.
  const [shareChecked, setShareChecked] = useState({});
  const [shareOT, setShareOT] = useState({});
  // The overtime surcharge — a plain number string. Shows in the header line AND in
  // each OT time's "(OT: +$NN)" tag. Editable before copying; always a number.
  const [shareAmt, setShareAmt] = useState("22");
  // Time padding applied to EVERY offered time at copy/preview. Granger's "+5" means
  // 5 minutes EARLIER (8:21 -> 8:16); "-5" means 5 minutes later. Stored as a mode so
  // the two buttons are mutually-exclusive toggles. Overtime is judged on the REAL
  // slot time, never the padded display time.
  const [shareShift, setShareShift] = useState("none"); // "none" | "plus" | "minus"
  // Per-row pad override ("dateKey|time" -> "plus"|"minus"), 5 minutes either way.
  // When a row has an override it wins over the global +5/-5 for that one time only.
  const [shareTimeShift, setShareTimeShift] = useState({});
  // How many days out the sheet reaches. Starts at 7; "Load more days" adds a week.
  const [shareWindow, setShareWindow] = useState(7);
  // Per-day reveal of the not-pre-checked open times (kept tucked away so booked days
  // and empty days both stay tidy until Granger wants to hand-pick more).
  const [shareExpanded, setShareExpanded] = useState({});
  // Brief "Copied" confirmation on the copy button.
  const [shareCopied, setShareCopied] = useState(false);
  const shareCopyTimer = useRef(null);
  // #5: one-off "hide all OT" for a single copy (never saved, resets on close). When on,
  // any OT time is dropped from the built message entirely.
  const [shareHideOT, setShareHideOT] = useState(false);
  // #7: per-day incremental reveal counts for the +AM / +PM buttons. Shape:
  // {dateKey: {earlier:N, later:M}}. Session-only, resets on close.
  const [shareReveal, setShareReveal] = useState({});
  // #10: per-day "possibly earlier / later" tags appended to that day's line in the
  // message. Shape {dateKey:{earlier:bool, later:bool}}. Session-only, resets on close.
  const [shareEarlierLater, setShareEarlierLater] = useState({});
  // #6: per-day memory of the last set of times that were checked when the whole day was
  // toggled off, so toggling the day back on restores exactly that set. {dateKey:[times]}.
  // Session-only (resets on close) so it never touches the Firebase payload.
  const [shareDayMemory, setShareDayMemory] = useState({});
  // D + cloud: explicit list of times a user has ADDED beyond the auto set via +AM/+PM,
  // per day. {dateKey:[times]}. Includes both real open extras and off-calendar grid
  // times. Replaces the old count-based shareReveal in the UI (shareReveal kept dormant).
  // Added times arrive CHECKED. This is part of the saved DAYS bundle.
  const [shareRevealed, setShareRevealed] = useState({});
  // Cloud: the SAVED snapshot of the whole DAYS area — {checked, ot, earlierLater,
  // dayMemory, revealed} or null. Syncs across devices (new Firebase field, kept BESIDE
  // the legacy shareSavedChecks so older data/devices never break). Written only when
  // Granger taps Save; restored+reconciled on open.
  const [shareSavedState, setShareSavedState] = useState(function() { return loadFromStorage("tl_sharedstate", null); });
  // #3: undo/redo for the share sheet. History lives in refs (source of truth) with a
  // version counter in state purely to force a re-render so the buttons enable/disable.
  // Each entry snapshots the SELECTION-shaping state (checks, OT, nudges, global pad,
  // reveals, early/late tags, hide-OT) — not the typed message or the $ amount.
  const shareHistRef = useRef([]);
  const shareHistIdxRef = useRef(0);
  const [shareHistVer, setShareHistVer] = useState(0);
  // Bumped by every user action that should create an undo step. A useEffect keyed on
  // this records a snapshot AFTER the action's state has committed. System reseeding
  // never bumps it, so auto-filled times don't pollute the undo history.
  const [shareActionSeq, setShareActionSeq] = useState(0);
  // Saved intro-message drafts (the text that precedes the times). Syncs to Firebase
  // like everything else. Each draft is {id, name, text}; text may contain the
  // literal token {{OT_AMT}}, which is swapped for the live OT surcharge number at
  // copy time — so the dollar amount stays independent of which draft is active and
  // can be changed freely no matter which draft is selected.
  const [shareDrafts, setShareDrafts] = useState(function() { return loadFromStorage("tl_sharedrafts", DEFAULT_SHARE_DRAFTS); });
  const [shareActiveDraftId, setShareActiveDraftId] = useState(function() { return loadFromStorage("tl_sharedraftid", "full"); });
  const [shareDraftEditing, setShareDraftEditing] = useState(false);
  const [shareDraftEditText, setShareDraftEditText] = useState("");
  // #4: the footer (message ending, after the times) being edited.
  const [shareDraftEditFooter, setShareDraftEditFooter] = useState("");
  const [shareDraftDeleteConfirm, setShareDraftDeleteConfirm] = useState(false);
  // ── Share openings: save-on-close of the SELECTION only (which times are checked) ──
  // Fresh opens reseed from the smart defaults. If Granger hand-picks times and chooses
  // "Save" on the way out, his selection is remembered (in-memory, this app session)
  // and restored on the next open. OT flags, +5/-5, surcharge and the message are
  // deliberately NOT part of this — only the checkboxes. (Persisting/syncing this
  // across restarts and devices means touching the Firebase payload — a separate,
  // isolated future job, noted in the handoff.)
  const [shareSavedChecks, setShareSavedChecks] = useState(function() { return loadFromStorage("tl_sharedchecks", null); });
  // True once Granger manually checks/unchecks a time this open — gates the prompt so
  // we only ask when the SELECTION actually changed by hand (never for auto-seeded
  // times or for OT/+5/-5/surcharge/message tweaks).
  const [shareDirty, setShareDirty] = useState(false);
  // Controls the "Save your openings selection?" confirm shown when the ✕ is tapped
  // after a manual change.
  const [shareSaveConfirm, setShareSaveConfirm] = useState(false);
  // ── Quick messages (copy/paste snippets for customers) ───────────────────────
  // A small list of reusable messages. Each has a short custom TITLE (what shows in
  // the collapsed list) and a full BODY (what the Copy button copies — NOT the title).
  // FUTURE-SELF NOTE: these are localStorage-only right now — deliberately NOT in the
  // Firebase sync payload — so they do NOT cross from iPad to iPhone yet. Making them
  // sync is a deferred, isolated task (spelled out in the handoff).
  const [quickMsgs, setQuickMsgs] = useState(function() { return loadFromStorage("tl_quickmsgs", [{id:"qm1",title:"",body:""},{id:"qm2",title:"",body:""},{id:"qm3",title:"",body:""}]); });
  const [quickMsgModal, setQuickMsgModal] = useState(false);
  const [quickMsgOpenId, setQuickMsgOpenId] = useState(null);
  const [quickMsgCopiedId, setQuickMsgCopiedId] = useState(null);
  const quickMsgCopyTimer = useRef(null);
  // Header name search (iPad): what's typed, whether the dropdown is open, and the
  // current green "found them" highlight ({name lower-cased, dateKey}) that fades after 8s.
  const [searchText, setSearchText] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  // v89: arrow-key nav for the header search, so it matches the standby search exactly.
  // searchIdx = highlighted match (-1 = none; Enter then falls back to the first match,
  // which is the old behavior).
  const [searchIdx, setSearchIdx] = useState(-1);
  const searchInputRef = useRef(null);
  const [searchHit, setSearchHit] = useState(null);
  const searchHitTimer = useRef(null);
  // Momentary "here's the change" pulse fired by tapping the banner or by undo/redo.
  // Shape: {type, keys:{"dateKey|time":true,...}} or null. Cells matching a key pulse
  // in the banner's family color, then clear. Keyed by time (not row index) so it
  // survives slot reordering.
  const [flashCells, setFlashCells] = useState(null);
  const flashTimer = useRef(null);
  // Delete-a-client guards shown inside the profile: a block message (when they still
  // have upcoming bookings) and a confirm step (when it's safe to remove).
  const [clientDeleteMsg, setClientDeleteMsg] = useState("");
  const [clientDeleteConfirm, setClientDeleteConfirm] = useState(false);
  // Remove ONE person from a shared (same-time) slot — a small confirm scoped to that one.
  const [sharedRemove, setSharedRemove] = useState(null);
  const [seriesEditModal, setSeriesEditModal] = useState(null);
  // v93: after a whole-series day shift, the occurrences whose new date was already
  // taken at that time. They stay exactly where they were; this reports which ones.
  const [seriesShiftReport, setSeriesShiftReport] = useState(null);
  const [renameRequiredModal, setRenameRequiredModal] = useState(null);
  // Import backup confirm: {data, whenText}. Held aside so we can ask before overwriting.
  const [importConfirm, setImportConfirm] = useState(null);
  // Price change on a profiled, non-recurring person: {dateKey, idx, name, oldPrice, newPrice}.
  // Asks whether the new price is just this appointment or the person's saved profile default.
  const [profilePriceModal, setProfilePriceModal] = useState(null);
  const [navAnim, setNavAnim] = useState({n:0,dir:0});
  const [bannerSwipeY, setBannerSwipeY] = useState(0);
  const bannerTouchStart = useRef(null);
  const dragChipRef = useRef(null);
  const dragPosRef = useRef({x:0,y:0});
  const dragOverRef = useRef(null);
  const dragStateRef = useRef(null);
  // v58: tracks whether a live drag actually MOVED. A hold that's released
  // without moving is a "peek the profile" gesture, not a reschedule.
  const dragMovedRef = useRef(false);
  const dragStartPosRef = useRef(null);
  // Floating name chip rides centered under the fingertip — a hair below the
  // touch point so the finger doesn't cover the name. Bump CHIP_DROP to nudge.
  var CHIP_DROP = 18;
  var dragChipTransform = function(x, y) { return "translate(calc(" + x + "px - 50%), " + (y + CHIP_DROP) + "px)"; };
  // Persistent element + pointer id used to pointer-capture a live drag so that
  // switching views mid-drag (which unmounts the source row) can't abort the
  // gesture. Capture is taken on the app root, which never unmounts.
  const appRootRef = useRef(null);
  const dragPointerId = useRef(null);
  const bannerTimer = useRef(null);
  const bannerTapClear = useRef(null);
  const bannerRef = useRef(null);
  bannerRef.current = banner;
  const longPressTimer = useRef(null);
  const checkoffLongPress = useRef(null);
  const dragLongPress = useRef(null);
  // v70: fires a short beat after a still single-name hold to open the profile
  // without needing to lift the finger. Cancelled the instant a drag starts.
  // v75: RE-ARMED (snappy) at Granger's request. The v70 breakage came from
  // opening the profile while the live drag was still armed under it; v75 routes
  // both the timer AND the still-release through one teardown helper that fully
  // dismantles the drag first, so the modal never opens over a live gesture.
  const profileHoldTimer = useRef(null);
  // v75: sentinel so the snappy auto-open and the release-open can't BOTH fire
  // for a single gesture. Whichever opens the profile first flips this; it is
  // reset to false each time a fresh hold arms (see the live-drag effect).
  const profileHoldFired = useRef(false);
  const editingRef = useRef(null);
  const editValuesRef = useRef(editValues);
  editValuesRef.current = editValues;
  const suggestIdxRef = useRef(suggestIdx);
  suggestIdxRef.current = suggestIdx;
  const suggestHideRef = useRef(suggestHide);
  suggestHideRef.current = suggestHide;
  const touchStart = useRef(null);
  const swipeNavStart = useRef(null);
  const dragTouchStart = useRef(null);
  const selectDragAnchor = useRef(null);
  const schedulesRef = useRef(schedules);
  schedulesRef.current = schedules;
  dragStateRef.current = dragState;
  const viewRef = useRef(view);
  viewRef.current = view;
  const slotTapRef = useRef({key:null,count:0,timer:null,side:null});
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
  const dragLiftedRef = useRef(false);
  dragLiftedRef.current = dragLifted;
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
  const accountingRef = useRef(accounting);
  accountingRef.current = accounting;
  const shareDraftsRef = useRef(shareDrafts);
  shareDraftsRef.current = shareDrafts;
  const shareActiveDraftIdRef = useRef(shareActiveDraftId);
  shareActiveDraftIdRef.current = shareActiveDraftId;
  const quickMsgsRef = useRef(quickMsgs);
  quickMsgsRef.current = quickMsgs;
  const shareSavedChecksRef = useRef(shareSavedChecks);
  shareSavedChecksRef.current = shareSavedChecks;
  const shareSavedStateRef = useRef(shareSavedState);
  shareSavedStateRef.current = shareSavedState;
  const lastSyncRef = useRef(null);
  const saveTimer = useRef(null);
  const noteRowRefs = useRef({}); // v88: id -> input element, so Enter/Backspace can move focus between day-note line rows

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
  // #6: Profiles are only for people with numbers. This used to auto-add every booked
  // name to the roster; now it does the opposite — it keeps the roster to entries that
  // have a phone, dropping any without one (existing no-number profiles, or any that
  // slip in elsewhere). This ONLY prunes the saved-profile roster; it never touches the
  // schedule, so nobody is ever removed from The List. Returns the same array untouched
  // when there's nothing to drop, so it can't loop or cause needless cloud sync.
  useEffect(function() {
    setClientMemory(function(mem){
      if (!mem || mem.length===0) return mem;
      var kept = []; var dropped = false;
      for (var i=0;i<mem.length;i++) {
        var c = mem[i];
        if (c && c.phone && String(c.phone).trim()) { kept.push(c); }
        else { dropped = true; }
      }
      return dropped ? kept : mem;
    });
  }, [schedules, clientMemory, hydrated]);
  useEffect(function() { try { localStorage.setItem("tl_holidays", JSON.stringify(customHolidays)); } catch(e) {} }, [customHolidays]);
  useEffect(function() { try { localStorage.setItem("tl_history", JSON.stringify(history)); } catch(e) {} }, [history]);
  useEffect(function() { try { localStorage.setItem("tl_daynotes", JSON.stringify(dayNotes)); } catch(e) {} }, [dayNotes]);
  useEffect(function() { try { localStorage.setItem("tl_quickmsgs", JSON.stringify(quickMsgs)); } catch(e) {} }, [quickMsgs]);
  useEffect(function() { try { localStorage.setItem("tl_sharedchecks", JSON.stringify(shareSavedChecks)); } catch(e) {} }, [shareSavedChecks]);
  useEffect(function() { try { localStorage.setItem("tl_sharedstate", JSON.stringify(shareSavedState)); } catch(e) {} }, [shareSavedState]);
  useEffect(function() { try { localStorage.setItem("tl_accounting", JSON.stringify(accounting)); } catch(e) {} }, [accounting]);
  useEffect(function() { try { localStorage.setItem("tl_sharedrafts", JSON.stringify(shareDrafts)); } catch(e) {} }, [shareDrafts]);
  useEffect(function() { try { localStorage.setItem("tl_sharedraftid", JSON.stringify(shareActiveDraftId)); } catch(e) {} }, [shareActiveDraftId]);

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
          var seeded = {schedules:seedSch, clients:clientMemoryRef.current, holidays:customHolidaysRef.current, history:historyRef.current, dayNotes:dayNotesRef.current, accounting:accountingRef.current, shareDrafts:shareDraftsRef.current, shareActiveDraftId:shareActiveDraftIdRef.current, quickMsgs:quickMsgsRef.current, shareSavedChecks:shareSavedChecksRef.current, shareSavedState:shareSavedStateRef.current};
          lastSyncRef.current = JSON.stringify(seeded);
          recentWritesRef.current.push(lastSyncRef.current);
          try { setDoc(userDoc, {schedules:seedSch, clients:seeded.clients, holidays:seeded.holidays, history:seeded.history, dayNotes:seeded.dayNotes, accounting:seeded.accounting, shareDrafts:seeded.shareDrafts, shareActiveDraftId:seeded.shareActiveDraftId, quickMsgs:seeded.quickMsgs, shareSavedChecks:seeded.shareSavedChecks, shareSavedState:seeded.shareSavedState, updatedAt:serverTimestamp()}, {merge:true}); } catch(e) {}
          setHydrated(true);
        }
        return;
      }
      var data = snap.data() || {};
      var migrated = migrateSchedules(data.schedules || {});
      var applied = {schedules:migrated, clients:data.clients||[], holidays:data.holidays||[], history:data.history||[], dayNotes:data.dayNotes||{}, accounting:data.accounting||{}, shareDrafts:(data.shareDrafts&&data.shareDrafts.length?data.shareDrafts:DEFAULT_SHARE_DRAFTS), shareActiveDraftId:data.shareActiveDraftId||"full", quickMsgs:(data.quickMsgs&&data.quickMsgs.length?data.quickMsgs:quickMsgsRef.current), shareSavedChecks:(data.shareSavedChecks!==undefined?data.shareSavedChecks:shareSavedChecksRef.current), shareSavedState:(data.shareSavedState!==undefined?data.shareSavedState:shareSavedStateRef.current)};
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
      setAccounting(applied.accounting);
      setShareDrafts(applied.shareDrafts);
      setShareActiveDraftId(applied.shareActiveDraftId);
      setQuickMsgs(applied.quickMsgs);
      setShareSavedChecks(applied.shareSavedChecks);
      setShareSavedState(applied.shareSavedState);
      setHydrated(true);
    }, function(err) { setHydrated(true); });
    return function() { try { unsub(); } catch(e) {} };
  }, [authUser]);

  useEffect(function() {
    if (!hydrated || !authUser) return;
    var payload = {schedules:schedules, clients:clientMemory, holidays:customHolidays, history:history, dayNotes:dayNotes, accounting:accounting, shareDrafts:shareDrafts, shareActiveDraftId:shareActiveDraftId, quickMsgs:quickMsgs, shareSavedChecks:shareSavedChecks, shareSavedState:shareSavedState};
    var json = JSON.stringify(payload);
    if (json === lastSyncRef.current) return;
    lastSyncRef.current = json;
    recentWritesRef.current.push(json);
    if (recentWritesRef.current.length > 12) recentWritesRef.current.shift();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    var uid = authUser.uid;
    saveTimer.current = setTimeout(function() {
      // v85 write-path fix. setDoc(...,{merge:true}) DEEP-MERGES nested maps, so a key
      // deleted locally (a cleared day note, a removed repeat rule, the last standby
      // name) is never removed on the server and resurrects via the next snapshot
      // (the "x pops back on the other device" bug). updateDoc REPLACES each named
      // field wholesale — including the dayNotes / accounting / schedules maps — so a
      // deleted key is actually gone. It leaves any unnamed server field untouched, so
      // nothing else is clobbered. updateDoc rejects if the doc does not exist yet
      // (brand-new account, first-ever write still in flight); in that one case we fall
      // back to a create via setDoc(...,{merge:true}), which makes the document.
      var writeRef = doc(fbDb, "users", uid);
      var writeBody = {schedules:payload.schedules, clients:payload.clients, holidays:payload.holidays, history:payload.history, dayNotes:payload.dayNotes, accounting:payload.accounting, shareDrafts:payload.shareDrafts, shareActiveDraftId:payload.shareActiveDraftId, quickMsgs:payload.quickMsgs, shareSavedChecks:payload.shareSavedChecks, shareSavedState:payload.shareSavedState, updatedAt:serverTimestamp()};
      try {
        updateDoc(writeRef, writeBody).catch(function() {
          try { setDoc(writeRef, writeBody, {merge:true}); } catch(e2) {}
        });
      } catch(e) {
        try { setDoc(writeRef, writeBody, {merge:true}); } catch(e3) {}
      }
      // v84 ORIGINAL (revert lever — restore this single line and remove the block above to undo):
      // try { setDoc(doc(fbDb, "users", uid), {schedules:payload.schedules, clients:payload.clients, holidays:payload.holidays, history:payload.history, dayNotes:payload.dayNotes, accounting:payload.accounting, shareDrafts:payload.shareDrafts, shareActiveDraftId:payload.shareActiveDraftId, quickMsgs:payload.quickMsgs, shareSavedChecks:payload.shareSavedChecks, shareSavedState:payload.shareSavedState, updatedAt:serverTimestamp()}, {merge:true}); } catch(e) {}
    }, 600);
  }, [schedules, clientMemory, customHolidays, history, dayNotes, accounting, shareDrafts, shareActiveDraftId, quickMsgs, shareSavedChecks, shareSavedState, hydrated, authUser]);

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
      var splitNow = touch && window.innerWidth < (sw - 20);
      setIsSplitView(splitNow);
      setSplitBannerRoom(splitNow && window.innerWidth >= SPLIT_INLINE_MIN_W);
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

  // When the accounting popup opens, drop an end-of-day estimate into the services and
  // hours fields — but ONLY where nothing is stored AND nothing's been typed yet, so a
  // saved number or one you just entered is never overwritten. The estimate lands in the
  // editable draft: delete it and type your own, or just tap Done to accept it. Emptying
  // a field and saving lets it be re-estimated next time; typing a number locks it in.
  // TODAY is the exception (B4): the current day is NOT pre-filled here — its estimate is
  // shown live in the render (counting every booked name) and only sticks when you type,
  // so it keeps updating through the day instead of freezing on the first open/close.
  useEffect(function(){
    if (!acctModal) return;
    var dk = acctModal.dateKey;
    if (dk === toDateKey(new Date())) return; // B4: today handled live in render, never pre-filled/persisted here
    var rec = acctFor(dk);
    var est = acctAutoEstimate(dk);
    if (!est.any) return;
    setAcctAdd(function(prev){
      var n = {...prev};
      if (n.services===undefined && !(acctNum(rec.services)>0)) n.services = est.services;
      if (n.hours===undefined && !(acctNum(rec.hours)>0)) n.hours = est.hours;
      return n;
    });
  }, [acctModal]);

  // v68: when the notes popup opens, drop the caret at the END of any existing text.
  // iOS autoFocus lands it at the far left; this fires once per open (noteModal identity
  // only changes on open/close, never while typing), so tapping mid-text still works
  // afterward. The textarea's autoFocus is kept as the fallback focus lever.
  useEffect(function(){
    if (!noteModal) return;
    setWlInput(""); // v83: start the standby-list add field empty on every open
    setTimeout(function(){
      var el = document.querySelector("[data-noteinput='1']");
      if (el) { el.focus(); var L = (el.value || "").length; try { el.setSelectionRange(L, L); } catch(e) {} }
    }, 0);
  }, [noteModal]);

  useEffect(function() {
    var handler = function(e) {
      // v77: while the cursor sits in a LIVE text field (typing/pasting a name into a slot,
      // editing a price, a note, etc.) Cmd-Z / Cmd-Y belong to the browser's native text
      // undo — NOT The List's schedule undo. Before this, pasting a name into a slot and
      // hitting Cmd-Z rolled back the last BOOKING instead of undoing the paste (the
      // dangerous behavior Granger reported). readOnly / disabled inputs (a slot field that
      // has lost focus but is still mounted) fall through, so app-undo still fires there —
      // matching the existing arrow-key guard a few lines down.
      var aeUR = (typeof document!=="undefined") ? document.activeElement : null;
      var inLiveField = !!(aeUR && (aeUR.tagName==="INPUT" || aeUR.tagName==="TEXTAREA") && !aeUR.readOnly && !aeUR.disabled);
      if ((e.ctrlKey||e.metaKey) && e.key==="z" && !e.shiftKey) { if(inLiveField) return; e.preventDefault(); handleUndo(); }
      if ((e.ctrlKey||e.metaKey) && (e.key==="y" || (e.key==="z" && e.shiftKey))) { if(inLiveField) return; e.preventDefault(); handleRedo(); }
      // While ANY popup is open the arrows belong to the popup, not the schedule behind
      // it — so they never page the day or jump the background to today. (Undo/redo above
      // still work.) Each modal's own handlers take over the arrows from here.
      var anyOverlay = !!(acctModal||noteModal||checkoffModal||confirmDelete||phoneModal||blockLabelModal||clientProfile||renameRequiredModal||recurringModal||conflictModal||groupRecurModal||holidayModal||groupScheduleModal||timeEditModal||seriesEditModal||seriesShiftReport||importConfirm||profilePriceModal);
      // Left/Right arrows page through days (months in Month view), mirroring the
      // on-screen ‹ / › buttons. Ignored while a field is focused — there the arrows
      // move the text cursor / hop slot rows, and Shift+Arrow nudges the time.
      if ((e.key==="ArrowLeft"||e.key==="ArrowRight") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // v91: the DAY-NOTE and ACCOUNTING popups are the two exceptions to the
        // "arrows belong to the popup" rule below. When the caret isn't parked in one of
        // their fields, the arrows page the popup from day to day just like the schedule
        // does (Shift = a week), saving whatever's typed on the way out. Every other popup —
        // and the per-line repeat popup layered on top of the day note — still swallows them.
        var aePop = (typeof document!=="undefined") ? document.activeElement : null;
        var inFieldPop = !!(aePop && (aePop.tagName==="INPUT" || aePop.tagName==="TEXTAREA" || aePop.tagName==="SELECT") && !aePop.readOnly && !aePop.disabled);
        var popPageable = !!(((noteModal && noteModal.isDay && !noteRepeatPopup && !noteScopeAsk) || acctModal) && !checkoffModal && !confirmDelete && !phoneModal && !clientProfile && !timeEditModal);
        if (popPageable && !inFieldPop) {
          e.preventDefault();
          var stepP = e.shiftKey ? 7 : 1;
          popupShiftDay(e.key==="ArrowLeft" ? -stepP : stepP);
          return;
        }
        if (anyOverlay) return;
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
      // Up arrow (outside any text field) jumps straight back to today, on whatever
      // view is currently showing. Down arrow is intentionally left alone.
      if (e.key==="ArrowUp" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (anyOverlay) return;
        if (editingRef.current) return;
        var aeu = (typeof document!=="undefined") ? document.activeElement : null;
        if (aeu && (aeu.tagName==="INPUT" || aeu.tagName==="TEXTAREA") && !aeu.readOnly && !aeu.disabled) return;
        e.preventDefault();
        setBaseDate(new Date());
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
    if (bannerTapClear.current) bannerTapClear.current();
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    var displayEntry = overrideType ? {...entry, type:overrideType} : entry;
    setBannerSwipeY(0);
    setBanner(displayEntry);
    bannerTimer.current = setTimeout(function(){ setBanner(null); }, 8000);
  };
  // Dismiss helper shared by the swipe gesture and any programmatic close.
  const dismissBanner = function() {
    if (bannerTapClear.current) bannerTapClear.current();
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBannerSwipeY(0);
    setBanner(null);
  };
  // Restart the standard auto-dismiss countdown (used when a banner tap keeps it up).
  const restartBannerTimer = function() {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(function(){ setBanner(null); }, 8000);
  };
  // Pulse the given spots ([{dateKey,time},...]) in the banner family's color, then clear.
  const flashSpots = function(type, targets) {
    if (!targets || !targets.length) return;
    var keys = {};
    targets.forEach(function(t){ if (t && t.dateKey && t.time) keys[t.dateKey + "|" + t.time] = true; });
    if (!Object.keys(keys).length) return;
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlashCells({type: type || "neutral", keys: keys});
    flashTimer.current = setTimeout(function(){ setFlashCells(null); }, 1700);
  };
  // Which spots a banner points at: an explicit list (group moves) or its own dateKey+time.
  const bannerFlashTargets = function(b) {
    if (!b) return [];
    if (b.flashTargets && b.flashTargets.length) return b.flashTargets;
    if (b.dateKey && b.time) return [{dateKey: b.dateKey, time: b.time}];
    return [];
  };
  // Tapping the banner: jump to the change (if off-screen), flash it, and keep the
  // banner up with a fresh countdown. Banners with no spot (exports, info) just dismiss.
  const onBannerTap = function() {
    var b = bannerRef.current;
    var targets = bannerFlashTargets(b);
    if (!targets.length) { dismissBanner(); return; }
    if (targets[0].dateKey) goToDateKeyIfHidden(targets[0].dateKey);
    flashSpots(b.type, targets);
    restartBannerTimer();
  };

  // After an export on the iPad, the download/share sheet takes over the screen.
  // While it's up, the banner's auto-dismiss setTimeout is FROZEN, and the sheet
  // does NOT reliably fire the visibility/focus events the effect below listens
  // for — so the "Backup exported" / "Schedule downloaded" banner can hang on
  // screen forever. The one signal we can always count on is the next screen tap
  // (the user's back, the sheet is gone). So for the export banners specifically,
  // we arm a one-shot listener: the very next touch anywhere clears the banner.
  // It never calls preventDefault, so that tap still does whatever it was going
  // to do — and every other banner keeps its normal 10s / swipe behavior.
  const armBannerTapClear = function() {
    if (bannerTapClear.current) bannerTapClear.current();
    var remove = function() {
      window.removeEventListener("pointerdown", handler, true);
      window.removeEventListener("touchstart", handler, true);
      bannerTapClear.current = null;
    };
    var handler = function() { remove(); dismissBanner(); };
    window.addEventListener("pointerdown", handler, true);
    window.addEventListener("touchstart", handler, true);
    bannerTapClear.current = remove;
  };

  // A download on the iPad takes over the screen, which can FREEZE the 10-second
  // auto-dismiss timer so a banner like "Schedule downloaded" hangs there forever.
  // When the app comes back to the foreground with a banner still up, restart the
  // STANDARD 10-second timer so the download/export banner lives the same length as
  // every other banner (and still can never get stuck: it always clears on return).
  useEffect(function() {
    var clearSoon = function() {
      if (!bannerRef.current) return;
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
      bannerTimer.current = setTimeout(function(){ setBanner(null); }, 8000);
    };
    var onVis = function() { if (document.visibilityState === "visible") clearSoon(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", clearSoon);
    return function() {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", clearSoon);
    };
  }, []);

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
  var flashRemoved = function(dateKey, idx, name) {
    var fk = dateKey + "-" + idx;
    // v72: store the vacated NAME (falls back to boolean true when a caller has none)
    // so the red glow can show whose spot this was. All consumers only test truthiness,
    // so a name string behaves exactly like the old true value.
    var stamp = (name && String(name)) || true;
    setRecentlyRemoved(function(r){ var n={...r}; n[fk]=stamp; return n; });
    setTimeout(function(){ setRecentlyRemoved(function(r){ var n={...r}; delete n[fk]; return n; }); }, 8000);
  };

  // B1: glow a just-LANDED slot green for 8 seconds (the destination of a move),
  // the green counterpart to flashRemoved's red. Same 8s window so a move reads as
  // one paired gesture: red where they left, green where they arrived.
  var flashPlaced = function(dateKey, idx) {
    var fk = dateKey + "-" + idx;
    setRecentlyPlaced(function(r){ var n={...r}; n[fk]=true; return n; });
    setTimeout(function(){ setRecentlyPlaced(function(r){ var n={...r}; delete n[fk]; return n; }); }, 8000);
  };

  // B1: paint the red/green pair for a completed move. Landing spot -> green.
  // Vacated spot -> red, but only when it was blanked in place (a shared-time
  // "paired" slot is spliced out on vacate, so its old index no longer refers to
  // the emptied spot -- we skip red there rather than redden the wrong row).
  // Indices are re-resolved from the FINAL arrays by time, so a same-day collapse
  // that shifts indices can't misplace either color.
  var flashMovePair = function(srcDK, srcArr, vacTime, vacShared, tgtDK, tgtArr, landTime, vacName) {
    var li = findSlotIdxByTime(tgtArr, landTime);
    if (li >= 0) flashPlaced(tgtDK, li);
    if (!vacShared && vacTime) {
      var vi = findSlotIdxByTime(srcArr, vacTime);
      if (vi >= 0 && !srcArr[vi].name) flashRemoved(srcDK, vi, vacName);
    }
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
      flashRemoved(dk, idx, entry.name);
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
  // v82: tapping a change-log ROW jumps the schedule to that change (the log used to be
  // undo-only). Closes the panel, moves to the entry's day (leaving Month/Wknd for a
  // day view so the row is reachable), and gives the spot a neutral flash. The row's
  // Undo button stops propagation so it still only undoes.
  var jumpToLogEntry = function(entry) {
    if (!entry || !entry.dateKey) return;
    setShowHistory(false);
    setBaseDate(parseDateKey(entry.dateKey));
    if (viewRef.current === "Month" || viewRef.current === "Wknd") setView(isPhone ? "Day" : "3-Day");
    if (entry.time) {
      var dk = entry.dateKey; var tm = entry.time;
      setTimeout(function(){ flashSpots("neutral", [{dateKey:dk, time:tm}]); }, 80);
    }
  };

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
    if (diff && diff.dateKey && diff.time) flashSpots("undo", [{dateKey:diff.dateKey, time:diff.time}]);
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
    if (diff && diff.dateKey && diff.time) flashSpots("redo", [{dateKey:diff.dateKey, time:diff.time}]);
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
    setRecentlyPlaced(function(r){ if(!r[rmKey]) return r; var n={...r}; delete n[rmKey]; return n; }); // B1: green clears on edit too
    editingRef.current = {dateKey,idx};
    setEditingCell({dateKey,idx});
    setEditValues({name:slot.name||"",price:slot.price||""});
    setSuggestIdx(-1); setSuggestHide(false);
    setEditingOccupied(occupied);
    setSwipedSlot(null);
    setPencilArmed(false);
    if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current=null; }
    if (defer) {
      // Hold the edit chrome back briefly so a fast double/triple tap doesn't flash it.
      // Matched roughly to the multi-tap window (450ms) so the editing layout stays
      // hidden until the tap sequence resolves; a plain single tap still gets the name
      // field instantly (focus below) and the price box/pencil a beat later.
      setEditChromeReady(false);
      settleTimer.current = setTimeout(function(){ settleTimer.current=null; setEditChromeReady(true); }, 350);
    } else {
      setEditChromeReady(true);
    }
    setTimeout(function(){
      var inputs = document.querySelectorAll("[data-rowkey='" + dateKey + "-" + idx + "']");
      if (inputs && inputs[0]) { inputs[0].focus(); }
    }, 50);
  };

  // v56: shared price->profile sync. If the name has a saved profile (a client-memory
  // entry that carries a phone number), a price edit becomes their new STANDING price:
  // it saves onto the profile default AND re-prices every UPCOMING (today-or-later,
  // not-yet-done) booking already on the book under that name. Past and checked-off
  // appointments keep whatever was actually charged. This is the exact same rule the
  // "change only the price" path (#6C) already runs — this helper just lets every OTHER
  // way of setting a price (penciling someone in, changing a name+price together, a
  // two-slot double booking) do the same thing, so a price now sticks the same way no
  // matter how it was entered. A person with NO phone has no profile to attach to, so
  // this returns false and nothing is swept (their appointment stays a one-off). An
  // empty/blank price also does nothing — a price only propagates when a real number is
  // entered, so penciling a name with no price never wipes a saved price. Callers write
  // the edited slot themselves first and snapshot their own undo; this never pushes undo.
  var syncProfilePrice = function(name, newPrice) {
    if (!name) return false;
    if (newPrice == null || String(newPrice).trim()==="") return false;
    var lowerSP = name.toLowerCase();
    var memSP = clientMemoryRef.current || [];
    var hasProfileSP = false;
    for (var iSP=0; iSP<memSP.length; iSP++) {
      var cSP = memSP[iSP];
      if (cSP && cSP.name && cSP.name.toLowerCase()===lowerSP && cSP.phone && String(cSP.phone).trim()) { hasProfileSP = true; break; }
    }
    if (!hasProfileSP) return false;
    var todayKeySP = toDateKey(new Date());
    setSchedules(function(prev){
      var nextSP = {...prev};
      Object.keys(nextSP).forEach(function(dk){
        if (dk < todayKeySP) return;
        var daySP = nextSP[dk]; if (!daySP) return;
        var changedSP = false;
        var outSP = daySP.map(function(s){
          if (s.name && s.name.toLowerCase()===lowerSP && !s.done && s.price!==newPrice) { changedSP = true; return {...s, price:newPrice}; }
          return s;
        });
        if (changedSP) nextSP[dk] = outSP;
      });
      return nextSP;
    });
    setClientMemory(function(mem){
      var jSP = mem.findIndex(function(c){ return c.name && c.name.toLowerCase()===lowerSP; });
      if (jSP>=0) { var uSP=[...mem]; uSP[jSP]={...uSP[jSP],price:newPrice}; return uSP; }
      return mem;
    });
    return true;
  };

  const doCommit = useCallback(function(dateKey, idx, values, keepActive) {
    // #1 tap-away saves: when committing a snapshot from a cell we already left
    // (the live edit has moved to a different cell), keepActive is true so we write
    // the data WITHOUT tearing down the edit chrome of the cell now being typed in.
    var finishEdit = function(){
      if (keepActive) return;
      editingRef.current = null; setEditingCell(null); setEditingOccupied(false);
      setPencilArmed(false); setEditChromeReady(true);
    };
    var slots = [...getSlots(dateKey)];
    var prev = slots[idx];
    var rawName = stripLeadingNumbers((values.name||"").trim());
    var newPrice = (values.price||"").trim();
    var asLunch = isLunchName(rawName);
    var asBlock = isBlockName(rawName);
    var asAvail = isAvailName(rawName);
    var asOvertime = isOvertimeName(rawName);
    var newName = (asLunch||asBlock||asAvail||asOvertime) ? "" : capitalizeFirst(rawName);
    // Removing the name removes the price along with it (a price never outlives
    // its person). Clearing only the price, though, leaves the name in place.
    if (!newName) newPrice = "";
    // 6C: changing the NAME of an already-recurring person asks whether to apply the
    // rename to just this appointment or the whole future series. (Clearing the name
    // entirely is treated as a normal one-off removal, not a series edit; use "Remove
    // recurring" to clear an entire series.)
    // #3 (v51): a PRICE-only change is NO LONGER handled here. Recurring clients now use
    // the SAME price question as everyone else — it falls through to the profile-price
    // intercept below ("Just this time" / "Always for [Name]"), so recurring people don't
    // live with their own price rules. Only a name change still routes to the series modal.
    if (prev.recurWeeks && prev.name && newName && newName!==prev.name) {
      finishEdit();
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
      finishEdit();
      return;
    }
    if (asAvail || asOvertime) {
      // Typing "a" / "o" marks an OPEN slot AVAILABLE / OVERTIME (same green
      // highlight as the double-tap mark). cycleSlotMark refuses named/blocked
      // slots, so this never wipes a booking — if the slot isn't open, the typed
      // letter is simply discarded and the slot is left exactly as it was.
      cycleSlotMark(dateKey, idx, asOvertime ? "overtime" : "available");
      finishEdit();
      return;
    }
    // #6C-profile / v54: changing ONLY the price of a person who has a saved profile (a
    // client-memory entry with a phone) NO LONGER asks "just this time / always." Per
    // Granger: a price change is ALWAYS the client's new price. It attaches to the PROFILE
    // and sweeps every upcoming booking, applied synchronously right here at commit — no
    // modal round-trip (the old modal sometimes failed to land the change). Past and
    // already-checked-off appointments keep the price that was actually charged. A person
    // with NO profile (recurring or not) has no profile to attach to, so they fall through
    // to the general write below and just this one appointment changes. This applies to
    // RECURRING clients too (v51 #3) — every future occurrence of the series is repriced.
    // Name changes fall through to the normal path. (The old profilePriceModal + its
    // applyProfilePrice handler are left dormant as a fallback; nothing opens them now.)
    if (prev.name && newName && newName===prev.name && newPrice!==prev.price) {
      var memNowPP = clientMemoryRef.current || [];
      var hasProfilePP = false;
      for (var piPP=0; piPP<memNowPP.length; piPP++) {
        var cPP = memNowPP[piPP];
        if (cPP && cPP.name && cPP.name.toLowerCase()===newName.toLowerCase() && cPP.phone && String(cPP.phone).trim()) { hasProfilePP = true; break; }
      }
      if (hasProfilePP) {
        var snapPP = {schedules: JSON.parse(JSON.stringify(schedulesRef.current))};
        pushUndo(snapPP);
        var todayKeyPP = toDateKey(new Date());
        var lowerPP = newName.toLowerCase();
        var newSchPP = {...schedulesRef.current};
        Object.keys(newSchPP).forEach(function(dk){
          var dayPP = newSchPP[dk]; if (!dayPP) return;
          var isEditedDayPP = (dk===dateKey);
          var isFuturePP = (dk >= todayKeyPP);
          if (!isEditedDayPP && !isFuturePP) return;
          var changedPP = false;
          var outPP = dayPP.map(function(s, si){
            // The appointment being edited always takes the new price (even if its day is
            // in the past — that's this record being corrected).
            if (isEditedDayPP && si===idx) { changedPP = true; return {...s, price:newPrice}; }
            // Every other UPCOMING, not-yet-done booking under this name is repriced too.
            if (isFuturePP && s.name && s.name.toLowerCase()===lowerPP && !s.done) { changedPP = true; return {...s, price:newPrice}; }
            return s;
          });
          if (changedPP) newSchPP[dk] = outPP;
        });
        setSchedules(newSchPP);
        setClientMemory(function(mem) {
          var iPP = mem.findIndex(function(c){ return c.name && c.name.toLowerCase()===lowerPP; });
          if (iPP>=0) { var uPP=[...mem]; uPP[iPP]={...uPP[iPP],price:newPrice}; return uPP; }
          return mem;
        });
        addHistoryEntry({type:"edited",time:prev.time,name:newName,prevName:newName,dateKey:dateKey});
        finishEdit();
        return true;
      }
    }
    if (newName!==prev.name || newPrice!==prev.price || prev.availStatus) {
      var snapshot = {schedules: JSON.parse(JSON.stringify(schedulesRef.current))};
      pushUndo(snapshot);
      // #7 (v51): a name TRANSITION (typing a fresh name into a spot, or clearing a name
      // out) must never carry over the previous occupant's "repeating"/exception flags.
      // Before, this write spread ...prev unchanged, so emptying a recurring person by
      // typing their name blank left a hidden recurWeeks on the slot, and the next name
      // typed there inherited "recurring" (the 7:48 bug). Clearing these on any add/remove
      // makes an emptied slot behave exactly like the Cancel button, and a fresh booking
      // always starts NOT recurring. A same-name price-only change never reaches here for
      // recurring people (handled above), so this can't accidentally un-recur anyone.
      var isNameTransition = (!prev.name && newName) || (prev.name && !newName);
      var writeSlot = {...prev,name:newName,price:newPrice,availStatus:null,pending:false};
      if (isNameTransition) { writeSlot.recurWeeks = null; writeSlot.isException = false; }
      slots[idx] = writeSlot;
      setSlots(dateKey,slots);
      if (prev.name&&!newName) { addHistoryEntry({type:"removed",time:prev.time,name:prev.name,dateKey}); flashRemoved(dateKey,idx,prev.name); }
      else if (!prev.name&&newName) {
        addHistoryEntry({type:"added",time:slots[idx].time,name:newName,price:newPrice,dateKey});
        setClientMemory(function(mem) {
          var existing = mem.findIndex(function(c){ return c.name.toLowerCase()===newName.toLowerCase(); });
          if (existing>=0) { var updated=[...mem]; updated[existing]={...updated[existing],name:newName,price:newPrice||mem[existing].price}; return updated; }
          // #6: profiles are only for people with numbers, so booking a fresh name no
          // longer auto-creates a roster profile. A profile is created when a phone is
          // added on the profile card. Existing (phoned) profiles above still update.
          return mem;
        });
      } else if (prev.name&&newName) { addHistoryEntry({type:"edited",time:slots[idx].time,name:newName,prevName:prev.name,dateKey}); syncProfilePrice(newName, newPrice); }
    }
    finishEdit();
  },[getSlots]);

  // Apply the profile-price choice from the modal.
  // "once" (Just this time) → changes ONLY this one appointment.
  // "always" → #1 (v51): makes this the client's price everywhere GOING FORWARD: this
  // appointment, every upcoming (today-or-later, not-done) appointment they already have
  // booked, AND their saved profile default (for future new bookings). Past and checked-off
  // appointments are left exactly as they were. Recurring and non-recurring behave the same.
  const applyProfilePrice = function(scope) {
    var m = profilePriceModal; if (!m) return;
    var baseSlots = getSlots(m.dateKey);
    var prev = baseSlots[m.idx];
    if (!prev) { setProfilePriceModal(null); return; }
    var snapshot = {schedules: JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    if (scope==="always") {
      var todayKeyPP = toDateKey(new Date());
      var lowerPP = (m.name||"").toLowerCase();
      var newSchPP = {...schedulesRef.current};
      Object.keys(newSchPP).forEach(function(dk){
        var dayPP = newSchPP[dk]; if (!dayPP) return;
        var isEditedDay = (dk===m.dateKey);
        var isFuture = (dk >= todayKeyPP);
        if (!isEditedDay && !isFuture) return;
        var changedPP = false;
        var outPP = dayPP.map(function(s, si){
          // The appointment actually being edited always takes the new price, even if
          // its day is in the past (correcting today's/this record).
          if (isEditedDay && si===m.idx) { changedPP = true; return {...s, price:m.newPrice}; }
          // Every other UPCOMING booking under this name (not yet done) is repriced too.
          if (isFuture && s.name && s.name.toLowerCase()===lowerPP && !s.done) { changedPP = true; return {...s, price:m.newPrice}; }
          return s;
        });
        if (changedPP) newSchPP[dk] = outPP;
      });
      setSchedules(newSchPP);
      setClientMemory(function(mem) {
        var i = mem.findIndex(function(c){ return c.name && c.name.toLowerCase()===lowerPP; });
        if (i>=0) { var u=[...mem]; u[i]={...u[i],price:m.newPrice}; return u; }
        return mem;
      });
    } else {
      var slotsOnce = [...baseSlots];
      slotsOnce[m.idx] = {...prev, price:m.newPrice};
      setSlots(m.dateKey, slotsOnce);
    }
    addHistoryEntry({type:"edited",time:prev.time,name:m.name,prevName:m.name,dateKey:m.dateKey});
    setProfilePriceModal(null);
  };

  // Save a name as "penciled in" (tentative) — offered but not yet confirmed.
  const commitPenciled = function(dateKey, idx, valsArg, keepActive) {
    var finishEdit = function(){
      if (keepActive) return;
      editingRef.current = null; setEditingCell(null); setEditingOccupied(false);
      setPencilArmed(false); setEditChromeReady(true);
    };
    var slots = [...getSlots(dateKey)];
    var prev = slots[idx];
    var cv = valsArg || editValuesRef.current;
    var rawName = stripLeadingNumbers((cv.name||"").trim());
    if (!rawName && prev.name) rawName = prev.name; // blur may have committed already
    if (isLunchName(rawName) || isBlockName(rawName) || isAvailName(rawName) || isOvertimeName(rawName) || !rawName) { doCommit(dateKey, idx, cv, keepActive); return; }
    var newName = capitalizeFirst(rawName);
    var newPrice = (cv.price||"").trim() || prev.price || "";
    var snapshot = {schedules: JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    // v55: a pencil-in must never inherit the previous occupant's recurring/exception
    // flags. When a DIFFERENT name is penciled onto a row (e.g. a new client dropped
    // into a spot a recurring client just vacated — even before the blank name has
    // been committed, so prev is still the recurring person), the previous spread
    // carried recurWeeks straight onto the new name and marked them recurring with no
    // "just this one / all slots" prompt. That was the inheritance bug. Re-penciling
    // the SAME name (a price tweak, re-offering the same person) keeps their flag.
    var pWrite = {...prev,name:newName,price:newPrice,pending:true,done:false};
    if ((newName||"").toLowerCase() !== (prev.name||"").toLowerCase()) { pWrite.recurWeeks = null; pWrite.isException = false; }
    slots[idx] = pWrite;
    setSlots(dateKey,slots);
    if (!prev.name) {
      setClientMemory(function(mem) {
        var existing = mem.findIndex(function(c){ return c.name.toLowerCase()===newName.toLowerCase(); });
        if (existing>=0) { var u=[...mem]; u[existing]={...u[existing],name:newName,price:newPrice||mem[existing].price}; return u; }
        // #6: no auto-profile for a fresh name — a profile exists only once a phone is added.
        return mem;
      });
    }
    syncProfilePrice(newName, newPrice);
    addHistoryEntry({type:"added",time:prev.time,name:newName,price:newPrice,dateKey,bannerType:"penciled"});
    finishEdit();
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
    // v92 GROUP TIME CASCADE. If this slot is the FIRST member of a group, every other
    // member of that group moves by the SAME number of minutes. Move the 2nd or 3rd
    // member and nothing else budges (groupCascadeIdxs returns [] unless idx is first).
    var cascadeIdxs = groupCascadeIdxs(slots, idx);
    var deltaMin = timeToAbsMinutes(newTime) - timeToAbsMinutes(prev.time);
    var moveIdxs = [idx].concat(cascadeIdxs);
    var newTimeFor = {};
    var mi;
    for (mi=0; mi<moveIdxs.length; mi++) {
      newTimeFor[moveIdxs[mi]] = absMinutesToTime(timeToAbsMinutes(slots[moveIdxs[mi]].time) + deltaMin);
    }
    // Block collisions with an existing slot at that exact time. A moving slot may land
    // on a time another MOVING slot is vacating (the whole group slides together), so
    // only slots that are staying put can block the move.
    var moving = {}; for (mi=0; mi<moveIdxs.length; mi++) { moving[moveIdxs[mi]] = true; }
    var blocked = false;
    for (mi=0; mi<moveIdxs.length; mi++) {
      var wantT = newTimeFor[moveIdxs[mi]];
      if (slots.some(function(s,i){ return !moving[i] && s.time===wantT; })) { blocked = true; }
    }
    if (blocked) { setTimeEditModal(null); return; }
    var snapshot = {schedules: JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    // retimeSlot carries the original per-slot logic: editing the minutes of a slot does
    // NOT change whether it's a default slot or a custom one, and a default slot remembers
    // its original default time (defaultBaseTime) so the render layer can color it cobalt
    // (earlier) or purple (later). Revert lever — the v91 single-slot write:
    // slots[idx] = {...prev,time:newTime,isCustom:wasCustom,customTime: wasCustom && !isStillDefault,defaultBaseTime:(!wasCustom?baseTime:prev.defaultBaseTime)};
    for (mi=0; mi<moveIdxs.length; mi++) {
      var ti = moveIdxs[mi];
      slots[ti] = retimeSlot(slots[ti], newTimeFor[ti], null);
    }
    slots.sort(function(a,b){ return timeToAbsMinutes(a.time)-timeToAbsMinutes(b.time); });
    setSlots(dateKey,slots);
    setTimeEditModal(null);
  };

  const handleBlur = useCallback(function(e) {
    var related = e.relatedTarget;
    if (related && related.dataset && related.dataset.rowkey===((editingRef.current&&editingRef.current.dateKey)+"-"+(editingRef.current&&editingRef.current.idx))) return;
    // #1 tap-away saves: capture WHICH cell and WHAT text right now, synchronously, so
    // tapping straight from this cell into another one still commits this cell's typed
    // name to THIS cell — instead of losing it once the live refs repoint to the new
    // cell. If by commit time a different cell is being edited, movedOn keeps that
    // newer edit untouched.
    var snapEr = editingRef.current;
    if (!snapEr) return;
    var snapVals = {name:editValuesRef.current.name, price:editValuesRef.current.price};
    var snapArmed = pencilArmedRef.current;
    setTimeout(function(){
      var liveEr = editingRef.current;
      var movedOn = !!(liveEr && (liveEr.dateKey!==snapEr.dateKey || liveEr.idx!==snapEr.idx));
      if (snapArmed && stripLeadingNumbers((snapVals.name||"").trim())) { commitPenciled(snapEr.dateKey,snapEr.idx,snapVals,movedOn); }
      else { doCommit(snapEr.dateKey,snapEr.idx,snapVals,movedOn); }
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

  // #4 type-ahead: saved clients whose name matches what's typed so far. Kicks in at
  // 3+ characters; names that START with the text come first, then names that contain
  // it; an exact full match is dropped (nothing to suggest). Capped at 6.
  const computeSuggestions = function(typed) {
    var t = stripLeadingNumbers((typed||"").trim()).toLowerCase();
    if (t.length < 3) return [];
    var mem = clientMemoryRef.current || [];
    var seen = {}; var starts = []; var contains = [];
    mem.forEach(function(c){
      if (!c || !c.name) return;
      if (!c.phone || !String(c.phone).trim()) return; // #6: only phoned profiles
      var ln = c.name.toLowerCase();
      // v89: the old gate also dropped an EXACT full-name match (|| ln===t), so the
      // suggestion vanished the instant the whole name was typed — in the schedule name
      // field, the standby search, and anywhere else computeSuggestions feeds. Now an
      // exact match stays listed (and stays arrow-selectable). Revert lever — old line:
      // if (seen[ln] || ln===t) return;
      if (seen[ln]) return;
      var pos = ln.indexOf(t);
      if (pos===0) { starts.push(c); seen[ln]=true; }
      else if (pos>0) { contains.push(c); seen[ln]=true; }
    });
    return starts.concat(contains).slice(0,6);
  };

  const handleKeyDown = function(e, dateKey, idx) {
    if (e.key==="Tab") return;
    // #4 type-ahead: while client suggestions are showing, plain Down/Up move the
    // highlight and Enter picks the highlighted client (name + their saved price),
    // instead of hopping rows or committing the typed text. Shift combos pass through.
    if (!e.shiftKey && (e.key==="ArrowDown"||e.key==="ArrowUp"||e.key==="Enter")) {
      var sugs = suggestHideRef.current ? [] : computeSuggestions(editValuesRef.current.name);
      if (sugs.length>0) {
        if (e.key==="ArrowDown") { e.preventDefault(); setSuggestIdx(function(p){ return Math.min(p+1, sugs.length-1); }); return; }
        if (e.key==="ArrowUp") { e.preventDefault(); if (suggestIdxRef.current<=0) { setSuggestIdx(-1); setSuggestHide(true); } else { setSuggestIdx(suggestIdxRef.current-1); } return; }
        if (e.key==="Enter" && suggestIdxRef.current>=0 && suggestIdxRef.current<sugs.length) {
          e.preventDefault();
          var pick = sugs[suggestIdxRef.current];
          setSuggestHide(true); setSuggestIdx(-1);
          doCommit(dateKey, idx, {name:pick.name, price:(pick.price||getClientPrice(pick.name)||editValuesRef.current.price||"")});
          return;
        }
      }
    }
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
        syncProfilePrice(newName, newPrice);
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
        syncProfilePrice(newName, newPrice);
        editingRef.current=null; setEditingCell(null); setEditingOccupied(false);
        setTimeout(function(){ startEdit(dateKey,nextIdx); },80);
      } else {
        // No usable slot directly below — just save this one, no link formed.
        slots[idx] = {...curSlot,name:newName,price:newPrice};
        setSlots(dateKey,slots);
        addHistoryEntry({type:"added",time:slots[idx].time,name:newName,price:newPrice,dateKey});
        syncProfilePrice(newName, newPrice);
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
    if (slot.blocked) return; // v73: lunches/blocks are not checkoffable
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
    var updated = slots.map(function(s, i){ return (flip[i] && !s.blocked) ? {...s,done:newDone} : s; });
    setSlots(dateKey,updated);
    if (newDone) {
      playSound("lock");
    } else {
      playSound("tap");
    }
  };

  // Shared slot (Model B): one checkoff marks BOTH people who share a time. Flip
  // each person plus their own linked group / back-to-back run, in one undo step.
  const handleCheckoffPair = function(dateKey, idxList) {
    var slots = getSlots(dateKey);
    var actionable = idxList.some(function(i){ return slots[i] && (slots[i].name || slots[i].blocked); });
    if (!actionable) return;
    var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    var newDone = idxList.some(function(i){ return slots[i] && slots[i].name && !slots[i].done; });
    var flip = {};
    idxList.forEach(function(idx){
      var slot = slots[idx]; if (!slot) return;
      flip[idx] = true;
      var gid = slot.groupId; var nm = (slot.name||"").toLowerCase(); var gi;
      for (gi=0; gi<slots.length; gi++) { if (gid && slots[gi].groupId===gid && (slots[gi].name || slots[gi].blocked)) flip[gi] = true; }
      if (nm) {
        var up = idx; while (up>0 && (slots[up-1].name||"").toLowerCase()===nm) { flip[up-1]=true; up--; }
        var dn = idx; while (dn<slots.length-1 && (slots[dn+1].name||"").toLowerCase()===nm) { flip[dn+1]=true; dn++; }
      }
    });
    var updated = slots.map(function(s, i){ return (flip[i] && !s.blocked) ? {...s,done:newDone} : s; });
    setSlots(dateKey,updated);
    playSound(newDone ? "lock" : "tap");
  };

  // Shared slot (Model B): draw two same-time people as ONE row — two side-by-side
  // cells split by a divider, with a SINGLE checkoff (left) that marks both. Each
  // cell keeps the real handlers: tap a name to open the profile, tap the recurring
  // badge to manage it, tap the pencil for that person's note, long-press to drag.
  const renderSharedPair = function(dateKey, leftSlot, leftIdx, rightSlot, rightIdx) {
    var rowKey = dateKey+"-"+leftIdx+"-pair";
    var bothDone = !!leftSlot.done && !!rightSlot.done;
    var pad = getDayCount()>3 ? "0 7px" : "0 14px";
    // In shared mode each half shows ONLY the name (declutter — request #1). Price,
    // the recurring badge, and the pencil are dropped while two people share a time
    // and come back automatically when they no longer share it (the normal row draws
    // them). The recurring/move logic is unaffected — it reads the slot's own data,
    // not these icons. onPointerDown records the pointer id so a long-press drag can
    // be captured and survive on the iPad (request #3 — the missing piece).
    var renderHalf = function(s, i) {
      var hsh = searchHit && s.name && s.name.toLowerCase()===searchHit.name && dateKey===searchHit.dateKey;
      var hshFlash = flashCells && flashCells.keys[dateKey+"|"+s.time];
      var hshFam = hshFlash ? bannerFamily(flashCells.type) : null;
      return (
        <div data-droprow={dateKey+"-"+i} data-dropfilled="1"
          style={{flex:"1 1 0px",minWidth:0,display:"flex",alignItems:"center",gap:"6px",padding:"0 6px",background:hshFlash?flashTintFor(hshFam):(hsh?"#bfe9bf":(s.done?"#f4faf4":"transparent")),animation:hshFlash?(flashAnimFor(hshFam)+" 1.6s ease-out"):"none",cursor:"pointer",userSelect:"none",WebkitUserSelect:"none"}}
          onClick={function(){ if(s.done) handleDoneRowTap(dateKey,i); else openClientProfile(s.name); }}
          onPointerDown={function(e){ dragPointerId.current=e.pointerId; }}
          onMouseDown={function(){ if(!s.done) startDragLongPress(dateKey,i,0,0); }}
          onMouseUp={function(){ cancelDragLongPress(); }}
          onMouseLeave={cancelDragLongPress}
          onTouchStart={function(e){ if(!s.done&&e.touches[0]){ startDragLongPress(dateKey,i,e.touches[0].clientX,e.touches[0].clientY,true); } }}
          onTouchMove={function(e){ if(e.touches[0]) cancelDragLongPressIfMoved(e.touches[0].clientX,e.touches[0].clientY); }}
          onTouchEnd={function(e){ var wasTap=!!dragLongPress.current; cancelDragLongPress(); handleTouchEnd(e,dateKey,i); if(wasTap){ if(s.done) handleDoneRowTap(dateKey,i); else openClientProfile(s.name); } }}
        >
          <span style={{flex:1,minWidth:0,fontSize:isPhone?"15px":"13px",color:s.done?"#2a6a2a":"#1a1a1a",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",fontFamily:"Georgia,serif"}}>{s.name}</span>
          <button
            onClick={function(e){ e.stopPropagation(); setSharedRemove({dateKey:dateKey,idx:i,name:s.name,time:s.time,groupId:s.groupId||null}); }}
            onPointerDown={function(e){ e.stopPropagation(); }}
            onMouseDown={function(e){ e.stopPropagation(); }}
            onTouchStart={function(e){ e.stopPropagation(); }}
            onTouchEnd={function(e){ e.stopPropagation(); }}
            title="Remove from this slot"
            style={{flexShrink:0,width:"22px",height:"22px",lineHeight:1,border:"none",background:"none",color:"#c2b8b8",cursor:"pointer",fontFamily:"inherit",fontSize:"15px",padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>{"×"}</button>
        </div>
      );
    };
    return (
      <div key={rowKey} style={{position:"relative",overflow:"hidden",borderBottom:"1px solid #efefed",flex:"1 1 0px",minHeight:"26px",display:"flex",flexDirection:"column"}}>
        <div style={{display:"flex",alignItems:"center",flex:"1 1 auto",minHeight:0,padding:pad,background:"#fcfcfa"}}>
          <button onClick={function(){ handleCheckoffPair(dateKey,[leftIdx,rightIdx]); }} title="Check off both" style={{width:"18px",height:"18px",borderRadius:"50%",border:bothDone?"1.5px solid #2a7a2a":"1.5px solid #aaaaaa",background:bothDone?"#2a7a2a":"transparent",cursor:"pointer",flexShrink:0,marginRight:"10px",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s"}}>{bothDone?<span style={{color:"#fff",fontSize:"10px",lineHeight:1}}>{"✓"}</span>:null}</button>
          <span style={{fontSize:"12px",color:bothDone?"#3a5a3a":"#c9a96e",flexShrink:0,width:"40px",fontVariantNumeric:"tabular-nums",letterSpacing:"0.02em"}}>{leftSlot.time}</span>
          {renderHalf(leftSlot,leftIdx)}
          <div style={{width:"1px",alignSelf:"stretch",background:"#d8d2c4",margin:"4px 2px"}}/>
          {renderHalf(rightSlot,rightIdx)}
        </div>
      </div>
    );
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

  // Taps on an open slot: 1 = edit (handled live by the input focus). A DOUBLE tap
  // MARKS the slot, and the SIDE of the tap decides which: left half = AVAILABLE,
  // right half = OVERTIME. (Triple-tap-for-overtime was unreliable on-device — even
  // a clean triple rarely landed — so the second choice moved off tap-COUNT and onto
  // tap-POSITION, which double-tap already proved it can hit.) The "side" arg is
  // "left" or "right", measured against the name cell at the call site. On the 2nd tap we back
  // out of the edit the first tap started so the keyboard goes away, then settle the
  // label after a beat. count>=2 (not ===2) so a stray 3rd tap still marks, not edits.
  const handleOpenSlotTap = function(dateKey, idx, side) {
    var key = dateKey+"-"+idx;
    var st = slotTapRef.current;
    if (st.key !== key) { if (st.timer) clearTimeout(st.timer); st.key=key; st.count=0; st.timer=null; }
    st.count += 1;
    st.side = side;
    if (st.count >= 2) {
      // If the first tap opened an edit and they've started writing a name, this
      // is real typing/cursor work — leave it alone instead of marking the slot.
      var cv = editValuesRef.current;
      if (editingRef.current && cv && (cv.name||"").trim().length>0) {
        if (st.timer) clearTimeout(st.timer);
        slotTapRef.current = {key:null,count:0,timer:null,side:null};
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
      var sd = slotTapRef.current.side;
      slotTapRef.current = {key:null,count:0,timer:null,side:null};
      if (c >= 2) cycleSlotMark(dk, ix, sd === "right" ? "overtime" : "available");
    }, 450);
  };

  // ── Share openings: helpers ──────────────────────────────────────────────────
  // Minutes (on a 24h scale) that count as "before 8 AM" — anything earlier is
  // overtime by default. 8:00 itself is regular.
  var SHARE_OT_CUTOFF = timeToAbsMinutes("8:00");
  // The padding the active +5 / -5 mode applies, in clock minutes. "+5" (plus) makes
  // a time EARLIER per Granger's wording, so it subtracts; "-5" (minus) adds.
  const shareShiftDelta = function(mode) { return mode === "plus" ? -5 : (mode === "minus" ? 5 : 0); };
  // The delta to actually use for one row: its own override if it has one
  // (independent 5-minute nudge, either direction), else the global +5/-5 pad.
  const effectiveShareDelta = function(key) {
    var override = shareTimeShift[key];
    if (override === "plus" || override === "minus") return shareShiftDelta(override);
    return shareShiftDelta(shareShift);
  };
  // Format a stored time ("8:21", "1:13") as "8:21 AM" / "1:13 PM", applying a
  // clock-minute delta. Works off the afternoon-aware absolute-minute mapping so
  // 1:00–4:00 land in the afternoon correctly.
  const shareFmtTime = function(time, delta) {
    var base = timeToAbsMinutes(time) + (delta || 0);
    if (base < 0) base = 0;
    var realH = Math.floor(base / 60);
    var realM = base % 60;
    var period = realH >= 12 ? "PM" : "AM";
    var h12 = realH % 12; if (h12 === 0) h12 = 12;
    var mm = realM < 10 ? ("0" + realM) : ("" + realM);
    return h12 + ":" + mm + " " + period;
  };
  // Default-overtime check on the REAL slot time (never the padded display time).
  const shareIsOTTime = function(time) { return timeToAbsMinutes(time) < SHARE_OT_CUTOFF; };
  // Day label for the share sheet / message: "Today" / "Tomorrow" for the first two
  // days, a bare weekday name through 6 days out (no risk of meaning the wrong one),
  // and the full short date from 7 days out on, so a far-future "Sunday" can't be
  // mistaken for the wrong Sunday.
  const shareDayLabel = function(offset, dateKey) {
    if (offset === 0) return "Today";
    if (offset === 1) return "Tomorrow";
    if (offset < 7) return parseDateKey(dateKey).toLocaleDateString("en-US", {weekday:"long"});
    return friendlyDate(dateKey);
  };
  // #8: MESSAGE-ONLY time format — same clock math as shareFmtTime but with no AM/PM.
  // Used solely by buildShareText; the on-screen sheet keeps shareFmtTime (with AM/PM).
  const shareFmtTimeMsg = function(time, delta) {
    var base = timeToAbsMinutes(time) + (delta || 0);
    if (base < 0) base = 0;
    var realH = Math.floor(base / 60);
    var realM = base % 60;
    var h12 = realH % 12; if (h12 === 0) h12 = 12;
    var mm = realM < 10 ? ("0" + realM) : ("" + realM);
    return h12 + ":" + mm;
  };
  // #8: MESSAGE-ONLY day label — shortens the weekday name (Thursday -> Thu) for the
  // 2..6-day range. "Today"/"Tomorrow" stay; 7+ days out already uses a short weekday.
  const shareDayLabelMsg = function(offset, dateKey) {
    if (offset === 0) return "Today";
    if (offset === 1) return "Tomorrow";
    if (offset < 7) return parseDateKey(dateKey).toLocaleDateString("en-US", {weekday:"short"});
    return friendlyDate(dateKey);
  };
  // Sanitize the OT amount to a bare number string for display in the message.
  const shareAmtClean = function() {
    var d = (shareAmt || "").replace(/[^0-9]/g, "");
    return d.length ? d : "0";
  };

  // Walk the coming windowDays days and, for each, sort the open times into:
  //   auto  — pre-checked: any gap BETWEEN booked clients, plus the single open slot
  //           immediately before the first booking and immediately after the last.
  //   extra — every other open time that day (shown only when a day is expanded),
  //           so Granger can still hand-pick something further out.
  // A day with no open times at all is dropped. Bookings = named, non-blocked slots;
  // lunch/blocked breaks anchor nothing and are never offered. Times are de-duped, so
  // a shared/paired slot can't double-list and a half-booked time is never offered.
  const computeShareDays = function(windowDays) {
    var out = [];
    var today = new Date();
    // Current clock time as absolute minutes (24h scale), used to drop already-passed
    // times from TODAY's offerings. Recomputed on every call (every render) so it stays
    // current as the day goes on. Future times are always kept, even a few minutes out.
    var nowAbsShare = today.getHours() * 60 + today.getMinutes();
    var d;
    for (d = 0; d < windowDays; d++) {
      var dateObj = addDays(today, d);
      var dk = toDateKey(dateObj);
      var slots = getSlots(dk);
      var timeMap = {};
      var i;
      for (i = 0; i < slots.length; i++) {
        var s = slots[i];
        if (!s || !s.time) continue;
        var rec = timeMap[s.time];
        if (!rec) { rec = {hasBooked:false, hasBlocked:false, hasEmpty:false, abs:timeToAbsMinutes(s.time)}; timeMap[s.time] = rec; }
        if (s.blocked) rec.hasBlocked = true;
        else if (s.name) rec.hasBooked = true;
        else rec.hasEmpty = true;
      }
      var times = Object.keys(timeMap);
      var bookedAbs = [];
      var openList = [];
      for (i = 0; i < times.length; i++) {
        var t = times[i]; var r = timeMap[t];
        if (r.hasBooked) { bookedAbs.push(r.abs); }
        else if (!r.hasBlocked && r.hasEmpty) { openList.push({time:t, abs:r.abs}); }
      }
      if (!openList.length) continue;
      openList.sort(function(a, b){ return a.abs - b.abs; });
      // #req: on TODAY only, never offer a time that has already passed. Judged on the
      // REAL slot minutes vs the current clock minutes (not the padded display time),
      // same principle as the OT check. A time at the current minute or later is kept;
      // future times are always offerable even if only a few minutes away.
      if (d === 0) {
        var futureOpen = [];
        for (i = 0; i < openList.length; i++) { if (openList[i].abs >= nowAbsShare) futureOpen.push(openList[i]); }
        openList = futureOpen;
        if (!openList.length) continue;
      }
      var hasBookings = bookedAbs.length > 0;
      var firstAbs = 0, lastAbs = 0;
      if (hasBookings) {
        firstAbs = bookedAbs[0]; lastAbs = bookedAbs[0];
        for (i = 1; i < bookedAbs.length; i++) { if (bookedAbs[i] < firstAbs) firstAbs = bookedAbs[i]; if (bookedAbs[i] > lastAbs) lastAbs = bookedAbs[i]; }
      }
      // Nearest open slot just before the first booking / just after the last.
      var beforeAbs = null, afterAbs = null;
      if (hasBookings) {
        for (i = 0; i < openList.length; i++) {
          var oa = openList[i].abs;
          if (oa < firstAbs) { if (beforeAbs === null || oa > beforeAbs) beforeAbs = oa; }
          if (oa > lastAbs) { if (afterAbs === null || oa < afterAbs) afterAbs = oa; }
        }
      }
      var auto = []; var extra = [];
      for (i = 0; i < openList.length; i++) {
        var o = openList[i];
        var isAuto = false;
        if (hasBookings) {
          if (o.abs > firstAbs && o.abs < lastAbs) isAuto = true;       // gap in the middle
          else if (beforeAbs !== null && o.abs === beforeAbs) isAuto = true; // one before first
          else if (afterAbs !== null && o.abs === afterAbs) isAuto = true;   // one after last
        } else {
          // #9: no bookings yet -> pre-offer the three fixed defaults, but only the ones
          // that are actually open. The moment a slot is filled, hasBookings flips true
          // and this branch is skipped entirely (regular one-either-side rule resumes).
          if (ZERO_DAY_DEFAULTS.indexOf(o.time) !== -1) isAuto = true;
        }
        if (isAuto) auto.push(o); else extra.push(o);
      }
      // #7: split the non-auto opens into those EARLIER than the auto block and those
      // LATER, each ordered nearest-to-the-block first, so +AM / +PM can hand one over
      // at a time. With no auto block to anchor on, everything counts as "later."
      var autoMin = null, autoMax = null;
      for (i = 0; i < auto.length; i++) {
        if (autoMin === null || auto[i].abs < autoMin) autoMin = auto[i].abs;
        if (autoMax === null || auto[i].abs > autoMax) autoMax = auto[i].abs;
      }
      var extraEarlier = []; var extraLater = [];
      for (i = 0; i < extra.length; i++) {
        var ex = extra[i];
        if (autoMin === null) extraLater.push(ex);
        else if (ex.abs < autoMin) extraEarlier.push(ex);
        else extraLater.push(ex);
      }
      extraEarlier.sort(function(a, b){ return b.abs - a.abs; }); // nearest-earlier first
      extraLater.sort(function(a, b){ return a.abs - b.abs; });   // nearest-later first
      out.push({dateKey:dk, offset:d, label:shareDayLabel(d, dk), hasBookings:hasBookings, auto:auto, extra:extra, extraEarlier:extraEarlier, extraLater:extraLater, bookedAbs:bookedAbs, minGridAbs:(d===0?nowAbsShare:0)});
    }
    return out;
  };

  // Seed the checked / OT maps for a freshly computed list. preserve keeps any row
  // the user already touched (used by "Load more days"); a fresh open passes {} so the
  // sheet starts from the smart defaults every time.
  const seedShareMaps = function(days, preserveChecked, preserveOT) {
    var checked = {...(preserveChecked || {})};
    var ot = {...(preserveOT || {})};
    var di, si;
    for (di = 0; di < days.length; di++) {
      var day = days[di];
      var all = day.auto.concat(day.extra);
      for (si = 0; si < all.length; si++) {
        var key = day.dateKey + "|" + all[si].time;
        if (!(key in checked)) checked[key] = day.auto.indexOf(all[si]) !== -1;
        if (!(key in ot)) ot[key] = shareIsOTTime(all[si].time);
      }
    }
    return {checked:checked, ot:ot};
  };

  // D/cloud: the times shown for a day = its auto set PLUS anything added via +AM/+PM
  // (shareRevealed), deduped by clock and sorted. Revealed entries are plain time
  // strings; auto entries carry their abs already.
  const shareShownTimes = function(day) {
    var map = {}; var i;
    for (i = 0; i < day.auto.length; i++) { map[day.auto[i].abs] = {time:day.auto[i].time, abs:day.auto[i].abs}; }
    var rev = shareRevealed[day.dateKey] || [];
    for (i = 0; i < rev.length; i++) { var ab = timeToAbsMinutes(rev[i]); map[ab] = {time:rev[i], abs:ab}; }
    var arr = Object.keys(map).map(function(k){ return map[k]; });
    arr.sort(function(a, b){ return a.abs - b.abs; });
    return arr;
  };
  // D: a shown time is "off-calendar" (custom) if it isn't one of the day's real open
  // slots (auto or extra). Those get a small marker and are offered even though no slot
  // exists yet.
  const shareIsCustomTime = function(day, time) {
    var i;
    for (i = 0; i < day.auto.length; i++) { if (day.auto[i].time === time) return false; }
    for (i = 0; i < day.extra.length; i++) { if (day.extra[i].time === time) return false; }
    return true;
  };
  // D: the next grid time to hand over in a direction — steps ALL_TIMES past the current
  // block, skipping booked slots, already-shown times, and (on today) times already past.
  // Returns {time,abs} or null when there's nothing left that way.
  const shareGridCandidate = function(day, shownTimes, dir) {
    if (!shownTimes.length) return null;
    var i, minA = null, maxA = null;
    for (i = 0; i < shownTimes.length; i++) { var a = shownTimes[i].abs; if (minA === null || a < minA) minA = a; if (maxA === null || a > maxA) maxA = a; }
    var shownSet = {}; for (i = 0; i < shownTimes.length; i++) { shownSet[shownTimes[i].abs] = true; }
    var bookedSet = {}; var bk = day.bookedAbs || []; for (i = 0; i < bk.length; i++) { bookedSet[bk[i]] = true; }
    var best = null;
    for (i = 0; i < ALL_TIMES.length; i++) {
      var t = ALL_TIMES[i]; var ab = timeToAbsMinutes(t);
      if (ab < (day.minGridAbs || 0)) continue;
      if (bookedSet[ab]) continue;
      if (shownSet[ab]) continue;
      if (dir === "earlier") { if (ab < minA && (best === null || ab > best.abs)) best = {time:t, abs:ab}; }
      else { if (ab > maxA && (best === null || ab < best.abs)) best = {time:t, abs:ab}; }
    }
    return best;
  };
  // Cloud (Q3): restore a saved DAYS bundle but reconcile it with the LIVE calendar —
  // keep every still-valid saved pick, DROP anything that got booked/removed, and give
  // brand-new openings the normal auto treatment. Only days in the current window are
  // reconciled; saved keys for other dates are preserved untouched.
  const reconcileShareDays = function(days, base) {
    var checked = {...(base.checked || {})};
    var ot = {...(base.ot || {})};
    var revealed = base.revealed || {};
    var dayInfo = {};
    days.forEach(function(day){
      var openTimes = day.auto.concat(day.extra);
      var validSet = {}; var autoSet = {};
      day.auto.forEach(function(o){ autoSet[o.time] = true; });
      openTimes.forEach(function(o){ validSet[o.time] = true; });
      (revealed[day.dateKey] || []).forEach(function(tm){ validSet[tm] = true; });
      dayInfo[day.dateKey] = {validSet:validSet, autoSet:autoSet, openTimes:openTimes};
    });
    Object.keys(checked).forEach(function(key){
      var idx = key.indexOf("|"); if (idx < 0) return;
      var dk = key.slice(0, idx); var tm = key.slice(idx + 1);
      var info = dayInfo[dk]; if (!info) return; // date not in window -> leave alone
      if (!info.validSet[tm]) { delete checked[key]; delete ot[key]; }
    });
    days.forEach(function(day){
      var info = dayInfo[day.dateKey];
      info.openTimes.forEach(function(o){
        var key = day.dateKey + "|" + o.time;
        if (!(key in checked)) { checked[key] = !!info.autoSet[o.time]; ot[key] = shareIsOTTime(o.time); }
      });
    });
    return {checked:checked, ot:ot};
  };
  // Cloud: bundle the current DAYS state for saving, and compare against what's saved so
  // the Save button can show "Saved ✓" when nothing's changed since the last save.
  const shareDaysBundle = function() {
    return {checked:shareChecked, ot:shareOT, earlierLater:shareEarlierLater, dayMemory:shareDayMemory, revealed:shareRevealed};
  };
  const commitShareSave = function() {
    setShareSavedState(shareDaysBundle());
    setShareDirty(false);
  };

  const openShareSheet = function() {
    var days = computeShareDays(7);
    // Cloud: restore the whole DAYS area from the last SAVE and reconcile it against the
    // live calendar. base comes from shareSavedState; if only the legacy shareSavedChecks
    // exists (data saved before this version), migrate it into the new shape. With no
    // saved state at all, fall back to fresh smart defaults.
    var base = null;
    if (shareSavedState) { base = shareSavedState; }
    else if (shareSavedChecks) { base = {checked:shareSavedChecks, ot:{}, earlierLater:{}, dayMemory:{}, revealed:{}}; }
    var startChecked, startOT, startEL, startMem, startRevealed;
    if (base) {
      var recon = reconcileShareDays(days, base);
      startChecked = recon.checked; startOT = recon.ot;
      startEL = base.earlierLater || {};
      startMem = base.dayMemory || {};
      startRevealed = base.revealed || {};
    } else {
      var seeded = seedShareMaps(days, {}, {});
      startChecked = seeded.checked; startOT = seeded.ot;
      startEL = {}; startMem = {}; startRevealed = {};
    }
    setShareChecked(startChecked);
    setShareOT(startOT);
    setShareEarlierLater(startEL);
    setShareDayMemory(startMem);
    setShareRevealed(startRevealed);
    setShareWindow(7);
    setShareExpanded({});
    // MENU resets every open (never persisted): draft choice -> first draft, OT surcharge
    // -> default, padding (global + per-row) -> off, hide-OT -> off.
    setShareActiveDraftId((shareDrafts[0] && shareDrafts[0].id) || "full");
    setShareAmt("22");
    setShareShift("none");
    setShareTimeShift({});
    setShareHideOT(false);
    setShareReveal({});
    setShareCopied(false);
    setShareDraftEditing(false);
    setShareDraftDeleteConfirm(false);
    setShareSaveConfirm(false);
    setShowHistory(false);
    // Restored state IS the saved baseline (reconciliation is automatic, not a user edit),
    // so we open "clean": no unsaved changes, button reads "Saved ✓", close won't nag.
    setShareDirty(false);
    // #3: seed undo history with the restored starting state (index 0). Snapshot fields
    // must line up with applyShareSnapshot / the recorder effect below.
    shareHistRef.current = [{checked:startChecked, ot:startOT, timeShift:{}, shift:"none", revealed:startRevealed, earlierLater:startEL, dayMemory:startMem, hideOT:false}];
    shareHistIdxRef.current = 0;
    setShareHistVer(function(v){ return v + 1; });
    setShareActionSeq(0);
    setShareModal(true);
  };

  // #3: apply a snapshot to every tracked piece of state at once (undo/redo). Does NOT
  // bump shareActionSeq, so it never records itself as a new history step.
  const applyShareSnapshot = function(snap) {
    setShareChecked(snap.checked);
    setShareOT(snap.ot);
    setShareTimeShift(snap.timeShift);
    setShareShift(snap.shift);
    setShareRevealed(snap.revealed || {});
    setShareEarlierLater(snap.earlierLater || {});
    setShareDayMemory(snap.dayMemory || {});
    setShareHideOT(snap.hideOT);
    setShareCopied(false);
  };
  // #3: mark a user action. setShareCopied(false) here covers #1 (any real change flips
  // the copy button back to "Copy to clipboard") for every action that routes through here.
  const bumpShareAction = function() {
    setShareActionSeq(function(n){ return n + 1; });
    setShareCopied(false);
  };
  const shareUndo = function() {
    if (shareHistIdxRef.current <= 0) return;
    shareHistIdxRef.current = shareHistIdxRef.current - 1;
    applyShareSnapshot(shareHistRef.current[shareHistIdxRef.current]);
    setShareHistVer(function(v){ return v + 1; });
  };
  const shareRedo = function() {
    if (shareHistIdxRef.current >= shareHistRef.current.length - 1) return;
    shareHistIdxRef.current = shareHistIdxRef.current + 1;
    applyShareSnapshot(shareHistRef.current[shareHistIdxRef.current]);
    setShareHistVer(function(v){ return v + 1; });
  };

  const loadMoreShareDays = function() {
    var prevWindow = shareWindow;
    var next = prevWindow + 1; // #2: one calendar day at a time
    var days = computeShareDays(next);
    // A: guarantee the newly-added day(s) come in with their auto times CHECKED and
    // extras unchecked. Only touch days at offset >= the old window; everything already
    // on screen keeps whatever state it had.
    setShareChecked(function(prevC){
      var n = {...prevC}; var di, si;
      for (di = 0; di < days.length; di++) {
        var day = days[di];
        if (day.offset < prevWindow) continue;
        var all = day.auto.concat(day.extra);
        for (si = 0; si < all.length; si++) { var k = day.dateKey + "|" + all[si].time; n[k] = day.auto.indexOf(all[si]) !== -1; }
      }
      return n;
    });
    setShareOT(function(prevO){
      var n = {...prevO}; var di, si;
      for (di = 0; di < days.length; di++) {
        var day = days[di];
        if (day.offset < prevWindow) continue;
        var all = day.auto.concat(day.extra);
        for (si = 0; si < all.length; si++) { var k = day.dateKey + "|" + all[si].time; if (!(k in n)) n[k] = shareIsOTTime(all[si].time); }
      }
      return n;
    });
    setShareWindow(next);
    bumpShareAction();
  };

  // E: drop the last day currently shown (steps the window back). Keeps at least one day.
  const removeLastShareDay = function() {
    var days = computeShareDays(shareWindow);
    if (days.length <= 1) return;
    var lastOffset = days[days.length - 1].offset;
    var newWindow = lastOffset < 1 ? 1 : lastOffset; // scan 0..lastOffset-1, dropping the last shown day
    setShareWindow(newWindow);
    bumpShareAction();
  };

  const toggleShareChecked = function(key) { setShareChecked(function(p){ var n={...p}; n[key] = !n[key]; return n; }); setShareDirty(true); bumpShareAction(); };
  const toggleShareOT = function(key) { setShareOT(function(p){ var n={...p}; n[key] = !n[key]; return n; }); setShareDirty(true); bumpShareAction(); };
  const toggleShareTimeShiftMode = function(key, mode) { setShareTimeShift(function(p){ var n={...p}; n[key] = (p[key] === mode ? "none" : mode); return n; }); bumpShareAction(); };
  // #5: one-off hide-all-OT toggle for the current copy only.
  const toggleShareHideOT = function() { setShareHideOT(function(v){ return !v; }); bumpShareAction(); };
  // D: +AM/+PM add the next grid time earlier/later than the current block (stepping
  // ALL_TIMES past the real openings when needed). Added time arrives CHECKED and, if
  // before the OT cutoff, pre-flagged OT. This is a DAYS change (persists on Save).
  const revealShareAdd = function(day, dir) {
    var shown = shareShownTimes(day);
    var cand = shareGridCandidate(day, shown, dir);
    if (!cand) return;
    var dk = day.dateKey; var key = dk + "|" + cand.time;
    setShareRevealed(function(p){ var n={...p}; var arr = (n[dk] || []).slice(); arr.push(cand.time); n[dk] = arr; return n; });
    setShareChecked(function(p){ var n={...p}; n[key] = true; return n; });
    setShareOT(function(p){ var n={...p}; if (!(key in n)) n[key] = shareIsOTTime(cand.time); return n; });
    setShareDirty(true);
    bumpShareAction();
  };
  const revealShareEarlier = function(day) { revealShareAdd(day, "earlier"); };
  const revealShareLater = function(day) { revealShareAdd(day, "later"); };
  // #10: toggle the per-day "possibly earlier" / "possibly later" message tag.
  const toggleShareEL = function(dk, which) {
    setShareEarlierLater(function(p){
      var n={...p}; var cur=n[dk]||{earlier:false, later:false};
      if (which === "earlier") n[dk]={earlier:!cur.earlier, later:cur.later};
      else n[dk]={earlier:cur.earlier, later:!cur.later};
      return n;
    });
    setShareDirty(true);
    bumpShareAction();
  };
  // Whole-day check toggle — affects ONLY the smart-picked ("auto") times for that
  // day, never the tucked-away extras. "all" -> every auto row is checked, "none"
  // -> none are, "some" -> a mix (tapping from "some" checks the rest).
  const shareDayAllState = function(day) {
    if (!day.auto.length) return "none";
    var anyChecked = false, anyUnchecked = false, i;
    for (i = 0; i < day.auto.length; i++) {
      var k = day.dateKey + "|" + day.auto[i].time;
      if (shareChecked[k]) anyChecked = true; else anyUnchecked = true;
    }
    if (anyChecked && !anyUnchecked) return "all";
    if (anyChecked && anyUnchecked) return "some";
    return "none";
  };
  const toggleShareDayAll = function(day) {
    var goTo = shareDayAllState(day) === "all" ? false : true;
    setShareChecked(function(p){
      var n = {...p}; var i;
      for (i = 0; i < day.auto.length; i++) { n[day.dateKey + "|" + day.auto[i].time] = goTo; }
      return n;
    });
    setShareDirty(true);
  };
  const toggleShareExpand = function(dk) { setShareExpanded(function(p){ var n={...p}; n[dk] = !n[dk]; return n; }); };
  const setShareShiftMode = function(mode) { setShareShift(function(p){ return p === mode ? "none" : mode; }); bumpShareAction(); };

  // #6: a day's box is "active" (checked) whenever ANY of its currently-shown times is
  // checked. shownTimes = the auto rows plus whatever extras have been revealed via +AM/+PM.
  const shareDayActive = function(dk, shownTimes) {
    var i;
    for (i = 0; i < shownTimes.length; i++) { if (shareChecked[dk + "|" + shownTimes[i].time]) return true; }
    return false;
  };
  // #6: tap the day box. If the day is active -> remember exactly which shown times are
  // checked, then clear the whole day. If inactive -> restore that remembered set if we
  // have one; otherwise (never toggled this day) fall back to its normal default = the
  // auto rows.
  const toggleShareDayCheck = function(day, shownTimes) {
    var dk = day.dateKey;
    var i;
    if (shareDayActive(dk, shownTimes)) {
      var mem = [];
      for (i = 0; i < shownTimes.length; i++) { var tt = shownTimes[i].time; if (shareChecked[dk + "|" + tt]) mem.push(tt); }
      setShareDayMemory(function(p){ var n={...p}; n[dk] = mem; return n; });
      setShareChecked(function(p){ var n={...p}; var j; for (j = 0; j < shownTimes.length; j++) { n[dk + "|" + shownTimes[j].time] = false; } return n; });
    } else {
      var hasMem = Object.prototype.hasOwnProperty.call(shareDayMemory, dk);
      var memSet = {};
      if (hasMem) { var m = shareDayMemory[dk] || []; for (i = 0; i < m.length; i++) { memSet[m[i]] = true; } }
      var autoSet = {};
      for (i = 0; i < day.auto.length; i++) { autoSet[day.auto[i].time] = true; }
      setShareChecked(function(p){
        var n={...p}; var j;
        for (j = 0; j < shownTimes.length; j++) {
          var t2 = shownTimes[j].time;
          n[dk + "|" + t2] = hasMem ? !!memSet[t2] : !!autoSet[t2];
        }
        return n;
      });
    }
    setShareDirty(true);
    bumpShareAction();
  };

  // Live re-seed while the sheet is open: if the schedule changes and brand-new open
  // times appear (e.g. Granger fills 9:06 and 9:28 opens up), seed those new rows with
  // the SAME smart rules as a fresh open — gap-between-bookings / one-before-first /
  // one-after-last get auto-checked, everything else stays an unchecked "extra." Rows
  // the user already set are preserved (we only fill keys that are MISSING). Returns the
  // same map object when nothing new appeared, so React bails out and there's no loop.
  // This does NOT set shareDirty — a system-seeded time isn't a manual selection change.
  useEffect(function() {
    if (!shareModal) return;
    var days = computeShareDays(shareWindow);
    setShareChecked(function(prevC) {
      var next = {...prevC}; var added = false; var di, si;
      for (di = 0; di < days.length; di++) {
        var day = days[di]; var all = day.auto.concat(day.extra);
        for (si = 0; si < all.length; si++) {
          var k = day.dateKey + "|" + all[si].time;
          if (!(k in prevC)) { next[k] = day.auto.indexOf(all[si]) !== -1; added = true; }
        }
      }
      return added ? next : prevC;
    });
    setShareOT(function(prevO) {
      var next = {...prevO}; var added = false; var di, si;
      for (di = 0; di < days.length; di++) {
        var day = days[di]; var all = day.auto.concat(day.extra);
        for (si = 0; si < all.length; si++) {
          var k = day.dateKey + "|" + all[si].time;
          if (!(k in prevO)) { next[k] = shareIsOTTime(all[si].time); added = true; }
        }
      }
      return added ? next : prevO;
    });
  }, [shareModal, shareWindow, schedules]);

  // #3: record an undo step whenever a user action bumps shareActionSeq. Runs AFTER the
  // action's state updates have committed, so the snapshot reflects the post-action
  // selection. seq===0 is the initial/reset state (already seeded in history), so skip it.
  useEffect(function() {
    if (!shareModal) return;
    if (shareActionSeq === 0) return;
    var snap = {checked:shareChecked, ot:shareOT, timeShift:shareTimeShift, shift:shareShift, revealed:shareRevealed, earlierLater:shareEarlierLater, dayMemory:shareDayMemory, hideOT:shareHideOT};
    var h = shareHistRef.current.slice(0, shareHistIdxRef.current + 1);
    h.push(snap);
    shareHistRef.current = h;
    shareHistIdxRef.current = h.length - 1;
    setShareHistVer(function(v){ return v + 1; });
  }, [shareActionSeq]);

  // ── Share openings: intro drafts ─────────────────────────────────────────────
  const activeShareDraft = function() {
    var i;
    for (i = 0; i < shareDrafts.length; i++) { if (shareDrafts[i].id === shareActiveDraftId) return shareDrafts[i]; }
    return shareDrafts[0] || {id:"full", name:"Full", text:""};
  };
  const selectShareDraft = function(id) { setShareActiveDraftId(id); setShareDraftEditing(false); setShareDraftDeleteConfirm(false); setShareCopied(false); };
  const startEditShareDraft = function() { setShareDraftEditText(activeShareDraft().text); setShareDraftEditFooter(activeShareDraft().footer || ""); setShareDraftEditing(true); setShareDraftDeleteConfirm(false); };
  const cancelEditShareDraft = function() { setShareDraftEditing(false); setShareDraftDeleteConfirm(false); };
  const saveShareDraftEdit = function() {
    var id = shareActiveDraftId;
    setShareDrafts(function(p){ return p.map(function(d){ return d.id === id ? {...d, text:shareDraftEditText, footer:shareDraftEditFooter} : d; }); });
    setShareDraftEditing(false);
    setShareDraftDeleteConfirm(false);
    setShareCopied(false);
  };
  const renameShareDraft = function(id, name) {
    setShareDrafts(function(p){ return p.map(function(d){ return d.id === id ? {...d, name:name} : d; }); });
  };
  const addShareDraft = function() {
    var id = "draft" + Date.now();
    var fresh = {id:id, name:"New draft", text:"Hello! Here are my current openings:", footer:""};
    setShareDrafts(function(p){ return p.concat([fresh]); });
    setShareActiveDraftId(id);
    setShareDraftEditText(fresh.text);
    setShareDraftEditFooter("");
    setShareDraftEditing(true);
    setShareDraftDeleteConfirm(false);
  };
  const deleteShareDraft = function(id) {
    if (shareDrafts.length <= 1) return; // always keep at least one draft
    var remaining = shareDrafts.filter(function(d){ return d.id !== id; });
    setShareDrafts(remaining);
    if (shareActiveDraftId === id) { setShareActiveDraftId(remaining[0].id); }
    setShareDraftEditing(false);
    setShareDraftDeleteConfirm(false);
  };

  // Assemble the customer-ready message from the current checks / OT flags / amount /
  // padding. Header first (with the live OT amount), then one line per offered day.
  const buildShareText = function() {
    var amt = shareAmtClean();
    var draftText = activeShareDraft().text.split("{{OT_AMT}}").join(amt);
    var header = draftText + "\n\n";
    var footerRaw = (activeShareDraft().footer || "").split("{{OT_AMT}}").join(amt);
    var days = computeShareDays(shareWindow);
    var lines = [];
    var di, si;
    for (di = 0; di < days.length; di++) {
      var day = days[di];
      var all = shareShownTimes(day); // auto + added (real or off-calendar), sorted
      var parts = [];
      for (si = 0; si < all.length; si++) {
        var time = all[si].time;
        var key = day.dateKey + "|" + time;
        if (!shareChecked[key]) continue;
        if (shareHideOT && shareOT[key]) continue; // #5: this copy hides OT times outright
        var label = shareFmtTimeMsg(time, effectiveShareDelta(key)); // #8: no AM/PM
        if (shareOT[key]) label = label + " (OT: +$" + amt + ")";
        parts.push(label);
      }
      if (parts.length) {
        // #10: append the per-day "possibly earlier / later" tag if set.
        var elFlag = shareEarlierLater[day.dateKey] || {earlier:false, later:false};
        var elSuffix = "";
        if (elFlag.earlier && elFlag.later) elSuffix = " (and possibly earlier and later, if needed)";
        else if (elFlag.earlier) elSuffix = " (and possibly earlier, if needed)";
        else if (elFlag.later) elSuffix = " (and possibly later, if needed)";
        lines.push(shareDayLabelMsg(day.offset, day.dateKey) + ": " + parts.join(", ") + elSuffix); // #8: short day label
      }
    }
    var body = lines.length ? (header + lines.join("\n\n")) : (header + "(no openings selected)");
    // #4: message ending, separated from the times by a blank line.
    if (footerRaw && footerRaw.length) body = body + "\n\n" + footerRaw;
    return body;
  };

  // Copy synchronously inside the tap gesture (iOS PWA requirement): try the async
  // Clipboard API first, fall back to a hidden textarea + execCommand. No awaits run
  // before the write, so Safari keeps the user-gesture permission.
  const copyPlainText = function(text) {
    var ok = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text); ok = true; } } catch (e) { ok = false; }
    if (!ok) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text; ta.setAttribute("readonly", "");
        ta.style.position = "absolute"; ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        if (ta.setSelectionRange) ta.setSelectionRange(0, text.length);
        document.execCommand("copy");
        document.body.removeChild(ta);
        ok = true;
      } catch (e2) { ok = false; }
    }
    return ok;
  };

  const doShareCopy = function() {
    var text = buildShareText();
    copyPlainText(text);
    setShareCopied(true);
    if (shareCopyTimer.current) clearTimeout(shareCopyTimer.current);
    shareCopyTimer.current = setTimeout(function(){ setShareCopied(false); }, 2200);
  };

  // Quick messages: copy the BODY (not the title), toggle a brief "Copied ✓" on that row.
  const copyQuickMsg = function(id, body) {
    copyPlainText(body || "");
    if (quickMsgCopyTimer.current) { clearTimeout(quickMsgCopyTimer.current); quickMsgCopyTimer.current = null; }
    // v76: close the popup the INSTANT the body is copied — no "Copied ✓" dwell — so
    // Granger drops straight back into Messages ready to paste. Applies to iPhone and
    // iPad alike. The prior v67 700ms confirm-then-close is kept commented as a
    // one-line revert lever:
    //   setQuickMsgCopiedId(id);
    //   quickMsgCopyTimer.current = setTimeout(function(){ setQuickMsgCopiedId(null); setQuickMsgModal(false); setQuickMsgOpenId(null); }, 700);
    setQuickMsgCopiedId(null);
    setQuickMsgModal(false);
    setQuickMsgOpenId(null);
  };
  const updateQuickMsg = function(id, field, value) {
    setQuickMsgs(function(prev){
      return prev.map(function(m){ if(m.id!==id) return m; var n={...m}; n[field]=value; return n; });
    });
  };
  const addQuickMsg = function() {
    var nid = "qm" + Date.now() + Math.floor(Math.random()*1000);
    setQuickMsgs(function(prev){ return prev.concat([{id:nid,title:"",body:""}]); });
    setQuickMsgOpenId(nid);
  };
  const removeQuickMsg = function(id) {
    setQuickMsgs(function(prev){ return prev.filter(function(m){ return m.id!==id; }); });
    setQuickMsgOpenId(function(cur){ return cur===id?null:cur; });
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
        // Model B: a time may hold more than one person. Look for a row at this time
        // already under THIS name (extend it), else an EMPTY row at this time (fill it),
        // else add a NEW row alongside whoever's there — SHARE instead of skipping.
        var myIdx = daySlots.findIndex(function(s){ return s.time===t.time && s.name && s.name.toLowerCase()===nm.toLowerCase(); });
        if (myIdx>=0) {
          if (allowOverwriteSame) {
            daySlots[myIdx] = {...daySlots[myIdx],name:nm,price:t.price,recurWeeks:t.recurWeeks,done:false,groupId:dgid};
          }
        } else {
          var emptyIdx = daySlots.findIndex(function(s){ return s.time===t.time && !s.name; });
          if (emptyIdx>=0) {
            daySlots[emptyIdx] = {...daySlots[emptyIdx],name:nm,price:t.price,recurWeeks:t.recurWeeks,done:false,groupId:dgid};
          } else {
            daySlots.push({time:t.time,name:nm,price:t.price,recurWeeks:t.recurWeeks,done:false,groupId:dgid});
          }
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
        // Model B: a time may hold more than one person. Look for a row at this time
        // already under THIS name (extend it), else an EMPTY row at this time (fill it),
        // else add a NEW row alongside whoever's there — SHARE instead of skipping.
        var myIdx = daySlots.findIndex(function(s){ return s.time===t.time && s.name && s.name.toLowerCase()===nm.toLowerCase(); });
        if (myIdx>=0) {
          if (allowOverwriteSame) {
            daySlots[myIdx] = {...daySlots[myIdx],name:nm,price:t.price,recurWeeks:t.recurWeeks,done:false,groupId:dgid};
          }
        } else {
          var emptyIdx = daySlots.findIndex(function(s){ return s.time===t.time && !s.name; });
          if (emptyIdx>=0) {
            daySlots[emptyIdx] = {...daySlots[emptyIdx],name:nm,price:t.price,recurWeeks:t.recurWeeks,done:false,groupId:dgid};
          } else {
            daySlots.push({time:t.time,name:nm,price:t.price,recurWeeks:t.recurWeeks,done:false,groupId:dgid});
          }
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
        // Model B: a time may hold more than one person. Look for a row at this time
        // already under THIS name (extend it), else an EMPTY row at this time (fill it),
        // else add a NEW row alongside whoever's there — SHARE instead of skipping.
        var myIdx = daySlots.findIndex(function(s){ return s.time===t.time && s.name && s.name.toLowerCase()===nm.toLowerCase(); });
        if (myIdx>=0) {
          if (allowOverwriteSame) {
            daySlots[myIdx] = {...daySlots[myIdx],name:nm,price:t.price,recurWeeks:t.recurWeeks,isException:false,done:false,groupId:dgid};
          }
        } else {
          var emptyIdx = daySlots.findIndex(function(s){ return s.time===t.time && !s.name; });
          if (emptyIdx>=0) {
            daySlots[emptyIdx] = {...daySlots[emptyIdx],name:nm,price:t.price,recurWeeks:t.recurWeeks,isException:false,done:false,groupId:dgid};
          } else {
            daySlots.push({time:t.time,name:nm,price:t.price,recurWeeks:t.recurWeeks,isException:false,done:false,groupId:dgid});
          }
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

  // Header search: the earliest day from today forward where this name has a real
  // (non-blocked) appointment, or "" if they have nothing on the books.
  const findNextBookingDate = function(name) {
    var lower = (name || "").toLowerCase();
    if (!lower) return "";
    var today = toDateKey(new Date());
    var sch = schedulesRef.current || {};
    var keys = Object.keys(sch).filter(function(k){ return k >= today; }).sort();
    for (var i = 0; i < keys.length; i++) {
      var slots = sch[keys[i]] || [];
      for (var j = 0; j < slots.length; j++) {
        var s = slots[j];
        if (s && !s.blocked && s.name && s.name.toLowerCase() === lower) return keys[i];
      }
    }
    return "";
  };

  // v77: does this person already have a LATER appointment on the books? Scans every
  // saved day strictly AFTER the given day for a real (non-blocked) booking under the
  // same name, short-circuiting on the first hit. Date keys are ISO strings, so the
  // ">" comparison is a plain lexical date compare (same trick findNextBookingDate uses).
  // Used only to draw the "next is booked" arrow on NON-recurring rows — recurring people
  // keep their ↺ + weeks and never consult this.
  const hasLaterBooking = function(name, afterDateKey) {
    var lower = (name || "").toLowerCase();
    if (!lower) return false;
    var sch = schedulesRef.current || {};
    var keys = Object.keys(sch);
    for (var i = 0; i < keys.length; i++) {
      if (!(keys[i] > afterDateKey)) continue;
      var slots = sch[keys[i]] || [];
      for (var j = 0; j < slots.length; j++) {
        var s = slots[j];
        if (s && !s.blocked && s.name && s.name.toLowerCase() === lower) return true;
      }
    }
    return false;
  };

  // The names offered in the search dropdown: saved clients whose name contains the
  // typed text, A–Z, capped at 8. Empty text shows nothing (no giant dump).
  const searchMatches = function(text) {
    var q = (text || "").trim().toLowerCase();
    if (!q) return [];
    // #6: the roster is now phone-only, but search should still jump to ANYONE booked
    // on The List, number or not — so pool phoned profiles with everyone on the schedule.
    var seen = {}; var out = [];
    var push = function(nm){
      if (!nm) return;
      var lo = nm.toLowerCase();
      if (seen[lo]) return;
      seen[lo] = true; out.push(nm);
    };
    var consider = function(nm){
      if (!nm) return;
      if (nm.toLowerCase().indexOf(q) === -1) return;
      push(nm);
    };
    var mem = clientMemoryRef.current || [];
    mem.forEach(function(c){ if (c && c.name && c.phone && String(c.phone).trim()) consider(c.name); });
    var sch = schedulesRef.current || {};
    Object.keys(sch).forEach(function(k){
      var day = sch[k] || [];
      for (var i=0;i<day.length;i++) { var s=day[i]; if (s && s.name && !s.blocked) consider(s.name); }
    });
    // v77: PHONE SEARCH. When the typed query contains digits, also match saved clients
    // by their phone number (digits-only, substring) regardless of name — so Granger can
    // type a number into the header search and land on that client. Phone-only hits are
    // pushed straight through (they bypass the name-substring gate) and de-duped by push.
    var qDigits = q.replace(/[^0-9]/g, "");
    if (qDigits.length > 0) {
      mem.forEach(function(c){
        if (!c || !c.name || !c.phone) return;
        var pd = String(c.phone).replace(/[^0-9]/g, "");
        if (pd.length > 0 && pd.indexOf(qDigits) >= 0) push(c.name);
      });
    }
    out.sort(function(a,b){ return a.toLowerCase().localeCompare(b.toLowerCase()); });
    return out.slice(0, 8);
  };

  // v99: PICK A NAME FROM SEARCH, GET THE PERSON — not a place on the calendar.
  // Search used to fling the grid to their next appointment and flash it green.
  // Now it opens their client profile, which is the one screen that holds every
  // upcoming booking, the phone number, the recurring rule and the rename/delete
  // controls — and every booking listed there is still tappable to jump. The green
  // searchHit flash machinery is left fully intact (searchHit state, the 8-second
  // timer, the cell tint) because the jump-and-flash is still used elsewhere; this
  // just stops being the thing search does. Any stale highlight is cleared on open.
  //
  // Revert lever — the pre-v99 jump-to-next-appointment body, unchanged:
  //   var dk = findNextBookingDate(name);
  //   if (dk) {
  //     jumpToDate(dk);
  //     setSearchHit({name:(name||"").toLowerCase(), dateKey:dk});
  //     searchHitTimer.current = setTimeout(function(){ setSearchHit(null); }, 8000);
  //   } else {
  //     setSearchHit(null);
  //     openClientProfile(name);
  //     showBanner({type:"info",msg:"No upcoming appointments for "+name,time:null,dateKey:null});
  //   }
  const runClientSearch = function(name) {
    setSearchText(""); setSearchOpen(false); setSearchExpanded(false);
    if (searchHitTimer.current) { clearTimeout(searchHitTimer.current); searchHitTimer.current = null; }
    setSearchHit(null);
    openClientProfile(name);
    if (!findNextBookingDate(name)) {
      showBanner({type:"info",msg:"No upcoming appointments for "+name,time:null,dateKey:null});
    }
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
    setRenamingProfile(false); setRenameValue("");
    setClientDeleteMsg(""); setClientDeleteConfirm(false);
    // v98: the client-level note rides along with the phone. Revert lever — the pre-v98
    // seed, with no note field: setClientProfile({name,recurWeeks,usualTime,bookings,phone:getClientPhone(name)});
    setClientProfile({name,recurWeeks,usualTime,bookings,phone:getClientPhone(name),note:getClientNote(name)});
  };

  // #9: optional phone number kept on the client-memory entry so the profile can offer
  // Message / Call. iOS PWAs can't read Contacts, so this is a manual field. Keyed by
  // lower-cased name (imperfect when two clients share a first name — note for later).
  const getClientPhone = function(name) {
    var lower=(name||"").toLowerCase();
    var e=clientMemoryRef.current.find(function(c){ return c.name && c.name.toLowerCase()===lower; });
    return (e && e.phone) ? e.phone : "";
  };
  // #6: the price to show beside a name in the header search dropdown. Prefer the
  // client's saved default price on their memory card; if that's blank (e.g. a
  // schedule-only name with no phoned profile), fall back to the price on their
  // nearest UPCOMING booking, then their most recent PAST one. Read-only — this only
  // looks things up, it never writes anything.
  const getClientPrice = function(name) {
    var lower=(name||"").toLowerCase();
    if (!lower) return "";
    var e=clientMemoryRef.current.find(function(c){ return c.name && c.name.toLowerCase()===lower; });
    if (e && e.price && String(e.price).trim()) return e.price;
    var sch=schedulesRef.current || {};
    var keys=Object.keys(sch).sort();
    var today=toDateKey(new Date());
    var future=""; var past="";
    for (var ki=0; ki<keys.length; ki++) {
      var day=sch[keys[ki]] || [];
      for (var si=0; si<day.length; si++) {
        var s=day[si];
        if (s && s.name && s.name.toLowerCase()===lower && !s.blocked && s.price && String(s.price).trim()) {
          if (keys[ki] >= today) { if (!future) future=s.price; }
          else { past=s.price; }
        }
      }
    }
    return future || past || "";
  };
  const setClientPhone = function(name, phone) {
    if (!name) return;
    setClientMemory(function(mem) {
      var i=mem.findIndex(function(c){ return c.name && c.name.toLowerCase()===name.toLowerCase(); });
      if (i>=0) { var u=[...mem]; u[i]={...u[i],phone:phone}; return u; }
      return [...mem,{name:name,price:"",phone:phone}];
    });
  };

  // v98 THE NOTE NOW BELONGS TO THE PERSON, NOT THE APPOINTMENT. Until now the only
  // note was slot.note — one note per client PER DATE PER TIME — reached by a pencil on
  // the schedule row. That made "Cliff's note" a thing that existed six times over and
  // could disagree with itself. A note is a fact about a man, not about a Tuesday, so it
  // moves onto the client-memory card beside his phone and price, and the only door to it
  // is his profile. New field, so everybody starts with a blank one.
  // NOTE: the old slot.note data is deliberately LEFT WHERE IT IS, untouched and inert.
  // It is not migrated and it is not wiped, because line 49 (isEmptyPlaceholder) treats a
  // note as a REASON TO KEEP AN EMPTY ROW — blanking notes in the data would strip that
  // protection and let migrateSchedules prune rows out from under the grid. Hiding the
  // door costs nothing; emptying the room costs rows.
  const getClientNote = function(name) {
    var lower=(name||"").toLowerCase();
    if (!lower) return "";
    var e=clientMemoryRef.current.find(function(c){ return c.name && c.name.toLowerCase()===lower; });
    return (e && e.note) ? e.note : "";
  };
  const setClientNote = function(name, note) {
    if (!name) return;
    setClientMemory(function(mem) {
      var i=mem.findIndex(function(c){ return c.name && c.name.toLowerCase()===name.toLowerCase(); });
      if (i>=0) { var u=[...mem]; u[i]={...u[i],note:note}; return u; }
      return [...mem,{name:name,price:"",phone:"",note:note}];
    });
  };

  // Rename a client EVERYWHERE in one deliberate move, from inside their profile.
  // This only swaps the name STRING on slots that already exist — it never touches
  // the recurring engine, so every recurring date, phone number, and price stays put.
  // Identity here is the (lower-cased) name, so we match case-insensitively. If the
  // new name already belongs to another saved client, we fold the two together rather
  // than leave a duplicate. Not added to the undo stack on purpose: undo only restores
  // schedules, and a half-restore (slots reverted but the saved-client list not) would
  // be worse than no undo. A rename is a deliberate, explicit action.
  const renameClient = function(oldName, newName) {
    var nn = (newName||"").trim();
    if (!nn || !oldName) return;
    if (nn === oldName) return;
    var oldLower = oldName.toLowerCase();
    var newLower = nn.toLowerCase();
    setSchedules(function(prev){
      var next = {};
      Object.keys(prev).forEach(function(dk){
        next[dk] = prev[dk].map(function(s){
          if (s.name && s.name.toLowerCase()===oldLower) { return {...s, name:nn}; }
          return s;
        });
      });
      return next;
    });
    setClientMemory(function(mem){
      var oldIdx = mem.findIndex(function(c){ return c.name && c.name.toLowerCase()===oldLower; });
      if (oldIdx<0) return mem;
      var newIdx = mem.findIndex(function(c){ return c.name && c.name.toLowerCase()===newLower; });
      var u = mem.slice();
      if (newIdx>=0 && newIdx!==oldIdx) {
        var merged = {...u[newIdx]};
        if (!merged.phone && u[oldIdx].phone) merged.phone = u[oldIdx].phone;
        if (!merged.price && u[oldIdx].price) merged.price = u[oldIdx].price;
        merged.name = nn;
        u[newIdx] = merged;
        u.splice(oldIdx,1);
        return u;
      }
      u[oldIdx] = {...u[oldIdx], name:nn};
      return u;
    });
    setClientProfile(function(p){ return p?{...p, name:nn}:p; });
    addHistoryEntry({type:"edited", name:nn, prevName:oldName, time:"", dateKey:null, bannerType:"edited"});
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

  // #13 accounting helpers. A day's record is {cash,venmo,applepay,square,services,hours},
  // all plain numbers (default 0). Take-home auto-sums the four payment methods. Empty
  // records are dropped from the map so month view only flags days with real data.
  var acctNum = function(v){ var n=parseFloat(v); return isNaN(n)?0:n; };
  var acctFor = function(dateKey){ var r=accounting[dateKey]; return r?r:{cash:0,venmo:0,applepay:0,square:0,services:0,hours:0}; };
  var acctTakehome = function(r){ return acctNum(r.cash)+acctNum(r.venmo)+acctNum(r.applepay)+acctNum(r.square); };
  var acctHasData = function(dateKey){ var r=accounting[dateKey]; if(!r) return false; return acctTakehome(r)>0||acctNum(r.services)>0||acctNum(r.hours)>0; };
  var acctCommit = function(dateKey, rec){
    setAccounting(function(prev){
      var empty = !acctNum(rec.cash)&&!acctNum(rec.venmo)&&!acctNum(rec.applepay)&&!acctNum(rec.square)&&!acctNum(rec.services)&&!acctNum(rec.hours);
      var out = {...prev};
      if (empty) { delete out[dateKey]; } else { out[dateKey] = {cash:acctNum(rec.cash),venmo:acctNum(rec.venmo),applepay:acctNum(rec.applepay),square:acctNum(rec.square),services:acctNum(rec.services),hours:acctNum(rec.hours)}; }
      return out;
    });
  };
  var acctSetField = function(dateKey, field, value){ var r={...acctFor(dateKey)}; r[field]=acctNum(value); acctCommit(dateKey,r); };
  var acctAddTo = function(dateKey, method, amount){ var amt=acctNum(amount); if(!amt) return; var r={...acctFor(dateKey)}; r[method]=acctNum(r[method])+amt; acctCommit(dateKey,r); };
  // End-of-day estimate from the day's appointments, used to PRE-FILL the popup. With
  // allNames set it counts EVERY booked name (not just checked-off) — that mode drives the
  // live day-of estimate in the acctModal render, which recomputes each open and is never
  // persisted until you type your own number (see the acctModal render + the open effect).
  // Services: each counted person with no price counts as 1 (base rate); everyone with a
  // price has their prices summed and divided by 44 (so a $66 = 1.5 services). Hours:
  // first person's start to (last person's start + one 23-min appointment), plus 30 min
  // for arriving early / closing up. Returns clean strings; any:false means no done
  // appointments yet, so nothing is pre-filled. Only used when a field is still blank.
  var ACCT_APPT_MIN = 23;   // one appointment's length (matches the default slot spacing)
  var ACCT_PAD_MIN = 30;    // 15 min early + 15 min to close up
  var acctFmt = function(n){ var r=Math.round(n*100)/100; if(r===Math.round(r)) return String(Math.round(r)); return String(r); };
  var acctAutoEstimate = function(dateKey, allNames){
    var slots = getSlots(dateKey);
    var noPrice=0, customSum=0, firstAbs=null, lastAbs=null, any=false, i, s, p, ab;
    for (i=0;i<slots.length;i++){
      s = slots[i];
      if (!s || !s.name || (!allNames && !s.done)) continue;
      any = true;
      p = acctNum(s.price);
      if (p>0) customSum += p; else noPrice += 1;
      ab = timeToAbsMinutes(s.time);
      if (firstAbs===null || ab<firstAbs) firstAbs = ab;
      if (lastAbs===null || ab>lastAbs) lastAbs = ab;
    }
    if (!any) return {any:false, services:"", hours:""};
    var services = noPrice + customSum/44;
    var workMin = (lastAbs + ACCT_APPT_MIN) - firstAbs + ACCT_PAD_MIN;
    if (workMin < 0) workMin = 0;
    return {any:true, services:acctFmt(services), hours:acctFmt(workMin/60)};
  };
  // Sum take-home / services / hours across every day of a given month (Date object).
  var acctMonthTotals = function(monthDate){
    var y=monthDate.getFullYear(); var m=monthDate.getMonth();
    var th=0, sv=0, hr=0;
    Object.keys(accounting).forEach(function(dk){
      var d=parseDateKey(dk); if(!d) return;
      if(d.getFullYear()===y && d.getMonth()===m){ var r=accounting[dk]; th+=acctTakehome(r); sv+=acctNum(r.services); hr+=acctNum(r.hours); }
    });
    return {takehome:th, services:sv, hours:hr};
  };

  // Day notes can be a legacy plain string OR a {text,kind} object (kind: "personal"
  // | "business", for blue/gold coloring). These accessors read both shapes so no
  // data migration is needed; the writer always stores the new object shape.
  var setDayNoteRecord = function(dk, text, kind){
    setDayNotes(function(prev){
      var n={...prev}; var t=(text||"").trim();
      if(t){ n[dk] = kind ? {text:t,kind:kind} : {text:t}; } else { delete n[dk]; }
      return n;
    });
  };
  // --- v63 recurring day-notes -------------------------------------------------
  // Repeat rules live INSIDE the already-synced dayNotes object under a reserved
  // key prefix, so nothing new is added to the Firebase payload. A dayNotes value
  // can be:
  //   "text"                              legacy plain note
  //   {text,kind}                         one-off note (also used as a per-day override)
  //   {skip:true}                         per-day suppression of a repeat ("this day only" delete)
  //   {sinceKey,rpt,text,kind}  (under "@rpt:" key)  a repeat RULE
  // A rule fires on the same weekday every rpt weeks from sinceKey (rpt 1 = weekly).
  // A concrete note on a date always wins over a rule for that date.
  var DN_RULE_PREFIX = "@rpt:";
  var dnIsRuleKey = function(k){ return k.indexOf(DN_RULE_PREFIX)===0; };
  var dnRuleMatches = function(rule, dk){
    if(!rule || !rule.text || !rule.rpt || !rule.sinceKey) return false;
    var dkD=parseDateKey(dk); var sD=parseDateKey(rule.sinceKey);
    if(dkD.getDay()!==sD.getDay()) return false;
    var diff=dkD.getTime()-sD.getTime(); if(diff<0) return false;
    var days=Math.round(diff/86400000); if(days%7!==0) return false;
    return (days/7)%rule.rpt===0;
  };
  // --- v88 per-line day notes --------------------------------------------------
  // The whole-note kind (personal/business) is retired for day notes; each LINE now
  // carries its own repeat setting instead of one setting governing the whole note.
  // New storage shapes, all riding the same synced dayNotes map (updateDoc replaces the
  // field wholesale, so nested deletes propagate across devices — the v85 write-path):
  //   dayNotes[dk]           = [ {id,t}, ... ]        per-date ONE-OFF lines (r=0 implied)
  //   dayNotes["@lrpt"]      = [ {id,since,r,n,t} ]   central RECURRING line rules
  //         r=1 weeks-family every n weeks (n=1 weekly); r=2 months-family every n months
  //   dayNotes["@dnskip:"+dk]= [ ruleId, ... ]        occurrences suppressed on that date only
  // Legacy shapes still READ untouched: "text" | {text,kind} | {skip:true} | "@rpt:" rules.
  // A legacy note keeps its kind color until that day is edited & saved (then it converts
  // to the new shapes and drops the color, per "no more business/personal notation").
  var LRPT_KEY = "@lrpt";
  var DNSKIP_PREFIX = "@dnskip:";
  // v92 PER-OCCURRENCE TEXT OVERRIDE. One more reserved key on the same synced dayNotes
  // map, same trick as "@dnskip:" — a plain object keyed by rule id:
  //   dayNotes["@dnovr:"+dk] = { ruleId: "wording just for this date", ... }
  // A rule that has an override on dk renders the override text on dk ONLY; every other
  // occurrence keeps the series wording. Retype the line back to the series wording (or
  // choose "All repeats") and the override is cleared. Ids are stable, including for the
  // legacy "@rpt:" rules, which now keep their key as their bucket id when they migrate —
  // so a skip or an override written against a legacy rule survives the migration.
  var DNOVR_PREFIX = "@dnovr:";
  var dnNewId = function(){ return "ln_"+Date.now().toString(36)+"_"+Math.floor(Math.random()*1000000).toString(36); };
  // Does recurring line/rule R (anchored at R.since) fire on date dk? r=1 weeks, r=2 months.
  var dnLineMatches = function(R, dk){
    if(!R || !R.t || !R.r || !R.n || !R.since) return false;
    var dD=parseDateKey(dk); var sD=parseDateKey(R.since);
    if(dD.getTime()<sD.getTime()) return false;
    if(R.r===1){
      if(dD.getDay()!==sD.getDay()) return false;
      var days=Math.round((dD.getTime()-sD.getTime())/86400000);
      if(days%7!==0) return false;
      return ((days/7)%R.n)===0;
    }
    if(R.r===2){
      if(dD.getDate()!==sD.getDate()) return false; // same calendar date; months without that day never match
      var months=(dD.getFullYear()-sD.getFullYear())*12+(dD.getMonth()-sD.getMonth());
      if(months<0) return false;
      return (months%R.n)===0;
    }
    return false;
  };
  // Resolve the ordered lines shown on date dk. Each: {id,t,r,n,since,src,kind}
  //   src: "once" (new per-date array) | "rule" (central @lrpt) | "legacy" | "legacyrule"
  // v91: the body now takes the dayNotes MAP as an argument instead of closing over the
  // live dayNotes state. Identical logic — but this lets the new arrow-key day paging
  // (which saves the open day and immediately re-prefills the NEXT day) resolve against
  // the just-built map instead of the stale pre-commit state. resolveDayLines(dk) below is
  // the unchanged public accessor; every existing caller keeps working untouched.
  var resolveDayLinesIn = function(map, dk){
    var out=[];
    var val=map[dk];
    if(Array.isArray(val)){
      for(var i=0;i<val.length;i++){ var L=val[i]; if(L&&L.t){ out.push({id:L.id||dnNewId(),t:L.t,r:0,n:0,since:dk,src:"once",kind:null}); } }
    } else if(typeof val==="string"){
      if(val) out.push({id:"legacy:"+dk,t:val,r:0,n:0,since:dk,src:"legacy",kind:null});
    } else if(val && typeof val==="object" && !val.skip && val.text){
      out.push({id:"legacy:"+dk,t:val.text,r:0,n:0,since:dk,src:"legacy",kind:val.kind||null});
    }
    var skips=(map[DNSKIP_PREFIX+dk] && map[DNSKIP_PREFIX+dk].length)?map[DNSKIP_PREFIX+dk]:[];
    // v92: per-date wording overrides for recurring lines (see DNOVR_PREFIX above).
    var ovr=(map[DNOVR_PREFIX+dk] && typeof map[DNOVR_PREFIX+dk]==="object")?map[DNOVR_PREFIX+dk]:{};
    var rules=(map[LRPT_KEY] && map[LRPT_KEY].length)?map[LRPT_KEY]:[];
    for(var j=0;j<rules.length;j++){
      var R=rules[j];
      // v92: t is the override text when this date has one; bt is always the series text,
      // so an untouched overridden line can be saved without rewriting the series.
      // Revert lever — the v91 push (no override, no bt):
      // if(dnLineMatches(R,dk) && skips.indexOf(R.id)<0){ out.push({id:R.id,t:R.t,r:R.r,n:R.n,since:R.since,src:"rule",kind:null}); }
      if(dnLineMatches(R,dk) && skips.indexOf(R.id)<0){
        var hasO=(ovr[R.id]!==undefined && ovr[R.id]!==null && String(ovr[R.id]).trim()!=="");
        out.push({id:R.id,t:(hasO?String(ovr[R.id]):R.t),bt:R.t,ovr:hasO,r:R.r,n:R.n,since:R.since,src:"rule",kind:null});
      }
    }
    var keys=Object.keys(map);
    for(var m=0;m<keys.length;m++){
      var k=keys[m]; if(!dnIsRuleKey(k)) continue;
      var rule=map[k];
      // v92 LEGACY SKIP-MIGRATION: legacy "@rpt:" rules now honor "@dnskip:" exactly like
      // the new bucket rules do, so "Skip just this day" works on repeats created before
      // the per-line system existed. They also honor per-date overrides. Revert lever:
      // if(dnRuleMatches(rule,dk)){ out.push({id:k,t:rule.text,r:1,n:rule.rpt,since:rule.sinceKey,src:"legacyrule",kind:rule.kind||null}); }
      if(dnRuleMatches(rule,dk) && skips.indexOf(k)<0){
        var hasOL=(ovr[k]!==undefined && ovr[k]!==null && String(ovr[k]).trim()!=="");
        out.push({id:k,t:(hasOL?String(ovr[k]):rule.text),bt:rule.text,ovr:hasOL,r:1,n:rule.rpt,since:rule.sinceKey,src:"legacyrule",kind:rule.kind||null});
      }
    }
    return out;
  };
  var resolveDayLines = function(dk){ return resolveDayLinesIn(dayNotes, dk); };
  // v90 ORIGINAL resolveDayLines (revert lever — the same body, reading dayNotes directly.
  // Restore by deleting resolveDayLinesIn + the one-line wrapper above and un-commenting):
  // var resolveDayLines = function(dk){
  //   var out=[];
  //   var val=dayNotes[dk];
  //   if(Array.isArray(val)){
  //     for(var i=0;i<val.length;i++){ var L=val[i]; if(L&&L.t){ out.push({id:L.id||dnNewId(),t:L.t,r:0,n:0,since:dk,src:"once",kind:null}); } }
  //   } else if(typeof val==="string"){
  //     if(val) out.push({id:"legacy:"+dk,t:val,r:0,n:0,since:dk,src:"legacy",kind:null});
  //   } else if(val && typeof val==="object" && !val.skip && val.text){
  //     out.push({id:"legacy:"+dk,t:val.text,r:0,n:0,since:dk,src:"legacy",kind:val.kind||null});
  //   }
  //   var skips=(dayNotes[DNSKIP_PREFIX+dk] && dayNotes[DNSKIP_PREFIX+dk].length)?dayNotes[DNSKIP_PREFIX+dk]:[];
  //   var rules=(dayNotes[LRPT_KEY] && dayNotes[LRPT_KEY].length)?dayNotes[LRPT_KEY]:[];
  //   for(var j=0;j<rules.length;j++){
  //     var R=rules[j];
  //     if(dnLineMatches(R,dk) && skips.indexOf(R.id)<0){ out.push({id:R.id,t:R.t,r:R.r,n:R.n,since:R.since,src:"rule",kind:null}); }
  //   }
  //   var keys=Object.keys(dayNotes);
  //   for(var m=0;m<keys.length;m++){
  //     var k=keys[m]; if(!dnIsRuleKey(k)) continue;
  //     var rule=dayNotes[k];
  //     if(dnRuleMatches(rule,dk)){ out.push({id:k,t:rule.text,r:1,n:rule.rpt,since:rule.sinceKey,src:"legacyrule",kind:rule.kind||null}); }
  //   }
  //   return out;
  // };
  // resolveDayNote — kept as the back-compat accessor the indicators/export use. Now a
  // thin wrapper over resolveDayLines: .text/.kind/.repeating still drive the ✎ pencil and
  // ↻ superscript exactly as before; .lines is the new per-line array the modal edits.
  var resolveDayNote = function(dk){
    var lines=resolveDayLines(dk);
    var texts=[]; var kind=null; var repeating=false; var rpt=0;
    for(var i=0;i<lines.length;i++){
      var L=lines[i];
      if(L.t) texts.push(L.t);
      if(kind===null && L.kind) kind=L.kind;         // legacy color only; new lines carry no kind
      if(L.r>0){ repeating=true; if(rpt===0) rpt=L.n; }
    }
    return {text:texts.join("; "),kind:kind,repeating:repeating,rpt:rpt,ruleKey:null,lines:lines};
  };
  // v63 ORIGINAL resolveDayNote (revert lever — restore this and remove the wrapper +
  // v88 block above to return to whole-note kind + single repeat rule):
  // var resolveDayNote = function(dk){
  //   var rec = dayNotes[dk];
  //   if (rec && typeof rec==="object" && rec.skip) return {text:"",kind:null,repeating:false,rpt:0,ruleKey:null};
  //   if (rec){
  //     if (typeof rec==="string") return {text:rec,kind:null,repeating:false,rpt:0,ruleKey:null};
  //     if (rec.text) return {text:rec.text,kind:rec.kind||null,repeating:false,rpt:0,ruleKey:null};
  //   }
  //   var keys=Object.keys(dayNotes);
  //   for(var i=0;i<keys.length;i++){
  //     var k=keys[i]; if(!dnIsRuleKey(k)) continue;
  //     var rule=dayNotes[k];
  //     if(dnRuleMatches(rule,dk)) return {text:rule.text,kind:rule.kind||null,repeating:true,rpt:rule.rpt,ruleKey:k};
  //   }
  //   return {text:"",kind:null,repeating:false,rpt:0,ruleKey:null};
  // };
  var dayNoteText = function(dk){ return resolveDayNote(dk).text; };
  var dayNoteKind = function(dk){ var r=resolveDayNote(dk); return r.text?r.kind:null; };
  var dayNoteRepeating = function(dk){ return resolveDayNote(dk).repeating; };
  var dayNoteRepeatN = function(dk){ return resolveDayNote(dk).rpt; };
  // Writers.
  var dnSetRepeat = function(dk, text, kind, nWk){
    setDayNotes(function(prev){
      var n={...prev}; var t=(text||"").trim();
      if(!t){ return n; }
      delete n[dk]; // let the rule govern the start day
      n[DN_RULE_PREFIX+dk] = kind ? {sinceKey:dk,rpt:nWk,text:t,kind:kind} : {sinceKey:dk,rpt:nWk,text:t};
      return n;
    });
  };
  var dnEditRule = function(ruleKey, text, kind, nWk){
    setDayNotes(function(prev){
      var n={...prev}; var t=(text||"").trim(); var old=prev[ruleKey];
      if(!old){ return n; }
      if(!t){ delete n[ruleKey]; return n; }
      var since=old.sinceKey;
      n[ruleKey] = kind ? {sinceKey:since,rpt:nWk,text:t,kind:kind} : {sinceKey:since,rpt:nWk,text:t};
      return n;
    });
  };
  var dnDeleteRule = function(ruleKey){
    setDayNotes(function(prev){ var n={...prev}; delete n[ruleKey]; return n; });
  };
  var dnWriteToday = function(dk, text, kind, hasGovRepeat){
    setDayNotes(function(prev){
      var n={...prev}; var t=(text||"").trim();
      if(t){ n[dk] = kind ? {text:t,kind:kind} : {text:t}; }
      else { if(hasGovRepeat){ n[dk]={skip:true}; } else { delete n[dk]; } }
      return n;
    });
  };
  // --- v88 per-line writers ----------------------------------------------------
  // Build the editable rows for the modal from the resolved lines on dk (always leaves
  // at least one blank row to type into). Rows carry {id,t,r,n,since,src}.
  // v91: same split as resolveDayLines — an ...In(map, dk) form plus the original accessor.
  var dnPrefillRowsIn = function(map, dk){
    var lines=resolveDayLinesIn(map, dk);
    // v92: rows now also carry ovr (this date shows a one-off wording) and bt (the series
    // wording behind it), so the editor can tell an overridden line from a plain one and a
    // Save can leave the series alone. Revert lever — the v91 mapping:
    // var rows=lines.map(function(L){ return {id:L.id,t:L.t,r:L.r,n:L.n||1,since:L.since,src:L.src}; });
    var rows=lines.map(function(L){ return {id:L.id,t:L.t,r:L.r,n:L.n||1,since:L.since,src:L.src,ovr:!!L.ovr,bt:(L.bt!==undefined?L.bt:L.t)}; });
    if(rows.length===0){ rows.push({id:dnNewId(),t:"",r:0,n:1,since:dk,src:"new"}); }
    return rows;
  };
  var dnPrefillRows = function(dk){ return dnPrefillRowsIn(dayNotes, dk); };
  // v90 ORIGINAL dnPrefillRows (revert lever):
  // var dnPrefillRows = function(dk){
  //   var lines=resolveDayLines(dk);
  //   var rows=lines.map(function(L){ return {id:L.id,t:L.t,r:L.r,n:L.n||1,since:L.since,src:L.src}; });
  //   if(rows.length===0){ rows.push({id:dnNewId(),t:"",r:0,n:1,since:dk,src:"new"}); }
  //   return rows;
  // };
  // Local (state-only) row edits inside the open modal — no dayNotes write until Save.
  var dnRowUpdate = function(id, patch){
    setNoteLines(function(rows){ return rows.map(function(r){ return r.id===id ? {...r,...patch} : r; }); });
  };
  var dnRowAddAfter = function(id){
    setNoteLines(function(rows){
      var dk=(noteModal&&noteModal.dayKey)||""; var fresh={id:dnNewId(),t:"",r:0,n:1,since:dk,src:"new"};
      var out=[]; var added=false;
      for(var i=0;i<rows.length;i++){ out.push(rows[i]); if(rows[i].id===id){ out.push(fresh); added=true; } }
      if(!added) out.push(fresh);
      return out;
    });
  };
  var dnRowDelete = function(id){
    setNoteLines(function(rows){
      var dk=(noteModal&&noteModal.dayKey)||"";
      var out=rows.filter(function(r){ return r.id!==id; });
      if(out.length===0) out.push({id:dnNewId(),t:"",r:0,n:1,since:dk,src:"new"});
      return out;
    });
  };
  // Suppress a single recurring occurrence on this date only (bucket rules only). Writes
  // the id into "@dnskip:"+dk and drops the row from the open modal immediately.
  var dnSkipOccurrence = function(dk, ruleId){
    setDayNotes(function(prev){
      var n={...prev}; var key=DNSKIP_PREFIX+dk;
      var cur=(n[key] && n[key].length)? n[key].slice() : [];
      if(cur.indexOf(ruleId)<0) cur.push(ruleId);
      n[key]=cur; return n;
    });
    setNoteLines(function(rows){ return rows.filter(function(r){ return r.id!==ruleId; }); });
    // v92 CRITICAL: also drop it from the AT-OPEN snapshot. dnBuildLinesMap treats "was shown
    // when the modal opened, and is gone now" as delete-from-all-occurrences — so after a skip,
    // the very next Save (and since v91 a backdrop tap IS a save) wiped the entire series
    // instead of suppressing one date. Removing it from noteOrigLines makes the reconciler see
    // a rule it simply wasn't shown, which it leaves completely alone. The "@dnskip:" write
    // above is then the only thing that happened. Revert lever: delete the setNoteOrigLines
    // call below to return to the v91 behavior.
    setNoteOrigLines(function(rows){ return rows.filter(function(r){ return r.id!==ruleId; }); });
    setNoteRepeatPopup(null);
  };
  // Save the day-note modal. Rebuilds this date's one-off array from the r===0 rows and
  // reconciles the central recurring bucket ("@lrpt") against the rows: existing bucket
  // rules referenced by a row are updated (edit = all occurrences), bucket rules that were
  // shown on this day at open but are now gone are dropped (delete = all occurrences),
  // and bucket rules for OTHER dates are left untouched. Lines newly made recurring are
  // appended (since = this date). Legacy "@rpt:" rules shown on this day migrate into the
  // bucket on save (their old key is removed) so nothing double-counts.
  // v91: the reconciler is now a PURE builder — (previous dayNotes map, date, the editor's
  // rows, the rows shown at open) -> the next dayNotes map. dnCommitLines below is the
  // unchanged Save path (it just feeds this into setDayNotes). The arrow-key day paging
  // added in v91 calls the builder directly against dayNotesRef.current so it can save the
  // open day AND prefill the next day from the resulting map in the same keystroke.
  // v92: a fifth argument, wordScope ("all" | "today" | null). It only matters when a
  // RECURRING line's wording was edited in the box: "all" rewrites the series (the old
  // behavior, and it clears any override this date was carrying), "today" leaves the series
  // alone and records the new wording as a one-off override for this date only. null means
  // no recurring line's wording changed, so it never comes up. dnCommitLines below asks
  // (This day only / All repeats) before it picks one.
  var dnBuildLinesMap = function(prevMap, dk, editorLines, origLines, wordScope){
    var rows=[];
    var lines=editorLines||[]; var noteOrigLines=origLines||[];
    for(var a=0;a<lines.length;a++){
      var rw=lines[a]; var tt=(rw.t||"").trim(); if(!tt) continue;
      rows.push({id:rw.id,t:tt,r:rw.r||0,n:rw.n||1,since:rw.since||dk,src:rw.src||"new"});
    }
    // What each recurring row LOOKED LIKE when the modal opened (override text included).
    var origById={}; for(var z=0;z<noteOrigLines.length;z++){ origById[noteOrigLines[z].id]=noteOrigLines[z]; }
    var ovrSet={}; var ovrDel={}; var ovrTouched=false;
    return (function(prev){
      var n={...prev};
      // 1) one-off lines for THIS date = the r===0 rows.
      var once=[];
      for(var i=0;i<rows.length;i++){ if(rows[i].r===0){ var kid=(rows[i].src==="once"||rows[i].src==="new")?rows[i].id:dnNewId(); once.push({id:kid,t:rows[i].t}); } }
      if(once.length){ n[dk]=once; } else { delete n[dk]; }
      // 2) reconcile the recurring bucket.
      var bucket=(n[LRPT_KEY] && n[LRPT_KEY].length)? n[LRPT_KEY].slice() : [];
      // current rule-rows (already in the bucket) by id, and the ids shown at open.
      var curRuleById={}; for(var b=0;b<rows.length;b++){ if(rows[b].r>0 && rows[b].src==="rule"){ curRuleById[rows[b].id]=rows[b]; } }
      var shownRuleIds={}; for(var c=0;c<noteOrigLines.length;c++){ if(noteOrigLines[c].src==="rule"){ shownRuleIds[noteOrigLines[c].id]=true; } }
      var nextBucket=[];
      for(var d=0;d<bucket.length;d++){
        var B=bucket[d];
        if(curRuleById[B.id]){
          var rr=curRuleById[B.id];
          // v92: B.t is ALWAYS the series wording. rr.t is what's in the box right now — which,
          // on a date carrying an override, started out as the override text, not the series
          // text. So compare against what was SHOWN at open, not against the series.
          //   untouched      -> series text stays, any override on this date stays
          //   changed + all  -> series text becomes the new wording, this date's override cleared
          //   changed + today-> series text untouched, the new wording stored as this date's override
          // Revert lever — the v91 line (always rewrote the series):
          // nextBucket.push({id:B.id,since:B.since,r:rr.r,n:rr.n,t:rr.t});
          var oB=origById[B.id];
          var shownB=(oB && oB.t!==undefined)?oB.t:rr.t;
          var textB=B.t;
          if(rr.t!==shownB){
            if(wordScope==="today"){ ovrSet[B.id]=rr.t; ovrTouched=true; }
            else { textB=rr.t; ovrDel[B.id]=true; ovrTouched=true; }
          }
          nextBucket.push({id:B.id,since:B.since,r:rr.r,n:rr.n,t:textB});
        }
        else if(shownRuleIds[B.id]){ /* was shown on this day, now removed -> drop from all */ }
        else { nextBucket.push(B); }
      }
      // 3) rows newly made recurring (brand-new, or a once/legacy line switched to repeat).
      for(var e=0;e<rows.length;e++){
        var R2=rows[e];
        if(R2.r>0 && (R2.src==="new"||R2.src==="once"||R2.src==="legacy")){ nextBucket.push({id:dnNewId(),since:dk,r:R2.r,n:R2.n,t:R2.t}); }
      }
      // 4) legacy "@rpt:" rows shown at open: migrate the kept ones into the bucket and
      //    remove every shown legacy key (kept -> moved here; removed -> gone).
      var curLegacyById={}; for(var f=0;f<rows.length;f++){ if(rows[f].r>0 && rows[f].src==="legacyrule"){ curLegacyById[rows[f].id]=rows[f]; } }
      for(var g=0;g<noteOrigLines.length;g++){
        var oid=noteOrigLines[g]; if(oid.src!=="legacyrule") continue;
        if(curLegacyById[oid.id]){
          // v92 LEGACY SKIP-MIGRATION, part two. The migrated rule now KEEPS ITS OWN ID (the
          // old "@rpt:"+date key) instead of being handed a fresh one. Any "@dnskip:" or
          // "@dnovr:" entry already written against that legacy rule therefore keeps pointing
          // at it after the migration — otherwise a skipped day would quietly come back the
          // first time any day of that series was saved. The top-level "@rpt:" key is still
          // deleted below, so nothing double-counts (the legacy scan only reads top-level
          // keys). Revert lever — the v91 line (a fresh id, orphaning the skips):
          // var lr=curLegacyById[oid.id]; nextBucket.push({id:dnNewId(),since:oid.since||dk,r:lr.r,n:lr.n,t:lr.t});
          var lr=curLegacyById[oid.id];
          var seriesL=(prev[oid.id] && prev[oid.id].text) ? prev[oid.id].text : lr.t;
          var shownL=(oid.t!==undefined)?oid.t:lr.t;
          var textL=seriesL;
          if(lr.t!==shownL){
            if(wordScope==="today"){ ovrSet[oid.id]=lr.t; ovrTouched=true; }
            else { textL=lr.t; ovrDel[oid.id]=true; ovrTouched=true; }
          }
          nextBucket.push({id:oid.id,since:oid.since||dk,r:lr.r,n:lr.n,t:textL});
        }
        delete n[oid.id]; // oid.id is the "@rpt:"+date key
      }
      if(nextBucket.length){ n[LRPT_KEY]=nextBucket; } else { delete n[LRPT_KEY]; }
      // 5) v92: write this date's override map, if the save touched it.
      if(ovrTouched){
        var okey=DNOVR_PREFIX+dk;
        var obase=(n[okey] && typeof n[okey]==="object") ? {...n[okey]} : {};
        var oks=Object.keys(ovrSet); var oi;
        for(oi=0;oi<oks.length;oi++){ obase[oks[oi]]=ovrSet[oks[oi]]; }
        var odk2=Object.keys(ovrDel);
        for(oi=0;oi<odk2.length;oi++){ delete obase[odk2[oi]]; }
        if(Object.keys(obase).length){ n[okey]=obase; } else { delete n[okey]; }
      }
      return n;
    })(prevMap);
  };
  // Save the open day-note modal: build the next map from the live rows, write it, close.
  // v92: which RECURRING rows had their wording retyped in the box? (Blanking a line is a
  // delete, not a wording change — the reconciler already treats an emptied recurring row as
  // "remove from all occurrences" — so an emptied row is deliberately not counted here.)
  var dnWordChanges = function(rows, orig){
    var o={}; var i;
    for(i=0;i<(orig||[]).length;i++){ var ol=orig[i]; if(ol.src==="rule"||ol.src==="legacyrule"){ o[ol.id]=ol; } }
    var out=[];
    for(i=0;i<(rows||[]).length;i++){
      var r=rows[i];
      if(!(r.r>0)) continue;
      if(r.src!=="rule" && r.src!=="legacyrule") continue;
      var base=o[r.id]; if(!base) continue;
      var nt=(r.t||"").trim(); if(nt==="") continue;
      if(nt!==(base.t||"").trim()) out.push(r.id);
    }
    return out;
  };
  // v92: dnCommitLines takes an optional wording scope. Called with nothing (Enter, backdrop
  // tap, the ✎ closing) it first checks whether a repeating line's wording was retyped — if so
  // it raises the This-day-only / All-repeats prompt instead of guessing, and the real save
  // happens when that prompt is answered (dnApplyScope routes back in here with the scope).
  // Nothing else about Save changed: one-off lines, new repeats, deletes and the standby list
  // all still write straight through. Revert lever — the v91 body:
  // var dnCommitLines = function(){ var nm=noteModal; if(!nm||!nm.isDay) return;
  //   var dk=nm.dayKey; var lns=noteLines; var orig=noteOrigLines;
  //   setDayNotes(function(prev){ return dnBuildLinesMap(prev, dk, lns, orig); }); dnCloseNoteModal(); };
  var dnCommitLines = function(scopeArg){
    var nm=noteModal; if(!nm||!nm.isDay) return;
    var ws=(scopeArg==="all"||scopeArg==="today")?scopeArg:null;
    var dk=nm.dayKey; var lns=noteLines; var orig=noteOrigLines;
    if(!ws && dnWordChanges(lns,orig).length>0){ setNoteScopeAsk("lines"); return; }
    setDayNotes(function(prev){ return dnBuildLinesMap(prev, dk, lns, orig, ws); });
    dnCloseNoteModal();
  };
  // --- v83 per-day STANDBY / cancellation waitlist -----------------------------
  // Manual line-item list of clients wanting an opening on a given day. Entries are
  // added by hand (no auto-capture — the removal/recurring paths are untouched).
  // Stored INSIDE the already-synced dayNotes object under a reserved "@wl:" key
  // prefix — the same container trick the repeat rules use ("@rpt:") — so the
  // Firebase payload shape is unchanged and it syncs across devices for free.
  // resolveDayNote ignores every key that isn't an "@rpt:" rule, so these entries
  // never collide with the day-note text. Non-repeating by design (date-specific).
  // A dayNotes value under "@wl:"+dk is an array of {id, name}.
  var WL_PREFIX = "@wl:";
  var wlGet = function(dk){
    var rec = dayNotes[WL_PREFIX+dk];
    return (rec && rec.length) ? rec : [];
  };
  var wlAdd = function(dk, name){
    var t = (name||"").trim(); if(!t) return;
    setDayNotes(function(prev){
      var n={...prev}; var key=WL_PREFIX+dk;
      var cur = (n[key] && n[key].length) ? n[key].slice() : [];
      cur.push({id:Date.now()+Math.random(), name:t});
      n[key]=cur; return n;
    });
  };
  var wlRemove = function(dk, id){
    setDayNotes(function(prev){
      var n={...prev}; var key=WL_PREFIX+dk;
      var cur = (n[key] && n[key].length) ? n[key] : [];
      var next = cur.filter(function(it){ return it.id!==id; });
      if(next.length){ n[key]=next; } else { delete n[key]; }
      return n;
    });
  };
  // v98 TAPPING A STANDBY NAME NOW ARMS THE SLOT, NOT A SECOND POPUP. It used to call
  // openClientProfile, which opened the profile UNDERNEATH the day-note modal — invisible,
  // and worse than useless. What the name actually means when you tap it is "put this man
  // in a hole on this day", so that is now what it does: the day note is SAVED (same commit
  // the backdrop-tap performs — nothing typed is lost), the popup closes, the schedule jumps
  // to the standby day, and tap-to-place arms with his name. Tap an open slot and he lands.
  // If a REPEATING note line's wording was retyped, we hold exactly like popupShiftDay does
  // and raise the this-date/whole-series question first — answer it, then tap the name again.
  // wlFrom rides on placingClient so that placeClientInSlot can strike him off the standby
  // list the moment he's placed (Granger's call: placed means no longer waiting).
  // Revert lever — the v83 behavior was simply: openClientProfile(it.name);
  var wlStartPlacement = function(dk, it){
    if (!dk || !it || !it.name) return;
    if (dnWordChanges(noteLines, noteOrigLines).length>0){ setNoteScopeAsk("lines"); return; }
    setDayNotes(function(prev){ return dnBuildLinesMap(prev, dk, noteLines, noteOrigLines, null); });
    dnCloseNoteModal();
    setPlacingClient({
      name:it.name, price:getClientPrice(it.name)||"",
      originalDateKey:null, originalIdx:null,
      recurBook:false,
      wlFrom:{dayKey:dk, id:it.id}
    });
    setBaseDate(parseDateKey(dk)); setView(isPhone?"Day":"3-Day");
  };
  // v98: the standby list can reach Messages directly, exactly like a schedule row does —
  // same getClientPhone lookup, same sms: hand-off. No number on file gives the grey icon,
  // which opens the same add-a-number prompt the schedule row uses. NOTE: phoneModal shipped
  // at z-index 1100 — BELOW the day-note popup's 1200 — so it would have opened behind the
  // popup exactly as the client profile did. It is lifted to 1300 (see its render block).
  var wlPhone = function(name){ return getClientPhone(name).replace(/[^0-9+]/g,""); };
  var dnCloseNoteModal = function(){ setNoteModal(null); setNoteDraft(""); setNoteKind(null); setNoteRepeat(0); setNoteWasRepeat(false); setNoteScopeAsk(null); setWlInput(""); setNoteLines([]); setNoteOrigLines([]); setNoteRepeatPopup(null); };
  // v91: DISMISS NOW SAVES. Tapping the backdrop (or pressing Enter on an empty row) used
  // to throw the edit away; now it commits, for BOTH note flavors. Undo (Cmd/Ctrl-Z) is the
  // only way back — which is the point: nothing typed can be lost by a stray tap. The old
  // Save-note / Cancel buttons are gone from the footer (kept there as commented levers).
  var dnSaveAndClose = function(){
    var nm=noteModal; if(!nm){ dnCloseNoteModal(); return; }
    if(nm.isDay){ dnCommitLines(); return; }
    var slots=[...getSlots(nm.dateKey)]; var s=slots[nm.idx];
    if(s){ slots[nm.idx]={...s,note:noteDraft.trim(),noteKind:null}; setSlots(nm.dateKey,slots); }
    dnCloseNoteModal();
  };
  // v91: the accounting popup's commitAll lives inside its render closure; this is the same
  // write, hoisted so the arrow-key day paging can flush the typed drafts before it moves.
  var acctCommitDraft = function(dk){
    var base=accountingRef.current&&accountingRef.current[dk]?accountingRef.current[dk]:{cash:0,venmo:0,applepay:0,square:0,services:0,hours:0};
    var r={...base};
    ["cash","venmo","applepay","square","services","hours"].forEach(function(k){ if(acctAdd[k]!==undefined){ r[k]=acctNum(acctAdd[k]); } });
    acctCommit(dk,r);
  };
  // v91: ARROW-KEY DAY PAGING WHILE A POPUP IS OPEN. With the day-note or accounting popup
  // up and the caret NOT sitting in a field, ← / → step the popup itself to the previous /
  // next day (Shift = a week), exactly like paging the schedule. The open day is SAVED on
  // the way out, the schedule behind the popup follows along, and the popup re-prefills from
  // the freshly-built map (not the pre-commit state), so a repeat you just created shows up
  // immediately on the day it lands on. Month view doesn't drag its base date along, since
  // there ← / → mean whole months.
  var popupShiftDay = function(delta){
    if (noteModal && noteModal.isDay){
      // v92: paging saves the open day on the way out. If a REPEATING line's wording was
      // retyped, saving means choosing between this-date-only and the whole series — so the
      // page is held and the prompt is raised instead of guessing. Answer it and page again.
      if (dnWordChanges(noteLines, noteOrigLines).length>0){ setNoteScopeAsk("lines"); return; }
      var odk=noteModal.dayKey;
      var nextMap=dnBuildLinesMap(dayNotesRef.current, odk, noteLines, noteOrigLines, null);
      setDayNotes(nextMap);
      var ndk=toDateKey(addDays(parseDateKey(odk), delta));
      var rws=dnPrefillRowsIn(nextMap, ndk);
      setNoteLines(rws); setNoteOrigLines(rws.slice());
      setNoteRepeatPopup(null); setNoteScopeAsk(null); setWlInput("");
      setNoteModal({dayKey:ndk,isDay:true,name:friendlyDateLong(ndk)});
      if (view!=="Month") { setBaseDate(function(p){ return addDays(p, delta); }); }
      return;
    }
    if (acctModal){
      var adk=acctModal.dateKey;
      acctCommitDraft(adk);
      var ndk2=toDateKey(addDays(parseDateKey(adk), delta));
      setAcctAdd({});
      setAcctModal({dateKey:ndk2});
      if (view!=="Month") { setBaseDate(function(p){ return addDays(p, delta); }); }
    }
  };
  // Commit from the day-note modal. If the note is already a repeat, defer to the
  // "this day / all repeats" prompt; otherwise write straight through.
  var dnCommitDayNote = function(action){
    var nm=noteModal; if(!nm||!nm.isDay) return;
    if(noteWasRepeat){ setNoteScopeAsk(action); return; }
    if(action==="clear"){ dnWriteToday(nm.dayKey,"",null,false); dnCloseNoteModal(); return; }
    if(noteRepeat>0){ dnSetRepeat(nm.dayKey,noteDraft,noteKind,noteRepeat); }
    else { dnWriteToday(nm.dayKey,noteDraft,noteKind,false); }
    dnCloseNoteModal();
  };
  var dnApplyScope = function(scope){
    var nm=noteModal; if(!nm||!nm.isDay){ setNoteScopeAsk(null); return; }
    // v92: "lines" is the new per-line-editor prompt (a repeating line's wording was retyped).
    // "This day only" writes a one-off override for this date; "All repeats" rewrites the series
    // and clears any override this date was carrying. Everything below this line is the ORIGINAL
    // v63 whole-note path, untouched, still serving the legacy single-note flow.
    if(noteScopeAsk==="lines"){ setNoteScopeAsk(null); dnCommitLines(scope==="all"?"all":"today"); return; }
    var action=noteScopeAsk; var rk=nm.ruleKey;
    if(action==="clear"){
      if(scope==="all"){ if(rk) dnDeleteRule(rk); }
      else { dnWriteToday(nm.dayKey,"",null,true); }
    } else {
      if(scope==="all"){
        if(noteRepeat>0 && rk){ dnEditRule(rk,noteDraft,noteKind,noteRepeat); }
        else if(noteRepeat>0 && !rk){ dnSetRepeat(nm.dayKey,noteDraft,noteKind,noteRepeat); }
        else { if(rk) dnDeleteRule(rk); dnWriteToday(nm.dayKey,noteDraft,noteKind,false); }
      } else {
        dnWriteToday(nm.dayKey,noteDraft,noteKind,true);
      }
    }
    dnCloseNoteModal();
  };
  // v89: Personal/Business is fully retired — for day notes (v88) AND appointment notes.
  // Every note now renders the same: gold pencil, dark text. LEGACY notes that still carry
  // a stored kind no longer show blue/gold; the color is simply ignored at render, so no
  // data migration and no "edit the day to fix it" step is needed. The stored kind is left
  // on the record harmlessly (it just never colors anything again).
  // Revert lever — old kind-driven colors:
  // var noteColorFor = function(kind){ return kind==="personal"?TODAY_BLUE:(kind==="business"?"#a07830":"#1a1a1a"); };
  // var notePencilColor = function(kind, hasNote){ if(!hasNote) return null; return kind==="personal"?TODAY_BLUE:"#c9a96e"; };
  var noteColorFor = function(kind){ return "#1a1a1a"; };
  var notePencilColor = function(kind, hasNote){ if(!hasNote) return null; return "#c9a96e"; };

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
        // #4 (v51): when the person was SHARING their old time with someone else, the
        // freed spot must be REMOVED, not blanked — a blanked duplicate renders as a
        // phantom empty row stacked at the shared time (the "extra slot" bug). Only a
        // LONE default time is blanked in place (keeps that grid row); a shared time (or
        // any custom time) is spliced out so it collapses to the remaining person.
        var sharedOldA=ds.some(function(s,si){ return si!==occIdx && s.time===occ.time; });
        if (DEFAULT_TIMES.indexOf(occ.time)>=0 && !sharedOldA) ds[occIdx]={time:occ.time,name:"",price:"",done:false,recurWeeks:null};
        else ds.splice(occIdx,1);
      } else {
        ds[occIdx]={...occ,time:newTime,isException:true,customTime:wasCustom&&!isStillDefault,defaultBaseTime:(!wasCustom?baseTime:occ.defaultBaseTime)};
        // Only re-open the vacated default slot when the series is moving to ANOTHER
        // default time. When it moves to a custom time, leaving the old default behind
        // produced a phantom empty slot on every recurrence (the 7:48/7:58 bug).
        if (isStillDefault && DEFAULT_TIMES.indexOf(occ.time)>=0 && !ds.some(function(s){ return s.time===occ.time; })) ds.push({time:occ.time,name:"",price:"",done:false,recurWeeks:null});
      }
      ds.sort(function(a,b){ return timeToAbsMinutes(a.time)-timeToAbsMinutes(b.time); });
      newSch[dk]=ds;
    });
    return {newSchedules:newSch,conflicts:conflicts};
  };

  // v93 (whole-series DAY shift). A series is not a rule — it is materialized as real
  // slots sitting on real future dates. So "he needed four weeks instead of three this
  // once, push everything out" means physically relocating EVERY future occurrence by
  // the same number of DAYS. The gap between visits is untouched (a 3-weekly client
  // stays 3-weekly; the whole ladder just slides), and every occurrence also takes the
  // dropped time — same as buildSeriesTimeShift already does on a same-day drop.
  //
  // A zero-day delta (a same-day drop = a pure retime) delegates straight back to
  // buildSeriesTimeShift, so nothing about the shipping v92 path changes at all.
  //
  // TWO PASSES, and it has to be two. A WEEKLY client shifted +7 days lands each
  // occurrence on the date its OWN next occurrence currently sits. Lifting the entire
  // future series off the board first makes those self-collisions vanish, so only OTHER
  // people can block a landing. A blocked occurrence is put back down exactly where it
  // was and reported — never dropped, never duplicated.
  const buildSeriesDayShift = function(name, fromDateKey, toDateKey, newTime, targetSlot) {
    var dayDelta = dayShiftDelta(fromDateKey, toDateKey);
    if (dayDelta === 0) {
      var same = buildSeriesTimeShift(name, fromDateKey, newTime);
      return {newSchedules:same.newSchedules, conflicts:same.conflicts, blocked:[], shared:[], moved:0, dayDelta:0};
    }
    if (!targetSlot) targetSlot = {time:newTime};
    var lower=(name||"").toLowerCase();
    var newSch={...schedulesRef.current};
    var blank=function(){ return DEFAULT_TIMES.map(function(t){ return {time:t,name:"",price:"",done:false,recurWeeks:null}; }); };
    var findOcc=function(ds){ var z; for(z=0;z<ds.length;z++){ if(ds[z].name && ds[z].name.toLowerCase()===lower && !ds[z].done) return z; } return -1; };
    var picked=[];
    Object.keys(newSch).forEach(function(dk){
      if (dk < fromDateKey) return;
      var ds=newSch[dk]; if(!ds) return;
      var oi=findOcc(ds); if (oi<0) return;
      picked.push({dk:dk, slot:{...ds[oi]}});
    });
    if (picked.length===0) return {newSchedules:newSch, conflicts:[], blocked:[], shared:[], moved:0, dayDelta:dayDelta};
    // v93b (#13, the phantom-row bug). EVERYTHING here works off the ANCHOR, never the
    // displayed time. A slot the barber nudged off-grid — shown as 7:26 but really the
    // day's 7:36 default row wearing a different label — has defaultBaseTime "7:36".
    // placementTime() returns that anchor. Matching future days by the displayed 7:26
    // finds NOTHING (no day has a 7:26 row), so a brand-new row gets pushed in beside
    // the day's still-empty 7:36 — which is exactly the doubled 7:26 + 7:36 rows.
    // buildRecurringSchedules already solved this; this now uses the identical rule:
    // find the ANCHORED row on each future day and RELABEL it.
    var tAnchor=placementTime(targetSlot);
    var tIsCust=targetSlot.isCustom===true||(targetSlot.isCustom===undefined&&!targetSlot.defaultBaseTime&&DEFAULT_TIMES.indexOf(targetSlot.time)===-1);
    var tBase=tIsCust?null:(targetSlot.defaultBaseTime||targetSlot.time);
    // PASS 1 — lift the whole future series off the board. A vacated row that belongs to
    // the default grid is RESTORED TO ITS ANCHOR (a nudged 7:26 row goes back to being a
    // clean, bookable, empty 7:36), never left behind wearing its nudged label. A shared
    // time, or a genuinely hand-added custom row, is spliced out so the day collapses.
    picked.forEach(function(p){
      var ds=[...newSch[p.dk]];
      var oi=findOcc(ds); if (oi<0) return;
      var oT=ds[oi].time;
      var oAnchor=placementTime(ds[oi]);
      var oIsGridRow=DEFAULT_TIMES.indexOf(oAnchor)>=0;
      var shared=ds.some(function(s,si){ return si!==oi && s.time===oT; });
      // SELF-HEAL. If an empty row on this day ALREADY claims the same anchor, restoring
      // his row to that anchor would make a second empty 7:36 sitting next to the first.
      // So splice instead. This is what repairs days a previous build already doubled:
      // his nudged 7:26 row is removed and the day is left with its one clean 7:36.
      var anchorTaken=ds.some(function(s,si){ return si!==oi && !s.name && placementTime(s)===oAnchor; });
      if (oIsGridRow && !shared && !anchorTaken) ds[oi]={time:oAnchor,name:"",price:"",done:false,recurWeeks:null};
      else ds.splice(oi,1);
      ds.sort(function(a,b){ return timeToAbsMinutes(a.time)-timeToAbsMinutes(b.time); });
      newSch[p.dk]=ds;
    });
    // PASS 2 — set it back down, each occurrence dayDelta days from where it was.
    // Ascending for a forward shift, descending for a backward one: that keeps a
    // restored (blocked) occurrence always BEHIND the placement cursor, so a later
    // occurrence can never land on top of one that was just put back.
    picked.sort(function(a,b){ if (a.dk===b.dk) return 0; if (dayDelta>0) return a.dk<b.dk?-1:1; return a.dk<b.dk?1:-1; });
    // v95: "blocked" now means genuinely IMPOSSIBLE — the only thing that still qualifies
    // is a lunch/blocked-out row, which is not a person and cannot be shared with. A row
    // held by another CLIENT is no longer a wall; see the share branch below.
    var blocked=[]; var shared=[]; var moved=0;
    picked.forEach(function(p){
      var occ=p.slot;
      var tk=formatDateKey(addDays(parseDateKey(p.dk), dayDelta));
      var ds=newSch[tk]?[...newSch[tk]]:blank();
      // v94 ANCHOR COLLISION (the Bobby bug). v93b matched by ANCHOR alone. That is right
      // only while at most ONE row per day claims a given anchor — and that is not true of
      // real data. A blanked row keeps the anchor it had while it was booked, so a day can
      // easily carry BOTH a clean 7:13 grid row AND an emptied row that shows 7:26 but is
      // still anchored 7:13. findIndex then returns whichever comes first — the 7:13 row —
      // so the drop relabels THAT row to 7:26 and the row he actually dropped on is left
      // sitting there empty beside it. Two 7:26s, and his 7:13 gone.
      //
      // The staged hunt below never trusts the anchor on its own. It asks, in order:
      //   1) an empty row that BOTH shows the dropped time AND carries the dropped anchor
      //      — the row under his finger, on the drop day, every time;
      //   2) an empty row that simply SHOWS the dropped time — the same spot on a future
      //      day that was already nudged there, whatever its stored anchor says;
      //   3) somebody ELSE already shown at that time — a conflict, reported, never stacked
      //      (v93b would have quietly relabeled the anchor row and created a second booking
      //      at the same displayed time);
      //   4) only then the old anchor match — which is what still relabels a future day's
      //      clean 7:13 grid row into the 7:26 the series now sits at.
      // Revert lever — the v93b single anchor hunt this replaces:
      // var ti=ds.findIndex(function(s){ return placementTime(s)===tAnchor; });
      var tiExact=ds.findIndex(function(s){ return !s.name && s.time===newTime && placementTime(s)===tAnchor; });
      var tiShown=ds.findIndex(function(s){ return !s.name && s.time===newTime; });
      var tiTaken=ds.findIndex(function(s){ return s.name && s.time===newTime && s.name.toLowerCase()!==lower; });
      var ti;
      if (tiExact>=0) ti=tiExact;
      else if (tiShown>=0) ti=tiShown;
      else if (tiTaken>=0) ti=tiTaken;
      else ti=ds.findIndex(function(s){ return placementTime(s)===tAnchor; });
      if (ti>=0 && ds[ti].name && ds[ti].blocked) {
        // A lunch / blocked-out row is not a person. Nothing to share with, so this one is
        // genuinely impossible: put it back down where it came from and say so afterwards.
        blocked.push({dateKey:tk, time:newTime, existingName:ds[ti].name, fromDateKey:p.dk});
        var bs=newSch[p.dk]?[...newSch[p.dk]]:blank();
        var bAnchor=placementTime(occ);
        var bi=bs.findIndex(function(s){ return !s.name && placementTime(s)===bAnchor; });
        if (bi>=0) bs[bi]={...occ}; else bs.push({...occ});
        bs.sort(function(a,b){ return timeToAbsMinutes(a.time)-timeToAbsMinutes(b.time); });
        newSch[p.dk]=bs;
        return;
      }
      if (ti>=0 && ds[ti].name) {
        // v95 SHARE, DON'T SKIP. Another CLIENT is already at that time on the new date.
        // v94 treated that as a wall and left the visit behind on its old day — which is
        // exactly what made Bobby "disappear": he was not gone, he was still sitting on
        // Sep 12 while Granger was staring at Sep 19. But this app has always allowed two
        // people to share one slot, and sharing is precisely what a barber does by hand in
        // this situation. So DOUBLE-BOOK it: a second entry at the same time, drawn as the
        // paired row the app already renders everywhere else. Nobody is left behind, and
        // the report afterwards names who he is sharing with so it can be sorted out.
        //
        // The share row takes the HOST row's identity descriptors (isCustom / customTime /
        // defaultBaseTime), because the host is the truth about what that time IS on this
        // day. Both entries then agree, which is what keeps them drawn as one paired row
        // and keeps vacateSlotCollapsing able to collapse the pair cleanly on a cancel.
        // Revert lever — the v94 wall (blocked-and-restore, for ANY occupant):
        // blocked.push({dateKey:tk, time:newTime, existingName:ds[ti].name, fromDateKey:p.dk}); ...restore to p.dk...; return;
        var host=ds[ti];
        // v96 THE SHARE THAT WASN'T. v95 wrote the share row at newTime — the LABEL of
        // the row he dropped on. That is wrong the moment the two disagree, and they do
        // disagree exactly when it matters: he dropped on a row showing 7:26 that is really
        // the day's 7:36 slot, so Bobby was written at 7:26 while Kelly sat at 7:36. Same
        // slot underneath, two different displayed times — and the render only pairs rows
        // whose TIME matches, so instead of one shared row he got an extra row beside her.
        // Sharing means occupying the SAME time as the host. Full stop. The host row is on
        // the board already and is the truth about what that time reads as on this day, so
        // the visitor takes the host's time along with the host's identity descriptors.
        // Revert lever — the v95 line, which took the dropped label instead:
        // var shareRow={...occ, time:newTime, name:occ.name, ...};
        var shareTime=host.time;
        var shareRow={...occ, time:shareTime, name:occ.name, price:occ.price, recurWeeks:occ.recurWeeks, done:false, isException:true, groupId:null, pending:!!occ.pending, availStatus:null, blocked:false, isCustom:host.isCustom===true, customTime:host.customTime===true};
        if (host.defaultBaseTime) shareRow.defaultBaseTime=host.defaultBaseTime; else delete shareRow.defaultBaseTime;
        ds.splice(ti+1,0,shareRow);
        shared.push({dateKey:tk, time:shareTime, existingName:host.name, fromDateKey:p.dk});
        ds.sort(function(a,b){ return timeToAbsMinutes(a.time)-timeToAbsMinutes(b.time); });
        newSch[tk]=ds;
        moved++;
        return;
      }
      // The row descriptors come from the slot he was actually DROPPED ON — that slot is
      // the truth about whether 7:26 is a nudged grid row or a real custom row. Mirrors
      // buildRecurringSchedules writing sourceSlot's isCustom/customTime/defaultBaseTime.
      // groupId is dropped: he is leaving the day, so a link to people who stayed behind
      // would dangle. Same call applySeriesDrop("one") already makes on a cross-day drop.
      // v94: when the occurrence lands ON an existing row, that row — not the drop-day row —
      // is the truth about what it is underneath. retimeSlot is the same per-slot retime the
      // time editor has always done: it keeps the landing row's own anchor and just relabels
      // it. v93b instead stamped the DROP DAY's descriptors onto every future day, which is
      // how a row ends up displaying 7:36 while secretly anchored 7:13 — a fresh landmine on
      // each future day. The booking fields are overlaid from occ; blocked/availStatus are
      // cleared explicitly so nothing leaks off the empty row being written into.
      // Revert lever — the v93b write (both branches used this single object):
      // var landed={...occ, time:newTime, isException:true, groupId:null, isCustom:tIsCust, customTime:tIsCust, defaultBaseTime:tBase};
      var landed;
      if (ti>=0) {
        landed=retimeSlot(ds[ti], newTime, {name:occ.name, price:occ.price, recurWeeks:occ.recurWeeks, done:false, isException:true, groupId:null, pending:!!occ.pending, availStatus:null, blocked:false});
      } else {
        landed={...occ, time:newTime, isException:true, groupId:null, isCustom:tIsCust, customTime:tIsCust, defaultBaseTime:tBase};
      }
      if (ti>=0) ds[ti]=landed; else ds.push(landed);
      // v95: and never let the row that just landed carry a LYING anchor. If it now sits on
      // a real grid time that nobody else on the day claims, it IS that grid row and any
      // inherited anchor is a landmine for the next move. This is the single line that stops
      // the corruption spreading day by day the way it did through Bobby's whole ladder.
      // Revert lever — pre-v95 wrote landed straight in with whatever anchor it inherited:
      // (nothing here)
      if (ti>=0) ds[ti]=unlieAnchor(ds, ti);
      ds.sort(function(a,b){ return timeToAbsMinutes(a.time)-timeToAbsMinutes(b.time); });
      newSch[tk]=ds;
      moved++;
    });
    return {newSchedules:newSch, conflicts:[], blocked:blocked, shared:shared, moved:moved, dayDelta:dayDelta};
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

  // ---- 6C/6D series-edit + conflict-resolution helpers ----
  // 6C name/price: apply a rename/price change to just this occurrence or to the
  // whole future series.
  const applySeriesNamePrice = function(scope) {
    var m=seriesEditModal; if(!m) return;
    var snap={schedules:JSON.parse(JSON.stringify(schedulesRef.current))}; pushUndo(snap);
    if (scope==="one") {
      var slots=[...getSlots(m.dateKey)]; var p=slots[m.idx];
      // v69: a "just this one" swap to a DIFFERENT person must NOT inherit the old
      // client's recurring flag. The old spread carried recurWeeks straight onto the new
      // name, silently marking them recurring with no prompt. This mirrors the guard
      // already used in the pencil-in and inline name-edit paths. A same-person price or
      // edit keeps its recurring flag and stays an exception for this occurrence, as before.
      var prevNameOne = (m.oldName!=null ? m.oldName : (p.name||""));
      var nameChangedOne = (m.newName||"").toLowerCase() !== (prevNameOne||"").toLowerCase();
      var oneWrite = {...p,name:m.newName,price:m.newPrice,availStatus:null,pending:false,isException:true};
      if (nameChangedOne) { oneWrite.recurWeeks = null; oneWrite.isException = false; }
      slots[m.idx]=oneWrite;
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
      // v92 GROUP TIME CASCADE, this-day-only branch. Same rule as commitTimeEdit: if the
      // person being moved is the FIRST member of a group, the rest of the group slides by
      // the same number of minutes ON THIS DAY. Their future occurrences are untouched —
      // this is the "just this one" branch, so every moved member becomes an exception for
      // this date, exactly as the leader already did. ("All of X's appointments" still moves
      // X's series only; a whole-series group shift is a separate recurring-engine job.)
      var cIdxs=groupCascadeIdxs(slots, m.idx);
      var dMin=timeToAbsMinutes(m.newTime)-timeToAbsMinutes(p.time);
      var mIdxs=[m.idx].concat(cIdxs);
      var wantFor={}; var q;
      for(q=0;q<mIdxs.length;q++){ wantFor[mIdxs[q]]=absMinutesToTime(timeToAbsMinutes(slots[mIdxs[q]].time)+dMin); }
      var movingS={}; for(q=0;q<mIdxs.length;q++){ movingS[mIdxs[q]]=true; }
      var blockedS=false;
      for(q=0;q<mIdxs.length;q++){ var wT=wantFor[mIdxs[q]]; if(slots.some(function(s,i){ return !movingS[i] && s.time===wT; })) { blockedS=true; } }
      if (blockedS) { setSeriesEditModal(null); return; }
      // Revert lever — the v91 single-slot write this replaced:
      // var isStillDefault=DEFAULT_TIMES.indexOf(m.newTime)>=0;
      // var wasCustom=p.isCustom===true||(p.isCustom===undefined&&DEFAULT_TIMES.indexOf(p.time)===-1);
      // var baseTime=p.defaultBaseTime||(!wasCustom?p.time:null);
      // slots[m.idx]={...p,time:m.newTime,isException:true,customTime:wasCustom&&!isStillDefault,defaultBaseTime:(!wasCustom?baseTime:p.defaultBaseTime)};
      var snap={schedules:JSON.parse(JSON.stringify(schedulesRef.current))}; pushUndo(snap);
      for(q=0;q<mIdxs.length;q++){ var tq=mIdxs[q]; slots[tq]=retimeSlot(slots[tq], wantFor[tq], {isException:true}); }
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
          var sVacTime = tgt[m.idx] ? tgt[m.idx].time : null;
          var sVacShared=false; for (var svi=0; svi<tgt.length; svi++){ if (svi!==m.idx && tgt[svi] && tgt[svi].time===sVacTime) { sVacShared=true; break; } }
          tgt=vacateSlotCollapsing(tgt,m.idx);
          setSlots(m.targetDateKey,tgt);
          flashMovePair(m.targetDateKey, tgt, sVacTime, sVacShared, m.targetDateKey, tgt, tslot.time, m.name);
        } else {
          setSlots(m.targetDateKey,tgt);
          var src=[...getSlots(m.dateKey)];
          var sVacTimeX = src[m.idx] ? src[m.idx].time : null;
          var sVacSharedX=false; for (var sxi=0; sxi<src.length; sxi++){ if (sxi!==m.idx && src[sxi] && src[sxi].time===sVacTimeX) { sVacSharedX=true; break; } }
          src=vacateSlotCollapsing(src,m.idx);
          setSlots(m.dateKey,src);
          flashMovePair(m.dateKey, src, sVacTimeX, sVacSharedX, m.targetDateKey, tgt, tslot.time, m.name);
        }
        addHistoryEntry({type:"rescheduled",time:m.newTime,name:m.name,price:m.price,dateKey:m.targetDateKey});
      }
      setSeriesEditModal(null);
    } else {
      var snap2={schedules:JSON.parse(JSON.stringify(schedulesRef.current))}; pushUndo(snap2);
      // v93: revert lever — v92 shifted the TIME only and pinned every occurrence to its
      // own day, so a cross-day drop could never push the series out a week:
      //   var res=buildSeriesTimeShift(m.name, m.dateKey, m.newTime);
      // buildSeriesDayShift is identical to that call whenever the drop stayed on the
      // same day (it delegates straight back to it), so the same-day path is unchanged.
      // v93b: hand it the slot he was actually DROPPED ON, read live and BEFORE the build
      // touches anything. That slot is the only thing that knows whether the time he
      // landed on is a nudged default grid row or a genuine hand-added custom row — and
      // getting that wrong is what doubled every future day into 7:26 + 7:36.
      var tSlotAll=getSlots(m.targetDateKey)[m.targetIdx]||{time:m.newTime};
      var res=buildSeriesDayShift(m.name, m.dateKey, m.targetDateKey, m.newTime, tSlotAll);
      setSeriesEditModal(null);
      if (res.conflicts.length>0) {
        setConflictModal({conflicts:res.conflicts, pending:res.newSchedules, client:{name:m.name,price:m.price||"",recurWeeks:m.recurWeeks}, history:{type:"edited",time:m.newTime,name:m.name,prevName:m.name,dateKey:m.dateKey}});
      } else {
        setSchedules(res.newSchedules);
        if (res.dayDelta!==0) {
          addHistoryEntry({type:"rescheduled",time:m.newTime,name:m.name,price:m.price,dateKey:m.targetDateKey});
          // v95: the report now covers BOTH outcomes — visits that had to share a slot with
          // another client (the normal case now) and the rare visit that hit a lunch block
          // and truly could not move. Revert lever — the v94 blocked-only trigger:
          // if (res.blocked.length>0) setSeriesShiftReport({name:m.name, moved:res.moved, blocked:res.blocked, phrase:dayShiftPhrase(m.dateKey, m.targetDateKey)});
          var resShared=res.shared||[];
          if (res.blocked.length>0 || resShared.length>0) setSeriesShiftReport({name:m.name, moved:res.moved, blocked:res.blocked, shared:resShared, phrase:dayShiftPhrase(m.dateKey, m.targetDateKey)});
        }
      }
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
      setRecentlyRemoved(function(r){ return {...r,[gk]:(s.name||true)}; });
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
    setRecentlyRemoved(function(r){ return {...r,[key]:(slot.name||true)}; });
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

  // The human-readable export — fired by its own "Download schedule" button. The JSON
  // backup is for re-importing; this one is for YOU — a plain-text copy of the upcoming
  // schedule plus everyone's phone number, so if the app is ever gone you still have your
  // day in front of you. Opens in any text app on any device. Saved as a .txt.
  const exportReadable = function() {
    var padTime = function(t){ var s=(t||""); while(s.length<6) s+=" "; return s; };
    var now = new Date();
    var lines = [];
    lines.push("THE LIST  —  readable backup");
    lines.push("Exported " + now.toLocaleString());
    lines.push("Plain-text copy of your schedule, in case the app is ever gone.");
    lines.push("");
    // B7: total upcoming appointments, right-aligned into the section banner. Skips
    // Blocked rows; counts done ones since they still happened. Independent pre-pass so
    // the existing sch/keys setup just below is left untouched.
    var _schB7 = schedulesRef.current || {};
    var _todayB7 = toDateKey(now);
    var _totalAppts = 0;
    Object.keys(_schB7).filter(function(k){ return k >= _todayB7; }).forEach(function(k){
      (_schB7[k] || []).forEach(function(s){ if (!s.blocked && s.name) _totalAppts++; });
    });
    var _b7label = _totalAppts + (_totalAppts===1 ? " appointment" : " appointments");
    var _b7pad = 60 - 17 - _b7label.length; if (_b7pad < 2) _b7pad = 2;
    var _b7sp = ""; while (_b7sp.length < _b7pad) _b7sp += " ";
    lines.push("============================================================");
    lines.push("UPCOMING SCHEDULE" + _b7sp + _b7label);
    lines.push("============================================================");
    lines.push("");
    var sch = schedulesRef.current || {};
    var today = toDateKey(now);
    var keys = Object.keys(sch).filter(function(k){ return k >= today; }).sort();
    var anyDay = false;
    // Look up a client's saved phone number so it can sit right next to their name
    // in the slot (instead of a separate contact list at the bottom).
    var phoneOf = function(nm) {
      var arr = clientMemoryRef.current || [];
      var lo = (nm || "").toLowerCase();
      for (var pi = 0; pi < arr.length; pi++) {
        if ((arr[pi].name || "").toLowerCase() === lo) return arr[pi].phone || "";
      }
      return "";
    };
    keys.forEach(function(dk){
      var slots = sch[dk] || [];
      var rows = [];
      var apptCount = 0;
      slots.forEach(function(s){
        if (s.blocked) {
          rows.push(padTime(s.time) + (s.blockLabel || "Blocked"));
        } else if (s.name) {
          apptCount++;
          var line = padTime(s.time) + s.name;
          var ph = phoneOf(s.name);
          if (ph) line += "  " + ph;
          if (s.price) line += "   " + s.price;
          if (s.recurWeeks) line += "   [repeats]";
          if (s.done) line += "   (done)";
          rows.push(line);
        }
      });
      if (rows.length === 0) return;
      anyDay = true;
      lines.push(friendlyDateLong(dk) + "   (" + apptCount + (apptCount===1 ? " appt)" : " appts)"));
      var note = dayNoteText(dk);
      if (note) lines.push("  note: " + note);
      rows.forEach(function(r){ lines.push("  " + r); });
      lines.push("");
    });
    if (!anyDay) { lines.push("(Nothing on the books from today forward.)"); lines.push(""); }
    // Month totals — dollars / services / hours, summed per calendar month across every
    // day that carries accounting data. Sorted oldest -> newest so the CURRENT month is
    // the very last thing on the page (the spot you land on after scrolling the schedule).
    // Day-level totals are deliberately left out; this is the month recap Granger asked
    // for. Built in one pass over the whole accounting map (mirrors acctMonthTotals math).
    var fmtNum = function(n){ var r = Math.round(n*100)/100; if (r === Math.round(r)) return String(Math.round(r)); return String(r); };
    // Per-day numbers straight from the accounting popup — take-home $, services, and
    // hours for every day that carries data, oldest -> newest. These are the day-by-day
    // figures the month recap below rolls up.
    lines.push("============================================================");
    lines.push("DAILY NUMBERS");
    lines.push("============================================================");
    lines.push("");
    var acctDayMap = accountingRef.current || {};
    var acctDayKeys = Object.keys(acctDayMap).sort();
    var anyDaily = false;
    acctDayKeys.forEach(function(dk){
      var rr = acctDayMap[dk] || {};
      var dth = acctTakehome(rr); var dsv = acctNum(rr.services); var dhr = acctNum(rr.hours);
      if (dth<=0 && dsv<=0 && dhr<=0) return;
      anyDaily = true;
      lines.push(friendlyDateLong(dk) + ":   $" + fmtNum(dth) + ",   " + fmtNum(dsv) + " services,   " + fmtNum(dhr) + " hours");
    });
    if (!anyDaily) { lines.push("(No accounting recorded yet.)"); }
    lines.push("");
    lines.push("============================================================");
    lines.push("MONTH TOTALS");
    lines.push("============================================================");
    lines.push("");
    var acctMap = accountingRef.current || {};
    var monthAgg = {};
    var monthOrder = [];
    Object.keys(acctMap).forEach(function(dk){
      var d = parseDateKey(dk);
      if (!d || isNaN(d.getTime())) return;
      var mm = d.getMonth();
      var ymKey = d.getFullYear() + "-" + (mm < 9 ? "0" : "") + (mm + 1);
      if (!monthAgg[ymKey]) {
        monthAgg[ymKey] = {th:0, sv:0, hr:0, label:d.toLocaleDateString("en-US", {month:"long", year:"numeric"})};
        monthOrder.push(ymKey);
      }
      var r = acctMap[dk] || {};
      monthAgg[ymKey].th += acctTakehome(r);
      monthAgg[ymKey].sv += acctNum(r.services);
      monthAgg[ymKey].hr += acctNum(r.hours);
    });
    monthOrder.sort();
    var anyMonth = false;
    monthOrder.forEach(function(ymKey){
      var m = monthAgg[ymKey];
      if (m.th <= 0 && m.sv <= 0 && m.hr <= 0) return;
      anyMonth = true;
      lines.push(m.label + ":   $" + fmtNum(m.th) + ",   " + fmtNum(m.sv) + " services,   " + fmtNum(m.hr) + " hours");
    });
    if (!anyMonth) { lines.push("(No accounting recorded yet.)"); }
    lines.push("");
    var blob = new Blob([lines.join("\n")], {type:"text/plain"});
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "the-list-readable-" + toDateKey(now) + ".txt"; a.click();
    URL.revokeObjectURL(url);
    showBanner({type:"added",msg:"Schedule downloaded",time:null,dateKey:null});
    armBannerTapClear();
  };

  const exportData = function() {
    var data = {schedules:schedulesRef.current, clients:clientMemory, holidays:customHolidays, history:history, dayNotes:dayNotes, accounting:accountingRef.current, shareDrafts:shareDraftsRef.current, shareActiveDraftId:shareActiveDraftIdRef.current, quickMsgs:quickMsgs, shareSavedChecks:shareSavedChecks, shareSavedState:shareSavedState, exportedAt:new Date().toISOString()};
    var blob = new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href=url; a.download="the-list-backup-"+(new Date().toISOString().split("T")[0])+".json"; a.click();
    URL.revokeObjectURL(url);
    showBanner({type:"added",msg:"Backup exported",time:null,dateKey:null});
    armBannerTapClear();
    setHistory(function(prev){ return [{type:"backup",name:"Backup exported",timestamp:new Date().toLocaleTimeString(),id:Date.now()+Math.random()},...prev].slice(0,200); });
  };

  // Importing a backup replaces everything, so we parse the file first and ASK before
  // applying. The export stamps the moment it was made (exportedAt); if that's missing
  // (an older backup) we fall back to the file's own modified time, and if neither is
  // available we say "an unknown time" but still ask.
  const importData = function(e) {
    var file=e.target.files&&e.target.files[0];
    if (!file) return;
    var reader=new FileReader();
    reader.onload=function(ev) {
      try {
        var data=JSON.parse(ev.target.result);
        var when=null;
        if (data.exportedAt) { var d1=new Date(data.exportedAt); if(!isNaN(d1.getTime())) when=d1; }
        if (!when && file.lastModified) { var d2=new Date(file.lastModified); if(!isNaN(d2.getTime())) when=d2; }
        var whenText = when ? friendlyWhen(when) : "an unknown time";
        setImportConfirm({data:data, whenText:whenText});
      } catch(err) { alert("Couldn't read that file."); }
    };
    reader.readAsText(file);
    e.target.value="";
  };

  // Actually restore, once the user confirms in the import dialog.
  const applyImport = function() {
    var m = importConfirm; if (!m) return;
    var data = m.data;
    if (data.schedules) { setSchedules(migrateSchedules(data.schedules)); }
    if (data.clients) setClientMemory(data.clients);
    if (data.holidays) setCustomHolidays(data.holidays);
    if (data.history) setHistory(data.history);
    if (data.dayNotes) setDayNotes(data.dayNotes);
    if (data.accounting) setAccounting(data.accounting);
    if (data.shareDrafts && data.shareDrafts.length) setShareDrafts(data.shareDrafts);
    if (data.shareActiveDraftId) setShareActiveDraftId(data.shareActiveDraftId);
    if (data.quickMsgs) setQuickMsgs(data.quickMsgs);
    if (data.shareSavedChecks!==undefined) setShareSavedChecks(data.shareSavedChecks);
    if (data.shareSavedState!==undefined) setShareSavedState(data.shareSavedState);
    setImportConfirm(null);
    showBanner({type:"added",msg:"Backup restored",time:null,dateKey:null});
    armBannerTapClear();
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

  // v75: single source of truth for "a still single-name hold opened the profile".
  // Called from TWO places — the snappy auto-open timer (finger still down) and the
  // still-release path in onEnd (finger lifted without moving). Both must dismantle
  // the live drag IDENTICALLY before the profile appears, which is what v70 failed to
  // do. The profileHoldFired sentinel makes it idempotent: whichever path runs first
  // opens the profile and tears down; a second call for the same gesture no-ops.
  const openHeldProfileNow = function() {
    if (profileHoldTimer.current) { clearTimeout(profileHoldTimer.current); profileHoldTimer.current = null; }
    if (profileHoldFired.current) return;
    profileHoldFired.current = true;
    var ds = dragStateRef.current;
    var heldName = (ds && !ds.multi && ds.clients && ds.clients[0]) ? ds.clients[0].name : null;
    releaseDragPointer();
    setIsLiveDragging(false); dragLiftedRef.current = false; setDragLifted(false);
    dragOverRef.current = null; setDragOverKey(null);
    setDragState(null);
    // v76: the snappy auto-open fires with the finger STILL down, so iOS was treating
    // the continued press as a text-selection gesture and highlighting whatever profile
    // word landed under the finger. The profile card is now userSelect:none (nothing to
    // latch onto); this clears any range that already formed during the hold, as
    // insurance for both the auto-open and the still-release paths.
    try { var _sel = window.getSelection && window.getSelection(); if (_sel && _sel.removeAllRanges) _sel.removeAllRanges(); } catch(e) {}
    // v81: press-and-hold no longer opens the client profile. A hold now ONLY arms the
    // drag. Both callers still run the teardown above so an unmoved hold cancels cleanly
    // (finger lifts, nothing greys out, no move) — but the profile no longer pops. The
    // non-recurring / no-next-booking profile is reached instead by tapping the blank
    // ↺ column (see the row render). Revert lever — un-comment the next line to bring
    // the old hold-to-open behavior back:
    // if (heldName) openClientProfile(heldName);
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
          dragLiftedRef.current = true; setDragLifted(true);
          setIsLiveDragging(true);
          captureDragPointer();
        } else {
          setDragCalOpen(true); setDragCalMonth(new Date()); setDragCalHover(true);
        }
        playSound("lock");
        return;
      }
      // If this slot belongs to a group, the whole group travels together — UNLESS
      // it's a same-time shared slot. Two people sharing one time are a temporary
      // holding pen: dragging one of them should peel out ONLY that person (and the
      // single drop below un-shares whoever is left). A real multi-time group (slots
      // linked across different times) still moves as a unit.
      if (slot.groupId) {
        var daySlots = getSlots(dateKey);
        var sharesTimeWithAnother = daySlots.some(function(s2,i2){ return i2!==idx && s2.name && s2.time===slot.time; });
        if (!sharesTimeWithAnother) {
          var groupClients = daySlots.map(function(s,i){ return {s:s,i:i}; })
            .filter(function(o){ return o.s.groupId===slot.groupId && o.s.name; })
            .map(function(o){ return {name:o.s.name,price:o.s.price,recurWeeks:o.s.recurWeeks,originalTime:o.s.time,originalDateKey:dateKey,originalIdx:o.i}; });
          if (groupClients.length > 1) {
            setDragState({clients:groupClients,sourceKey:dateKey+"-"+idx,multi:true,group:true,label:slot.name});
            if (isTouch) {
              dragPosRef.current = {x:startX, y:startY};
              dragOverRef.current = null; setDragOverKey(null);
              dragLiftedRef.current = true; setDragLifted(true);
              setIsLiveDragging(true);
              captureDragPointer();
            } else {
              setDragCalOpen(true); setDragCalMonth(new Date()); setDragCalHover(true);
            }
            playSound("lock");
            return;
          }
        }
      }
      var clients = [{name:slot.name,price:slot.price,recurWeeks:slot.recurWeeks,originalTime:slot.time,originalDateKey:dateKey,originalIdx:idx}];
      setDragState({clients,sourceKey:dateKey+"-"+idx,multi:false});
      if (isTouch) {
        // v74: SILENT ARM. A 250ms hold (v75: was 500ms) no longer lifts the chip. It
        // arms the drag (dragState was set just above, pointer gets captured, and the
        // live-drag effect attaches its move/end listeners) but stays visually silent —
        // no chip, no lock sound — until the finger actually MOVES. onMove lifts the chip
        // and plays the lock sound on the first >10px of movement.
        // v75: SNAPPY AUTO-OPEN re-armed at Granger's request. After the arm, if the
        // finger stays still (no >10px move) for the dwell below, profileHoldTimer opens
        // the client profile WITHOUT a release — "opens while my finger's still down."
        // A real drag moves first, and onMove cancels this timer, so drag still wins. A
        // still RELEASE before the timer fires still opens the profile via onEnd. Both
        // paths run through openHeldProfileNow, which tears the live drag fully down
        // BEFORE the modal shows — the clean teardown v70 lacked (v70 opened over a still
        // armed drag, which is what broke it). The source-row fade stays gated on
        // dragLifted, so nothing greys out on the bare hold.
        // v72 immediate-pickup lever kept commented for a one-line revert if ever needed:
        //   dragLiftedRef.current = true; setDragLifted(true); playSound("lock");
        dragPosRef.current = {x:startX, y:startY};
        dragOverRef.current = null; setDragOverKey(null);
        setIsLiveDragging(true);
        captureDragPointer();
        // --- Snappy auto-open dwell. THIS number is the tunable dial: lower = snappier
        // but a slow-to-start drag can pop the profile; higher = drag-safer, slower open.
        // v81: SNAPPY AUTO-OPEN DISABLED. A still hold used to pop the client profile
        // after this dwell; press-and-hold is now drag-only. A still hold simply stays
        // armed until you move (drag begins) or lift without moving (clean cancel via
        // onEnd). Revert lever — un-comment this whole block to bring the hold-to-open
        // dwell back:
        // if (profileHoldTimer.current) { clearTimeout(profileHoldTimer.current); profileHoldTimer.current = null; }
        // profileHoldTimer.current = setTimeout(function() {
        //   profileHoldTimer.current = null;
        //   if (dragMovedRef.current) return; // a real drag already began — leave it alone
        //   openHeldProfileNow();
        // }, 200); // v75 snappy dwell (ms) — adjust this one number to tune the feel
      } else {
        // Mouse / desktop fallback: open the date picker.
        setDragCalOpen(true); setDragCalMonth(new Date()); setDragCalHover(true);
        playSound("lock");
      }
    }, 250); // v75: arm delay halved (was 500ms) — the "recognizes I'm holding" beat
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
    // v98 A PLACEMENT WITH NO ORIGIN. Every caller before now armed placingClient FROM an
    // existing slot, so both paths below assume there is a source row to vacate. The standby
    // list has no source row — the man is on a waiting list, not on the grid — and with a
    // null originalDateKey the else-branch below would call getSlots(null) (which quietly
    // hands back a fresh default day) and then setSlots(null, ...), writing a literal "null"
    // key into schedules and syncing it to Firebase. So a no-origin placement gets its own
    // branch: write the target, vacate nothing, and strike him off the standby list he came
    // from (wlFrom). Undo-able like any other booking.
    if (client.originalDateKey == null) {
      var snapNO = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
      pushUndo(snapNO);
      var tsNO = [...getSlots(targetDateKey)];
      tsNO[targetIdx] = {...tsNO[targetIdx],name:client.name,price:client.price||"",done:false};
      setSlots(targetDateKey, tsNO);
      if (client.wlFrom && client.wlFrom.dayKey) { wlRemove(client.wlFrom.dayKey, client.wlFrom.id); }
      addHistoryEntry({type:"added",time:targetSlot.time,name:client.name,price:client.price||"",dateKey:targetDateKey});
      setPlacingClient(null);
      return;
    }
    if (client.originalDateKey === targetDateKey && client.originalIdx === targetIdx) { setPlacingClient(null); return; }
    // v93 SILENT-MOVE HOLE #1. A recurring client moved through TAP-TO-PLACE — which is
    // where a live drag lands the moment it crosses out of the source day's column, i.e.
    // exactly what happens when you drag somebody onto a DIFFERENT DAY — used to move
    // without asking anything. Only the two direct-drop paths raised the question, so
    // the series silently stayed put and every future visit was left on the old day.
    // Every move path now asks the same this-one / whole-series question.
    // Revert lever: delete this block and the old silent move resumes.
    if (client.recurWeeks != null && client.originalDateKey && client.originalIdx !== undefined) {
      var srcP = getSlots(client.originalDateKey)[client.originalIdx] || {};
      setSeriesEditModal({field:"drop", dateKey:client.originalDateKey, idx:client.originalIdx, targetDateKey:targetDateKey, targetIdx:targetIdx, name:client.name, price:client.price, recurWeeks:client.recurWeeks, pending:!!srcP.pending, oldTime:srcP.time||"", newTime:targetSlot.time});
      setPlacingClient(null);
      return;
    }
    var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    if (client.originalDateKey === targetDateKey) {
      var arr = [...getSlots(targetDateKey)];
      arr[targetIdx] = {...arr[targetIdx],name:client.name,price:client.price,recurWeeks:client.recurWeeks,isException:true,done:false};
      var pVacTime = arr[client.originalIdx] ? arr[client.originalIdx].time : null;
      var pVacShared = false; for (var pvi=0; pvi<arr.length; pvi++){ if (pvi!==client.originalIdx && arr[pvi] && arr[pvi].time===pVacTime) { pVacShared=true; break; } }
      arr = vacateSlotCollapsing(arr, client.originalIdx);
      setSlots(targetDateKey, arr);
      flashMovePair(targetDateKey, arr, pVacTime, pVacShared, targetDateKey, arr, targetSlot.time, client.name);
    } else {
      var ts = [...getSlots(targetDateKey)];
      ts[targetIdx] = {...ts[targetIdx],name:client.name,price:client.price,recurWeeks:client.recurWeeks,isException:true,done:false};
      setSlots(targetDateKey, ts);
      var os = [...getSlots(client.originalDateKey)];
      var pVacTimeX = os[client.originalIdx] ? os[client.originalIdx].time : null;
      var pVacSharedX = false; for (var pxi=0; pxi<os.length; pxi++){ if (pxi!==client.originalIdx && os[pxi] && os[pxi].time===pVacTimeX) { pVacSharedX=true; break; } }
      os = vacateSlotCollapsing(os, client.originalIdx);
      setSlots(client.originalDateKey, os);
      flashMovePair(client.originalDateKey, os, pVacTimeX, pVacSharedX, targetDateKey, ts, targetSlot.time, client.name);
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
    // v82: a penciled-in client dragged to a new slot used to auto-lock (the pencil was
    // dropped on the move). Carry the source slot's pending flag onto the landing slot so
    // the pencil (italic name + lock-in button) rides through the reschedule intact.
    var srcSlotNow = getSlots(client.originalDateKey)[client.originalIdx] || {};
    var wasPending = !!srcSlotNow.pending;
    var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))};
    pushUndo(snapshot);
    if (sameDay) {
      var arr = [...getSlots(targetDateKey)];
      var srcGidSame = arr[client.originalIdx] ? arr[client.originalIdx].groupId : null;
      arr[targetIdx] = {...arr[targetIdx],name:client.name,price:client.price,recurWeeks:client.recurWeeks,isException:true,done:false,groupId:null,pending:wasPending};
      // B1: capture the vacated time + whether it was a shared slot BEFORE the
      // vacate splices/blanks it, so the red lands on the right (final) row.
      var vacTimeSame = arr[client.originalIdx] ? arr[client.originalIdx].time : null;
      var vacSharedSame = false; for (var vsi=0; vsi<arr.length; vsi++){ if (vsi!==client.originalIdx && arr[vsi] && arr[vsi].time===vacTimeSame) { vacSharedSame=true; break; } }
      arr = vacateSlotCollapsing(arr, client.originalIdx);
      if (srcGidSame) {
        var remSame = arr.filter(function(x){ return x.groupId===srcGidSame && x.name; });
        if (remSame.length===1) { var riSame = arr.findIndex(function(x){ return x.groupId===srcGidSame && x.name; }); if (riSame>=0) arr[riSame]={...arr[riSame],groupId:null}; }
      }
      setSlots(targetDateKey, arr);
      flashMovePair(targetDateKey, arr, vacTimeSame, vacSharedSame, targetDateKey, arr, targetSlot.time, client.name);
    } else {
      var ts = [...getSlots(targetDateKey)];
      ts[targetIdx] = {...ts[targetIdx],name:client.name,price:client.price,recurWeeks:client.recurWeeks,isException:true,done:false,groupId:null,pending:wasPending};
      setSlots(targetDateKey, ts);
      var os = [...getSlots(client.originalDateKey)];
      var srcGidX = os[client.originalIdx] ? os[client.originalIdx].groupId : null;
      var vacTimeX = os[client.originalIdx] ? os[client.originalIdx].time : null;
      var vacSharedX = false; for (var vxi=0; vxi<os.length; vxi++){ if (vxi!==client.originalIdx && os[vxi] && os[vxi].time===vacTimeX) { vacSharedX=true; break; } }
      os = vacateSlotCollapsing(os, client.originalIdx);
      if (srcGidX) {
        var remX = os.filter(function(x){ return x.groupId===srcGidX && x.name; });
        if (remX.length===1) { var riX = os.findIndex(function(x){ return x.groupId===srcGidX && x.name; }); if (riX>=0) os[riX]={...os[riX],groupId:null}; }
      }
      setSlots(client.originalDateKey, os);
      flashMovePair(client.originalDateKey, os, vacTimeX, vacSharedX, targetDateKey, ts, targetSlot.time, client.name);
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
    var vacListMulti = [];
    clients.forEach(function(c){
      var od = getDay(c.originalDateKey);
      if (od[c.originalIdx] && od[c.originalIdx].name===c.name) {
        vacListMulti.push({dateKey:c.originalDateKey, time:od[c.originalIdx].time, name:c.name}); // B1: remember where to paint red
        od[c.originalIdx] = {...od[c.originalIdx],name:"",price:"",done:false,recurWeeks:null,isException:false,groupId:null};
        newSch[c.originalDateKey] = od;
      }
    });
    var placed = 0; var conflicts = []; var flashT = [];
    clients.forEach(function(c){
      var day = getDay(targetDateKey);
      var targetTime = (c.originalTime||c.time);
      var ti = day.findIndex(function(s){ return s.time===targetTime; });
      if (ti < 0) ti = day.findIndex(function(s){ return !s.name && !s.blocked; });
      if (ti >= 0 && !day[ti].name && !day[ti].blocked) {
        day[ti] = {...day[ti],name:c.name,price:c.price,recurWeeks:c.recurWeeks,isException:true,done:false};
        newSch[targetDateKey] = day;
        flashT.push({dateKey:targetDateKey, time:day[ti].time});
        placed++;
      } else {
        conflicts.push(c);
      }
    });
    setSchedules(newSch);
    // B1: green on each landing spot, red on each vacated spot. Final indices are
    // re-resolved by time from newSch so nothing mis-lands; the !name guard skips
    // red on any slot a person actually landed back into.
    flashT.forEach(function(ft){ var d=newSch[ft.dateKey]; if(d){ var i=findSlotIdxByTime(d,ft.time); if(i>=0) flashPlaced(ft.dateKey,i); } });
    vacListMulti.forEach(function(vt){ var d=newSch[vt.dateKey]; if(d){ var i=findSlotIdxByTime(d,vt.time); if(i>=0 && !d[i].name) flashRemoved(vt.dateKey,i,vt.name); } });
    setSelectMode(false); setSelectedSlots({});
    if (conflicts.length > 0) {
      var first = conflicts[0]; var rest = conflicts.slice(1);
      setBaseDate(parseDateKey(targetDateKey)); setView(isPhone?"Day":"3-Day");
      setReassignQueue(rest);
      // v87 (#5b): capture the ORIGINAL tap-to-place batch size (this one + queue) so the
      // banner count stays fixed instead of counting down as members land. 1+rest.length
      // = conflicts.length here. Preserved verbatim through the advance in
      // handleReassignSlotTapWithQueue; the banner falls back to the live count if absent.
      setReassignMode({client:{name:first.name,price:first.price,recurWeeks:first.recurWeeks},currentDateKey:targetDateKey,remainingConflicts:[],groupSize:(1+rest.length),originalDateKey:first.originalDateKey,originalIdx:first.originalIdx});
    } else {
      var mvNames = clients.map(function(c){ return c.name; }).filter(function(n){ return !!n; });
      var mvLabel = mvNames.length<=2 ? mvNames.join(" & ") : (mvNames.slice(0,-1).join(", ")+" & "+mvNames[mvNames.length-1]);
      showBanner({type:"rescheduled",msg:(mvLabel||(placed+" appointment"+(placed!==1?"s":"")))+" rescheduled",time:null,dateKey:null,flashTargets:flashT});
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
    var vacListGroup = [];
    clients.forEach(function(c){
      var od = getDay(c.originalDateKey);
      if (od[c.originalIdx] && od[c.originalIdx].name===c.name) {
        vacListGroup.push({dateKey:c.originalDateKey, time:od[c.originalIdx].time, name:c.name}); // B1: remember where to paint red
        od[c.originalIdx] = {...od[c.originalIdx],name:"",price:"",done:false,recurWeeks:null,isException:false,groupId:null};
        newSch[c.originalDateKey] = od;
      }
    });
    var gid = clients.length > 1 ? newGroupId() : null;
    var day = getDay(targetDateKey);
    var cursor = targetIdx;
    var placed = 0; var conflicts = []; var flashT2 = [];
    clients.forEach(function(c){
      while (cursor < day.length && (day[cursor].name || day[cursor].blocked)) cursor++;
      if (cursor < day.length) {
        day[cursor] = {...day[cursor],name:c.name,price:c.price,recurWeeks:c.recurWeeks,isException:true,done:false,groupId:gid};
        flashT2.push({dateKey:targetDateKey, time:day[cursor].time});
        cursor++;
        placed++;
      } else {
        // v78: overflow members carry the group's shared gid into the tap-to-place
        // queue, so when Granger taps them into open slots they RE-JOIN the group
        // instead of coming out detached.
        conflicts.push({...c, groupId:gid});
      }
    });
    newSch[targetDateKey] = day;
    setSchedules(newSch);
    // B1: green on each landing spot, red on each vacated spot (indices re-resolved
    // by time; red skipped on any slot repacked into on this same day).
    flashT2.forEach(function(ft){ var d=newSch[ft.dateKey]; if(d){ var i=findSlotIdxByTime(d,ft.time); if(i>=0) flashPlaced(ft.dateKey,i); } });
    vacListGroup.forEach(function(vt){ var d=newSch[vt.dateKey]; if(d){ var i=findSlotIdxByTime(d,vt.time); if(i>=0 && !d[i].name) flashRemoved(vt.dateKey,i,vt.name); } });
    setSelectMode(false); setSelectedSlots({});
    if (conflicts.length > 0) {
      var first = conflicts[0]; var rest = conflicts.slice(1);
      setBaseDate(parseDateKey(targetDateKey)); setView(isPhone?"Day":"3-Day");
      setReassignQueue(rest);
      // v87 (#5b): fixed original batch size for the banner (see companion note at the
      // multi-date create above). Only the overflow members reach tap-to-place here, so
      // 1+rest.length = conflicts.length is exactly the batch Granger will tap in.
      setReassignMode({client:{name:first.name,price:first.price,recurWeeks:first.recurWeeks,groupId:(first.groupId||null)},currentDateKey:targetDateKey,remainingConflicts:[],groupSize:(1+rest.length),originalDateKey:first.originalDateKey,originalIdx:first.originalIdx});
    } else {
      var mvNames2 = clients.map(function(c){ return c.name; }).filter(function(n){ return !!n; });
      var mvLabel2 = mvNames2.length<=2 ? mvNames2.join(" & ") : (mvNames2.slice(0,-1).join(", ")+" & "+mvNames2[mvNames2.length-1]);
      showBanner({type:"rescheduled",msg:(mvLabel2||(placed+" appointment"+(placed!==1?"s":"")))+" rescheduled",time:null,dateKey:null,flashTargets:flashT2});
    }
    return true;
  };

  // v78: Month-view (or calendar-picker) group drop — NEVER auto-place. Granger's
  // rule: a drag-and-drop reschedule always ends with HIM choosing the time. Open
  // the target day and hand the whole group to tap-to-place, one open-slot tap per
  // member in time order. Each queued member carries a shared groupId so the group
  // lands re-joined as the taps complete. (Select-mode multi drags pass through
  // here too with gid=null — they place the same way, just un-joined.)
  const queueGroupTapToPlace = function(targetDateKey, ds) {
    var clients = ds.clients.filter(function(c){ return c.name; });
    if (clients.length === 0) return;
    clients = clients.slice().sort(function(a,b){
      return timeToAbsMinutes(a.originalTime||a.time) - timeToAbsMinutes(b.originalTime||b.time);
    });
    var gid = (ds.group && clients.length > 1) ? newGroupId() : null;
    var withGid = clients.map(function(c){ return {...c, groupId:gid}; });
    setSelectMode(false); setSelectedSlots({});
    setBaseDate(parseDateKey(targetDateKey)); setView(isPhone?"Day":"3-Day");
    var first = withGid[0]; var rest = withGid.slice(1);
    setReassignQueue(rest);
    // v87 (#5b): fixed original batch size for the banner (see companion note above). The
    // whole group is tap-placed here, so 1+rest.length = withGid.length = the full group.
    setReassignMode({client:{name:first.name,price:first.price,recurWeeks:first.recurWeeks,groupId:first.groupId},currentDateKey:targetDateKey,remainingConflicts:[],groupSize:(1+rest.length),originalDateKey:first.originalDateKey,originalIdx:first.originalIdx});
  };

  useEffect(function() {
    if (!isLiveDragging) return;
    // A fresh live drag starts "not yet moved": a still hold+release opens the
    // profile; real finger movement past the threshold commits to a reschedule.
    dragMovedRef.current = false;
    profileHoldFired.current = false; // v75: re-arm the snappy-open sentinel per drag
    dragStartPosRef.current = {x: dragPosRef.current.x, y: dragPosRef.current.y};
    if (dragChipRef.current) {
      dragChipRef.current.style.transform = dragChipTransform(dragPosRef.current.x, dragPosRef.current.y);
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
      // v90 (#8): THE POST-MOVE DAY-JUMP FIX. The root div's swipe-to-navigate gesture
      // records a start point on touchstart and, on touchend, pages the day if the
      // finger travelled 55px+ mostly-horizontally. A drag ALSO starts with a touchstart
      // on that same root div (the arm is silent, so nothing is live yet and the
      // touchstart guard lets it through), and dragging an appointment sideways into
      // another column is exactly a 55px+ mostly-horizontal travel. The touchend guards
      // (!isLiveDraggingRef.current && !dragState) are all cleared by the pointerup
      // handler below, which fires BEFORE touchend — so the swipe fired on every
      // cross-column drop. That is why a same-day (vertical) move never jumped and a
      // cross-day (horizontal) move always did, instantly, by one day in whichever
      // direction the finger travelled. Killing the recorded start point the moment a
      // real drag moves disarms the swipe for this gesture only. Nothing that
      // intentionally opens a day (tap-to-place, month-cell drop, quick-book) is touched.
      swipeNavStart.current = null;
      if (!dragMovedRef.current && dragStartPosRef.current) {
        if (Math.abs(px - dragStartPosRef.current.x) > 10 || Math.abs(py - dragStartPosRef.current.y) > 10) {
          dragMovedRef.current = true;
          // v70: first real movement turns a silent hold into a visible drag —
          // cancel the pending profile-open and reveal the chip + lock sound now.
          if (profileHoldTimer.current) { clearTimeout(profileHoldTimer.current); profileHoldTimer.current = null; }
          if (!dragLiftedRef.current) { dragLiftedRef.current = true; setDragLifted(true); playSound("lock"); }
        }
      }
      if (dragChipRef.current) dragChipRef.current.style.transform = dragChipTransform(px, py);
      // Hovering a view tab while dragging jumps into that view so off-screen days
      // become reachable. Pointer capture keeps the gesture alive across the switch.
      var vt = findViewTab(px, py);
      if (vt && vt !== viewRef.current) {
        if (vt === "Wknd") setBaseDate(getUpcomingWeekend());
        setView(vt);
      }
      var ds = dragStateRef.current;
      var key = (ds && ds.multi) ? findAnyRowKey(px, py) : findDropKeyNear(px, py);
      // v78: Month-view glide. No slot row under the finger but a month day cell is —
      // track it as "M:<dateKey>" so that cell can light up as the drag passes over it.
      if (!key) { var mdkHover = findMonthDayKey(px, py); if (mdkHover) key = "M:" + mdkHover; }
      if (key !== dragOverRef.current) { dragOverRef.current = key; setDragOverKey(key); }
    };
    var onEnd = function(e) {
      if (!mine(e)) return;
      var ds = dragStateRef.current;
      var px = (e.clientX!=null) ? e.clientX : (dragPosRef.current ? dragPosRef.current.x : null);
      var py = (e.clientY!=null) ? e.clientY : (dragPosRef.current ? dragPosRef.current.y : null);
      // Held and let go without dragging: treat as "open this person's profile",
      // not a move. (Single pickup only — a multi/group hold just cancels cleanly.)
      // v75: goes through the shared openHeldProfileNow so a still RELEASE and the
      // snappy auto-open tear the drag down identically — and the sentinel inside
      // makes this a no-op if the timer already opened the profile a beat earlier.
      if (!dragMovedRef.current) {
        openHeldProfileNow();
        return;
      }
      var landed = false;
      var keepDragForCal = false; // v82 (#4): true when a dead-space group drop hands off to the day picker (dragState must survive)
      if (ds && ds.multi) {
        var anyKey = dragOverRef.current || (px!=null ? findAnyRowKey(px, py) : null);
        // v78: an "M:" key is a Month-view day cell (from the glide highlight), not a
        // slot row — peel it off so it routes to the month branch, not the row parser.
        var monthOverM = (anyKey && anyKey.indexOf("M:")===0) ? anyKey.slice(2) : null;
        if (monthOverM) anyKey = null;
        var dayKey = dayKeyFromRow(anyKey);
        if (dayKey && anyKey) {
          // v78: dropped on a specific slot row — Granger chose that spot, so pack
          // the group in starting exactly there, on ANY visible day. (v77 only did
          // this for same-day drops; cross-day fell into dropMultiOnDay, which
          // snapped everyone to their original times and detached the joint link.)
          var gp = anyKey.split("-"); var gi = parseInt(gp[gp.length-1]);
          landed = dropGroupAtSlot(dayKey, gi);
        }
        // Dropped on a Month-view day: never auto-place. Open that day and walk the
        // whole group through tap-to-place, re-joined as they land.
        // (v77 called dropMultiOnDay(mdkM) here — kept dormant below as the lever.)
        if (!landed && (monthOverM || px!=null)) {
          var mdkM = monthOverM || ((px!=null) ? findMonthDayKey(px, py) : null);
          if (mdkM) { queueGroupTapToPlace(mdkM, ds); landed = true; }
          // v77 fallback lever: if (mdkM) landed = dropMultiOnDay(mdkM);
        }
        // v82 (#4): group released on dead space (no slot row, no month-day cell) used
        // to silently cancel. Instead hand the whole group to the day picker so it
        // carries into tap-to-place together — the same recovery onCancel already uses
        // for an OS-aborted multi drag. dragState is preserved for handleDragDrop.
        if (!landed) {
          setDragCalOpen(true); setDragCalMonth(new Date()); setDragCalHover(true);
          keepDragForCal = true; landed = true;
        }
      } else {
        var key = dragOverRef.current;
        // v78: "M:" keys are Month-view day cells (glide highlight) — not slot rows.
        // Peel the day off so the month branch below handles it; never row-parse it.
        var monthOverS = (key && key.indexOf("M:")===0) ? key.slice(2) : null;
        if (monthOverS) key = null;
        if (!key && px!=null) key = findDropKeyNear(px, py);
        if (key) {
          var parts = key.split("-"); var di = parseInt(parts[parts.length-1]); var dk2 = parts.slice(0,parts.length-1).join("-");
          landed = dropPickedUpOnSlot(dk2, di);
        }
        // Dropped on a Month-view day cell: open that day in Day view and finish
        // the move with one tap-to-place on whatever open slot they choose.
        if (!landed && (monthOverS || px!=null)) {
          var mdk = monthOverS || ((px!=null) ? findMonthDayKey(px, py) : null);
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
      swipeNavStart.current = null; // v90 (#8): second belt on the day-jump — pointerup lands before touchend
      setIsLiveDragging(false); dragLiftedRef.current = false; setDragLifted(false);
      dragOverRef.current = null; setDragOverKey(null);
      if (!keepDragForCal) setDragState(null); // v82 (#4): keep the group alive for the day picker
    };
    var onCancel = function(e) {
      if (!mine(e)) return;
      // Rare with pointer capture, but if the OS still aborts: complete the drop if
      // the finger was over an open slot, otherwise hand a single move to
      // tap-to-place and a group/multi move to the picker.
      if (profileHoldTimer.current) { clearTimeout(profileHoldTimer.current); profileHoldTimer.current = null; }
      releaseDragPointer();
      swipeNavStart.current = null; // v90 (#8): same disarm on an OS-cancelled drag
      setIsLiveDragging(false); dragLiftedRef.current = false; setDragLifted(false);
      var overKey = dragOverRef.current;
      dragOverRef.current = null; setDragOverKey(null);
      var ds = dragStateRef.current;
      if (!ds) return;
      // A hold that never moved, then got cancelled by the OS: just drop the
      // pickup cleanly — don't fall into move/place mode.
      if (!dragMovedRef.current) { setDragState(null); return; }
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
    var dsCal = dragState;
    setDragCalOpen(false); setDragState(null); setDragCalHover(false);
    // v78: delegate to the shared group-aware queue so a joint group picked from the
    // calendar keeps its link (shared groupId) as the taps place each member, and
    // members go in time order. v77 body kept as the fallback lever:
    //   var clients = dsCal.clients;
    //   setSelectMode(false); setSelectedSlots({});
    //   setBaseDate(parseDateKey(targetDateKey)); setView(isPhone?"Day":"3-Day");
    //   var first = clients[0]; var rest = clients.slice(1);
    //   setReassignQueue(rest);
    //   setReassignMode({client:{name:first.name,price:first.price,recurWeeks:first.recurWeeks},currentDateKey:targetDateKey,remainingConflicts:[],originalDateKey:first.originalDateKey,originalIdx:first.originalIdx});
    queueGroupTapToPlace(targetDateKey, dsCal);
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
    // v82: preserve the pencil across the move here too (mouse drop path) so a penciled
    // client doesn't auto-lock, and report it as penciled rather than locked in.
    var srcSlotHS = getSlots(client.originalDateKey)[client.originalIdx] || {};
    var wasPendingHS = !!srcSlotHS.pending;
    var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))}; pushUndo(snapshot);
    var ts = [...getSlots(targetDateKey)];
    ts[targetIdx] = {...ts[targetIdx],name:client.name,price:client.price,recurWeeks:client.recurWeeks,done:false,pending:wasPendingHS};
    setSlots(targetDateKey, ts);
    var os = [...getSlots(client.originalDateKey)];
    os[client.originalIdx] = {...os[client.originalIdx],name:"",price:"",done:false,recurWeeks:null,isException:false};
    setSlots(client.originalDateKey, os);
    addHistoryEntry(wasPendingHS?{type:"added",time:ts[targetIdx].time,name:client.name,price:client.price,dateKey:targetDateKey,bannerType:"penciled"}:{type:"added",time:ts[targetIdx].time,name:client.name,price:client.price,dateKey:targetDateKey});
    setDragState(null); setDragCalOpen(false);
  };

  const handleReassignSlotTapWithQueue = function(dateKey, idx) {
    if (!reassignMode || reassignMode.currentDateKey !== dateKey) return;
    var client = reassignMode.client; var rc = reassignMode.remainingConflicts;
    var slots = [...getSlots(dateKey)]; var slot = slots[idx];
    if (slot.name) return;
    // v93 SILENT-MOVE HOLE #2. Same question on the drag-calendar path (pick somebody up,
    // drop them on a day in the little calendar, then tap the slot). Scoped hard to a
    // LONE recurring client actually being MOVED: not a group, not a queue drain, and not
    // a conflict jump or a fresh check-off placement — those carry no originalDateKey, so
    // the guard excludes them and they behave exactly as before.
    // Revert lever: delete this block.
    if (client.recurWeeks != null && reassignMode.originalDateKey && reassignMode.originalIdx !== undefined
        && reassignQueue.length === 0 && !(reassignMode.groupSize > 1) && !client.groupId && rc.length === 0) {
      var srcQ = getSlots(reassignMode.originalDateKey)[reassignMode.originalIdx] || {};
      setSeriesEditModal({field:"drop", dateKey:reassignMode.originalDateKey, idx:reassignMode.originalIdx, targetDateKey:dateKey, targetIdx:idx, name:client.name, price:client.price, recurWeeks:client.recurWeeks, pending:!!srcQ.pending, oldTime:srcQ.time||"", newTime:slot.time});
      setReassignMode(null); setReassignQueue([]);
      return;
    }
    var snapshot = {schedules:JSON.parse(JSON.stringify(schedulesRef.current))}; pushUndo(snapshot);
    // v78: groupId travels with the queued client (a joint group placed via
    // tap-to-place re-joins as each member lands); explicitly null for everyone
    // else so a stale link on the empty slot can never be inherited by accident.
    var ns = [...slots]; ns[idx] = {...slot,name:client.name,price:client.price,recurWeeks:client.recurWeeks,isException:true,done:false,groupId:(client.groupId||null)};
    setSlots(dateKey, ns); addHistoryEntry({type:"added",time:slot.time,name:client.name,price:client.price,dateKey});
    if (reassignMode.originalDateKey && reassignMode.originalIdx !== undefined) {
      var os = [...getSlots(reassignMode.originalDateKey)]; var os2 = os[reassignMode.originalIdx];
      // v78: the vacated slot also drops any old joint link (matches the drag paths).
      os[reassignMode.originalIdx] = {...os2,name:"",price:"",done:false,recurWeeks:null,isException:false,groupId:null};
      setSlots(reassignMode.originalDateKey, os);
      addHistoryEntry({type:"removed",time:os2.time,name:client.name,dateKey:reassignMode.originalDateKey});
    }
    if (reassignQueue.length > 0) {
      var next = reassignQueue[0]; var rest = reassignQueue.slice(1);
      setReassignQueue(rest);
      // v87 (#5b): carry the ORIGINAL groupSize forward unchanged as the queue drains, so
      // the banner keeps showing the fixed batch size (e.g. "all 5") rather than the
      // shrinking remaining count. (Absent groupSize -> banner falls back to live count.)
      setReassignMode({client:{name:next.name,price:next.price,recurWeeks:next.recurWeeks,groupId:(next.groupId||null)},currentDateKey:dateKey,remainingConflicts:[],groupSize:reassignMode.groupSize,originalDateKey:next.originalDateKey,originalIdx:next.originalIdx});
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
  // v98 THE MODAL USED TO ONLY LOOK WHERE IT EXPECTED HIM TO BE. #11 above answers one
  // question — "is he booked on his USUAL next date?" — and if the answer is no it declares
  // that date open and offers to book it. But "no" has two very different meanings: he isn't
  // booked at all (offer away), or you MOVED him and he is locked in somewhere else entirely.
  // In the second case the modal was cheerfully hiding a real appointment and inviting a
  // double-book. So we also look at the earliest future booking he actually has (computed at
  // open time as alreadyBookedKey) and, when that sits on a date OTHER than the usual one,
  // that is the truth and it is what gets shown. Read-only: this looks things up and renders
  // a banner. It writes nothing, and it does not touch the recurring engine.
  const adjustedNextKey = (function(){
    if (!checkoffModal || checkoffModal.notRecurring) return null;
    var ab = checkoffModal.alreadyBookedKey;
    if (!ab) return null;
    if (ab === effectiveNextDate) return null; // he's on his usual date; #11 already has this
    // nudgedDate is SEEDED to the usual date on open, so its mere presence means nothing.
    // But once it DIFFERS from nextDateKey, Granger is actively picking a date right now in
    // this modal — stand down and let the existing open/taken cards speak about HIS choice,
    // or he could never book the nudged date he just tapped.
    if (nudgedDate && checkoffModal.nextDateKey && nudgedDate !== checkoffModal.nextDateKey) return null;
    return ab;
  })();
  const adjustedNextTime = (function(){
    if (!adjustedNextKey || !checkoffModal || !checkoffModal.slot || !checkoffModal.slot.name) return null;
    var dsA = schedulesRef.current[adjustedNextKey]; if (!dsA) return null;
    var lnA = checkoffModal.slot.name.toLowerCase(); var ai;
    for (ai=0; ai<dsA.length; ai++) { if (dsA[ai].name && dsA[ai].name.toLowerCase()===lnA && !dsA[ai].blocked) return dsA[ai].time; }
    return null;
  })();

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
                style={{position:"relative",height:"44px",background:disabled?"#f8f8f8":holiday?"#fffbf0":isT?"#fffbf0":"#ffffff",borderTop:isT?("2px solid "+TODAY_BLUE):"2px solid transparent",padding:"4px 5px",cursor:disabled?"default":"pointer",borderRadius:"3px",opacity:disabled?0.35:1,boxSizing:"border-box"}}>
                {!disabled&&weekMarks[dk]&&<div style={{position:"absolute",top:"2px",right:"2px",fontSize:"8px",fontWeight:"bold",color:"#a07830",background:"#fdf3df",borderRadius:"3px",padding:"1px 2px",lineHeight:1}}>{weekMarks[dk]+"w"}</div>}
                <div style={{fontSize:"12px",color:isT?TODAY_BLUE:disabled?"#ccc":"#1a1a1a",fontWeight:isT?"bold":"normal",lineHeight:1}}>{day.getDate()}</div>
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

  var bannerInline = !!banner && !isPhone && splitBannerRoom;
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
        // v90 (#8): the reverse case was the bug. A drag that ENDS here has already had
        // its live/dragState flags cleared by pointerup (pointerup precedes touchend), so
        // those two guards were useless and a sideways drop read as a swipe. The drag now
        // nulls swipeNavStart.current on its first real movement, so this whole block is
        // skipped for any gesture that became a drag. The guards below are kept as-is.
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

      {/* Build stamp — lets the deploy be verified at a glance. Bump on each push. */}
      <div style={{position:"fixed",left:"4px",bottom:"calc(env(safe-area-inset-bottom,0px) + 2px)",zIndex:2700,fontSize:"9px",letterSpacing:"0.08em",color:"rgba(140,140,140,0.55)",fontFamily:"Georgia,serif"}}>v99</div>

      {/* Kill the browser's double-tap-to-zoom and the legacy 300ms tap delay so the app
          feels native and our own double-tap-to-mark-available gesture wins. "manipulation"
          still allows normal one-finger panning and two-finger pinch-zoom. */}
      <style>{"html,body,#root{height:100%;margin:0;padding:0}body{overflow:hidden}html,body,#root,*{touch-action:manipulation;-webkit-text-size-adjust:100%}@keyframes tlInRight{from{transform:translateX(42px);opacity:0.35}to{transform:translateX(0);opacity:1}}@keyframes tlInLeft{from{transform:translateX(-42px);opacity:0.35}to{transform:translateX(0);opacity:1}}@keyframes tlFlashG{0%{background-color:#9ed69e}35%{background-color:#e0f4e0}70%{background-color:#9ed69e}100%{background-color:#e0f4e0}}@keyframes tlFlashR{0%{background-color:#e6a49b}35%{background-color:#f6dbd6}70%{background-color:#e6a49b}100%{background-color:#f6dbd6}}@keyframes tlFlashD{0%{background-color:#dcc07a}35%{background-color:#f1e6c6}70%{background-color:#dcc07a}100%{background-color:#f1e6c6}}@keyframes tlFlashN{0%{background-color:#c8c8c8}35%{background-color:#ececec}70%{background-color:#c8c8c8}100%{background-color:#ececec}}"}</style>

      {banner && !bannerInline && (
        <div
          onTouchStart={function(e){ if(e.touches&&e.touches.length===1){ bannerTouchStart.current=e.touches[0].clientY; } }}
          onTouchMove={function(e){ if(bannerTouchStart.current==null||!e.touches||!e.touches.length) return; var dy=e.touches[0].clientY-bannerTouchStart.current; setBannerSwipeY(Math.min(0,dy)); }}
          onTouchEnd={function(){ var dy=bannerSwipeY; bannerTouchStart.current=null; if(dy<-30){ dismissBanner(); } else { setBannerSwipeY(0); } }}
          onClick={function(){ onBannerTap(); }}
          style={{position:"fixed",left:"50%",top:isPhone?"auto":(gridTopY>0?(gridTopY/2+"px"):listTopY>0?(listTopY/2+"px"):"calc(env(safe-area-inset-top,0px) + 8px)"),bottom:isPhone?"calc(env(safe-area-inset-bottom,0px) + 18px)":"auto",transform:((!isPhone&&(gridTopY>0||listTopY>0))?"translate(-50%,-50%)":"translateX(-50%)")+" translateY("+bannerSwipeY+"px)",opacity:Math.max(0.2,1+bannerSwipeY/80),transition:bannerSwipeY===0?"transform 0.2s ease, opacity 0.2s ease":"none",zIndex:2000,background:getBannerColor(banner.type),color:"#fff",padding:"6px 14px",borderRadius:"20px",fontSize:"12px",letterSpacing:"0.04em",boxShadow:"0 2px 12px rgba(0,0,0,0.2)",display:"flex",alignItems:"center",gap:"10px",maxWidth:"90vw",pointerEvents:"auto",touchAction:"none"}}>
          <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{describeBanner(banner)}</span>
          {(banner.type!=="undo"&&banner.type!=="redo"&&canUndo)&&(
            <button onClick={function(e){ e.stopPropagation(); handleUndo(); }} title="Undo" style={{background:"rgba(255,255,255,0.22)",border:"none",borderRadius:"10px",color:"#fff",padding:"4px 9px",cursor:"pointer",fontFamily:"inherit",flexShrink:0,display:"flex",alignItems:"center"}}><UndoIcon size={15} color="#fff"/></button>
          )}
        </div>
      )}

      {isLiveDragging && dragLifted && dragState && (
        <div ref={dragChipRef}
          style={{position:"fixed",left:0,top:0,zIndex:3000,pointerEvents:"none",background:"#1a1a1a",color:"#fff",padding:"8px 14px",borderRadius:"9px",fontSize:"14px",fontFamily:"Georgia,serif",boxShadow:"0 8px 24px rgba(0,0,0,0.35)",whiteSpace:"nowrap",transform:dragChipTransform(dragPosRef.current.x, dragPosRef.current.y)}}>
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
                          style={{textAlign:"center",fontSize:"14px",color:isT?TODAY_BLUE:"#1a1a1a",fontWeight:isT?"bold":"normal",padding:"10px 2px",borderRadius:"6px",cursor:"pointer",background:isT?"#fffbf0":"#f8f8f6",border:"1px solid #efefed"}}
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

      {/* v98: 1100 -> 1300. The day-note popup sits at 1200, so the add-a-number prompt used
          to open BEHIND it — invisible — the instant it was raised from anywhere inside that
          popup (which the new standby message icon does). This is the same z-index fault that
          made a tapped standby name appear to do nothing: clientProfile is 1100 too. phoneModal
          is a prompt spawned BY other surfaces, so it belongs on top of all of them.
          Revert lever: put zIndex back to 1100. */}
      {phoneModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1300,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}} onClick={function(){ setPhoneModal(null); }}>
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
            <div style={{fontSize:"15px",color:"#1a1a1a",marginBottom:"18px",lineHeight:1.4}}>Step 1 of 2 — back up today's list?<div style={{fontSize:"11px",color:"#999",marginTop:"6px"}}>Saves the restore file. The schedule download comes next.</div></div>
            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={function(){ setDailyExportPrompt(false); }} style={{flex:"0 0 auto",padding:"12px 16px",background:"#f0f0ee",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"14px"}}>Skip</button>
              <button onClick={function(){ setDailyExportPrompt(false); setDailyDownloadPrompt(true); exportData(); }} style={{flex:1,padding:"12px",background:"#c9a96e",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"14px",fontWeight:"bold"}}>Export backup</button>
            </div>
          </div>
        </div>
      )}

      {dailyDownloadPrompt && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(320px,90vw)",textAlign:"center"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#aaa",marginBottom:"10px"}}>Backup Saved</div>
            <div style={{fontSize:"15px",color:"#1a1a1a",marginBottom:"18px",lineHeight:1.4}}>Step 2 of 2 — download the readable schedule?<div style={{fontSize:"11px",color:"#999",marginTop:"6px"}}>The plain-text copy of your day, with phone numbers.</div></div>
            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={function(){ setDailyDownloadPrompt(false); }} style={{flex:"0 0 auto",padding:"12px 16px",background:"#f0f0ee",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"14px"}}>Skip</button>
              <button onClick={function(){ exportReadable(); setDailyDownloadPrompt(false); }} style={{flex:1,padding:"12px",background:"#c9a96e",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"14px",fontWeight:"bold"}}>Download schedule</button>
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

      {/* v93: aftermath of a whole-series day shift. Only appears when at least one future
          visit could NOT be slid because somebody else already owns that spot on the new
          date. Those visits were left exactly where they were — nothing is ever silently
          dropped — and this says which ones so they can be sorted out by hand. */}
      {seriesShiftReport && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:1160,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px",boxSizing:"border-box"}} onClick={function(){ setSeriesShiftReport(null); }}>
          <div style={{background:"#ffffff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"26px 26px 22px",width:"min(400px,92vw)",maxHeight:"80vh",overflowY:"auto"}} onClick={function(e){ e.stopPropagation(); }}>
            {/* v95: the headline is no longer "N could not." Every visit moves now. The ones
                that landed on an occupied time SHARE it — the paired row this app has always
                drawn — and are listed in gold as an FYI, not a failure. The red list is only
                for a visit that hit a LUNCH block, which is the one thing that cannot be
                shared and so is the one thing still left behind.
                Revert lever — the v94 blocked-only body:
                <div ...color:"#c0392b"...>Series moved</div>
                <div ...>{seriesShiftReport.moved} visit{...} slid {phrase}. {blocked.length} could not.</div>
                <div ...>Somebody else was already in that spot on the new date, so {name} was left where he was on these dates. Move them by hand.</div>
                {seriesShiftReport.blocked.map(...)} */}
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:((seriesShiftReport.blocked||[]).length>0?"#c0392b":"#8a6d3b"),marginBottom:"8px"}}>Series moved</div>
            <div style={{fontSize:"15px",color:"#1a1a1a",marginBottom:"6px"}}>{seriesShiftReport.moved} visit{seriesShiftReport.moved===1?"":"s"} slid {seriesShiftReport.phrase}.{(seriesShiftReport.shared||[]).length>0?(" "+(seriesShiftReport.shared||[]).length+" of them "+((seriesShiftReport.shared||[]).length===1?"is":"are")+" sharing a slot."):""}{(seriesShiftReport.blocked||[]).length>0?(" "+(seriesShiftReport.blocked||[]).length+" could not move."):""}</div>
            <div style={{fontSize:"12px",color:"#888",marginBottom:"16px"}}>{(seriesShiftReport.shared||[]).length>0?("Somebody was already booked at that time on the new date, so "+(seriesShiftReport.name||"this client")+" is doubled up with them. Nobody was left behind — separate them by hand if you'd rather."):("A lunch block sits on that time on the new date, so "+(seriesShiftReport.name||"this client")+" was left where he was. Move them by hand.")}</div>
            <div style={{marginBottom:"16px"}}>
              {(seriesShiftReport.shared||[]).map(function(b,i){ return (
                <div key={"s"+i} style={{padding:"9px 10px",marginBottom:"4px",background:"#fdf8ec",border:"1px solid #e4d3ac",borderRadius:"6px"}}>
                  <div style={{fontSize:"12px",color:"#1a1a1a"}}>{friendlyDate(b.fromDateKey)} {"\u2192"} {friendlyDate(b.dateKey)} {"\u00b7"} {b.time}</div>
                  <div style={{fontSize:"11px",color:"#8a6d3b",marginTop:"2px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>Sharing the slot with {b.existingName}</div>
                </div>
              ); })}
              {(seriesShiftReport.blocked||[]).map(function(b,i){ return (
                <div key={"b"+i} style={{padding:"9px 10px",marginBottom:"4px",background:"#fff5f4",border:"1px solid #f0d0cc",borderRadius:"6px"}}>
                  <div style={{fontSize:"12px",color:"#1a1a1a"}}>{friendlyDate(b.fromDateKey)} {"\u2192"} {friendlyDate(b.dateKey)} {"\u00b7"} {b.time}</div>
                  <div style={{fontSize:"11px",color:"#c0392b",marginTop:"2px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{b.existingName} blocks this time</div>
                </div>
              ); })}
            </div>
            <button onClick={function(){ setSeriesShiftReport(null); }} style={{width:"100%",padding:"10px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Got it</button>
          </div>
        </div>
      )}

      {seriesEditModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1150,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px",boxSizing:"border-box"}} onClick={function(){ setSeriesEditModal(null); }}>
          <div style={{background:"#f8f8f6",border:"1px solid #d8d8d6",borderRadius:"12px",padding:"26px 26px 22px",width:"min(360px,92vw)"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#4a8a9a",marginBottom:"8px"}}>Recurring appointment</div>
            <div style={{fontSize:"16px",color:"#1a1a1a",marginBottom:"6px"}}>{seriesEditModal.field==="time"?"Move this time for…":seriesEditModal.field==="drop"?"Move this appointment…":seriesEditModal.field==="lock"?"Lock in…":"Apply this change to…"}</div>
            <div style={{fontSize:"12px",color:"#888",marginBottom:"20px"}}>{seriesEditModal.field==="time"?((seriesEditModal.name||"This client")+" moves from "+seriesEditModal.oldTime+" to "+seriesEditModal.newTime+"."):seriesEditModal.field==="drop"?seriesDropBlurb(seriesEditModal):seriesEditModal.field==="lock"?((seriesEditModal.name||"This client")+" is penciled in"+(seriesEditModal.time?(" at "+seriesEditModal.time):"")+"."):((seriesEditModal.oldName||"This client")+(seriesEditModal.newName&&seriesEditModal.newName!==seriesEditModal.oldName?(" \u2192 "+seriesEditModal.newName):"")+".")}</div>
            <button onClick={function(){ if(seriesEditModal.field==="time"){ applySeriesTime("all"); } else if(seriesEditModal.field==="drop"){ applySeriesDrop("all"); } else if(seriesEditModal.field==="lock"){ applySeriesLock("all"); } else { applySeriesNamePrice("all"); } }} style={{display:"block",width:"100%",padding:"12px",background:"#1a1a1a",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"14px",marginBottom:"10px"}}>All of {(seriesEditModal.field==="nameprice"?seriesEditModal.oldName:seriesEditModal.name)||"this client"}'s appointments</button>
            <button onClick={function(){ if(seriesEditModal.field==="time"){ applySeriesTime("one"); } else if(seriesEditModal.field==="drop"){ applySeriesDrop("one"); } else if(seriesEditModal.field==="lock"){ applySeriesLock("one"); } else { applySeriesNamePrice("one"); } }} style={{display:"block",width:"100%",padding:"12px",background:"#ffffff",border:"1px solid #d0d0ce",borderRadius:"8px",color:"#1a1a1a",cursor:"pointer",fontFamily:"inherit",fontSize:"14px",marginBottom:"14px"}}>Just this one</button>
            <button onClick={function(){ setSeriesEditModal(null); }} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#aaa",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Cancel</button>
          </div>
        </div>
      )}

      {importConfirm && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1150,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px",boxSizing:"border-box"}} onClick={function(){ setImportConfirm(null); }}>
          <div style={{background:"#f8f8f6",border:"1px solid #d8d8d6",borderRadius:"12px",padding:"26px 26px 22px",width:"min(360px,92vw)"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#a97a4a",marginBottom:"8px"}}>Import backup</div>
            <div style={{fontSize:"16px",color:"#1a1a1a",marginBottom:"6px"}}>Import the backup from {importConfirm.whenText}?</div>
            <div style={{fontSize:"12px",color:"#888",marginBottom:"20px"}}>This replaces everything currently on The List — appointments, profiles, notes, and accounting.</div>
            <button onClick={applyImport} style={{display:"block",width:"100%",padding:"12px",background:"#1a1a1a",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"14px",marginBottom:"14px"}}>Import</button>
            <button onClick={function(){ setImportConfirm(null); }} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#aaa",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Cancel</button>
          </div>
        </div>
      )}

      {profilePriceModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:1150,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px",boxSizing:"border-box"}} onClick={function(){ setProfilePriceModal(null); }}>
          <div style={{background:"#f8f8f6",border:"1px solid #d8d8d6",borderRadius:"12px",padding:"26px 26px 22px",width:"min(360px,92vw)"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#4a8a9a",marginBottom:"8px"}}>Price change</div>
            <div style={{fontSize:"16px",color:"#1a1a1a",marginBottom:"6px"}}>Change {profilePriceModal.name}'s price to…</div>
            <div style={{fontSize:"12px",color:"#888",marginBottom:"20px"}}>{"\u201cAlways\u201d sets "+profilePriceModal.name+"'s price to "+(profilePriceModal.newPrice?("$"+profilePriceModal.newPrice):"no set price")+" for this appointment, every upcoming appointment they already have, and their saved profile. \u201cJust this time\u201d changes only this appointment."}</div>
            <button onClick={function(){ applyProfilePrice("always"); }} style={{display:"block",width:"100%",padding:"12px",background:"#1a1a1a",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"14px",marginBottom:"10px"}}>Always for {profilePriceModal.name}</button>
            <button onClick={function(){ applyProfilePrice("once"); }} style={{display:"block",width:"100%",padding:"12px",background:"#ffffff",border:"1px solid #d0d0ce",borderRadius:"8px",color:"#1a1a1a",cursor:"pointer",fontFamily:"inherit",fontSize:"14px",marginBottom:"14px"}}>Just this time</button>
            <button onClick={function(){ setProfilePriceModal(null); }} style={{display:"block",width:"100%",padding:"8px",background:"none",border:"none",color:"#aaa",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Cancel</button>
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
            {/* v79 lever — revert to this exact line to drop the "next:" name and return to the bare count:
            <div style={{fontSize:"14px"}}>Tap any open slot for <strong>{reassignMode.client.name}</strong>{reassignQueue.length>0?(" (+"+(reassignQueue.length)+" more)"):""} on {friendlyDate(reassignMode.currentDateKey)}</div>
            */}
            {/* v80 lever — revert to this exact line to drop the pair-aware "both/all" wording and return to the "(+N more)" count:
            <div style={{fontSize:"14px"}}>Tap any open slot for <strong>{reassignMode.client.name}</strong>{reassignQueue.length>0?(" (+"+(reassignQueue.length)+" more)"):""}{(reassignQueue.length>0&&reassignQueue[0]&&reassignQueue[0].name)?(" · next: "+reassignQueue[0].name):""} on {friendlyDate(reassignMode.currentDateKey)}</div>
            */}
            {/* v87 (#5b): FIXED original group size (Granger's choice over live-remaining). gs is
               captured into reassignMode.groupSize at queue-create (three paths) and carried
               through the advance, so a group of 5 reads "all 5" for every placement and a pair
               reads "both" the whole way — the count does NOT count down. The "· next:" part stays
               LIVE (real next person; vanishes on the last placement). Falls back to the old live
               count (reassignQueue.length+1) when groupSize is absent (e.g. a conflict-only reassign
               that never set it) so nothing regresses.
               v82 lever — revert to LIVE remaining count (count down as members land):
               <div style={{fontSize:"14px"}}>Tap any open slot for <strong>{reassignMode.client.name}</strong>{reassignQueue.length===1?" — placing both":(reassignQueue.length>=2?(" — placing all "+(reassignQueue.length+1)):"")}{(reassignQueue.length>0&&reassignQueue[0]&&reassignQueue[0].name)?(" · next: "+reassignQueue[0].name):""} on {friendlyDate(reassignMode.currentDateKey)}</div>
            */}
            <div style={{fontSize:"14px"}}>Tap any open slot for <strong>{reassignMode.client.name}</strong>{(function(){ var gs=(typeof reassignMode.groupSize==="number"?reassignMode.groupSize:(reassignQueue.length+1)); return gs===2?" — placing both":(gs>=3?(" — placing all "+gs):""); })()}{(reassignQueue.length>0&&reassignQueue[0]&&reassignQueue[0].name)?(" · next: "+reassignQueue[0].name):""} on {friendlyDate(reassignMode.currentDateKey)}</div>
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

      {sharedRemove && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={function(){ setSharedRemove(null); }}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(320px,90vw)",textAlign:"center"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#aaa",marginBottom:"10px"}}>Remove From Slot</div>
            <div style={{fontSize:"15px",color:"#1a1a1a",marginBottom:"4px"}}>{sharedRemove.name}</div>
            <div style={{fontSize:"12px",color:"#999",marginBottom:"18px"}}>at {sharedRemove.time} · the other person keeps the slot</div>
            <div style={{display:"flex",gap:"8px"}}>
              <button onClick={function(){ setSharedRemove(null); }} style={{flex:1,padding:"11px",background:"#f0f0ee",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#777",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Keep</button>
              <button onClick={function(){
                var m=sharedRemove; if(!m){ return; }
                if (m.groupId) {
                  cancelGroupSlots(m.dateKey, m.groupId, m.idx);
                } else {
                  var snap={schedules:JSON.parse(JSON.stringify(schedulesRef.current))}; pushUndo(snap);
                  var slots=[...getSlots(m.dateKey)];
                  var s=slots[m.idx];
                  slots=vacateSlotCollapsing(slots, m.idx);
                  addHistoryEntry({type:"removed",time:s.time,name:s.name,dateKey:m.dateKey});
                  setSlots(m.dateKey,slots);
                }
                setSharedRemove(null);
              }} style={{flex:1,padding:"11px",background:"#c0392b",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {clientProfile && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1100,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={function(){ setClientProfile(null); }}>
          <div style={{background:"#ffffff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"28px 28px 24px",width:"min(420px,92vw)",maxHeight:"82vh",display:"flex",flexDirection:"column",userSelect:"none",WebkitUserSelect:"none"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"6px"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#aaa",marginBottom:"4px"}}>Client Profile</div>
                {renamingProfile ? (
                  <div style={{display:"flex",gap:"6px",alignItems:"center",flexWrap:"wrap"}}>
                    <input autoFocus value={renameValue} onChange={function(e){ setRenameValue(e.target.value); }}
                      onKeyDown={function(e){ if(e.key==="Enter"){ renameClient(clientProfile.name, renameValue); setRenamingProfile(false); } else if(e.key==="Escape"){ setRenamingProfile(false); } }}
                      style={{...inputStyle,fontSize:"18px",flex:"1 1 140px",minWidth:0,userSelect:"text",WebkitUserSelect:"text"}}/>
                    <button onClick={function(){ renameClient(clientProfile.name, renameValue); setRenamingProfile(false); }} style={{padding:"7px 12px",background:"#2a6a2a",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",flexShrink:0}}>Save</button>
                    <button onClick={function(){ setRenamingProfile(false); }} style={{padding:"7px 12px",background:"#f0f0ee",border:"1px solid #d8d8d6",borderRadius:"8px",color:"#777",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",flexShrink:0}}>Cancel</button>
                  </div>
                ) : (
                  <div style={{display:"flex",gap:"8px",alignItems:"baseline"}}>
                    <div style={{fontSize:"20px",color:"#1a1a1a"}}>{clientProfile.name}</div>
                    <button onClick={function(){ setRenameValue(clientProfile.name); setRenamingProfile(true); }} style={{background:"none",border:"none",color:"#a0a0a0",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",padding:"2px 4px",flexShrink:0,textDecoration:"underline"}}>Edit name</button>
                  </div>
                )}
              </div>
            </div>
            {clientProfile.recurWeeks && <div style={{fontSize:"12px",color:"#6a8aaa",marginBottom:"12px"}}>{"↺"} Every {clientProfile.recurWeeks===1?"week":(clientProfile.recurWeeks+" weeks")} · usual time {clientProfile.usualTime}</div>}
            {clientProfile.recurWeeks && <button onClick={function(){
              var nm=clientProfile.name;
              var rb=clientProfile.bookings.find(function(b){ return b.recurWeeks&&!b.done; })||clientProfile.bookings.find(function(b){ return b.recurWeeks; });
              if(!rb) return;
              var dk=rb.dateKey; var ds=getSlots(dk);
              var ix=ds.findIndex(function(s){ return s.name===nm&&s.recurWeeks; });
              if(ix<0) ix=ds.findIndex(function(s){ return s.name===nm; });
              if(ix<0) return;
              var sl=ds[ix];
              setClientProfile(null);
              setTimeout(function(){
                if(sl.groupId){ var aS=getSlots(dk); var gS=aS.map(function(s,i){ return {...s,i}; }).filter(function(s){ return s.groupId===sl.groupId&&s.name; }); if(gS.length>1){ setGroupRecurModal({dateKey:dk,idx:ix,slot:sl,groupSlots:gS,weeks:null}); return; } }
                setRecurringModal({dateKey:dk,idx:ix,slot:sl});
              },40);
            }} style={{padding:"9px",background:"none",border:"1px solid #b8cce0",borderRadius:"8px",color:"#34657d",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",marginBottom:"14px"}}>{"↺"} Edit or cancel recurring</button>}
            <button onClick={function(){ jumpToDateForBooking(toDateKey(addWeeks(new Date(),2)), clientProfile); setClientProfile(null); }} style={{padding:"10px",background:"#c9a96e",border:"none",borderRadius:"8px",color:"#0f0f0f",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",marginBottom:"14px"}}>Book next appointment</button>
            <div style={{display:"flex",gap:"6px",alignItems:"center",marginBottom:"14px"}}>
              <input type="tel" inputMode="tel" autoComplete="off" value={clientProfile.phone||""} placeholder="Phone number"
                onChange={function(e){ var v=e.target.value; setClientProfile(function(p){ return p?{...p,phone:v}:p; }); setClientPhone(clientProfile.name, v); }}
                style={{flex:1,padding:"8px 10px",border:"1px solid #d8d8d6",borderRadius:"8px",fontFamily:"inherit",fontSize:"13px",color:"#1a1a1a",background:"#fcfcfb",minWidth:0,userSelect:"text",WebkitUserSelect:"text"}} />
              {(clientProfile.phone||"").replace(/[^0-9+]/g,"")?<button onClick={function(){ window.location.href="sms:"+(clientProfile.phone||"").replace(/[^0-9+]/g,""); }} style={{padding:"8px 12px",background:"#2a6a2a",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",flexShrink:0}}>Message</button>:null}
              {(clientProfile.phone||"").replace(/[^0-9+]/g,"")?<button onClick={function(){ window.location.href="tel:"+(clientProfile.phone||"").replace(/[^0-9+]/g,""); }} style={{padding:"8px 12px",background:"#f0f0ee",border:"1px solid #d8d8d6",borderRadius:"8px",color:"#555",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",flexShrink:0}}>Call</button>:null}
            </div>
            {/* v98 THE CLIENT NOTE. One note per person, written and read here and nowhere
                else, saved on the same client-memory card as the phone and price (so it
                syncs with them for free — no new Firebase field, no new write path). Saves
                on every keystroke, exactly like the phone field directly above it. Revert
                lever: delete this block and the schedule-row pencil (also commented out,
                see the row icons) and slot notes come straight back. */}
            <div style={{marginBottom:"14px"}}>
              <div style={{fontSize:"10px",letterSpacing:"0.12em",textTransform:"uppercase",color:"#a07830",marginBottom:"6px"}}>{"Note"}</div>
              <textarea value={clientProfile.note||""} placeholder={"Anything worth remembering about "+clientProfile.name+"…"}
                onChange={function(e){ var v=e.target.value; setClientProfile(function(p){ return p?{...p,note:v}:p; }); setClientNote(clientProfile.name, v); }}
                rows={3}
                style={{width:"100%",boxSizing:"border-box",padding:"9px 10px",border:"1px solid #d8d8d6",borderRadius:"8px",fontFamily:"Georgia,serif",fontSize:"13px",lineHeight:1.45,color:"#1a1a1a",background:"#fcfcfb",resize:"vertical",outline:"none",userSelect:"text",WebkitUserSelect:"text"}} />
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
                      <button onClick={function(){ var dk=b.dateKey; setClientProfile(null); jumpToDate(dk); }}
                        style={{background:"none",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",padding:"5px 10px",fontFamily:"inherit",fontSize:"11px"}}
                        onMouseEnter={function(e){ e.currentTarget.style.borderColor="#1a1a1a";e.currentTarget.style.color="#1a1a1a"; }}
                        onMouseLeave={function(e){ e.currentTarget.style.borderColor="#d8d8d6";e.currentTarget.style.color="#888"; }}
                      >Jump to day</button>
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
            <div style={{borderTop:"1px solid #eee",marginTop:"14px",paddingTop:"12px"}}>
              {clientDeleteMsg ? (
                <div style={{fontSize:"12px",color:"#c0392b",lineHeight:1.4}}>{clientDeleteMsg}</div>
              ) : clientDeleteConfirm ? (
                <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                  <div style={{flex:1,fontSize:"12px",color:"#666"}}>Remove {clientProfile.name} from your client list?</div>
                  <button onClick={function(){
                    var nm=clientProfile.name;
                    setClientMemory(function(mem){ return mem.filter(function(c){ return !(c.name && c.name.toLowerCase()===nm.toLowerCase()); }); });
                    setClientDeleteConfirm(false); setClientProfile(null);
                    showBanner({type:"removed",msg:"Removed "+nm+" from your client list",time:null,dateKey:null});
                  }} style={{padding:"7px 12px",background:"#c0392b",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",flexShrink:0}}>Remove</button>
                  <button onClick={function(){ setClientDeleteConfirm(false); }} style={{padding:"7px 12px",background:"#f0f0ee",border:"1px solid #d8d8d6",borderRadius:"8px",color:"#777",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",flexShrink:0}}>Keep</button>
                </div>
              ) : (
                <button onClick={function(){
                  if (clientProfile.bookings && clientProfile.bookings.length>0) {
                    setClientDeleteMsg("Can't delete "+clientProfile.name+" yet — they still have upcoming appointments. Cancel those first, then delete.");
                    setClientDeleteConfirm(false);
                  } else {
                    setClientDeleteMsg(""); setClientDeleteConfirm(true);
                  }
                }} style={{background:"none",border:"none",color:"#c0a0a0",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",padding:"2px 0",textDecoration:"underline"}}>Delete client</button>
              )}
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
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#4a8a5a",marginBottom:"4px"}}>Done</div>
            <div onClick={function(){ var nm=checkoffModal.slot.name; setCheckoffModal(null);setNudgedDate(null);setCheckoffCalMonth(null);setCheckoffRecur(null);setRecurPickerOpen(false); openClientProfile(nm); }} title="View profile" style={{fontSize:"22px",marginBottom:"2px",paddingRight:"32px",cursor:"pointer",textDecoration:"underline",textDecorationColor:"#dcd2bd",textUnderlineOffset:"3px"}}>{checkoffModal.slot.name}</div>
            <div style={{fontSize:"12px",color:"#999",marginBottom:"18px"}}>{checkoffModal.slot.time} · {friendlyDate(checkoffModal.dateKey)}</div>
            {checkoffModal.alreadyBookedKey&&checkoffModal.notRecurring&&(
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
                {/* v98: HE IS NOT WHERE YOU LEFT HIM. His next visit was moved off the usual
                    date, so the three cards below (which only ever look at the usual date) are
                    suppressed entirely — per Granger, no offer to book the usual date, just the
                    truth about where he is actually locked in. Tap to go there. */}
                {adjustedNextKey&&<div onClick={function(){ var k=adjustedNextKey; setCheckoffModal(null);setNudgedDate(null);setCheckoffCalMonth(null);setCheckoffRecur(null);setRecurPickerOpen(false); jumpToDate(k); }} style={{background:"#eef3f9",border:"1px solid #b8cce0",borderRadius:"8px",padding:"12px 16px",marginBottom:"14px",fontSize:"13px",color:"#34434c",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px"}}><span>{"\u2713 Locked in \u2014 "}{adjustedNextTime?friendlyDateTime(adjustedNextTime,adjustedNextKey):friendlyDateLong(adjustedNextKey)} <span style={{color:"#7a8fa4"}}>(not his usual)</span></span><span style={{fontSize:"12px",color:"#5a7590",flexShrink:0}}>{"Tap to go \u203a"}</span></div>}
                {!adjustedNextKey&&effectiveNextDate&&!nudgeConflict&&alreadyBookedNextDate&&<div onClick={function(){ var k=effectiveNextDate; setCheckoffModal(null);setNudgedDate(null);setCheckoffCalMonth(null);setCheckoffRecur(null);setRecurPickerOpen(false); jumpToDate(k); }} style={{background:"#eef3f9",border:"1px solid #b8cce0",borderRadius:"8px",padding:"12px 16px",marginBottom:"14px",fontSize:"13px",color:"#34434c",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px"}}><span>{"✓"} Already booked — {friendlyDateTime(bookedTimeOnNextDate,effectiveNextDate)}</span><span style={{fontSize:"12px",color:"#5a7590",flexShrink:0}}>{"Tap to go ›"}</span></div>}
                {!adjustedNextKey&&effectiveNextDate&&!nudgeConflict&&!alreadyBookedNextDate&&<div onClick={function(){ confirmNextBooking(effectiveNextDate); }} style={{background:"#f0fff0",border:"1px solid #a0d0a0",borderRadius:"8px",padding:"12px 16px",marginBottom:"14px",fontSize:"13px",color:"#2a7a2a",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px"}}><span>{friendlyDateTime(placementTime(checkoffModal.slot),effectiveNextDate)} is open</span><span style={{fontSize:"12px",color:"#2a7a2a",flexShrink:0}}>{"Tap to book ›"}</span></div>}
                {!adjustedNextKey&&effectiveNextDate&&nudgeConflict&&<div onClick={function(){ var k=effectiveNextDate; setCheckoffModal(null);setNudgedDate(null);setCheckoffCalMonth(null);setCheckoffRecur(null);setRecurPickerOpen(false); jumpToDate(k); }} style={{background:"#fff0ee",border:"1px solid #e0b0a8",borderRadius:"8px",padding:"12px 16px",marginBottom:"14px",fontSize:"13px",color:"#1a1a1a",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px"}}><span>{"⚠"} That slot is taken on {friendlyDateTime(placementTime(checkoffModal.slot),effectiveNextDate)}</span><span style={{fontSize:"12px",color:"#8a4a3a",flexShrink:0}}>{"Tap to view ›"}</span></div>}
                {nudgedDate&&nudgedDate!==checkoffModal.nextDateKey&&<div style={{fontSize:"11px",color:"#a07830",marginBottom:"10px"}}>Nudged — resumes every {checkoffModal.slot.recurWeeks===1?"week":(checkoffModal.slot.recurWeeks+" weeks")} after this</div>}
                <div style={{fontSize:"11px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>Recurs every — change</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:"6px",marginBottom:"20px"}}>
                  {WEEK_OPTIONS.map(function(w){ var cur=checkoffModal.slot.recurWeeks===w; return <button key={w} onClick={function(){
                    if(cur) return;
                    var dk=checkoffModal.dateKey; var ix=checkoffModal.idx; var sl=checkoffModal.slot;
                    setCheckoffModal(null);setNudgedDate(null);setCheckoffCalMonth(null);setCheckoffRecur(null);setRecurPickerOpen(false);
                    setTimeout(function(){
                      if(sl.groupId){ var aS=getSlots(dk); var gS=aS.map(function(s,i){ return {...s,i}; }).filter(function(s){ return s.groupId===sl.groupId&&s.name; }); if(gS.length>1){ setGroupRecurModal({dateKey:dk,idx:ix,slot:sl,groupSlots:gS,weeks:null}); return; } }
                      setRecurring(dk,ix,w);
                    },40);
                  }} style={{padding:"7px 12px",borderRadius:"6px",border:"1px solid",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",background:cur?"#1a1a1a":"#f4f4f2",borderColor:cur?"#1a1a1a":"#d8d8d6",color:cur?"#fff":"#666"}}>{w===1?"Weekly":(w+"w")}</button>; })}
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

      {acctModal && (function(){
        var dk=acctModal.dateKey;
        var rec=acctFor(dk);
        var th=acctTakehome(rec);
        var methods=[["cash","Cash"],["square","Card"],["venmo","Venmo","sms:86753",null],["applepay","Apple Pay","shoebox://",null]];
        var draftVal=function(key){ return acctAdd[key]!==undefined?acctAdd[key]:(rec[key]?String(rec[key]):""); };
        var liveAmt=function(key){ return acctAdd[key]!==undefined?acctNum(acctAdd[key]):acctNum(rec[key]); };
        var liveTh=liveAmt("cash")+liveAmt("venmo")+liveAmt("applepay")+liveAmt("square");
        // B4: on the CURRENT day only, a live estimate (counting every booked name) fills the
        // services/hours fields as a preview. It is NOT in acctAdd, so it never persists on
        // its own — commitAll/onFieldBlur only write a field you actually typed. The moment
        // you type a number it lands in acctAdd, persists, and that field freezes (per-field:
        // editing services leaves hours still estimating, and vice-versa).
        var isTodayAcct = dk===toDateKey(new Date());
        var estToday = isTodayAcct ? acctAutoEstimate(dk, true) : null;
        // Displayed services/hours (typed > stored > today-estimate > 0), used for the two
        // read-only cross-check numbers so they track whatever the fields are showing.
        var svcDisp = acctAdd.services!==undefined ? acctNum(acctAdd.services) : (acctNum(rec.services)>0 ? acctNum(rec.services) : (estToday&&estToday.any ? acctNum(estToday.services) : 0));
        var hrsDisp = acctAdd.hours!==undefined ? acctNum(acctAdd.hours) : (acctNum(rec.hours)>0 ? acctNum(rec.hours) : (estToday&&estToday.any ? acctNum(estToday.hours) : 0));
        var dpsVal = svcDisp>0 ? liveTh/svcDisp : null;   // dollars per service
        var sphVal = hrsDisp>0 ? svcDisp/hrsDisp : null;  // services per hour
        var rowWrap={display:"flex",alignItems:"center",gap:"12px",marginBottom:"9px"};
        var rowLabel={width:"96px",flexShrink:0,fontSize:"15px",color:"#1a1a1a"};
        var symLabel={width:"96px",flexShrink:0,fontSize:"18px",color:"#a07830",fontFamily:"Georgia,serif"};
        var fieldInp={flex:1,minWidth:0,boxSizing:"border-box",padding:"9px 11px",border:"1px solid #ddd8cc",borderRadius:"8px",fontFamily:"Georgia,serif",fontSize:"16px",color:"#1a1a1a",background:"#fcfbf7",textAlign:"right",WebkitAppearance:"none",appearance:"none"};
        var onFieldChange=function(key){ return function(e){ var v=e.target.value; setAcctAdd(function(p){ var n={...p}; n[key]=v; return n; }); }; };
        // v68: tapping a field that already holds a number should land the caret at the END
        // so you can keep typing / backspace, instead of iOS dropping it at the far left.
        var onFieldFocus=function(e){ var el=e.target; var L=(el.value||"").length; setTimeout(function(){ try{ el.setSelectionRange(L,L); }catch(err){} }, 0); };
        var onFieldBlur=function(key){ return function(){ acctSetField(dk,key,acctAdd[key]!==undefined?acctAdd[key]:rec[key]); }; };
        var commitAll=function(){ var r={...acctFor(dk)}; ["cash","venmo","applepay","square","services","hours"].forEach(function(k){ if(acctAdd[k]!==undefined) r[k]=acctNum(acctAdd[k]); }); acctCommit(dk,r); };
        var closeAcct=function(){ commitAll(); setAcctModal(null); setAcctAdd({}); };
        // v71: one-tap launchers now live ON the payment word-labels themselves
        // (no separate button row). No public deep link lands on a specific balance
        // screen, so each just opens its app/thread: Square via web (iOS may open in
        // Safari); Venmo via the Messages thread to pay-shortcode 86753 (sms:); Apple
        // Pay via the Wallet scheme, unverified on current iOS (the on-device gamble).
        // Cash has no app, so its label stays a plain (non-tappable) word. commitAll
        // fires first so nothing typed is lost when the app switches away.
        // launchBtn kept (dormant) as a fallback lever in case the buttons return.
        var launchBtn={flex:1,padding:"9px 6px",border:"1px solid #ddd8cc",borderRadius:"8px",background:"#fbf9f3",color:"#a07830",fontFamily:"Georgia,serif",fontSize:"12px",cursor:"pointer",WebkitAppearance:"none",appearance:"none"};
        var launchApp=function(target,fallback){ commitAll(); if(fallback){ var t0=Date.now(); setTimeout(function(){ if(Date.now()-t0<1500 && !document.hidden){ window.location.href=fallback; } }, 1200); } try{ window.location.href=target; }catch(e){} };
        var onFieldKey=function(e){
          if (e.key==="Enter"){ e.preventDefault(); closeAcct(); return; }
          if (e.key==="ArrowDown"){
            e.preventDefault();
            var box=e.target.closest("[data-acctbox='1']");
            if (box){
              var list=box.querySelectorAll("input"); var i; var found=-1;
              for (i=0;i<list.length;i++){ if(list[i]===e.target){ found=i; break; } }
              if (found>=0 && found+1<list.length) list[found+1].focus();
            }
            return;
          }
          if (e.key==="ArrowUp"){
            e.preventDefault();
            var boxU=e.target.closest("[data-acctbox='1']");
            if (boxU){
              var listU=boxU.querySelectorAll("input"); var iu; var foundU=-1;
              for (iu=0;iu<listU.length;iu++){ if(listU[iu]===e.target){ foundU=iu; break; } }
              if (foundU>0) listU[foundU-1].focus();
            }
            return;
          }
        };
        return (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1200,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}} onClick={closeAcct}>
          <div data-acctbox="1" style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"14px",padding:"22px 24px 20px",width:"min(420px,94vw)",maxHeight:"88vh",overflowY:"auto",boxSizing:"border-box"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#a07830",marginBottom:"4px"}}>Accounting</div>
            <div style={{fontSize:"18px",color:"#1a1a1a",marginBottom:"18px"}}>{friendlyDateLong(dk)}</div>
            {methods.map(function(m){
              var key=m[0]; var label=m[1]; var tgt=m[2]; var fb=m[3];
              return (
                <div key={key} style={rowWrap}>
                  {tgt
                    ? <div onClick={function(){ launchApp(tgt, fb); }} title={"Open "+label} style={{...rowLabel,color:"#a07830",cursor:"pointer",textDecoration:"underline",textDecorationColor:"#e0d3b0",textUnderlineOffset:"3px",WebkitTapHighlightColor:"transparent"}}>{label}</div>
                    : <div style={rowLabel}>{label}</div>}
                  <input type="text" inputMode="decimal" value={draftVal(key)} onChange={onFieldChange(key)} onBlur={onFieldBlur(key)} onFocus={onFieldFocus} onKeyDown={onFieldKey} placeholder="0" style={fieldInp}/>
                </div>
              );
            })}
            <div style={{display:"flex",alignItems:"center",gap:"12px",padding:"12px 0",marginTop:"4px",marginBottom:"10px",borderTop:"1px solid #ece4d4",borderBottom:"1px solid #ece4d4"}}>
              <span style={{width:"96px",flexShrink:0,fontSize:"18px",color:"#a07830",fontFamily:"Georgia,serif"}}>{"$"}</span>
              <span style={{flex:1,textAlign:"right",fontSize:"24px",color:"#a07830",fontFamily:"Georgia,serif"}}>{liveTh}</span>
            </div>
            <div style={rowWrap}>
              <div style={symLabel}>{"#"}</div>
              <input type="text" inputMode="decimal" value={acctAdd.services!==undefined?acctAdd.services:(rec.services?String(rec.services):(estToday&&estToday.any?estToday.services:""))} onChange={onFieldChange("services")} onBlur={onFieldBlur("services")} onFocus={onFieldFocus} onKeyDown={onFieldKey} placeholder="services" style={fieldInp}/>
            </div>
            <div style={{...rowWrap,marginBottom:"18px"}}>
              <div style={symLabel}>{":"}</div>
              <input type="text" inputMode="decimal" value={acctAdd.hours!==undefined?acctAdd.hours:(rec.hours?String(rec.hours):(estToday&&estToday.any?estToday.hours:""))} onChange={onFieldChange("hours")} onBlur={onFieldBlur("hours")} onFocus={onFieldFocus} onKeyDown={onFieldKey} placeholder="hours" style={fieldInp}/>
            </div>
            {(dpsVal!==null||sphVal!==null)&&(
              <div style={{padding:"10px 0 4px",marginTop:"-6px",marginBottom:"14px",borderTop:"1px dashed #ece4d4"}}>
                <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",marginBottom:"5px"}}>
                  <span style={{fontSize:"12px",color:"#b0a68e",letterSpacing:"0.04em",fontFamily:"Georgia,serif"}}>{"$ / service"}</span>
                  <span style={{fontSize:"15px",color:"#a07830",fontFamily:"Georgia,serif"}}>{dpsVal!==null?("$"+Math.round(dpsVal)):"—"}</span>
                </div>
                <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between"}}>
                  <span style={{fontSize:"12px",color:"#b0a68e",letterSpacing:"0.04em",fontFamily:"Georgia,serif"}}>{"services / hour"}</span>
                  <span style={{fontSize:"15px",color:"#a07830",fontFamily:"Georgia,serif"}}>{sphVal!==null?(Math.round(sphVal*10)/10).toFixed(1):"—"}</span>
                </div>
              </div>
            )}
            {/* v91: the DONE button is gone. Enter in any field, and tapping outside the popup,
                both already ran commitAll — so the button was only ever a third way to do the
                same thing. Revert lever:
            <button onClick={closeAcct} style={{display:"block",width:"100%",padding:"11px",background:"#1a1a1a",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Done</button>
            */}
          </div>
        </div>
        );
      })()}

      {noteModal && (
        /* v91: backdrop tap SAVES (dnSaveAndClose) — it used to discard (dnCloseNoteModal).
           Revert lever: swap dnSaveAndClose() back to dnCloseNoteModal() on the line below. */
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1200,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}} onClick={function(){ dnSaveAndClose(); }}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"24px",width:"min(360px,92vw)"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#a07830",marginBottom:"8px"}}>{noteModal.isDay?"Day Note":"Note"}</div>
            <div style={{fontSize:"16px",color:"#1a1a1a",marginBottom:"14px"}}>{noteModal.name}</div>
            {/* Appointment note: free-form textarea. v89 dropped Personal/Business here too
                (v88 had dropped it for day notes only), so notes are uniform everywhere —
                no kind, no blue, gold pencil. Saves now always write noteKind:null. The
                P/B button row that used to sit below is preserved just beneath as a
                commented revert lever. */}
            {!noteModal.isDay && (
              <textarea autoFocus data-noteinput="1" value={noteDraft} onChange={function(e){ setNoteDraft(e.target.value); }} onKeyDown={function(e){ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); var nm=noteModal; var slots=[...getSlots(nm.dateKey)]; var s=slots[nm.idx]; /* v89 revert lever — old kind-carrying write: slots[nm.idx]={...s,note:noteDraft.trim(),noteKind:noteDraft.trim()?noteKind:null}; */ slots[nm.idx]={...s,note:noteDraft.trim(),noteKind:null}; setSlots(nm.dateKey,slots); setNoteModal(null); setNoteDraft(""); setNoteKind(null); } }} placeholder={"Add a note for this appointment..."} style={{width:"100%",boxSizing:"border-box",minHeight:"96px",resize:"vertical",background:"#efefed",border:"1px solid #d8d8d6",borderRadius:"6px",padding:"10px",fontSize:"14px",fontFamily:"Georgia,serif",color:noteColorFor(noteKind),outline:"none",marginBottom:"12px"}}/>
            )}
            {/* v89 REMOVED — Personal/Business toggle for appointment notes. Restore by
                un-commenting this block (the noteKind state and setNoteKind are still live,
                so it drops straight back in; you'd also revert the two noteKind:null writes
                and the two "uniform gold" pencil colors):
            {!noteModal.isDay && (
              <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"14px"}}>
                <button onClick={function(){ setNoteKind(noteKind==="personal"?null:"personal"); }} style={{flex:1,padding:"8px",borderRadius:"6px",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",letterSpacing:"0.06em",border:"1px solid "+TODAY_BLUE,background:noteKind==="personal"?TODAY_BLUE:"transparent",color:noteKind==="personal"?"#fff":TODAY_BLUE}}>Personal</button>
                <button onClick={function(){ setNoteKind(noteKind==="business"?null:"business"); }} style={{flex:1,padding:"8px",borderRadius:"6px",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",letterSpacing:"0.06em",border:"1px solid #a07830",background:noteKind==="business"?"#a07830":"transparent",color:noteKind==="business"?"#fff":"#a07830"}}>Business</button>
              </div>
            )}
            */}
            {/* v88 day-note structured line editor: each line is its own row with a ↻ chip
                that opens the per-line repeat popup. Enter adds a row; Backspace on an empty
                row removes it. Save routes through dnCommitLines. */}
            {noteModal.isDay && (
              <div style={{marginBottom:"12px"}}>
                {noteLines.map(function(row, idx){
                  // v91: the repeat chip now MIRRORS the recurring-customer badge — number
                  // first, then the ↺ arrow (same glyph, same direction, same 12px/16px
                  // sizes), gold on plain white with no box. A non-repeating line no longer
                  // reads "once"; it shows the same ↺, greyed out. Old boxed-chip label kept
                  // as a revert lever:
                  // var chipLbl = row.r===0 ? "once" : (row.r===2 ? ("↻ "+row.n+"mo") : ("↻ "+row.n+"w"));
                  var chipOn = row.r>0;
                  var chipNum = !chipOn ? "" : (row.r===2 ? ((row.n||1)+"mo") : ((row.n||1)+"w"));
                  var chipCol = chipOn ? "#a07830" : "#c8c8c4";
                  return (
                    <div key={row.id} style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"6px"}}>
                      {/* v91: autoFocus={idx===0} REMOVED — opening a day note no longer drops the
                          caret into the end of the first existing line (which both hijacked the
                          keyboard and put the arrows to work moving the text cursor). Tap a line to
                          edit it. This is also what frees ← / → to page the day. Revert lever: put
                          autoFocus={idx===0} back on the input below. */}
                      <input ref={function(el){ if(el){ noteRowRefs.current[row.id]=el; } else { delete noteRowRefs.current[row.id]; } }} value={row.t} onChange={function(e){ dnRowUpdate(row.id,{t:e.target.value}); }} onKeyDown={function(ev){
                          // v92: ENTER ALWAYS SAVES AND CLOSES — empty line or full line, no
                          // difference. Adding/reaching another row is now ↓ / ↑ (hop between the
                          // boxes), Tab (native), Shift+Enter (open a fresh row right below), or
                          // the "+ line" button. Revert lever — the v91 pair (Enter on a line with
                          // text opened the next line; Enter on an empty line saved):
                          // if(ev.key==="Enter" && (row.t||"").trim()===""){ ev.preventDefault(); dnCommitLines(); return; }
                          // if(ev.key==="Enter"){ ev.preventDefault(); var nid=dnNewId(); ...add row... }
                          if(ev.key==="Enter" && !ev.shiftKey){ ev.preventDefault(); dnCommitLines(); return; }
                          if(ev.key==="ArrowDown" || ev.key==="ArrowUp"){
                            var here=-1; for(var h=0;h<noteLines.length;h++){ if(noteLines[h].id===row.id){ here=h; break; } }
                            var want= ev.key==="ArrowDown" ? here+1 : here-1;
                            if(here>=0 && want>=0 && want<noteLines.length){ ev.preventDefault(); var elh=noteRowRefs.current[noteLines[want].id]; if(elh){ elh.focus(); } }
                            return;
                          }
                          if(ev.key==="Enter" && ev.shiftKey){ ev.preventDefault(); var nid=dnNewId(); var dk=(noteModal&&noteModal.dayKey)||"";
                            setNoteLines(function(rows){ var out=[]; for(var i=0;i<rows.length;i++){ out.push(rows[i]); if(rows[i].id===row.id){ out.push({id:nid,t:"",r:0,n:1,since:dk,src:"new"}); } } return out; });
                            setTimeout(function(){ var el=noteRowRefs.current[nid]; if(el){ el.focus(); } },0);
                          } else if(ev.key==="Backspace" && (row.t||"")==="" && noteLines.length>1){ ev.preventDefault();
                            var pidx=-1; for(var j=0;j<noteLines.length;j++){ if(noteLines[j].id===row.id){ pidx=j; break; } }
                            var prevId= pidx>0 ? noteLines[pidx-1].id : null;
                            dnRowDelete(row.id);
                            if(prevId){ setTimeout(function(){ var el2=noteRowRefs.current[prevId]; if(el2){ el2.focus(); } },0); }
                          }
                        }} placeholder={idx===0?"Add a note…":"…"} style={{flex:1,minWidth:0,boxSizing:"border-box",background:"#efefed",border:"1px solid #d8d8d6",borderRadius:"6px",padding:"9px 10px",fontSize:"14px",fontFamily:"Georgia,serif",color:"#1a1a1a",outline:"none"}}/>
                      <button onClick={function(){ setNoteRepeatPopup(row.id); }} title={chipOn?"Repeating — tap to change":"Not repeating — tap to set a repeat"} style={{flexShrink:0,display:"flex",alignItems:"center",justifyContent:"flex-end",gap:"2px",minWidth:"46px",padding:"4px 2px",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",color:chipCol,lineHeight:1}}>
                        {chipOn?<span style={{fontSize:"12px",fontWeight:"500",letterSpacing:"0.01em",lineHeight:1}}>{chipNum}</span>:null}
                        <span style={{fontSize:"16px",fontWeight:"500",lineHeight:1}}>{"↺"}</span>
                      </button>
                      <button onClick={function(){ dnRowDelete(row.id); }} title="Remove this line" style={{flexShrink:0,background:"none",border:"none",cursor:"pointer",color:"#c0392b",fontSize:"18px",lineHeight:1,padding:"0 2px"}}>{"×"}</button>
                    </div>
                  );
                })}
                <button onClick={function(){ dnRowAddAfter(noteLines.length?noteLines[noteLines.length-1].id:null); }} style={{marginTop:"2px",padding:"6px 10px",background:"transparent",border:"1px dashed #d8d8d6",borderRadius:"6px",color:"#999",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>{"+ line"}</button>
              </div>
            )}
            {/* v84 (#4): the standalone +AM/+PM row was removed from here and relocated into the bottom action row (see footer below). Same addSlotToBeginning/addSlotToEnd calls, day-notes only. */}
            {noteModal.isDay && !noteScopeAsk && (
              <div style={{borderTop:"1px solid #ececea",marginTop:"2px",marginBottom:"14px",paddingTop:"12px"}}>
                <div style={{fontSize:"10px",letterSpacing:"0.12em",color:"#a07830",marginBottom:"8px"}}>{"STANDBY LIST"}</div>
                {(function(){
                  var items = wlGet(noteModal.dayKey);
                  if (!items.length) return (<div style={{fontSize:"12px",color:"#bbb",fontStyle:"italic",marginBottom:"8px"}}>{"No one waiting yet."}</div>);
                  return (
                    <div style={{marginBottom:"8px"}}>
                      {items.map(function(it){
                        return (
                          <div key={it.id} style={{display:"flex",alignItems:"center",gap:"8px",padding:"6px 8px",background:"#f6f4ef",border:"1px solid #ece7dc",borderRadius:"6px",marginBottom:"6px"}}>
                            {/* v98: the name now ARMS TAP-TO-PLACE on this standby day (see
                                wlStartPlacement). Revert lever — the v83 handler, which opened
                                the profile underneath this very popup:
                            <button onClick={function(){ openClientProfile(it.name); }} title="Open client profile" ...>{it.name}</button> */}
                            <button onClick={function(){ wlStartPlacement(noteModal.dayKey, it); }} title={"Place "+it.name+" on this day"} style={{flex:1,minWidth:0,textAlign:"left",background:"none",border:"none",cursor:"pointer",fontSize:"14px",color:"#1a1a1a",fontFamily:"Georgia,serif",wordBreak:"break-word",padding:0}}>{it.name}</button>
                            {/* v98: message straight from standby — the whole point of a standby list
                                is that you're about to text one of them the second a hole opens. */}
                            {(function(){
                              var wd=wlPhone(it.name);
                              if (wd) {
                                return <button onClick={function(){ window.location.href="sms:"+wd; }} title={"Message "+it.name} style={{background:"none",border:"none",cursor:"pointer",padding:"0 2px",lineHeight:1,flexShrink:0,display:"flex",alignItems:"center"}}><MessageIcon size={18} color="#c9a96e"/></button>;
                              }
                              return <button onClick={function(){ setPhoneModal({name:it.name,phone:""}); }} title={"Add a number for "+it.name} style={{background:"none",border:"none",cursor:"pointer",padding:"0 2px",lineHeight:1,flexShrink:0,display:"flex",alignItems:"center"}}><MessageIcon size={18} color="#c6c6c6"/></button>;
                            })()}
                            <button onClick={function(){ wlRemove(noteModal.dayKey, it.id); }} title="Remove from standby" style={{background:"none",border:"none",cursor:"pointer",color:"#c0392b",fontSize:"18px",lineHeight:1,padding:"0 4px",flexShrink:0}}>{"×"}</button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                <div>
                  <div style={{display:"flex",gap:"8px"}}>
                    {/* v89: arrow-key nav. Down/Up move the highlight through the suggestions;
                        Enter adds the highlighted client if one is selected, otherwise it adds
                        exactly what was typed (unchanged free-type behavior). Escape drops the
                        highlight. Revert lever — old Enter-only handler:
                        onKeyDown={function(e){ if(e.key==="Enter"){ e.preventDefault(); wlAdd(noteModal.dayKey, wlInput); setWlInput(""); } }} */}
                    <input value={wlInput} onChange={function(e){ setWlInput(e.target.value); setWlIdx(-1); }} onKeyDown={function(e){
                      var sg = computeSuggestions(wlInput);
                      if (sg.length>0 && (e.key==="ArrowDown"||e.key==="ArrowUp")) {
                        e.preventDefault();
                        if (e.key==="ArrowDown") { setWlIdx(Math.min(wlIdx+1, sg.length-1)); }
                        else { setWlIdx(wlIdx<=0 ? -1 : wlIdx-1); }
                        return;
                      }
                      if (e.key==="Escape") { setWlIdx(-1); return; }
                      if (e.key==="Enter") {
                        e.preventDefault();
                        if (sg.length>0 && wlIdx>=0 && wlIdx<sg.length) { wlAdd(noteModal.dayKey, sg[wlIdx].name); }
                        else { wlAdd(noteModal.dayKey, wlInput); }
                        setWlInput(""); setWlIdx(-1);
                      }
                    }} placeholder="Add a name…" style={{flex:1,boxSizing:"border-box",background:"#efefed",border:"1px solid #d8d8d6",borderRadius:"6px",padding:"8px 10px",fontSize:"14px",fontFamily:"Georgia,serif",color:"#1a1a1a",outline:"none"}}/>
                    <button onClick={function(){ wlAdd(noteModal.dayKey, wlInput); setWlInput(""); }} style={{padding:"8px 14px",background:"#c9a96e",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",flexShrink:0}}>{"Add"}</button>
                  </div>
                  {/* v84 (#1): slot/search-style type-ahead. Same computeSuggestions used by the schedule name field (saved, phoned client profiles only, 3+ chars). Tapping a suggestion adds them by name; a free-typed name still works via Enter/Add, exactly like a slot. */}
                  {(function(){
                    var wlSugg = computeSuggestions(wlInput);
                    if (!wlSugg.length) return null;
                    return (
                      <div style={{marginTop:"6px",border:"1px solid #e4e0d6",borderRadius:"6px",overflow:"hidden",background:"#fff"}}>
                        {/* v89: name on the left, price on the right — same row shape as the
                            all-contacts header search. Highlighted row (arrow keys) gets the
                            gold tint. Revert lever — old plain name-only row:
                            return (<button key={"wlsug:"+c.name} onClick={function(){ wlAdd(noteModal.dayKey, c.name); setWlInput(""); }} style={{display:"block",width:"100%",boxSizing:"border-box",textAlign:"left",background:"none",border:"none",borderBottom:"1px solid #f2efe6",cursor:"pointer",fontFamily:"Georgia,serif",fontSize:"13px",color:"#1a1a1a",padding:"8px 10px"}}>{c.name}</button>); */}
                        {wlSugg.map(function(c,ci){
                          var wlPr = (c.price && String(c.price).trim()) ? c.price : getClientPrice(c.name);
                          var wlOn = (ci===wlIdx);
                          return (<button key={"wlsug:"+c.name} onClick={function(){ wlAdd(noteModal.dayKey, c.name); setWlInput(""); setWlIdx(-1); }} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px",width:"100%",boxSizing:"border-box",textAlign:"left",background:wlOn?"#f1e6c6":"none",border:"none",borderBottom:"1px solid #f2efe6",cursor:"pointer",fontFamily:"Georgia,serif",fontSize:"13px",color:"#1a1a1a",padding:"8px 10px"}}><span style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minWidth:0}}>{c.name}</span>{wlPr?<span style={{fontSize:"11px",color:"#a07830",flexShrink:0}}>{wlPr}</span>:null}</button>);
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
            {noteModal.isDay && noteScopeAsk ? (
              <div>
                {/* v92: "lines" is the per-line wording prompt — you retyped a repeating line, so
                    the app asks whether that new wording is a one-off for this date or the new
                    wording for the whole series. "clear"/"save" are the original legacy prompts. */}
                <div style={{fontSize:"12px",color:"#777",marginBottom:"10px"}}>{noteScopeAsk==="lines"?"You changed the wording of a repeating line. Where should the new wording apply?":(noteScopeAsk==="clear"?"Remove this repeating note…":"Apply your change…")}</div>
                <div style={{display:"flex",gap:"8px"}}>
                  <button onClick={function(){ dnApplyScope("today"); }} style={{flex:1,padding:"10px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>This day only</button>
                  <button onClick={function(){ dnApplyScope("all"); }} style={{flex:1,padding:"10px",background:"#c9a96e",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>All repeats</button>
                  <button onClick={function(){ setNoteScopeAsk(null); }} style={{padding:"10px 14px",background:"none",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Back</button>
                </div>
              </div>
            ) : (
              <div style={{display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
                {/* v84 (#4): +AM/+PM relocated here from their old standalone row; day-notes only, same addSlotToBeginning/addSlotToEnd calls. */}
                {noteModal.isDay && (
                  <button onClick={function(){ addSlotToBeginning(noteModal.dayKey); }} style={{padding:"10px 12px",background:"transparent",border:"1px solid #e6e6e4",borderRadius:"6px",color:"#999",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",letterSpacing:"0.04em"}} onMouseEnter={function(e){ e.currentTarget.style.background="#f4f4f2"; }} onMouseLeave={function(e){ e.currentTarget.style.background="transparent"; }}>+AM</button>
                )}
                {noteModal.isDay && (
                  <button onClick={function(){ addSlotToEnd(noteModal.dayKey); }} style={{padding:"10px 12px",background:"transparent",border:"1px solid #e6e6e4",borderRadius:"6px",color:"#999",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",letterSpacing:"0.04em"}} onMouseEnter={function(e){ e.currentTarget.style.background="#f4f4f2"; }} onMouseLeave={function(e){ e.currentTarget.style.background="transparent"; }}>+PM</button>
                )}
                {/* v84 (#4): Clear button removed per request. Clear a note by emptying the text and pressing Save (an empty note commits as a clear: day notes route through dnWriteToday/scope-prompt, appointment notes save note:""). To restore, re-add a button calling dnCommitDayNote("clear") for day notes, or setting the slot note:"" for appointment notes. */}
                {/* v91: SAVE NOTE and CANCEL are gone as buttons. Enter (or Enter on an empty
                    line, for the day-note row editor) and tapping outside the popup both SAVE
                    — see dnSaveAndClose. Undo (Cmd/Ctrl-Z) is the only way back out of a change
                    you didn't want. Both buttons are preserved below as revert levers:
                <button onClick={function(){
                  var nm=noteModal;
                  if (nm.isDay) { dnCommitLines(); }
                  else {
                    var slots=[...getSlots(nm.dateKey)]; var s=slots[nm.idx];
                    slots[nm.idx]={...s,note:noteDraft.trim(),noteKind:null};
                    setSlots(nm.dateKey,slots);
                    setNoteModal(null); setNoteDraft(""); setNoteKind(null);
                  }
                }} style={{marginLeft:"auto",padding:"10px 16px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Save note</button>
                <button onClick={function(){ dnCloseNoteModal(); }} style={{padding:"10px 14px",background:"none",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Cancel</button>
                */}
              </div>
            )}
          </div>
        </div>
      )}

      {/* v88 per-line repeat popup — sits above the note modal (zIndex 1300). Applies a
          repeat setting to the single day-note line whose ↻ chip was tapped. Background tap
          closes only this popup, not the note modal. */}
      {noteModal && noteModal.isDay && noteRepeatPopup && (function(){
        var trow=null; for(var i=0;i<noteLines.length;i++){ if(noteLines[i].id===noteRepeatPopup){ trow=noteLines[i]; break; } }
        if(!trow) return null;
        var dk=noteModal.dayKey;
        // v92 LEGACY SKIP-MIGRATION, part three: "Skip just this day" now offers itself on
        // legacy "@rpt:" repeats too (src "legacyrule"), not just the new per-line bucket rules.
        // resolveDayLinesIn honors "@dnskip:" for both now, and a migrated legacy rule keeps its
        // id, so the skip sticks. Revert lever — the v91 condition (bucket rules only):
        // var isInheritedRule = (trow.src==="rule" && trow.since && trow.since!==dk);
        var isInheritedRule = ((trow.src==="rule" || trow.src==="legacyrule") && trow.since && trow.since!==dk);
        var setR=function(rr,nn){ dnRowUpdate(noteRepeatPopup,{r:rr,n:nn}); setNoteRepeatPopup(null); };
        var fullBtn=function(on){ return {display:"block",width:"100%",boxSizing:"border-box",textAlign:"left",padding:"9px 10px",marginBottom:"6px",borderRadius:"6px",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",border:"1px solid "+(on?"#c9a96e":"#e0e0de"),background:on?"#c9a96e":"transparent",color:on?"#fff":"#555"}; };
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.35)",zIndex:1300,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}} onClick={function(){ setNoteRepeatPopup(null); }}>
            <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"18px",width:"min(300px,90vw)"}} onClick={function(e){ e.stopPropagation(); }}>
              <div style={{fontSize:"10px",letterSpacing:"0.14em",textTransform:"uppercase",color:"#a07830",marginBottom:"10px"}}>{"Repeat this line"}</div>
              <button onClick={function(){ setR(0,1); }} style={fullBtn(trow.r===0)}>{"Once (no repeat)"}</button>
              <button onClick={function(){ setR(1,1); }} style={fullBtn(trow.r===1&&trow.n===1)}>{"Weekly"}</button>
              <div style={{fontSize:"10px",letterSpacing:"0.12em",color:"#bbb",margin:"10px 0 5px"}}>{"EVERY N WEEKS"}</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:"5px",marginBottom:"6px"}}>
                {[2,3,4,5,6,7,8].map(function(k){ var on=(trow.r===1&&trow.n===k); return (<button key={"wk"+k} onClick={function(){ setR(1,k); }} style={{padding:"6px 10px",borderRadius:"6px",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",border:"1px solid "+(on?"#c9a96e":"#e0e0de"),background:on?"#c9a96e":"transparent",color:on?"#fff":"#888"}}>{k+"w"}</button>); })}
              </div>
              <div style={{fontSize:"10px",letterSpacing:"0.12em",color:"#bbb",margin:"10px 0 5px"}}>{"MONTHLY — every N months, same date"}</div>
              <select value={trow.r===2?String(trow.n):""} onChange={function(e){ var v=e.target.value; if(v===""){ return; } setR(2,parseInt(v,10)); }} style={{width:"100%",boxSizing:"border-box",padding:"8px",borderRadius:"6px",border:"1px solid "+(trow.r===2?"#c9a96e":"#d8d8d6"),background:trow.r===2?"#faf5ea":"#fff",fontFamily:"inherit",fontSize:"13px",color:"#1a1a1a"}}>
                <option value="">{"— pick months —"}</option>
                {[1,2,3,4,5,6,7,8,9,10,11,12].map(function(mn){ return (<option key={"mo"+mn} value={String(mn)}>{mn===1?"Every month":("Every "+mn+" months")}</option>); })}
              </select>
              {isInheritedRule && (
                <button onClick={function(){ dnSkipOccurrence(dk, trow.id); }} style={{marginTop:"12px",width:"100%",padding:"9px",background:"transparent",border:"1px solid #e0d2d2",borderRadius:"6px",color:"#c0392b",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>{"Skip just this day"}</button>
              )}
              <button onClick={function(){ setNoteRepeatPopup(null); }} style={{marginTop:"10px",width:"100%",padding:"9px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>{"Done"}</button>
            </div>
          </div>
        );
      })()}

      {quickMsgModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:1250,display:"flex",alignItems:"center",justifyContent:"center",padding:"16px"}} onClick={function(){ setQuickMsgModal(false); setQuickMsgOpenId(null); }}>
          <div style={{background:"#fff",border:"1px solid #e0e0de",borderRadius:"12px",padding:"20px",width:"min(430px,94vw)",maxHeight:"84vh",display:"flex",flexDirection:"column"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"6px",flexShrink:0}}>
              <div style={{fontSize:"15px",fontWeight:"bold",color:"#1a1a1a",fontFamily:"inherit"}}>Messages</div>
              <button onClick={function(){ setQuickMsgModal(false); setQuickMsgOpenId(null); }} style={{background:"none",border:"none",fontSize:"22px",color:"#999",cursor:"pointer",lineHeight:1,padding:"0 4px"}}>{"×"}</button>
            </div>
            <div style={{fontSize:"11px",color:"#aaa",marginBottom:"12px",lineHeight:1.3,flexShrink:0}}>Tap a title to open, edit, and copy. The Copy button copies the full message, not the title.</div>
            <div style={{overflowY:"auto",flex:"1 1 auto",minHeight:0}}>
              {quickMsgs.length===0 && (
                <div style={{padding:"18px 4px",textAlign:"center",fontSize:"13px",color:"#aaa",fontFamily:"Georgia,serif"}}>No saved messages yet.</div>
              )}
              {quickMsgs.map(function(m){
                var open = quickMsgOpenId===m.id;
                var copied = quickMsgCopiedId===m.id;
                return (
                  <div key={m.id} style={{border:"1px solid #ececea",borderRadius:"8px",marginBottom:"8px",overflow:"hidden",background:"#fafaf8"}}>
                    <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"9px 10px"}}>
                      <button onClick={function(){ setQuickMsgOpenId(open?null:m.id); }} style={{flex:"1 1 auto",minWidth:0,background:"none",border:"none",textAlign:"left",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",color:m.title?"#1a1a1a":"#bbb",display:"flex",alignItems:"center",gap:"6px",padding:0}}>
                        <span style={{fontSize:"11px",color:"#c9a96e",flexShrink:0}}>{open?"▾":"▸"}</span>
                        <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.title||"Untitled message"}</span>
                      </button>
                      <button onClick={function(){ copyQuickMsg(m.id, m.body); }} title="Copy message" style={{flexShrink:0,padding:"5px 10px",borderRadius:"6px",border:"1px solid "+(copied?"#2e7d46":"#d8d8d6"),background:copied?"#2e7d46":"#fff",color:copied?"#fff":"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",display:"flex",alignItems:"center",gap:"5px"}}>{copied?"Copied ✓":(<span style={{display:"flex",alignItems:"center",gap:"5px"}}><CopyIcon size={13} color="#666"/>Copy</span>)}</button>
                    </div>
                    {open && (
                      <div style={{padding:"0 10px 10px"}}>
                        <input value={m.title} onChange={function(e){ updateQuickMsg(m.id,"title",e.target.value); }} placeholder="Short title (shows in the list)" style={{width:"100%",boxSizing:"border-box",marginBottom:"6px",padding:"7px 9px",border:"1px solid #d8d8d6",borderRadius:"6px",background:"#fff",fontFamily:"inherit",fontSize:"12px",color:"#1a1a1a",outline:"none"}}/>
                        <textarea value={m.body} onChange={function(e){ updateQuickMsg(m.id,"body",e.target.value); }} placeholder="Full message — this is what gets copied…" style={{width:"100%",boxSizing:"border-box",minHeight:"90px",resize:"vertical",padding:"9px",border:"1px solid #d8d8d6",borderRadius:"6px",background:"#fff",fontFamily:"Georgia,serif",fontSize:"13px",color:"#1a1a1a",outline:"none",lineHeight:1.4}}/>
                        <div style={{display:"flex",justifyContent:"flex-end",marginTop:"6px"}}>
                          <button onClick={function(){ removeQuickMsg(m.id); }} style={{background:"none",border:"1px solid #e0b0a8",borderRadius:"6px",color:"#c0392b",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",padding:"5px 12px"}}>Remove</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button onClick={addQuickMsg} style={{marginTop:"12px",flexShrink:0,padding:"10px",background:"#1a1a1a",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>+ Add message</button>
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
        // v92: tell the user, before they confirm, that this move will carry the rest of the
        // group with it — i.e. that they're holding the FIRST member of a linked run. Nothing
        // shows for the 2nd/3rd member (groupCascadeIdxs returns [] there) or for a lone slot.
        var tmSlots = getSlots(timeEditModal.dateKey);
        var tmCascIdxs = groupCascadeIdxs(tmSlots, timeEditModal.idx);
        var tmCascNames = tmCascIdxs.map(function(gi){ var gs=tmSlots[gi]; return gs.name || gs.blockLabel || "blocked"; });
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
            <div style={{fontSize:"12px",color:"#aaa",marginBottom:tmCascNames.length?"6px":"18px"}}>Default was {timeEditModal.original}</div>
            {tmCascNames.length>0 && (
              <div style={{fontSize:"11px",color:"#a07830",marginBottom:"18px",lineHeight:1.35}}>{"Group — "+tmCascNames.join(", ")+(tmCascNames.length>1?" move":" moves")+" with this by the same amount."}</div>
            )}
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

      {shareModal && (
        <div onClick={function(e){ e.stopPropagation(); }} style={{position:"fixed",top:isPhone?0:(gridTopY>0?gridTopY:(listTopY>0?listTopY:"calc(env(safe-area-inset-top,0px) + 56px)")),left:isPhone?0:"auto",right:0,bottom:0,width:isPhone?"100%":"clamp(300px,34vw,460px)",background:"#fafaf8",borderLeft:isPhone?"none":"1px solid #ececea",boxShadow:"-6px 0 24px rgba(0,0,0,0.12)",zIndex:110,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{padding:isPhone?"calc(env(safe-area-inset-top, 0px) + 14px) 16px 10px":"14px 16px 10px",borderBottom:"1px solid #ececea",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
            <div style={{fontSize:"15px",fontWeight:"bold",color:"#1a1a1a",fontFamily:"inherit"}}>Share openings</div>
            <button onClick={function(){ if (shareDirty) { setShareSaveConfirm(true); } else { setShareModal(false); setShareDraftEditing(false); } }} style={{background:"none",border:"none",fontSize:"22px",color:"#999",cursor:"pointer",lineHeight:1,padding:"0 4px"}}>{"×"}</button>
          </div>

          <div style={{padding:"10px 16px",borderBottom:"1px solid #ececea",flexShrink:0}}>
            <div style={{display:"flex",flexWrap:"wrap",gap:"6px",alignItems:"center"}}>
              {shareDrafts.map(function(d){
                var active = d.id === shareActiveDraftId;
                return (
                  <button key={d.id} onClick={function(){ selectShareDraft(d.id); }} style={{padding:"5px 12px",borderRadius:"14px",border:active?"1px solid #2e7d46":"1px solid #d8d8d6",background:active?"#2e7d46":"#fff",color:active?"#fff":"#777",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",fontWeight:active?"bold":"normal"}}>{d.name}</button>
                );
              })}
              <button onClick={addShareDraft} title="New draft" style={{width:"26px",height:"26px",borderRadius:"13px",border:"1px solid #d8d8d6",background:"#fff",color:"#777",cursor:"pointer",fontFamily:"inherit",fontSize:"14px",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>{"+"}</button>
              {!shareDraftEditing && <button onClick={startEditShareDraft} title="Edit this draft's message" style={{width:"26px",height:"26px",borderRadius:"13px",border:"1px solid #d8d8d6",background:"#fff",color:"#777",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",display:"flex",alignItems:"center",justifyContent:"center",padding:0,marginLeft:"auto"}}>{"✎"}</button>}
            </div>
            {shareDraftEditing && (
              <div style={{marginTop:"10px"}}>
                <input value={activeShareDraft().name} onChange={function(e){ renameShareDraft(shareActiveDraftId, e.target.value); }} placeholder="Draft name" style={{width:"100%",boxSizing:"border-box",marginBottom:"6px",padding:"6px 8px",border:"1px solid #d8d8d6",borderRadius:"5px",background:"#fff",fontFamily:"inherit",fontSize:"12px",color:"#1a1a1a",outline:"none"}}/>
                <textarea value={shareDraftEditText} onChange={function(e){ setShareDraftEditText(e.target.value); }} placeholder="Hello! Here are my current openings..." style={{width:"100%",boxSizing:"border-box",minHeight:"110px",resize:"vertical",padding:"8px",border:"1px solid #d8d8d6",borderRadius:"5px",background:"#fff",fontFamily:"Georgia,serif",fontSize:"13px",color:"#1a1a1a",outline:"none"}}/>
                <div style={{fontSize:"10px",color:"#aaa",margin:"4px 0 8px",lineHeight:1.3}}>Type {"{{OT_AMT}}"} anywhere you want the OT surcharge dollar amount to appear — it stays live even if you change drafts or the amount below.</div>
                <div style={{fontSize:"11px",color:"#888",fontWeight:"bold",margin:"2px 0 4px"}}>Ending (after the times)</div>
                <textarea value={shareDraftEditFooter} onChange={function(e){ setShareDraftEditFooter(e.target.value); }} placeholder="e.g. Text me back to grab one!" style={{width:"100%",boxSizing:"border-box",minHeight:"70px",resize:"vertical",padding:"8px",border:"1px solid #d8d8d6",borderRadius:"5px",background:"#fff",fontFamily:"Georgia,serif",fontSize:"13px",color:"#1a1a1a",outline:"none"}}/>
                <div style={{fontSize:"10px",color:"#aaa",margin:"4px 0 8px",lineHeight:1.3}}>Optional — added to the very end of the message, after your times. Leave blank for none.</div>
                <div style={{display:"flex",gap:"8px"}}>
                  <button onClick={saveShareDraftEdit} style={{flex:1,padding:"8px",background:"#2e7d46",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",fontWeight:"bold"}}>Save</button>
                  <button onClick={cancelEditShareDraft} style={{flex:1,padding:"8px",background:"#f4f4f2",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Cancel</button>
                  {shareDrafts.length>1 && (
                    <button onClick={function(){ if(shareDraftDeleteConfirm){ deleteShareDraft(shareActiveDraftId); setShareDraftDeleteConfirm(false); } else { setShareDraftDeleteConfirm(true); } }} onBlur={function(){ setShareDraftDeleteConfirm(false); }} style={{padding:"8px 10px",background:shareDraftDeleteConfirm?"#c0392b":"#fff",border:shareDraftDeleteConfirm?"1px solid #c0392b":"1px solid #e0b0a8",borderRadius:"6px",color:shareDraftDeleteConfirm?"#fff":"#c0392b",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",whiteSpace:"nowrap"}}>{shareDraftDeleteConfirm?"Tap again to delete":"Delete"}</button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div style={{padding:"10px 16px",borderBottom:"1px solid #ececea",display:"flex",flexWrap:"wrap",gap:"14px",alignItems:"center",flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
              <span style={{fontSize:"12px",color:"#666"}}>OT surcharge $</span>
              <input value={shareAmt} inputMode="numeric" onChange={function(e){ setShareAmt(e.target.value.replace(/[^0-9]/g,"")); setShareCopied(false); }} style={{width:"50px",padding:"5px 7px",border:"1px solid #d8d8d6",borderRadius:"5px",background:"#fff",fontFamily:"inherit",fontSize:"13px",color:"#1a1a1a",outline:"none"}}/>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
              <span style={{fontSize:"12px",color:"#666"}}>Pad all</span>
              <button onClick={function(){ setShareShiftMode("plus"); }} style={{padding:"5px 10px",borderRadius:"6px",border:shareShift==="plus"?"1px solid #2e7d46":"1px solid #d8d8d6",background:shareShift==="plus"?"#2e7d46":"#fff",color:shareShift==="plus"?"#fff":"#777",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",fontWeight:"bold"}}>+5</button>
              <button onClick={function(){ setShareShiftMode("minus"); }} style={{padding:"5px 10px",borderRadius:"6px",border:shareShift==="minus"?"1px solid #2e7d46":"1px solid #d8d8d6",background:shareShift==="minus"?"#2e7d46":"#fff",color:shareShift==="minus"?"#fff":"#777",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",fontWeight:"bold"}}>-5</button>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
              <button onClick={shareUndo} disabled={!(shareHistIdxRef.current>0)} title="Undo" style={{...navBtnSm,width:"26px",padding:"0",background:(shareHistIdxRef.current>0)?"#f0f0ee":"#f8f8f6",border:"1px solid #d8d8d6"}}><UndoIcon size={14} color={(shareHistIdxRef.current>0)?"#555":"#ccc"}/></button>
              <button onClick={shareRedo} disabled={!(shareHistIdxRef.current<shareHistRef.current.length-1)} title="Redo" style={{...navBtnSm,width:"26px",padding:"0",background:(shareHistIdxRef.current<shareHistRef.current.length-1)?"#f0f0ee":"#f8f8f6",border:"1px solid #d8d8d6"}}><RedoIcon size={14} color={(shareHistIdxRef.current<shareHistRef.current.length-1)?"#555":"#ccc"}/></button>
            </div>
            <button onClick={toggleShareHideOT} title="Hide all OT times from this one copy (doesn't change your saved draft)" style={{padding:"5px 10px",borderRadius:"6px",border:shareHideOT?"1px solid #c9852e":"1px solid #d8d8d6",background:shareHideOT?"#f6e6cf":"#fff",color:shareHideOT?"#9a5e12":"#777",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",fontWeight:"bold"}}>{shareHideOT?"OT hidden ✓":"Hide OT"}</button>
          </div>

          <div style={{flex:"1 1 auto",overflowY:"auto",padding:"4px 0",WebkitOverflowScrolling:"touch"}}>
            {(function(){
              var days = computeShareDays(shareWindow);
              if (!days.length) {
                return <div style={{padding:"28px 16px",fontSize:"13px",color:"#999",textAlign:"center"}}>No open times in this stretch.</div>;
              }
              return days.map(function(day){
                var dk = day.dateKey;
                var shownTimes = shareShownTimes(day);
                var dayActive = shareDayActive(dk, shownTimes);
                var canEarlier = shareGridCandidate(day, shownTimes, "earlier") !== null;
                var canLater = shareGridCandidate(day, shownTimes, "later") !== null;
                var el = shareEarlierLater[dk] || {earlier:false, later:false};
                var renderRow = function(o){
                  var key = day.dateKey + "|" + o.time;
                  var checked = !!shareChecked[key];
                  var isOT = !!shareOT[key];
                  var rowDelta = effectiveShareDelta(key);
                  var rowOverride = shareTimeShift[key];
                  var isCustom = shareIsCustomTime(day, o.time); // D: off-calendar add
                  return (
                    <div key={key} style={{display:"flex",alignItems:"center",gap:"6px",padding:"6px 16px"}}>
                      <button onClick={function(){ toggleShareChecked(key); }} style={{width:"20px",height:"20px",flexShrink:0,borderRadius:"5px",border:checked?"1.5px solid #2e7d46":"1.5px solid #c4c4c2",background:checked?"#2e7d46":"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>{checked?<span style={{color:"#fff",fontSize:"12px",lineHeight:1}}>{"✓"}</span>:null}</button>
                      <span style={{flex:"0 0 auto",minWidth:"66px",fontSize:"13px",color:checked?"#1a1a1a":"#9a9a9a",fontFamily:"Georgia,serif",fontVariantNumeric:"tabular-nums"}}>{shareFmtTime(o.time, rowDelta)}</span>
                      {isCustom&&<span title="Not on your calendar yet — add the slot by hand if it's booked" style={{flex:"0 0 auto",fontSize:"9px",color:"#b0894a",background:"#f7efe0",border:"1px solid #e6d3ad",borderRadius:"8px",padding:"1px 6px",letterSpacing:"0.03em",whiteSpace:"nowrap"}}>{"not on calendar"}</span>}
                      <button onClick={function(){ toggleShareTimeShiftMode(key,"plus"); }} title="Nudge this time 5 min earlier" style={{width:"20px",height:"20px",flexShrink:0,padding:0,borderRadius:"4px",border:rowOverride==="plus"?"1px solid #4a8a9a":"1px solid #d8d8d6",background:rowOverride==="plus"?"#e3eef0":"#fff",color:rowOverride==="plus"?"#2c5a66":"#aaa",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",lineHeight:1}}>{"+5"}</button>
                      <button onClick={function(){ toggleShareTimeShiftMode(key,"minus"); }} title="Nudge this time 5 min later" style={{width:"20px",height:"20px",flexShrink:0,padding:0,borderRadius:"4px",border:rowOverride==="minus"?"1px solid #4a8a9a":"1px solid #d8d8d6",background:rowOverride==="minus"?"#e3eef0":"#fff",color:rowOverride==="minus"?"#2c5a66":"#aaa",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",lineHeight:1}}>{"-5"}</button>
                      <button onClick={function(){ toggleShareOT(key); }} style={{marginLeft:"auto",flexShrink:0,padding:"3px 9px",borderRadius:"12px",border:isOT?"1px solid #c9852e":"1px solid #d8d8d6",background:isOT?"#f6e6cf":"#fff",color:isOT?"#9a5e12":"#aaa",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",letterSpacing:"0.04em"}}>{isOT?"OT ✓":"OT"}</button>
                    </div>
                  );
                };
                return (
                  <div key={dk} style={{borderBottom:"1px solid #f0f0ee"}}>
                    <div style={{display:"flex",alignItems:"center",gap:"8px",padding:"8px 16px 2px"}}>
                      <button onClick={function(){ toggleShareDayCheck(day, shownTimes); }} title="Check or clear this whole day" style={{width:"16px",height:"16px",flexShrink:0,borderRadius:"4px",border:dayActive?"1.5px solid #2e7d46":"1.5px solid #c4c4c2",background:dayActive?"#2e7d46":"#fff",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>{dayActive?<span style={{color:"#fff",fontSize:"10px",lineHeight:1}}>{"✓"}</span>:null}</button>
                      <span style={{fontSize:"12px",letterSpacing:"0.08em",textTransform:"uppercase",color:"#888",fontWeight:"bold"}}>{day.label}</span>
                      {!day.hasBookings&&<span style={{fontSize:"10px",color:"#bbb",letterSpacing:"0.04em"}}>no bookings</span>}
                      <div style={{marginLeft:"auto",display:"flex",gap:"5px"}}>
                        <button onClick={function(){ toggleShareEL(dk,"earlier"); }} title="Add a 'possibly earlier, if needed' note to this day's line" style={{padding:"2px 7px",borderRadius:"10px",border:el.earlier?"1px solid #4a8a9a":"1px solid #d8d8d6",background:el.earlier?"#e3eef0":"#fff",color:el.earlier?"#2c5a66":"#aaa",cursor:"pointer",fontFamily:"inherit",fontSize:"10px",letterSpacing:"0.04em"}}>{"+early"}</button>
                        <button onClick={function(){ toggleShareEL(dk,"later"); }} title="Add a 'possibly later, if needed' note to this day's line" style={{padding:"2px 7px",borderRadius:"10px",border:el.later?"1px solid #4a8a9a":"1px solid #d8d8d6",background:el.later?"#e3eef0":"#fff",color:el.later?"#2c5a66":"#aaa",cursor:"pointer",fontFamily:"inherit",fontSize:"10px",letterSpacing:"0.04em"}}>{"+late"}</button>
                      </div>
                    </div>
                    {shownTimes.map(renderRow)}
                    {(canEarlier||canLater)&&(
                      <div style={{display:"flex",gap:"8px",margin:"2px 16px 8px"}}>
                        {canEarlier&&<button onClick={function(){ revealShareEarlier(day); }} title="Add one more time earlier (steps your grid past real openings if needed)" style={{background:"none",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#4a8a9a",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",padding:"4px 12px"}}>{"+AM"}</button>}
                        {canLater&&<button onClick={function(){ revealShareLater(day); }} title="Add one more time later (steps your grid past real openings if needed)" style={{background:"none",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#4a8a9a",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",padding:"4px 12px"}}>{"+PM"}</button>}
                      </div>
                    )}
                  </div>
                );
              });
            })()}
            <div style={{padding:"10px 16px 16px",display:"flex",justifyContent:"center",gap:"8px"}}>
              {(function(){
                var d2 = computeShareDays(shareWindow);
                if (d2.length <= 1) return null;
                var lastLbl = d2[d2.length - 1].label;
                return <button onClick={removeLastShareDay} title="Remove the last day shown" style={{background:"none",border:"1px solid #e0b0a8",borderRadius:"6px",color:"#b06a5a",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",padding:"7px 16px"}}>{"Remove " + lastLbl}</button>;
              })()}
              <button onClick={loadMoreShareDays} style={{background:"none",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#777",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",padding:"7px 16px"}}>{"Load next " + addDays(new Date(), shareWindow).toLocaleDateString("en-US",{weekday:"long"})}</button>
            </div>
          </div>

          <div style={{padding:"10px 16px 14px",borderTop:"1px solid #ececea",flexShrink:0,display:"flex",gap:"8px",alignItems:"stretch"}}>
            <button onClick={function(){ if (shareDirty) commitShareSave(); }} disabled={!shareDirty} title={shareDirty?"Save everything in the days below (syncs across your devices)":"Everything you're seeing is already saved"} style={{flex:"0 0 auto",padding:"9px 18px",background:shareDirty?"#fff":"#eef4ef",border:shareDirty?"1px solid #2e7d46":"1px solid #cfe3d4",borderRadius:"8px",color:shareDirty?"#2e7d46":"#5a8a68",cursor:shareDirty?"pointer":"default",fontFamily:"inherit",fontSize:"13px",fontWeight:"bold",whiteSpace:"nowrap"}}>{shareDirty?"Save":"Saved ✓"}</button>
            <button onClick={doShareCopy} style={{flex:"1 1 auto",padding:"12px",background:shareCopied?"#246b3a":"#2e7d46",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"14px",fontWeight:"bold"}}>{shareCopied?"Copied to clipboard ✓":"Copy to clipboard"}</button>
          </div>

          {shareSaveConfirm && (
            <div style={{position:"absolute",top:0,left:0,right:0,bottom:0,background:"rgba(20,20,20,0.28)",zIndex:120,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}}>
              <div style={{width:"100%",maxWidth:"300px",background:"#fff",borderRadius:"12px",boxShadow:"0 10px 30px rgba(0,0,0,0.22)",padding:"18px 18px 14px"}}>
                <div style={{fontSize:"14px",fontWeight:"bold",color:"#1a1a1a",marginBottom:"6px"}}>Save your openings?</div>
                <div style={{fontSize:"12px",color:"#888",lineHeight:1.35,marginBottom:"14px"}}>Save everything in the days below — checked times, OT tags, earlier/later notes, and any times you added — so they're here next time and on your other device. This replaces your last saved version.</div>
                <button onClick={function(){ commitShareSave(); setShareSaveConfirm(false); setShareModal(false); setShareDraftEditing(false); }} style={{width:"100%",padding:"11px",marginBottom:"8px",background:"#2e7d46",border:"none",borderRadius:"8px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",fontWeight:"bold"}}>Save</button>
                {/* v59: "Don't save" discards ONLY this session's unsaved edits. It must NOT
                    touch shareSavedChecks — leaving the last saved selection intact so the
                    next open reseeds from it (via openShareSheet). Previously this nulled the
                    saved selection, which wiped the last save and reset back to defaults. */}
                <button onClick={function(){ setShareSaveConfirm(false); setShareDirty(false); setShareModal(false); setShareDraftEditing(false); }} style={{width:"100%",padding:"11px",marginBottom:"8px",background:"#f4f4f2",border:"1px solid #d8d8d6",borderRadius:"8px",color:"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"13px"}}>Don't save</button>
                <button onClick={function(){ setShareSaveConfirm(false); }} style={{width:"100%",padding:"9px",background:"none",border:"none",color:"#9a9a9a",cursor:"pointer",fontFamily:"inherit",fontSize:"12px"}}>Keep editing</button>
              </div>
            </div>
          )}
        </div>
      )}

      {showHistory && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:500,display:"flex",justifyContent:"flex-end"}} onClick={function(){ setShowHistory(false); }}>
          <div style={{width:"min(360px,90vw)",height:"100%",background:"#fafaf8",borderLeft:"1px solid #e4e4e2",overflowY:"auto",padding:"24px 20px",paddingTop:"calc(env(safe-area-inset-top,0px) + 24px)",boxShadow:"-4px 0 20px rgba(0,0,0,0.08)"}} onClick={function(e){ e.stopPropagation(); }}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"16px"}}>
              <div style={{fontSize:"11px",letterSpacing:"0.2em",textTransform:"uppercase",color:"#888"}}>Change History</div>
              <span style={{fontSize:"10px",letterSpacing:"0.04em",color:"#bbb",fontFamily:"Georgia,serif"}}>{(function(){ var n=0; var _tdk=toDateKey(new Date()); var sk=Object.keys(schedules); for(var ii=0;ii<sk.length;ii++){ if(sk[ii]<_tdk) continue; var arr=schedules[sk[ii]]||[]; for(var jj=0;jj<arr.length;jj++){ var ss=arr[jj]; if(ss&&ss.name&&!ss.blocked&&!ss.done) n++; } } return n+" on the list"; })()}</span>
            </div>
            {/* v76: Share openings + Quick messages live in this drawer ONLY on iPhone,
                where the phone header has no room for them. On iPad both already sit in
                the header (openShareSheet / setQuickMsgModal buttons), so gating on
                isPhone removes the duplicates from the iPad Change History drawer. */}
            {isPhone && (
              <button onClick={openShareSheet} style={{width:"100%",padding:"11px",marginBottom:"10px",background:"#2e7d46",border:"none",borderRadius:"6px",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",letterSpacing:"0.04em",fontWeight:"bold"}}>Share openings</button>
            )}
            {isPhone && (
              <button onClick={function(){ setQuickMsgModal(true); setShowHistory(false); }} style={{width:"100%",padding:"11px",marginBottom:"10px",background:"#fff",border:"1px solid #2e7d46",borderRadius:"6px",color:"#2e7d46",cursor:"pointer",fontFamily:"inherit",fontSize:"13px",letterSpacing:"0.04em",fontWeight:"bold"}}>Quick messages</button>
            )}
            <div style={{display:"flex",gap:"8px",marginBottom:"8px"}}>
              <button onClick={exportData} style={{flex:1,padding:"8px",background:"#f4f4f2",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",letterSpacing:"0.05em"}}>Export backup</button>
              <label style={{flex:1,padding:"8px",background:"#f4f4f2",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",letterSpacing:"0.05em",textAlign:"center",display:"flex",alignItems:"center",justifyContent:"center"}}>
                Import backup
                <input type="file" accept=".json" onChange={importData} style={{display:"none"}}/>
              </label>
            </div>
            <button onClick={exportReadable} style={{width:"100%",padding:"8px",marginBottom:"8px",background:"#f4f4f2",border:"1px solid #d8d8d6",borderRadius:"6px",color:"#666",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",letterSpacing:"0.05em"}}>Download schedule</button>
            <button onClick={function(){ try { signOut(fbAuth); } catch(e) {} }} style={{width:"100%",padding:"8px",marginBottom:"8px",background:"none",border:"1px solid #e0b0a8",borderRadius:"6px",color:"#b04a3a",cursor:"pointer",fontFamily:"inherit",fontSize:"11px",letterSpacing:"0.05em"}}>{authUser?("Sign out ("+authUser.email+")"):"Sign out"}</button>
            {/* v77: iPad has the header search bar (now name + phone), so the redundant
                Saved Clients search is removed from the Change History popup THERE. iPhone
                has no header search — this block stays its only client search, so it's gated
                to isPhone (same pattern as Share/Quick-messages above). Deleting a client
                still works from each client's profile on both devices. To restore on iPad,
                drop the "isPhone&&". */}
            {isPhone&&clientMemory.length>0&&(
              <div style={{marginBottom:"20px",marginTop:"16px"}}>
                <div style={{fontSize:"10px",letterSpacing:"0.15em",textTransform:"uppercase",color:"#aaa",marginBottom:"8px"}}>Saved Clients</div>
                <div style={{display:"flex",gap:"6px",marginBottom:"8px"}}>
                  <input value={clientSearch} onChange={function(e){ setClientSearch(e.target.value); }} placeholder="Search name or phone..." style={{...inputStyle,flex:1,boxSizing:"border-box",fontSize:"12px"}}/>
                  <button onClick={function(){ setShowAllClients(function(p){ return !p; }); }} title="Show all clients A–Z" style={{flexShrink:0,padding:"5px 12px",background:showAllClients?"#1a1a1a":"#f4f4f2",border:"1px solid #d8d8d6",borderRadius:"4px",color:showAllClients?"#fff":"#888",cursor:"pointer",fontFamily:"inherit",fontSize:"12px",letterSpacing:"0.08em"}}>A–Z</button>
                </div>
                {clientMemory.slice().sort(function(a,b){ return a.name.toLowerCase().localeCompare(b.name.toLowerCase()); }).filter(function(c){ if(showAllClients) return true; if(!clientSearch) return false; var q=clientSearch.toLowerCase().trim(); if(!q) return false; var nameHit=c.name.toLowerCase().indexOf(q)>=0; var qDigits=q.replace(/[^0-9]/g,""); var phoneDigits=(c.phone||"").replace(/[^0-9]/g,""); var phoneHit=qDigits.length>0&&phoneDigits.length>0&&phoneDigits.indexOf(qDigits)>=0; return nameHit||phoneHit; }).map(function(c,i){ return (
                  <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",marginBottom:"3px",background:"#f8f8f6",border:"1px solid #e8e8e6",borderRadius:"6px"}}>
                    <div style={{cursor:"pointer",flex:1}} onClick={function(){ openClientProfile(c.name); setShowHistory(false); }}>
                      <span style={{fontSize:"13px",color:"#1a1a1a"}}>{c.name}</span>
                      {c.price&&<span style={{fontSize:"11px",color:"#a07830",marginLeft:"8px"}}>{c.price}</span>}
                      {c.phone&&<div style={{fontSize:"11px",color:"#8a9aa8",marginTop:"2px"}}>{c.phone}</div>}
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
              // v82: corrected chip/action words + reordered main line ("Name — action — time · day").
              var lw=logEntryWords(entry);
              var logTail="";
              if (lw.isProfileRename) { logTail = entry.prevName?("(was "+entry.prevName+")"):""; }
              else { var _tp=[]; if(entry.time)_tp.push(entry.time); if(entry.dateKey)_tp.push(friendlyDate(entry.dateKey)); logTail=_tp.join(" · "); }
              var canJump=!!entry.dateKey;
              return (
              <div key={entry.id||i} onClick={canJump?function(){ jumpToLogEntry(entry); }:undefined} style={{padding:"10px 12px",marginBottom:"6px",borderRadius:"6px",cursor:canJump?"pointer":"default",background:(entry.type==="removed"||entry.type==="slot_removed")?"#fff0ee":"#fafaf8",border:(entry.type==="removed"||entry.type==="slot_removed")?"1px solid #e0b0a8":"1px solid #e4e4e2"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"3px"}}>
                  <span style={{fontSize:"10px",letterSpacing:"0.1em",textTransform:"uppercase",color:entry.type==="added"?"#4a8a5a":(entry.type==="removed"||entry.type==="slot_removed")?"#8a3a2a":entry.type==="recurring_set"?"#c9a96e":entry.type==="slot_added"?"#6a8aaa":entry.type==="checkoff"?"#4a8a5a":entry.type==="backup"?"#999":"#666"}}>
                    {/* v82 lever — old chip labels: entry.type==="added"?"Added":entry.type==="removed"?"Removed":entry.type==="slot_removed"?"Slot Removed":entry.type==="slot_added"?"Slot Added":entry.type==="recurring_set"?("Recurring ("+entry.weeks+"w)"):entry.type==="blocked"?"Blocked":entry.type==="unblocked"?"Unblocked":entry.type==="checkoff"?"Checked Off":entry.type==="backup"?"Backup":"Edited" */}
                    {lw.chip}
                  </span>
                  <span style={{fontSize:"10px",color:"#bbb"}}>{entry.timestamp}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:"8px"}}>
                  {/* v82 lever — old order (time — name (was prev) · day):
                  <div style={{fontSize:"13px",color:"#888"}}>
                    {entry.time} {entry.name&&<span style={{color:"#1a1a1a"}}>— {entry.name}</span>}
                    {entry.prevName&&<span style={{color:"#aaa"}}> (was {entry.prevName})</span>}
                    {entry.dateKey&&<span style={{color:"#ccc",fontSize:"11px"}}> · {friendlyDate(entry.dateKey)}</span>}
                  </div>
                  */}
                  <div style={{fontSize:"13px",color:"#888"}}>
                    {entry.name&&<span style={{color:"#1a1a1a"}}>{entry.name}</span>}
                    {entry.name&&<span style={{color:"#bbb"}}>{" — "}</span>}
                    <span style={{color:"#555"}}>{lw.action}</span>
                    {logTail&&<span style={{color:"#ccc",fontSize:"11px"}}>{" — "+logTail}</span>}
                  </div>
                  {canEntryUndo&&<button onClick={function(e){ e.stopPropagation(); handleEntryUndo(entry); }} title="Undo" style={{background:"none",border:"1px solid #d8d8d6",borderRadius:"5px",color:"#888",cursor:"pointer",padding:"4px 8px",fontFamily:"inherit",flexShrink:0,display:"flex",alignItems:"center"}} onMouseEnter={function(e){ e.currentTarget.style.borderColor="#1a1a1a"; }} onMouseLeave={function(e){ e.currentTarget.style.borderColor="#d8d8d6"; }}><UndoIcon size={13} color="#888"/></button>}
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
          <div style={{position:"relative",flex:"1 1 auto",display:"flex",justifyContent:"flex-end",padding:"0 6px",minWidth:0}}>
            {bannerInline && !searchExpanded && (
              <div onClick={function(){ onBannerTap(); }} title="Tap to see the change"
                onTouchStart={function(e){ if(e.touches&&e.touches.length===1){ bannerTouchStart.current=e.touches[0].clientY; } }}
                onTouchMove={function(e){ if(bannerTouchStart.current==null||!e.touches||!e.touches.length) return; var dy=e.touches[0].clientY-bannerTouchStart.current; setBannerSwipeY(Math.min(0,dy)); }}
                onTouchEnd={function(){ var dy=bannerSwipeY; bannerTouchStart.current=null; if(dy<-30){ dismissBanner(); } else { setBannerSwipeY(0); } }}
                style={{marginLeft:"auto",marginRight:"auto",maxWidth:"calc(100% - 44px)",display:"flex",alignItems:"center",gap:"8px",background:getBannerColor(banner.type),color:"#fff",padding:"4px 12px",borderRadius:"16px",fontSize:"11px",letterSpacing:"0.03em",cursor:"pointer",boxShadow:"0 1px 6px rgba(0,0,0,0.18)",overflow:"hidden",whiteSpace:"nowrap",transform:"translateY("+bannerSwipeY+"px)",opacity:Math.max(0.2,1+bannerSwipeY/80),transition:bannerSwipeY===0?"transform 0.2s ease, opacity 0.2s ease":"none",touchAction:"none"}}>
                <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>{describeBanner(banner)}</span>
                {(banner.type!=="undo"&&banner.type!=="redo"&&canUndo)&&(
                  <button onClick={function(e){ e.stopPropagation(); handleUndo(); }} title="Undo" style={{background:"rgba(255,255,255,0.22)",border:"none",borderRadius:"9px",color:"#fff",padding:"3px 7px",cursor:"pointer",fontFamily:"inherit",flexShrink:0,display:"flex",alignItems:"center"}}><UndoIcon size={13} color="#fff"/></button>
                )}
              </div>
            )}
            {!searchExpanded ? (
              <button onClick={function(){ setSearchExpanded(true); setTimeout(function(){ if(searchInputRef.current) searchInputRef.current.focus(); }, 0); }} title="Search a name" style={{...navBtn,width:"32px",padding:"0",background:"#f6f6f4",border:"1px solid #e0e0de"}}><SearchIcon size={15} color="#888"/></button>
            ) : (
              <div style={{position:"relative",width:"100%",maxWidth:"300px"}}>
                <input ref={searchInputRef} value={searchText}
                  onChange={function(e){ setSearchText(e.target.value); setSearchOpen(true); setSearchIdx(-1); }}
                  onFocus={function(){ setSearchOpen(true); }}
                  onBlur={function(){ setTimeout(function(){ setSearchOpen(false); setSearchExpanded(false); setSearchText(""); setSearchIdx(-1); }, 150); }}
                  onKeyDown={function(e){
                    // v89 revert lever — old Enter-picks-first-only handler was:
                    // if(e.key==="Enter"){ var m=searchMatches(searchText); if(m.length>0) runClientSearch(m[0]); }
                    // else if(e.key==="Escape"){ setSearchText(""); setSearchOpen(false); setSearchExpanded(false); }
                    var mm = searchMatches(searchText);
                    if (mm.length>0 && (e.key==="ArrowDown"||e.key==="ArrowUp")) {
                      e.preventDefault();
                      if (e.key==="ArrowDown") { setSearchIdx(Math.min(searchIdx+1, mm.length-1)); }
                      else { setSearchIdx(searchIdx<=0 ? -1 : searchIdx-1); }
                      return;
                    }
                    if (e.key==="Enter") {
                      if (mm.length===0) return;
                      var pickNm = (searchIdx>=0 && searchIdx<mm.length) ? mm[searchIdx] : mm[0];
                      setSearchIdx(-1);
                      runClientSearch(pickNm);
                      return;
                    }
                    if (e.key==="Escape") { setSearchText(""); setSearchOpen(false); setSearchExpanded(false); setSearchIdx(-1); }
                  }}
                  placeholder="Search a name…"
                  style={{width:"100%",boxSizing:"border-box",padding:"5px 12px",border:"1px solid #e0e0de",borderRadius:"14px",background:"#f6f6f4",fontFamily:"inherit",fontSize:"12px",color:"#1a1a1a",outline:"none"}} />
                {searchOpen && searchText.trim() && (function(){
                  var matches = searchMatches(searchText);
                  return (
                    <div style={{position:"absolute",top:"30px",left:0,right:0,background:"#fff",border:"1px solid #e0e0de",borderRadius:"8px",boxShadow:"0 6px 20px rgba(0,0,0,0.12)",zIndex:200,overflow:"hidden",maxHeight:"50vh",overflowY:"auto"}}>
                      {matches.length===0 ? (
                        <div style={{padding:"8px 12px",fontSize:"12px",color:"#aaa"}}>No matches</div>
                      ) : matches.map(function(nm,mi){ var pr=getClientPrice(nm); var mOn=(mi===searchIdx); return (
                        /* #6: name on the left, their price on the right (same styling as the
                           inline name-edit suggestions). Rows with no known price just show the
                           name. Revert lever — restore the plain name-only row:
                           <div key={nm} onMouseDown={function(e){ e.preventDefault(); }} onClick={function(){ runClientSearch(nm); }} style={{padding:"9px 12px",fontSize:"13px",color:"#1a1a1a",cursor:"pointer",borderBottom:"1px solid #f2f2f0",fontFamily:"Georgia,serif"}}>{nm}</div> */
                        <div key={nm} onMouseDown={function(e){ e.preventDefault(); }} onClick={function(){ setSearchIdx(-1); runClientSearch(nm); }} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"10px",padding:"9px 12px",fontSize:"13px",color:"#1a1a1a",cursor:"pointer",borderBottom:"1px solid #f2f2f0",fontFamily:"Georgia,serif",background:mOn?"#f1e6c6":"transparent"}}><span style={{whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{nm}</span>{pr?<span style={{fontSize:"11px",color:"#a07830",flexShrink:0}}>{pr}</span>:null}</div>
                      ); })}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
          {view==="Month"&&<div style={{fontSize:"14px",color:"#1a1a1a"}}>{baseDate.toLocaleDateString("en-US",{month:"long",year:"numeric"})}</div>}
          <div style={{display:"flex",gap:"4px",alignItems:"center"}}>
            <button onClick={openShareSheet} title="Share openings" style={{...navBtn,width:"32px",padding:"0"}}><MessageIcon size={17} color="#777"/></button>
            <button onClick={function(){ setQuickMsgModal(true); }} title="Quick messages" style={{...navBtn,width:"32px",padding:"0"}}><CopyIcon size={16} color="#777"/></button>
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
        var mTot=acctMonthTotals(baseDate);
        return (
          <div style={{width:"100vw",position:"relative",left:"50%",right:"50%",marginLeft:"-50vw",marginRight:"-50vw",boxSizing:"border-box",textAlign:"left",flex:"1 1 auto",display:"flex",flexDirection:"column",minHeight:0}}>
            {(mTot.takehome>0||mTot.services>0||mTot.hours>0)&&(
              <div style={{display:"flex",justifyContent:"center",alignItems:"baseline",flexWrap:"wrap",gap:isPhone?"14px":"24px",padding:isPhone?"6px 8px":"8px 12px",background:"#faf7f0",borderBottom:"1px solid #ece4d4",flexShrink:0,fontFamily:"Georgia,serif"}}>
                <span style={{fontSize:isPhone?"12px":"14px",color:"#777"}}>{"$"+Math.round(mTot.takehome)}</span>
                {mTot.services>0&&<span style={{fontSize:isPhone?"12px":"14px",color:"#777"}}>{"# "+mTot.services}</span>}
                {mTot.hours>0&&<span style={{fontSize:isPhone?"12px":"14px",color:"#777"}}>{": "+mTot.hours}</span>}
              </div>
            )}
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,minmax(0,1fr))",background:"#e8e8e6",gap:"1px",borderBottom:"1px solid #e8e8e6",flexShrink:0}}>
              {(isPhone?["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]:["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]).map(function(d){ return <div key={d} style={{padding:"8px 0",textAlign:"center",fontSize:isPhone?"9px":"10px",letterSpacing:"0.1em",textTransform:"uppercase",color:"#aaa",background:"#fafaf8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d}</div>; })}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,minmax(0,1fr))",gap:"1px",background:"#e8e8e6",flex:"1 1 auto",gridAutoRows:"1fr",minHeight:0}}>
              {monthDays.map(function(day,i){
                var outside = day.getMonth() !== baseDate.getMonth();
                var dk=toDateKey(day); var slots=getSlots(dk); var booked=slots.filter(function(s){ return s.name; });
                var isT=isToday(day); var holiday=getHolidayForDate(dk); var range=getDayTimeRange(dk);
                var cellBg = outside ? "#f6f6f4" : (isT?"#fffbf0":"#ffffff");
                // v78: glide highlight — this day lights up while a live drag (single
                // or group) passes over it, so it's clear where the drop will land.
                var mOver = isLiveDragging && dragLifted && dragOverKey===("M:"+dk);
                if (mOver) cellBg = "#e3f3e3";
                return (
                  <div key={dk} data-monthday={dk}
                    onClick={function(){ setBaseDate(day);setView(isPhone?"Day":"3-Day"); }}
                    onMouseDown={function(){ longPressTimer.current=setTimeout(function(){ setMonthLongPress({dateKey:dk,day}); },600); }}
                    onMouseUp={cancelLongPress} onMouseLeave={function(e){ cancelLongPress();e.currentTarget.style.background=cellBg; }}
                    onTouchStart={function(){ longPressTimer.current=setTimeout(function(){ setMonthLongPress({dateKey:dk,day}); },600); }}
                    onTouchEnd={cancelLongPress} onTouchMove={cancelLongPress}
                    style={{position:"relative",background:cellBg,minHeight:isPhone?"50px":"64px",padding:isPhone?"4px 4px":"7px 8px",cursor:"pointer",borderTop:isT?("2px solid "+TODAY_BLUE):"2px solid transparent",transition:"background 0.1s",userSelect:"none",boxSizing:"border-box",overflow:"hidden",opacity:outside?0.85:1,outline:mOver?"2px solid #5a9a5a":"none",outlineOffset:"-2px"}}
                    onMouseEnter={function(e){ e.currentTarget.style.background=outside?"#efefec":(isT?"#fff8e8":"#f4f4f2"); }}
                  >
                    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:"6px",marginBottom:"3px"}}>
                      <div style={{fontSize:"14px",color:isT?TODAY_BLUE:(outside?"#bdbdbb":"#1a1a1a"),fontWeight:isT?"bold":"normal",flexShrink:0}}>{day.getDate()}</div>
                      {holiday&&<div style={{fontSize:"11px",color:outside?"#cbb98e":"#a07830",textAlign:"right",lineHeight:1.2,letterSpacing:"0.08em",textTransform:"uppercase",marginTop:"4px",minWidth:0,overflow:"hidden"}}>{holiday}</div>}
                    </div>
                    {booked.length>0&&(
                      <div style={{opacity:outside?0.55:1}}>
                        <div style={{display:"flex",flexWrap:"wrap",gap:"3px",marginBottom:"3px"}}>
                          {booked.map(function(s,j){ return <div key={j} style={{width:"8px",height:"8px",borderRadius:"50%",background:s.recurWeeks?"#6a8aaa":"#c9a96e"}}/>; })}
                        </div>
                        {range&&<div style={{fontSize:"11px",color:"#777",fontWeight:"500"}}>{range}</div>}
                      </div>
                    )}
                    {acctHasData(dk)&&(function(){ var r=acctFor(dk); var sv=acctNum(r.services); var hr=acctNum(r.hours); return (
                      <div style={{marginTop:"3px",fontSize:isPhone?"9px":"11px",lineHeight:1.3,fontFamily:"Georgia,serif"}}>
                        <div style={{color:outside?"#c2c2c0":"#888"}}>{"$"+Math.round(acctTakehome(r))}</div>
                        <div style={{color:outside?"#c2c2c0":"#888"}}>{"#"+sv}</div>
                        <div style={{color:outside?"#c2c2c0":"#888"}}>{":"+hr}</div>
                      </div>
                    ); })()}
                    {(function(){ var rN=resolveDayNote(dk); var hasN=!!rN.text; var k=rN.text?rN.kind:null; var rep=rN.repeating; var col=!hasN?"#cfcccc":(k==="personal"?TODAY_BLUE:"#c9a96e"); return (
                      <button onClick={function(e){ e.stopPropagation(); var rws=dnPrefillRows(dk); setNoteLines(rws); setNoteOrigLines(rws.slice()); setNoteRepeatPopup(null); setNoteScopeAsk(null); setNoteModal({dayKey:dk,isDay:true,name:friendlyDateLong(dk)}); }} onMouseDown={function(e){ e.stopPropagation(); }} onTouchStart={function(e){ e.stopPropagation(); }} title={hasN?"Day note":"Add a day note"} style={{position:"absolute",bottom:"2px",right:"3px",background:"none",border:"none",cursor:"pointer",padding:"2px 3px",color:col,fontSize:isPhone?"13px":"15px",lineHeight:1,opacity:outside?0.6:1,WebkitTextStroke:"0.4px currentColor"}}>{"✎"}{rep?<sup style={{fontSize:"7px",marginLeft:"1px",opacity:0.85,WebkitTextStroke:"0px"}}>{"↺"}</sup>:null}</button>
                    ); })()}
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
                    var wdStr=isToday(date)?"Today":date.toLocaleDateString("en-US",{weekday:"long"});
                    var hol=getHolidayForDate(dateKey);
                    if (view==="Week") {
                      // Week view columns are narrow, so the weekday and date stay stacked.
                      return (
                        <div style={{minWidth:0,overflow:"hidden",flex:1}}>
                          <div style={{display:"flex",alignItems:"baseline",gap:"6px",minWidth:0,marginBottom:"3px"}}>
                            <span style={{fontSize:sz,color:isToday(date)?TODAY_BLUE:"#b89a5a",lineHeight:1.1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",flexShrink:1,textTransform:"uppercase",letterSpacing:"0.06em"}}>{wdStr}</span>
                            {hol&&<span style={{fontSize:sz,color:"#a07830",letterSpacing:"0.08em",textTransform:"uppercase",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minWidth:0,flexShrink:1}}>{hol}</span>}
                          </div>
                          <div style={{fontSize:sz,color:"#1a1a1a",lineHeight:1.1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",textTransform:"uppercase",letterSpacing:"0.06em"}}>{monthStr}</div>
                        </div>
                      );
                    }
                    // Day / 3-Day / Wknd: weekday and date sit side by side on one line.
                    return (
                      <div style={{minWidth:0,overflow:"hidden",flex:1,display:"flex",alignItems:"baseline",gap:"9px"}}>
                        <span style={{fontSize:sz,color:isToday(date)?TODAY_BLUE:"#b89a5a",lineHeight:1.1,whiteSpace:"nowrap",flexShrink:0,textTransform:"uppercase",letterSpacing:"0.06em"}}>{wdStr+","}</span>
                        <span style={{fontSize:sz,color:"#1a1a1a",lineHeight:1.1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minWidth:0,flexShrink:1,textTransform:"uppercase",letterSpacing:"0.06em"}}>{monthStr}</span>
                        {hol&&<span style={{fontSize:sz,color:"#a07830",letterSpacing:"0.08em",textTransform:"uppercase",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",minWidth:0,flexShrink:2,alignSelf:"center"}}>{hol}</span>}
                      </div>
                    );
                  })()}
                  <button onClick={function(e){ e.stopPropagation(); setAcctAdd({}); setAcctModal({dateKey:dateKey}); }} title="Accounting for the day" style={{background:"none",border:"none",cursor:"pointer",padding:(getDayCount()>3?"0 2px":"0 4px 0 2px"),color:acctHasData(dateKey)?"#c9a96e":"#bbb",fontSize:"19px",fontWeight:"bold",lineHeight:1,flexShrink:0,fontFamily:"Georgia,serif"}}>{"$"}</button>
                  <button onClick={function(e){ e.stopPropagation(); var rws=dnPrefillRows(dateKey); setNoteLines(rws); setNoteOrigLines(rws.slice()); setNoteRepeatPopup(null); setNoteScopeAsk(null); setNoteModal({dayKey:dateKey,isDay:true,name:friendlyDateLong(dateKey)}); }} title="Note for the day" style={{background:"none",border:"none",cursor:"pointer",padding:(getDayCount()>3?"0 2px":"0 9px 0 2px"),color:dayNoteText(dateKey)?"#c9a96e":"#bbb"/* v89 uniform gold. Revert lever: dayNoteText(dateKey)?(dayNoteKind(dateKey)==="personal"?TODAY_BLUE:"#c9a96e"):"#bbb" */,fontSize:"22px",lineHeight:1,flexShrink:0,WebkitTextStroke:"0.5px currentColor"}}>{"✎"}{dayNoteRepeating(dateKey)?<sup style={{fontSize:"9px",marginLeft:"1px",opacity:0.85,WebkitTextStroke:"0px"}}>{"↺"}</sup>:null}</button>
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
                    // Same-time collision: show the two people SIDE BY SIDE as one shared
                    // row, so a double-up is obvious instead of hiding as a near-identical
                    // extra row stacked at the same time. Scan the whole run of slots at this
                    // time; if 2+ are NAMED, the first two render as the shared pair. A stray
                    // EMPTY row sharing that time is hidden (it's the confusing "extra slot,"
                    // not a real open spot). A rare 3rd named person still stacks below the
                    // pair so nobody is hidden. (Old rule only paired EXACTLY two adjacent
                    // named rows, so any stray same-time slot broke the pairing into a stack.)
                    var __t = slot.time;
                    var __runStart = idx; while (__runStart>0 && slots[__runStart-1].time===__t) __runStart--;
                    var __runEnd = idx; while (__runEnd<slots.length-1 && slots[__runEnd+1].time===__t) __runEnd++;
                    var __named = [];
                    for (var __r=__runStart; __r<=__runEnd; __r++) { if (slots[__r].name) __named.push(__r); }
                    if (__named.length>=2) {
                      if (idx===__named[0]) return renderSharedPair(dateKey, slots[__named[0]], __named[0], slots[__named[1]], __named[1]);
                      if (idx===__named[1]) return null;
                      if (!slot.name) return null;
                    }
                    var isEditing=editingCell&&editingCell.dateKey===dateKey&&editingCell.idx===idx;
                    var __rmVal=recentlyRemoved[dateKey+"-"+idx]; var filled=!!slot.name; var wasRemoved=__rmVal&&!slot.name; var rmName=(typeof __rmVal==="string")?__rmVal:"";
                    var wasPlaced=recentlyPlaced[dateKey+"-"+idx]&&!!slot.name; // B1: green glow on a just-landed spot
                    var isSwiped=swipedSlot===(dateKey+"-"+idx); var rowKey=dateKey+"-"+idx;
                    // On a phone, a plain open slot must be a *real* editable field so the
                    // very first tap (a true user gesture) raises the keyboard. Programmatic
                    // focus 50ms later — which is what iPad leans on — is ignored by iOS on
                    // iPhone, which is why the keyboard never appeared. iPad stays read-only.
                    var phoneEmptyTypable = isPhone && !filled && !slot.blocked && !slot.availStatus && !slot.done;
                    var isOccEdit=isEditing&&editingOccupied;
                    var isSelected=selectMode&&!!selectedSlots[rowKey];
                    // B1: a group/multi drag greys EVERY member, not just the one grabbed.
                    // sourceKey covers the grabbed row; the clients list covers the rest.
                    var isDragging=dragState&&(dragState.sourceKey===rowKey||(dragState.multi&&dragState.clients&&dragState.clients.some(function(c){ return (c.originalDateKey+"-"+c.originalIdx)===rowKey; })));
                    var slotBg=slot.blocked?"#f4f4f2":(wasRemoved&&!isEditing)?"#fff0ee":isOccEdit?"#fff0ee":isSelected?"#f0f4ff":(wasPlaced&&!isEditing)?"#e0f4e0":slot.done?"#f4faf4":(isEditing&&editChromeReady)?"#f0f0ee":filled?"#fcfcfa":"transparent";
                    var isSearchHit=searchHit&&slot.name&&slot.name.toLowerCase()===searchHit.name&&dateKey===searchHit.dateKey;
                    if (isSearchHit&&!isEditing) slotBg="#bfe9bf";
                    var isCustomSlot=slot.isCustom===true||(slot.isCustom===undefined&&!slot.defaultBaseTime&&!DEFAULT_TIMES.includes(slot.time));
                    var defShift=(!isCustomSlot&&slot.defaultBaseTime&&slot.time!==slot.defaultBaseTime)?(timeToAbsMinutes(slot.time)<timeToAbsMinutes(slot.defaultBaseTime)?"earlier":"later"):null;
                    var compactIcons=(view==="Week")||(isPhone&&view==="Wknd");
                    // #11: while dragging a GROUP, a slot already held by one of that
                    // group's members is still an eligible landing spot, so let it
                    // highlight like an empty slot does.
                    var groupMemberHere=filled&&dragState&&dragState.multi&&dragState.clients&&slot.name&&dragState.clients.some(function(c){ return (c.name||"").toLowerCase()===slot.name.toLowerCase(); });
                    var dropEligible=(!filled||groupMemberHere)&&!slot.blocked;
                    var isDropTarget=isLiveDragging&&dragLifted&&dragOverKey===rowKey&&dropEligible;
                    var showDropHint=((isLiveDragging&&dragLifted)||placingClient)&&dropEligible&&!isEditing&&!(dragState&&dragState.sourceKey===rowKey);
                    if (isDropTarget) slotBg="#e3f3e3";
                    else if (placingClient&&!filled&&!slot.blocked&&!isEditing) slotBg="#f4faf4";
                    else if (!filled&&!slot.blocked&&slot.availStatus&&!isEditing) slotBg="#e7f6e7";
                    var isFlash=flashCells&&flashCells.keys[dateKey+"|"+slot.time]&&!isEditing&&!isDropTarget;
                    var flashFam=isFlash?bannerFamily(flashCells.type):null;
                    if (isFlash) slotBg=flashTintFor(flashFam);
                    return (
                      <div key={rowKey} style={{position:"relative",overflow:isEditing?"visible":"hidden",zIndex:isEditing?50:"auto",borderBottom:"1px solid #efefed",opacity:(isDragging&&dragLifted)?0.4:1,flex:"1 1 0px",minHeight:"26px",display:"flex",flexDirection:"column"}}>
                        {!filled&&!slot.blocked&&!isEditing&&!(reassignMode&&reassignMode.currentDateKey===dateKey)&&!placingClient&&isCustomSlot&&(
                          <div style={{position:"absolute",right:"10px",top:0,bottom:0,display:"flex",alignItems:"center",gap:"4px",pointerEvents:"auto",zIndex:1}}>
                            <button onClick={function(e){ e.stopPropagation(); removeCustomSlot(dateKey,idx); }} style={{background:"none",border:"none",color:"#ddd",fontSize:"12px",cursor:"pointer",fontFamily:"inherit",padding:"2px 4px"}} onMouseEnter={function(e){ e.currentTarget.style.color="#c0392b"; }} onMouseLeave={function(e){ e.currentTarget.style.color="#ddd"; }}>{"× slot"}</button>
                          </div>
                        )}
                        {view!=="Week"&&!filled&&!slot.blocked&&!isEditing&&!(reassignMode&&reassignMode.currentDateKey===dateKey)&&!placingClient&&slot.availStatus&&(
                          <div style={{position:"absolute",right:"10px",top:0,bottom:0,display:"flex",alignItems:"center",pointerEvents:"auto",zIndex:2}}>
                            <button onClick={function(e){ e.stopPropagation(); cycleSlotMark(dateKey,idx,null); }} title="Restore to an open slot" style={{background:"#fff",border:"1px solid #cfe6cf",borderRadius:"50%",width:"20px",height:"20px",display:"flex",alignItems:"center",justifyContent:"center",color:"#3a7a3a",fontSize:"13px",lineHeight:1,cursor:"pointer",fontFamily:"inherit",padding:0}}>{"×"}</button>
                          </div>
                        )}
                        <div
                          data-droprow={rowKey} data-dropfilled={filled?"1":"0"} data-dropblocked={slot.blocked?"1":"0"}
                          style={{display:"flex",alignItems:"center",padding:(getDayCount()>3?"0 7px":"0 14px"),flex:"1 1 auto",minHeight:0,background:slotBg,transition:"background 0.2s",animation:isFlash?(flashAnimFor(flashFam)+" 1.6s ease-out"):"none",position:"relative",opacity:slot.blocked?0.6:1,userSelect:"none",WebkitUserSelect:"none",outline:isDropTarget?"2px solid #5a9a5a":(showDropHint?"1px dashed #cdddcd":"none"),outlineOffset:"-3px",borderRadius:isDropTarget?"6px":"0"}}
                          onTouchStart={function(e){ handleTouchStart(e,dateKey,idx); }}
                          onTouchEnd={function(e){ handleTouchEnd(e,dateKey,idx); }}
                          onMouseUp={function(){ if(dragState&&!dragState.multi&&!dragCalHover) handleSlotDrop(dateKey,idx); }}
                        >
                          {(wasRemoved||isOccEdit)&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:"3px",background:"#c0392b"}}/>}
                          {wasPlaced&&!isEditing&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:"3px",background:"#2a7a2a"}}/>}
                          {isSelected&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:"3px",background:"#4a7aaa"}}/>}
                          {isSearchHit&&!isEditing&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:"3px",background:"#2a7a2a"}}/>}
                          {isFlash&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:"3px",background:flashBarFor(flashFam)}}/>}
                          {slot.groupId&&!wasRemoved&&(function(){
                            var ds=getSlots(dateKey); var gS=ds.map(function(s,i){ return {...s,i}; }).filter(function(s){ return s.groupId===slot.groupId&&s.name; });
                            var first=gS[0]&&gS[0].i===idx; var last=gS[gS.length-1]&&gS[gS.length-1].i===idx; var inG=gS.some(function(s){ return s.i===idx; });
                            if (!inG) return null;
                            // v82 (#3): a group of one isn't a group. When a member is pulled out and
                            // only one named slot still carries this groupId, first && last are both
                            // true and the accent would render as a stray zero-height nub. Skip it so
                            // no leftover "joined" marker lingers on the person left behind.
                            if (gS.length < 2) return null;
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
                          ) : slot.blocked ? (
                          /* v77: blocked spots + lunches can't be checked off, so the empty
                             circle was just noise Granger didn't want. Drop the circle and
                             leave a same-size spacer (18px + 10px right margin) so the time
                             column on blocked rows still lines up with everyone else. */
                          <div style={{width:"18px",height:"18px",marginRight:"10px",flexShrink:0}}/>
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
                            <div style={{flex:1,minWidth:0,display:"flex",alignItems:"center",gap:"4px",position:"relative"}}
                              onClick={function(e){ if(filled&&slot.done) handleDoneRowTap(dateKey,idx); else if(!filled&&!slot.blocked){ startEdit(dateKey,idx,false); } }}
                              onPointerDown={function(e){ dragPointerId.current=e.pointerId; }}
                              onMouseDown={function(){ if(filled&&!slot.done&&!isEditing&&(!selectMode||selectedSlots[rowKey])) startDragLongPress(dateKey,idx,0,0); }}
                              onMouseUp={function(){ cancelDragLongPress(); }}
                              onMouseLeave={cancelDragLongPress}
                              onTouchStart={function(e){ if(filled&&!slot.done&&!isEditing&&(!selectMode||selectedSlots[rowKey])){ startDragLongPress(dateKey,idx,e.touches[0].clientX,e.touches[0].clientY,true); } }}
                              onTouchMove={function(e){ if(e.touches[0]) cancelDragLongPressIfMoved(e.touches[0].clientX,e.touches[0].clientY); }}
                              onTouchEnd={function(e){ var wasTap=!!dragLongPress.current; cancelDragLongPress(); handleTouchEnd(e,dateKey,idx); if(wasTap&&filled&&!slot.done&&!isEditing&&!selectMode) startEdit(dateKey,idx); }}
                            >
                              {wasRemoved&&!isEditing&&rmName&&<div style={{position:"absolute",left:"2px",top:0,bottom:0,display:"flex",alignItems:"center",pointerEvents:"none",fontStyle:"italic",fontFamily:"Georgia,serif",fontSize:isPhone?"16px":"13px",color:"#9a2f22",opacity:0.72,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:"100%",zIndex:1}}>{rmName}</div>}
                              {isOccEdit&&<div style={{position:"absolute",top:"2px",left:"70px",fontSize:"9px",color:"#c0392b"}}>Editing {slot.name}</div>}
                              <input
                                value={isEditing?editValues.name:(wasRemoved?"":(slot.name||((!filled&&slot.availStatus)?(slot.availStatus==="overtime"?"OVERTIME":"AVAILABLE"):"")))}
                                readOnly={!isEditing && !phoneEmptyTypable}
                                name="tlentry" inputMode="text" data-lpignore="true" data-1p-ignore="true" data-form-type="other" data-bwignore="true"
                                autoComplete="off" autoCorrect="off" autoCapitalize="words" spellCheck={false}
                                onFocus={function(){ if(!isEditing&&!selectMode&&!isLiveDragging&&!dragState&&!slot.done) startEdit(dateKey,idx,false); }}
                                onChange={function(e){ if(!isEditing){ if(!selectMode&&!isLiveDragging&&!dragState&&!slot.done) startEdit(dateKey,idx,false); } setEditValues(function(v){ return {...v,name:e.target.value}; }); setSuggestIdx(-1); setSuggestHide(false); if(!editChromeReady) setEditChromeReady(true); }}
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
                                      {/* v99: the ARROW COLUMN always opens the profile, done or not. The
                                          done-row check that used to live here sent a checked-off recurring
                                          client to the DONE/quick-book popup instead — the one place in the
                                          whole column that did not behave like the others. Revert lever —
                                          the pre-v99 line: onClick={function(e){ e.stopPropagation(); if(slot.done){ handleDoneRowTap(dateKey,idx); } else { openClientProfile(slot.name); } }} */}
                                      <span onClick={function(e){ e.stopPropagation(); openClientProfile(slot.name); }} style={{fontSize:"12px",fontWeight:"500",color:"#4a8a9a",cursor:"pointer",lineHeight:1,letterSpacing:"0.01em"}}>{(slot.recurWeeks===1?"1w":(slot.recurWeeks+"w"))+(slot.isException?"*":"")}</span>
                                      <button onClick={function(e){ e.stopPropagation(); /* v99: the done-row bail-out that used to sit right here is gone — it was the reason a checked-off recurring client's arrow opened the DONE popup instead of the profile. Revert lever — the pre-v99 first statement: if(slot.done){ handleDoneRowTap(dateKey,idx); return; } */ /* v79: recurring arrow now opens the CLIENT PROFILE. The single recurring editor AND the group recurring manager both stay reachable inside the profile via its "Edit or cancel recurring" button, so nothing is lost. Old direct-to-modal routing kept as a revert lever: if(slot.groupId){var aS=getSlots(dateKey);var gS=aS.map(function(s,i){ return {...s,i}; }).filter(function(s){ return s.groupId===slot.groupId&&s.name; });if(gS.length>1){setGroupRecurModal({dateKey,idx,slot,groupSlots:gS,weeks:null});return;}} setRecurringModal({dateKey,idx,slot}); */ openClientProfile(slot.name); }} title={"Recurring — tap for profile"} style={{background:"none",border:"none",cursor:"pointer",padding:"0 1px",color:"#4a8a9a",fontSize:"16px",fontWeight:"500",lineHeight:1}}>{"↺"}</button>
                                    </div>
                                  ):(hasLaterBooking(slot.name,dateKey)?(
                                    /* v77: NON-recurring person who already has their next
                                       appointment on the books. Same arrow, same spot as the
                                       recurring badge — but NO weeks number beside it, so it
                                       reads as "next one's booked" without implying a series. */
                                    <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:"2px",width:"50px",flexShrink:0}}>
                                      <span onClick={function(e){ e.stopPropagation(); openClientProfile(slot.name); }} title="Next appointment — tap for profile" style={{color:"#4a8a9a",fontSize:"16px",fontWeight:"500",lineHeight:1,padding:"0 1px",cursor:"pointer"}}>{"↺"}</span>
                                    </div>
                                  ):/* v81: NON-recurring person with NO next appointment booked — the ↺ column
                                       is blank for them. That blank is now a tap target that opens their client
                                       profile (the tap-path to their profile now that press-and-hold is drag-only).
                                       Stays visually empty; alignSelf:stretch gives it real height to catch the tap;
                                       stopPropagation keeps it off the row's drag/tap handlers. Revert lever —
                                       restore the bare spacer: <div style={{width:"50px",flexShrink:0}}/> */
                                     <div onClick={function(e){ e.stopPropagation(); openClientProfile(slot.name); }} title={"Open "+slot.name+"'s profile"} style={{width:"50px",flexShrink:0,alignSelf:"stretch",cursor:"pointer"}}/>))}
                                  {!compactIcons&&filled&&(function(){
                                    var digits=getClientPhone(slot.name).replace(/[^0-9+]/g,"");
                                    if (digits) {
                                      return <button onClick={function(e){ e.stopPropagation(); window.location.href="sms:"+digits; }} title={"Message "+slot.name} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 1px 2px 4px",lineHeight:1,flexShrink:0,display:"flex",alignItems:"center"}}><MessageIcon size={20} color="#c9a96e"/></button>;
                                    }
                                    return <button onClick={function(e){ e.stopPropagation(); setPhoneModal({name:slot.name,phone:""}); }} title={"Add a number for "+slot.name} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 1px 2px 4px",lineHeight:1,flexShrink:0,display:"flex",alignItems:"center"}}><MessageIcon size={20} color="#c6c6c6"/></button>;
                                  })()}
                                  {/* v98 THE ROW PENCIL IS GONE. It opened the per-appointment note
                                      (slot.note), which is the model we retired — a note is now a
                                      fact about the CLIENT and is written on his profile. The row
                                      keeps no cue that a note exists, by request: the row stays
                                      clean. The slot-note modal itself is untouched and still fully
                                      wired (the DAY note shares it), and every existing slot.note is
                                      still sitting in the data, unread and unharmed. Revert lever —
                                      the v89 button, verbatim; paste it back and slot notes return
                                      with all their old data intact:
                                  {!compactIcons&&filled&&<button onClick={function(e){ e.stopPropagation(); setNoteDraft(slot.note||""); setNoteKind(slot.noteKind||null); setNoteRepeat(0); setNoteWasRepeat(false); setNoteScopeAsk(null); setNoteModal({dateKey,idx,name:slot.name}); }} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 5px",color:slot.note?"#c9a96e":"#bbb",fontSize:"24px",fontWeight:"bold",lineHeight:1,WebkitTextStroke:"0.6px currentColor"}}>{"\u270e"}</button>}
                                  */}
                                </div>
                              )}
                              {isEditing&&editChromeReady&&<input value={editValues.price} onChange={function(e){ setEditValues(function(v){ return {...v,price:e.target.value}; }); }} onKeyDown={function(e){ if(e.key==="Tab"&&!e.shiftKey){ var nmT=stripLeadingNumbers(((editValuesRef.current&&editValuesRef.current.name)||"").trim()); if(nmT){ e.preventDefault(); commitPenciled(dateKey,idx); return; } } handleKeyDown(e,dateKey,idx); }} onBlur={handleBlur} data-rowkey={rowKey} placeholder="$" style={{width:view==="Week"?"26px":"52px",fontSize:isPhone?"16px":"13px",color:"#1a1a1a",background:"#f0f0ee",border:"1px solid #d8d8d6",borderRadius:"4px",outline:"none",padding:view==="Week"?"2px 3px":"2px 5px",fontFamily:"Georgia,serif",WebkitAppearance:"none",appearance:"none"}}/>}
                              {/* v98 THE PENCIL BUTTON IS GONE. TAB IS THE PENCIL NOW. The button did two
                                  jobs: with a name typed it called commitPenciled — which is EXACTLY what
                                  Tab-from-the-price-box already does, one line above, so that half was pure
                                  duplication. With the name box empty it toggled pencilArmed ("pencil mode"),
                                  and that was the only switch that turned pencilArmed on. With the button
                                  gone, pencilArmed can no longer be raised, so the handful of branches that
                                  read it (the Enter-pencils path, the blur/snap commit) simply never fire —
                                  they are left in place, inert and harmless, rather than torn out, so this is
                                  one paste away from being undone. One road to a pencil: Tab off the price.
                                  Revert lever — the v82 button, verbatim:
                              {isEditing&&editChromeReady&&<button data-rowkey={rowKey} onMouseDown={function(e){ e.preventDefault(); }} onClick={function(e){ e.preventDefault(); var nm=stripLeadingNumbers(((editValuesRef.current&&editValuesRef.current.name)||"").trim()); if(nm){ commitPenciled(dateKey,idx); } else { setPencilArmed(function(p){ return !p; }); } }} title={pencilArmed?"Pencil mode on":"Penciled in"} style={{flexShrink:0,marginLeft:view==="Week"?"2px":"4px",display:"flex",alignItems:"center",gap:"3px",background:pencilArmed?"#c9a96e":"#fff",border:pencilArmed?"1px solid #c9a96e":"1px solid #d8c08a",borderRadius:"6px",cursor:"pointer",padding:view==="Week"?"3px 4px":"3px 7px",fontFamily:"Georgia,serif",fontSize:"11px",color:pencilArmed?"#2a2009":"#9a7a30",lineHeight:1,whiteSpace:"nowrap"}}>{view==="Week"?"\u270e":"\u270e Pencil"}</button>}
                              */}
                              {isEditing&&editChromeReady&&!suggestHide&&(function(){
                                var sugs=computeSuggestions(editValues.name);
                                if (sugs.length===0) return null;
                                return (
                                  <div onClick={function(e){ e.stopPropagation(); }} style={{position:"absolute",top:"100%",left:"0",marginTop:"2px",minWidth:"150px",maxWidth:"240px",maxHeight:"176px",overflowY:"auto",background:"#ffffff",border:"1px solid #d8d8d6",borderRadius:"8px",boxShadow:"0 6px 18px rgba(0,0,0,0.16)",zIndex:60,padding:"3px",WebkitOverflowScrolling:"touch"}}>
                                    {sugs.map(function(sug,si){
                                      var hot=si===suggestIdx;
                                      var sugPrice=sug.price||getClientPrice(sug.name)||""; // v86: dropdown price falls back to a booking scan when the profile card's default is blank, matching the header search
                                      return (
                                        <div key={si}
                                          onPointerDown={function(e){ e.preventDefault(); e.stopPropagation(); setSuggestHide(true); setSuggestIdx(-1); doCommit(dateKey,idx,{name:sug.name,price:(sugPrice||editValues.price||"")}); }}
                                          style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"8px",padding:"7px 9px",borderRadius:"6px",cursor:"pointer",background:hot?"#f0ebdd":"transparent"}}>
                                          <span style={{fontSize:"13px",color:"#1a1a1a",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",fontFamily:"Georgia,serif"}}>{sug.name}</span>
                                          {sugPrice?<span style={{fontSize:"11px",color:"#a07830",flexShrink:0}}>{sugPrice}</span>:null}
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
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
