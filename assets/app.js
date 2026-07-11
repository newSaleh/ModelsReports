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
    hotSoldMin: 5,               // minimum weekly sales in a branch to call it "selling well"
    minBalance: 7,               // current balance below this (while selling well) -> needs a reorder
    opportunityMinTotalSold: 20, // sold this well elsewhere to justify stocking a new branch
    maxBalance: 50               // current balance above this -> flagged as overstock/surplus
  };

  // Default supplier-code merge list (plain reference numbers only, no
  // supplier names or business data) — pre-seeded so it works out of the
  // box; still fully editable/overridable from the "🔗 دمج أكواد الموردين" panel.
  var DEFAULT_SUPPLIER_ALIAS_TEXT = [
    '0180,0252', '0183,0284', '0182,0271', '0160,0202', '0137,0240',
    '0181,0203', '0158,0246', '0145,0253', '0117,0251', '0115,0201',
    '0198,0434', '0317,0459', '0310,0430', '0103,0218', '0306,0416',
    '0309,0444', '0302,0436', '0104,0221', '0318,0230', '0106,0247',
    '0165,0428', '0319,0447', '0161,0401', '0178,0293', '0184,0297',
    '0179,0407', '0159,0402', '0108,0299', '0666,0418', '0666,0999'
  ].join('\n');

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
    supplierAliasText: ''
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
  var statusFilter = 'all';
  var selectedBranch = BRANCHES[0].code;
  var supplierAliasMap = {}; // alias supplier code -> canonical supplier code, derived from supplierAliasText

  // ---------------------------------------------------------------------
  // Supplier code merging — some suppliers have more than one reference
  // code in the source data. The user lists related codes (one pair per
  // line, comma-separated); codes connected across multiple lines (e.g.
  // "0666,0418" then "0666,0999") are grouped transitively into one
  // supplier. The canonical code for each group is whichever member
  // appeared earliest as the first code on its line.
  // ---------------------------------------------------------------------
  function parseSupplierAliasText(text) {
    var adj = {};
    var firstColOrder = [];
    var seenFirstCol = {};
    function addEdge(a, b) {
      adj[a] = adj[a] || {}; adj[a][b] = true;
      adj[b] = adj[b] || {}; adj[b][a] = true;
    }
    (text || '').split('\n').forEach(function (line) {
      var parts = line.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (parts.length < 2) return;
      var a = parts[0];
      for (var i = 1; i < parts.length; i++) addEdge(a, parts[i]);
      if (!seenFirstCol[a]) { seenFirstCol[a] = true; firstColOrder.push(a); }
    });
    var priority = {};
    firstColOrder.forEach(function (c, i) { priority[c] = i; });

    var visited = {};
    var map = {};
    Object.keys(adj).forEach(function (start) {
      if (visited[start]) return;
      var queue = [start], comp = [];
      visited[start] = true;
      while (queue.length) {
        var cur = queue.shift();
        comp.push(cur);
        Object.keys(adj[cur]).forEach(function (n) {
          if (!visited[n]) { visited[n] = true; queue.push(n); }
        });
      }
      var canonical = comp.slice().sort(function (x, y) {
        var px = priority[x] === undefined ? Infinity : priority[x];
        var py = priority[y] === undefined ? Infinity : priority[y];
        if (px !== py) return px - py;
        return x < y ? -1 : (x > y ? 1 : 0);
      })[0];
      comp.forEach(function (c) { if (c !== canonical) map[c] = canonical; });
    });
    return map;
  }

  function rebuildSupplierAliasMap() {
    supplierAliasMap = parseSupplierAliasText(state.supplierAliasText || '');
  }

  function resolveSupplierCode(code) {
    if (!code) return code;
    return supplierAliasMap[code] || code;
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
  // Persistence
  // ---------------------------------------------------------------------
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      flashSaved(true);
    } catch (e) {
      console.warn('save failed', e);
      flashSaved(false);
    }
  }

  var saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 300);
  }

  // Verifies localStorage actually round-trips a value (some browsers accept
  // writes silently in restricted modes — private browsing, storage blocked
  // by policy — without throwing, but never persist them).
  function isStorageWorking() {
    try {
      var testKey = '__storageTest__';
      localStorage.setItem(testKey, '1');
      var ok = localStorage.getItem(testKey) === '1';
      localStorage.removeItem(testKey);
      return ok;
    } catch (e) { return false; }
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

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { console.warn('storage read failed', e); }
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.rows)) {
          state = parsed;
          state.settings = Object.assign({}, DEFAULT_SETTINGS, state.settings || {});
          // Only seed the default merge list if this field has never been
          // saved before — an explicitly-cleared empty string is left alone.
          var seededAlias = false;
          if (state.supplierAliasText == null) { state.supplierAliasText = DEFAULT_SUPPLIER_ALIAS_TEXT; seededAlias = true; }
          state.rows.forEach(function (r) { if (r.excludedFromReport == null) r.excludedFromReport = false; });
          rebuildSupplierAliasMap();
          if (seededAlias) save();
          return;
        }
      } catch (e) { console.warn('bad saved state', e); }
    }
    // No data yet: start empty. The user imports their own weekly Excel file
    // (no sample business data ships with this app).
    state.rows = [];
    state.dateFrom = '';
    state.dateTo = '';
    state.settings = Object.assign({}, DEFAULT_SETTINGS);
    state.supplierAliasText = DEFAULT_SUPPLIER_ALIAS_TEXT;
    rebuildSupplierAliasMap();
    save();
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

  function renderBranchSelect() {
    var el = document.getElementById('branchSelect');
    var opts = BRANCHES.map(function (b) {
      return '<option value="' + b.code + '">' + b.code + ' - ' + b.name + '</option>';
    }).join('');
    opts += '<option value="all">كل الفروع (تقرير شامل)</option>';
    el.innerHTML = opts;
    el.value = selectedBranch;
    el.addEventListener('change', function () {
      selectedBranch = el.value;
      statusFilter = 'all';
      renderDashboard();
    });
  }

  // ---------------------------------------------------------------------
  // Settings panel (user-adjustable "what counts as adequate stock")
  // ---------------------------------------------------------------------
  function initSettingsPanel() {
    var panel = document.getElementById('settingsPanel');
    var toggleBtn = document.getElementById('btnSettingsToggle');
    var hotEl = document.getElementById('setHotSoldMin');
    var minBalEl = document.getElementById('setMinBalance');
    var oppEl = document.getElementById('setOpportunityMin');
    var maxBalEl = document.getElementById('setMaxBalance');

    function syncInputs() {
      hotEl.value = state.settings.hotSoldMin;
      minBalEl.value = state.settings.minBalance;
      oppEl.value = state.settings.opportunityMinTotalSold;
      maxBalEl.value = state.settings.maxBalance;
    }
    syncInputs();

    toggleBtn.addEventListener('click', function () {
      panel.hidden = !panel.hidden;
    });

    function onChange() {
      var hot = Number(hotEl.value); if (!isFinite(hot) || hot < 0) hot = DEFAULT_SETTINGS.hotSoldMin;
      var minBal = Number(minBalEl.value); if (!isFinite(minBal) || minBal < 0) minBal = DEFAULT_SETTINGS.minBalance;
      var opp = Number(oppEl.value); if (!isFinite(opp) || opp < 0) opp = DEFAULT_SETTINGS.opportunityMinTotalSold;
      var maxBal = Number(maxBalEl.value); if (!isFinite(maxBal) || maxBal < 0) maxBal = DEFAULT_SETTINGS.maxBalance;
      if (maxBal < minBal) maxBal = minBal;
      state.settings = { hotSoldMin: hot, minBalance: minBal, opportunityMinTotalSold: opp, maxBalance: maxBal };
      renderDashboard();
      scheduleSave();
    }
    hotEl.addEventListener('change', onChange);
    minBalEl.addEventListener('change', onChange);
    oppEl.addEventListener('change', onChange);
    maxBalEl.addEventListener('change', onChange);

    document.getElementById('btnSettingsReset').addEventListener('click', function () {
      state.settings = Object.assign({}, DEFAULT_SETTINGS);
      syncInputs();
      renderDashboard();
      scheduleSave();
    });
  }

  // ---------------------------------------------------------------------
  // Supplier code merge panel
  // ---------------------------------------------------------------------
  function updateSupplierMergeStatus() {
    var statusEl = document.getElementById('supplierMergeStatus');
    if (!statusEl) return;
    var aliasCodes = Object.keys(supplierAliasMap);
    if (!aliasCodes.length) {
      statusEl.textContent = 'لا يوجد دمج محفوظ بعد.';
      return;
    }
    var groups = {};
    aliasCodes.forEach(function (c) { groups[supplierAliasMap[c]] = true; });
    var groupCount = Object.keys(groups).length;
    statusEl.textContent = 'تم دمج ' + aliasCodes.length + ' كودًا إضافيًا ضمن ' + groupCount + ' مورد.';
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
      renderDashboard();
      renderTableBody();
      scheduleSave();
    });
  }

  // ---------------------------------------------------------------------
  // Exclude-by-supplier-code bar (shown under the classification chips) —
  // typing a supplier reference code moves that supplier's items to
  // "مستبعدة من التقرير" (fully excluded from the report). Scoped to
  // whichever chip is active: a specific classification (e.g. "لا يوجد
  // رصيد") only excludes items currently in that classification; "الكل"
  // excludes every item from that supplier. See updateSupplierExcludeBar()
  // for the dynamic label/enabled-state per the active chip.
  // ---------------------------------------------------------------------
  function initSupplierExcludeBar() {
    var bar = document.getElementById('supplierExcludeBar');
    var input = document.getElementById('supplierExcludeInput');
    var statusEl = document.getElementById('supplierExcludeStatus');
    var btn = document.getElementById('btnSupplierExclude');
    if (!bar || !input || !btn) return;

    function run() {
      var status = bar.getAttribute('data-status');
      if (!status || status === 'excluded' || (status !== 'all' && !STATUS_META[status])) {
        statusEl.textContent = 'اختر تصنيفًا أولًا (أو "الكل").';
        return;
      }
      var code = input.value.trim();
      if (!code) { statusEl.textContent = 'اكتب كود المورد أولًا.'; return; }
      var resolved = resolveSupplierCode(code);

      var matches = status === 'all'
        ? state.rows.filter(function (r) { return !r.excludedFromReport && resolveSupplierCode(r.SupplierCode) === resolved; })
        : computeBranchReportRows(selectedBranch, true)
          .filter(function (d) { return d.status === status && resolveSupplierCode(d.row.SupplierCode) === resolved; })
          .map(function (d) { return d.row; });

      if (!matches.length) {
        statusEl.textContent = status === 'all'
          ? 'لا توجد أصناف غير مستبعدة بهذا الكود.'
          : 'لا توجد أصناف بهذا الكود ضمن هذا التصنيف حاليًا.';
        return;
      }
      matches.forEach(function (r) { r.excludedFromReport = true; });
      var name = matches[0].SupplierName || '';
      statusEl.textContent = 'تم استبعاد ' + matches.length + ' صنف' + (name ? (' — ' + name) : '') + ' (' + resolved + ') إلى "مستبعدة من التقرير".';
      input.value = '';
      renderDashboard();
      renderTableBody();
      scheduleSave();
    }

    btn.addEventListener('click', run);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); run(); }
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
    var hay = (r.SupplierName + ' ' + r.StockGroupName + ' ' + r.StockCode + ' ' + r.ModelCode + ' ' +
      r.SupplierCode + ' ' + resolveSupplierCode(r.SupplierCode)).toLowerCase();
    return hay.indexOf(searchTerm) !== -1;
  }

  function renderTableBody() {
    var tbody = document.getElementById('tableBody');
    var html = '';
    state.rows.forEach(function (r, idx) {
      if (!rowMatchesSearch(r)) return;
      html += '<tr data-idx="' + idx + '"' + (r.excludedFromReport ? ' class="row-excluded"' : '') + '>';
      html += '<td>' + (idx + 1) + '</td>';
      TEXT_FIELDS.forEach(function (f) {
        html += '<td><input class="text-cell" data-field="' + f.key + '" value="' + escapeAttr(r[f.key]) + '"></td>';
      });
      html += '<td><input type="number" step="0.01" data-field="UnitPrice" value="' + (r.UnitPrice || 0) + '"></td>';
      BRANCHES.forEach(function (b) {
        html += '<td class="col-group-branch"><input type="number" data-field="' + branchField(b.code, 'SoldQty') + '" value="' + (r[branchField(b.code, 'SoldQty')] || 0) + '"></td>';
        html += '<td><input type="number" data-field="' + branchField(b.code, 'Balance') + '" value="' + (r[branchField(b.code, 'Balance')] || 0) + '"></td>';
      });
      html += '<td><b>' + r.TotalQtySold + '</b></td>';
      html += '<td><b>' + r.TotalBalance + '</b></td>';
      html += '<td><button class="btn-del-row" data-idx="' + idx + '" title="حذف الصف">✕</button></td>';
      html += '</tr>';
    });
    if (!state.rows.length) {
      html = '<tr><td colspan="' + (2 + TEXT_FIELDS.length + 1 + BRANCHES.length * 2 + 2) + '" class="empty-state">' +
        'لا توجد بيانات بعد. استخدم زر "استيراد Excel" لرفع ملف المبيعات الأسبوعي، أو "نموذج فارغ" لتنزيل قالب فارغ.' +
        '</td></tr>';
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
    renderDashboard();
    scheduleSave();
  });

  document.addEventListener('click', function (e) {
    if (e.target.matches('.btn-del-row')) {
      var idx = Number(e.target.getAttribute('data-idx'));
      if (confirm('حذف هذا الصنف من التقرير؟')) {
        state.rows.splice(idx, 1);
        renderTable();
        renderDashboard();
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
  function computeBranchReportRows(branchCode, includeExcluded) {
    var rows = includeExcluded ? state.rows : reportableRows();
    var settings = state.settings;
    return rows.map(function (r) {
      var soldHere = Number(r[branchField(branchCode, 'SoldQty')]) || 0;
      var balanceHere = Number(r[branchField(branchCode, 'Balance')]) || 0;
      var soldElsewhere = (r.TotalQtySold || 0) - soldHere;
      // "Selling well" looks at total sales across ALL branches (not just
      // this branch or just the others in isolation) so a model that sells
      // steadily split across branches still counts — e.g. 4 here + 14
      // elsewhere clears a threshold of 15 even though neither half alone does.
      var sellingWell = soldHere >= settings.hotSoldMin || (r.TotalQtySold || 0) >= settings.opportunityMinTotalSold;

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
      } else if (sellingWell && balanceHere < settings.minBalance) {
        if (balanceHere === 0) {
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
        status: status, statusLabel: statusLabel
      };
    }).sort(function (a, b) {
      var order = { critical: 0, warning: 1, opportunity: 2, surplus: 3, ok: 4, excluded: 5 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return (b.soldHere + b.soldElsewhere) - (a.soldHere + a.soldElsewhere);
    });
  }

  // ---------------------------------------------------------------------
  // Dashboard: KPIs + charts
  // ---------------------------------------------------------------------
  function renderKpis(branchData) {
    var tiles;
    if (selectedBranch === 'all') {
      var totalSold = 0, totalBalance = 0;
      var rr = reportableRows();
      rr.forEach(function (r) { totalSold += r.TotalQtySold; totalBalance += r.TotalBalance; });
      var top = rr.slice().sort(function (a, b) { return b.TotalQtySold - a.TotalQtySold; })[0];
      var needsOrderAll = 0;
      BRANCHES.forEach(function (b) {
        needsOrderAll += computeBranchReportRows(b.code).filter(function (d) { return d.status === 'critical' || d.status === 'warning'; }).length;
      });
      tiles = [
        { label: 'إجمالي القطع المباعة (كل الفروع)', value: totalSold.toLocaleString('en-US'), sub: (state.dateFrom || '') + ' → ' + (state.dateTo || '') },
        { label: 'إجمالي الرصيد المتبقي', value: totalBalance.toLocaleString('en-US'), sub: rr.length + ' صنف بالتقرير' },
        { label: 'أصناف تحتاج طلبًا فوريًا (كل الفروع)', value: needsOrderAll, sub: 'إجمالي عبر جميع الفروع', critical: needsOrderAll > 0 },
        { label: 'الموديل الأفضل مبيعًا', value: top ? top.ModelCode : '—', sub: top ? (top.TotalQtySold + ' قطعة · ' + (top.StockGroupName || '')) : '' }
      ];
    } else {
      var b = branchByCode(selectedBranch);
      var soldSum = 0, balSum = 0;
      branchData.forEach(function (d) { soldSum += d.soldHere; balSum += d.balanceHere; });
      var needOrder = branchData.filter(function (d) { return d.status === 'critical' || d.status === 'warning'; }).length;
      var topHere = branchData.slice().sort(function (x, y) { return y.soldHere - x.soldHere; })[0];
      tiles = [
        { label: 'مبيعات فرع ' + b.name, value: soldSum.toLocaleString('en-US'), sub: (state.dateFrom || '') + ' → ' + (state.dateTo || '') },
        { label: 'الرصيد الحالي بالفرع', value: balSum.toLocaleString('en-US'), sub: branchData.length + ' صنف بالتقرير' },
        { label: 'أصناف تحتاج طلبًا فوريًا', value: needOrder, sub: 'في فرع ' + b.name, critical: needOrder > 0 },
        { label: 'الأفضل مبيعًا في هذا الفرع', value: (topHere && topHere.soldHere > 0) ? topHere.row.ModelCode : '—', sub: (topHere && topHere.soldHere > 0) ? (topHere.soldHere + ' قطعة · ' + (topHere.row.StockGroupName || '')) : '' }
      ];
    }
    document.getElementById('kpiRow').innerHTML = tiles.map(function (t) {
      return '<div class="kpi-tile' + (t.critical ? ' critical' : '') + '"><div class="kpi-label">' + t.label + '</div>' +
        '<div class="kpi-value">' + t.value + '</div><div class="kpi-sub">' + t.sub + '</div></div>';
    }).join('');
  }

  function barRowHtml(label, value, max, color) {
    var pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 4;
    return '<div class="bar-row" title="' + escapeAttr(label) + '">' +
      '<div class="bar-label">' + escapeAttr(label) + '</div>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
      '<div class="bar-value">' + value.toLocaleString('en-US') + '</div></div>';
  }

  function renderTopModelsChart() {
    var titleEl = document.getElementById('topModelsTitle');
    var useAll = selectedBranch === 'all';
    var b = useAll ? null : branchByCode(selectedBranch);
    titleEl.textContent = useAll ? 'أفضل 10 موديلات مبيعًا (كل الفروع)' : 'أفضل 10 موديلات مبيعًا — فرع ' + b.name;

    var sortKey = useAll ? 'TotalQtySold' : branchField(selectedBranch, 'SoldQty');
    var top = reportableRows().slice().sort(function (x, y) { return (y[sortKey] || 0) - (x[sortKey] || 0); }).slice(0, 10);
    var max = top.length ? (top[0][sortKey] || 0) : 0;
    var html = top.map(function (r) {
      return barRowHtml(r.ModelCode + ' — ' + (r.StockGroupName || ''), r[sortKey] || 0, max, 'var(--series-1)');
    }).join('');
    document.getElementById('chartTopModels').innerHTML = html || '<p class="empty-state">لا توجد بيانات</p>';
  }

  function renderByBranchChart() {
    var rr = reportableRows();
    var totals = BRANCHES.map(function (b) {
      var sum = 0;
      rr.forEach(function (r) { sum += Number(r[branchField(b.code, 'SoldQty')]) || 0; });
      return { branch: b, total: sum };
    });
    var max = Math.max.apply(null, totals.map(function (t) { return t.total; }).concat([0]));
    var html = totals.map(function (t) {
      return barRowHtml(t.branch.code + ' ' + t.branch.name, t.total, max, t.branch.color);
    }).join('');
    html += '<div class="legend-row">' + BRANCHES.map(function (b) {
      return '<div class="legend-item"><span class="swatch" style="background:' + b.color + '"></span>' + b.name + '</div>';
    }).join('') + '</div>';
    document.getElementById('chartByBranch').innerHTML = html;
  }

  // ---------------------------------------------------------------------
  // Branch report table (on-screen)
  // ---------------------------------------------------------------------
  function statusBadgeHtml(status, label) {
    return '<span class="status-label ' + status + '">' + escapeAttr(label) + '</span>';
  }

  function supplierLineHtml(r) {
    if (!r.SupplierName) return '';
    var code = resolveSupplierCode(r.SupplierCode);
    var text = r.SupplierName + (code ? ' (' + code + ')' : '');
    return '<br><span style="color:var(--text-muted);font-size:0.75rem">' + escapeAttr(text) + '</span>';
  }

  function renderBranchReportTable() {
    var titleEl = document.getElementById('branchReportTitle');
    var hintEl = document.getElementById('branchReportHint');
    var filtersEl = document.getElementById('alertFilters');
    var table = document.getElementById('branchReportTable');

    if (selectedBranch === 'all') {
      titleEl.textContent = 'تقرير الفرع التفصيلي';
      hintEl.textContent = 'اختر فرعًا محددًا من القائمة أعلاه لعرض تقريره التفصيلي هنا. تصدير PDF مع اختيار "كل الفروع" سينشئ تقريرًا مستقلاً لكل فرع.';
      filtersEl.innerHTML = '';
      table.querySelector('thead').innerHTML = '';
      table.querySelector('tbody').innerHTML = '';
      updateSupplierExcludeBar(null);
      return;
    }

    var b = branchByCode(selectedBranch);
    titleEl.textContent = 'تقرير فرع ' + b.name + ' (' + b.code + ') — كل صنف على حدة';
    hintEl.textContent = 'لكل صنف: كم بِيع في هذا الفرع، وكم بِيع إجمالًا في باقي الفروع، وهل يحتاج الفرع طلب توريد الآن بناءً على رصيده الحالي.';

    var data = computeBranchReportRows(selectedBranch, true);
    var counts = { all: 0, critical: 0, warning: 0, opportunity: 0, surplus: 0, ok: 0, excluded: 0 };
    data.forEach(function (d) { counts[d.status]++; if (d.status !== 'excluded') counts.all++; });

    var filters = [{ key: 'all', label: 'الكل (' + counts.all + ')' }].concat(
      ['critical', 'warning', 'opportunity', 'surplus', 'ok', 'excluded'].map(function (k) {
        return { key: k, label: STATUS_META[k] + ' (' + counts[k] + ')' };
      })
    );
    var shown = statusFilter === 'all' ? data.filter(function (d) { return d.status !== 'excluded'; }) : data.filter(function (d) { return d.status === statusFilter; });

    var chipsHtml = filters.map(function (f) {
      return '<button class="chip-filter' + (statusFilter === f.key ? ' active' : '') + '" data-filter="' + f.key + '">' + f.label + '</button>';
    }).join('');
    if (statusFilter !== 'all' && statusFilter !== 'excluded' && shown.length) {
      chipsHtml += '<button class="btn btn-danger-ghost bulk-exclude-btn" id="btnBulkExclude">🚫 استبعاد كل هذه الأصناف من التقرير (' + shown.length + ')</button>';
    }
    if (statusFilter === 'excluded' && shown.length) {
      chipsHtml += '<button class="btn btn-ghost bulk-restore-btn" id="btnBulkRestore">↩️ استعادة كل الأصناف المستبعدة (' + shown.length + ')</button>';
    }
    filtersEl.innerHTML = chipsHtml;

    table.querySelector('thead').innerHTML = '<tr>' +
      '<th>الصنف / الموديل</th><th class="num">السعر</th><th class="num">مبيعات ' + b.name + '</th>' +
      '<th class="num">مبيعات باقي الفروع</th><th class="num">الرصيد الحالي</th><th>الحالة</th><th>إجراء</th></tr>';

    var tbody = table.querySelector('tbody');
    if (!shown.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">لا توجد أصناف ضمن هذا التصنيف</td></tr>';
    } else {
      tbody.innerHTML = shown.map(function (d) {
        var r = d.row;
        var ridx = state.rows.indexOf(r);
        var desc = escapeAttr((r.StockGroupName || '') + ' — ' + (r.ModelCode || ''));
        var price = (Number(r.UnitPrice) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        var actionBtn = d.status === 'excluded'
          ? '<button class="row-action-btn restore" data-action="restore" data-ridx="' + ridx + '">استعادة</button>'
          : '<button class="row-action-btn" data-action="exclude" data-ridx="' + ridx + '">استبعاد</button>';
        return '<tr class="row-' + d.status + (d.status === 'excluded' ? ' excluded-row' : '') + '">' +
          '<td>' + desc + supplierLineHtml(r) + '</td>' +
          '<td class="num">' + price + '</td>' +
          '<td class="num">' + d.soldHere + '</td>' +
          '<td class="num">' + d.soldElsewhere + '</td>' +
          '<td class="num">' + d.balanceHere + '</td>' +
          '<td>' + statusBadgeHtml(d.status, d.statusLabel) + '</td>' +
          '<td>' + actionBtn + '</td>' +
          '</tr>';
      }).join('');
    }

    updateSupplierExcludeBar(statusFilter);
  }

  function updateSupplierExcludeBar(status) {
    var bar = document.getElementById('supplierExcludeBar');
    var label = document.getElementById('supplierExcludeLabel');
    var input = document.getElementById('supplierExcludeInput');
    var btn = document.getElementById('btnSupplierExclude');
    if (!bar) return;

    var eligible = !!(status && (status === 'all' || (STATUS_META[status] && status !== 'excluded')));
    bar.classList.toggle('disabled', !eligible);
    input.disabled = !eligible;
    btn.disabled = !eligible;
    bar.setAttribute('data-status', eligible ? status : '');
    label.textContent = !eligible
      ? 'لا يوجد ما يُستبعد ضمن "مستبعدة من التقرير" — اختر تصنيفًا آخر من الأعلى.'
      : status === 'all'
        ? 'استبعاد مورد بالكامل من التقرير — اكتب كود المورد:'
        : 'استبعاد مورد من تصنيف "' + STATUS_META[status] + '" فقط (تنتقل أصنافه إلى "مستبعدة من التقرير") — اكتب كود المورد:';
  }

  document.addEventListener('click', function (e) {
    if (e.target.matches('.chip-filter')) {
      statusFilter = e.target.getAttribute('data-filter');
      renderBranchReportTable();
      return;
    }
    if (e.target.matches('.bulk-exclude-btn')) {
      var matching = computeBranchReportRows(selectedBranch, true).filter(function (d) { return d.status === statusFilter; });
      if (!matching.length) return;
      if (confirm('سيتم استبعاد ' + matching.length + ' صنف من التقرير دفعة واحدة. يمكنك التراجع لاحقًا لكل صنف على حدة. متابعة؟')) {
        matching.forEach(function (d) { d.row.excludedFromReport = true; });
        statusFilter = 'all';
        renderDashboard();
        renderTableBody();
        scheduleSave();
      }
      return;
    }
    if (e.target.matches('.bulk-restore-btn')) {
      var excludedRows = computeBranchReportRows(selectedBranch, true).filter(function (d) { return d.status === 'excluded'; });
      if (!excludedRows.length) return;
      excludedRows.forEach(function (d) { d.row.excludedFromReport = false; });
      statusFilter = 'all';
      renderDashboard();
      renderTableBody();
      scheduleSave();
      return;
    }
    if (e.target.matches('.row-action-btn')) {
      var ridx = Number(e.target.getAttribute('data-ridx'));
      var action = e.target.getAttribute('data-action');
      var row = state.rows[ridx];
      if (!row) return;
      row.excludedFromReport = action === 'exclude';
      renderDashboard();
      renderTableBody();
      scheduleSave();
    }
  });

  function renderDashboard() {
    var branchData = selectedBranch === 'all' ? null : computeBranchReportRows(selectedBranch, true);
    renderKpis(branchData);
    renderTopModelsChart();
    renderByBranchChart();
    renderBranchReportTable();
  }

  // ---------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
      btn.classList.add('active');
      document.getElementById('tab-' + btn.getAttribute('data-tab')).classList.add('active');
    });
  });

  // ---------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------
  document.getElementById('searchBox').addEventListener('input', function (e) {
    searchTerm = e.target.value.trim().toLowerCase();
    renderTableBody();
  });

  // ---------------------------------------------------------------------
  // Date range
  // ---------------------------------------------------------------------
  document.getElementById('dateFrom').addEventListener('change', function (e) { state.dateFrom = e.target.value; scheduleSave(); renderKpis(selectedBranch === 'all' ? null : computeBranchReportRows(selectedBranch, true)); });
  document.getElementById('dateTo').addEventListener('change', function (e) { state.dateTo = e.target.value; scheduleSave(); renderKpis(selectedBranch === 'all' ? null : computeBranchReportRows(selectedBranch, true)); });

  // Open the native calendar picker on a single click anywhere in the field,
  // instead of requiring a precise click on the small calendar icon.
  ['dateFrom', 'dateTo'].forEach(function (id) {
    var el = document.getElementById(id);
    el.addEventListener('click', function () { if (el.showPicker) { try { el.showPicker(); } catch (e) { /* ignore */ } } });
  });

  // ---------------------------------------------------------------------
  // Add row / Reset
  // ---------------------------------------------------------------------
  document.getElementById('btnAddRow').addEventListener('click', function () {
    state.rows.unshift(blankRow());
    renderTable();
    renderDashboard();
    scheduleSave();
    document.querySelector('.tab-btn[data-tab="table"]').click();
  });

  document.getElementById('btnReset').addEventListener('click', function () {
    if (confirm('سيتم مسح كل البيانات الحالية نهائيًا من هذا المتصفح. متابعة؟')) {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { console.warn('storage clear failed', e); }
      state = { rows: [], dateFrom: '', dateTo: '', settings: Object.assign({}, DEFAULT_SETTINGS), supplierAliasText: DEFAULT_SUPPLIER_ALIAS_TEXT };
      rebuildSupplierAliasMap();
      document.getElementById('supplierAliasInput').value = state.supplierAliasText;
      updateSupplierMergeStatus();
      renderAll();
    }
  });

  // ---------------------------------------------------------------------
  // Excel import
  // ---------------------------------------------------------------------
  document.getElementById('btnImport').addEventListener('click', function () {
    document.getElementById('fileInput').click();
  });

  document.getElementById('fileInput').addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (evt) {
      try {
        var data = new Uint8Array(evt.target.result);
        var wb = XLSX.read(data, { type: 'array' });
        var sheet = wb.Sheets[wb.SheetNames[0]];
        var json = XLSX.utils.sheet_to_json(sheet, { defval: 0 });
        var rows = json.filter(function (r) { return r.ModelCode || r.StockCode; }).map(function (r) {
          var row = blankRow();
          TEXT_FIELDS.forEach(function (f) { if (r[f.key] != null) row[f.key] = r[f.key]; });
          row.UnitPrice = Number(r.UnitPrice) || 0;
          BRANCHES.forEach(function (b) {
            row[branchField(b.code, 'SoldQty')] = Number(r[branchField(b.code, 'SoldQty')]) || 0;
            row[branchField(b.code, 'Balance')] = Number(r[branchField(b.code, 'Balance')]) || 0;
          });
          row.excludedFromReport = !!Number(r.Excluded) || false;
          recalcRow(row);
          return row;
        });
        if (!rows.length) {
          alert('لم يتم العثور على بيانات صالحة في هذا الملف. تأكد من أن الأعمدة مطابقة للنموذج.');
          return;
        }
        state.rows = rows;
        renderAll();
        scheduleSave();
      } catch (err) {
        console.error(err);
        alert('تعذّرت قراءة الملف. تأكد من أنه بصيغة Excel صحيحة (xlsx).');
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
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
  // PDF export — rendered from real HTML/CSS via html2canvas so the
  // browser's own (correct) Arabic text shaping and bidi layout is what
  // ends up in the PDF. No manual character reversal, ever. Pages are
  // paginated to real A4 size by measuring actual row heights first, so
  // no row is ever split or clipped across a page boundary.
  // ---------------------------------------------------------------------
  var PDF_FONT_FAMILY = 'NotoNaskhArabicPdf';
  var pdfFontReady = null;
  // Injects the @font-face and waits for it to actually finish loading
  // (data-URI fonts still load asynchronously) before resolving. Measuring
  // row heights before the font is ready would use fallback-font metrics,
  // which can be shorter than the real font and clip the last row of a page.
  function ensurePdfFont() {
    if (pdfFontReady) return pdfFontReady;
    if (!window.NotoNaskhArabicBase64) { pdfFontReady = Promise.resolve(); return pdfFontReady; }
    var style = document.createElement('style');
    style.textContent = '@font-face{font-family:"' + PDF_FONT_FAMILY + '";' +
      'src:url(data:font/ttf;base64,' + window.NotoNaskhArabicBase64 + ') format("truetype");' +
      'font-weight:normal;font-style:normal;}';
    document.head.appendChild(style);
    if (document.fonts && document.fonts.load) {
      pdfFontReady = document.fonts.load('16px "' + PDF_FONT_FAMILY + '"').then(function () {
        return document.fonts.ready;
      }).catch(function () {});
    } else {
      pdfFontReady = Promise.resolve();
    }
    return pdfFontReady;
  }

  // A4 portrait at 96 CSS px/inch (210mm x 297mm).
  var PAGE_W = 794;
  var PAGE_H = 1122;
  var PAGE_PAD_V = 26;
  var HEADER_GAP = 14;   // safety buffer for margin-collapse under the header block
  var FOOTER_CLEARANCE = 26; // reserves room for the in-flow page-number line
  var PAGE_SAFETY = 15;

  function fmtPrice(v) { return (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  // Short one-line labels for the PDF status badge — the on-screen table
  // keeps the longer, more explanatory statusLabel text; the PDF badge
  // just needs the classification name to stay within its column without
  // wrapping (the action, e.g. "اطلب الآن", is implied by the column itself).
  var PDF_STATUS_LABELS = {
    critical: 'لا يوجد رصيد',
    warning: 'رصيد منخفض',
    opportunity: 'فرصة جديدة',
    surplus: 'فائض في المخزون',
    ok: 'المخزون مناسب',
    excluded: 'مستبعد'
  };

  function pdfStatusBadge(status) {
    var label = PDF_STATUS_LABELS[status] || status;
    return '<span class="pdf-status ' + status + '">' + escapeAttr(label) + '</span>';
  }

  function pdfSupplierText(r) {
    if (!r.SupplierName) return '';
    var code = resolveSupplierCode(r.SupplierCode);
    return r.SupplierName + (code ? ' (' + code + ')' : '');
  }

  function pdfColgroupHtml() {
    return '<colgroup>' +
      '<col style="width:22%"><col style="width:27%"><col style="width:8%"><col style="width:9%"><col style="width:10%"><col style="width:9%"><col style="width:15%">' +
      '</colgroup>';
  }

  function pdfTableHeadHtml(branchName) {
    return '<thead><tr>' +
      '<th>الصنف / الموديل</th><th>المورد</th><th class="num">السعر</th><th class="num">مبيعات ' + branchName + '</th>' +
      '<th class="num">مبيعات باقي الفروع</th><th class="num">الرصيد الحالي</th><th>الحالة</th>' +
      '</tr></thead>';
  }

  function pdfRowHtml(d) {
    var r = d.row;
    var desc = escapeAttr((r.StockGroupName || '') + ' — ' + (r.ModelCode || ''));
    return '<tr>' +
      '<td>' + desc + '</td>' +
      '<td class="pdf-supplier-cell">' + escapeAttr(pdfSupplierText(r)) + '</td>' +
      '<td class="num">' + fmtPrice(r.UnitPrice) + '</td>' +
      '<td class="num">' + d.soldHere + '</td>' +
      '<td class="num">' + d.soldElsewhere + '</td>' +
      '<td class="num">' + d.balanceHere + '</td>' +
      '<td>' + pdfStatusBadge(d.status) + '</td>' +
      '</tr>';
  }

  function buildBranchHeaderFirstHtml(branch) {
    return '<div class="pdf-header-block">' +
      '<h1 class="pdf-title">تقرير فرع ' + branch.name + ' (' + branch.code + ')</h1>' +
      '<p class="pdf-sub pdf-meta">الفترة: من ' + (state.dateFrom || '—') + ' إلى ' + (state.dateTo || '—') + ' &nbsp;|&nbsp; تاريخ الإصدار: ' + new Date().toLocaleDateString('en-GB') + '</p>' +
      '<p class="pdf-sub" style="margin:0">مرتب تصاعديًا حسب كود المورد، ثم تنازليًا حسب الكمية المباعة في باقي الفروع</p>' +
      '</div>';
  }

  function buildBranchHeaderRestHtml(branch) {
    return '<div class="pdf-header-block">' +
      '<h1 class="pdf-title" style="font-size:16px;margin-bottom:4px">تقرير فرع ' + branch.name + ' (' + branch.code + ') — تابع</h1>' +
      '<p class="pdf-sub" style="margin:0">الفترة: من ' + (state.dateFrom || '—') + ' إلى ' + (state.dateTo || '—') + '</p>' +
      '</div>';
  }

  // Measures real rendered row heights off-screen, then splits the report
  // into as many exact-A4 pages as needed without ever cutting a row.
  function paginateBranchReport(branch) {
    // Sorted by supplier first — ascending by supplier code (merged-alias
    // suppliers grouped together via their canonical code, lowest code
    // first, e.g. 001 before 002) — then within each supplier by quantity
    // sold in the rest of the branches, descending. This is the printed
    // report's order, independent of the on-screen table's urgency-first
    // ordering.
    var rawData = computeBranchReportRows(branch.code);
    var data = rawData.slice().sort(function (a, b) {
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

    var root = document.getElementById('pdfRoot');
    var pages;

    if (!data.length) {
      pages = [{ isFirst: true, start: 0, end: 0 }];
    } else {
      var measure = document.createElement('div');
      measure.className = 'pdf-page';
      measure.innerHTML =
        '<div class="measure-first">' + buildBranchHeaderFirstHtml(branch) + '</div>' +
        '<div class="measure-rest">' + buildBranchHeaderRestHtml(branch) + '</div>' +
        '<table class="pdf-table">' + pdfColgroupHtml() + pdfTableHeadHtml(branch.name) +
        '<tbody>' + data.map(pdfRowHtml).join('') + '</tbody></table>';
      root.appendChild(measure);

      var headerFirstH = measure.querySelector('.measure-first').getBoundingClientRect().height + HEADER_GAP;
      var headerRestH = measure.querySelector('.measure-rest').getBoundingClientRect().height + HEADER_GAP;
      var theadH = measure.querySelector('thead').getBoundingClientRect().height;
      var rowHeights = Array.prototype.map.call(measure.querySelectorAll('tbody tr'), function (tr) {
        return tr.getBoundingClientRect().height;
      });

      root.removeChild(measure);

      var contentH = PAGE_H - (2 * PAGE_PAD_V) - FOOTER_CLEARANCE - PAGE_SAFETY;
      var budgetFirst = contentH - headerFirstH - theadH;
      var budgetRest = contentH - headerRestH - theadH;

      pages = [];
      var i = 0, isFirst = true;
      while (i < rowHeights.length) {
        var budget = isFirst ? budgetFirst : budgetRest;
        var acc = 0, start = i;
        while (i < rowHeights.length && (i === start || acc + rowHeights[i] <= budget)) {
          acc += rowHeights[i];
          i++;
        }
        pages.push({ isFirst: isFirst, start: start, end: i });
        isFirst = false;
      }
    }

    var totalPages = pages.length;
    return pages.map(function (p, pageIdx) {
      var subset = data.slice(p.start, p.end);
      var headerHtml = p.isFirst ? buildBranchHeaderFirstHtml(branch) : buildBranchHeaderRestHtml(branch);
      var bodyHtml = subset.length
        ? '<table class="pdf-table">' + pdfColgroupHtml() + pdfTableHeadHtml(branch.name) + '<tbody>' + subset.map(pdfRowHtml).join('') + '</tbody></table>'
        : '<p class="pdf-sub">لا توجد أصناف في هذا التقرير (تم استبعاد جميع الأصناف).</p>';
      return '<div class="pdf-page pdf-page-fixed">' + headerHtml + bodyHtml +
        '<div class="pdf-page-num">صفحة ' + (pageIdx + 1) + ' من ' + totalPages + '</div></div>';
    });
  }

  function buildCoverPageHtml(branchesIncluded) {
    var totalSold = 0, totalBalance = 0, totalNeedOrder = 0;
    var branchRowsHtml = branchesIncluded.map(function (b) {
      var sold = 0, bal = 0, needOrder = 0;
      var data = computeBranchReportRows(b.code);
      data.forEach(function (d) {
        sold += d.soldHere; bal += d.balanceHere;
        if (d.status === 'critical' || d.status === 'warning') needOrder++;
      });
      totalSold += sold; totalBalance += bal; totalNeedOrder += needOrder;
      return '<tr><td>' + b.code + ' - ' + b.name + '</td><td class="num">' + sold + '</td><td class="num">' + bal + '</td><td class="num">' + needOrder + '</td></tr>';
    }).join('');
    branchRowsHtml += '<tr style="font-weight:700"><td>الإجمالي</td><td class="num">' + totalSold + '</td><td class="num">' + totalBalance + '</td><td class="num">' + totalNeedOrder + '</td></tr>';

    return '<div class="pdf-page pdf-page-fixed">' +
      '<h1 class="pdf-title">تقرير المبيعات الأسبوعية — جميع الفروع</h1>' +
      '<p class="pdf-sub pdf-meta">الفترة: من ' + (state.dateFrom || '—') + ' إلى ' + (state.dateTo || '—') + ' &nbsp;|&nbsp; تاريخ الإصدار: ' + new Date().toLocaleDateString('en-GB') + '</p>' +
      '<table class="pdf-table"><colgroup><col style="width:40%"><col style="width:20%"><col style="width:20%"><col style="width:20%"></colgroup>' +
      '<thead><tr><th>الفرع</th><th class="num">مباع</th><th class="num">رصيد</th><th class="num">يحتاج طلبًا فوريًا</th></tr></thead>' +
      '<tbody>' + branchRowsHtml + '</tbody></table>' +
      '<p class="pdf-footer">الصفحات التالية: تقرير تفصيلي مستقل لكل فرع، مرتب تصاعديًا حسب كود المورد، ثم تنازليًا حسب الكمية المباعة في باقي الفروع</p>' +
      '</div>';
  }

  function captureElementToImage(el) {
    // JPEG at this scale/quality keeps text crisp while cutting file size by
    // roughly two orders of magnitude vs. lossless PNG (which was ~20MB per
    // page) — important since reports get shared over mobile data.
    return html2canvas(el, { scale: 1.5, backgroundColor: '#ffffff', useCORS: true }).then(function (canvas) {
      return { dataUrl: canvas.toDataURL('image/jpeg', 0.8) };
    });
  }

  function setBusy(isBusy) {
    var el = document.getElementById('busyIndicator');
    el.classList.toggle('show', isBusy);
    document.getElementById('btnExportPdf').disabled = isBusy;
  }

  document.getElementById('btnExportPdf').addEventListener('click', function () {
    generatePdf();
  });

  function generatePdf() {
    if (!reportableRows().length) {
      alert('لا توجد بيانات لتصديرها بعد (أو كل الأصناف مستبعدة من التقرير).');
      return;
    }
    setBusy(true);

    var root = document.getElementById('pdfRoot');
    root.innerHTML = '';

    ensurePdfFont().then(function () {
      var branchesIncluded = selectedBranch === 'all' ? BRANCHES : [branchByCode(selectedBranch)];

      // Built only after the font is confirmed loaded, so the row-height
      // measurements inside paginateBranchReport use the real metrics.
      var pageHtmlList = [];
      if (selectedBranch === 'all') pageHtmlList.push(buildCoverPageHtml(branchesIncluded));
      branchesIncluded.forEach(function (b) {
        pageHtmlList = pageHtmlList.concat(paginateBranchReport(b));
      });

      var jsPDF = window.jspdf.jsPDF;
      var doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      var pageWpt = doc.internal.pageSize.getWidth();
      var pageHpt = doc.internal.pageSize.getHeight();

      // Render + capture pages sequentially (each page is injected, captured,
      // then removed) so we never hold more than one heavy page in the DOM.
      var chain = Promise.resolve();
      pageHtmlList.forEach(function (html, i) {
        chain = chain.then(function () {
          var wrapper = document.createElement('div');
          wrapper.innerHTML = html;
          var pageEl = wrapper.firstChild;
          pageEl.style.fontFamily = '"' + PDF_FONT_FAMILY + '", system-ui, sans-serif';
          root.appendChild(pageEl);
          return captureElementToImage(pageEl).then(function (img) {
            root.removeChild(pageEl);
            if (i > 0) doc.addPage();
            doc.addImage(img.dataUrl, 'JPEG', 0, 0, pageWpt, pageHpt);
          });
        });
      });

      return chain.then(function () {
        var scopeLabel = selectedBranch === 'all' ? 'كل-الفروع' : (branchByCode(selectedBranch).code + '-' + branchByCode(selectedBranch).name);
        var fname = 'تقرير-' + scopeLabel + '-' + (state.dateFrom || '') + '_' + (state.dateTo || '') + '.pdf';
        doc.save(fname);
      });
    }).then(function () {
      setBusy(false);
    }).catch(function (err) {
      console.error(err);
      alert('تعذّر إنشاء ملف PDF. حاول مرة أخرى.');
      setBusy(false);
    });
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  function renderAll() {
    document.getElementById('dateFrom').value = state.dateFrom || '';
    document.getElementById('dateTo').value = state.dateTo || '';
    renderLegend();
    renderTable();
    renderDashboard();
  }

  if (!isStorageWorking()) {
    var banner = document.getElementById('storageWarningBanner');
    if (banner) banner.hidden = false;
  }

  load();
  initTheme();
  renderBranchSelect();
  initSettingsPanel();
  initSupplierMergePanel();
  initSupplierExcludeBar();
  renderAll();
})();
