/**
 * The plain-Enter decision for the phone composer.
 *
 * Upstream `dsh-client-ui-conversation` treats a plain Enter as the submit
 * gesture: its keymap intercepts `KEY_ENTER_COMMAND`, calls `submit()`, and
 * leaves Shift+Enter as the only line break. A phone keyboard has no Shift
 * key, so on touch devices the Enter key could only ever send — the user's
 * report is 「Enter 键老是直接发送，不换行」.
 *
 * The plugin therefore rewrites a plain Enter into the Shift+Enter gesture
 * while the mobile branch is armed. Everything the composer already does with
 * a shifted Enter (line break through `@lexical/plain-text`) then applies
 * unchanged, and sending stays on the send button.
 *
 * The decision is a pure function so the cases that must NOT be rewritten are
 * pinned by tests instead of living only in a browser listener: an IME
 * candidate-pick Enter, a modified Enter (Ctrl/Cmd accelerate, Shift already a
 * line break, Alt is a shortcut), and an Enter that belongs to the command or
 * @-mention popup, whose highlighted row Enter picks.
 */

/** The keydown fields the decision reads (a DOM KeyboardEvent satisfies it). */
export interface EnterGesture {
  /** `KeyboardEvent.key`; only the exact `'Enter'` is the composer gesture. */
  readonly key: string
  /** Shift already means a line break upstream — nothing to rewrite. */
  readonly shiftKey: boolean
  /** Ctrl+Enter / Cmd+Enter select accelerated delivery upstream. */
  readonly ctrlKey: boolean
  /** Cmd+Enter selects accelerated delivery upstream. */
  readonly metaKey: boolean
  /** Alt+Enter belongs to application shortcuts. */
  readonly altKey: boolean
  /** Native IME composition flag. */
  readonly isComposing: boolean
  /** Legacy IME signal: engines emit 229 for a key the IME owns. */
  readonly keyCode: number
}

/** `keyCode` engines report for a key that belongs to an IME composition. */
const IME_KEY_CODE = 229

/**
 * Decide whether this keydown must become the Shift+Enter line break.
 * @param gesture - the keydown's key and modifier/composition state.
 * @param composing - whether the composer root still carries its composition
 *   marker (it holds through the IME's closing keydown, which `isComposing`
 *   alone misses on Safari).
 * @param menuOpen - whether the command / @-mention popup is open; its
 *   highlighted row is what Enter picks there.
 * @returns true when the caller should rewrite the gesture to Shift+Enter.
 */
export function shouldBreakLineOnEnter(
  gesture: EnterGesture,
  composing: boolean,
  menuOpen: boolean,
): boolean {
  if (gesture.key !== 'Enter') return false
  if (gesture.shiftKey || gesture.ctrlKey || gesture.metaKey || gesture.altKey) return false
  if (gesture.isComposing || gesture.keyCode === IME_KEY_CODE || composing) return false
  if (menuOpen) return false
  return true
}
