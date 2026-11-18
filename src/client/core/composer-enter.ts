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
 * while the mobile branch is armed. The composer then takes the path it already
 * has for a shifted Enter. On iOS that path ends in a paragraph: a real
 * Shift+Enter arrives as the native `insertLineBreak`, while the shadowed plain
 * Enter arrives as `insertParagraph`, which Lexical maps to INSERT_PARAGRAPH.
 * Either way the composer gains a new line. Sending stays on the send button.
 *
 * The decision is a pure function so the cases that must NOT be rewritten are
 * pinned by tests instead of living only in a browser listener: an IME Enter, a
 * modified Enter (Ctrl/Cmd accelerate, Shift already a line break, Alt is a
 * shortcut), and an Enter that picks a highlighted command / @-mention row. It
 * reports WHY, so the debug badge can show a phone-side report instead of a
 * silent no-op.
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
  /**
   * The host's own composition watch: true through a composition and for one
   * tick after `compositionend` (Safari delivers its closing keydown late).
   * The caller mirrors `registerComposerKeymap`'s watch for this field.
   */
  readonly recentlyComposing: boolean
}

/**
 * What the plugin does with one keydown: `break` rewrites it into the
 * Shift+Enter line break, every other verdict leaves the host untouched.
 */
export type EnterVerdict = 'break' | 'other-key' | 'modifier' | 'ime' | 'menu'

/** `keyCode` engines report for a key that belongs to an IME composition. */
const IME_KEY_CODE = 229

/**
 * Decide what to do with this keydown.
 *
 * The composition test mirrors the host's own (`isComposing`, then the legacy
 * 229 keyCode, then its `recentlyComposing()` watch). It deliberately does NOT
 * read the composer root's `data-composer-composing` marker: that marker also
 * carries the editor's long-lived composition state, so a stale marker (an
 * engine that never delivers `compositionend`) would decline here while the
 * host still sends the same keydown. The watch is read from the same DOM
 * composition events the host listens to, so the two agree on the window.
 *
 * @param gesture - the keydown's key, modifier and composition state.
 * @param menuPicksEnter - called only after the cheap checks pass; true when
 *   the open command / @-mention menu holds a highlighted row, which is the
 *   only state in which the host consumes Enter as a pick.
 * @returns `break` when the caller should rewrite the gesture to Shift+Enter.
 */
export function enterGestureVerdict(
  gesture: EnterGesture,
  menuPicksEnter: () => boolean,
): EnterVerdict {
  if (gesture.key !== 'Enter') return 'other-key'
  if (gesture.shiftKey || gesture.ctrlKey || gesture.metaKey || gesture.altKey) return 'modifier'
  if (gesture.isComposing || gesture.keyCode === IME_KEY_CODE || gesture.recentlyComposing) return 'ime'
  if (menuPicksEnter()) return 'menu'
  return 'break'
}
