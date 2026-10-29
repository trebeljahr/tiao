"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { safeLocalStorage } from "@/lib/safeLocalStorage";
import {
  getClickVolume,
  playUiClick,
  stopUiClicks,
  UI_CLICK_KEY,
  UI_CLICK_VOLUME_KEY,
} from "@/lib/uiClickAudio";
import { UI_CLICKS } from "@/lib/uiClickSynth";
import { useToggleSound } from "@/lib/useSoundPreference";
import styles from "./SoundLabPage.module.css";

const FAVOURITES_KEY = "tiao:uiClickFavourites";
const TAP_OFFSETS = [0, 290, 670];
const SOUND_INTERVAL = 1450;

export function SoundLabPage() {
  const [enabled, toggleSound] = useToggleSound();
  const [volume, setVolume] = useState(0.65);
  const [selected, setSelected] = useState<string | null>(null);
  const [favourites, setFavourites] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [tap, setTap] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const run = useRef(0);
  const mounted = useRef(true);

  const stop = useCallback(() => {
    run.current++;
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
    stopUiClicks();
    setPlaying(false);
    setActive(null);
  }, []);

  useEffect(() => {
    mounted.current = true;
    setVolume(getClickVolume());
    const saved = safeLocalStorage.getItem(UI_CLICK_KEY);
    setSelected(UI_CLICKS.some((sound) => sound.id === saved) ? saved : null);
    const savedFavourites = safeLocalStorage.getJson<unknown>(FAVOURITES_KEY, []);
    setFavourites(
      Array.isArray(savedFavourites)
        ? savedFavourites.filter(
            (id): id is string =>
              typeof id === "string" && UI_CLICKS.some((sound) => sound.id === id),
          )
        : [],
    );
    const onVisibility = () => {
      if (document.hidden) stop();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      mounted.current = false;
      run.current++;
      for (const timer of timers.current) clearTimeout(timer);
      stopUiClicks();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [stop]);

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  const play = (ids: string[]) => {
    stop();
    if (!enabled || ids.length === 0) return;
    const current = run.current;
    setPlaying(true);
    setError("");
    const strike = (id: string, index: number) => {
      if (run.current !== current) return;
      setActive(id);
      setTap(index);
      void playUiClick(id, volume).then((success) => {
        if (!success && mounted.current && run.current === current) {
          stop();
          setError("Audio unavailable. Try again in a browser with sound enabled.");
        }
      });
    };
    // First strike stays inside the click gesture so browsers can unlock audio.
    strike(ids[0], 1);
    ids.forEach((id, soundIndex) => {
      TAP_OFFSETS.forEach((offset, tapIndex) => {
        if (soundIndex === 0 && tapIndex === 0) return;
        timers.current.push(
          setTimeout(() => strike(id, tapIndex + 1), soundIndex * SOUND_INTERVAL + offset),
        );
      });
    });
    timers.current.push(setTimeout(stop, (ids.length - 1) * SOUND_INTERVAL + 1100));
  };

  const favourite = (id: string) => {
    const next = favourites.includes(id)
      ? favourites.filter((value) => value !== id)
      : [...favourites, id];
    setFavourites(next);
    safeLocalStorage.setJson(FAVOURITES_KEY, next);
  };

  const choose = (id: string | null) => {
    stop();
    setSelected(id);
    if (id) {
      safeLocalStorage.setItem(UI_CLICK_KEY, id);
      if (enabled) play([id]);
    } else safeLocalStorage.removeItem(UI_CLICK_KEY);
  };

  const activeSound = UI_CLICKS.find((sound) => sound.id === active);
  const selectedSound = UI_CLICKS.find((sound) => sound.id === selected);

  return (
    <div className={styles.lab} data-ui-sound="off">
      <div className={styles.sheet}>
        <header className={styles.header}>
          <Link href="/play" className={styles.brand}>
            跳 <span>Tiao</span>
          </Link>
          <span className={styles.eyebrow}>Sound studies / 01</span>
        </header>
        <div className={styles.titleRow}>
          <div>
            <h1>UI sound lab</h1>
            <p>16 sounds. Three taps each.</p>
          </div>
          <button
            type="button"
            className={styles.mute}
            onClick={toggleSound}
            aria-pressed={!enabled}
          >
            {enabled ? "Mute" : "Unmute"}
          </button>
        </div>
        <section className={styles.transport} aria-label="Montage controls">
          <div className={styles.controls}>
            <Button
              disabled={!enabled}
              onClick={() => (playing ? stop() : play(UI_CLICKS.map((sound) => sound.id)))}
            >
              {playing ? "Stop montage" : "Play montage"}
            </Button>
            <Button
              variant="outline"
              disabled={!enabled || favourites.length === 0}
              onClick={() =>
                play(
                  UI_CLICKS.filter((sound) => favourites.includes(sound.id)).map(
                    (sound) => sound.id,
                  ),
                )
              }
            >
              Play favourites{favourites.length > 0 ? ` (${favourites.length})` : ""}
            </Button>
          </div>
          <label className={styles.volume}>
            Volume{" "}
            <input
              aria-label="Preview and UI volume"
              type="range"
              min="0"
              max="100"
              value={Math.round(volume * 100)}
              onChange={(event) => {
                stop();
                const next = Number(event.target.value) / 100;
                setVolume(next);
                safeLocalStorage.setItem(UI_CLICK_VOLUME_KEY, String(next));
              }}
            />
            <output>{Math.round(volume * 100)}%</output>
          </label>
        </section>
        <div className={styles.stage}>
          <div className={styles.stageLabel} aria-live="polite">
            {!enabled ? "Sound muted" : activeSound ? activeSound.name : "Ready to listen"}
          </div>
          <fieldset className={styles.demoButtons} aria-label="Button click montage">
            {["Play", "Confirm", "Back"].map((label, index) => (
              <button
                type="button"
                key={label}
                className={`${styles.demo} ${active && tap === index + 1 ? styles.struck : ""}`}
                onClick={() => play([selected ?? active ?? UI_CLICKS[0].id])}
                disabled={!enabled}
              >
                {label}
              </button>
            ))}
          </fieldset>
          <span className={styles.tapCount}>{active ? `${tap} / 3` : "—"}</span>
        </div>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.list}>
          {UI_CLICKS.map((sound, index) => (
            <div
              key={sound.id}
              className={`${styles.row} ${active === sound.id ? styles.active : ""}`}
            >
              <button
                type="button"
                className={styles.audition}
                disabled={!enabled}
                onClick={() => play([sound.id])}
                aria-label={`Preview ${sound.name}`}
              >
                <span className={styles.number}>{String(index + 1).padStart(2, "0")}</span>
                <span className={styles.soundName}>
                  {sound.name}
                  <span className={styles.material}>{sound.material}</span>
                </span>
                <span className={styles.duration}>{Math.round(sound.duration * 1000)} ms</span>
                <span className={styles.playIcon} aria-hidden="true">
                  ▶
                </span>
              </button>
              <button
                type="button"
                className={styles.favourite}
                aria-label={`Favourite ${sound.name}`}
                aria-pressed={favourites.includes(sound.id)}
                onClick={() => favourite(sound.id)}
              >
                {favourites.includes(sound.id) ? "★" : "☆"}
              </button>
              <button
                type="button"
                className={styles.use}
                aria-label={`Use ${sound.name} in game`}
                aria-pressed={selected === sound.id}
                onClick={() => choose(selected === sound.id ? null : sound.id)}
              >
                {selected === sound.id ? "In game ✓" : "Use in game"}
              </button>
            </div>
          ))}
        </div>
        <footer className={styles.footer}>
          <span>
            UI sound: <strong>{selectedSound?.name ?? "Off"}</strong>
          </span>
          {selected && (
            <button type="button" onClick={() => choose(null)}>
              Turn off UI sound
            </button>
          )}
          <Link href="/play">Try in game</Link>
        </footer>
      </div>
    </div>
  );
}
