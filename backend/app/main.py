"""FastAPI backend for the ME-5 Editor.

Drop-in replacement for the old PHP endpoints, talking to the ME-5 over
native MIDI (python-rtmidi) instead of shelling out to `amidi`/`gpio`.
Run with: uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import me5_params, midi_service, storage

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = REPO_ROOT / "frontend"
FACTORY_DUMP = REPO_ROOT / "syx" / "original_ME-5.syx"

app = FastAPI(title="ME-5 Editor Backend")

# Local desktop tool - frontend may be served from Live Server, file://,
# or this same process later. Loosen now, tighten once the frontend origin
# is fixed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/ports")
def get_ports():
    return {
        "outputs": [p.__dict__ for p in midi_service.list_output_ports()],
        "inputs": [p.__dict__ for p in midi_service.list_input_ports()],
    }


@app.post("/api/detect")
def detect():
    found = midi_service.detect_me5()
    if found is None:
        raise HTTPException(status_code=404, detail="ME-5 not found on any MIDI port")
    return {"output": found.output, "input": found.input, "channel": found.channel}


class SysexRequest(BaseModel):
    output: str
    input: str
    data: list[int]
    timeout_ms: int = midi_service.DEFAULT_TIMEOUT_MS


@app.post("/api/sysex")
def sysex(req: SysexRequest):
    try:
        response = midi_service.send_sysex_and_wait(
            req.output, req.input, req.data, req.timeout_ms
        )
    except midi_service.MidiPortNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"response": response}


class SendRequest(BaseModel):
    output: str
    data: list[int]


@app.post("/api/send")
def send(req: SendRequest):
    """Send without waiting for a reply (Program Change, DT1 to the edit buffer)."""
    try:
        midi_service.send_message(req.output, req.data)
    except midi_service.MidiPortNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True}


# 0-15 = MIDI channel 1-16; the ME-5 also uses it as its SysEx device ID.
Channel = Field(default=me5_params.FILE_CHANNEL, ge=0, lt=me5_params.MIDI_CHANNELS)


class DumpReadRequest(BaseModel):
    output: str
    input: str
    channel: int = Channel
    timeout_ms: int = 500


@app.post("/api/dump/read")
def read_dump(req: DumpReadRequest):
    """Request all 64 patches from the ME-5 and return them decoded.
    Patches the pedal holds garbage in come back as the factory patch for
    that slot, flagged "invalid", so the rest can still be edited."""
    try:
        response = midi_service.send_sysex_and_wait(
            req.output, req.input, me5_params.dump_request(req.channel), req.timeout_ms
        )
    except midi_service.MidiPortNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if len(response) < me5_params.DUMP_LENGTH:
        raise HTTPException(
            status_code=504,
            detail=f"expected {me5_params.DUMP_LENGTH} bytes from the ME-5, got {len(response)}",
        )
    patches = me5_params.decode_dump_repairing(response[: me5_params.DUMP_LENGTH], read_factory())
    return {"patches": patches}


def read_factory() -> list[dict]:
    return me5_params.decode_dump(list(FACTORY_DUMP.read_bytes()))


@app.get("/api/factory")
def factory_patches():
    """The 64 factory patches from syx/original_ME-5.syx - lets the editor
    work with real data when no ME-5 is connected."""
    return {"patches": read_factory()}


@app.get("/api/params")
def get_params():
    return {
        "params": [p.to_dict() for p in me5_params.PARAMS],
        "effect_bits": me5_params.EFFECT_BITS,
        "reverb_mode_delay": me5_params.REVERB_MODE_DELAY,
        "reverb_time_max": me5_params.REVERB_TIME_MAX,
        "delay_time_max": me5_params.DELAY_TIME_MAX,
        "reverb_time_labels": me5_params.REVERB_TIME_LABELS,
        "delay_time_labels": me5_params.DELAY_TIME_LABELS,
    }


class EncodePatchRequest(BaseModel):
    values: dict[str, int]
    # None = temp/edit buffer, 0-63 = store into that patch
    patch_number: int | None = None
    # The ME-5's channel when sending to it; leave at 0 for patch files.
    channel: int = Channel


@app.post("/api/patch/encode")
def encode_patch(req: EncodePatchRequest):
    try:
        message = me5_params.encode_patch(req.values, req.patch_number, req.channel)
    except me5_params.PatchError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"data": message}


class DecodeRequest(BaseModel):
    data: list[int]
    verify_checksum: bool = True


@app.post("/api/patch/decode")
def decode_patches(req: DecodeRequest):
    """Accepts one 35-byte patch message or a concatenated dump (64 x 35)."""
    try:
        patches = me5_params.decode_dump(req.data, req.verify_checksum)
    except me5_params.PatchError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"patches": patches}


class SaveFileRequest(BaseModel):
    filename: str
    data: list[int]


@app.post("/api/files/save")
def save_file(req: SaveFileRequest):
    try:
        storage.save(req.filename, req.data)
    except storage.InvalidFilename as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True}


class LoadFileRequest(BaseModel):
    filename: str


@app.post("/api/files/load")
def load_file(req: LoadFileRequest):
    try:
        data = storage.load(req.filename)
    except storage.InvalidFilename as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"data": data}


@app.get("/api/files")
def list_files():
    return {"files": storage.list_files()}


@app.post("/api/manual-toggle")
def manual_toggle():
    # The original togglemanualmode.php pulsed a Raspberry Pi GPIO pin
    # wired to the ME-5's manual footswitch contact - there is no MIDI
    # command for this on the ME-5, and no GPIO on a laptop. Left as a
    # stub until we decide on a hardware workaround (e.g. a USB relay).
    raise HTTPException(
        status_code=501,
        detail="Manual mode toggle needs footswitch hardware; not available from a laptop.",
    )


class NoCacheStaticFiles(StaticFiles):
    """Make the browser revalidate every time, so frontend edits show up
    on a plain reload instead of hiding behind a cached style.css/app.js."""

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-cache"
        return response


# Registered last so the /api routes above take precedence.
if FRONTEND_DIR.is_dir():
    app.mount("/", NoCacheStaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
