# Keyboard and controller input

The renderer owns input for web, Electron (including Steam), and embeds.
`InputNavigation` polls the browser Gamepad API; boards use `useBoardInput`.
All game modes using `TiaoBoard` share the same controls. The interactive
tutorial uses the same cursor and commands with its own rules engine.

## Controls

| Action | Keyboard | Standard controller |
| --- | --- | --- |
| Move board cursor | Arrows or WASD | D-pad or left stick |
| Place, select, jump, activate a control | Enter or Space | South face button (A / Cross) |
| Confirm pending captures | C, or activate the landing stone | West face button (X / Square), or activate the landing stone |
| Undo one pending jump; otherwise deselect | X, Backspace, or Escape on the board | East face button (B / Circle) |
| Move between board and menus | Tab / Shift+Tab | RB / LB |
| Move through menus | Tab / Shift+Tab | D-pad or left stick; RB / LB also traverse in document order |
| Close the current dialog or navigation drawer | Escape | B / Circle |
| Open navigation outside dialogs | Tab to navigation button, then Enter | Start / Options |
| Enter text | Type normally | A / Cross on a field opens an on-screen keyboard |
| Choose a select value | Native keyboard controls | A / Cross opens an option picker |

Board cells have coordinate names and one roving Tab stop per board, starting
at its center. Focus remains visible with either input surface. Undo returns
the cursor to the undone jump's origin. Dialogs and the navigation drawer
trap focus, restore their invoking control, and consume only their own input.
Mandatory game-setup dialogs remain non-dismissable.

Text entry edits a draft and applies it only on Done; B discards it. Password
drafts stay masked. Number steppers also have directly reachable +/− buttons.
Mouse and touch continue to use the existing board handlers.

## Device and host contract

Only `mapping: "standard"` is interpreted. Button indices follow the
[W3C standard mapping](https://w3c.github.io/gamepad/). Unknown device layouts
need host-level remapping; guessing would put game actions on wrong buttons.
For Steam Input, use a Gamepad layout that exposes a standard virtual
controller. There are no native Steam Input action sets or device-specific
glyph detection in this implementation. Glyph pairs identify physical button
positions; Nintendo labels can differ.

The host must expose `navigator.getGamepads`. Web hosting should use HTTPS;
embedded hosts must permit the Gamepad API. The desktop `app` scheme is already
registered as secure. The first connecting/focused frame arms held controls
without firing them; release and press to act. Returning after window blur or a hidden-document transition follows the same
rule. Only directions repeat (320 ms delay,
100 ms cadence); destructive/confirm/activation actions require fresh presses.
Several controllers share one cursor, including local two-player games.

No controller handles, names, or input events are persisted or sent to a server.
External OAuth/provider pages and operating-system purchase dialogs keep their
own host controls.

## Validation

`gameInput.test.ts` covers standard mapping, deadzone, sparse controller slots,
repeat timing, reconnection, focus reset and duplicate presses.
`InputNavigation.test.tsx` drives the real local-game hook through placements,
a capture, undo and confirmation, plus modal trapping and text/select entry.
The existing board, setup, tutorial, drawer and dialog suites cover the shared
surfaces. Browser checks exercise native Enter/Space/Tab behavior and simulated
standard-controller polling in the rendered application.

Physical USB/Bluetooth controllers, Steam Input/Steam Deck, overlay focus
transitions and external account/purchase screens require device-level QA
before a storefront controller-support claim. Software-injected gamepads do
not establish hardware compatibility.
