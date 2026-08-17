/* Teleprompter — samostalna zamjena za cueprompter.com. Bez ovisnosti, bez build koraka. */

const $ = (sel) => document.querySelector(sel);

const KEY_TEXT = 'tp.text';
const KEY_CFG = 'tp.cfg';

const ALIGNS = ['left', 'center', 'justify'];

// Oznaka mjesta čitanja: bez oznake → dvije linije preko teksta → strelica uz lijevi rub.
const CUES = ['off', 'lines', 'arrow'];
const CUE_LABELS = { off: 'bez oznake', lines: 'linije za čitanje', arrow: 'strelica' };

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
  arrow: $('.cue-arrow'),
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

/* Koliko praznog prostora stoji iznad prvog retka, kao udio visine zaslona.
   Oznaka za čitanje je na 38–50 %, pa tekst kreće ispod nje — presenter dobije
   prazan zaslon i par sekundi za pripremu prije nego prva rečenica dođe na red. */
const LEAD_IN = 0.70;
const TRAIL_OUT = 0.85;

/* Margine teksta i položaj strelice — sve u pikselima, bez CSS calc/max, da se
   ponaša isto u svakom pregledniku. Strelica stoji lijevo od prve riječi. */
function layoutCue() {
  const width = el.stage.clientWidth || window.innerWidth;
  const height = el.stage.clientHeight || window.innerHeight;
  const marginPx = width * cfg.margin / 100;

  el.scroller.style.paddingTop = Math.round(height * LEAD_IN) + 'px';
  el.scroller.style.paddingBottom = Math.round(height * TRAIL_OUT) + 'px';
  const arrowMode = CUES[cfg.cue] === 'arrow';
  // Uz strelicu tekstu treba barem toliko lijevog razmaka da ga oznaka ne prekrije.
  const padLeft = arrowMode ? Math.max(56, marginPx) : marginPx;

  el.scroller.style.paddingLeft = padLeft + 'px';
  el.scroller.style.paddingRight = marginPx + 'px';
  el.arrow.style.left = Math.max(6, padLeft - 48) + 'px';
}

function applyCfg() {
  el.stage.style.background = cfg.bg;
  el.text.style.color = cfg.fg;
  el.text.style.fontSize = cfg.size + 'px';
  el.text.style.textAlign = ALIGNS[cfg.align];
  el.stage.classList.toggle('flip-x', cfg.flipX);
  el.stage.classList.toggle('flip-y', cfg.flipY);
  el.stage.classList.toggle('cue-mode-lines', CUES[cfg.cue] === 'lines');
  el.stage.classList.toggle('cue-mode-arrow', CUES[cfg.cue] === 'arrow');

  $('#t-flipx').classList.toggle('on', cfg.flipX);
  $('#t-flipy').classList.toggle('on', cfg.flipY);

  const cueBtn = $('#t-cue');
  cueBtn.classList.toggle('on', cfg.cue > 0);
  cueBtn.title = 'Oznaka za čitanje: ' + (cfg.cue ? CUE_LABELS[CUES[cfg.cue]] : 'isključena');
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

  layoutCue();
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

/* Natrag na početak. Pauzira, jer prazan prostor na vrhu i postoji zato da se
   presenter pripremi prije nego krene sljedeći put. */
function toTop() {
  pause();
  pos = 0;
  render();
  goIdle();
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

/* ───────────────────── Učitavanje teksta izvana ───────────────────────── */

// Namespace WordprocessingML-a — svi .docx-evi ga koriste, bez obzira na prefiks.
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function edMsg(text, isError) {
  const box = $('#ed-msg');
  box.textContent = text || '';
  box.classList.toggle('hidden', !text);
  box.classList.toggle('error', !!isError);
}

/* Formatiranje se odbacuje — ostaje samo tekst, bez tvrdih razmaka i suvišnih
   praznih redaka, jer se to na teleprompteru samo loše čita. */
function cleanText(s) {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')   // razmaci koji se ne lome
    .replace(/\u00AD/g, '')                  // meki spojnik
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function decodeText(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // Stariji hrvatski .txt-ovi znaju biti u Windows-1250.
    return new TextDecoder('windows-1250').decode(buf);
  }
}

/* Minimalno čitanje ZIP-a: docx je ZIP, a tekst je u word/document.xml.
   Raspakiravanje radi ugrađeni DecompressionStream, bez ijedne biblioteke. */
async function unzipEntry(buf, wanted) {
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);

  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Datoteka nije ispravan .docx (nedostaje ZIP zaglavlje).');

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);

  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    // Neki alati (npr. Compress-Archive) upisuju backslash umjesto kose crte.
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');

    if (name === wanted) {
      // Duljine imena u lokalnom zaglavlju znaju se razlikovati od centralnog.
      const nLen = dv.getUint16(localOff + 26, true);
      const xLen = dv.getUint16(localOff + 28, true);
      const start = localOff + 30 + nLen + xLen;
      const data = bytes.subarray(start, start + compSize);

      if (method === 0) return data;
      if (method !== 8) throw new Error('Nepodržana kompresija u .docx datoteci.');
      if (!window.DecompressionStream) throw new Error('Preglednik ne podržava raspakiravanje .docx-a.');

      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('U .docx datoteci nema ' + wanted + '.');
}

async function readDocx(buf) {
  const xml = new TextDecoder().decode(await unzipEntry(buf, 'word/document.xml'));
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Neispravan XML u .docx datoteci.');

  const paragraphs = Array.from(doc.getElementsByTagNameNS(W_NS, 'p')).map((para) => {
    let line = '';
    (function walk(node) {
      for (const child of node.childNodes) {
        if (child.nodeType !== 1) continue;
        switch (child.localName) {
          case 'instrText': break;               // kodovi polja nisu tekst
          case 't': line += child.textContent; break;
          case 'tab': line += '\t'; break;
          case 'br':
          case 'cr': line += '\n'; break;
          default: walk(child);
        }
      }
    })(para);
    return line;
  });

  return paragraphs.join('\n');
}

async function readTextFrom(file) {
  const buf = await file.arrayBuffer();
  const head = Array.from(new Uint8Array(buf.slice(0, 8)))
    .map((b) => b.toString(16).padStart(2, '0')).join('');

  if (head.startsWith('504b0304')) return cleanText(await readDocx(buf));   // "PK" → docx
  if (head.startsWith('d0cf11e0')) {
    throw new Error('Stari .doc format (Word 97–2003) nije podržan. Otvori ga u Wordu i spremi kao .docx.');
  }
  return cleanText(decodeText(buf));
}

/* Pastebin: prihvaća puni link, /raw/ link ili samo ključ. */
function pastebinKey(input) {
  const s = (input || '').trim();
  if (!s) return null;
  if (/^[A-Za-z0-9]{4,}$/.test(s)) return s;
  const m = s.match(/pastebin\.com\/(?:raw\/)?([A-Za-z0-9]+)/i);
  return m ? m[1] : null;
}

/* Pastebin ne šalje CORS zaglavlja, pa ide kroz proxy u nginxu (/pastebin/<kljuc>).
   Izravni pokušaj ostaje kao rezerva za slučaj da se app servira drukčije. */
async function fetchPastebin(key) {
  const sources = ['./pastebin/' + key, 'https://pastebin.com/raw/' + key];
  let lastErr;
  for (const url of sources) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      const body = await res.text();
      if (!res.ok) {
        lastErr = new Error(res.status === 404
          ? 'Paste ne postoji ili je privatan.'
          : 'Pastebin je vratio grešku ' + res.status + '.');
        continue;
      }
      if (/^Error, this is a private paste/i.test(body)) {
        throw new Error('Paste je privatan pa se ne može dohvatiti.');
      }
      // Ako umjesto teksta stigne HTML, to je stranica s greškom ili sama
      // aplikacija — nikako sadržaj paste-a.
      if (/^\s*<(!doctype|html)\b/i.test(body)) {
        lastErr = new Error('Odgovor nije čisti tekst (proxy nije dostupan?).');
        continue;
      }
      return body;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Dohvat nije uspio.');
}

async function pullPastebin() {
  const key = pastebinKey($('#pastebin-url').value);
  if (!key) {
    edMsg('Ne prepoznajem ključ — očekujem npr. pastebin.com/AbC12dEf ili AbC12dEf.', true);
    return;
  }
  const btn = $('#pastebin-go');
  btn.disabled = true;
  edMsg('Dohvaćam ' + key + '…');
  try {
    const text = cleanText(await fetchPastebin(key));
    if (!text) throw new Error('Paste je prazan.');
    el.script.value = text;
    saveText();
    updateStats();
    $('#pastebin-row').classList.add('hidden');
    $('#pastebin-url').value = '';
    edMsg('Učitano s Pastebina (' + key + ').');
  } catch (err) {
    const mreza = err instanceof TypeError || /failed to fetch|networkerror/i.test(err.message);
    edMsg(mreza
      ? 'Ne mogu dohvatiti paste — nema veze s Pastebinom ili proxy nije dostupan.'
      : 'Ne mogu dohvatiti paste: ' + err.message, true);
  } finally {
    btn.disabled = false;
  }
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
  edMsg('Učitavam ' + f.name + '…');
  try {
    const text = await readTextFrom(f);
    if (!text) throw new Error('Datoteka nema teksta.');
    el.script.value = text;
    saveText();
    updateStats();
    edMsg('Učitano: ' + f.name);
  } catch (err) {
    edMsg(err.message, true);
  }
  e.target.value = '';
});

$('#t-pastebin').addEventListener('click', () => {
  const row = $('#pastebin-row');
  row.classList.toggle('hidden');
  edMsg('');
  if (!row.classList.contains('hidden')) $('#pastebin-url').focus();
});
$('#pastebin-close').addEventListener('click', () => {
  $('#pastebin-row').classList.add('hidden');
  edMsg('');
});
$('#pastebin-go').addEventListener('click', pullPastebin);
$('#pastebin-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); pullPastebin(); }
});

el.play.addEventListener('click', togglePlay);
$('#t-top').addEventListener('click', toTop);

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

/* Povlačenje prstom ili mišem: tekst prati pokret dok se drži. Pointer Events
   pokrivaju dodir, miš i olovku jednim kodom. Kratki dodir bez pomaka ostaje
   pokreni/pauziraj. */
const DRAG_THRESHOLD = 8;   // px prije nego što dodir postane povlačenje
let drag = null;
let suppressClick = false;

el.stage.addEventListener('pointerdown', (e) => {
  if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
  // Nakon povlačenja prstom klik uopće ne dođe, pa se zastavica mora očistiti
  // ovdje — inače bi progutala sljedeći dodir.
  suppressClick = false;
  drag = { id: e.pointerId, startY: e.clientY, startPos: pos, moved: false, wasPlaying: playing };
  try { el.stage.setPointerCapture(e.pointerId); } catch { /* sintetički događaji */ }
});

el.stage.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dy = e.clientY - drag.startY;

  if (!drag.moved) {
    if (Math.abs(dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    pause();                       // automatsko pomicanje staje dok se povlači
  }

  // Kad je slika okomito zrcaljena, i smjer povlačenja je obrnut.
  pos = Math.max(0, Math.min(maxPos, drag.startPos - dy * (cfg.flipY ? -1 : 1)));
  render();
  goIdle();
});

function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const { moved, wasPlaying, id } = drag;
  drag = null;
  try { el.stage.releasePointerCapture(id); } catch { /* već otpušten */ }
  if (!moved) return;              // običan dodir → neka klik odradi svoje
  suppressClick = true;            // povlačenje ne smije pokrenuti/pauzirati
  if (wasPlaying) play();
}

el.stage.addEventListener('pointerup', endDrag);
el.stage.addEventListener('pointercancel', endDrag);

// Klik po tekstu pokreće/pauzira, kotačić pomiče ručno.
el.stage.addEventListener('click', () => {
  if (suppressClick) { suppressClick = false; return; }
  togglePlay();
});
el.stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  nudge(e.deltaY * (cfg.flipY ? -1 : 1));
}, { passive: false });

el.prompter.addEventListener('mousemove', goIdle);
el.prompter.addEventListener('touchstart', goIdle, { passive: true });

window.addEventListener('resize', () => {
  if (el.prompter.classList.contains('hidden')) return;
  layoutCue();
  measure();
});

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
      e.preventDefault(); toTop(); break;
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

/* Instalacija kao aplikacija. Gumb se pokazuje tek kad preglednik javi da je
   instalacija moguća — traži HTTPS ili localhost. */
let installPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('#install').classList.remove('hidden');
});

$('#install').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('#install').classList.add('hidden');
});

window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $('#install').classList.add('hidden');
});
