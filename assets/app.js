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

  // Thresholds for the branch-strength assessment
  var HOT_SOLD_MIN = 5;          // minimum weekly sales in a branch to call it "selling well"
  var CRITICAL_WEEKS_LEFT = 1;   // less than this many weeks of cover -> needs a reorder
  var OPPORTUNITY_MIN_TOTAL_SOLD = 15; // sold this well elsewhere to justify stocking a new branch

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
    dateTo: ''
  };

  var searchTerm = '';
  var statusFilter = 'all';
  var selectedBranch = BRANCHES[0].code;

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

  // ---------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      flashSaved();
    } catch (e) { console.warn('save failed', e); }
  }

  var saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 300);
  }

  function flashSaved() {
    var el = document.getElementById('saveIndicator');
    el.classList.add('show');
    clearTimeout(flashSaved._t);
    flashSaved._t = setTimeout(function () { el.classList.remove('show'); }, 1200);
  }

  function load() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.rows)) {
          state = parsed;
          return;
        }
      } catch (e) { console.warn('bad saved state', e); }
    }
    // No data yet: start empty. The user imports their own weekly Excel file
    // (no sample business data ships with this app).
    state.rows = [];
    state.dateFrom = '';
    state.dateTo = '';
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
    var hay = (r.SupplierName + ' ' + r.StockGroupName + ' ' + r.StockCode + ' ' + r.ModelCode + ' ' + r.SupplierCode).toLowerCase();
    return hay.indexOf(searchTerm) !== -1;
  }

  function renderTableBody() {
    var tbody = document.getElementById('tableBody');
    var html = '';
    state.rows.forEach(function (r, idx) {
      if (!rowMatchesSearch(r)) return;
      html += '<tr data-idx="' + idx + '">';
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
  function computeBranchReportRows(branchCode) {
    return state.rows.map(function (r) {
      var soldHere = Number(r[branchField(branchCode, 'SoldQty')]) || 0;
      var balanceHere = Number(r[branchField(branchCode, 'Balance')]) || 0;
      var soldElsewhere = (r.TotalQtySold || 0) - soldHere;
      var weeksLeft = soldHere > 0 ? balanceHere / soldHere : (balanceHere > 0 ? Infinity : 0);
      var sellingWell = soldHere >= HOT_SOLD_MIN || soldElsewhere >= OPPORTUNITY_MIN_TOTAL_SOLD;

      var status, statusLabel;
      if (sellingWell && weeksLeft < CRITICAL_WEEKS_LEFT) {
        if (balanceHere === 0) {
          status = 'critical';
          statusLabel = 'لا يوجد رصيد — اطلب الآن';
        } else {
          status = 'warning';
          statusLabel = 'رصيد منخفض — اطلب الآن';
        }
      } else if (soldElsewhere >= OPPORTUNITY_MIN_TOTAL_SOLD && soldHere === 0 && balanceHere === 0) {
        status = 'opportunity';
        statusLabel = 'موديل ناجح — غير متوفر لديك';
      } else {
        status = 'ok';
        statusLabel = 'المخزون مناسب';
      }

      return {
        row: r, soldHere: soldHere, soldElsewhere: soldElsewhere, balanceHere: balanceHere,
        weeksLeft: weeksLeft, status: status, statusLabel: statusLabel
      };
    }).sort(function (a, b) {
      var order = { critical: 0, warning: 1, opportunity: 2, ok: 3 };
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
      state.rows.forEach(function (r) { totalSold += r.TotalQtySold; totalBalance += r.TotalBalance; });
      var top = state.rows.slice().sort(function (a, b) { return b.TotalQtySold - a.TotalQtySold; })[0];
      var needsOrderAll = 0;
      BRANCHES.forEach(function (b) {
        needsOrderAll += computeBranchReportRows(b.code).filter(function (d) { return d.status === 'critical' || d.status === 'warning'; }).length;
      });
      tiles = [
        { label: 'إجمالي القطع المباعة (كل الفروع)', value: totalSold.toLocaleString('en-US'), sub: (state.dateFrom || '') + ' → ' + (state.dateTo || '') },
        { label: 'إجمالي الرصيد المتبقي', value: totalBalance.toLocaleString('en-US'), sub: state.rows.length + ' صنف' },
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
        { label: 'الرصيد الحالي بالفرع', value: balSum.toLocaleString('en-US'), sub: state.rows.length + ' صنف' },
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
    var top = state.rows.slice().sort(function (x, y) { return (y[sortKey] || 0) - (x[sortKey] || 0); }).slice(0, 10);
    var max = top.length ? (top[0][sortKey] || 0) : 0;
    var html = top.map(function (r) {
      return barRowHtml(r.ModelCode + ' — ' + (r.StockGroupName || ''), r[sortKey] || 0, max, 'var(--series-1)');
    }).join('');
    document.getElementById('chartTopModels').innerHTML = html || '<p class="empty-state">لا توجد بيانات</p>';
  }

  function renderByBranchChart() {
    var totals = BRANCHES.map(function (b) {
      var sum = 0;
      state.rows.forEach(function (r) { sum += Number(r[branchField(b.code, 'SoldQty')]) || 0; });
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
      return;
    }

    var b = branchByCode(selectedBranch);
    titleEl.textContent = 'تقرير فرع ' + b.name + ' (' + b.code + ') — كل صنف على حدة';
    hintEl.textContent = 'لكل صنف: كم بِيع في هذا الفرع، وكم بِيع إجمالًا في باقي الفروع، وهل يحتاج الفرع طلب توريد الآن بناءً على رصيده الحالي.';

    var data = computeBranchReportRows(selectedBranch);
    var counts = { all: data.length, critical: 0, warning: 0, opportunity: 0, ok: 0 };
    data.forEach(function (d) { counts[d.status]++; });

    var filters = [
      { key: 'all', label: 'الكل (' + counts.all + ')' },
      { key: 'critical', label: '🔴 لا يوجد رصيد (' + counts.critical + ')' },
      { key: 'warning', label: '🟡 رصيد منخفض (' + counts.warning + ')' },
      { key: 'opportunity', label: '🟢 فرصة جديدة (' + counts.opportunity + ')' },
      { key: 'ok', label: 'مخزون مناسب (' + counts.ok + ')' }
    ];
    filtersEl.innerHTML = filters.map(function (f) {
      return '<button class="chip-filter' + (statusFilter === f.key ? ' active' : '') + '" data-filter="' + f.key + '">' + f.label + '</button>';
    }).join('');

    table.querySelector('thead').innerHTML = '<tr>' +
      '<th>الصنف / الموديل</th><th class="num">السعر</th><th class="num">مبيعات ' + b.name + '</th>' +
      '<th class="num">مبيعات باقي الفروع</th><th class="num">الرصيد الحالي</th><th>الحالة</th></tr>';

    var shown = statusFilter === 'all' ? data : data.filter(function (d) { return d.status === statusFilter; });
    var tbody = table.querySelector('tbody');
    if (!shown.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">لا توجد أصناف ضمن هذا التصنيف</td></tr>';
    } else {
      tbody.innerHTML = shown.map(function (d) {
        var r = d.row;
        var desc = escapeAttr((r.StockGroupName || '') + ' — ' + (r.ModelCode || ''));
        var supplier = r.SupplierName ? '<br><span style="color:var(--text-muted);font-size:0.75rem">' + escapeAttr(r.SupplierName) + '</span>' : '';
        var price = (Number(r.UnitPrice) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return '<tr class="row-' + d.status + '">' +
          '<td>' + desc + supplier + '</td>' +
          '<td class="num">' + price + '</td>' +
          '<td class="num">' + d.soldHere + '</td>' +
          '<td class="num">' + d.soldElsewhere + '</td>' +
          '<td class="num">' + d.balanceHere + '</td>' +
          '<td>' + statusBadgeHtml(d.status, d.statusLabel) + '</td>' +
          '</tr>';
      }).join('');
    }
  }

  document.addEventListener('click', function (e) {
    if (e.target.matches('.chip-filter')) {
      statusFilter = e.target.getAttribute('data-filter');
      renderBranchReportTable();
    }
  });

  function renderDashboard() {
    var branchData = selectedBranch === 'all' ? null : computeBranchReportRows(selectedBranch);
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
  document.getElementById('dateFrom').addEventListener('change', function (e) { state.dateFrom = e.target.value; scheduleSave(); renderKpis(selectedBranch === 'all' ? null : computeBranchReportRows(selectedBranch)); });
  document.getElementById('dateTo').addEventListener('change', function (e) { state.dateTo = e.target.value; scheduleSave(); renderKpis(selectedBranch === 'all' ? null : computeBranchReportRows(selectedBranch)); });

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
      localStorage.removeItem(STORAGE_KEY);
      state = { rows: [], dateFrom: '', dateTo: '' };
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
    cols.push('TotalQtySold', 'TotalBalance');
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
      cols.forEach(function (c) { o[c] = r[c]; });
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
  // ends up in the PDF. No manual character reversal, ever.
  // ---------------------------------------------------------------------
  var PDF_FONT_FAMILY = 'NotoNaskhArabicPdf';
  var fontInjected = false;
  function injectPdfFont() {
    if (fontInjected || !window.NotoNaskhArabicBase64) return;
    var style = document.createElement('style');
    style.textContent = '@font-face{font-family:"' + PDF_FONT_FAMILY + '";' +
      'src:url(data:font/ttf;base64,' + window.NotoNaskhArabicBase64 + ') format("truetype");' +
      'font-weight:normal;font-style:normal;}';
    document.head.appendChild(style);
    fontInjected = true;
  }

  function fmtPrice(v) { return (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function pdfStatusBadge(status, label) {
    return '<span class="pdf-status ' + status + '">' + escapeAttr(label) + '</span>';
  }

  function buildBranchPageHtml(branch) {
    var data = computeBranchReportRows(branch.code);
    var soldSum = 0, balSum = 0;
    data.forEach(function (d) { soldSum += d.soldHere; balSum += d.balanceHere; });
    var needOrder = data.filter(function (d) { return d.status === 'critical' || d.status === 'warning'; }).length;

    var rowsHtml = data.map(function (d) {
      var r = d.row;
      var desc = escapeAttr((r.StockGroupName || '') + ' — ' + (r.ModelCode || ''));
      var supplier = r.SupplierName ? '<div style="color:#777;font-size:11px;margin-top:2px">' + escapeAttr(r.SupplierName) + '</div>' : '';
      return '<tr>' +
        '<td>' + desc + supplier + '</td>' +
        '<td class="num">' + fmtPrice(r.UnitPrice) + '</td>' +
        '<td class="num">' + d.soldHere + '</td>' +
        '<td class="num">' + d.soldElsewhere + '</td>' +
        '<td class="num">' + d.balanceHere + '</td>' +
        '<td>' + pdfStatusBadge(d.status, d.statusLabel) + '</td>' +
        '</tr>';
    }).join('');

    return '<div class="pdf-page">' +
      '<h1 class="pdf-title">تقرير فرع ' + branch.name + ' (' + branch.code + ')</h1>' +
      '<p class="pdf-sub pdf-meta">الفترة: من ' + (state.dateFrom || '—') + ' إلى ' + (state.dateTo || '—') + ' &nbsp;|&nbsp; تاريخ الإصدار: ' + new Date().toLocaleDateString('en-GB') + '</p>' +
      '<div class="pdf-kpis">' +
      '<div class="pdf-kpi"><div class="l">إجمالي مبيعات الفرع</div><div class="v">' + soldSum + '</div></div>' +
      '<div class="pdf-kpi"><div class="l">إجمالي الرصيد الحالي</div><div class="v">' + balSum + '</div></div>' +
      '<div class="pdf-kpi"><div class="l">أصناف تحتاج طلبًا فوريًا</div><div class="v">' + needOrder + '</div></div>' +
      '<div class="pdf-kpi"><div class="l">عدد الأصناف</div><div class="v">' + data.length + '</div></div>' +
      '</div>' +
      '<table class="pdf-table"><colgroup>' +
      '<col style="width:32%"><col style="width:10%"><col style="width:13%"><col style="width:15%"><col style="width:12%"><col style="width:18%">' +
      '</colgroup><thead><tr>' +
      '<th>الصنف / الموديل</th><th class="num">السعر</th><th class="num">مبيعات ' + branch.name + '</th>' +
      '<th class="num">مبيعات باقي الفروع</th><th class="num">الرصيد الحالي</th><th>الحالة</th>' +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table>' +
      '<p class="pdf-footer">تقرير فرع ' + branch.name + ' — مرتب من الأكثر إلحاحًا إلى الأقل</p>' +
      '</div>';
  }

  function buildCoverPageHtml(branchesIncluded) {
    var totalSold = 0, totalBalance = 0;
    state.rows.forEach(function (r) { totalSold += r.TotalQtySold; totalBalance += r.TotalBalance; });

    var branchRowsHtml = branchesIncluded.map(function (b) {
      var sold = 0, bal = 0, needOrder = 0;
      var data = computeBranchReportRows(b.code);
      data.forEach(function (d) {
        sold += d.soldHere; bal += d.balanceHere;
        if (d.status === 'critical' || d.status === 'warning') needOrder++;
      });
      return '<tr><td>' + b.code + ' - ' + b.name + '</td><td class="num">' + sold + '</td><td class="num">' + bal + '</td><td class="num">' + needOrder + '</td></tr>';
    }).join('');

    return '<div class="pdf-page">' +
      '<h1 class="pdf-title">تقرير المبيعات الأسبوعية — جميع الفروع</h1>' +
      '<p class="pdf-sub pdf-meta">الفترة: من ' + (state.dateFrom || '—') + ' إلى ' + (state.dateTo || '—') + ' &nbsp;|&nbsp; تاريخ الإصدار: ' + new Date().toLocaleDateString('en-GB') + '</p>' +
      '<div class="pdf-kpis">' +
      '<div class="pdf-kpi"><div class="l">إجمالي القطع المباعة</div><div class="v">' + totalSold + '</div></div>' +
      '<div class="pdf-kpi"><div class="l">إجمالي الرصيد المتبقي</div><div class="v">' + totalBalance + '</div></div>' +
      '<div class="pdf-kpi"><div class="l">عدد الأصناف</div><div class="v">' + state.rows.length + '</div></div>' +
      '</div>' +
      '<table class="pdf-table"><colgroup><col style="width:40%"><col style="width:20%"><col style="width:20%"><col style="width:20%"></colgroup>' +
      '<thead><tr><th>الفرع</th><th class="num">مباع</th><th class="num">رصيد</th><th class="num">يحتاج طلبًا فوريًا</th></tr></thead>' +
      '<tbody>' + branchRowsHtml + '</tbody></table>' +
      '<p class="pdf-footer">الصفحات التالية: تقرير تفصيلي مستقل لكل فرع</p>' +
      '</div>';
  }

  function captureElementToImage(el) {
    return html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true }).then(function (canvas) {
      return {
        dataUrl: canvas.toDataURL('image/jpeg', 0.92),
        widthPx: canvas.width,
        heightPx: canvas.height
      };
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
    if (!state.rows.length) {
      alert('لا توجد بيانات لتصديرها بعد.');
      return;
    }
    injectPdfFont();
    setBusy(true);

    var root = document.getElementById('pdfRoot');
    root.innerHTML = '';

    var branchesIncluded = selectedBranch === 'all' ? BRANCHES : [branchByCode(selectedBranch)];

    var pageBuilders = [];
    if (selectedBranch === 'all') pageBuilders.push(function () { return buildCoverPageHtml(branchesIncluded); });
    branchesIncluded.forEach(function (b) {
      pageBuilders.push(function () { return buildBranchPageHtml(b); });
    });

    var jsPDF = window.jspdf.jsPDF;
    var doc = null;
    var PT_PER_PX = 72 / 96;

    // Render + capture pages sequentially (each page is injected, measured,
    // captured, then removed) so we never hold more than one heavy page in the DOM.
    var chain = Promise.resolve();
    pageBuilders.forEach(function (buildFn, i) {
      chain = chain.then(function () {
        var wrapper = document.createElement('div');
        wrapper.innerHTML = buildFn();
        var pageEl = wrapper.firstChild;
        pageEl.style.fontFamily = '"' + PDF_FONT_FAMILY + '", system-ui, sans-serif';
        root.appendChild(pageEl);
        return captureElementToImage(pageEl).then(function (img) {
          root.removeChild(pageEl);
          var wPt = img.widthPx * PT_PER_PX / 2; // divide by html2canvas scale factor
          var hPt = img.heightPx * PT_PER_PX / 2;
          if (!doc) {
            doc = new jsPDF({ orientation: wPt > hPt ? 'l' : 'p', unit: 'pt', format: [wPt, hPt] });
          } else {
            doc.addPage([wPt, hPt], wPt > hPt ? 'l' : 'p');
          }
          doc.addImage(img.dataUrl, 'JPEG', 0, 0, wPt, hPt);
        });
      });
    });

    chain.then(function () {
      var scopeLabel = selectedBranch === 'all' ? 'كل-الفروع' : (branchByCode(selectedBranch).code + '-' + branchByCode(selectedBranch).name);
      var fname = 'تقرير-' + scopeLabel + '-' + (state.dateFrom || '') + '_' + (state.dateTo || '') + '.pdf';
      doc.save(fname);
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

  load();
  renderBranchSelect();
  renderAll();
})();
