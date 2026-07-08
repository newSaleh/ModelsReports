import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.mjs';

var THEME_KEY = 'modelsReportTheme';

// A page counts as "real text" if it has at least this many non-whitespace
// characters — below that, scanned/image pages tend to yield only a stray
// watermark or nothing, so we fall back to OCR instead of trusting it.
var MIN_TEXT_CHARS = 25;
var OCR_SCALE = 2.2; // render scale for OCR — higher than screen-res improves accuracy

// Caps how many OCR workers run at once. More workers means more pages
// recognized in parallel (real speedup, since each runs on its own thread),
// but each one loads its own copy of the wasm engine + language data, so we
// cap it well below hardwareConcurrency to keep memory reasonable.
var MAX_OCR_WORKERS = 4;

var state = {
  file: null,
  pdf: null,
  busy: false
};

// ---------------------------------------------------------------------
// Theme (shared with the sales-report page, same storage key)
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
(function initTheme() {
  var saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* ignore */ }
  if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
  renderThemeButton();
  document.getElementById('btnTheme').addEventListener('click', function () {
    setTheme(getCurrentTheme() === 'dark' ? 'light' : 'dark');
  });
})();

// ---------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------
var dropEl = document.getElementById('pxtDrop');
var fileInput = document.getElementById('pxtFileInput');
var fileNameEl = document.getElementById('pxtFileName');
var btnExtract = document.getElementById('btnExtract');
var btnCopyAll = document.getElementById('btnCopyAll');
var btnDownloadTxt = document.getElementById('btnDownloadTxt');
var btnClear = document.getElementById('btnClear');
var ocrLangSelect = document.getElementById('pxtOcrLang');
var forceOcrCheckbox = document.getElementById('pxtForceOcr');
var progressWrap = document.getElementById('pxtProgressWrap');
var progressText = document.getElementById('pxtProgressText');
var progressPct = document.getElementById('pxtProgressPct');
var progressFill = document.getElementById('pxtProgressFill');
var badgesEl = document.getElementById('pxtPageBadges');
var outputEl = document.getElementById('pxtOutput');

// ---------------------------------------------------------------------
// File selection (click / drag & drop)
// ---------------------------------------------------------------------
function setFile(file) {
  if (!file) return;
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) {
    alert('الرجاء اختيار ملف PDF فقط.');
    return;
  }
  state.file = file;
  fileNameEl.textContent = file.name;
  btnExtract.disabled = false;
}

dropEl.addEventListener('click', function () { fileInput.click(); });
dropEl.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener('change', function (e) {
  setFile(e.target.files[0]);
  e.target.value = '';
});
['dragenter', 'dragover'].forEach(function (evt) {
  dropEl.addEventListener(evt, function (e) {
    e.preventDefault();
    dropEl.classList.add('drag-over');
  });
});
['dragleave', 'drop'].forEach(function (evt) {
  dropEl.addEventListener(evt, function (e) {
    e.preventDefault();
    dropEl.classList.remove('drag-over');
  });
});
dropEl.addEventListener('drop', function (e) {
  var file = e.dataTransfer.files && e.dataTransfer.files[0];
  setFile(file);
});

// ---------------------------------------------------------------------
// Progress helpers
// ---------------------------------------------------------------------
function setProgress(text, pct) {
  progressWrap.classList.add('show');
  progressText.textContent = text;
  var p = Math.max(0, Math.min(100, Math.round(pct)));
  progressPct.textContent = p + '%';
  progressFill.style.width = p + '%';
}
function hideProgress() {
  progressWrap.classList.remove('show');
}

function renderBadges(pages) {
  badgesEl.innerHTML = pages.map(function (p, idx) {
    var cls = p.mode === 'text' ? 'mode-text' : p.mode === 'ocr' ? 'mode-ocr' : p.mode === 'processing' ? 'mode-ocr mode-processing' : 'mode-pending';
    var label = p.mode === 'text' ? 'صفحة ' + (idx + 1) + ' — نص مباشر'
      : p.mode === 'ocr' ? 'صفحة ' + (idx + 1) + ' — OCR'
      : p.mode === 'processing' ? 'صفحة ' + (idx + 1) + ' — جارٍ OCR...'
      : 'صفحة ' + (idx + 1) + ' — بانتظار المعالجة';
    return '<span class="pxt-page-badge ' + cls + '">' + label + '</span>';
  }).join('');
}

// ---------------------------------------------------------------------
// Text extraction per page
// ---------------------------------------------------------------------
function extractPageText(page) {
  return page.getTextContent().then(function (content) {
    var parts = [];
    var lastY = null;
    content.items.forEach(function (item) {
      if (lastY !== null && item.transform && Math.abs(item.transform[5] - lastY) > 1) {
        parts.push('\n');
      }
      parts.push(item.str);
      if (item.hasEOL) parts.push('\n');
      lastY = item.transform ? item.transform[5] : lastY;
    });
    return parts.join('');
  });
}

function renderPageToCanvas(page) {
  var viewport = page.getViewport({ scale: OCR_SCALE });
  var canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  var ctx = canvas.getContext('2d');
  return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
    return canvas;
  });
}

// Builds a scheduler with several OCR workers so multiple pages recognize
// in parallel (each worker is its own thread) instead of one at a time.
// `output: {text: true}` (no hocr/tsv/blocks) skips work Tesseract would
// otherwise do to build those extra formats, which noticeably speeds up
// every single recognize() call regardless of parallelism.
function createOcrPool(lang, numWorkers) {
  var scheduler = window.Tesseract.createScheduler();
  var workerPromises = [];
  for (var i = 0; i < numWorkers; i++) {
    workerPromises.push(window.Tesseract.createWorker(lang, 1, {
      workerPath: 'vendor/tesseract/worker.min.js',
      corePath: 'vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
      langPath: 'vendor/tessdata'
    }));
  }
  return Promise.all(workerPromises).then(function (workers) {
    workers.forEach(function (w) { scheduler.addWorker(w); });
    return scheduler;
  });
}

// ---------------------------------------------------------------------
// Main extraction flow
// ---------------------------------------------------------------------
function buildFinalText(pages) {
  return pages.map(function (p, idx) {
    var body = (p.text || '').replace(/\s+$/g, '').replace(/^\s+/g, '');
    return body + '\n\n— صفحة ' + (idx + 1) + ' —\n';
  }).join('\n');
}

function setBusy(busy) {
  state.busy = busy;
  btnExtract.disabled = busy || !state.file;
  btnClear.disabled = busy && !state.file;
  dropEl.style.pointerEvents = busy ? 'none' : '';
}

// Runs `iterator` over `items` with at most `limit` in flight at once —
// keeps OCR canvas rendering paced to what the worker pool can actually
// consume, instead of rendering every page's bitmap up front.
function runWithConcurrency(items, limit, iterator) {
  return new Promise(function (resolve, reject) {
    var results = new Array(items.length);
    var next = 0, active = 0, done = 0;
    if (!items.length) { resolve(results); return; }
    function pump() {
      while (active < limit && next < items.length) {
        (function (idx) {
          active++;
          iterator(items[idx], idx).then(function (val) {
            results[idx] = val;
            active--; done++;
            if (done === items.length) resolve(results);
            else pump();
          }, reject);
        })(next);
        next++;
      }
    }
    pump();
  });
}

btnExtract.addEventListener('click', function () {
  if (!state.file || state.busy) return;
  runExtraction();
});

function runExtraction() {
  setBusy(true);
  btnCopyAll.disabled = true;
  btnDownloadTxt.disabled = true;
  outputEl.value = '';
  badgesEl.innerHTML = '';
  setProgress('جارٍ فتح الملف...', 0);

  var forceOcr = forceOcrCheckbox.checked;
  var ocrLang = ocrLangSelect.value;
  var scheduler = null;

  state.file.arrayBuffer().then(function (buf) {
    return pdfjsLib.getDocument({ data: buf }).promise;
  }).then(function (pdf) {
    state.pdf = pdf;
    var numPages = pdf.numPages;
    var pages = [];
    var pageObjs = [];
    for (var i = 0; i < numPages; i++) pages.push({ mode: 'pending', text: '' });
    renderBadges(pages);
    setProgress('جارٍ قراءة نص الصفحات...', 5);

    // Pass 1: pull the real text layer out of every page at once (cheap —
    // no rendering or OCR yet), so pages that already have text skip OCR
    // entirely and only the ones that need it move on to pass 2.
    var pageNums = [];
    for (var n = 1; n <= numPages; n++) pageNums.push(n);

    return Promise.all(pageNums.map(function (pageNum) {
      return pdf.getPage(pageNum).then(function (page) {
        pageObjs[pageNum - 1] = page;
        return extractPageText(page).then(function (text) {
          var meaningfulLen = text.replace(/\s/g, '').length;
          if (!forceOcr && meaningfulLen >= MIN_TEXT_CHARS) {
            pages[pageNum - 1] = { mode: 'text', text: text };
          }
          renderBadges(pages);
        });
      });
    })).then(function () {
      var ocrPageNums = [];
      for (var i = 0; i < numPages; i++) if (pages[i].mode === 'pending') ocrPageNums.push(i + 1);

      if (!ocrPageNums.length) return pages;

      // Pass 2: OCR only the pages that need it, spread across several
      // parallel workers (real threads) instead of one page at a time.
      var numWorkers = Math.max(1, Math.min(MAX_OCR_WORKERS, ocrPageNums.length, navigator.hardwareConcurrency || 4));
      setProgress('جارٍ تحضير OCR (' + numWorkers + ' معالجات متوازية)...', 8);

      return createOcrPool(ocrLang, numWorkers).then(function (s) {
        scheduler = s;
        var total = ocrPageNums.length;
        var completed = 0;
        return runWithConcurrency(ocrPageNums, numWorkers, function (pageNum) {
          pages[pageNum - 1] = { mode: 'processing', text: '' };
          renderBadges(pages);
          return renderPageToCanvas(pageObjs[pageNum - 1]).then(function (canvas) {
            // Skipping hocr/tsv/blocks output makes each recognize() call
            // noticeably faster since Tesseract doesn't build those extra
            // formats — we only ever use the plain text.
            return scheduler.addJob('recognize', canvas, {}, { text: true, blocks: false, hocr: false, tsv: false });
          }).then(function (result) {
            pages[pageNum - 1] = { mode: 'ocr', text: result.data.text };
            completed++;
            renderBadges(pages);
            setProgress('OCR: تمت معالجة ' + completed + ' من ' + total + ' صفحة تحتاج تعرفًا ضوئيًا...', 10 + (completed / total) * 85);
          });
        });
      }).then(function () { return pages; });
    });
  }).then(function (pages) {
    var finalText = buildFinalText(pages);
    outputEl.value = finalText;
    setProgress('تم الانتهاء من استخراج ' + pages.length + ' صفحة', 100);
    setTimeout(hideProgress, 1500);
    btnCopyAll.disabled = false;
    btnDownloadTxt.disabled = false;
    btnClear.disabled = false;
  }).catch(function (err) {
    console.error(err);
    hideProgress();
    alert('تعذّرت معالجة هذا الملف. تأكد من أنه ملف PDF صالح.');
  }).then(function () {
    if (scheduler) scheduler.terminate();
    setBusy(false);
  });
}

// ---------------------------------------------------------------------
// Copy / download / clear
// ---------------------------------------------------------------------
btnCopyAll.addEventListener('click', function () {
  if (!outputEl.value) return;
  navigator.clipboard.writeText(outputEl.value).then(function () {
    var original = btnCopyAll.textContent;
    btnCopyAll.textContent = 'تم النسخ ✓';
    setTimeout(function () { btnCopyAll.textContent = original; }, 1200);
  }).catch(function () {
    outputEl.select();
    document.execCommand('copy');
  });
});

btnDownloadTxt.addEventListener('click', function () {
  if (!outputEl.value) return;
  var baseName = (state.file ? state.file.name.replace(/\.pdf$/i, '') : 'مستند');
  var blob = new Blob([outputEl.value], { type: 'text/plain;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = baseName + '.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
});

btnClear.addEventListener('click', function () {
  state.file = null;
  state.pdf = null;
  fileNameEl.textContent = '';
  outputEl.value = '';
  badgesEl.innerHTML = '';
  hideProgress();
  btnExtract.disabled = true;
  btnCopyAll.disabled = true;
  btnDownloadTxt.disabled = true;
  btnClear.disabled = true;
});
