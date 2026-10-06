'use strict';

// Web MIDI access for the ME-5 editor - the browser-side replacement for
// backend/app/midi_service.py (python-rtmidi). The browser talks to the
// interface directly, so no local server is involved.
//
// SysEx needs explicit permission: requestMIDIAccess({ sysex: true }) makes the
// browser ask the user once. Supported in Chrome/Edge/Opera (desktop and
// Android) and in Firefox; not in Safari / iOS.

const Midi = (() => {
  const DEFAULT_TIMEOUT_MS = 200;
  let access = null;

  async function init() {
    if (!navigator.requestMIDIAccess) {
      throw new Error('This browser has no Web MIDI - use Chrome or Edge (Safari and iOS do not support it).');
    }
    if (!access) {
      try {
        access = await navigator.requestMIDIAccess({ sysex: true });
      } catch (e) {
        throw new Error(`MIDI access denied (${e.name}). Allow "MIDI devices" / SysEx for this page in the site settings.`);
      }
    }
    return access;
  }

  const outputs = () => [...access.outputs.values()];
  const inputs = () => [...access.inputs.values()];
  const byName = (ports, name) => ports.find(p => p.name === name);

  // Called with no arguments when ports come and go (interface plugged in or out).
  function onPortsChanged(handler) {
    if (access) access.onstatechange = () => handler();
  }

  function findPorts({ output, input }) {
    const out = byName(outputs(), output);
    if (!out) throw new Error(`output port not found: ${output}`);
    const inp = input ? byName(inputs(), input) : null;
    if (input && !inp) throw new Error(`input port not found: ${input}`);
    return { out, inp };
  }

  // Fire-and-forget send (Program Change, DT1 edit-buffer updates and patch writes).
  function send(outputName, data) {
    findPorts({ output: outputName }).out.send(data);
  }

  // Send `messages` to `out` and collect the SysEx that arrives on `ins` until
  // nothing new has come for timeoutMs (like `amidi -d`, the wait restarts on
  // every reply), or until stopWhen(bytesSoFar) says enough. Channel messages
  // and realtime bytes the pedal sends meanwhile are dropped.
  async function sendAndCollect(out, ins, messages, { timeoutMs = DEFAULT_TIMEOUT_MS, stopWhen } = {}) {
    await out.open();
    // An input another program holds open can't be opened on Windows - listen on the rest.
    const opened = await Promise.allSettled(ins.map(i => i.open()));
    ins = ins.filter((_, k) => opened[k].status === 'fulfilled');
    if (!ins.length) throw new Error('could not open any MIDI input - is another program using it?');
    const received = new Map(ins.map(i => [i, []]));
    return new Promise(resolve => {
      let timer;
      const finish = () => {
        clearTimeout(timer);
        for (const i of ins) i.removeEventListener('midimessage', handlers.get(i));
        resolve(received);
      };
      const restart = () => { clearTimeout(timer); timer = setTimeout(finish, timeoutMs); };
      const handlers = new Map(ins.map(i => [i, e => {
        if (e.data[0] !== 0xF0) return;
        const bytes = received.get(i);
        for (const b of e.data) bytes.push(b);
        if (stopWhen && stopWhen(bytes)) finish(); else restart();
      }]));
      for (const i of ins) i.addEventListener('midimessage', handlers.get(i));
      for (const m of messages) out.send(m);
      restart();
    });
  }

  async function request(conn, data, options) {
    const { out, inp } = findPorts(conn);
    if (!inp) throw new Error('no input port selected - SysEx replies need one');
    return (await sendAndCollect(out, [inp], [data], options)).get(inp);
  }

  // Find the port pair and channel the ME-5 answers on. The pedal only answers
  // SysEx addressed to its own channel, so the identity request goes out on all
  // 16, and the reply's device ID says which one it is on.
  //
  // Unlike the Python version, this listens on every input at once, so it costs
  // one ~200 ms wait per output instead of one per output x input pair.
  async function detectMe5() {
    const requests = Array.from({ length: ME5.MIDI_CHANNELS }, (_, ch) => ME5.identityRequest(ch));
    for (const out of outputs()) {
      let replies;
      try {
        replies = await sendAndCollect(out, inputs(), requests);
      } catch {
        continue; // port busy (e.g. held by another program) or vanished
      }
      for (const [inp, bytes] of replies) {
        const channel = ME5.replyChannel(bytes);
        if (channel !== null) return { output: out.name, input: inp.name, channel };
      }
    }
    return null;
  }

  // All 64 patches; patches the pedal holds garbage in come back as `fallback`
  // (the factory sound) flagged "invalid", so the rest can still be edited.
  async function readDump(conn, fallback) {
    const bytes = await request(conn, ME5.dumpRequest(conn.channel), {
      timeoutMs: 500,
      stopWhen: b => b.length >= ME5.DUMP_LENGTH,
    });
    if (bytes.length < ME5.DUMP_LENGTH) {
      throw new Error(`expected ${ME5.DUMP_LENGTH} bytes from the ME-5, got ${bytes.length}`);
    }
    return ME5.decodeDumpRepairing(bytes.slice(0, ME5.DUMP_LENGTH), fallback);
  }

  return { init, outputs, inputs, onPortsChanged, send, detectMe5, readDump };
})();
