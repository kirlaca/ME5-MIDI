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

from . import me5_params

DEFAULT_TIMEOUT_MS = 200


def identity_request(channel: int) -> list[int]:
    """Roland/Boss "identity request" - the bytes the original
    detect_ME5.php sent via `amidi -S`, with the device ID set to `channel`."""
    return [*me5_params.header(channel), me5_params.CMD_RQ1, 0x10, 0x00, 0x00, 0x19, 0x00, 0xF7]


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
    return send_all_and_wait(out_port_name, in_port_name, [data], timeout_ms)


def send_all_and_wait(
    out_port_name: str,
    in_port_name: str,
    messages: list[list[int]],
    timeout_ms: int = DEFAULT_TIMEOUT_MS,
) -> list[int]:
    """send_sysex_and_wait for several messages sent back to back, with
    one shared wait for the replies."""
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

        for message in messages:
            midiout.send_message(message)

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


def send_message(out_port_name: str, data: list[int]) -> None:
    """Fire-and-forget send (Program Change, DT1 edit-buffer updates) -
    DT1 has no reply, so waiting like send_sysex_and_wait would only add
    latency while knobs are being turned."""
    midiout = rtmidi.MidiOut()
    try:
        out_ports = midiout.get_ports()
        if out_port_name not in out_ports:
            raise MidiPortNotFound(f"output port not found: {out_port_name}")
        midiout.open_port(out_ports.index(out_port_name))
        midiout.send_message(data)
    finally:
        midiout.close_port()
        del midiout


@dataclass
class DetectedPort:
    output: str
    input: str
    channel: int  # 0-15, also the SysEx device ID


def detect_me5(timeout_ms: int = DEFAULT_TIMEOUT_MS) -> DetectedPort | None:
    """Probe every output/input port combination and return the pair that
    answers like an ME-5, along with the pedal's MIDI channel.

    The ME-5 only answers SysEx addressed to its own channel, so the
    identity request goes out on all 16 at once and the reply's device ID
    says which one it is on.

    Unlike ALSA (`amidi -l`), WinMM does not guarantee that a device's
    output and input ports share a name, so pairing by name is not
    reliable on Windows - this tries every combination instead. With a
    handful of ports and a ~200ms timeout per miss this is a bit slow
    (seconds, not milliseconds) but it only runs on explicit user action.
    """
    out_ports = list_output_ports()
    in_ports = list_input_ports()
    requests = [identity_request(ch) for ch in range(me5_params.MIDI_CHANNELS)]

    for out_port in out_ports:
        for in_port in in_ports:
            try:
                response = send_all_and_wait(out_port.name, in_port.name, requests, timeout_ms)
            except MidiPortNotFound:
                continue
            channel = _reply_channel(response)
            if channel is not None:
                return DetectedPort(output=out_port.name, input=in_port.name, channel=channel)
    return None


def _reply_channel(response: list[int]) -> int | None:
    """Channel of the first ME-5 DT1 reply (F0 41 <dev> 1F 12) in `response`."""
    for i, byte in enumerate(response):
        if byte != me5_params.SOX:
            continue
        head = response[i:i + 5]
        if (
            len(head) == 5
            and head[1] == me5_params.ROLAND_ID
            and head[2] < me5_params.MIDI_CHANNELS
            and head[3:] == [me5_params.MODEL_ID, me5_params.CMD_DT1]
        ):
            return head[2]
    return None
