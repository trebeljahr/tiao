#!/usr/bin/env python3
"""Audit move cues against rendered frames and silent move-track ranges.

Requires NumPy, Pillow and FFmpeg. Run from the repository root.
"""
from pathlib import Path
import json, subprocess, math, sys
import numpy as np
from PIL import Image, ImageDraw
root = Path(sys.argv[1] if len(sys.argv) > 1 else 'build/store-trailer-v10')
(root / 'qa').mkdir(exist_ok=True)
e = json.loads((root / 'edit.json').read_text())
cues = e['resolvedMoveSounds']
manifest = json.loads(Path(e['moveSounds']['file']).read_text())
events = {x['id']: x for s in manifest['sources'] for x in s['events']}
grids = {s['file']: s['grid'] for s in manifest['sources']}
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
    # A faster replay can commit the next hop before the fixed +3 frame probe.
    # Inspect this move only while it is still the active committed action.
    next_frame = cues[i + 1]['frame'] if i + 1 < len(cues) else round(e['duration'] * 30)
    last_probe = min(c['frame'] + 4, next_frame - 2)
    assert last_probe >= c['frame'], ('Moves too close to inspect', i, c)
    crop = shot['crop']
    scale = min(1920 / crop[2], 1080 / crop[3]) if shot.get('framing') == 'native' else max(1920 / crop[2], 1080 / crop[3])
    grid = grids[c['sourceFile']]
    x0, y0 = grid['origin']
    spacing = grid['spacing']
    pixel_ratio = grid.get('pixelRatio', 1)
    points = event['captures'] if event['kind'] == 'confirm' else [event.get('position', event.get('from'))]

    def pos(point, frame):
        dx = (crop[2] * scale - 1920) / 2
        dy = (crop[3] * scale - 1080) / 2
        return (((x0 + point['x'] * spacing - crop[0]) * scale - dx) / 2, ((y0 + point['y'] * spacing - crop[1]) * scale - dy) / 2)

    def color(frame, sample_points=None):
        values = []
        for point in (sample_points if sample_points is not None else points):
            x, y = pos(point, frame)
            off = 4 * pixel_ratio * scale
            r = max(1, round(pixel_ratio * scale))
            for dx in [-off, off]:
                for dy in [-off, off]:
                    xx = round(x + dx)
                    yy = round(y + dy)
                    values.extend(saved[frame][yy - r:yy + r + 1, xx - r:xx + r + 1].reshape(-1, 3))
        return np.median(values, axis=0)
    if event['kind'] in ['place', 'jump']:
        destination = event['position'] if event['kind'] == 'place' else event['to']
        colors = [color(frame, [destination]) for frame in range(c['frame'], last_probe + 1)]
        assert any(blue > 205 and green > 210 if event['color'] == 'white' else red < 100
                   for red, green, blue in colors), ('Committed mover is invisible', i, c, colors)
    first = max(round(shot['timelineStart'] * 30), c['frame'] - 3)
    before = color(first)
    delta = [float(np.linalg.norm(color(frame) - before)) for frame in range(first, last_probe + 1)]
    method = 'origin vacancy'
    if event['kind'] == 'place':
        # The blue last-move ring mounts with a committed stone. A hover ghost
        # has no ring, and the stone itself fades in over 180 ms.
        point = event['position']
        def blue_ring(frame):
            x, y = pos(point, frame)
            count = 0
            for angle in np.linspace(0, 2 * np.pi, 64, endpoint=False):
                xx = round(x + 24.1 * pixel_ratio * scale / 2 * np.cos(angle))
                yy = round(y + 24.1 * pixel_ratio * scale / 2 * np.sin(angle))
                patch = saved[frame][max(0, yy-1):yy+2, max(0, xx-1):xx+2].astype(float).reshape(-1, 3)
                count += bool(np.any((patch[:,2]-patch[:,0] > -30) & (patch[:,1]-patch[:,0] > -10)))
            return count / 64
        scores = [(frame, blue_ring(frame)) for frame in range(first, last_probe + 1)]
        ring_frames = [frame for frame, fraction in scores if fraction >= .35]
        assert ring_frames, (i, c, scores)
        # Committed stones start their opacity animation at zero. This removes
        # the hover ghost before the ring becomes fully visible. White therefore
        # darkens toward wood, Black brightens toward wood, then both fade in.
        channel, direction = (2, -1) if event['color'] == 'white' else (0, 1)
        candidates = [(frame, direction * (color(frame)[channel] - color(frame-1)[channel]))
                      for frame in range(first+1, ring_frames[0]+1)]
        onset = max(candidates, key=lambda item: item[1], default=(ring_frames[0], 0))
        changed = [onset[0]] if onset[1] > 15 else ring_frames
        method = 'committed opacity reset followed by last-move ring; hover excluded'
    elif event['kind'] == 'confirm':
        changed = []
        for frame in range(first, last_probe + 1):
            red, green, blue = color(frame)
            if (red > 200 and red-blue > 60 if event['color'] == 'white' else blue < 155): changed.append(frame)
        method = 'captured-stone removal; pending fade excluded'
    else:
        changed = [first + j for j, d in enumerate(delta) if d > 25]
    assert changed, (i, c, delta, scores if event['kind'] == 'place' else '')
    change = changed[0]
    error = change - c['frame']
    checks.append({'cue': i, 'time': c['time'], 'action': c['action'], 'sourceFrame': c['sourceFrame'], 'firstVisibleChangeRelativeFrames': error, 'visualChangeDetected': True, 'method': method})
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
    for j, (label, frame) in enumerate([('before', c['frame'] - 2), ('cue', c['frame']), ('after', min(c['frame'] + 3, last_probe))]):
        im = Image.fromarray(saved[frame]).crop((round(x), round(y), round(x + w), round(y + h))).resize((400, 225))
        row.paste(im, (j * 400, 0))
        draw.text((j * 400 + 8, 230), f"{i:02} {c['time']:.3f}s {event['kind']} / {label} f{frame}", fill='white')
    rows.append(row)
for start in range(0, len(rows), 7):
    sheet = Image.new('RGB', (1200, 250 * len(rows[start:start + 7])), '#17120f')
    for j, row in enumerate(rows[start:start + 7]):
        sheet.paste(row, (0, 250 * j))
    sheet.save(root / 'qa' / f'cue-audit-{start // 7 + 1}.jpg')
(root / 'qa/cue-validation.json').write_text(json.dumps(checks, indent=2) + '\n')
print('Cue exceptions:', [x for x in checks if abs(x['firstVisibleChangeRelativeFrames']) > 1])
assert all((abs(x['firstVisibleChangeRelativeFrames']) <= 1 for x in checks)), 'A move cue misses its visible action'
print('Visible-change frame offsets:', [x['firstVisibleChangeRelativeFrames'] for x in checks])
raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(root / 'audio/moves.wav'), '-f', 'f32le', '-ac', '2', '-ar', '48000', 'pipe:1'])
samples = np.frombuffer(raw, np.float32).reshape(-1, 2)
intervals = sorted((c['time'], c['time'] + 0.062) for c in cues)
last = 0
for a, b in intervals + [(e['duration'], e['duration'])]:
    if a - last > 0.02:
        section = samples[round((last + 0.002) * 48000):round(max(last + 0.002, a - 0.002) * 48000)]
        if len(section): assert np.max(np.abs(section)) == 0, (last, a)
    last = max(last, b)
print('Move track verified silent between all committed event cues')
