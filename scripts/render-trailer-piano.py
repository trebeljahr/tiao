#!/usr/bin/env python3
"""Render the original score with local licensed Yamaha multisamples.

Only the finished composition is exported. Sample assets are never copied or
redistributed. Requires numpy/scipy and FFmpeg. No audio output device is opened.
"""
import argparse
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import re
import subprocess
import numpy as np
from scipy.signal import fftconvolve, resample_poly, butter, sosfilt

parser = argparse.ArgumentParser()
parser.add_argument("score")
parser.add_argument("output")
args = parser.parse_args()
score = json.loads(Path(args.score).read_text())
source = Path(score["instrument"])
rate = 48000
library = []
for path in source.glob("*.wav"):
    match = re.match(r"^(\d{3})_.*_([SMH])\.wav$", path.name)
    if match:
        library.append((int(match[1]), match[2], path))
assert library, "Installed Yamaha piano samples are required"
cache = {}
used = {}

def sample(note, layer):
    candidates = [item for item in library if item[1] == layer]
    root, _, path = min(candidates, key=lambda item: abs(item[0] - note))
    assert abs(root - note) <= 4, f"No nearby piano sample for {note}"
    key = (path, note)
    if key not in cache:
        raw = subprocess.check_output([
            "ffmpeg", "-v", "error", "-threads", "1", "-i", str(path),
            "-t", "8", "-f", "f32le", "-ac", "2", "-ar", str(rate), "pipe:1",
        ])
        data = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()
        ratio = Fraction(2 ** ((root - note) / 12)).limit_denominator(2000)
        if root != note:
            data = resample_poly(data, ratio.numerator, ratio.denominator, axis=0)
        rms = np.sqrt(np.mean(data[:round(.3 * rate)] ** 2))
        data *= .1 / max(1e-5, rms)
        cache[key] = data
        used[str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()
    return cache[key]

frames = round(score["duration"] * rate)
dry = np.zeros((frames, 2), dtype=np.float32)
pedal_releases = sorted(e["time"] for e in score["events"]
                        if e["type"] == "cc" and e["controller"] == 64 and e["value"] == 0)
for note in score["notes"]:
    layer = "M" if note["velocity"] >= 62 else "S"
    data = sample(note["midi"], layer)
    off = note["off"]
    release = next((t for t in pedal_releases if t > off), off)
    # The pedal sustains to the next harmony; note release is a damped tail.
    hold = min(release - note["time"], 4.5)
    end = min(len(data), round((hold + .38) * rate))
    start = round(note["time"] * rate)
    end = min(end, frames - start)
    if end <= 0:
        continue
    envelope = np.ones(end, dtype=np.float32)
    tail = round(hold * rate)
    if tail < end:
        envelope[tail:] = np.exp(-np.arange(end-tail) / (rate * .075))
    envelope[:120] *= np.linspace(0, 1, 120)
    gain = (note["velocity"] / 64) ** 1.65
    if note["part"] == "left": gain *= .72
    if note["part"] == "melody": gain *= 1.08
    if note["part"] == "lift": gain *= .65
    dry[start:start+end] += data[:end] * envelope[:, None] * gain

# Short, dark room: soft early reflections and a diffuse stereo decay.
rng = np.random.default_rng(231026)
ir_frames = round(.95 * rate)
impulse = rng.normal(0, 1, (ir_frames, 2))
impulse = sosfilt(butter(2, [350, 4600], btype="bandpass", fs=rate, output="sos"), impulse, axis=0)
time = np.arange(ir_frames) / rate
impulse *= np.exp(-time[:, None] * 7.5)
impulse[:round(.025 * rate)] = 0
for channel in range(2):
    impulse[:, channel] /= np.sqrt(np.sum(impulse[:, channel] ** 2))
    for delay, level in [(.021, .35), (.037, .23), (.061, .13)]:
        impulse[round((delay + channel * .003) * rate), channel] += level
wet = np.column_stack([fftconvolve(dry[:, c], impulse[:, c], mode="full")[:frames]
                       for c in range(2)])
mix = dry + .105 * wet
mix = sosfilt(butter(2, 45, btype="highpass", fs=rate, output="sos"), mix, axis=0)
mix = sosfilt(butter(2, 8500, btype="lowpass", fs=rate, output="sos"), mix, axis=0)
peak = float(np.max(np.abs(mix)))
mix *= 10 ** (-3/20) / max(peak, 1e-6)
output = Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
subprocess.run([
    "ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(rate), "-ac", "2",
    "-i", "pipe:0", "-c:a", "pcm_s24le", str(output),
], input=mix.astype(np.float32).tobytes(), check=True)
report = {
    "score": str(Path(args.score)), "output": str(output),
    "duration": score["duration"], "notes": len(score["notes"]),
    "sampleRate": rate, "channels": 2,
    "method": "Original MIDI composition, velocity-selected local Yamaha piano multisamples, pedal simulation and short dark algorithmic room",
    "sampleAssets": used,
    "licence": "Apple Logic Pro Sample Content; finished original soundtrack use, no sample redistribution",
    "licenceUrl": "https://www.apple.com/legal/sla/docs/LogicPro.pdf",
    "audioGenerationService": None,
}
output.with_suffix(".render.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps({"duration": score["duration"], "notes": len(score["notes"]), "samplesUsed": len(used), "output": str(output)}))
