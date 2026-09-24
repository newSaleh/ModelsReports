(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------
  var BRANCHES = [
    { code: '701', name: 'الدائري', color: 'var(--series-1)', hex: '#2a78d6' },
    { code: '706', name: 'الفيحاء', color: 'var(--series-2)', hex: '#1baf7a' },
    { code: '707', name: 'البديعة', color: 'var(--series-3)', hex: '#eda100' },
    { code: '711', name: 'بريدة',   color: 'var(--series-4)', hex: '#008300' },
    { code: '803', name: 'التحلية', color: 'var(--series-5)', hex: '#4a3aa7' }
  ];

  var TEXT_FIELDS = [
    { key: 'SupplierCode', label: 'كود المورد' },
    { key: 'SupplierName', label: 'اسم المورد' },
    { key: 'StockGroupName', label: 'الفئة' },
    { key: 'StockCode', label: 'كود الصنف' },
    { key: 'ModelCode', label: 'كود الموديل' }
  ];

  var STORAGE_KEY = 'modelsReport_v2';
  var THEME_KEY = 'modelsReportTheme';

  // Default thresholds for the branch-strength assessment. The user can
  // override these live from the settings panel (⚙️ إعدادات التقييم).
  var DEFAULT_SETTINGS = {
    hotSoldMin: 5,               // minimum sales in a branch to call it "selling well"
    opportunityMinTotalSold: 20, // sold this well elsewhere to justify stocking a new branch
    lowStockDaysThreshold: 3,    // balance will run out within this many days -> "رصيد منخفض"
    maxBalance: 50               // current balance above this -> flagged as overstock/surplus
  };

  // Default supplier-code merge list — empty; the user can still add their
  // own extra pairs from the "🔗 دمج أكواد الموردين" panel, saved to their
  // browser, on top of the built-in SUPPLIER_ALIASES/SUPPLIER_CODE_PAIRS
  // merging below.
  var DEFAULT_SUPPLIER_ALIAS_TEXT = '';

  // Suppliers permanently excluded from all 5 reports, seeded once into a
  // new browser's saved state (same pattern as DEFAULT_SUPPLIER_ALIAS_TEXT)
  // but editable/removable anytime from the "🚫 استبعاد موردين دائم" panel.
  // 319 is the merged-group root of 319/447 (العيسائي أواني).
  var DEFAULT_EXCLUDED_SUPPLIER_TEXT = '319';

  // ---------------------------------------------------------------------
  // Built-in supplier merging (Riyadh/Jeddah branches of the same company,
  // etc.). Two codes merge when either (a) they share the same short name
  // below, or (b) they're listed together in SUPPLIER_CODE_PAIRS. Codes
  // here are the "normalized" form (leading zeros stripped) since the
  // source Excel data pads codes to 4 digits (e.g. "0666") while this
  // table doesn't. See normalizeSupplierCode().
  // ---------------------------------------------------------------------
  var SUPPLIER_ALIASES = {
    "101": "الهبدان", "102": "الطريقي", "103": "المنيف", "104": "المخملية",
    "106": "الشماسي", "107": "مرساف", "108": "الأصيل", "113": "أمين ناجي",
    "115": "باوارث", "119": "بسمة الصغير", "124": "بدور", "132": "الشنيبر",
    "137": "حياكة - الحارثي", "138": "عصام - كيكو", "145": "نما", "147": "المحضار",
    "151": "الحريبي نسائي", "152": "غيوم", "153": "نستر", "155": "الصنات",
    "156": "بشائر", "158": "الأحذية العجيبة", "159": "الدفة", "160": "محسن",
    "161": "نبيل الرشيدي شنط", "163": "القحطاني", "165": "الخيرات", "166": "الدقيل",
    "171": "ثوب الشعلة", "176": "ركن التوفيق", "178": "دروش", "181": "جومانا",
    "182": "اليافعي", "183": "طه", "184": "العجلان", "191": "محسن الحريبي",
    "194": "كنده", "201": "باوارث", "202": "محسن", "203": "جومانا",
    "207": "سامي", "208": "عادل", "210": "فرع سامي", "212": "صالح أحمد",
    "213": "محمد صالح", "218": "المنيف", "221": "المخمليه", "230": "السليماني",
    "232": "العليمي", "238": "المأمون", "240": "حياكة - الحارثي", "246": "الأحذية العجيبة",
    "247": "الشماسي", "248": "محسن رجالي", "250": "المصباحي", "253": "تراي",
    "255": "سامي داخلي", "263": "أصالة", "266": "الهراش", "271": "اليافعي",
    "284": "أضواء", "293": "عجلان", "294": "الإمتياز", "296": "المهري",
    "298": "البرنس", "302": "نماء", "306": "سندس", "307": "الحريبي رجالي",
    "309": "سندس", "310": "الرائدة", "313": "الجوري", "317": "عجلان مريول",
    "318": "العالمية شنط", "401": "نبيل الرشيدي شنط", "402": "الدفه", "406": "سربرايس",
    "409": "سي يو", "411": "منازل", "413": "سامي داخلي", "414": "بتال",
    "418": "HRM قديم", "420": "نواعم الاطفال", "421": "اسرار الحجاب", "422": "الاختيار",
    "424": "مجمع الالعاب", "428": "الخيرات", "436": "نما بلومينج", "437": "زهور دبي",
    "438": "إيفا", "439": "نستر", "441": "ديلان الشرق", "442": "الملبوسات الذكية",
    "443": "الرحب", "445": "نواعم", "449": "بازيدان", "454": "قمة تنومة",
    "455": "رويال تكس", "461": "بخش", "666": "اتش آر ام", "999": "ام بي ايه",
    "110": "بن حاتم", "444": "سندس", "447": "العيسائي أواني", "430": "الرائدة",
    "299": "الأصيل", "297": "العجلان", "446": "كنده", "416": "سندس",
    "423": "العجلان_نوم", "460": "روائع البرنس", "283": "عصام_كيكو", "462": "عبير المواسم",
    "407": "العجلان", "243": "المالكي", "427": "العبير الأخضر", "205": "شمسان",
    "463": "ركن الأفضل", "ZZZ": "غير محدد", "142": "فيصل للتجارة", "426": "المشهري",
    "319": "العيسائي الأواني", "193": "بندر جدة", "140": "الحد الأعلى", "141": "كنز المستقبل",
    "179": "العجلان وأخوانه", "188": "الرمان", "117": "باوارث مخفض", "180": "نبيل الرشيدي",
    "172": "تاج الرياض", "148": "السليمان", "190": "حياة الشباب", "457": "الاتجاه الجديد",
    "321": "الشرقية الدولية", "305": "الصحاح", "199": "روائع المخمل", "286": "بندر جدة"
  };

  var SUPPLIER_CODE_PAIRS = [
    ["180", "252"], ["183", "284"], ["182", "271"], ["160", "202"],
    ["137", "240"], ["181", "203"], ["158", "246"], ["145", "253"],
    ["117", "251"], ["115", "201"], ["198", "434"], ["317", "459"],
    ["310", "430"], ["103", "218"], ["306", "416"], ["309", "444"],
    ["302", "436"], ["104", "221"], ["318", "230"], ["106", "247"],
    ["165", "428"], ["319", "447"], ["161", "401"], ["178", "293"],
    ["184", "297"], ["179", "407"], ["159", "402"], ["108", "299"]
  ];

  // Strip leading zeros so "0666" and "666" compare equal (Excel data pads
  // to 4 digits; the tables above don't). Non-numeric codes (e.g. "ZZZ")
  // pass through unchanged.
  function normalizeSupplierCode(code) {
    if (code === null || code === undefined) return '';
    return String(code).trim().toUpperCase().replace(/^0+(?=[0-9A-Z])/, '');
  }

  // Numeric-aware compare, used both to pick a deterministic group root
  // (smallest code wins) and to order codes for display.
  function compareCodes(a, b) {
    var na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    return a < b ? -1 : (a > b ? 1 : 0);
  }

  // A normalized code shorter than 4 digits is re-padded back to the
  // source file's usual 4-digit style for display (e.g. "666" -> "0666").
  function formatCodeForDisplay(normCode) {
    if (/^[0-9]+$/.test(normCode) && normCode.length < 4) return ('0000' + normCode).slice(-4);
    return normCode;
  }

  function branchField(code, suffix) { return code + suffix; }
  function branchByCode(code) {
    for (var i = 0; i < BRANCHES.length; i++) if (BRANCHES[i].code === code) return BRANCHES[i];
    return null;
  }

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  var state = {
    rows: [],
    dateFrom: '',
    dateTo: '',
    settings: Object.assign({}, DEFAULT_SETTINGS),
    supplierAliasText: '',
    excludedSupplierRootsText: '',
    minPriceFilter: null,
    minSoldPerBranchFilter: 0,
    importedDayCount: 1
  };

  var STATUS_META = {
    critical: '🔴 لا يوجد رصيد',
    warning: '🟡 رصيد منخفض',
    opportunity: '🟢 فرصة جديدة',
    surplus: '🔵 فائض في المخزون',
    ok: 'مخزون مناسب',
    excluded: '🚫 مستبعدة من التقرير'
  };

  var searchTerm = '';
  // supplierGroupRootOf: normalized code -> normalized root code of its group.
  // supplierGroupKnownCodes: root -> sorted list of every normalized code
  //   known to belong to that group (from the built-in tables and/or the
  //   user's own pairs), regardless of which one a given row happens to use.
  // supplierGroupDisplayName: root -> the group's friendly display name.
  var supplierGroupRootOf = {};
  var supplierGroupKnownCodes = {};
  var supplierGroupDisplayName = {};

  // ---------------------------------------------------------------------
  // Supplier code merging — some suppliers have more than one reference
  // code in the source data (e.g. separate codes for their Riyadh and
  // Jeddah branches). Codes merge into one group when either:
  //   (a) they share the same short name in SUPPLIER_ALIASES, or
  //   (b) they're linked in SUPPLIER_CODE_PAIRS (built-in) or by the
  //       user's own pairs from the "🔗 دمج أكواد الموردين" panel.
  // Grouping is transitive (union-find) and codes are compared after
  // normalizeSupplierCode() so "0666" and "666" merge as the same code.
  // ---------------------------------------------------------------------
  function rebuildSupplierAliasMap() {
    var parent = {};
    function find(x) {
      if (!(x in parent)) parent[x] = x;
      var root = x;
      while (parent[root] !== root) root = parent[root];
      while (parent[x] !== root) { var next = parent[x]; parent[x] = root; x = next; }
      return root;
    }
    function union(a, b) {
      a = normalizeSupplierCode(a); b = normalizeSupplierCode(b);
      if (!a || !b) return;
      var ra = find(a), rb = find(b);
      if (ra === rb) return;
      if (compareCodes(ra, rb) <= 0) parent[rb] = ra; else parent[ra] = rb;
    }

    // (a) built-in codes that share the same short display name
    var codesByAliasName = {};
    Object.keys(SUPPLIER_ALIASES).forEach(function (code) {
      var name = SUPPLIER_ALIASES[code];
      (codesByAliasName[name] = codesByAliasName[name] || []).push(code);
    });
    Object.keys(codesByAliasName).forEach(function (name) {
      var codes = codesByAliasName[name];
      for (var i = 1; i < codes.length; i++) union(codes[0], codes[i]);
    });

    // (b) built-in explicit pairs, then the user's own pairs (one pair of
    // codes per comma-separated line; extra columns on a line all link to
    // the first).
    SUPPLIER_CODE_PAIRS.forEach(function (pair) { union(pair[0], pair[1]); });
    var userPairs = [];
    (state.supplierAliasText || '').split('\n').forEach(function (line) {
      var parts = line.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      for (var i = 1; i < parts.length; i++) { union(parts[0], parts[i]); userPairs.push([parts[0], parts[i]]); }
    });

    // Every code ever mentioned across all sources, grouped by resolved root.
    var allCodes = {};
    Object.keys(SUPPLIER_ALIASES).forEach(function (c) { allCodes[normalizeSupplierCode(c)] = true; });
    SUPPLIER_CODE_PAIRS.forEach(function (p) {
      allCodes[normalizeSupplierCode(p[0])] = true; allCodes[normalizeSupplierCode(p[1])] = true;
    });
    userPairs.forEach(function (p) {
      allCodes[normalizeSupplierCode(p[0])] = true; allCodes[normalizeSupplierCode(p[1])] = true;
    });

    supplierGroupRootOf = {};
    supplierGroupKnownCodes = {};
    Object.keys(allCodes).forEach(function (code) {
      var root = find(code);
      supplierGroupRootOf[code] = root;
      (supplierGroupKnownCodes[root] = supplierGroupKnownCodes[root] || []).push(code);
    });
    Object.keys(supplierGroupKnownCodes).forEach(function (root) {
      supplierGroupKnownCodes[root].sort(compareCodes);
    });

    // Display name: prefer the root code's own alias entry (deterministic
    // when a pair links two codes that each carry a different nickname);
    // otherwise borrow the name from any other member of the group.
    supplierGroupDisplayName = {};
    Object.keys(SUPPLIER_ALIASES).forEach(function (code) {
      var norm = normalizeSupplierCode(code);
      var root = supplierGroupRootOf[norm] || norm;
      if (norm === root) supplierGroupDisplayName[root] = SUPPLIER_ALIASES[code];
    });
    Object.keys(SUPPLIER_ALIASES).forEach(function (code) {
      var norm = normalizeSupplierCode(code);
      var root = supplierGroupRootOf[norm] || norm;
      if (!supplierGroupDisplayName[root]) supplierGroupDisplayName[root] = SUPPLIER_ALIASES[code];
    });
  }

  // Returns a normalized, comparable "canonical code" for equality checks
  // (search, exclude-by-supplier) — not meant for display; use
  // supplierGroupInfo()/formatCodeForDisplay() for that.
  function resolveSupplierCode(code) {
    if (!code) return code;
    var norm = normalizeSupplierCode(code);
    return supplierGroupRootOf[norm] || norm;
  }

  // The merged display identity for a row: its group's friendly name (or
  // its own raw SupplierName if the group has no built-in alias) plus every
  // known code in the group, formatted like the source file (e.g. "0666").
  function supplierGroupInfo(r) {
    var norm = normalizeSupplierCode(r && r.SupplierCode);
    if (!norm) return { name: (r && r.SupplierName) || '', codesText: '' };
    var root = supplierGroupRootOf[norm] || norm;
    var knownCodes = supplierGroupKnownCodes[root] || [norm];
    var name = supplierGroupDisplayName[root] || (r && r.SupplierName) || '';
    var codesText = knownCodes.map(formatCodeForDisplay).join('/');
    return { name: name, codesText: codesText };
  }

  function supplierDisplayText(r) {
    var info = supplierGroupInfo(r);
    if (!info.name) return '';
    return info.codesText ? (info.name + ' (' + info.codesText + ')') : info.name;
  }

  function blankRow() {
    var r = {};
    TEXT_FIELDS.forEach(function (f) { r[f.key] = ''; });
    r.UnitPrice = 0;
    BRANCHES.forEach(function (b) {
      r[branchField(b.code, 'SoldQty')] = 0;
      r[branchField(b.code, 'Balance')] = 0;
    });
    r.TotalQtySold = 0;
    r.TotalBalance = 0;
    r.excludedFromReport = false;
    return r;
  }

  function recalcRow(r) {
    var totalSold = 0, totalBalance = 0;
    BRANCHES.forEach(function (b) {
      totalSold += Number(r[branchField(b.code, 'SoldQty')]) || 0;
      totalBalance += Number(r[branchField(b.code, 'Balance')]) || 0;
    });
    r.TotalQtySold = totalSold;
    r.TotalBalance = totalBalance;
  }

  function recalcAll() { state.rows.forEach(recalcRow); }

  function reportableRows() {
    return state.rows.filter(function (r) { return !r.excludedFromReport; });
  }

  // ---------------------------------------------------------------------
  // Persistence — IndexedDB, not localStorage. A full catalog import (tens
  // of thousands of rows, e.g. merging several daily files) easily exceeds
  // localStorage's ~5-10MB per-origin quota, which fails the save silently
  // for large datasets. IndexedDB's quota is far larger (a share of free
  // disk space). Still entirely local to this browser — nothing changes
  // about where the data lives, only how much of it fits.
  // ---------------------------------------------------------------------
  var IDB_NAME = 'modelsReportDB';
  var IDB_STORE = 'kv';
  var idbPromise = null;

  function idbOpen() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('indexedDB unavailable')); return; }
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return idbPromise;
  }

  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbSet(key, value) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function save() {
    idbSet(STORAGE_KEY, state).then(function () {
      flashSaved(true);
    }).catch(function (e) {
      console.warn('save failed', e);
      flashSaved(false);
    });
  }

  var saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 300);
  }

  // Verifies IndexedDB actually round-trips a value. Runs in parallel with
  // load() at boot (not awaited) so a broken store (private/locked-down
  // browsing modes) surfaces the warning banner without delaying render.
  function checkStorageWorking() {
    if (!window.indexedDB) return Promise.resolve(false);
    return idbSet('__storageTest__', 1)
      .then(function () { return idbGet('__storageTest__'); })
      .then(function (v) { return v === 1; })
      .catch(function () { return false; });
  }

  function flashSaved(ok) {
    var el = document.getElementById('saveIndicator');
    if (ok) {
      el.textContent = 'تم الحفظ ✓';
      el.classList.remove('error');
    } else {
      el.textContent = 'تعذّر الحفظ — تصفح المتصفح الخاص أو إعدادات الخصوصية قد تمنع حفظ البيانات ✕';
      el.classList.add('error');
    }
    el.classList.add('show');
    clearTimeout(flashSaved._t);
    flashSaved._t = setTimeout(function () { el.classList.remove('show'); }, ok ? 1200 : 5000);
  }

  function applyLoadedState(parsed) {
    state = parsed;
    state.settings = Object.assign({}, DEFAULT_SETTINGS, state.settings || {});
    // Only seed the default merge list if this field has never been
    // saved before — an explicitly-cleared empty string is left alone.
    var seededAlias = false;
    if (state.supplierAliasText == null) { state.supplierAliasText = DEFAULT_SUPPLIER_ALIAS_TEXT; seededAlias = true; }
    if (state.excludedSupplierRootsText == null) { state.excludedSupplierRootsText = DEFAULT_EXCLUDED_SUPPLIER_TEXT; seededAlias = true; }
    if (state.minPriceFilter === undefined) state.minPriceFilter = null;
    if (state.minSoldPerBranchFilter == null) state.minSoldPerBranchFilter = 0;
    if (!state.importedDayCount) state.importedDayCount = 1;
    state.rows.forEach(function (r) { if (r.excludedFromReport == null) r.excludedFromReport = false; });
    rebuildSupplierAliasMap();
    if (seededAlias) save();
  }

  function seedEmptyState() {
    // No data yet: start empty. The user imports their own Excel file(s)
    // (no sample business data ships with this app).
    state.rows = [];
    state.dateFrom = '';
    state.dateTo = '';
    state.settings = Object.assign({}, DEFAULT_SETTINGS);
    state.supplierAliasText = DEFAULT_SUPPLIER_ALIAS_TEXT;
    state.excludedSupplierRootsText = DEFAULT_EXCLUDED_SUPPLIER_TEXT;
    state.minPriceFilter = null;
    state.minSoldPerBranchFilter = 0;
    state.importedDayCount = 1;
    rebuildSupplierAliasMap();
  }

  function load() {
    return idbGet(STORAGE_KEY).then(function (fromIdb) {
      if (fromIdb && Array.isArray(fromIdb.rows)) {
        applyLoadedState(fromIdb);
        return;
      }
      // Nothing in IndexedDB yet — check for a save from before this app
      // switched persistence backends (localStorage) and migrate it once.
      var legacyRaw = null;
      try { legacyRaw = localStorage.getItem(STORAGE_KEY); } catch (e) { /* ignore */ }
      if (legacyRaw) {
        try {
          var parsed = JSON.parse(legacyRaw);
          if (parsed && Array.isArray(parsed.rows)) {
            applyLoadedState(parsed);
            save();
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
            return;
          }
        } catch (e) { console.warn('bad legacy saved state', e); }
      }
      seedEmptyState();
      save();
    }).catch(function (e) {
      console.warn('storage read failed', e);
      seedEmptyState();
    });
  }

  // ---------------------------------------------------------------------
  // Day/night theme toggle
  // ---------------------------------------------------------------------
  function getCurrentTheme() {
    var attr = document.documentElement.getAttribute('data-theme');
    if (attr) return attr;
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }

  function renderThemeButton() {
    var btn = document.getElementById('btnTheme');
    btn.textContent = getCurrentTheme() === 'dark' ? '☀️ الوضع النهاري' : '🌙 الوضع الليلي';
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
    renderThemeButton();
  }

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
    if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
    renderThemeButton();
    document.getElementById('btnTheme').addEventListener('click', function () {
      setTheme(getCurrentTheme() === 'dark' ? 'light' : 'dark');
    });
  }

  // ---------------------------------------------------------------------
  // Branch legend & selector
  // ---------------------------------------------------------------------
  function renderLegend() {
    var el = document.getElementById('branchLegend');
    el.innerHTML = BRANCHES.map(function (b) {
      return '<div class="branch-chip"><span class="dot" style="background:' + b.color + '"></span>' +
        '<b>' + b.code + '</b> ' + b.name + '</div>';
    }).join('');
  }

  // ---------------------------------------------------------------------
  // Settings panel removed — the stock-adequacy rule now uses the fixed
  // (documented) thresholds in DEFAULT_SETTINGS: lowStockDaysThreshold (3
  // days of stock left or fewer). No dedicated UI for tuning them yet.

  // ---------------------------------------------------------------------
  // Supplier code merge panel
  // ---------------------------------------------------------------------
  function updateSupplierMergeStatus() {
    var statusEl = document.getElementById('supplierMergeStatus');
    if (!statusEl) return;
    var counts = {};
    Object.keys(supplierGroupRootOf).forEach(function (c) {
      var root = supplierGroupRootOf[c];
      counts[root] = (counts[root] || 0) + 1;
    });
    var mergedRoots = Object.keys(counts).filter(function (root) { return counts[root] > 1; });
    var mergedCodes = mergedRoots.reduce(function (sum, root) { return sum + counts[root]; }, 0);
    var userLines = (state.supplierAliasText || '').split('\n').filter(function (line) {
      return line.split(',').map(function (s) { return s.trim(); }).filter(Boolean).length > 1;
    }).length;
    var msg = 'الدمج المدمج تلقائيًا في التطبيق: ' + mergedRoots.length + ' مورد (' + mergedCodes + ' كودًا).';
    if (userLines) msg += ' + ' + userLines + ' سطر دمج إضافي كتبته أنت.';
    statusEl.textContent = msg;
  }

  function initSupplierMergePanel() {
    var panel = document.getElementById('supplierMergePanel');
    var toggleBtn = document.getElementById('btnSupplierMergeToggle');
    var textarea = document.getElementById('supplierAliasInput');

    textarea.value = state.supplierAliasText || '';
    updateSupplierMergeStatus();

    toggleBtn.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
    });

    document.getElementById('btnSupplierMergeSave').addEventListener('click', function () {
      state.supplierAliasText = textarea.value;
      rebuildSupplierAliasMap();
      updateSupplierMergeStatus();
      refreshAfterDataChange();
      renderTableIfActive();
      scheduleSave();
    });
  }

  // ---------------------------------------------------------------------
  // Permanent supplier exclusion — codes here never appear in any of the 5
  // reports (nor in the supplier picker), no matter what's selected there.
  // General mechanism, not specific to any one supplier; see
  // DEFAULT_EXCLUDED_SUPPLIER_TEXT for the one default entry.
  // ---------------------------------------------------------------------
  function permanentlyExcludedSupplierRoots() {
    var set = {};
    (state.excludedSupplierRootsText || '').split(/[\n,]/).map(function (s) { return s.trim(); })
      .filter(Boolean).forEach(function (code) { set[resolveSupplierCode(code)] = true; });
    return set;
  }

  function updateSupplierExcludeStatus() {
    var statusEl = document.getElementById('supplierExcludeStatus');
    if (!statusEl) return;
    var roots = Object.keys(permanentlyExcludedSupplierRoots());
    if (!roots.length) { statusEl.textContent = 'لا يوجد مورد مستبعد نهائيًا حاليًا.'; return; }
    var names = roots.map(function (root) { return supplierGroupDisplayName[root] || root; });
    statusEl.textContent = 'مستبعد نهائيًا: ' + names.join('، ') + '.';
  }

  function initSupplierExcludePanel() {
    var panel = document.getElementById('supplierExcludePanel');
    var toggleBtn = document.getElementById('btnSupplierExcludeToggle');
    var textarea = document.getElementById('supplierExcludeInput');

    textarea.value = state.excludedSupplierRootsText || '';
    updateSupplierExcludeStatus();

    toggleBtn.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
    });

    document.getElementById('btnSupplierExcludeSave').addEventListener('click', function () {
      state.excludedSupplierRootsText = textarea.value;
      updateSupplierExcludeStatus();
      refreshAfterDataChange();
      scheduleSave();
    });
  }

  // ---------------------------------------------------------------------
  // Table rendering (editable)
  // ---------------------------------------------------------------------
  function renderTableHead() {
    var thead = document.getElementById('tableHead');
    var groupRow = '<tr class="group-row"><th rowspan="2">#</th>';
    TEXT_FIELDS.forEach(function (f) { groupRow += '<th rowspan="2">' + f.label + '</th>'; });
    groupRow += '<th rowspan="2">السعر</th>';
    BRANCHES.forEach(function (b) {
      groupRow += '<th colspan="2" class="col-group-branch">' + b.code + ' ' + b.name + '</th>';
    });
    groupRow += '<th colspan="2">الإجمالي</th><th rowspan="2"></th></tr>';

    var fieldRow = '<tr class="field-row">';
    BRANCHES.forEach(function () {
      fieldRow += '<th class="col-group-branch">بيع</th><th>رصيد</th>';
    });
    fieldRow += '<th>بيع</th><th>رصيد</th></tr>';

    thead.innerHTML = groupRow + fieldRow;
  }

  function rowMatchesSearch(r) {
    if (!searchTerm) return true;
    var info = supplierGroupInfo(r);
    var hay = (r.SupplierName + ' ' + r.StockGroupName + ' ' + r.StockCode + ' ' + r.ModelCode + ' ' +
      r.SupplierCode + ' ' + info.name + ' ' + info.codesText).toLowerCase();
    return hay.indexOf(searchTerm) !== -1;
  }

  // Rendering every row of a full-catalog import (tens of thousands) into
  // this heavily-input-per-cell table makes the DOM itself so large that
  // Chromium's post-interaction work (hover/hit-testing) can lock up the
  // page for a very long time the moment it becomes visible — not just a
  // slow render. So past this many matching rows, only the first slice is
  // shown and the user is asked to search to narrow it down instead.
  var EDIT_TABLE_ROW_LIMIT = 500;

  function renderTableBody() {
    var tbody = document.getElementById('tableBody');
    var matched = [];
    state.rows.forEach(function (r, idx) { if (rowMatchesSearch(r)) matched.push(idx); });

    var shown = matched.slice(0, EDIT_TABLE_ROW_LIMIT);
    var html = shown.map(function (idx) {
      var r = state.rows[idx];
      var rowHtml = '<tr data-idx="' + idx + '"' + (r.excludedFromReport ? ' class="row-excluded"' : '') + '>';
      rowHtml += '<td>' + (idx + 1) + '</td>';
      TEXT_FIELDS.forEach(function (f) {
        rowHtml += '<td><input class="text-cell" data-field="' + f.key + '" value="' + escapeAttr(r[f.key]) + '"></td>';
      });
      rowHtml += '<td><input type="number" step="0.01" data-field="UnitPrice" value="' + (r.UnitPrice || 0) + '"></td>';
      BRANCHES.forEach(function (b) {
        rowHtml += '<td class="col-group-branch"><input type="number" data-field="' + branchField(b.code, 'SoldQty') + '" value="' + (r[branchField(b.code, 'SoldQty')] || 0) + '"></td>';
        rowHtml += '<td><input type="number" data-field="' + branchField(b.code, 'Balance') + '" value="' + (r[branchField(b.code, 'Balance')] || 0) + '"></td>';
      });
      rowHtml += '<td><b>' + r.TotalQtySold + '</b></td>';
      rowHtml += '<td><b>' + r.TotalBalance + '</b></td>';
      rowHtml += '<td><button class="btn-del-row" data-idx="' + idx + '" title="حذف الصف">✕</button></td>';
      rowHtml += '</tr>';
      return rowHtml;
    }).join('');

    var colCount = 2 + TEXT_FIELDS.length + 1 + BRANCHES.length * 2 + 2;
    if (!state.rows.length) {
      html = '<tr><td colspan="' + colCount + '" class="empty-state">' +
        'لا توجد بيانات بعد. استخدم بطاقة "مصدر البيانات" في تبويب التقارير لرفع ملف أو لصق بيانات.' +
        '</td></tr>';
    } else if (!matched.length) {
      html = '<tr><td colspan="' + colCount + '" class="empty-state">لا توجد أصناف مطابقة لبحثك.</td></tr>';
    } else if (matched.length > EDIT_TABLE_ROW_LIMIT) {
      html += '<tr><td colspan="' + colCount + '" class="empty-state">' +
        'تُعرض أول ' + EDIT_TABLE_ROW_LIMIT + ' من أصل ' + matched.length + ' صنفًا مطابقًا. استخدم البحث أعلاه لتضييق ' +
        'النتائج ورؤية صنف معين (عرض آلاف الأصناف دفعة واحدة يُبطئ المتصفح كثيرًا).</td></tr>';
    }
    tbody.innerHTML = html;

    document.getElementById('rowCount').textContent = state.rows.length + ' صنف';
  }

  function renderTableFoot() {
    var tfoot = document.getElementById('tableFoot');
    var totals = { TotalQtySold: 0, TotalBalance: 0 };
    BRANCHES.forEach(function (b) {
      totals[branchField(b.code, 'SoldQty')] = 0;
      totals[branchField(b.code, 'Balance')] = 0;
    });
    state.rows.forEach(function (r) {
      BRANCHES.forEach(function (b) {
        totals[branchField(b.code, 'SoldQty')] += Number(r[branchField(b.code, 'SoldQty')]) || 0;
        totals[branchField(b.code, 'Balance')] += Number(r[branchField(b.code, 'Balance')]) || 0;
      });
      totals.TotalQtySold += r.TotalQtySold;
      totals.TotalBalance += r.TotalBalance;
    });
    var html = '<tr><td colspan="' + (1 + TEXT_FIELDS.length) + '">الإجمالي</td><td></td>';
    BRANCHES.forEach(function (b) {
      html += '<td class="col-group-branch">' + totals[branchField(b.code, 'SoldQty')] + '</td><td>' + totals[branchField(b.code, 'Balance')] + '</td>';
    });
    html += '<td>' + totals.TotalQtySold + '</td><td>' + totals.TotalBalance + '</td><td></td></tr>';
    tfoot.innerHTML = html;
  }

  function escapeAttr(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function renderTable() {
    renderTableHead();
    renderTableBody();
    renderTableFoot();
  }

  // Event delegation for editing
  document.addEventListener('input', function (e) {
    var input = e.target;
    if (!input.matches('#tableBody input')) return;
    var tr = input.closest('tr');
    var idx = Number(tr.getAttribute('data-idx'));
    var field = input.getAttribute('data-field');
    var row = state.rows[idx];
    if (!row) return;
    if (input.type === 'number') {
      row[field] = input.value === '' ? 0 : Number(input.value);
    } else {
      row[field] = input.value;
    }
    recalcRow(row);
    var cells = tr.querySelectorAll('td');
    cells[cells.length - 3].innerHTML = '<b>' + row.TotalQtySold + '</b>';
    cells[cells.length - 2].innerHTML = '<b>' + row.TotalBalance + '</b>';
    renderTableFoot();
    refreshAfterDataChange();
    scheduleSave();
  });

  document.addEventListener('click', function (e) {
    if (e.target.matches('.btn-del-row')) {
      var idx = Number(e.target.getAttribute('data-idx'));
      if (confirm('حذف هذا الصنف من التقرير؟')) {
        state.rows.splice(idx, 1);
        renderTableIfActive();
        refreshAfterDataChange();
        scheduleSave();
      }
    }
  });

  // ---------------------------------------------------------------------
  // Branch report engine — per-branch strength/weakness assessment
  // (no cross-branch transfer suggestions: each branch is judged on its
  // own sales vs. its own stock, using how the model performs elsewhere
  // only as evidence that it is worth reordering)
  // ---------------------------------------------------------------------
  // Which single OTHER branch sold the most of this model, and how much —
  // shown as a report column so a low-balance branch can see where demand
  // is concentrated (e.g. "فرع البديعة باع 15 حبة").
  function topOtherBranch(r, branchCode) {
    var top = null;
    BRANCHES.forEach(function (b) {
      if (b.code === branchCode) return;
      var qty = Number(r[branchField(b.code, 'SoldQty')]) || 0;
      if (!top || qty > top.qty) top = { name: b.name, qty: qty };
    });
    return top;
  }

  // Highest quantity this model sold in any single branch (not summed) —
  // used by the minimum-sold filter: a model only needs to have proven
  // itself in ONE branch to qualify for inclusion everywhere it otherwise
  // needs attention, not necessarily the branch of the report it's on.
  function maxSoldAnyBranch(r) {
    var max = 0;
    BRANCHES.forEach(function (b) {
      var qty = Number(r[branchField(b.code, 'SoldQty')]) || 0;
      if (qty > max) max = qty;
    });
    return max;
  }

  function computeBranchReportRows(branchCode, includeExcluded) {
    var rows = includeExcluded ? state.rows : reportableRows();
    var settings = state.settings;
    var numDays = state.importedDayCount || 1;
    return rows.map(function (r) {
      var soldHere = Number(r[branchField(branchCode, 'SoldQty')]) || 0;
      var balanceHere = Number(r[branchField(branchCode, 'Balance')]) || 0;
      var soldElsewhere = (r.TotalQtySold || 0) - soldHere;
      var topOther = topOtherBranch(r, branchCode);
      // "Selling well" looks at total sales across ALL branches (not just
      // this branch or just the others in isolation) so a model that sells
      // steadily split across branches still counts — e.g. 4 here + 14
      // elsewhere clears a threshold of 15 even though neither half alone does.
      var sellingWell = soldHere >= settings.hotSoldMin || (r.TotalQtySold || 0) >= settings.opportunityMinTotalSold;
      // Days of stock left = balance ÷ average daily sales in this branch,
      // where average daily sales = this branch's sold quantity ÷ the
      // number of days imported (each imported file/day counts as one day).
      // E.g. 15 sold over 3 imported days = 5/day; a balance of 15 lasts
      // 15 ÷ 5 = 3 days. lowStockDaysThreshold (3) days left or fewer -> low.
      var avgDailySoldHere = soldHere / numDays;
      var daysOfStockLeft = avgDailySoldHere > 0 ? balanceHere / avgDailySoldHere : Infinity;
      var runningLow = daysOfStockLeft <= settings.lowStockDaysThreshold;

      // A negative balance sometimes means this model's sales/stock actually
      // landed under the supplier's OTHER reference code instead of this one
      // (seen especially at فرع التحلية) — flag it for manual verification
      // rather than silently guessing which code holds the real numbers.
      var negativeBalanceNote = null;
      if (balanceHere < 0) {
        var normCode = normalizeSupplierCode(r.SupplierCode);
        var root = supplierGroupRootOf[normCode] || normCode;
        var known = supplierGroupKnownCodes[root] || [normCode];
        if (known.length > 1) {
          var otherCodes = known.filter(function (c) { return c !== normCode; }).map(formatCodeForDisplay);
          negativeBalanceNote = 'الرصيد سالب — تحقق من كود المورد الآخر (' + otherCodes.join('/') + ')';
        }
      }

      var status, statusLabel;
      if (r.excludedFromReport) {
        status = 'excluded';
        statusLabel = 'مستبعد من التقرير';
      } else if (soldElsewhere >= settings.opportunityMinTotalSold && soldHere === 0 && balanceHere === 0) {
        // Checked before the generic reorder case below: a model that has
        // never been carried in this branch at all is a "new opportunity"
        // (consider introducing it), which is a different action from
        // "restock what you already sell here".
        status = 'opportunity';
        statusLabel = 'موديل ناجح — غير متوفر لديك';
      } else if (sellingWell && runningLow) {
        if (balanceHere <= 0) {
          status = 'critical';
          statusLabel = 'لا يوجد رصيد — اطلب الآن';
        } else {
          status = 'warning';
          statusLabel = 'رصيد منخفض — اطلب الآن';
        }
      } else if (balanceHere > settings.maxBalance) {
        status = 'surplus';
        statusLabel = 'فائض في المخزون';
      } else {
        status = 'ok';
        statusLabel = 'المخزون مناسب';
      }

      return {
        row: r, soldHere: soldHere, soldElsewhere: soldElsewhere, balanceHere: balanceHere,
        status: status, statusLabel: statusLabel, daysOfStockLeft: daysOfStockLeft,
        negativeBalanceNote: negativeBalanceNote,
        topOtherBranchName: topOther.qty > 0 ? topOther.name : null, topOtherBranchQty: topOther.qty
      };
    }).sort(function (a, b) {
      var order = { critical: 0, warning: 1, opportunity: 2, surplus: 3, ok: 4, excluded: 5 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return (b.soldHere + b.soldElsewhere) - (a.soldHere + a.soldElsewhere);
    });
  }

  // ---------------------------------------------------------------------
  // Supplier / category filters — searchable checklist dropdowns, same
  // pattern as DailyModelsReports: suppliers default to "none selected"
  // meaning "all included"; categories default to "all checked" meaning
  // "all included", and unchecking one excludes it.
  // ---------------------------------------------------------------------
  var supplierDirectory = [];
  var allSuppliersSelected = true;
  var selectedSupplierRoots = {}; // root code -> true

  var categoryDirectory = [];
  var allCategoriesSelected = true;
  var excludedCategories = {}; // category name -> true

  function buildSupplierDirectory() {
    var seen = {};
    var list = [];
    var permExcluded = permanentlyExcludedSupplierRoots();
    state.rows.forEach(function (r) {
      if (!r.SupplierCode) return;
      var root = resolveSupplierCode(r.SupplierCode);
      if (seen[root] || permExcluded[root]) return;
      seen[root] = true;
      var info = supplierGroupInfo(r);
      list.push({ root: root, name: info.name || r.SupplierName || root, codesText: info.codesText });
    });
    list.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
    return list;
  }

  function buildCategoryDirectory() {
    var seen = {};
    var list = [];
    state.rows.forEach(function (r) {
      var cat = (r.StockGroupName || '').toString().trim();
      if (!cat || seen[cat]) return;
      seen[cat] = true;
      list.push(cat);
    });
    list.sort();
    return list;
  }

  function updateSupplierToggleText() {
    var el = document.getElementById('supplierDropdownToggleText');
    if (allSuppliersSelected) { el.textContent = 'كل الموردين'; return; }
    var count = Object.keys(selectedSupplierRoots).length;
    if (count === 0) el.textContent = 'لم يُحدَّد أي مورد';
    else if (count === 1) {
      var root = Object.keys(selectedSupplierRoots)[0];
      var found = supplierDirectory.filter(function (s) { return s.root === root; })[0];
      el.textContent = found ? found.name : (count + ' مورد محدد');
    } else el.textContent = count + ' موردين محددين';
  }

  function renderSupplierCheckList() {
    var list = document.getElementById('supplierCheckList');
    list.innerHTML = '';
    if (!supplierDirectory.length) {
      list.innerHTML = '<p class="hint">لا يوجد مورد في البيانات المستوردة بعد.</p>';
      return;
    }
    supplierDirectory.forEach(function (s) {
      var label = document.createElement('label');
      label.className = 'check-item';
      label.dataset.search = (s.name + ' ' + s.codesText).toLowerCase();
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!selectedSupplierRoots[s.root];
      cb.addEventListener('change', function () {
        if (cb.checked) selectedSupplierRoots[s.root] = true; else delete selectedSupplierRoots[s.root];
        allSuppliersSelected = Object.keys(selectedSupplierRoots).length === 0;
        updateSupplierToggleText();
      });
      var span = document.createElement('span');
      span.textContent = s.name + (s.codesText ? ' (' + s.codesText + ')' : '');
      label.appendChild(cb); label.appendChild(span);
      list.appendChild(label);
    });
  }

  function refreshSupplierDirectory() {
    supplierDirectory = buildSupplierDirectory();
    allSuppliersSelected = true;
    selectedSupplierRoots = {};
    var search = document.getElementById('supplierSearchInput'); if (search) search.value = '';
    renderSupplierCheckList();
    updateSupplierToggleText();
  }

  function updateCategoryToggleText() {
    var el = document.getElementById('categoryDropdownToggleText');
    if (allCategoriesSelected) { el.textContent = 'كل الأصناف'; return; }
    var excludedCount = Object.keys(excludedCategories).length;
    var selectedCount = categoryDirectory.length - excludedCount;
    el.textContent = selectedCount + ' من ' + categoryDirectory.length + ' صنفًا محددة';
  }

  function renderCategoryCheckList() {
    var list = document.getElementById('categoryCheckList');
    list.innerHTML = '';
    if (!categoryDirectory.length) {
      list.innerHTML = '<p class="hint">لا يوجد صنف/فئة في البيانات المستوردة بعد.</p>';
      return;
    }
    categoryDirectory.forEach(function (cat) {
      var label = document.createElement('label');
      label.className = 'check-item';
      label.dataset.search = cat.toLowerCase();
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !excludedCategories[cat];
      cb.addEventListener('change', function () {
        if (cb.checked) delete excludedCategories[cat]; else excludedCategories[cat] = true;
        allCategoriesSelected = Object.keys(excludedCategories).length === 0;
        updateCategoryToggleText();
      });
      var span = document.createElement('span');
      span.textContent = cat;
      label.appendChild(cb); label.appendChild(span);
      list.appendChild(label);
    });
  }

  function refreshCategoryDirectory() {
    categoryDirectory = buildCategoryDirectory();
    allCategoriesSelected = true;
    excludedCategories = {};
    var search = document.getElementById('categorySearchInput'); if (search) search.value = '';
    renderCategoryCheckList();
    updateCategoryToggleText();
  }

  function refreshFilterDirectories() {
    refreshSupplierDirectory();
    refreshCategoryDirectory();
  }

  function initFilterDropdowns() {
    var sToggle = document.getElementById('supplierDropdownToggle');
    var sPanel = document.getElementById('supplierDropdownPanel');
    sToggle.addEventListener('click', function () {
      sPanel.hidden = !sPanel.hidden;
      sToggle.setAttribute('aria-expanded', String(!sPanel.hidden));
    });
    document.getElementById('supplierSearchInput').addEventListener('input', function (e) {
      var q = e.target.value.trim().toLowerCase();
      Array.prototype.forEach.call(document.querySelectorAll('#supplierCheckList .check-item'), function (item) {
        item.classList.toggle('no-match', q !== '' && (item.dataset.search || '').indexOf(q) === -1);
      });
    });
    document.getElementById('selectAllSuppliersBtn').addEventListener('click', function () {
      allSuppliersSelected = true;
      selectedSupplierRoots = {};
      Array.prototype.forEach.call(document.querySelectorAll('#supplierCheckList input[type="checkbox"]'), function (el) { el.checked = false; });
      updateSupplierToggleText();
    });

    var cToggle = document.getElementById('categoryDropdownToggle');
    var cPanel = document.getElementById('categoryDropdownPanel');
    cToggle.addEventListener('click', function () {
      cPanel.hidden = !cPanel.hidden;
      cToggle.setAttribute('aria-expanded', String(!cPanel.hidden));
    });
    document.getElementById('categorySearchInput').addEventListener('input', function (e) {
      var q = e.target.value.trim().toLowerCase();
      Array.prototype.forEach.call(document.querySelectorAll('#categoryCheckList .check-item'), function (item) {
        item.classList.toggle('no-match', q !== '' && (item.dataset.search || '').indexOf(q) === -1);
      });
    });
    document.getElementById('selectAllCategoriesBtn').addEventListener('click', function () {
      allCategoriesSelected = true;
      excludedCategories = {};
      Array.prototype.forEach.call(document.querySelectorAll('#categoryCheckList input[type="checkbox"]'), function (el) { el.checked = true; });
      updateCategoryToggleText();
    });

    document.addEventListener('click', function (e) {
      if (!sPanel.hidden && !sPanel.contains(e.target) && !sToggle.contains(e.target)) {
        sPanel.hidden = true; sToggle.setAttribute('aria-expanded', 'false');
      }
      if (!cPanel.hidden && !cPanel.contains(e.target) && !cToggle.contains(e.target)) {
        cPanel.hidden = true; cToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // ---------------------------------------------------------------------
  // Report generation — 5 branch reports at once, each scoped to items
  // that need attention only (لا يوجد رصيد / رصيد منخفض / فرصة جديدة).
  // مخزون مناسب and فائض في المخزون are never included here.
  // ---------------------------------------------------------------------
  var lastGeneratedReports = null; // branchCode -> { branch, data }

  function branchReportData(branchCode) {
    var supplierFilterActive = !allSuppliersSelected;
    var categoryFilterActive = !allCategoriesSelected;
    var permExcluded = permanentlyExcludedSupplierRoots();
    var minPrice = state.minPriceFilter;
    var minSoldPerBranch = Number(state.minSoldPerBranchFilter) || 0;
    var data = computeBranchReportRows(branchCode, false).filter(function (d) {
      if (d.status !== 'critical' && d.status !== 'warning' && d.status !== 'opportunity') return false;
      if (supplierFilterActive && !selectedSupplierRoots[resolveSupplierCode(d.row.SupplierCode)]) return false;
      if (categoryFilterActive && excludedCategories[(d.row.StockGroupName || '').trim()]) return false;
      if (permExcluded[resolveSupplierCode(d.row.SupplierCode)]) return false;
      if (minPrice != null && (Number(d.row.UnitPrice) || 0) < minPrice) return false;
      // Scoped to ANY branch, not this report's own branch — a model that
      // proved itself somewhere still qualifies here, as long as this
      // branch's own status (checked above) says it needs attention.
      if (minSoldPerBranch > 0 && maxSoldAnyBranch(d.row) < minSoldPerBranch) return false;
      return true;
    });
    // Ascending by (merged) supplier code, then descending by quantity sold
    // in the rest of the branches — matches the printed report's order.
    data.sort(function (a, b) {
      var codeA = resolveSupplierCode(a.row.SupplierCode) || '';
      var codeB = resolveSupplierCode(b.row.SupplierCode) || '';
      if (codeA !== codeB) {
        var numA = parseFloat(codeA), numB = parseFloat(codeB);
        if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
        return codeA < codeB ? -1 : 1;
      }
      if (b.soldElsewhere !== a.soldElsewhere) return b.soldElsewhere - a.soldElsewhere;
      return b.soldHere - a.soldHere;
    });
    return data;
  }

  function buildReportCardHtml(b, data) {
    var counts = { critical: 0, warning: 0, opportunity: 0 };
    data.forEach(function (d) { counts[d.status]++; });
    var summary = '🔴 ' + counts.critical + ' لا يوجد رصيد &nbsp;·&nbsp; 🟡 ' + counts.warning + ' رصيد منخفض &nbsp;·&nbsp; 🟢 ' + counts.opportunity + ' فرصة جديدة';

    var rowsHtml;
    if (!data.length) {
      rowsHtml = '<tr><td colspan="9" class="empty-state">لا توجد أصناف تحتاج انتباهًا في هذا الفرع ضمن الفلاتر الحالية.</td></tr>';
    } else {
      rowsHtml = data.map(function (d, i) {
        var r = d.row;
        var desc = escapeAttr((r.StockGroupName || '') + ' — ' + (r.ModelCode || ''));
        if (d.negativeBalanceNote) desc += '<br><span class="report-note">⚠️ ' + escapeAttr(d.negativeBalanceNote) + '</span>';
        var price = (Number(r.UnitPrice) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return '<tr>' +
          '<td class="num">' + (i + 1) + '</td>' +
          '<td>' + desc + '</td>' +
          '<td>' + escapeAttr(supplierDisplayText(r)) + '</td>' +
          '<td class="num">' + price + '</td>' +
          '<td class="num">' + d.soldHere + '</td>' +
          '<td class="num">' + d.balanceHere + '</td>' +
          '<td class="num">' + d.soldElsewhere + '</td>' +
          '<td>' + (d.topOtherBranchName ? escapeAttr(d.topOtherBranchName + ' (' + d.topOtherBranchQty + ')') : '—') + '</td>' +
          '<td><span class="status-label ' + d.status + '">' + escapeAttr(STATUS_META[d.status] || d.statusLabel) + '</span></td>' +
          '</tr>';
      }).join('');
    }

    return '<div class="panel flow-card report-card" data-branch="' + b.code + '">' +
      '<div class="report-head">' +
        '<h2>تقرير فرع ' + b.name + ' (' + b.code + ')</h2>' +
        '<button class="btn pdf-btn" type="button" data-branch="' + b.code + '">📄 تصدير PDF</button>' +
      '</div>' +
      '<p class="report-summary">' + summary + '</p>' +
      '<div class="report-preview-wrap">' +
        '<table class="report-preview-table">' +
          '<thead><tr><th class="num">#</th><th>الصنف / الموديل</th><th>المورد</th><th class="num">السعر</th><th class="num">مبيعات ' + b.name + '</th><th class="num">الرصيد</th>' +
          '<th class="num">إجمالي باقي الفروع</th><th>الأكثر مبيعًا بفرع آخر</th><th>الحالة</th></tr></thead>' +
          '<tbody>' + rowsHtml + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>';
  }

  // Re-runs whatever's already on screen after the underlying data changes
  // (an edit, an add/delete row, a supplier-merge change) — refreshes the
  // filter directories, and regenerates the report cards only if the user
  // had already generated them at least once this session.
  function refreshAfterDataChange() {
    refreshFilterDirectories();
    if (lastGeneratedReports) generateAllReports();
  }

  function generateAllReports() {
    var statusEl = document.getElementById('generateStatusMsg');
    if (!state.rows.length) {
      statusEl.textContent = 'لا توجد بيانات بعد. استورد ملفًا أو الصق بيانات أولًا.';
      return;
    }
    lastGeneratedReports = {};
    var cardsHtml = '';
    BRANCHES.forEach(function (b) {
      var data = branchReportData(b.code);
      lastGeneratedReports[b.code] = { branch: b, data: data };
      cardsHtml += buildReportCardHtml(b, data);
    });
    document.getElementById('reportCardsWrap').innerHTML = cardsHtml;
    statusEl.textContent = 'تم توليد 5 تقارير — الفترة: ' + (state.dateFrom || '؟') + ' إلى ' + (state.dateTo || '؟') + '.';
  }

  document.getElementById('btnGenerateReports').addEventListener('click', generateAllReports);

  // ---------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------
  // The edit table is expensive to build at full-catalog scale (tens of
  // thousands of rows x ~16 inputs each) — rendering it into a display:none
  // panel still forces the browser to lay the whole thing out the moment
  // it becomes visible, which can freeze the tab switch for a long time.
  // So it's rendered lazily: only while its tab is actually active, and
  // "dirty" (needs a fresh render) is tracked instead of rendering eagerly
  // on every data change.
  var tableTabDirty = true;
  function renderTableIfActive() {
    if (document.getElementById('tab-table').classList.contains('active')) {
      renderTable();
      tableTabDirty = false;
    } else {
      tableTabDirty = true;
    }
  }

  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('tab-' + btn.getAttribute('data-tab')).classList.add('active');
      if (btn.getAttribute('data-tab') === 'table' && tableTabDirty) {
        renderTable();
        tableTabDirty = false;
      }
    });
  });

  // ---------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------
  document.getElementById('searchBox').addEventListener('input', function (e) {
    searchTerm = e.target.value.trim().toLowerCase();
    renderTableIfActive();
  });

  // ---------------------------------------------------------------------
  // Date range
  // ---------------------------------------------------------------------
  document.getElementById('dateFrom').addEventListener('change', function (e) { state.dateFrom = e.target.value; scheduleSave(); });
  document.getElementById('dateTo').addEventListener('change', function (e) { state.dateTo = e.target.value; scheduleSave(); });

  // Open the native calendar picker on a single click anywhere in the field,
  // instead of requiring a precise click on the small calendar icon.
  ['dateFrom', 'dateTo'].forEach(function (id) {
    var el = document.getElementById(id);
    el.addEventListener('click', function () { if (el.showPicker) { try { el.showPicker(); } catch (e) { /* ignore */ } } });
  });

  // ---------------------------------------------------------------------
  // Report filters — minimum item price and minimum sold-per-branch. Both
  // default to "no filter" (empty price field, 0 for the sold threshold).
  // ---------------------------------------------------------------------
  function initReportFilterInputs() {
    var priceEl = document.getElementById('minPriceFilter');
    var soldEl = document.getElementById('minSoldPerBranchFilter');
    priceEl.value = state.minPriceFilter == null ? '' : state.minPriceFilter;
    soldEl.value = state.minSoldPerBranchFilter || '';
    priceEl.addEventListener('change', function () {
      state.minPriceFilter = priceEl.value === '' ? null : Number(priceEl.value);
      scheduleSave();
    });
    soldEl.addEventListener('change', function () {
      state.minSoldPerBranchFilter = soldEl.value === '' ? 0 : Number(soldEl.value);
      scheduleSave();
    });
  }

  // ---------------------------------------------------------------------
  // Add row / Reset
  // ---------------------------------------------------------------------
  document.getElementById('btnAddRow').addEventListener('click', function () {
    state.rows.unshift(blankRow());
    tableTabDirty = true; // the click below will render it fresh
    refreshAfterDataChange();
    scheduleSave();
    document.querySelector('.tab-btn[data-tab="table"]').click();
  });

  document.getElementById('btnReset').addEventListener('click', function () {
    if (confirm('سيتم مسح كل البيانات الحالية نهائيًا من هذا المتصفح. متابعة؟')) {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* legacy key, best-effort */ }
      state = {
        rows: [], dateFrom: '', dateTo: '', settings: Object.assign({}, DEFAULT_SETTINGS),
        supplierAliasText: DEFAULT_SUPPLIER_ALIAS_TEXT, excludedSupplierRootsText: DEFAULT_EXCLUDED_SUPPLIER_TEXT,
        minPriceFilter: null, minSoldPerBranchFilter: 0, importedDayCount: 1
      };
      rebuildSupplierAliasMap();
      document.getElementById('supplierAliasInput').value = state.supplierAliasText;
      document.getElementById('supplierExcludeInput').value = state.excludedSupplierRootsText;
      document.getElementById('minPriceFilter').value = '';
      document.getElementById('minSoldPerBranchFilter').value = '';
      updateSupplierMergeStatus();
      updateSupplierExcludeStatus();
      renderAll();
      scheduleSave();
    }
  });

  // ---------------------------------------------------------------------
  // Excel import — accepts either one file (a week/period already totaled,
  // the original workflow) or several files selected together, each
  // representing one day's full catalog snapshot (sales that day + that
  // day's branch balances). Multi-file imports are merged: sold quantities
  // are summed across every day, but each branch's balance is taken only
  // from the most recent day's file (its stock is the only one still
  // current) — never summed or averaged.
  // ---------------------------------------------------------------------
  function normalizeHeader(h) {
    return String(h || '').trim().toLowerCase().replace(/[\s_]+/g, '');
  }

  function buildHeaderKeyMap(sampleRow) {
    var map = {};
    Object.keys(sampleRow || {}).forEach(function (k) { map[normalizeHeader(k)] = k; });
    return map;
  }

  function getField(row, keyMap, canonicalKey) {
    var actualKey = keyMap[normalizeHeader(canonicalKey)];
    return actualKey === undefined ? undefined : row[actualKey];
  }

  // Parses one already-loaded sheet (as sheet_to_json output) into this
  // app's internal row shape, matching column headers case/spacing-
  // insensitively (so "Stockcode", "StockCode" and "stock_code" all map to
  // the same field) since daily export files aren't always cased the same.
  function parseSheetRows(json) {
    if (!json.length) return [];
    var keyMap = buildHeaderKeyMap(json[0]);
    return json.filter(function (r) {
      return getField(r, keyMap, 'ModelCode') || getField(r, keyMap, 'StockCode');
    }).map(function (r) {
      var row = blankRow();
      TEXT_FIELDS.forEach(function (f) {
        var v = getField(r, keyMap, f.key);
        if (v != null) row[f.key] = String(v).trim();
      });
      row.UnitPrice = Number(getField(r, keyMap, 'UnitPrice')) || 0;
      BRANCHES.forEach(function (b) {
        row[branchField(b.code, 'SoldQty')] = Number(getField(r, keyMap, branchField(b.code, 'SoldQty'))) || 0;
        row[branchField(b.code, 'Balance')] = Number(getField(r, keyMap, branchField(b.code, 'Balance'))) || 0;
      });
      row.excludedFromReport = !!Number(getField(r, keyMap, 'Excluded')) || false;
      recalcRow(row);
      return row;
    });
  }

  // Best-effort date extraction from a filename like
  // "AllModelsSoldAllShowroom_23-Sep-2026.xlsx" (also handles YYYY-MM-DD
  // and DD/MM/YYYY), used to order daily files so "most recent" is known
  // even if the user selects/drops them out of order. Returns null if no
  // recognizable date is found.
  function parseDateFromFilename(name) {
    var months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    var m = name.match(/(\d{1,2})[-_ ]([A-Za-z]{3,9})[-_ ](\d{4})/);
    if (m) {
      var mon = months[m[2].slice(0, 3).toLowerCase()];
      if (mon !== undefined) return new Date(Number(m[3]), mon, Number(m[1])).getTime();
    }
    m = name.match(/(\d{4})[-_](\d{1,2})[-_](\d{1,2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
    m = name.match(/(\d{1,2})[-_\/](\d{1,2})[-_\/](\d{4})/);
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
    return null;
  }

  // Merges several days' parsed rows into one dataset. Products are matched
  // across days by StockCode (falls back to ModelCode if a row has no
  // StockCode) since it's the most stable per-product identifier. Sold
  // quantities accumulate across every day the product appears in; balances
  // are overwritten only while processing the most recent day's file, so a
  // product absent from that last file simply keeps balance 0 (no current
  // stock data for it) rather than an average or a stale earlier figure.
  function mergeMultiDayRows(files) {
    var ordered = files.slice();
    if (ordered.every(function (f) { return f.dateKey != null; })) {
      ordered.sort(function (a, b) { return a.dateKey - b.dateKey; });
    }
    var latest = ordered[ordered.length - 1];

    var byKey = {};
    var order = [];
    ordered.forEach(function (file) {
      var isLatest = file === latest;
      file.rows.forEach(function (r) {
        var key = r.StockCode || r.ModelCode;
        if (!key) return;
        if (!byKey[key]) {
          byKey[key] = blankRow();
          TEXT_FIELDS.forEach(function (f) { byKey[key][f.key] = r[f.key]; });
          byKey[key].UnitPrice = r.UnitPrice;
          order.push(key);
        }
        var merged = byKey[key];
        if (isLatest) {
          TEXT_FIELDS.forEach(function (f) { if (r[f.key]) merged[f.key] = r[f.key]; });
          if (r.UnitPrice) merged.UnitPrice = r.UnitPrice;
        }
        BRANCHES.forEach(function (b) {
          merged[branchField(b.code, 'SoldQty')] += r[branchField(b.code, 'SoldQty')];
          if (isLatest) merged[branchField(b.code, 'Balance')] = r[branchField(b.code, 'Balance')];
        });
      });
    });
    return order.map(function (k) { recalcRow(byKey[k]); return byKey[k]; });
  }

  function formatDateKeyForInput(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Parses text pasted from Excel (or typed/pasted by a helper bot): tab-
  // separated if present (Excel's copy format), else comma, else falls back
  // to runs of 2+ spaces. First line is the header row.
  function parsePastedText(text) {
    var lines = text.split(/\r\n|\r|\n/).filter(function (l) { return l.trim() !== ''; });
    if (!lines.length) return [];
    function splitLine(line) {
      if (line.indexOf('\t') !== -1) return line.split('\t');
      if (line.indexOf(',') !== -1) return line.split(',');
      return line.trim().split(/\s{2,}/);
    }
    var headers = splitLine(lines[0]).map(function (h) { return h.trim(); });
    return lines.slice(1).map(function (line) {
      var cells = splitLine(line);
      var obj = {};
      headers.forEach(function (h, i) { obj[h] = cells[i] !== undefined ? cells[i].trim() : ''; });
      return obj;
    });
  }

  function finishImport(validFiles, importStatusEl) {
    var missingDates = validFiles.filter(function (f) { return f.dateKey == null; }).length;
    state.rows = mergeMultiDayRows(validFiles);
    // Each file/paste represents one day — this count drives the average
    // daily-sales estimate used to flag low stock (see computeBranchReportRows).
    state.importedDayCount = validFiles.length;

    // Auto-fill the date range from filenames, so the report is labeled
    // correctly without the user typing it in — still freely editable after.
    var knownDates = validFiles.map(function (f) { return f.dateKey; }).filter(function (d) { return d != null; });
    if (knownDates.length) {
      state.dateFrom = formatDateKeyForInput(Math.min.apply(null, knownDates));
      state.dateTo = formatDateKeyForInput(Math.max.apply(null, knownDates));
    }

    renderAll();
    scheduleSave();

    var msg = 'تم استيراد ' + validFiles.length + (validFiles.length > 1 ? ' أيام' : ' ملف') + ' — ' + state.rows.length + ' صنفًا.';
    if (validFiles.length > 1) {
      msg += ' المبيعات مُجمَّعة عبر كل الأيام، والرصيد الحالي مأخوذ من أحدث يوم فقط. معدل المبيعات اليومي (لحساب نفاد المخزون) محسوب على أساس ' + validFiles.length + ' يوم.';
      if (missingDates) {
        msg += ' تنبيه: تعذّر استنتاج التاريخ من اسم ' + missingDates + ' من الملفات، فاعتُمد ترتيب اختيارها كما هو.';
      }
    }
    importStatusEl.textContent = msg;
  }

  document.getElementById('fileInput').addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    var importStatusEl = document.getElementById('importStatusMsg');
    if (!files.length) return;
    importStatusEl.textContent = 'جارٍ قراءة الملف' + (files.length > 1 ? 'ات' : '') + '...';

    Promise.all(files.map(function (file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function (evt) {
          try {
            var data = new Uint8Array(evt.target.result);
            var wb = XLSX.read(data, { type: 'array' });
            var sheet = wb.Sheets[wb.SheetNames[0]];
            var json = XLSX.utils.sheet_to_json(sheet, { defval: 0 });
            resolve({ name: file.name, dateKey: parseDateFromFilename(file.name), rows: parseSheetRows(json) });
          } catch (err) { reject(err); }
        };
        reader.onerror = function () { reject(new Error('read failed: ' + file.name)); };
        reader.readAsArrayBuffer(file);
      });
    })).then(function (parsedFiles) {
      var validFiles = parsedFiles.filter(function (f) { return f.rows.length; });
      if (!validFiles.length) {
        importStatusEl.textContent = 'لم يتم العثور على بيانات صالحة في الملف/الملفات. تأكد من أن الأعمدة مطابقة للنموذج.';
        return;
      }
      finishImport(validFiles, importStatusEl);
    }).catch(function (err) {
      console.error(err);
      importStatusEl.textContent = 'تعذّرت قراءة أحد الملفات. تأكد من أنها بصيغة Excel صحيحة (xlsx).';
    }).finally(function () {
      e.target.value = '';
    });
  });

  document.getElementById('btnUsePaste').addEventListener('click', function () {
    var importStatusEl = document.getElementById('importStatusMsg');
    var text = document.getElementById('pasteArea').value;
    if (!text.trim()) { importStatusEl.textContent = 'الصق بيانات أولًا.'; return; }
    var json = parsePastedText(text);
    var rows = parseSheetRows(json);
    if (!rows.length) {
      importStatusEl.textContent = 'لم يتم العثور على بيانات صالحة في النص الملصق. تأكد من أن أول سطر هو عناوين الأعمدة.';
      return;
    }
    finishImport([{ name: 'نص ملصق', dateKey: null, rows: rows }], importStatusEl);
  });

  function exportColumns() {
    var cols = TEXT_FIELDS.map(function (f) { return f.key; }).concat(['UnitPrice']);
    BRANCHES.forEach(function (b) { cols.push(branchField(b.code, 'SoldQty')); });
    BRANCHES.forEach(function (b) { cols.push(branchField(b.code, 'Balance')); });
    cols.push('TotalQtySold', 'TotalBalance', 'Excluded');
    return cols;
  }

  document.getElementById('btnTemplate').addEventListener('click', function () {
    var cols = exportColumns();
    var ws = XLSX.utils.aoa_to_sheet([cols]);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'نموذج');
    XLSX.writeFile(wb, 'نموذج-فارغ-تقرير-المبيعات.xlsx');
  });

  // ---------------------------------------------------------------------
  // Excel export
  // ---------------------------------------------------------------------
  document.getElementById('btnExportExcel').addEventListener('click', function () {
    var cols = exportColumns();
    var data = state.rows.map(function (r) {
      var o = {};
      cols.forEach(function (c) {
        if (c === 'Excluded') { o[c] = r.excludedFromReport ? 1 : 0; return; }
        o[c] = r[c];
      });
      return o;
    });
    var ws = XLSX.utils.json_to_sheet(data, { header: cols });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'التقرير');
    var fname = 'تقرير-المبيعات-' + (state.dateFrom || '') + '_' + (state.dateTo || '') + '.xlsx';
    XLSX.writeFile(wb, fname);
  });

  // ---------------------------------------------------------------------
  // PDF export — native browser print (window.print() + @media print),
  // not html2canvas. The browser renders real, selectable, vector text —
  // correct Arabic shaping/bidi comes for free, same as any normal page —
  // and pagination is the browser's own, so this scales to reports with
  // hundreds of rows without the multi-minute render times/huge files a
  // screenshot-per-page approach hit at full-catalog scale.
  // ---------------------------------------------------------------------
  function fmtPrice(v) { return (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  // Short one-line labels — only critical/warning/opportunity ever reach
  // print (see branchReportData), so that's all this needs to cover.
  var PDF_STATUS_LABELS = {
    critical: 'خلص',
    warning: 'باقي شوي',
    opportunity: 'ما نزل'
  };

  function pdfSupplierCellHtml(r) {
    var text = supplierDisplayText(r);
    if (!text) return '—';
    var m = /^(.*?)(\s\([^)]*\))$/.exec(text);
    if (!m) return escapeAttr(text);
    return escapeAttr(m[1]) + '<span class="p-td-suppliercode">' + escapeAttr(m[2]) + '</span>';
  }

  function buildPrintRowsHtml(data) {
    return data.map(function (d, i) {
      var r = d.row;
      var desc = escapeAttr((r.StockGroupName || '') + ' — ' + (r.ModelCode || ''));
      if (d.negativeBalanceNote) desc += '<br><span class="p-note">⚠️ ' + escapeAttr(d.negativeBalanceNote) + '</span>';
      var topOtherText = d.topOtherBranchName ? (d.topOtherBranchName + ' (' + d.topOtherBranchQty + ' حبة)') : '—';
      return '<tr>' +
        '<td class="p-td-num">' + (i + 1) + '</td>' +
        '<td>' + desc + '</td>' +
        '<td>' + pdfSupplierCellHtml(r) + '</td>' +
        '<td class="p-td-num">' + fmtPrice(r.UnitPrice) + '</td>' +
        '<td class="p-td-num">' + d.soldHere + '</td>' +
        '<td class="p-td-num">' + d.balanceHere + '</td>' +
        '<td class="p-td-num">' + d.soldElsewhere + '</td>' +
        '<td>' + escapeAttr(topOtherText) + '</td>' +
        '<td>' + escapeAttr(PDF_STATUS_LABELS[d.status] || d.statusLabel) + '</td>' +
        '</tr>';
    }).join('');
  }

  function buildBranchPrintHtml(branch, data) {
    var rowsHtml = data.length
      ? buildPrintRowsHtml(data)
      : '<tr><td colspan="9" class="p-empty">لا توجد أصناف تحتاج انتباهًا في هذا الفرع ضمن الفلاتر الحالية.</td></tr>';
    return '<div class="p-page">' +
      '<h1 class="p-title">تقرير فرع ' + branch.name + ' (' + branch.code + ')</h1>' +
      '<p class="p-meta">الفترة: من ' + (state.dateFrom || '—') + ' إلى ' + (state.dateTo || '—') +
        ' &nbsp;|&nbsp; تاريخ الإصدار: ' + new Date().toLocaleDateString('en-GB') + '</p>' +
      '<table class="p-table">' +
        '<colgroup><col style="width:4%"><col style="width:17%"><col style="width:19%"><col style="width:8%"><col style="width:9%"><col style="width:8%"><col style="width:10%"><col style="width:12%"><col style="width:13%"></colgroup>' +
        '<thead><tr><th>#</th><th>الصنف / الموديل</th><th>المورد</th><th class="p-td-num">السعر</th><th class="p-td-num">مبيعات ' + branch.name + '</th><th class="p-td-num">الرصيد</th>' +
        '<th class="p-td-num">إجمالي باقي الفروع</th><th>أقوى فرع من الفروع الثانية</th><th>الحالة</th></tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
      '</table>' +
    '</div>';
  }

  var dynamicPrintStyle = document.getElementById('dynamicPrintStyle');

  function exportBranchReportToPdf(branchCode) {
    var entry = lastGeneratedReports && lastGeneratedReports[branchCode];
    if (!entry) return;
    var printArea = document.getElementById('printArea');
    printArea.innerHTML = buildBranchPrintHtml(entry.branch, entry.data);
    dynamicPrintStyle.textContent = '@media print { @page { size: A4 portrait; margin: 12mm; } }';

    var previousTitle = document.title;
    document.title = 'تقرير فرع ' + entry.branch.name + ' ' + entry.branch.code + ' ' + (state.dateFrom || '') + '-' + (state.dateTo || '');
    document.body.classList.add('printing');

    function cleanup() {
      document.body.classList.remove('printing');
      document.title = previousTitle;
      printArea.innerHTML = '';
      dynamicPrintStyle.textContent = '';
      window.removeEventListener('afterprint', cleanup);
    }
    window.addEventListener('afterprint', cleanup);

    // Small delay so the layout/style applies before the print dialog opens.
    setTimeout(function () {
      window.print();
      setTimeout(cleanup, 60000); // safety net if afterprint never fires
    }, 30);
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.pdf-btn');
    if (!btn) return;
    exportBranchReportToPdf(btn.getAttribute('data-branch'));
  });

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  function renderAll() {
    document.getElementById('dateFrom').value = state.dateFrom || '';
    document.getElementById('dateTo').value = state.dateTo || '';
    renderLegend();
    renderTableIfActive();
    refreshFilterDirectories();
  }

  checkStorageWorking().then(function (ok) {
    if (!ok) {
      var banner = document.getElementById('storageWarningBanner');
      if (banner) banner.hidden = false;
    }
  });

  load().then(function () {
    initTheme();
    initSupplierMergePanel();
    initSupplierExcludePanel();
    initFilterDropdowns();
    initReportFilterInputs();
    renderAll();
  });
})();
