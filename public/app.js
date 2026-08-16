/* Teleprompter — samostalna zamjena za cueprompter.com. Bez ovisnosti, bez build koraka. */

const $ = (sel) => document.querySelector(sel);

const KEY_TEXT = 'tp.text';
const KEY_CFG = 'tp.cfg';

const ALIGNS = ['left', 'center', 'justify'];

// Oznaka mjesta čitanja: bez oznake → dvije linije preko teksta → strelica uz lijevi rub.
const CUES = ['off', 'lines', 'arrow'];
const CUE_LABELS = { off: 'bez oznake', lines: 'linije za čitanje', arrow: 'strelica' };
const CUE_SHORT = { off: '—', lines: 'linije', arrow: 'strelica' };

const DEFAULTS = {
  size: 58,
  margin: 5,
  speed: 10,
  align: 0,
  flipX: false,
  flipY: false,
  cue: 0,
  bg: '#000000',
  fg: '#ffffff',
};

const SAMPLE = `Dobar dan i dobro došli.

Ovo je probni tekst za teleprompter. Podesi veličinu slova, marginu i brzinu
tako da ti odgovara ritam čitanja.

Razmaknica pokreće i pauzira. Strelice gore i dolje mijenjaju brzinu.
Kotačić miša pomiče tekst ručno. Esc te vraća na uređivanje.`;

const el = {
  editor: $('#editor'),
  prompter: $('#prompter'),
  script: $('#script'),
  stage: $('#stage'),
  scroller: $('#scroller'),
  text: $('#text'),
  toolbar: $('#toolbar'),
  play: $('#t-play'),
  progress: $('#progress-bar'),
  toast: $('#toast'),
  cam: $('#cam'),
  recDot: $('#rec-dot'),
  recTime: $('#rec-time'),
  size: $('#size'),
  margin: $('#margin'),
  speed: $('#speed'),
  bg: $('#bg-color'),
  fg: $('#fg-color'),
};

let cfg = loadCfg();
let pos = 0;          // trenutni pomak u pikselima
let maxPos = 0;       // najveći smisleni pomak
let playing = false;
let lastTs = 0;
let recorder = null;
let recChunks = [];
let recStart = 0;
let recTimer = null;
let idleTimer = null;
let toastTimer = null;

/* ─────────────────────────────── Postavke ─────────────────────────────── */

function loadCfg() {
  let saved;
  try {
    saved = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY_CFG) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
  // Ranije je oznaka bila samo uključeno/isključeno, sada ima tri stanja.
  if (typeof saved.cue === 'boolean') saved.cue = saved.cue ? 1 : 0;
  saved.cue = Math.min(CUES.length - 1, Math.max(0, saved.cue | 0));
  return saved;
}

function saveCfg() {
  try {
    localStorage.setItem(KEY_CFG, JSON.stringify(cfg));
  } catch { /* privatni način rada — postavke se jednostavno ne pamte */ }
}

function saveText() {
  try {
    localStorage.setItem(KEY_TEXT, el.script.value);
  } catch { /* isto */ }
}

/* Brzina: piksela u sekundi. Skalira se s veličinom slova da isti "broj
   brzine" daje isti ritam čitanja bez obzira na veličinu teksta. */
function pxPerSecond() {
  return cfg.speed * cfg.size * 0.09;
}

function applyCfg() {
  el.stage.style.background = cfg.bg;
  el.text.style.color = cfg.fg;
  el.text.style.fontSize = cfg.size + 'px';
  el.text.style.textAlign = ALIGNS[cfg.align];
  // Uz strelicu tekst treba barem toliko lijevog razmaka da ga oznaka ne prekrije.
  el.scroller.style.paddingLeft = CUES[cfg.cue] === 'arrow'
    ? `max(48px, ${cfg.margin}%)`
    : cfg.margin + '%';
  el.scroller.style.paddingRight = cfg.margin + '%';
  el.stage.style.setProperty('--cue-margin', cfg.margin + '%');

  el.stage.classList.toggle('flip-x', cfg.flipX);
  el.stage.classList.toggle('flip-y', cfg.flipY);
  el.stage.classList.toggle('cue-mode-lines', CUES[cfg.cue] === 'lines');
  el.stage.classList.toggle('cue-mode-arrow', CUES[cfg.cue] === 'arrow');

  $('#t-flipx').classList.toggle('on', cfg.flipX);
  $('#t-flipy').classList.toggle('on', cfg.flipY);

  const cueBtn = $('#t-cue');
  cueBtn.classList.toggle('on', cfg.cue > 0);
  cueBtn.title = 'Oznaka za čitanje: ' + (cfg.cue ? CUE_LABELS[CUES[cfg.cue]] : 'isključena');
  $('#cue-val').textContent = CUE_SHORT[CUES[cfg.cue]];
  cueBtn.querySelector('.i-cue-lines').classList.toggle('hidden', CUES[cfg.cue] === 'arrow');
  cueBtn.querySelector('.i-cue-arrow').classList.toggle('hidden', CUES[cfg.cue] !== 'arrow');

  el.size.value = cfg.size;
  el.margin.value = cfg.margin;
  el.speed.value = cfg.speed;
  el.bg.value = cfg.bg;
  el.fg.value = cfg.fg;

  $('#size-val').textContent = cfg.size + 'px';
  $('#margin-val').textContent = cfg.margin + '%';
  $('#speed-val').textContent = cfg.speed;
  $('#t-bg').querySelector('.swatch-box').style.background = cfg.bg;
  $('#t-fg').querySelector('.swatch-box').style.background = cfg.fg;

  measure();
  updateStats();
  saveCfg();
}

/* ──────────────────────────────── Pomicanje ───────────────────────────── */

function measure() {
  const h = el.scroller.getBoundingClientRect().height;
  maxPos = Math.max(0, h - el.stage.clientHeight);
  pos = Math.min(pos, maxPos);
  render();
}

function render() {
  el.scroller.style.transform = `translate3d(0, ${-pos}px, 0)`;
  el.progress.style.width = (maxPos > 0 ? (pos / maxPos) * 100 : 0) + '%';
}

function frame(ts) {
  if (!playing) return;
  if (!lastTs) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.1);
  lastTs = ts;

  pos += pxPerSecond() * dt;
  if (pos >= maxPos) {
    pos = maxPos;
    render();
    pause();
    toast('Kraj teksta');
    return;
  }
  render();
  requestAnimationFrame(frame);
}

function play() {
  if (playing) return;
  measure();
  if (pos >= maxPos) pos = 0;
  playing = true;
  lastTs = 0;
  el.play.querySelector('.i-play').classList.add('hidden');
  el.play.querySelector('.i-pause').classList.remove('hidden');
  requestAnimationFrame(frame);
  goIdle();
}

function pause() {
  playing = false;
  el.play.querySelector('.i-play').classList.remove('hidden');
  el.play.querySelector('.i-pause').classList.add('hidden');
}

function togglePlay() {
  playing ? pause() : play();
}

function nudge(px) {
  pos = Math.max(0, Math.min(maxPos, pos + px));
  render();
}

/* ─────────────────────────────── Sučelje ──────────────────────────────── */

function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1800);
}

function goIdle() {
  clearTimeout(idleTimer);
  el.prompter.classList.remove('idle');
  idleTimer = setTimeout(() => {
    if (playing) el.prompter.classList.add('idle');
  }, 2500);
}

function updateStats() {
  const words = el.script.value.trim().split(/\s+/).filter(Boolean).length;
  $('#stat-words').textContent = words + (words === 1 ? ' riječ' : ' riječi');

  // Procjena trajanja iz stvarne brzine pomicanja pri trenutnim postavkama.
  const lineHeight = cfg.size * 1.45;
  const perLine = lineHeight / pxPerSecond();
  const charsPerLine = Math.max(20, Math.round(
    (window.innerWidth * (1 - cfg.margin / 50)) / (cfg.size * 0.5)
  ));
  // Svaki redak izvornog teksta prelama se u onoliko redaka koliko stane u širinu.
  const lines = el.script.value.split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  const secs = Math.round(lines * perLine);
  $('#stat-time').textContent = '~' + Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
}

function openPrompter() {
  const txt = el.script.value.trim();
  if (!txt) {
    el.script.focus();
    return;
  }
  el.text.textContent = txt;
  el.editor.classList.add('hidden');
  el.prompter.classList.remove('hidden');
  pos = 0;
  applyCfg();
  render();
  goIdle();
}

function closePrompter() {
  pause();
  el.prompter.classList.add('hidden');
  el.editor.classList.remove('hidden');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

/* ──────────────────────────── Snimanje kamerom ────────────────────────── */

function pickMime() {
  const list = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  return list.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}

async function toggleRecord() {
  if (recorder) {
    recorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast('Snimanje traži HTTPS ili localhost');
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: true,
    });
  } catch (err) {
    toast('Nema pristupa kameri: ' + err.name);
    return;
  }

  recChunks = [];
  const mime = pickMime();
  recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
  recorder.onstop = () => {
    stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(recChunks, { type: recorder.mimeType || 'video/webm' });
    const ext = (recorder.mimeType || '').includes('mp4') ? 'mp4' : 'webm';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `snimka-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);

    recorder = null;
    clearInterval(recTimer);
    el.recDot.classList.add('hidden');
    el.cam.classList.add('hidden');
    el.cam.srcObject = null;
    $('#t-rec').classList.remove('on');
    $('#t-rec').textContent = 'Snimi video';
    pause();
    toast('Snimka spremljena');
  };

  el.cam.srcObject = stream;
  el.cam.classList.remove('hidden');
  el.cam.play().catch(() => {});

  recorder.start();
  recStart = Date.now();
  el.recDot.classList.remove('hidden');
  recTimer = setInterval(() => {
    const s = Math.floor((Date.now() - recStart) / 1000);
    el.recTime.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }, 500);

  $('#t-rec').classList.add('on');
  $('#t-rec').textContent = 'Zaustavi';
  pos = 0;
  play();
}

/* ────────────────────────────── Događaji ──────────────────────────────── */

el.script.value = localStorage.getItem(KEY_TEXT) || '';
el.script.addEventListener('input', () => { saveText(); updateStats(); });

$('#start').addEventListener('click', openPrompter);
$('#t-edit').addEventListener('click', closePrompter);
$('#sample').addEventListener('click', () => {
  el.script.value = SAMPLE;
  saveText();
  updateStats();
});
$('#clear').addEventListener('click', () => {
  el.script.value = '';
  saveText();
  updateStats();
  el.script.focus();
});
$('#file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  el.script.value = await f.text();
  saveText();
  updateStats();
  e.target.value = '';
});

el.play.addEventListener('click', togglePlay);

$('#t-align').addEventListener('click', () => {
  cfg.align = (cfg.align + 1) % ALIGNS.length;
  applyCfg();
  toast('Poravnanje: ' + { left: 'lijevo', center: 'sredina', justify: 'obostrano' }[ALIGNS[cfg.align]]);
});
$('#t-flipx').addEventListener('click', () => { cfg.flipX = !cfg.flipX; applyCfg(); });
$('#t-flipy').addEventListener('click', () => { cfg.flipY = !cfg.flipY; applyCfg(); });
$('#t-cue').addEventListener('click', () => {
  cfg.cue = (cfg.cue + 1) % CUES.length;
  applyCfg();
  toast('Oznaka: ' + CUE_LABELS[CUES[cfg.cue]]);
});
$('#t-rec').addEventListener('click', toggleRecord);

$('#t-full').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => toast('Cijeli zaslon nije dostupan'));
});

el.size.addEventListener('input', () => { cfg.size = +el.size.value; applyCfg(); });
el.margin.addEventListener('input', () => { cfg.margin = +el.margin.value; applyCfg(); });
el.speed.addEventListener('input', () => { cfg.speed = +el.speed.value; applyCfg(); });
el.bg.addEventListener('input', () => { cfg.bg = el.bg.value; applyCfg(); });
el.fg.addEventListener('input', () => { cfg.fg = el.fg.value; applyCfg(); });

// Klik po tekstu pokreće/pauzira, kotačić pomiče ručno.
el.stage.addEventListener('click', togglePlay);
el.stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  nudge(e.deltaY * (cfg.flipY ? -1 : 1));
}, { passive: false });

el.prompter.addEventListener('mousemove', goIdle);
el.prompter.addEventListener('touchstart', goIdle, { passive: true });

window.addEventListener('resize', () => { if (!el.prompter.classList.contains('hidden')) measure(); });

document.addEventListener('keydown', (e) => {
  if (el.prompter.classList.contains('hidden')) {
    // U uređivaču: Ctrl/Cmd + Enter pokreće teleprompter.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) openPrompter();
    return;
  }
  goIdle();
  switch (e.key) {
    case ' ':
    case 'Spacebar':
      e.preventDefault(); togglePlay(); break;
    case 'ArrowUp':
      e.preventDefault();
      if (e.shiftKey) nudge(-60);
      else { cfg.speed = Math.min(60, cfg.speed + 1); applyCfg(); toast('Brzina ' + cfg.speed); }
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (e.shiftKey) nudge(60);
      else { cfg.speed = Math.max(1, cfg.speed - 1); applyCfg(); toast('Brzina ' + cfg.speed); }
      break;
    case 'PageUp':
      e.preventDefault(); nudge(-el.stage.clientHeight * 0.8); break;
    case 'PageDown':
      e.preventDefault(); nudge(el.stage.clientHeight * 0.8); break;
    case 'Home':
      e.preventDefault(); pos = 0; render(); break;
    case 'End':
      e.preventDefault(); pos = maxPos; render(); break;
    case 'f': case 'F':
      $('#t-full').click(); break;
    case 'm': case 'M':
      cfg.flipX = !cfg.flipX; applyCfg(); break;
    case 'Escape':
      closePrompter(); break;
  }
});

applyCfg();
updateStats();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
