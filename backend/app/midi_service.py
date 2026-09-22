"""Native MIDI access for the ME-5 editor backend.

Replaces the old PHP layer's `exec("amidi ...")` shell-outs with direct
calls into python-rtmidi (RtMidi), which wraps WinMM/WinRT on Windows,
CoreMIDI on macOS and ALSA/JACK on Linux behind the same API - this module
should not need OS-specific branches to run on any of the three.
"""
from __future__ import annotations

import time
from dataclasses import dataclass

import rtmidi

# Roland/Boss "identity request" and the prefix an ME-5 answers with.
# Same bytes the original detect_ME5.php sent via `amidi -S`.
IDENTITY_REQUEST = [0xF0, 0x41, 0x00, 0x1F, 0x11, 0x10, 0x00, 0x00, 0x19, 0x00, 0xF7]
IDENTITY_REPLY_PREFIX = [0xF0, 0x41, 0x00, 0x1F, 0x12]

DEFAULT_TIMEOUT_MS = 200


@dataclass
class MidiPort:
    index: int
    name: str


class MidiPortNotFound(ValueError):
    pass


def list_output_ports() -> list[MidiPort]:
    midiout = rtmidi.MidiOut()
    try:
        return [MidiPort(i, name) for i, name in enumerate(midiout.get_ports())]
    finally:
        del midiout


def list_input_ports() -> list[MidiPort]:
    midiin = rtmidi.MidiIn()
    try:
        return [MidiPort(i, name) for i, name in enumerate(midiin.get_ports())]
    finally:
        del midiin


def send_sysex_and_wait(
    out_port_name: str,
    in_port_name: str,
    data: list[int],
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
) -> list[int]:
    """Open the given output/input port pair, send `data` (a full SysEx
    message, F0..F7), and collect whatever comes back within timeout_ms.

    Mirrors `amidi -p <hw> -S <bytes> -d`: the timeout resets every time
    new bytes arrive, so a slow-but-still-arriving reply is not cut off.
    """
    midiout = rtmidi.MidiOut()
    midiin = rtmidi.MidiIn()
    received: list[int] = []
    try:
        out_ports = midiout.get_ports()
        in_ports = midiin.get_ports()
        if out_port_name not in out_ports:
            raise MidiPortNotFound(f"output port not found: {out_port_name}")
        if in_port_name not in in_ports:
            raise MidiPortNotFound(f"input port not found: {in_port_name}")

        # RtMidi drops sysex/timing/active-sense by default - we need sysex.
        midiin.ignore_types(sysex=False, timing=True, active_sense=True)
        midiin.open_port(in_ports.index(in_port_name))
        midiout.open_port(out_ports.index(out_port_name))

        midiout.send_message(data)

        deadline = time.monotonic() + (timeout_ms / 1000.0)
        while time.monotonic() < deadline:
            msg = midiin.get_message()
            if msg is not None:
                message, _delta_time = msg
                received.extend(message)
                deadline = time.monotonic() + (timeout_ms / 1000.0)
            else:
                time.sleep(0.002)
    finally:
        midiin.close_port()
        midiout.close_port()
        del midiin
        del midiout

    return received


@dataclass
class DetectedPort:
    output: str
    input: str


def detect_me5(timeout_ms: int = DEFAULT_TIMEOUT_MS) -> DetectedPort | None:
    """Probe every output/input port combination and return the pair that
    answers like an ME-5.

    Unlike ALSA (`amidi -l`), WinMM does not guarantee that a device's
    output and input ports share a name, so pairing by name is not
    reliable on Windows - this tries every combination instead. With a
    handful of ports and a ~200ms timeout per miss this is a bit slow
    (seconds, not milliseconds) but it only runs on explicit user action.
    """
    out_ports = list_output_ports()
    in_ports = list_input_ports()

    for out_port in out_ports:
        for in_port in in_ports:
            try:
                response = send_sysex_and_wait(
                    out_port.name, in_port.name, IDENTITY_REQUEST, timeout_ms
                )
            except MidiPortNotFound:
                continue
            if response[: len(IDENTITY_REPLY_PREFIX)] == IDENTITY_REPLY_PREFIX:
                return DetectedPort(output=out_port.name, input=in_port.name)
    return None
