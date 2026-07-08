import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.mjs';

var THEME_KEY = 'modelsReportTheme';

// A page counts as "real text" if it has at least this many non-whitespace
// characters — below that, scanned/image pages tend to yield only a stray
// watermark or nothing, so we fall back to OCR instead of trusting it.
var MIN_TEXT_CHARS = 25;
var OCR_SCALE = 2.2; // render scale for OCR — higher than screen-res improves accuracy

var state = {
  file: null,
  pdf: null,
  ocrWorker: null,
  ocrWorkerLang: null,
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
    var cls = p.mode === 'text' ? 'mode-text' : p.mode === 'ocr' ? 'mode-ocr' : 'mode-pending';
    var label = p.mode === 'text' ? 'صفحة ' + (idx + 1) + ' — نص مباشر'
      : p.mode === 'ocr' ? 'صفحة ' + (idx + 1) + ' — OCR'
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

// The tesseract.js worker's logger is fixed at creation time (no setter),
// but we need fresh per-page progress callbacks — so the worker's logger
// is a thin, permanent forwarder to whatever this variable currently points to.
var activeOcrLogger = function () {};

function ensureOcrWorker(lang, onOcrProgress) {
  activeOcrLogger = onOcrProgress;
  if (state.ocrWorker && state.ocrWorkerLang === lang) {
    return Promise.resolve(state.ocrWorker);
  }
  var terminatePrev = state.ocrWorker ? state.ocrWorker.terminate() : Promise.resolve();
  return terminatePrev.then(function () {
    return window.Tesseract.createWorker(lang, 1, {
      workerPath: 'vendor/tesseract/worker.min.js',
      corePath: 'vendor/tesseract/tesseract-core-simd-lstm.wasm.js',
      langPath: 'vendor/tessdata',
      logger: function (m) { activeOcrLogger(m); }
    });
  }).then(function (worker) {
    state.ocrWorker = worker;
    state.ocrWorkerLang = lang;
    return worker;
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

  state.file.arrayBuffer().then(function (buf) {
    return pdfjsLib.getDocument({ data: buf }).promise;
  }).then(function (pdf) {
    state.pdf = pdf;
    var numPages = pdf.numPages;
    var pages = [];
    for (var i = 0; i < numPages; i++) pages.push({ mode: 'pending', text: '' });
    renderBadges(pages);

    var chain = Promise.resolve();
    var pageResults = [];

    for (var pageNum = 1; pageNum <= numPages; pageNum++) {
      (function (pageNum) {
        chain = chain.then(function () {
          setProgress('جارٍ قراءة الصفحة ' + pageNum + ' من ' + numPages + '...', ((pageNum - 1) / numPages) * 100);
          return pdf.getPage(pageNum).then(function (page) {
            return extractPageText(page).then(function (text) {
              var meaningfulLen = text.replace(/\s/g, '').length;
              if (!forceOcr && meaningfulLen >= MIN_TEXT_CHARS) {
                pageResults[pageNum - 1] = { mode: 'text', text: text };
                pages[pageNum - 1] = pageResults[pageNum - 1];
                renderBadges(pages);
                return;
              }
              // Falls back to OCR: render the page to an image, then recognize it.
              setProgress('لا يوجد نص كافٍ في الصفحة ' + pageNum + ' — جارٍ تشغيل OCR...', ((pageNum - 1) / numPages) * 100);
              return renderPageToCanvas(page).then(function (canvas) {
                return ensureOcrWorker(ocrLang, function (m) {
                  if (m.status === 'recognizing text') {
                    var base = ((pageNum - 1) / numPages) * 100;
                    var span = (1 / numPages) * 100;
                    setProgress('OCR — صفحة ' + pageNum + ' من ' + numPages + ' (' + Math.round(m.progress * 100) + '%)', base + span * m.progress);
                  }
                }).then(function (worker) {
                  return worker.recognize(canvas);
                });
              }).then(function (result) {
                pageResults[pageNum - 1] = { mode: 'ocr', text: result.data.text };
                pages[pageNum - 1] = pageResults[pageNum - 1];
                renderBadges(pages);
              });
            });
          });
        });
      })(pageNum);
    }

    return chain.then(function () {
      var finalText = buildFinalText(pageResults);
      outputEl.value = finalText;
      setProgress('تم الانتهاء من استخراج ' + numPages + ' صفحة', 100);
      setTimeout(hideProgress, 1500);
      btnCopyAll.disabled = false;
      btnDownloadTxt.disabled = false;
      btnClear.disabled = false;
    });
  }).catch(function (err) {
    console.error(err);
    hideProgress();
    alert('تعذّرت معالجة هذا الملف. تأكد من أنه ملف PDF صالح.');
  }).then(function () {
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
