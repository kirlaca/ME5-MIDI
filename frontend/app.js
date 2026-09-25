'use strict';

// Opened straight from disk (file://) -> talk to the default dev server.
const API = location.protocol === 'file:' ? 'http://localhost:8000' : '';
const MIDI_CHANNEL = 0; // ME-5 on MIDI channel 1, as in the original editor
const PROGRAM_CHANGE = 0xC0;

// One skin per pedal the ME-5 models. Colours are approximations - tweak freely.
const SKINS = {
  cs2: { model: 'CS-2', name: 'Compression Sustainer', body: '#2f7fc1', ink: '#ffffff' },
  od2: { model: 'OD-2', name: 'OverDrive', body: '#f39a1e', ink: '#151515' },
  od2t: { model: 'OD-2 Turbo', name: 'OverDrive', body: '#f39a1e', ink: '#151515' },
  ds1: { model: 'DS-1', name: 'Distortion', body: '#ee6a1f', ink: '#151515' },
  ge7: { model: 'GE-7', name: 'Equalizer', body: '#c9cdd2', ink: '#151515' },
  ce2: { model: 'CE-2', name: 'Chorus', body: '#8fd0e8', ink: '#151515' },
  bf2: { model: 'BF-2', name: 'Flanger', body: '#6b4c9a', ink: '#ffffff' },
  ns2: { model: 'NS-2', name: 'Noise Suppressor', body: '#ecebe4', ink: '#151515' },
  rv2: { model: 'RV-2', name: 'Digital Reverb', body: '#27406f', ink: '#ffffff' },
  dd2: { model: 'DD-2', name: 'Digital Delay', body: '#e4e7ea', ink: '#151515' },
};

// Vector redraw of the badge + blocky lettering, so it stays sharp and takes the pedal's ink colour.
const BRAND_LOGO = `<svg class="brand-logo" viewBox="0 0 432 80" fill="currentColor" fill-rule="evenodd">
  <path d="M0 0H80V80H0Z M6 6V74H74V6Z"/>
  <rect x="18" y="12" width="7" height="36"/>
  <path d="M44 26A21 21 0 1 1 43.99 26Z M44 32A15 15 0 1 1 43.99 32Z"/>
  <path d="M92 0H160Q166 0 166 6V34L160 40L166 46V74Q166 80 160 80H92Z M104 0H109V30H104Z M112 16H148V32H112Z M112 48H148V64H112Z"/>
  <path d="M194 0H240A14 14 0 0 1 254 14V66A14 14 0 0 1 240 80H194A14 14 0 0 1 180 66V14A14 14 0 0 1 194 0Z M198 18H236V62H198Z"/>
  <path d="M268 14A14 14 0 0 1 282 0H342V18H290A4 4 0 0 0 286 22V27A4 4 0 0 0 290 31H328A14 14 0 0 1 342 45V66A14 14 0 0 1 328 80H268V62H320A4 4 0 0 0 324 58V53A4 4 0 0 0 320 49H282A14 14 0 0 1 268 35Z"/>
  <path d="M356 14A14 14 0 0 1 370 0H430V18H378A4 4 0 0 0 374 22V27A4 4 0 0 0 378 31H416A14 14 0 0 1 430 45V66A14 14 0 0 1 416 80H356V62H408A4 4 0 0 0 412 58V53A4 4 0 0 0 408 49H370A14 14 0 0 1 356 35Z"/>
</svg>`;

const state = {
  meta: null,      // /api/params response
  byKey: {},
  library: [],     // 64 x {param: value}
  source: '',
  current: 0,
  values: null,    // the sound being edited (ME-5 temp buffer)
  conn: null,      // {output, input} when talking to a real ME-5
  original: null,  // the patch as it was when selected - Revert returns here, even after an auto write
  autoWrite: false,
  // Last sub-mode per pedal, so flipping CE-2 -> BF-2 -> CE-2 or RV-3 -> DD-2 -> RV-3 comes back where it was.
  mem: { flanger: 1, reverb: 0, ns: 4 },
};

const isDelay = v => v.rev_mode === state.meta.reverb_mode_delay;
const bitOf = name => state.meta.effect_bits[name];

const sel = (key, pairs) => pairs.map(([value, label]) => ({
  label, active: v => v[key] === value, apply: () => ({ [key]: value }),
}));

// Signal chain in the order printed on the ME-5 panel.
const CHAIN = [
  {
    slot: '1', bit: 'compressor', skin: () => 'cs2',
    knobs: [['comp_level', 'Level'], ['comp_tone', 'Tone'], ['comp_attack', 'Attack'], ['comp_sustain', 'Sustain']],
  },
  {
    slot: '2', bit: 'overdrive', skin: v => ['od2', 'od2t', 'ds1'][v.od_mode],
    switches: [{ caption: 'Type', options: sel('od_mode', [[0, 'OD-2'], [1, 'OD-2 Turbo'], [2, 'DS-1']]) }],
    knobs: [['od_level', 'Level'], ['od_drive', 'Drive']],
  },
  {
    slot: '3', bit: 'equalizer', skin: () => 'ge7',
    switches: [{ caption: 'Mid freq', options: sel('eq_mid_freq', [[0, '0.5k'], [1, '1k'], [2, '2k']]) }],
    faders: [['eq_low', 'Low'], ['eq_mid', 'Mid'], ['eq_high', 'High'], ['eq_level', 'Level']],
  },
  {
    slot: '4', bit: 'modulation', skin: v => (v.mod_mode === 0 ? 'ce2' : 'bf2'),
    switches: [
      {
        caption: 'Type', options: [
          { label: 'CE-2', active: v => v.mod_mode === 0, apply: () => ({ mod_mode: 0 }) },
          { label: 'BF-2', active: v => v.mod_mode > 0, apply: () => ({ mod_mode: state.mem.flanger }) },
        ],
      },
      { caption: 'Mode', visible: v => v.mod_mode > 0, options: sel('mod_mode', [[1, '1'], [2, '2'], [3, '3'], [4, '4']]) },
    ],
    knobs: [['mod_rate', 'Rate'], ['mod_depth', 'Depth'], ['mod_resonance', 'Res'], ['mod_level', 'Level']],
  },
  { loop: true },
  {
    slot: 'NS', skin: () => 'ns2',
    // No bypass bit for the suppressor - threshold 0 is "off", so the footswitch toggles that.
    isOn: v => v.ns_threshold > 0,
    toggle: v => ({ ns_threshold: v.ns_threshold > 0 ? 0 : state.mem.ns }),
    knobs: [['ns_threshold', 'Threshold']],
  },
  {
    slot: 'B', bit: 'reverb', skin: v => (isDelay(v) ? 'dd2' : 'rv2'),
    switches: [
      {
        caption: 'Type', options: [
          { label: 'RV-2', active: v => !isDelay(v), apply: () => ({ rev_mode: state.mem.reverb }) },
          { label: 'DD-2', active: isDelay, apply: () => ({ rev_mode: state.meta.reverb_mode_delay }) },
        ],
      },
      {
        caption: 'Mode', visible: v => !isDelay(v),
        options: sel('rev_mode', [[0, 'Room'], [1, 'Hall 15'], [2, 'Hall 30'], [3, 'Plate'], [4, 'Gated']]),
      },
    ],
    knobs: [['rev_time', 'Time'], ['rev_delay_feedback', 'F.B.'], ['rev_tone', 'Tone'], ['rev_level', 'Level']],
  },
  { master: true },
];

// ---------------------------------------------------------------- helpers

function h(tag, cls, text) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

const $ = sel => document.querySelector(sel);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

async function api(path, body) {
  const init = body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  };
  const res = await fetch(API + path, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json.detail;
    throw new Error(typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : res.statusText);
  }
  return json;
}

let toastTimer;
function toast(message, kind = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 6000 : 2800);
}

const patchLabel = n => `${Math.floor(n / 16) + 1}-${Math.floor((n % 16) / 4) + 1}-${(n % 4) + 1}`;

function maxOf(key, v) {
  if (key === 'rev_time') return isDelay(v) ? state.meta.delay_time_max : state.meta.reverb_time_max;
  return state.byKey[key].max;
}

function labelOf(key, value, v) {
  if (key === 'rev_time') {
    // Panel legend: delay time is 0.1-50 in units of 10 ms.
    return isDelay(v)
      ? `${Math.round(parseFloat(state.meta.delay_time_labels[value]) * 10)} ms`
      : state.meta.reverb_time_labels[value];
  }
  if (key === 'rev_tone' && value === 7) return 'FLAT';
  const p = state.byKey[key];
  return p.labels ? p.labels[value] : String(value);
}

function arc(a0, a1, r = 42) {
  const pt = a => [50 + r * Math.sin((a * Math.PI) / 180), 50 - r * Math.cos((a * Math.PI) / 180)];
  const [x0, y0] = pt(a0);
  const [x1, y1] = pt(a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const differs = (a, b) => Object.keys(state.byKey).some(k => a[k] !== b[k]);
const isDirty = () => differs(state.values, state.library[state.current]);

// ---------------------------------------------------------------- state changes

function setValues(partial) {
  const v = Object.assign(state.values, partial);
  if (v.mod_mode > 0) state.mem.flanger = v.mod_mode;
  if (!isDelay(v)) state.mem.reverb = v.rev_mode;
  if (v.ns_threshold > 0) state.mem.ns = v.ns_threshold;
  v.rev_time = Math.min(v.rev_time, maxOf('rev_time', v));
  queueTempSend();
  queueAutoWrite();
  refreshIndicators();
}

function selectPatch(n, { send = true } = {}) {
  // Store a pending auto write before leaving, and only then switch the pedal over.
  const pending = flushAutoWrite();
  state.current = (n + 64) % 64;
  state.values = { ...state.library[state.current] };
  state.original = { ...state.values };
  setValues({}); // seed the sub-mode memory
  clearTimeout(tempTimer); // the pedal loads the patch itself on Program Change
  renderAll();
  if (send && state.conn) {
    const program = state.current;
    pending.then(() => sendMidi([PROGRAM_CHANGE | MIDI_CHANNEL, program])).catch(e => toast(e.message, 'error'));
  }
}

function setLibrary(patches, source) {
  const library = new Array(64);
  patches.forEach((p, i) => { library[p.patch_number ?? i] = p.values; });
  if (library.some(p => !p) || patches.length !== 64) {
    throw new Error(`expected 64 patches, got ${patches.length}`);
  }
  cancelAutoWrite(); // a new library replaces the edited patch anyway
  state.library = library;
  state.source = source;
  selectPatch(state.current, { send: false });
}

// ---------------------------------------------------------------- MIDI

let tempTimer;
function queueTempSend() {
  if (!state.conn) return;
  clearTimeout(tempTimer);
  tempTimer = setTimeout(sendTemp, 120);
}

async function sendTemp() {
  try {
    const { data } = await api('/api/patch/encode', { values: state.values, patch_number: null });
    await sendMidi(data);
  } catch (e) {
    toast(`Send failed: ${e.message}`, 'error');
  }
}

const sendMidi = data => api('/api/send', { output: state.conn.output, data });

// ---------------------------------------------------------------- auto write

const AUTO_WRITE_DELAY = 5000; // keep in sync with the countdown animation in style.css
const AUTO_WRITE_KEY = 'me5.autoWrite';
let autoTimer = null;

function queueAutoWrite() {
  cancelAutoWrite();
  if (!state.autoWrite || !isDirty()) return;
  autoTimer = setTimeout(() => {
    autoTimer = null;
    renderAutoPending();
    writePatch({ auto: true });
  }, AUTO_WRITE_DELAY);
  renderAutoPending();
}

function cancelAutoWrite() {
  clearTimeout(autoTimer);
  autoTimer = null;
  renderAutoPending();
}

// Write now instead of waiting; resolves when done (at once if nothing is pending).
function flushAutoWrite() {
  if (autoTimer === null) return Promise.resolve();
  cancelAutoWrite();
  return writePatch({ auto: true });
}

function setAutoWrite(on) {
  state.autoWrite = on;
  try { localStorage.setItem(AUTO_WRITE_KEY, on ? '1' : '0'); } catch { /* storage blocked */ }
  $('#auto-write').checked = on;
  queueAutoWrite();
}

// Restarts the countdown bar on the Write button.
function renderAutoPending() {
  const btn = $('#store');
  btn.classList.remove('pending');
  if (autoTimer === null) return;
  void btn.offsetWidth; // reflow so the animation starts over
  btn.classList.add('pending');
}

function connect(ports) {
  state.conn = ports;
  renderStatus();
  $('#conn-dialog').close();
  toast(ports ? 'Connected. Press "Read ME-5" to pull its patches.' : 'Offline - edits stay in the editor.');
}

// ---------------------------------------------------------------- controls

function knob(key, label) {
  const wrap = h('div', 'knob-wrap');
  const dial = h('div', 'knob');
  const out = h('span', 'knob-value');
  dial.tabIndex = 0;
  dial.setAttribute('role', 'slider');
  dial.setAttribute('aria-label', label);
  dial.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true">
    <path class="knob-track" d="${arc(-135, 135)}"/><path class="knob-fill"/>
    <circle class="knob-cap" cx="50" cy="50" r="31"/><circle class="knob-cap-top" cx="50" cy="50" r="25"/>
    <line class="knob-pointer" x1="50" y1="42" x2="50" y2="23"/></svg>`;
  wrap.append(h('span', 'knob-label', label), dial, out);

  const fill = dial.querySelector('.knob-fill');
  const pointer = dial.querySelector('.knob-pointer');

  function paint() {
    const v = state.values[key];
    const max = maxOf(key, state.values);
    const angle = -135 + 270 * (max ? v / max : 0);
    fill.setAttribute('d', v > 0 ? arc(-135, angle) : '');
    pointer.setAttribute('transform', `rotate(${angle} 50 50)`);
    const text = labelOf(key, v, state.values);
    out.textContent = text;
    dial.setAttribute('aria-valuemin', 0);
    dial.setAttribute('aria-valuemax', max);
    dial.setAttribute('aria-valuenow', v);
    dial.setAttribute('aria-valuetext', text);
  }

  function set(n) {
    n = clamp(Math.round(n), 0, maxOf(key, state.values));
    if (n === state.values[key]) return;
    setValues({ [key]: n });
    paint();
  }

  dial.addEventListener('pointerdown', e => {
    e.preventDefault();
    dial.focus();
    dial.setPointerCapture(e.pointerId);
    dial.classList.add('dragging');
    const startY = e.clientY;
    const startValue = state.values[key];
    // Full sweep in roughly 180px whatever the range, but never finer than 3px per step.
    const pxPerStep = clamp(180 / maxOf(key, state.values), 3, 22);
    const move = ev => set(startValue + (startY - ev.clientY) / pxPerStep);
    const up = () => {
      dial.classList.remove('dragging');
      dial.removeEventListener('pointermove', move);
      dial.removeEventListener('pointerup', up);
      dial.removeEventListener('pointercancel', up);
    };
    dial.addEventListener('pointermove', move);
    dial.addEventListener('pointerup', up);
    dial.addEventListener('pointercancel', up);
  });
  dial.addEventListener('wheel', e => {
    e.preventDefault();
    set(state.values[key] + (e.deltaY < 0 ? 1 : -1));
  }, { passive: false });
  dial.addEventListener('keydown', e => {
    const v = state.values[key];
    const max = maxOf(key, state.values);
    const next = {
      ArrowUp: v + 1, ArrowRight: v + 1, ArrowDown: v - 1, ArrowLeft: v - 1,
      PageUp: v + Math.ceil(max / 10), PageDown: v - Math.ceil(max / 10), Home: 0, End: max,
    }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    set(next);
  });

  paint();
  return wrap;
}

function fader(key, label) {
  const wrap = h('label', 'fader-wrap');
  const out = h('span', 'knob-value');
  const input = h('input');
  input.type = 'range';
  input.min = 0;
  input.max = maxOf(key, state.values);
  input.value = state.values[key];
  input.setAttribute('aria-label', label);
  const paint = () => {
    out.textContent = labelOf(key, state.values[key], state.values);
    input.setAttribute('aria-valuetext', out.textContent);
  };
  input.addEventListener('input', () => { setValues({ [key]: Number(input.value) }); paint(); });
  input.addEventListener('keydown', e => e.stopPropagation());
  input.addEventListener('wheel', e => {
    e.preventDefault();
    const n = clamp(state.values[key] + (e.deltaY < 0 ? 1 : -1), 0, Number(input.max));
    if (n === state.values[key]) return;
    input.value = n;
    setValues({ [key]: n });
    paint();
  }, { passive: false });
  paint();
  wrap.append(out, input, h('span', 'knob-label', label));
  return wrap;
}

function segmented(options, onPick) {
  const seg = h('div', 'seg');
  for (const opt of options) {
    const b = h('button', '', opt.label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(opt.active(state.values)));
    b.addEventListener('click', () => onPick(opt));
    seg.append(b);
  }
  return seg;
}

// ---------------------------------------------------------------- rendering

const pedalEls = [];

function isOn(block, v) {
  return block.isOn ? block.isOn(v) : Boolean(v.effects_on & bitOf(block.bit));
}

function renderPedal(block) {
  const v = state.values;
  const skin = SKINS[block.skin(v)];
  const el = h('article', 'pedal');
  el.style.setProperty('--body', skin.body);
  el.style.setProperty('--ink', skin.ink);

  const top = h('div', 'pedal-top');
  const check = h('div', 'check');
  const led = h('span', 'led');
  check.append(led, h('span', '', 'CHECK'));
  top.append(check);

  const controls = h('div', block.faders ? 'faders' : 'knobs');
  for (const [key, label] of block.faders || block.knobs) {
    controls.append(block.faders ? fader(key, label) : knob(key, label));
  }
  top.append(controls);
  el.append(top);

  if (block.switches) {
    const switches = h('div', 'switches');
    for (const sw of block.switches) {
      if (sw.visible && !sw.visible(v)) continue;
      const row = h('div', 'switch-row');
      row.append(h('span', 'switch-caption', sw.caption), segmented(sw.options, opt => {
        setValues(opt.apply());
        renderChain();
      }));
      switches.append(row);
    }
    el.append(switches);
  }

  const plate = h('div', 'plate');
  plate.append(h('span', 'plate-model', skin.model), h('span', 'plate-name', skin.name));
  // Fills the gap above the plate; CSS hides the word when the gap is too small.
  const brand = h('div', 'brand-space');
  brand.setAttribute('aria-hidden', 'true');
  brand.innerHTML = BRAND_LOGO;
  el.append(brand, plate);

  const foot = h('button', 'footswitch');
  foot.type = 'button';
  foot.setAttribute('aria-label', `${skin.model} on/off`);
  foot.append(h('span', 'slot', block.slot));
  foot.addEventListener('click', () => {
    setValues(block.toggle ? block.toggle(state.values) : { effects_on: state.values.effects_on ^ bitOf(block.bit) });
    renderChain(); // NS footswitch moves the threshold knob too
  });
  el.append(foot, h('span', 'on-bar'));

  pedalEls.push({ block, el, led, foot });
  return el;
}

function renderLoop() {
  const el = h('div', 'module loop');
  el.append(h('span', 'module-title', 'Send / Return'));
  el.append(segmented(sel('send_return', [[0, 'OFF'], [1, 'ON']]), opt => {
    setValues(opt.apply());
    renderChain();
  }));
  return el;
}

function renderMaster() {
  const el = h('div', 'module master');
  el.append(h('span', 'module-title', 'Master level'), knob('master_level', 'Level'), h('span', 'module-note', 'Unity = 5.0'));
  return el;
}

function renderChain() {
  const chain = $('#chain');
  pedalEls.length = 0;
  chain.replaceChildren(h('span', 'jack-label', 'INPUT'));
  for (const block of CHAIN) {
    chain.append(block.loop ? renderLoop() : block.master ? renderMaster() : renderPedal(block));
  }
  chain.append(h('span', 'jack-label', 'OUTPUT'));
  refreshIndicators();
}

function refreshIndicators() {
  for (const { block, el, led, foot } of pedalEls) {
    const on = isOn(block, state.values);
    el.classList.toggle('off', !on);
    led.classList.toggle('on', on);
    foot.setAttribute('aria-pressed', String(on));
  }
  const dirty = isDirty();
  $('#edited').classList.toggle('on', dirty);
  $('#store').classList.toggle('primary', dirty);
  $('#revert').disabled = !dirty && !differs(state.values, state.original);
}

function renderDisplay() {
  $('#patch-label').textContent = patchLabel(state.current);
  $('#patch-num').textContent = `#${String(state.current + 1).padStart(2, '0')}`;
  $('#source').textContent = state.source;
}

function renderPatchMap() {
  const map = $('#patch-map');
  map.replaceChildren();
  const bitBlocks = CHAIN.filter(b => b.bit);
  for (let g = 0; g < 4; g++) {
    const group = h('div', 'pm-group');
    const grid = h('div', 'pm-grid');
    group.append(h('h3', '', `Group ${g + 1}`), grid);
    for (let i = 0; i < 16; i++) {
      const n = g * 16 + i;
      const values = state.library[n];
      const cell = h('button', `pm-cell${n === state.current ? ' current' : ''}`);
      cell.type = 'button';
      cell.title = `Patch ${patchLabel(n)}`;
      cell.append(h('span', '', `${Math.floor(i / 4) + 1}-${(i % 4) + 1}`));
      const dots = h('span', 'pm-dots');
      for (const block of bitBlocks) {
        const dot = h('span', 'pm-dot');
        if (values.effects_on & bitOf(block.bit)) dot.style.background = SKINS[block.skin(values)].body;
        dots.append(dot);
      }
      cell.append(dots);
      cell.addEventListener('click', () => selectPatch(n));
      grid.append(cell);
    }
    map.append(group);
  }
}

function renderStatus() {
  const btn = $('#conn-status');
  btn.classList.toggle('online', Boolean(state.conn));
  $('#conn-text').textContent = state.conn ? state.conn.output : 'Offline';
  $('#lib-read').disabled = !state.conn;
}

function renderAll() {
  renderDisplay();
  renderPatchMap();
  renderChain();
}

// ---------------------------------------------------------------- library actions

async function writePatch({ auto = false } = {}) {
  // Capture now: the user may switch patch while the write is on its way.
  const n = state.current;
  const values = { ...state.values };
  const label = patchLabel(n);
  // Turning auto write on is the consent - no dialog then.
  if (state.conn && !auto && !state.autoWrite && !confirm(`Overwrite patch ${label} on the ME-5?`)) return;
  cancelAutoWrite();
  try {
    if (state.conn) {
      const { data } = await api('/api/patch/encode', { values, patch_number: n });
      await sendMidi(data);
    }
    state.library[n] = values;
    renderPatchMap();
    refreshIndicators();
    const where = state.conn ? label : `${label} (editor only - offline)`;
    toast(auto ? `Auto-written to ${where}` : `Written to ${where}`);
  } catch (e) {
    toast(`${auto ? 'Auto write' : 'Write'} failed: ${e.message}`, 'error');
  }
}

function revert() {
  cancelAutoWrite();
  state.values = { ...state.original };
  setValues({});
  renderChain();
  // An auto write may already have stored the edit - put the original back right away.
  if (state.autoWrite && isDirty()) writePatch({ auto: true });
}

async function loadFactory() {
  try {
    setLibrary((await api('/api/factory')).patches, 'Factory patches');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function readFromMe5() {
  const btn = $('#lib-read');
  btn.disabled = true;
  btn.textContent = 'Reading…';
  try {
    setLibrary((await api('/api/dump/read', state.conn)).patches, 'Read from ME-5');
    toast('Read 64 patches from the ME-5');
  } catch (e) {
    toast(`Read failed: ${e.message}`, 'error');
  } finally {
    btn.textContent = 'Read ME-5';
    renderStatus();
  }
}

async function openFileDialog(mode) {
  const dlg = $('#file-dialog');
  const list = $('#file-list');
  const name = $('#file-name');
  $('#file-title').textContent = mode === 'save' ? 'Save patches to file' : 'Load patches from file';
  $('#file-name-row').hidden = mode !== 'save';
  $('#file-ok').hidden = mode !== 'save';
  list.replaceChildren(h('li', 'hint', 'Loading…'));
  dlg.showModal();

  let files = [];
  try {
    files = (await api('/api/files')).files;
  } catch (e) {
    list.replaceChildren(h('li', 'hint', e.message));
    return;
  }
  list.replaceChildren();
  if (!files.length) list.append(h('li', 'hint', 'No files yet.'));
  for (const f of files) {
    const li = h('li');
    const b = h('button');
    b.type = 'button';
    b.append(h('span', '', f.name), h('span', 'hint', new Date(f.lastmod * 1000).toLocaleString()));
    b.addEventListener('click', () => (mode === 'save' ? (name.value = f.name) : loadFile(f.name)));
    li.append(b);
    list.append(li);
  }
  if (mode === 'save') {
    name.value ||= 'my-patches.syx';
    name.focus();
  }
}

async function loadFile(filename) {
  try {
    const { data } = await api('/api/files/load', { filename });
    const { patches } = await api('/api/patch/decode', { data });
    setLibrary(patches, `File · ${filename}`);
    $('#file-dialog').close();
    toast(`Loaded ${filename}`);
  } catch (e) {
    toast(`Load failed: ${e.message}`, 'error');
  }
}

async function saveFile() {
  let filename = $('#file-name').value.trim();
  if (!filename) return;
  if (!/\.syx$/i.test(filename)) filename += '.syx';
  try {
    const encoded = await Promise.all(state.library.map((values, i) =>
      api('/api/patch/encode', { values, patch_number: i })));
    await api('/api/files/save', { filename, data: encoded.flatMap(m => m.data) });
    $('#file-dialog').close();
    toast(`Saved ${filename}${isDirty() ? ' (unwritten edits not included)' : ''}`);
  } catch (e) {
    toast(`Save failed: ${e.message}`, 'error');
  }
}

async function openConnDialog() {
  const dlg = $('#conn-dialog');
  const msg = $('#conn-msg');
  msg.textContent = '';
  dlg.showModal();
  try {
    const { outputs, inputs } = await api('/api/ports');
    for (const [id, ports, current] of [['#port-out', outputs, state.conn?.output], ['#port-in', inputs, state.conn?.input]]) {
      const select = $(id);
      select.replaceChildren(...ports.map(p => {
        const o = h('option', '', p.name);
        o.selected = p.name === current;
        return o;
      }));
    }
    if (!outputs.length) msg.textContent = 'No MIDI ports found - is the interface plugged in?';
  } catch (e) {
    msg.textContent = e.message;
  }
}

async function autoDetect() {
  const btn = $('#conn-detect');
  btn.disabled = true;
  $('#conn-msg').textContent = 'Searching every port pair…';
  try {
    connect(await api('/api/detect', {}));
  } catch (e) {
    $('#conn-msg').textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------- wiring

function wire() {
  $('#prev').addEventListener('click', () => selectPatch(state.current - 1));
  $('#next').addEventListener('click', () => selectPatch(state.current + 1));
  $('#store').addEventListener('click', writePatch);
  $('#revert').addEventListener('click', revert);
  $('#auto-write').addEventListener('change', e => setAutoWrite(e.target.checked));
  $('#lib-factory').addEventListener('click', loadFactory);
  $('#lib-load').addEventListener('click', () => openFileDialog('load'));
  $('#lib-save').addEventListener('click', () => openFileDialog('save'));
  $('#file-ok').addEventListener('click', saveFile);
  $('#file-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveFile(); }
  });
  $('#lib-read').addEventListener('click', readFromMe5);
  $('#conn-status').addEventListener('click', openConnDialog);
  $('#conn-detect').addEventListener('click', autoDetect);
  $('#conn-use').addEventListener('click', () => {
    const output = $('#port-out').value;
    const input = $('#port-in').value;
    if (output) connect({ output, input });
  });
  $('#conn-disconnect').addEventListener('click', () => connect(null));

  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]') || e.target.closest('input, select, textarea')) return;
    if (e.key === 'ArrowLeft') selectPatch(state.current - 1);
    if (e.key === 'ArrowRight') selectPatch(state.current + 1);
  });
}

async function init() {
  wire();
  try { state.autoWrite = localStorage.getItem(AUTO_WRITE_KEY) === '1'; } catch { /* storage blocked */ }
  $('#auto-write').checked = state.autoWrite;
  renderStatus();
  try {
    state.meta = await api('/api/params');
    state.byKey = Object.fromEntries(state.meta.params.map(p => [p.key, p]));
    setLibrary((await api('/api/factory')).patches, 'Factory patches');
  } catch (e) {
    $('#chain').replaceChildren(h('p', 'fatal',
      `Can't reach the backend (${e.message}). Start it with the "Backend: Start FastAPI server" task, then open http://localhost:8000/`));
  }
}

init();
