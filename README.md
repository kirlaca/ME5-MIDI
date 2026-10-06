# ME-5 MIDI Editor

A pedalboard-style patch editor for the **BOSS ME-5 Guitar Multiple Effects** (1988), controlled over MIDI SysEx from a computer or phone.

**Open it in the browser:** https://kirlaca.github.io/ME5-MIDI/

No install needed: the editor runs entirely in Chrome or Edge using the Web MIDI API.

## What it does

- Shows the ME-5 as a virtual pedalboard in the pedal's own signal order: Compressor → OD/Distortion → EQ → Chorus/Flanger → Send/Return → Noise Suppressor → Reverb/Delay → Master. Each block looks like the BOSS compact pedal it is based on (CS-2, OD-2 / OD-2 Turbo / DS-1, GE-7, CE-2 / BF-2, NS-2, RV-2 / DD-2).
- Changes are sent to the pedal live, so you hear them immediately.
- Reads all 64 patches from the pedal, writes single patches back, and switches patches with Program Change.
- Patch map of all 64 slots. Corrupt slots (for example after a flat backup battery) are marked and can be repaired.
- Saves and loads full dumps as `.syx` files.
- Includes the factory patches, so the editor also works without a pedal, and a "Factory reset" that writes all of them back to the ME-5.

## What you need

- A BOSS ME-5.
- A USB-MIDI interface connected to both MIDI IN and MIDI OUT of the pedal. Use a decent one: cheap no-name adapters often pass Program Change but drop SysEx. Tested with a DOREMiDi interface.
- Chrome or Edge on desktop or Android. Safari and iOS do not support Web MIDI.

## Using it

1. Connect the interface and put the ME-5 in **Play mode**. In Edit mode the pedal ignores SysEx.
2. Open the editor and allow MIDI / SysEx access when the browser asks.
3. Use auto-detect, or pick the MIDI ports and the channel yourself. The SysEx device ID is the pedal's MIDI channel − 1, and detection finds it automatically.
4. Press **Read ME-5** to load the patches from the pedal.

User guides: [English](webmidi/guide.html) · [Magyar](webmidi/utmutato.html). They can also be opened from the editor's header.

## Repository layout

| Path | What it is |
|---|---|
| `webmidi/` | **The main editor.** Plain HTML/CSS/JS, no build step, no server. Published on GitHub Pages. |
| `index.html` | GitHub Pages entry point; redirects to `webmidi/`. |
| `backend/`, `frontend/` | The same editor running on a local Python backend (FastAPI + python-rtmidi). Windows, optional. |
| `syx/original_ME-5.syx` | The factory dump (64 patches). |
| `HASZNALATI_UTASITAS.md`, `ME5_BEMUTATO.md` | Hungarian manual and ME-5 presentation for the Python version. |

### Running locally

The Web MIDI editor can be served from any local web server, for example:

```
python -m http.server -d webmidi
```

Then open the printed `http://localhost:...` address. Browsers may refuse MIDI access on `file://` pages.

### Python version (optional)

1. Run `tools\setup-python.cmd` once. It downloads a portable Python into `tools/python/` and installs `backend/requirements.txt`.
2. Start the editor with `start-editor.cmd`. It runs the backend and opens http://localhost:8000/. Close its window to stop the server.
3. Optional: `create-shortcut.cmd` creates a desktop shortcut.

Only one program can hold a MIDI port on Windows, so do not run the Python backend and the Web MIDI page at the same time.

## Credits and license

This project started as a fork of [arjenv/Boss-ME5-MIDI-Editor](https://github.com/arjenv/Boss-ME5-MIDI-Editor), a Raspberry Pi + PHP web interface for the ME-5. The editor has since been rewritten, but the MIDI parameter map is based on that work.

Licensed under the GNU GPL v3. See [LICENSE](LICENSE). No warranty: use at your own risk.

BOSS and ME-5 are trademarks of Roland Corporation. This project is not affiliated with Roland.
