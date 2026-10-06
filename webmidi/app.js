'use strict';

// Web MIDI build of frontend/app.js: same UI, but patch encoding (me5.js) and MIDI
// (midi.js) run in the browser, and files go through download / file picker.
const MIDI_CHANNELS = 16;
const PROGRAM_CHANGE = 0xC0;
const CONN_KEY = 'me5.webmidi.conn';

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
  meta: ME5.meta,  // parameter map (same shape as the Python backend's /api/params)
  factory: null,   // the 64 factory patches, decoded once
  byKey: {},
  library: [],     // 64 x {param: value}
  invalid: new Set(), // patch numbers that held garbage on the ME-5 (library has the factory sound there)
  source: '',
  current: 0,
  values: null,    // the sound being edited (ME-5 temp buffer)
  conn: null,      // {output, input, channel} when talking to a real ME-5; channel 0-15 is also the SysEx device ID
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
    pending.then(() => sendMidi([PROGRAM_CHANGE | state.conn.channel, program])).catch(e => toast(e.message, 'error'));
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
  state.invalid = new Set(patches.filter(p => p.invalid).map(p => p.patch_number));
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

function sendTemp() {
  if (!state.conn) return;
  try {
    sendMidi(ME5.encodePatch(state.values, null, state.conn.channel));
  } catch (e) {
    toast(`Send failed: ${e.message}`, 'error');
  }
}

const sendMidi = data => Midi.send(state.conn.output, data);

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

function connect(ports, { quiet = false } = {}) {
  state.conn = ports;
  try {
    if (ports) localStorage.setItem(CONN_KEY, JSON.stringify(ports)); else localStorage.removeItem(CONN_KEY);
  } catch { /* storage blocked */ }
  renderStatus();
  $('#conn-dialog').close();
  if (!quiet) toast(ports ? 'Connected. Press "Read ME-5" to pull its patches.' : 'Offline - edits stay in the editor.');
}

// Reconnect to last session's ports if they are plugged in. Only asks the browser
// for MIDI when there was a connection before, so a first visit gets no prompt.
async function restoreConnection() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(CONN_KEY)); } catch { /* storage blocked */ }
  if (!saved?.output) return;
  try {
    await Midi.init();
    watchPorts();
    if (Midi.outputs().some(p => p.name === saved.output)) {
      state.conn = saved;
      renderStatus();
      toast(`Reconnected to ${saved.output} · ch ${saved.channel + 1}`);
    }
  } catch { /* stay offline; the connection dialog shows the reason */ }
}

let watching = false;
function watchPorts() {
  if (watching) return;
  watching = true;
  Midi.onPortsChanged(() => {
    if (state.conn && !Midi.outputs().some(p => p.name === state.conn.output)) {
      state.conn = null; // keep the saved ports, so plugging back in + reload reconnects
      renderStatus();
      toast('MIDI interface unplugged - offline', 'error');
    }
    if ($('#conn-dialog').open) fillPortLists();
  });
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
      const invalid = state.invalid.has(n);
      const cell = h('button', `pm-cell${n === state.current ? ' current' : ''}${invalid ? ' invalid' : ''}`);
      cell.type = 'button';
      cell.title = `Patch ${patchLabel(n)}${invalid ? ' - invalid data on the ME-5, factory sound loaded' : ''}`;
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
  renderRepair();
}

function renderRepair() {
  const btn = $('#lib-repair');
  btn.hidden = !state.conn || !state.invalid.size;
  btn.textContent = `Repair ${state.invalid.size}`;
}

function renderStatus() {
  const btn = $('#conn-status');
  btn.classList.toggle('online', Boolean(state.conn));
  $('#conn-text').textContent = state.conn ? `${state.conn.output} · ch ${state.conn.channel + 1}` : 'Offline';
  $('#lib-read').disabled = !state.conn;
  renderRepair();
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
    if (state.conn) sendMidi(ME5.encodePatch(values, n, state.conn.channel));
    state.library[n] = values;
    state.invalid.delete(n);
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

function loadFactory() {
  setLibrary(state.factory, 'Factory patches');
}

async function readFromMe5() {
  const btn = $('#lib-read');
  btn.disabled = true;
  btn.textContent = 'Reading…';
  try {
    setLibrary(await Midi.readDump(state.conn, state.factory), 'Read from ME-5');
    const bad = state.invalid.size;
    toast(bad
      ? `Read 64 patches - ${bad} held invalid data and show the factory sound. Repair writes it back.`
      : 'Read 64 patches from the ME-5', bad ? 'error' : '');
  } catch (e) {
    toast(`Read failed: ${e.message}`, 'error');
  } finally {
    btn.textContent = 'Read ME-5';
    renderStatus();
  }
}

// Writes the factory sound the editor shows for each invalid patch onto the ME-5.
async function repairInvalid() {
  const todo = [...state.invalid].sort((a, b) => a - b);
  if (!state.conn || !todo.length) return;
  if (!confirm(`Write the factory sound into the ${todo.length} invalid patches on the ME-5?`)) return;
  const btn = $('#lib-repair');
  btn.disabled = true;
  try {
    for (const n of todo) {
      btn.textContent = `Repairing ${patchLabel(n)}…`;
      sendMidi(ME5.encodePatch(state.library[n], n, state.conn.channel));
      state.invalid.delete(n);
      await new Promise(r => setTimeout(r, 100)); // give the pedal time to store it
    }
    toast(`Repaired ${todo.length} patches`);
  } catch (e) {
    toast(`Repair failed: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    renderPatchMap();
  }
}

// ---------------------------------------------------------------- files
// No server to keep a folder of .syx files: loading uses the browser's file
// picker, saving downloads the file (or asks where to save, where supported).

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const patches = ME5.decodeDump(new Uint8Array(reader.result));
      setLibrary(patches, `File · ${file.name}`);
      toast(`Loaded ${file.name}`);
    } catch (e) {
      toast(`Load failed: ${e.message}`, 'error');
    }
  };
  reader.onerror = () => toast(`Load failed: ${reader.error?.message}`, 'error');
  reader.readAsArrayBuffer(file);
}

function openSaveDialog() {
  const name = $('#file-name');
  name.value ||= 'my-patches.syx';
  $('#file-dialog').showModal();
  name.focus();
  name.select();
}

async function saveFile() {
  let filename = $('#file-name').value.trim();
  if (!filename) return;
  if (!/\.syx$/i.test(filename)) filename += '.syx';
  try {
    const data = new Uint8Array(state.library.flatMap((values, i) => ME5.encodePatch(values, i)));
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const a = h('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $('#file-dialog').close();
    toast(`Saved ${filename}${isDirty() ? ' (unwritten edits not included)' : ''}`);
  } catch (e) {
    toast(`Save failed: ${e.message}`, 'error');
  }
}

// ---------------------------------------------------------------- connection

function fillPortLists() {
  const outputs = Midi.outputs();
  const inputs = Midi.inputs();
  for (const [id, ports, current] of [['#port-out', outputs, state.conn?.output], ['#port-in', inputs, state.conn?.input]]) {
    const select = $(id);
    const keep = select.value || current;
    select.replaceChildren(...ports.map(p => {
      const o = h('option', '', p.name);
      o.selected = p.name === keep;
      return o;
    }));
  }
  $('#conn-msg').textContent = outputs.length ? '' : 'No MIDI ports found - is the interface plugged in?';
}

async function openConnDialog() {
  const dlg = $('#conn-dialog');
  const msg = $('#conn-msg');
  msg.textContent = 'Asking the browser for MIDI access…';
  const channel = state.conn?.channel ?? 0;
  $('#port-channel').replaceChildren(...Array.from({ length: MIDI_CHANNELS }, (_, i) => {
    const o = h('option', '', String(i + 1));
    o.value = i;
    o.selected = i === channel;
    return o;
  }));
  $('#port-out').replaceChildren();
  $('#port-in').replaceChildren();
  dlg.showModal();
  try {
    await Midi.init();
    watchPorts();
    fillPortLists();
  } catch (e) {
    msg.textContent = e.message;
  }
}

async function autoDetect() {
  const btn = $('#conn-detect');
  btn.disabled = true;
  $('#conn-msg').textContent = 'Searching every port and channel…';
  try {
    await Midi.init();
    const found = await Midi.detectMe5();
    if (found) connect(found);
    else $('#conn-msg').textContent = 'ME-5 not found on any MIDI port. Is it in Play mode (not Edit)?';
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
  $('#lib-load').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', e => {
    const [file] = e.target.files;
    e.target.value = ''; // picking the same file again still fires change
    if (file) loadFile(file);
  });
  $('#lib-save').addEventListener('click', openSaveDialog);
  $('#file-ok').addEventListener('click', saveFile);
  $('#file-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveFile(); }
  });
  $('#lib-read').addEventListener('click', readFromMe5);
  $('#lib-repair').addEventListener('click', repairInvalid);
  $('#conn-status').addEventListener('click', openConnDialog);
  $('#conn-detect').addEventListener('click', autoDetect);
  $('#conn-use').addEventListener('click', () => {
    const output = $('#port-out').value;
    const input = $('#port-in').value;
    const channel = Number($('#port-channel').value);
    if (output) connect({ output, input, channel });
  });
  $('#conn-disconnect').addEventListener('click', () => connect(null));

  // Drop a .syx file anywhere on the page to load it.
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]') || e.target.closest('input, select, textarea')) return;
    if (e.key === 'ArrowLeft') selectPatch(state.current - 1);
    if (e.key === 'ArrowRight') selectPatch(state.current + 1);
  });
}

function init() {
  wire();
  try { state.autoWrite = localStorage.getItem(AUTO_WRITE_KEY) === '1'; } catch { /* storage blocked */ }
  $('#auto-write').checked = state.autoWrite;
  state.byKey = Object.fromEntries(state.meta.params.map(p => [p.key, p]));
  state.factory = ME5.factoryPatches();
  setLibrary(state.factory, 'Factory patches');
  renderStatus();
  restoreConnection();
}

init();
