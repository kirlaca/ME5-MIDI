'use strict';

// ME-5 patch parameter map and DT1 patch encoding/decoding - a straight port of
// backend/app/me5_params.py, so the browser needs no backend.
//
// Patch format: 35-byte DT1 message
//     F0 41 <dev> 1F 12 <addr MSB> <addr LSB> <26 data bytes> <checksum> F7
//
// <dev> is the Roland device ID, which on the ME-5 is its MIDI channel - 1
// (0x00-0x0F): the pedal ignores SysEx sent to any other device ID.
//
// Unlike the standard Roland scheme, the ME-5 checksum covers only the 26
// data bytes, not the address - all 64 factory patches verify this way.

const ME5 = (() => {
  const SOX = 0xF0;
  const EOX = 0xF7;
  const ROLAND_ID = 0x41;
  const MODEL_ID = 0x1F;
  const CMD_RQ1 = 0x11;
  const CMD_DT1 = 0x12;

  const MIDI_CHANNELS = 16; // 0-15 = MIDI channel 1-16, also the SysEx device ID
  // Patch files are written with device ID 0, as in the factory dump, so they
  // don't depend on the channel of the pedal they came from.
  const FILE_CHANNEL = 0;

  const PARAM_COUNT = 26;
  const PATCH_MESSAGE_LENGTH = 35; // header(5) + address(2) + data(26) + checksum + EOX
  const PATCH_COUNT = 64;
  const DUMP_LENGTH = PATCH_COUNT * PATCH_MESSAGE_LENGTH;
  const TEMP_ADDRESS = [0x00, 0x00]; // edit buffer - what the pedal is playing right now

  // Bits of the effect on/off byte (address 0x00).
  const EFFECT_BITS = { compressor: 0x01, overdrive: 0x02, equalizer: 0x04, modulation: 0x08, reverb: 0x10 };

  const REVERB_MODE_DELAY = 5;
  const REVERB_TIME_MAX = 14;
  const DELAY_TIME_MAX = 49;

  const LIST_0_TO_12 = ['0.0', '1.0', '1.5', '2.0', '2.5', '3.0', '3.5', '4.0', '4.5', '5.0', '5.5', '6.0', '7.0'];
  // Time labels as shown by the original editor (units not documented there).
  const DELAY_TIME_LABELS = [
    '0.1', '0.2', '0.3', '0.4', '0.5', '0.6', '0.7', '0.8', '0.9', '1.0', '1.2', '1.5', '2.0', '2.5', '3.0',
    '3.5', '4.0', '4.5', '5.0', '5.5', '6.0', '6.5', '7.0', '7.5', '8.0', '8.5', '9.0', '9.5', '10', '11',
    '12', '14', '16', '18', '20', '22', '24', '26', '28', '30', '32', '34', '36', '38', '40',
    '42', '44', '46', '48', '50',
  ];
  const REVERB_TIME_LABELS = Array.from({ length: REVERB_TIME_MAX + 1 }, (_, v) => (v / 2).toFixed(1));

  const range = n => Array.from({ length: n + 1 }, (_, v) => v);
  const signed6 = max => range(max).map(v => (v === 6 ? '0' : `${v > 6 ? '+' : ''}${v - 6}`));
  const tenths = max => range(max).map(v => (v / 10).toFixed(1));

  const param = (address, key, block, name, max, labels = null) => ({ address, key, block, name, min: 0, max, labels });

  const PARAMS = [
    param(0x00, 'effects_on', 'global', 'Effects on/off (bitfield)', 0x1F),
    param(0x01, 'comp_sustain', 'compressor', 'Sustain', 12, LIST_0_TO_12),
    param(0x02, 'comp_attack', 'compressor', 'Attack', 7),
    param(0x03, 'comp_tone', 'compressor', 'Tone', 12, signed6(12)),
    param(0x04, 'comp_level', 'compressor', 'Level', 12, LIST_0_TO_12),
    param(0x05, 'od_mode', 'overdrive', 'Mode', 2, ['Normal OD', 'Heavy OD', 'Distortion']),
    param(0x06, 'od_drive', 'overdrive', 'Drive', 7),
    param(0x07, 'od_level', 'overdrive', 'Level', 7),
    param(0x08, 'eq_high', 'equalizer', 'High', 12, signed6(12)),
    param(0x09, 'eq_mid_freq', 'equalizer', 'Mid frequency', 2, ['0.5 kHz', '1.0 kHz', '2.0 kHz']),
    param(0x0A, 'eq_mid', 'equalizer', 'Mid', 12, signed6(12)),
    param(0x0B, 'eq_low', 'equalizer', 'Low', 12, signed6(12)),
    param(0x0C, 'eq_level', 'equalizer', 'Level', 12, signed6(12)),
    param(0x0D, 'mod_mode', 'modulation', 'Mode', 4,
      ['Chorus', 'Flanger freq=1', 'Flanger freq=2', 'Flanger freq=3', 'Flanger freq=4']),
    param(0x0E, 'mod_rate', 'modulation', 'Rate', 70, tenths(70)),
    param(0x0F, 'mod_depth', 'modulation', 'Depth', 12, LIST_0_TO_12),
    param(0x10, 'mod_resonance', 'modulation', 'Resonance', 12, LIST_0_TO_12),
    param(0x11, 'mod_level', 'modulation', 'Level', 12, LIST_0_TO_12),
    param(0x12, 'ns_threshold', 'global', 'Noise suppressor threshold', 7),
    param(0x13, 'send_return', 'global', 'Send/Return', 1, ['OFF', 'ON']),
    param(0x14, 'rev_mode', 'reverb', 'Mode', 5, ['Room', 'Hall 15m', 'Hall 30m', 'Plate', 'Gated', 'Delay']),
    // Max depends on rev_mode: 14 for reverb modes, 49 for delay (see validatePatch).
    param(0x15, 'rev_time', 'reverb', 'Time', DELAY_TIME_MAX),
    param(0x16, 'rev_delay_feedback', 'reverb', 'Delay feedback', 7),
    param(0x17, 'rev_tone', 'reverb', 'Tone', 7),
    param(0x18, 'rev_level', 'reverb', 'Level', 12, LIST_0_TO_12),
    param(0x19, 'master_level', 'global', 'Master level', 70, tenths(70)),
  ];
  const PARAMS_BY_KEY = Object.fromEntries(PARAMS.map(p => [p.key, p]));
  console.assert(PARAMS.every((p, i) => p.address === i) && PARAMS.length === PARAM_COUNT);

  class PatchError extends Error {}

  // The `& 0x7F` matters: the original JS returned 128 (not a valid SysEx byte)
  // when the sum was a multiple of 128.
  const checksum = data => (128 - (data.reduce((a, b) => a + b, 0) & 0x7F)) & 0x7F;

  // Memory address of patch 0-63 (1-1-1 .. 4-4-4). Patches are 0x20 apart
  // starting at 10 00, in 7-bit address bytes.
  function patchAddress(n) {
    if (!(Number.isInteger(n) && n >= 0 && n < PATCH_COUNT)) throw new PatchError(`patch number out of range 0-63: ${n}`);
    return [0x10 + Math.floor(n / 4), (n % 4) << 5];
  }

  function patchNumberFromAddress(msb, lsb) {
    if (msb === TEMP_ADDRESS[0] && lsb === TEMP_ADDRESS[1]) return null;
    const n = (msb - 0x10) * 4 + (lsb >> 5);
    if (msb < 0x10 || lsb & 0x1F || n < 0 || n >= PATCH_COUNT) {
      throw new PatchError(`not a patch address: ${hex(msb)} ${hex(lsb)}`);
    }
    return n;
  }

  const hex = b => b.toString(16).toUpperCase().padStart(2, '0');

  // 0 -> '1-1-1', 63 -> '4-4-4' (group-bank-number, as on the pedal).
  const patchLabel = n => `${Math.floor(n / 16) + 1}-${Math.floor((n % 16) / 4) + 1}-${(n % 4) + 1}`;

  function paramMax(key, values) {
    if (key === 'rev_time') return values.rev_mode === REVERB_MODE_DELAY ? DELAY_TIME_MAX : REVERB_TIME_MAX;
    return PARAMS_BY_KEY[key].max;
  }

  function validatePatch(values) {
    const missing = PARAMS.filter(p => !(p.key in values)).map(p => p.key);
    if (missing.length) throw new PatchError(`missing parameters: ${missing.join(', ')}`);
    const unknown = Object.keys(values).filter(k => !(k in PARAMS_BY_KEY));
    if (unknown.length) throw new PatchError(`unknown parameters: ${unknown.join(', ')}`);
    for (const p of PARAMS) {
      const value = values[p.key];
      const limit = paramMax(p.key, values);
      if (!Number.isInteger(value) || value < 0 || value > limit) {
        throw new PatchError(`${p.key} out of range 0-${limit}: ${value}`);
      }
    }
  }

  function header(channel) {
    if (!(Number.isInteger(channel) && channel >= 0 && channel < MIDI_CHANNELS)) {
      throw new PatchError(`MIDI channel must be 0-15, got ${channel}`);
    }
    return [SOX, ROLAND_ID, channel, MODEL_ID];
  }

  // Full 64-patch dump request - what the original editor's ME5readall() sent
  // (size 7F 7F = "everything", checksum left at 00).
  const dumpRequest = channel => [...header(channel), CMD_RQ1, 0x10, 0x00, 0x7F, 0x7F, 0x00, EOX];

  // Roland/Boss "identity request" - the bytes the original detect_ME5.php sent
  // (a read of patch 1-1-1), with the device ID set to `channel`.
  const identityRequest = channel => [...header(channel), CMD_RQ1, 0x10, 0x00, 0x00, 0x19, 0x00, EOX];

  // patchNumber=null writes the temp/edit buffer, 0-63 writes (stores) that patch.
  function encodePatch(values, patchNumber = null, channel = FILE_CHANNEL) {
    validatePatch(values);
    const address = patchNumber === null ? TEMP_ADDRESS : patchAddress(patchNumber);
    const data = PARAMS.map(p => values[p.key]);
    return [...header(channel), CMD_DT1, ...address, ...data, checksum(data), EOX];
  }

  function decodePatch(message, verifyChecksum = true) {
    if (message.length !== PATCH_MESSAGE_LENGTH) {
      throw new PatchError(`patch message must be ${PATCH_MESSAGE_LENGTH} bytes, got ${message.length}`);
    }
    // Any device ID: dumps carry the channel of the pedal they came from.
    if (message[0] !== SOX || message[1] !== ROLAND_ID || message[2] >= MIDI_CHANNELS
      || message[3] !== MODEL_ID || message[4] !== CMD_DT1 || message[34] !== EOX) {
      throw new PatchError('not an ME-5 DT1 message');
    }
    const data = Array.from(message.slice(7, 7 + PARAM_COUNT));
    if (verifyChecksum && checksum(data) !== message[33]) {
      throw new PatchError(`checksum mismatch: expected ${hex(checksum(data))}, got ${hex(message[33])}`);
    }
    const values = Object.fromEntries(PARAMS.map((p, i) => [p.key, data[i]]));
    validatePatch(values);
    const patchNumber = patchNumberFromAddress(message[5], message[6]);
    return { patch_number: patchNumber, patch_label: patchNumber === null ? null : patchLabel(patchNumber), values };
  }

  // Split a concatenation of patch messages (e.g. the 2240-byte full dump) and decode each one.
  function decodeDump(dump, verifyChecksum = true) {
    if (dump.length % PATCH_MESSAGE_LENGTH) {
      throw new PatchError(`dump length ${dump.length} is not a multiple of ${PATCH_MESSAGE_LENGTH}`);
    }
    const patches = [];
    for (let i = 0; i < dump.length; i += PATCH_MESSAGE_LENGTH) {
      patches.push(decodePatch(dump.slice(i, i + PATCH_MESSAGE_LENGTH), verifyChecksum));
    }
    return patches;
  }

  // decodeDump for a full dump read from a pedal: a patch that does not decode
  // (e.g. garbage left by a flat backup battery) is replaced with fallback[slot]
  // and flagged with invalid: <reason>, instead of failing the whole read.
  function decodeDumpRepairing(dump, fallback) {
    if (dump.length !== DUMP_LENGTH) throw new PatchError(`expected a ${DUMP_LENGTH}-byte dump, got ${dump.length} bytes`);
    const patches = [];
    for (let slot = 0; slot < PATCH_COUNT; slot++) {
      const message = dump.slice(slot * PATCH_MESSAGE_LENGTH, (slot + 1) * PATCH_MESSAGE_LENGTH);
      let patch;
      try {
        patch = decodePatch(message);
        if (patch.patch_number !== slot) {
          throw new PatchError(`patch ${patch.patch_label} arrived in slot ${patchLabel(slot)}`);
        }
      } catch (e) {
        if (!(e instanceof PatchError)) throw e;
        patch = { ...fallback[slot], patch_number: slot, patch_label: patchLabel(slot), invalid: e.message };
      }
      patches.push(patch);
    }
    return patches;
  }

  // Device ID (= channel) of the first ME-5 DT1 reply (F0 41 <dev> 1F 12) in `bytes`, or null.
  function replyChannel(bytes) {
    for (let i = 0; i + 4 < bytes.length; i++) {
      if (bytes[i] === SOX && bytes[i + 1] === ROLAND_ID && bytes[i + 2] < MIDI_CHANNELS
        && bytes[i + 3] === MODEL_ID && bytes[i + 4] === CMD_DT1) return bytes[i + 2];
    }
    return null;
  }

  function base64Bytes(b64) {
    const bin = atob(b64);
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  }

  // Same shape as the Python backend's /api/params, which the editor UI was built on.
  const meta = {
    params: PARAMS,
    effect_bits: EFFECT_BITS,
    reverb_mode_delay: REVERB_MODE_DELAY,
    reverb_time_max: REVERB_TIME_MAX,
    delay_time_max: DELAY_TIME_MAX,
    reverb_time_labels: REVERB_TIME_LABELS,
    delay_time_labels: DELAY_TIME_LABELS,
  };

  return {
    MIDI_CHANNELS, PATCH_COUNT, DUMP_LENGTH, PatchError, meta,
    checksum, patchLabel, encodePatch, decodePatch, decodeDump, decodeDumpRepairing,
    dumpRequest, identityRequest, replyChannel,
    factoryPatches: () => decodeDump(base64Bytes(FACTORY_SYX_BASE64)),
  };
})();
