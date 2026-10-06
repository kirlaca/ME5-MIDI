# ME-5 Editor – Web MIDI változat

Ugyanaz a pedalboard-szerkesztő, mint a `frontend/`-ben, de **backend nélkül**: a böngésző a
[Web MIDI API](https://developer.mozilla.org/docs/Web/API/Web_MIDI_API)-n keresztül közvetlenül
beszél a MIDI interfésszel. Nincs Python, nincs szerver.

| Python változat | Web MIDI változat |
|---|---|
| `backend/app/me5_params.py` | `me5.js` (bájtra azonos kódolás/dekódolás) |
| `backend/app/midi_service.py` (python-rtmidi) | `midi.js` (`navigator.requestMIDIAccess({ sysex: true })`) |
| `/api/factory` + `syx/original_ME-5.syx` | `factory.js` (beágyazott gyári dump) |
| `backend/data/syx/` fájllista | Load: fájlválasztó vagy húzd rá a .syx-et az oldalra; Save: letöltés |

Használati leírás: [`utmutato.html`](utmutato.html) (magyar) és [`guide.html`](guide.html) (English),
az editor fejlécéből is elérhetők.

## Indítás

- Chrome vagy Edge kell (asztali vagy Android). **Safari / iOS nem támogatja a Web MIDI-t.**
- Nyisd meg az `index.html`-t. Ha a böngésző `file://`-ról nem kér MIDI engedélyt, szolgáld ki
  localhostról, pl. `npx serve webmidi` vagy `python -m http.server -d webmidi`, és nyisd meg a
  kiírt `http://localhost:...` címet. HTTPS-en (pl. GitHub Pages) bárhonnan működik.
- Az első csatlakozáskor a böngésző engedélyt kér a MIDI eszközökhöz / SysEx-hez – ezt engedélyezni kell.
- A Python szerver és ez a lap ne fusson egyszerre: Windowson egy MIDI portot egyszerre csak egy
  program tarthat nyitva.

## Különbségek a Python változathoz képest

- Az auto-detect egyszerre hallgat minden bemeneten, így kimenetenként csak egy ~200 ms várakozás.
- A Read ME-5 leáll, amint megjött a 2240 bájt (nem vár a timeoutra).
- Az utoljára használt portokat megjegyzi, és újratöltéskor visszacsatlakozik, ha az interfész be van dugva;
  kihúzáskor offline-ra vált.
- Ugyanazok a hardveres szabályok érvényesek: a pedálnak **Play módban** kell lennie, és a SysEx
  device ID = MIDI csatorna − 1.
