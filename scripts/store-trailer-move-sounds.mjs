import assert from "node:assert/strict";

// Match the renderer's continuous logarithmic time map. Its slope decreases
// smoothly, so equally spaced source moves become progressively faster.
export function sourceToTimeline(shot, sourceSeconds) {
  const elapsed = sourceSeconds - (shot.start || 0);
  if (!shot.acceleration) return elapsed / (shot.speed || 1);
  const { strength, sourceDuration } = shot.acceleration;
  assert(strength > 0 && sourceDuration > 0);
  return (shot.duration * Math.log1p((strength * elapsed) / sourceDuration)) / Math.log1p(strength);
}

// Cue sounds from committed source-frame events, never from evenly spaced beats.
export function projectMoveSounds(edit, manifest) {
  assert(!edit.sounds.some((sound) => sound.type === "tap"), "Use source move events for taps");
  const fps = edit.fps || 30;
  const cues = [];
  for (const [shotIndex, shot] of edit.shots.entries()) {
    if (shot.kind !== "footage" || shot.moveSounds === false) continue;
    const source = manifest.sources.find((item) => item.file === shot.file);
    if (!source) continue;
    const speed = shot.speed || 1;
    const sourceStart = shot.start || 0;
    const sourceEnd = sourceStart + (shot.acceleration?.sourceDuration || shot.duration * speed);
    const firstFrame = Math.round(shot.timelineStart * fps);
    const endFrame = firstFrame + Math.round(shot.duration * fps);
    for (const event of source.events) {
      assert(Number.isInteger(event.frame) && event.frame >= 0, "Invalid source frame");
      assert(["place", "jump", "confirm"].includes(event.kind), "Not a committed move");
      if (source.grid && shot.crop) {
        const points =
          event.kind === "confirm"
            ? event.captures
            : event.kind === "jump"
              ? [event.from, event.to]
              : [event.position];
        const [x, y, width, height] = shot.crop;
        const visible = points.some((point) => {
          const px = source.grid.origin[0] + point.x * source.grid.spacing;
          const py = source.grid.origin[1] + point.y * source.grid.spacing;
          return px >= x + 20 && px <= x + width - 20 && py >= y + 20 && py <= y + height - 20;
        });
        if (!visible) continue;
      }
      const sourceTime = event.frame / source.fps;
      if (sourceTime < sourceStart || sourceTime >= sourceEnd) continue;
      const frame = firstFrame + Math.round(sourceToTimeline(shot, sourceTime) * fps);
      if (frame < firstFrame || frame >= endFrame) continue;
      cues.push({
        type: "tap",
        time: frame / fps,
        gain: edit.moveSounds.gain,
        frame,
        shotIndex,
        sourceFile: source.file,
        sourceFrame: event.frame,
        sourceFps: source.fps,
        actionId: event.id,
        action: event.kind,
      });
    }
  }
  return cues.sort((a, b) => a.frame - b.frame);
}
