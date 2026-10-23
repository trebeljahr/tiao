#!/usr/bin/env python3
"""Audit move cues against rendered frames and silent move-track ranges.

Requires NumPy, Pillow and FFmpeg. Run from the repository root.
"""
from pathlib import Path
import json, subprocess, math, sys
import numpy as np
from PIL import Image, ImageDraw
root = Path(sys.argv[1] if len(sys.argv) > 1 else 'build/store-trailer-v6')
(root / 'qa').mkdir(exist_ok=True)
e = json.loads((root / 'edit.json').read_text())
cues = e['resolvedMoveSounds']
manifest = json.loads(Path(e['moveSounds']['file']).read_text())
events = {x['id']: x for s in manifest['sources'] for x in s['events']}
want = {max(0, c['frame'] + offset) for c in cues for offset in [-3, -2, -1, 0, 1, 2, 3, 4]}
saved = {}
p = subprocess.Popen(['ffmpeg', '-v', 'error', '-threads', '2', '-i', str(root / e['outputName']), '-vf', 'scale=960:540', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], stdout=subprocess.PIPE)
f = 0
while True:
    buf = p.stdout.read(960 * 540 * 3)
    if not buf:
        break
    if f in want:
        saved[f] = np.frombuffer(buf, np.uint8).reshape(540, 960, 3).copy()
    f += 1
assert p.wait() == 0
rows = []
checks = []
for i, c in enumerate(cues):
    shot = e['shots'][c['shotIndex']]
    event = events[c['actionId']]
    crop = shot['crop']
    scale = 1960 / crop[2]
    y0 = 78.46 if c['sourceFile'] == 'rules.webm' else 70.46
    points = event['captures'] if event['kind'] == 'confirm' else [event.get('position', event.get('from'))]

    def pos(point, frame):
        t = (frame - round(shot['timelineStart'] * 30)) / 30
        return (((296.46 + point['x'] * 51.282 - crop[0]) * scale - (20 + 12 * math.sin(t * 0.7))) / 2, ((y0 + point['y'] * 51.282 - crop[1]) * 1104 / crop[3] - 12) / 2)

    def color(frame):
        values = []
        for point in points:
            x, y = pos(point, frame)
            off = 4 * scale
            r = max(1, round(scale))
            for dx in [-off, off]:
                for dy in [-off, off]:
                    xx = round(x + dx)
                    yy = round(y + dy)
                    values.extend(saved[frame][yy - r:yy + r + 1, xx - r:xx + r + 1].reshape(-1, 3))
        return np.median(values, axis=0)
    first = max(round(shot['timelineStart'] * 30), c['frame'] - 3)
    before = color(first)
    delta = [float(np.linalg.norm(color(frame) - before)) for frame in range(first, c['frame'] + 5)]
    changed = [first + j for j, d in enumerate(delta) if d > 25]
    assert changed, (i, c, delta)
    change = changed[0]
    error = change - c['frame']
    checks.append({'cue': i, 'time': c['time'], 'action': c['action'], 'sourceFrame': c['sourceFrame'], 'firstVisibleChangeRelativeFrames': error, 'visualChangeDetected': True})
    allpts = [event.get('position', event.get('from')), event.get('to')] + event.get('captures', [])
    allpts = [p for p in allpts if p]
    coords = [pos(p, c['frame']) for p in allpts]
    cx = sum((p[0] for p in coords)) / len(coords)
    cy = sum((p[1] for p in coords)) / len(coords)
    w = max(200, max((p[0] for p in coords)) - min((p[0] for p in coords)) + 90)
    h = max(112.5, max((p[1] for p in coords)) - min((p[1] for p in coords)) + 70)
    w = max(w, h * 16 / 9)
    h = w * 9 / 16
    x = max(0, min(960 - w, cx - w / 2))
    y = max(0, min(540 - h, cy - h / 2))
    row = Image.new('RGB', (1200, 250), '#17120f')
    draw = ImageDraw.Draw(row)
    for j, (label, frame) in enumerate([('before', c['frame'] - 2), ('cue', c['frame']), ('after', c['frame'] + 3)]):
        im = Image.fromarray(saved[frame]).crop((round(x), round(y), round(x + w), round(y + h))).resize((400, 225))
        row.paste(im, (j * 400, 0))
        draw.text((j * 400 + 8, 230), f"{i:02} {c['time']:.3f}s {event['kind']} / {label} f{frame}", fill='white')
    rows.append(row)
for start in range(0, len(rows), 7):
    sheet = Image.new('RGB', (1200, 250 * len(rows[start:start + 7])), '#17120f')
    for j, row in enumerate(rows[start:start + 7]):
        sheet.paste(row, (0, 250 * j))
    sheet.save(root / 'qa' / f'cue-audit-{start // 7 + 1}.jpg')
assert all((abs(x['firstVisibleChangeRelativeFrames']) <= 1 for x in checks)), 'A move cue misses its visible action'
(root / 'qa/cue-validation.json').write_text(json.dumps(checks, indent=2) + '\n')
print('Visible-change frame offsets:', [x['firstVisibleChangeRelativeFrames'] for x in checks])
raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(root / 'audio/moves.wav'), '-f', 'f32le', '-ac', '2', '-ar', '48000', 'pipe:1'])
samples = np.frombuffer(raw, np.float32).reshape(-1, 2)
for a, b in [(2, 5.1), (7.7, 11.15), (12.8, 14.5), (18.5, 44.4), (46.9, 50.2)]:
    assert np.max(np.abs(samples[round(a * 48000):round(b * 48000)])) == 0, (a, b)
print('Preview, pause, UI, montage and victory-hold move tracks verified silent')
