/*
 * Seating Chart — keeps talkers apart.
 * Everything is stored only in this browser (localStorage). No network calls.
 */
(function () {
  "use strict";

  var KEY = "seatchart.v1";
  var ADJ = 1.6; // seats within this distance (both directions) count as "next to"

  var LAYOUTS = {
    pods4: { label: "Tables of 4", per: 4, across: [2, 3, 4, 5], defAcross: 4 },
    pods6: { label: "Tables of 6", per: 6, across: [2, 3, 4], defAcross: 3 },
    pairs: { label: "Pairs in rows", per: 2, across: [2, 3, 4, 5], defAcross: 4 },
    rows: { label: "Single desks in rows", per: 1, across: [4, 5, 6, 7, 8, 9, 10], defAcross: 8 },
  };

  var SAMPLE_NAMES = [
    "Astro Otter", "Banjo Bear", "Cocoa Crab", "Dizzy Dino", "Echo Eel", "Fuzzy Ferret",
    "Gumdrop Goat", "Happy Hippo", "Inky Ibis", "Jolly Jay", "Kooky Koala", "Lucky Llama",
    "Mango Moose", "Noodle Newt", "Pickle Pug", "Peppy Panda", "Quirky Quail", "Rainbow Robin",
    "Sunny Seal", "Tango Tiger", "Umbrella Urchin", "Velvet Vole", "Wiggly Walrus", "Xylo Fox",
    "Yo-yo Yak", "Zippy Zebra", "Bubbly Bee", "Comet Crane",
  ];

  // ───────────────────────── helpers
  function uid() {
    return "s" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }
  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function shortName(name, firstOnly) {
    var parts = String(name).trim().split(/\s+/);
    if (parts.length < 2) return parts[0] || "";
    var last = parts[parts.length - 1];
    if (/^\d/.test(last)) return parts[0] + " " + last;
    if (firstOnly) return parts[0];
    return parts[0] + " " + last.charAt(0) + ".";
  }
  function firstOf(n) { return String(n).trim().split(/\s+/)[0].toLowerCase(); }
  function byName(a, b) { return a.name.localeCompare(b.name); }

  // ───────────────────────── data
  function newStudent(name) {
    return { id: uid(), name: name, talker: false, front: false, quiet: false, lock: false, apart: [] };
  }
  function newClass(name, names) {
    return {
      id: uid(),
      name: name,
      sample: false,
      layout: { type: "pods4", seats: 32, across: 4 },
      students: (names || []).map(newStudent),
      seat: [],
    };
  }
  function sampleState() {
    var c = newClass("Sample class (pretend names)", SAMPLE_NAMES);
    c.sample = true;
    [0, 3, 6, 9, 13, 18, 22].forEach(function (i) { c.students[i].talker = true; });
    c.students[4].front = true;
    c.students[11].front = true;
    c.students[2].quiet = true;
    c.students[16].quiet = true;
    link(c.students[1], c.students[7]);
    link(c.students[20], c.students[25]);
    var st = { version: 1, activeId: c.id, classes: [c] };
    ensureSeats(c);
    arrange(c);
    return st;
  }
  function freshState() {
    var c = newClass("My class", []);
    ensureSeats(c);
    return { version: 1, activeId: c.id, classes: [c] };
  }
  function link(a, b) {
    if (a.apart.indexOf(b.id) < 0) a.apart.push(b.id);
    if (b.apart.indexOf(a.id) < 0) b.apart.push(a.id);
  }
  function unlink(a, b) {
    a.apart = a.apart.filter(function (x) { return x !== b.id; });
    b.apart = b.apart.filter(function (x) { return x !== a.id; });
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return validate(JSON.parse(raw));
    } catch (e) { return null; }
  }
  function validate(d) {
    if (!d || !Array.isArray(d.classes) || !d.classes.length) return null;
    d.classes.forEach(function (c) {
      c.id = c.id || uid();
      c.name = String(c.name || "Class");
      c.layout = c.layout || {};
      if (!LAYOUTS[c.layout.type]) c.layout.type = "pods4";
      c.layout.seats = clampInt(c.layout.seats, 4, 48, 32);
      c.layout.across = clampInt(c.layout.across, 1, 12, LAYOUTS[c.layout.type].defAcross);
      c.students = (Array.isArray(c.students) ? c.students : []).filter(function (s) { return s && s.name; }).map(function (s) {
        return {
          id: String(s.id || uid()), name: String(s.name).slice(0, 60),
          talker: !!s.talker, front: !!s.front, quiet: !!s.quiet, lock: !!s.lock,
          apart: Array.isArray(s.apart) ? s.apart.map(String) : [],
        };
      });
      var ids = {};
      c.students.forEach(function (s) { ids[s.id] = true; });
      c.students.forEach(function (s) { s.apart = s.apart.filter(function (x) { return ids[x] && x !== s.id; }); });
      c.seat = (Array.isArray(c.seat) ? c.seat : []).map(function (x) { return x && ids[x] ? String(x) : null; });
      ensureSeats(c);
    });
    if (!d.classes.some(function (c) { return c.id === d.activeId; })) d.activeId = d.classes[0].id;
    d.version = 1;
    return d;
  }
  function clampInt(v, lo, hi, def) {
    v = parseInt(v, 10);
    if (isNaN(v)) return def;
    return Math.max(lo, Math.min(hi, v));
  }

  var state = load() || sampleState();
  var ui = { selSeat: -1, selStudent: null, zoom: 1, filter: "", apartFor: null };

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast("Could not save on this device (storage full or private mode)."); }
  }
  function cls() {
    for (var i = 0; i < state.classes.length; i++) if (state.classes[i].id === state.activeId) return state.classes[i];
    return state.classes[0];
  }
  function student(c, id) {
    for (var i = 0; i < c.students.length; i++) if (c.students[i].id === id) return c.students[i];
    return null;
  }

  // ───────────────────────── geometry
  function geometry(layout, compact) {
    var logical = geometryRaw(layout, false);
    if (!compact) return logical;
    var shown = geometryRaw(layout, true);
    logical.seats.forEach(function (s, i) { s.x = shown.seats[i].x; s.y = shown.seats[i].y; });
    logical.groups = shown.groups;
    logical.W = shown.W; logical.H = shown.H;
    return logical;
  }

  function geometryRaw(layout, compact) {
    var t = layout.type, n = layout.seats, across = layout.across || LAYOUTS[t].defAcross;
    var seats = [], groups = [];
    var top = 2.2; // leave room for board + teacher desk
    var i, g, k;
    if (t === "pods4" || t === "pods6") {
      var w = t === "pods4" ? 2 : 3, h = 2, per = w * h;
      var sx = w + (compact ? 0.45 : 1.6), sy = h + (compact ? 0.8 : 1.3);
      var ng = Math.ceil(n / per);
      for (g = 0; g < ng; g++) {
        var col = g % across, row = Math.floor(g / across);
        var gx = col * sx, gy = top + row * sy;
        var count = Math.min(per, n - g * per);
        groups.push({ x: gx, y: gy, w: w, h: h, n: count, label: "Table " + (g + 1) });
        for (k = 0; k < count; k++) {
          seats.push({ x: gx + (k % w), y: gy + Math.floor(k / w), g: g });
        }
      }
    } else if (t === "pairs") {
      var perRow = across * 2;
      for (i = 0; i < n; i++) {
        var r = Math.floor(i / perRow), p = i % perRow, pc = Math.floor(p / 2);
        var gi = r * across + pc;
        seats.push({ x: pc * (compact ? 2.45 : 3) + (p % 2), y: top + r * 1.25, g: gi });
      }
    } else {
      for (i = 0; i < n; i++) {
        var rr = Math.floor(i / across), cc = i % across;
        seats.push({ x: cc * (compact ? 1.08 : 1.25), y: top + rr * 1.35, g: i });
      }
    }
    if (t === "pairs" || t === "rows") {
      var map = {};
      seats.forEach(function (s) {
        if (!map[s.g]) { map[s.g] = { x: s.x, y: s.y, x2: s.x, y2: s.y }; groups[s.g] = map[s.g]; }
        var m = map[s.g];
        m.x = Math.min(m.x, s.x); m.y = Math.min(m.y, s.y);
        m.x2 = Math.max(m.x2, s.x); m.y2 = Math.max(m.y2, s.y);
      });
      groups = groups.filter(Boolean).map(function (m) { return { x: m.x, y: m.y, w: m.x2 - m.x + 1, h: m.y2 - m.y + 1 }; });
    }
    var W = 0, H = 0, minY = Infinity, maxY = -Infinity;
    seats.forEach(function (s) {
      W = Math.max(W, s.x + 1); H = Math.max(H, s.y + 1);
      minY = Math.min(minY, s.y); maxY = Math.max(maxY, s.y);
    });
    W = Math.max(W, 6);
    seats.forEach(function (s) { s.front = maxY > minY ? (s.y - minY) / (maxY - minY) : 0; });
    // adjacency: same table/pair, or within ADJ in both directions (covers side, front/back, diagonal)
    var adj = seats.map(function () { return []; });
    for (i = 0; i < seats.length; i++) {
      for (var j = i + 1; j < seats.length; j++) {
        var a = seats[i], b = seats[j];
        var near = a.g === b.g || (Math.abs(a.x - b.x) <= ADJ && Math.abs(a.y - b.y) <= ADJ);
        if (near) { adj[i].push(j); adj[j].push(i); }
      }
    }
    return { seats: seats, groups: groups, adj: adj, W: W, H: H + 0.4, top: top };
  }

  function ensureSeats(c) {
    var n = c.layout.seats;
    var seen = {};
    var ids = {};
    c.students.forEach(function (s) { ids[s.id] = true; });
    var arr = [];
    for (var i = 0; i < n; i++) {
      var v = c.seat[i] || null;
      if (v && (!ids[v] || seen[v])) v = null;
      if (v) seen[v] = true;
      arr.push(v);
    }
    c.seat = arr;
  }

  // ───────────────────────── rules
  function isHard(a, b) {
    if (!a || !b) return 0;
    var v = 0;
    if (a.talker && b.talker) v++;
    if (a.apart.indexOf(b.id) >= 0) v++;
    return v;
  }

  function conflicts(c, geo) {
    geo = geo || geometry(c.layout);
    var out = [], bad = {};
    for (var i = 0; i < c.seat.length; i++) {
      var A = c.seat[i] && student(c, c.seat[i]);
      if (!A) continue;
      geo.adj[i].forEach(function (j) {
        if (j <= i) return;
        var B = c.seat[j] && student(c, c.seat[j]);
        if (!B) return;
        if (A.talker && B.talker) {
          out.push({ level: "bad", kind: "talker", seats: [i, j], text: "Two talkers together: " + A.name + " & " + B.name });
          bad[i] = bad[j] = true;
        }
        if (A.apart.indexOf(B.id) >= 0) {
          out.push({ level: "bad", kind: "apart", seats: [i, j], text: "Never sit together: " + A.name + " & " + B.name });
          bad[i] = bad[j] = true;
        }
      });
    }
    for (var k = 0; k < c.seat.length; k++) {
      var S = c.seat[k] && student(c, c.seat[k]);
      if (S && S.front && geo.seats[k].front > 0.34) {
        out.push({ level: "warn", kind: "front", seats: [k], text: S.name + " needs the front but is near the back" });
      }
    }
    return { list: out, bad: bad };
  }

  function talkerAdjacencyCount(c) {
    return conflicts(c).list.filter(function (x) { return x.kind === "talker"; }).length;
  }

  // ───────────────────────── auto-arrange (randomized restarts + annealing)
  function arrange(c) {
    var geo = geometry(c.layout);
    var n = geo.seats.length;
    ensureSeats(c);
    var fixed = new Array(n).fill(false);
    var placedLocked = {};
    for (var i = 0; i < n; i++) {
      var s = c.seat[i] && student(c, c.seat[i]);
      if (s && s.lock) { fixed[i] = true; placedLocked[s.id] = true; }
    }
    var movers = c.students.filter(function (s) { return !placedLocked[s.id]; });
    var freeSeats = [];
    for (i = 0; i < n; i++) if (!fixed[i]) freeSeats.push(i);

    var studs = c.students;
    var idx = {};
    studs.forEach(function (s, k) { idx[s.id] = k; });
    var talk = studs.map(function (s) { return s.talker; });
    var front = studs.map(function (s) { return s.front; });
    var quiet = studs.map(function (s) { return s.quiet; });
    var apart = studs.map(function (s) {
      var m = {};
      s.apart.forEach(function (x) { if (idx[x] != null) m[idx[x]] = true; });
      return m;
    });
    // groups that already hold a locked talker
    function pairCost(a, b) {
      if (a < 0 || b < 0) return 0;
      var v = 0;
      if (talk[a] && talk[b]) v += 1000;
      if (apart[a][b]) v += 1000;
      if (quiet[a] && talk[b]) v += 2;
      if (quiet[b] && talk[a]) v += 2;
      return v;
    }
    function soloCost(seatI, a) {
      if (a < 0) return 0;
      var f = geo.seats[seatI].front;
      var v = 0;
      if (front[a]) v += f * 14;
      if (talk[a]) v += f * 4; // talkers toward the front / teacher
      return v;
    }
    function around(asg, i) {
      var v = soloCost(i, asg[i]);
      var nb = geo.adj[i];
      for (var q = 0; q < nb.length; q++) v += pairCost(asg[i], asg[nb[q]]);
      return v;
    }
    function total(asg) {
      var v = 0;
      for (var i = 0; i < n; i++) {
        v += soloCost(i, asg[i]);
        var nb = geo.adj[i];
        for (var q = 0; q < nb.length; q++) if (nb[q] > i) v += pairCost(asg[i], asg[nb[q]]);
      }
      return v;
    }

    var best = null, bestCost = Infinity;
    var restarts = 14, iters = 7000;
    for (var r = 0; r < restarts; r++) {
      var asg = new Array(n).fill(-1);
      for (i = 0; i < n; i++) if (fixed[i]) asg[i] = idx[c.seat[i]];
      var order = movers.map(function (s) { return idx[s.id]; });
      shuffle(order);
      var fs = freeSeats.slice();
      shuffle(fs);
      // greedy: hardest students first, each into the cheapest seat
      order.sort(function (a, b) { return weight(b) - weight(a); });
      for (var o = 0; o < order.length; o++) {
        var st = order[o], bestSeat = -1, bc = Infinity;
        for (var f = 0; f < fs.length; f++) {
          var si = fs[f];
          if (asg[si] !== -1) continue;
          asg[si] = st;
          var cc = around(asg, si) + Math.random() * 0.5;
          asg[si] = -1;
          if (cc < bc) { bc = cc; bestSeat = si; }
        }
        if (bestSeat < 0) break;
        asg[bestSeat] = st;
      }
      // anneal by swapping seats
      var cur = total(asg);
      var T = 6;
      for (var it = 0; it < iters && freeSeats.length > 1; it++) {
        var x = freeSeats[(Math.random() * freeSeats.length) | 0];
        var y = freeSeats[(Math.random() * freeSeats.length) | 0];
        if (x === y || asg[x] === asg[y]) continue;
        var before = around(asg, x) + around(asg, y);
        var t1 = asg[x]; asg[x] = asg[y]; asg[y] = t1;
        var after = around(asg, x) + around(asg, y);
        var d = after - before;
        if (d <= 0 || Math.random() < Math.exp(-d / T)) {
          cur += d;
        } else {
          t1 = asg[x]; asg[x] = asg[y]; asg[y] = t1;
        }
        T = Math.max(0.05, T * 0.9993);
      }
      cur = total(asg);
      if (cur < bestCost) { bestCost = cur; best = asg.slice(); }
      if (bestCost < 1000 && r >= 4) break;
    }
    function weight(k) { return (talk[k] ? 4 : 0) + Object.keys(apart[k]).length * 3 + (front[k] ? 2 : 0); }

    c.seat = best.map(function (k) { return k >= 0 ? studs[k].id : null; });
    return { hard: Math.floor(bestCost / 1000) };
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0;
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // ───────────────────────── rendering
  function renderAll() {
    renderClassSelect();
    renderSetup();
    renderRoster();
    renderPairs();
    renderChart();
  }

  function renderClassSelect() {
    var sel = $("#classSelect");
    sel.innerHTML = "";
    state.classes.forEach(function (c) {
      var o = el("option", null, c.name);
      o.value = c.id;
      if (c.id === state.activeId) o.selected = true;
      sel.appendChild(o);
    });
    $("#sampleBanner").hidden = !cls().sample;
    $("#tabCount").textContent = cls().students.length ? "(" + cls().students.length + ")" : "";
  }

  function renderSetup() {
    var c = cls();
    $("#layoutType").value = c.layout.type;
    $("#seatCount").value = c.layout.seats;
    var ac = $("#acrossCount");
    ac.innerHTML = "";
    var unit = c.layout.type === "rows" ? "desks" : c.layout.type === "pairs" ? "pairs" : "tables";
    LAYOUTS[c.layout.type].across.forEach(function (n) {
      var o = el("option", null, n + " " + unit);
      o.value = n;
      if (n === c.layout.across) o.selected = true;
      ac.appendChild(o);
    });
  }

  function chip(label, cls_, on, title) {
    var b = el("button", "chip " + cls_ + (on ? " on" : ""), label);
    b.type = "button";
    b.setAttribute("aria-pressed", on ? "true" : "false");
    if (title) b.title = title;
    return b;
  }

  function renderRoster() {
    var c = cls();
    var ul = $("#roster");
    ul.innerHTML = "";
    var f = ui.filter.toLowerCase();
    var seated = {};
    c.seat.forEach(function (id) { if (id) seated[id] = true; });
    var list = c.students.slice().sort(byName).filter(function (s) { return !f || s.name.toLowerCase().indexOf(f) >= 0; });
    if (!c.students.length) {
      var li0 = el("li", "empty", "No students yet. Tap “Paste names” to add your whole class at once.");
      ul.appendChild(li0);
    }
    list.forEach(function (s) {
      var li = el("li", "roster-row");
      li.dataset.id = s.id;
      var top = el("div", "roster-top");
      var nm = el("button", "name-btn", s.name);
      nm.type = "button";
      nm.title = "Rename";
      nm.addEventListener("click", function () { renameStudent(s); });
      top.appendChild(nm);
      if (!seated[s.id]) top.appendChild(el("span", "not-seated", "not seated"));
      var del = el("button", "icon-btn", "×");
      del.type = "button";
      del.setAttribute("aria-label", "Remove " + s.name);
      del.addEventListener("click", function () { removeStudent(s); });
      top.appendChild(del);
      li.appendChild(top);

      var chips = el("div", "chips");
      var tk = chip("Talker", "talker", s.talker, "Never next to another talker");
      tk.addEventListener("click", function () { s.talker = !s.talker; changed(); });
      var fr = chip("Front", "front", s.front, "Needs a seat near the front");
      fr.addEventListener("click", function () { s.front = !s.front; changed(); });
      var qu = chip("Quiet", "quiet", s.quiet, "Prefers not to sit by talkers");
      qu.addEventListener("click", function () { s.quiet = !s.quiet; changed(); });
      var ap = chip(s.apart.length ? "Apart (" + s.apart.length + ")" : "Keep apart…", "apart", s.apart.length > 0, "Never sit together with…");
      ap.addEventListener("click", function () { openApart(s); });
      var lk = chip("Lock seat", "lock", s.lock, "Auto-arrange leaves this student where they are");
      lk.addEventListener("click", function () { s.lock = !s.lock; changed(); });
      [tk, fr, qu, ap, lk].forEach(function (b) { chips.appendChild(b); });
      li.appendChild(chips);
      ul.appendChild(li);
    });

    var opts = c.students.slice().sort(byName);
    ["#pairA", "#pairB"].forEach(function (sel) {
      var s = $(sel), keep = s.value;
      s.innerHTML = "";
      var o0 = el("option", null, "Choose…");
      o0.value = "";
      s.appendChild(o0);
      opts.forEach(function (st) {
        var o = el("option", null, st.name);
        o.value = st.id;
        s.appendChild(o);
      });
      s.value = keep && student(c, keep) ? keep : "";
    });
  }

  function renderPairs() {
    var c = cls();
    var ul = $("#pairList");
    ul.innerHTML = "";
    var shown = 0;
    c.students.slice().sort(byName).forEach(function (a) {
      a.apart.forEach(function (bid) {
        var b = student(c, bid);
        if (!b || a.name.localeCompare(b.name) > 0 || (a.name === b.name && a.id > b.id)) return;
        var li = el("li", "pair-row");
        li.appendChild(el("span", null, a.name + "  &  " + b.name));
        var x = el("button", "icon-btn", "×");
        x.type = "button";
        x.setAttribute("aria-label", "Remove pair");
        x.addEventListener("click", function () { unlink(a, b); changed(); });
        li.appendChild(x);
        ul.appendChild(li);
        shown++;
      });
    });
    if (!shown) ul.appendChild(el("li", "empty", "No pairs yet."));
  }

  function roomUnit(geo, wrapW) {
    var u = Math.floor((wrapW - 8) / (geo.W + 0.4));
    u = Math.max(28, Math.min(84, u));
    return Math.round(u * ui.zoom);
  }

  function buildRoom(container, c, geo, opts) {
    opts = opts || {};
    container.innerHTML = "";
    var u = opts.unit;
    var pad = 0.2;
    container.style.width = Math.round((geo.W + pad * 2) * u) + "px";
    container.style.height = Math.round((geo.H + pad) * u) + "px";
    container.style.setProperty("--u", u + "px");

    var board = el("div", "board", "FRONT OF ROOM · Board");
    board.style.left = Math.round((pad + geo.W * 0.18) * u) + "px";
    board.style.width = Math.round(geo.W * 0.64 * u) + "px";
    board.style.top = Math.round(0.15 * u) + "px";
    container.appendChild(board);
    var td = el("div", "teacher-desk", "Teacher");
    td.style.left = Math.round(pad * u) + "px";
    td.style.top = Math.round(0.85 * u) + "px";
    td.style.width = Math.round(Math.min(2.4, geo.W * 0.3) * u) + "px";
    container.appendChild(td);

    geo.groups.forEach(function (g) {
      var t = el("div", "table");
      t.style.left = Math.round((pad + g.x - 0.08) * u) + "px";
      t.style.top = Math.round((g.y - 0.08) * u) + "px";
      t.style.width = Math.round((g.w + 0.16) * u) + "px";
      t.style.height = Math.round((g.h + 0.16) * u) + "px";
      container.appendChild(t);
    });

    var cf = opts.conf || { bad: {} };
    var firstCount = {}, dupFirst = {};
    c.students.forEach(function (s) { var f = firstOf(s.name); firstCount[f] = (firstCount[f] || 0) + 1; if (firstCount[f] > 1) dupFirst[f] = true; });
    geo.seats.forEach(function (s, i) {
      var id = c.seat[i];
      var st = id ? student(c, id) : null;
      var b = el(opts.print ? "div" : "button", "seat" + (st ? " filled" : " empty"));
      if (!opts.print) {
        b.type = "button";
        b.dataset.i = i;
        if (cf.bad[i]) b.classList.add("bad");
        if (ui.selSeat === i) b.classList.add("selected");
        if (st && st.talker) b.classList.add("is-talker");
        b.setAttribute("aria-label", "Seat " + (i + 1) + (st ? ": " + st.name : ", empty"));
      }
      b.style.left = Math.round((pad + s.x + 0.05) * u) + "px";
      b.style.top = Math.round((s.y + 0.05) * u) + "px";
      b.style.width = Math.round(0.9 * u) + "px";
      b.style.height = Math.round(0.9 * u) + "px";
      var nm = el("span", "seat-name", st ? (opts.print ? st.name : shortName(st.name, u < 46 && !dupFirst[firstOf(st.name)])) : "");
      b.appendChild(nm);
      if (st && !opts.print) {
        var tags = el("span", "seat-tags");
        if (st.talker) tags.appendChild(el("i", "dot talker"));
        if (st.front) tags.appendChild(el("i", "dot front"));
        if (st.quiet) tags.appendChild(el("i", "dot quiet"));
        if (st.lock) tags.appendChild(el("i", "dot lock"));
        b.appendChild(tags);
      }
      container.appendChild(b);
    });
  }

  var lastGeo = null;
  function renderChart() {
    var c = cls();
    ensureSeats(c);
    var wrap = $("#roomWrap");
    var narrow = (wrap.clientWidth || 360) < 700 && !document.body.classList.contains("present");
    var geo = geometry(c.layout, narrow);
    lastGeo = geo;
    var conf = conflicts(c, geo);
    var u = roomUnit(geo, wrap.clientWidth || 360);
    if (document.body.classList.contains("present")) {
      var fitW = (window.innerWidth - 24) / (geo.W + 0.4);
      var fitH = (window.innerHeight - 24) / (geo.H + 0.2);
      u = Math.floor(Math.min(fitW, fitH));
    }
    buildRoom($("#room"), c, geo, { unit: u, conf: conf });
    applyPreview();

    // conflicts list
    var ul = $("#conflictList");
    ul.innerHTML = "";
    var bad = conf.list.filter(function (x) { return x.level === "bad"; });
    var cc = $("#conflictCount");
    cc.textContent = bad.length ? String(bad.length) : "0";
    cc.className = "count-pill " + (bad.length ? "bad" : "ok");
    if (!conf.list.length) {
      ul.appendChild(el("li", "ok", c.students.length ? "No conflicts. Every talker is away from other talkers." : "Add students to get started."));
    }
    conf.list.forEach(function (x) {
      var li = el("li", x.level, x.text);
      li.tabIndex = 0;
      li.addEventListener("click", function () { flash(x.seats); });
      ul.appendChild(li);
    });

    // unseated
    var seated = {};
    c.seat.forEach(function (id) { if (id) seated[id] = true; });
    var uns = c.students.filter(function (s) { return !seated[s.id]; }).sort(byName);
    $("#unseatedBox").hidden = !uns.length;
    var box = $("#unseated");
    box.innerHTML = "";
    uns.forEach(function (s) {
      var b = el("button", "chip" + (ui.selStudent === s.id ? " on pick" : "") + (s.talker ? " talker-outline" : ""), s.name);
      b.type = "button";
      b.addEventListener("click", function () {
        ui.selSeat = -1;
        ui.selStudent = ui.selStudent === s.id ? null : s.id;
        renderChart();
      });
      box.appendChild(b);
    });
    if (uns.length && c.students.length > c.layout.seats) {
      var li2 = el("li", "warn", "More students than seats. Add seats in Setup (" + c.students.length + " students, " + c.layout.seats + " seats).");
      ul.appendChild(li2);
    }
    updateHint();
  }

  function flash(seats) {
    seats.forEach(function (i) {
      var b = document.querySelector('#room .seat[data-i="' + i + '"]');
      if (b) {
        b.classList.remove("flash");
        void b.offsetWidth;
        b.classList.add("flash");
        if (b.scrollIntoView) b.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      }
    });
    setTab("chart");
  }

  function selectedStudentId() {
    var c = cls();
    if (ui.selSeat >= 0) return c.seat[ui.selSeat];
    return ui.selStudent;
  }

  // Would putting the selection into seat j create a hard conflict for either moved student?
  function moveConflicts(c, geo, j) {
    var a = selectedStudentId();
    if (!a) return 0;
    var trial = c.seat.slice();
    var from = ui.selSeat;
    if (from >= 0) {
      var t = trial[j]; trial[j] = trial[from]; trial[from] = t;
    } else {
      trial[j] = a;
    }
    var moved = [j];
    if (from >= 0) moved.push(from);
    var count = 0;
    moved.forEach(function (i) {
      var A = trial[i] && student(c, trial[i]);
      if (!A) return;
      geo.adj[i].forEach(function (k) {
        var B = trial[k] && student(c, trial[k]);
        count += isHard(A, B);
      });
    });
    return count;
  }

  function applyPreview() {
    var c = cls();
    var geo = lastGeo;
    var sel = selectedStudentId();
    document.querySelectorAll("#room .seat").forEach(function (b) {
      b.classList.remove("would-bad", "would-ok");
      if (!sel) return;
      var j = +b.dataset.i;
      if (j === ui.selSeat) return;
      b.classList.add(moveConflicts(c, geo, j) ? "would-bad" : "would-ok");
    });
  }

  function updateHint() {
    var c = cls();
    var h = $("#selectHint");
    var id = selectedStudentId();
    if (id) {
      var s = student(c, id);
      h.innerHTML = "";
      h.appendChild(document.createTextNode("Moving "));
      h.appendChild(el("b", null, s ? s.name : ""));
      h.appendChild(document.createTextNode(". Tap a seat to swap (green = OK, red = conflict)."));
      h.classList.add("active");
    } else {
      h.textContent = "Tap a student, then another seat to swap them. On a computer you can also drag.";
      h.classList.remove("active");
    }
  }

  // ───────────────────────── interactions
  function changed(noRender) {
    var c = cls();
    if (c.sample) { /* keep sample flag until fresh/paste */ }
    save();
    if (!noRender) renderAll();
  }

  function swapInto(j) {
    var c = cls();
    var before = conflicts(c).list.filter(function (x) { return x.level === "bad"; }).length;
    if (ui.selSeat >= 0) {
      var t = c.seat[j]; c.seat[j] = c.seat[ui.selSeat]; c.seat[ui.selSeat] = t;
    } else if (ui.selStudent) {
      c.seat[j] = ui.selStudent;
    }
    ui.selSeat = -1; ui.selStudent = null;
    save();
    renderAll();
    var after = conflicts(c).list.filter(function (x) { return x.level === "bad"; }).length;
    if (after > before) toast("Heads up: that move made a conflict (shown in red).");
    else if (after < before) toast("Nice, that fixed a conflict.");
  }

  function onSeatTap(i) {
    var c = cls();
    if (ui.selSeat === i) { ui.selSeat = -1; renderChart(); return; }
    if (ui.selSeat >= 0 || ui.selStudent) { swapInto(i); return; }
    if (c.seat[i]) { ui.selSeat = i; renderChart(); }
  }

  function bindRoom() {
    var room = $("#room");
    var drag = null;
    room.addEventListener("pointerdown", function (e) {
      var b = e.target.closest(".seat");
      if (!b) return;
      drag = { i: +b.dataset.i, x: e.clientX, y: e.clientY, moved: false, mouse: e.pointerType === "mouse", ghost: null };
    });
    window.addEventListener("pointermove", function (e) {
      if (!drag || !drag.mouse) return;
      var c = cls();
      if (!c.seat[drag.i]) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) {
        drag.moved = true;
        ui.selSeat = drag.i; ui.selStudent = null;
        renderChart();
        var s = student(c, c.seat[drag.i]);
        drag.ghost = el("div", "drag-ghost", s ? s.name : "");
        document.body.appendChild(drag.ghost);
      }
      if (drag.moved && drag.ghost) {
        drag.ghost.style.left = e.clientX + 10 + "px";
        drag.ghost.style.top = e.clientY + 10 + "px";
        var over = document.elementFromPoint(e.clientX, e.clientY);
        document.querySelectorAll("#room .seat.drop").forEach(function (x) { x.classList.remove("drop"); });
        var t = over && over.closest && over.closest("#room .seat");
        if (t) t.classList.add("drop");
      }
    });
    window.addEventListener("pointerup", function (e) {
      if (!drag) return;
      var d = drag; drag = null;
      if (d.ghost) d.ghost.remove();
      if (d.moved) {
        var over = document.elementFromPoint(e.clientX, e.clientY);
        var t = over && over.closest && over.closest("#room .seat");
        if (t && +t.dataset.i !== d.i) swapInto(+t.dataset.i);
        else { ui.selSeat = -1; renderChart(); }
        return;
      }
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 12) onSeatTap(d.i);
    });
    window.addEventListener("pointercancel", function () {
      if (drag && drag.ghost) drag.ghost.remove();
      drag = null;
    });
    room.addEventListener("keydown", function (e) {
      var b = e.target.closest(".seat");
      if (b && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSeatTap(+b.dataset.i); }
    });
  }

  function setTab(t) {
    document.body.dataset.tab = t;
    document.querySelectorAll("[data-tab-btn]").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tabBtn === t);
    });
    if (t === "chart") requestAnimationFrame(renderChart);
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function parseNames(text) {
    var seen = {};
    return String(text || "").split(/\r?\n/).map(function (line) {
      return line.replace(/\t/g, " ").replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\s+/g, " ").trim();
    }).filter(function (n) {
      if (!n || n.length > 60) return false;
      var k = n.toLowerCase();
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  function addNames(names, replace) {
    var c = cls();
    if (c.sample) {
      // turning the sample into a real class: drop pretend names
      c.sample = false;
      c.name = "My class";
      replace = true;
    }
    if (replace) { c.students = []; c.seat = []; }
    var have = {};
    c.students.forEach(function (s) { have[s.name.toLowerCase()] = true; });
    var added = 0;
    names.forEach(function (n) {
      if (have[n.toLowerCase()]) return;
      c.students.push(newStudent(n));
      have[n.toLowerCase()] = true;
      added++;
    });
    var need = c.students.length;
    if (need > c.layout.seats) c.layout.seats = Math.min(48, Math.ceil(need / LAYOUTS[c.layout.type].per) * LAYOUTS[c.layout.type].per);
    ensureSeats(c);
    arrange(c);
    save();
    renderAll();
    return added;
  }

  function renameStudent(s) {
    var n = prompt("Student name:", s.name);
    if (n == null) return;
    n = n.trim().slice(0, 60);
    if (!n) return;
    s.name = n;
    changed();
  }

  function removeStudent(s) {
    if (!confirm("Remove " + s.name + " from this class?")) return;
    var c = cls();
    c.students.forEach(function (o) { o.apart = o.apart.filter(function (x) { return x !== s.id; }); });
    c.students = c.students.filter(function (o) { return o.id !== s.id; });
    c.seat = c.seat.map(function (x) { return x === s.id ? null : x; });
    changed();
  }

  function openApart(s) {
    ui.apartFor = s.id;
    $("#apartName").textContent = s.name;
    $("#apartFilter").value = "";
    renderApartList();
    $("#apartDialog").showModal();
  }
  function renderApartList() {
    var c = cls();
    var s = student(c, ui.apartFor);
    if (!s) return;
    var f = $("#apartFilter").value.toLowerCase();
    var box = $("#apartList");
    box.innerHTML = "";
    c.students.slice().sort(byName).forEach(function (o) {
      if (o.id === s.id) return;
      if (f && o.name.toLowerCase().indexOf(f) < 0) return;
      var lab = el("label", "check");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = s.apart.indexOf(o.id) >= 0;
      cb.addEventListener("change", function () {
        if (cb.checked) link(s, o); else unlink(s, o);
        save();
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(" " + o.name));
      box.appendChild(lab);
    });
  }

  function exportBackup() {
    var data = JSON.stringify(state, null, 1);
    var blob = new Blob([data], { type: "application/json" });
    var d = new Date();
    var name = "seating-backup-" + d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") + ".json";
    var file = null;
    try { file = new File([blob], name, { type: "application/json" }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
      navigator.share({ files: [file], title: name }).catch(function () {});
      return;
    }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast("Backup saved as " + name);
  }

  function importBackup(file) {
    var r = new FileReader();
    r.onload = function () {
      var d = null;
      try { d = validate(JSON.parse(r.result)); } catch (e) { d = null; }
      if (!d) { alert("That file is not a seating chart backup."); return; }
      if (!confirm("Replace everything on this device with the backup (" + d.classes.length + " class" + (d.classes.length === 1 ? "" : "es") + ")?")) return;
      state = d;
      ui.selSeat = -1; ui.selStudent = null;
      save();
      renderAll();
      toast("Backup loaded.");
    };
    r.readAsText(file);
  }

  function printChart() {
    var c = cls();
    var geo = geometry(c.layout);
    $("#printTitle").textContent = c.name;
    $("#printDate").textContent = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
    var u = Math.floor(Math.min(980 / (geo.W + 0.4), 640 / (geo.H + 0.2)));
    buildRoom($("#printRoom"), c, geo, { unit: u, print: true });
  }

  function bind() {
    document.querySelectorAll("[data-tab-btn]").forEach(function (b) {
      b.addEventListener("click", function () { setTab(b.dataset.tabBtn); });
    });
    $("#classSelect").addEventListener("change", function (e) {
      state.activeId = e.target.value;
      ui.selSeat = -1; ui.selStudent = null;
      changed();
    });
    $("#btnArrange").addEventListener("click", function () {
      var c = cls();
      if (!c.students.length) { toast("Add students first."); setTab("students"); return; }
      if (c.students.length > c.layout.seats) {
        c.layout.seats = Math.min(48, Math.ceil(c.students.length / LAYOUTS[c.layout.type].per) * LAYOUTS[c.layout.type].per);
      }
      ui.selSeat = -1; ui.selStudent = null;
      var res = arrange(c);
      save();
      renderAll();
      var tc = talkerAdjacencyCount(c);
      if (res.hard === 0) toast("Done! No talkers or keep-apart pairs are together.");
      else toast("Best I could do: " + res.hard + " conflict(s)" + (tc ? ", including talkers" : "") + ". Try more tables or seats, or a different layout.");
    });
    $("#btnPrint").addEventListener("click", function () { printChart(); window.print(); });
    window.addEventListener("beforeprint", printChart);
    $("#btnPresent").addEventListener("click", function () {
      document.body.classList.add("present");
      $("#btnExitPresent").hidden = false;
      renderChart();
    });
    $("#btnExitPresent").addEventListener("click", exitPresent);
    function exitPresent() {
      document.body.classList.remove("present");
      $("#btnExitPresent").hidden = true;
      renderChart();
    }
    $("#btnZoomIn").addEventListener("click", function () { ui.zoom = Math.min(2.5, ui.zoom * 1.2); renderChart(); });
    $("#btnZoomOut").addEventListener("click", function () { ui.zoom = Math.max(0.6, ui.zoom / 1.2); renderChart(); });

    $("#btnPaste").addEventListener("click", function () {
      $("#pasteBox").value = "";
      updatePasteBtn();
      $("#pasteDialog").showModal();
      setTimeout(function () { $("#pasteBox").focus(); }, 50);
    });
    function updatePasteBtn() {
      var n = parseNames($("#pasteBox").value).length;
      $("#btnPasteGo").textContent = n ? "Add " + n + " student" + (n === 1 ? "" : "s") : "Add students";
    }
    $("#pasteBox").addEventListener("input", updatePasteBtn);
    $("#btnPasteGo").addEventListener("click", function () {
      var names = parseNames($("#pasteBox").value);
      if (!names.length) { toast("Paste at least one name."); return; }
      var mode = document.querySelector('input[name="pasteMode"]:checked').value;
      if (mode === "replace" && cls().students.length && !cls().sample && !confirm("Replace the whole list for this class?")) return;
      var added = addNames(names, mode === "replace");
      $("#pasteDialog").close();
      toast("Added " + added + " students and made a first seating chart.");
    });
    document.querySelectorAll("dialog [data-close]").forEach(function (b) {
      b.addEventListener("click", function () { b.closest("dialog").close(); });
    });
    $("#apartDialog").addEventListener("close", function () { ui.apartFor = null; renderAll(); });
    $("#apartFilter").addEventListener("input", renderApartList);

    $("#btnAddOne").addEventListener("click", function () {
      var n = prompt("Student name:");
      if (!n || !n.trim()) return;
      addNames([n.trim().slice(0, 60)], false);
    });
    $("#rosterFilter").addEventListener("input", function (e) { ui.filter = e.target.value; renderRoster(); });
    $("#btnAddPair").addEventListener("click", function () {
      var c = cls();
      var a = student(c, $("#pairA").value), b = student(c, $("#pairB").value);
      if (!a || !b || a === b) { toast("Choose two different students."); return; }
      link(a, b);
      $("#pairA").value = ""; $("#pairB").value = "";
      changed();
      toast(a.name + " & " + b.name + " will never sit together.");
    });

    function relayout() {
      var c = cls();
      ensureSeats(c);
      c.students.forEach(function (s) { s.lock = false; });
      var res = arrange(c);
      ui.selSeat = -1; ui.selStudent = null;
      changed();
      if (res.hard) toast("This layout can’t keep everyone apart (" + res.hard + " conflict(s)). Try more tables or seats.");
    }
    $("#layoutType").addEventListener("change", function (e) {
      var c = cls();
      c.layout.type = e.target.value;
      c.layout.across = LAYOUTS[c.layout.type].defAcross;
      relayout();
    });
    $("#seatCount").addEventListener("change", function (e) {
      var c = cls();
      var v = clampInt(e.target.value, 4, 48, c.layout.seats);
      if (v < c.students.length) toast("Heads up: fewer seats than students (" + c.students.length + ").");
      c.layout.seats = v;
      relayout();
    });
    $("#acrossCount").addEventListener("change", function (e) {
      cls().layout.across = clampInt(e.target.value, 1, 12, 4);
      relayout();
    });

    $("#btnNewClass").addEventListener("click", function () {
      var n = prompt("New class name:", "Class " + (state.classes.length + 1));
      if (!n || !n.trim()) return;
      var c = newClass(n.trim().slice(0, 60), []);
      ensureSeats(c);
      state.classes.push(c);
      state.activeId = c.id;
      changed();
      setTab("students");
    });
    $("#btnRenameClass").addEventListener("click", function () {
      var c = cls();
      var n = prompt("Class name:", c.name);
      if (!n || !n.trim()) return;
      c.name = n.trim().slice(0, 60);
      changed();
    });
    $("#btnDeleteClass").addEventListener("click", function () {
      var c = cls();
      if (state.classes.length < 2) { toast("This is your only class. Use Start fresh instead."); return; }
      if (!confirm("Delete the class “" + c.name + "”? This can’t be undone.")) return;
      state.classes = state.classes.filter(function (x) { return x.id !== c.id; });
      state.activeId = state.classes[0].id;
      changed();
    });
    $("#btnExport").addEventListener("click", exportBackup);
    $("#btnImport").addEventListener("click", function () { $("#importFile").click(); });
    $("#importFile").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) importBackup(f);
      e.target.value = "";
    });
    $("#btnFresh").addEventListener("click", function () {
      if (!confirm("Erase ALL classes and students on this device and start fresh? (Export a backup first if you might want them.)")) return;
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      state = freshState();
      ui.selSeat = -1; ui.selStudent = null;
      save();
      renderAll();
      setTab("students");
      toast("All clear. Paste your class list to begin.");
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (document.body.classList.contains("present")) exitPresent();
        if (ui.selSeat >= 0 || ui.selStudent) { ui.selSeat = -1; ui.selStudent = null; renderChart(); }
      }
    });
    var rt = null;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(renderChart, 120);
    });
    bindRoom();
  }

  // test hooks (local only)
  window.SeatingChart = {
    state: function () { return state; },
    active: cls,
    talkerAdjacency: function () { return talkerAdjacencyCount(cls()); },
    conflicts: function () { return conflicts(cls()).list; },
    geometry: function () { return geometry(cls().layout); },
  };

  bind();
  save();
  renderAll();
})();
