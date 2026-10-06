"""ME-5 patch parameter map and DT1 patch encoding/decoding.

Addresses and ranges were cross-checked between the original editor
(js/me-5script-USB.js + the slider limits in me-5-USB.html), a community
MIDI Designer Pro layout, and the factory dump in syx/original_ME-5.syx.
Where the sources disagreed, the factory dump won (e.g. reverb time tops
out at 14, not 15).

Patch format: 35-byte DT1 message
    F0 41 <dev> 1F 12 <addr MSB> <addr LSB> <26 data bytes> <checksum> F7

<dev> is the Roland device ID, which on the ME-5 is its MIDI channel - 1
(0x00-0x0F): the pedal ignores SysEx sent to any other device ID.

Unlike the standard Roland scheme, the ME-5 checksum covers only the 26
data bytes, not the address - all 64 factory patches verify this way and
none verify with address+data.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

SOX = 0xF0
EOX = 0xF7
ROLAND_ID = 0x41
MODEL_ID = 0x1F
CMD_RQ1 = 0x11
CMD_DT1 = 0x12

MIDI_CHANNELS = 16  # 0-15 = MIDI channel 1-16, also the SysEx device ID
# Patch files are written with device ID 0, as in the factory dump, so they
# don't depend on the channel of the pedal they came from.
FILE_CHANNEL = 0

PARAM_COUNT = 26
PATCH_MESSAGE_LENGTH = 35  # header(5) + address(2) + data(26) + checksum + EOX
PATCH_COUNT = 64

TEMP_ADDRESS = (0x00, 0x00)  # edit buffer - what the pedal is playing right now

DUMP_LENGTH = PATCH_COUNT * PATCH_MESSAGE_LENGTH

# Bits of the effect on/off byte (address 0x00).
EFFECT_BITS = {
    "compressor": 0x01,
    "overdrive": 0x02,
    "equalizer": 0x04,
    "modulation": 0x08,
    "reverb": 0x10,
}

REVERB_MODE_DELAY = 5
REVERB_TIME_MAX = 14
DELAY_TIME_MAX = 49

LIST_0_TO_12 = ["0.0", "1.0", "1.5", "2.0", "2.5", "3.0", "3.5", "4.0", "4.5", "5.0", "5.5", "6.0", "7.0"]
# Time labels as shown by the original editor (units not documented there).
# Delay mode:
DELAY_TIME_LABELS = [
    "0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9", "1.0", "1.2", "1.5", "2.0", "2.5", "3.0",
    "3.5", "4.0", "4.5", "5.0", "5.5", "6.0", "6.5", "7.0", "7.5", "8.0", "8.5", "9.0", "9.5", "10", "11",
    "12", "14", "16", "18", "20", "22", "24", "26", "28", "30", "32", "34", "36", "38", "40",
    "42", "44", "46", "48", "50",
]
REVERB_TIME_LABELS = [f"{v / 2:.1f}" for v in range(REVERB_TIME_MAX + 1)]


def _signed6(value: int) -> str:
    return f"{value - 6:+d}" if value != 6 else "0"


def _tenths(value: int) -> str:
    return f"{value / 10:.1f}"


@dataclass(frozen=True)
class Param:
    address: int
    key: str
    block: str
    name: str
    max: int
    labels: list[str] | None = None
    formatter: Callable[[int], str] | None = field(default=None, compare=False)

    def display(self, value: int) -> str:
        if self.labels is not None:
            return self.labels[value]
        if self.formatter is not None:
            return self.formatter(value)
        return str(value)

    def to_dict(self) -> dict:
        return {
            "address": self.address,
            "key": self.key,
            "block": self.block,
            "name": self.name,
            "min": 0,
            "max": self.max,
            "labels": self.labels
            or ([self.formatter(v) for v in range(self.max + 1)] if self.formatter else None),
        }


PARAMS: list[Param] = [
    Param(0x00, "effects_on", "global", "Effects on/off (bitfield)", 0x1F),
    Param(0x01, "comp_sustain", "compressor", "Sustain", 12, labels=LIST_0_TO_12),
    Param(0x02, "comp_attack", "compressor", "Attack", 7),
    Param(0x03, "comp_tone", "compressor", "Tone", 12, formatter=_signed6),
    Param(0x04, "comp_level", "compressor", "Level", 12, labels=LIST_0_TO_12),
    Param(0x05, "od_mode", "overdrive", "Mode", 2, labels=["Normal OD", "Heavy OD", "Distortion"]),
    Param(0x06, "od_drive", "overdrive", "Drive", 7),
    Param(0x07, "od_level", "overdrive", "Level", 7),
    Param(0x08, "eq_high", "equalizer", "High", 12, formatter=_signed6),
    Param(0x09, "eq_mid_freq", "equalizer", "Mid frequency", 2, labels=["0.5 kHz", "1.0 kHz", "2.0 kHz"]),
    Param(0x0A, "eq_mid", "equalizer", "Mid", 12, formatter=_signed6),
    Param(0x0B, "eq_low", "equalizer", "Low", 12, formatter=_signed6),
    Param(0x0C, "eq_level", "equalizer", "Level", 12, formatter=_signed6),
    Param(
        0x0D, "mod_mode", "modulation", "Mode", 4,
        labels=["Chorus", "Flanger freq=1", "Flanger freq=2", "Flanger freq=3", "Flanger freq=4"],
    ),
    Param(0x0E, "mod_rate", "modulation", "Rate", 70, formatter=_tenths),
    Param(0x0F, "mod_depth", "modulation", "Depth", 12, labels=LIST_0_TO_12),
    Param(0x10, "mod_resonance", "modulation", "Resonance", 12, labels=LIST_0_TO_12),
    Param(0x11, "mod_level", "modulation", "Level", 12, labels=LIST_0_TO_12),
    Param(0x12, "ns_threshold", "global", "Noise suppressor threshold", 7),
    Param(0x13, "send_return", "global", "Send/Return", 1, labels=["OFF", "ON"]),
    Param(
        0x14, "rev_mode", "reverb", "Mode", 5,
        labels=["Room", "Hall 15m", "Hall 30m", "Plate", "Gated", "Delay"],
    ),
    # Max depends on rev_mode: 14 for reverb modes, 49 for delay (see validate_patch).
    Param(0x15, "rev_time", "reverb", "Time", DELAY_TIME_MAX),
    Param(0x16, "rev_delay_feedback", "reverb", "Delay feedback", 7),
    Param(0x17, "rev_tone", "reverb", "Tone", 7),
    Param(0x18, "rev_level", "reverb", "Level", 12, labels=LIST_0_TO_12),
    Param(0x19, "master_level", "global", "Master level", 70, formatter=_tenths),
]

PARAMS_BY_KEY = {p.key: p for p in PARAMS}
assert [p.address for p in PARAMS] == list(range(PARAM_COUNT))


class PatchError(ValueError):
    pass


def checksum(data: list[int]) -> int:
    """ME-5 checksum over the data bytes only. The `& 0x7F` matters: the
    original JS returned 128 (not a valid SysEx byte) when the sum was a
    multiple of 128."""
    return (128 - (sum(data) & 0x7F)) & 0x7F


def patch_address(patch_number: int) -> tuple[int, int]:
    """Memory address of patch 0-63 (group-bank-number 1-1-1 .. 4-4-4).
    Patches are 0x20 apart starting at 10 00, in 7-bit address bytes."""
    if not 0 <= patch_number < PATCH_COUNT:
        raise PatchError(f"patch number out of range 0-{PATCH_COUNT - 1}: {patch_number}")
    return 0x10 + patch_number // 4, (patch_number % 4) << 5


def patch_number_from_address(msb: int, lsb: int) -> int | None:
    if (msb, lsb) == TEMP_ADDRESS:
        return None
    number = (msb - 0x10) * 4 + (lsb >> 5)
    if msb < 0x10 or lsb & 0x1F or not 0 <= number < PATCH_COUNT:
        raise PatchError(f"not a patch address: {msb:02X} {lsb:02X}")
    return number


def patch_label(patch_number: int) -> str:
    """0 -> '1-1-1', 63 -> '4-4-4' (group-bank-number, as on the pedal)."""
    return f"{patch_number // 16 + 1}-{patch_number % 16 // 4 + 1}-{patch_number % 4 + 1}"


def param_max(key: str, values: dict[str, int]) -> int:
    if key == "rev_time":
        return DELAY_TIME_MAX if values.get("rev_mode") == REVERB_MODE_DELAY else REVERB_TIME_MAX
    return PARAMS_BY_KEY[key].max


def validate_patch(values: dict[str, int]) -> None:
    missing = [p.key for p in PARAMS if p.key not in values]
    if missing:
        raise PatchError(f"missing parameters: {', '.join(missing)}")
    unknown = [k for k in values if k not in PARAMS_BY_KEY]
    if unknown:
        raise PatchError(f"unknown parameters: {', '.join(unknown)}")
    for p in PARAMS:
        value = values[p.key]
        limit = param_max(p.key, values)
        if not isinstance(value, int) or not 0 <= value <= limit:
            raise PatchError(f"{p.key} out of range 0-{limit}: {value!r}")


def header(channel: int) -> list[int]:
    if not 0 <= channel < MIDI_CHANNELS:
        raise PatchError(f"MIDI channel must be 0-{MIDI_CHANNELS - 1}, got {channel!r}")
    return [SOX, ROLAND_ID, channel, MODEL_ID]


def dump_request(channel: int) -> list[int]:
    """Full 64-patch dump request - what the original editor's ME5readall()
    sent (size 7F 7F = "everything", checksum left at 00), addressed to the
    pedal on `channel`."""
    return [*header(channel), CMD_RQ1, 0x10, 0x00, 0x7F, 0x7F, 0x00, EOX]


def encode_patch(
    values: dict[str, int], patch_number: int | None = None, channel: int = FILE_CHANNEL
) -> list[int]:
    """Build a DT1 message. patch_number=None writes the temp/edit buffer,
    0-63 writes (stores) that patch."""
    validate_patch(values)
    address = TEMP_ADDRESS if patch_number is None else patch_address(patch_number)
    data = [values[p.key] for p in PARAMS]
    return [*header(channel), CMD_DT1, *address, *data, checksum(data), EOX]


def decode_patch(message: list[int], verify_checksum: bool = True) -> dict:
    """Parse one 35-byte DT1 patch message."""
    if len(message) != PATCH_MESSAGE_LENGTH:
        raise PatchError(f"patch message must be {PATCH_MESSAGE_LENGTH} bytes, got {len(message)}")
    # Any device ID: dumps carry the channel of the pedal they came from.
    if (
        message[:2] != [SOX, ROLAND_ID]
        or message[2] >= MIDI_CHANNELS
        or message[3:5] != [MODEL_ID, CMD_DT1]
        or message[-1] != EOX
    ):
        raise PatchError("not an ME-5 DT1 message")
    data = message[7:7 + PARAM_COUNT]
    if verify_checksum and checksum(data) != message[33]:
        raise PatchError(f"checksum mismatch: expected {checksum(data):02X}, got {message[33]:02X}")
    values = {p.key: v for p, v in zip(PARAMS, data)}
    validate_patch(values)
    patch_number = patch_number_from_address(message[5], message[6])
    return {
        "patch_number": patch_number,
        "patch_label": None if patch_number is None else patch_label(patch_number),
        "values": values,
        "display": display_values(values),
    }


def decode_dump(dump: list[int], verify_checksum: bool = True) -> list[dict]:
    """Split a concatenation of patch messages (e.g. the 2240-byte full
    dump, 64 x 35) and decode each one."""
    if len(dump) % PATCH_MESSAGE_LENGTH:
        raise PatchError(f"dump length {len(dump)} is not a multiple of {PATCH_MESSAGE_LENGTH}")
    return [
        decode_patch(dump[i:i + PATCH_MESSAGE_LENGTH], verify_checksum)
        for i in range(0, len(dump), PATCH_MESSAGE_LENGTH)
    ]


def decode_dump_repairing(dump: list[int], fallback: list[dict]) -> list[dict]:
    """decode_dump for a full dump read from a pedal: a patch that does not
    decode (e.g. garbage left by a flat backup battery) is replaced with
    fallback[slot] and flagged with "invalid": <reason>, instead of failing
    the whole read. The dump comes in patch order, so slot = position."""
    if len(dump) != DUMP_LENGTH:
        raise PatchError(f"expected a {DUMP_LENGTH}-byte dump, got {len(dump)} bytes")
    patches = []
    for slot in range(PATCH_COUNT):
        message = dump[slot * PATCH_MESSAGE_LENGTH:(slot + 1) * PATCH_MESSAGE_LENGTH]
        try:
            patch = decode_patch(message)
            if patch["patch_number"] != slot:
                raise PatchError(f"patch {patch['patch_label']} arrived in slot {patch_label(slot)}")
        except PatchError as exc:
            patch = {**fallback[slot], "patch_number": slot, "patch_label": patch_label(slot), "invalid": str(exc)}
        patches.append(patch)
    return patches


def display_values(values: dict[str, int]) -> dict[str, str]:
    shown = {}
    for p in PARAMS:
        value = values[p.key]
        if p.key == "effects_on":
            shown[p.key] = ", ".join(name for name, bit in EFFECT_BITS.items() if value & bit) or "none"
        elif p.key == "rev_time":
            if values["rev_mode"] == REVERB_MODE_DELAY:
                shown[p.key] = DELAY_TIME_LABELS[value]
            else:
                shown[p.key] = REVERB_TIME_LABELS[value]
        else:
            shown[p.key] = p.display(value)
    return shown
