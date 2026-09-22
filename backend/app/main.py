"""FastAPI backend for the ME-5 Editor.

Drop-in replacement for the old PHP endpoints, talking to the ME-5 over
native MIDI (python-rtmidi) instead of shelling out to `amidi`/`gpio`.
Run with: uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import midi_service, storage

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
    return {"output": found.output, "input": found.input}


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
