"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { focusScope, navigateFocus } from "@/lib/focusNavigation";
import { GamepadRepeater, INPUT_EVENT, type InputAction, isDirection } from "@/lib/gameInput";

type TextField = HTMLInputElement | HTMLTextAreaElement;

function isTextField(el: HTMLElement): el is TextField {
  return (
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement &&
      ["text", "email", "password", "search", "url", "tel", "number"].includes(el.type))
  );
}

function updateField(field: TextField, value: string) {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function ControllerKeyboard({ field, close }: { field: TextField; close: () => void }) {
  const t = useTranslations("input");
  const [value, setValue] = useState(field.value);
  const [upper, setUpper] = useState(false);
  // All printable ASCII characters are available, including punctuation in
  // existing passwords. Keep the letter rows in their familiar positions.
  const rows = [
    "1234567890",
    "qwertyuiop",
    "asdfghjkl",
    "zxcvbnm",
    "@._-+!#$%&",
    "*()=?/:,;",
    "\"'<>[]{}\\|",
    "^~`",
  ];
  return (
    <Dialog open onOpenChange={close} title={t("textEntry")} className="max-w-xl">
      <input
        data-controller-draft
        aria-label={t("textEntry")}
        className="mb-4 w-full rounded-lg border border-border bg-background p-3"
        type={field instanceof HTMLInputElement && field.type === "password" ? "password" : "text"}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={field.maxLength >= 0 ? field.maxLength : undefined}
      />
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row} className="grid grid-cols-10 gap-1">
            {Array.from(upper ? row.toUpperCase() : row).map((key) => (
              <Button
                key={key}
                variant="secondary"
                className="px-0"
                onClick={() =>
                  setValue((v) => (field.maxLength < 0 || v.length < field.maxLength ? v + key : v))
                }
              >
                {key}
              </Button>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          aria-label={t("shift")}
          aria-pressed={upper}
          onClick={() => setUpper(!upper)}
        >
          ⇧
        </Button>
        <Button variant="secondary" onClick={() => setValue((v) => v.slice(0, -1))}>
          {t("backspace")}
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            setValue((v) => (field.maxLength < 0 || v.length < field.maxLength ? `${v} ` : v))
          }
        >
          {t("space")}
        </Button>
        <Button
          onClick={() => {
            updateField(field, value);
            close();
          }}
        >
          {t("done")}
        </Button>
      </div>
    </Dialog>
  );
}

function ControllerSelect({ field, close }: { field: HTMLSelectElement; close: () => void }) {
  const t = useTranslations("input");
  return (
    <Dialog open onOpenChange={close} title={field.getAttribute("aria-label") || t("choose")}>
      <div className="grid gap-2">
        {Array.from(field.options)
          .filter((option) => !option.hidden)
          .map((option) => (
            <Button
              key={option.value}
              disabled={
                option.disabled ||
                (option.parentElement instanceof HTMLOptGroupElement &&
                  option.parentElement.disabled)
              }
              aria-pressed={option.selected}
              variant="secondary"
              onClick={() => {
                Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
                  field,
                  option.value,
                );
                field.dispatchEvent(new Event("change", { bubbles: true }));
                close();
              }}
            >
              {option.label}
            </Button>
          ))}
      </div>
    </Dialog>
  );
}

/** Shared by web, embeds and Electron; no native Steam dependency. */
export function InputNavigation() {
  const [field, setField] = useState<TextField | HTMLSelectElement | null>(null);

  useEffect(() => {
    const repeater = new GamepadRepeater();
    let frame = 0;
    function handleAction(action: InputAction) {
      document.documentElement.dataset.inputMode = "gamepad";
      const scope = focusScope();
      const active =
        document.activeElement instanceof HTMLElement && scope.contains(document.activeElement)
          ? document.activeElement
          : null;
      if (
        active &&
        !active.dispatchEvent(
          new CustomEvent(INPUT_EVENT, { detail: action, bubbles: true, cancelable: true }),
        )
      )
        return;
      if (isDirection(action) || action === "next" || action === "previous") {
        navigateFocus(action);
      } else if (action === "accept") {
        if (
          !active ||
          active === document.body ||
          !active.matches("button, a[href], input, textarea, select, summary, [tabindex]")
        ) {
          navigateFocus("next");
        } else if (
          isTextField(active) &&
          !active.readOnly &&
          !active.hasAttribute("data-controller-draft")
        ) {
          setField(active);
        } else if (active instanceof HTMLSelectElement) {
          setField(active);
        } else {
          active.click();
        }
      } else if (action === "cancel") {
        (active ?? scope).dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
      } else if (action === "menu" && scope === document.body) {
        document.querySelector<HTMLElement>("[data-game-menu]")?.click();
      }
    }
    function poll(now: number) {
      if (!document.hidden && document.hasFocus()) {
        try {
          for (const action of repeater.poll(Array.from(navigator.getGamepads?.() ?? []), now))
            handleAction(action);
        } catch {
          // Some iframe permissions policies deny gamepad access. Keyboard stays usable.
          repeater.reset();
        }
      } else repeater.reset();
      frame = requestAnimationFrame(poll);
    }
    const keyboard = (event: KeyboardEvent) => {
      if (event.isTrusted) document.documentElement.dataset.inputMode = "keyboard";
    };
    const pointer = () => {
      document.documentElement.dataset.inputMode = "pointer";
    };
    window.addEventListener("keydown", keyboard);
    window.addEventListener("pointerdown", pointer);
    frame = requestAnimationFrame(poll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", keyboard);
      window.removeEventListener("pointerdown", pointer);
      delete document.documentElement.dataset.inputMode;
    };
  }, []);

  const close = () => {
    setField(null);
  };
  return field ? (
    <div data-controller-editor>
      {field instanceof HTMLSelectElement ? (
        <ControllerSelect field={field} close={close} />
      ) : (
        <ControllerKeyboard field={field} close={close} />
      )}
    </div>
  ) : null;
}
