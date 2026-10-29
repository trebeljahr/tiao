"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SoundPlayground } from "@/components/SoundPlayground";
import { UiClickFeedback } from "@/components/UiClickFeedback";
import { Button } from "@/components/ui/button";
import { safeLocalStorage } from "@/lib/safeLocalStorage";
import {
  getUiSoundSelection,
  getUiSoundVolume,
  playUiClick,
  soundVolumeKey,
  stopUiClicks,
  UI_SOUND_KEYS,
} from "@/lib/uiClickAudio";
import {
  UI_SOUND_CATEGORIES,
  UI_SOUND_LABELS,
  UI_SOUNDS,
  type UiSoundCategory,
} from "@/lib/uiClickSynth";
import { useToggleSound } from "@/lib/useSoundPreference";
import styles from "./SoundLabPage.module.css";

type Selections = Record<UiSoundCategory, string | null>;
type Volumes = Record<UiSoundCategory, number>;
export function SoundLabPage() {
  const [enabled, toggleSound] = useToggleSound();
  const [category, setCategory] = useState<UiSoundCategory>("click");
  const [selected, setSelected] = useState<Selections>({ click: null, success: null, error: null });
  const [volumes, setVolumes] = useState<Volumes>({ click: 0.5, success: 0.5, error: 0.5 });
  const [active, setActive] = useState<string | null>(null);
  const [lastFeedback, setLastFeedback] = useState<UiSoundCategory | null>(null);
  const [error, setError] = useState("");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const generation = useRef(0);
  const stop = useCallback(() => {
    generation.current++;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    stopUiClicks();
    setActive(null);
  }, []);
  useEffect(() => {
    setSelected({
      click: getUiSoundSelection("click"),
      success: getUiSoundSelection("success"),
      error: getUiSoundSelection("error"),
    });
    setVolumes({
      click: getUiSoundVolume("click"),
      success: getUiSoundVolume("success"),
      error: getUiSoundVolume("error"),
    });
    const hide = () => {
      if (document.hidden) stop();
    };
    const feedback = (event: Event) =>
      setLastFeedback((event as CustomEvent<UiSoundCategory>).detail);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("tiao:ui-feedback", feedback);
    return () => {
      generation.current++;
      timers.current.forEach(clearTimeout);
      stopUiClicks();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("tiao:ui-feedback", feedback);
    };
  }, [stop]);
  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);
  const preview = (id: string, kind: UiSoundCategory) => {
    stop();
    if (!enabled) return;
    const current = generation.current;
    setActive(id);
    setError("");
    void playUiClick(id, volumes[kind]).then((success) => {
      if (!success && current === generation.current) {
        stop();
        setError("Audio unavailable. Try again with sound enabled.");
      }
    });
    timers.current.push(
      setTimeout(() => {
        if (current === generation.current) setActive(null);
      }, 500),
    );
  };
  const choose = (id: string | null) => {
    stop();
    setSelected((values) => ({ ...values, [category]: id }));
    if (id) {
      safeLocalStorage.setItem(UI_SOUND_KEYS[category], id);
      preview(id, category);
    } else safeLocalStorage.removeItem(UI_SOUND_KEYS[category]);
  };
  const playCategory = () => {
    stop();
    if (!enabled) return;
    setError("");
    const current = generation.current;
    const sounds = UI_SOUNDS.filter((sound) => sound.category === category);
    const strike = (id: string) => {
      if (current !== generation.current) return;
      setActive(id);
      void playUiClick(id, volumes[category]).then((ok) => {
        if (!ok && current === generation.current) {
          stop();
          setError("Audio unavailable. Try again with sound enabled.");
        }
      });
    };
    strike(sounds[0].id);
    sounds.slice(1).forEach((sound, index) => {
      timers.current.push(setTimeout(() => strike(sound.id), (index + 1) * 1000));
    });
    timers.current.push(setTimeout(stop, sounds.length * 1000));
  };
  return (
    <div className={styles.lab}>
      <UiClickFeedback />
      <div className={styles.sheet}>
        <header className={styles.header} data-ui-sound="off">
          <span className={styles.brand}>
            跳 <span>Tiao</span>
          </span>
          <button
            type="button"
            className={styles.mute}
            onClick={toggleSound}
            aria-pressed={!enabled}
          >
            {enabled ? "Mute" : "Unmute"}
          </button>
        </header>
        <div className={styles.titleRow}>
          <h1>UI sound lab</h1>
          <span className={styles.eyebrow}>Soft sounds / 02</span>
        </div>
        <div className={styles.workspace}>
          <section className={styles.soundSettings} aria-label="Sound choices" data-ui-sound="off">
            <div className={styles.tabs} role="tablist" aria-label="Sound category">
              {UI_SOUND_CATEGORIES.map((kind) => (
                <button
                  type="button"
                  role="tab"
                  key={kind}
                  id={`tab-${kind}`}
                  aria-controls="sound-options"
                  aria-selected={category === kind}
                  onClick={() => {
                    stop();
                    setCategory(kind);
                  }}
                  onKeyDown={(event) => {
                    const index = UI_SOUND_CATEGORIES.indexOf(kind);
                    const next =
                      event.key === "ArrowRight"
                        ? (index + 1) % 3
                        : event.key === "ArrowLeft"
                          ? (index + 2) % 3
                          : event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? 2
                              : null;
                    if (next === null) return;
                    event.preventDefault();
                    stop();
                    setCategory(UI_SOUND_CATEGORIES[next]);
                    document.getElementById(`tab-${UI_SOUND_CATEGORIES[next]}`)?.focus();
                  }}
                >
                  {UI_SOUND_LABELS[kind]}
                  <span>
                    {UI_SOUNDS.find((sound) => sound.id === selected[kind])?.name ?? "Off"}
                  </span>
                </button>
              ))}
            </div>
            <div id="sound-options" role="tabpanel" aria-labelledby={`tab-${category}`}>
              <label className={styles.volume}>
                Volume{" "}
                <input
                  aria-label={`${UI_SOUND_LABELS[category]} volume`}
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(volumes[category] * 100)}
                  onChange={(event) => {
                    stop();
                    const value = Number(event.target.value) / 100;
                    setVolumes((current) => ({ ...current, [category]: value }));
                    safeLocalStorage.setItem(soundVolumeKey(category), String(value));
                  }}
                />
                <output>{Math.round(volumes[category] * 100)}%</output>
              </label>
              <fieldset className={styles.list} aria-label={`${UI_SOUND_LABELS[category]} sound`}>
                {UI_SOUNDS.filter((sound) => sound.category === category).map((sound) => (
                  <label
                    className={`${styles.option} ${active === sound.id ? styles.active : ""}`}
                    key={sound.id}
                  >
                    <input
                      type="radio"
                      name={`sound-${category}`}
                      aria-label={`Select ${sound.name}`}
                      checked={selected[category] === sound.id}
                      onChange={() => choose(sound.id)}
                    />
                    <span className={styles.soundName}>
                      {sound.name}
                      <span className={styles.material}>{sound.material}</span>
                    </span>
                    <button
                      type="button"
                      className={styles.preview}
                      disabled={!enabled}
                      aria-label={`Preview ${sound.name}`}
                      onClick={() => preview(sound.id, category)}
                    >
                      ▶
                    </button>
                  </label>
                ))}
                <label className={styles.option}>
                  <input
                    type="radio"
                    name={`sound-${category}`}
                    aria-label={`Turn off ${UI_SOUND_LABELS[category].toLowerCase()} sound`}
                    checked={selected[category] === null}
                    onChange={() => choose(null)}
                  />
                  <span>Off</span>
                </label>
              </fieldset>
              <Button
                variant="outline"
                className="mt-4 w-full"
                disabled={!enabled}
                onClick={playCategory}
              >
                Play {UI_SOUND_LABELS[category].toLowerCase()} options
              </Button>
            </div>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <p className={styles.lastFeedback} role="status">
              {lastFeedback
                ? `${UI_SOUND_LABELS[lastFeedback]} · ${UI_SOUNDS.find((sound) => sound.id === selected[lastFeedback])?.name ?? "Off"}`
                : "Choose a sound, then try the playground."}
            </p>
          </section>
          <SoundPlayground />
        </div>
      </div>
    </div>
  );
}
