import { enterGestureVerdict } from './composer-enter.ts'

/**
 * The DOM wiring of the phone Enter rewrite, kept free of host imports so the
 * tests can drive it (which argument, which counter, when the shadow applies)
 * instead of grepping source text.
 *
 * Everything here mirrors a decision the host itself already makes:
 * - `[data-composer-input]` / `[data-composer-card]` — the Lexical surface and
 *   the InputBar card (`ui-conversation`'s DraftEditor / InputBar).
 * - `MENU_PICK_SELECTOR` — `ui-input-trigger`'s MenuView marks the highlighted
 *   row with `aria-selected`; its controller consumes Enter only when
 *   `highlight !== null`.
 * - `COMPOSING_GRACE_MS` and the per-input reset — `registerComposerKeymap`'s
 *   `composing`/`composingUntil` watch, which rides one editor root and resets
 *   on every root swap. The watch here is scoped the same way: only events
 *   whose target sits inside the composer input count, and a different input
 *   element starts a fresh watch.
 */

/** The composer card root (InputBar). */
export const COMPOSER_CARD_SELECTOR = '[data-composer-card]'

/** The Lexical editing surface: the only element whose Enter is rewritten. */
export const COMPOSER_INPUT_SELECTOR = '[data-composer-input]'

/** The host's menu row that Enter would pick. */
export const MENU_PICK_SELECTOR = '[data-trigger-menu] [role="option"][aria-selected="true"]'

/** The host's post-composition window: one tick, in milliseconds. */
export const COMPOSING_GRACE_MS = 10

/**
 * What the handler decided so far, read by the `?mobile-nav-debug=1` badge.
 *
 * The rewrite is invisible when it works (the draft just gains a line) and
 * invisible when it declines, so a phone-side "Enter still sends" report cannot
 * be told apart from a stale bundle or an unarmed gate without these counters.
 */
export const composerEnterStats = {
  /** Whether the effect is installed right now (MOBILE_QUERY matched). */
  armed: false,
  /** Keydowns seen on a composer input since the current arm. */
  seen: 0,
  /** Keydowns rewritten into the Shift+Enter line break. */
  breaks: 0,
  /** Plain Enters left alone because the menu had a highlighted row. */
  menu: 0,
  /** Enters left alone because an IME composition owned them. */
  ime: 0,
}

/** Reset every counter, so the badge describes the current arm only. */
export const resetComposerEnterStats = (armed: boolean): void => {
  composerEnterStats.armed = armed
  composerEnterStats.seen = 0
  composerEnterStats.breaks = 0
  composerEnterStats.menu = 0
  composerEnterStats.ime = 0
}

/** The listeners the install wires onto the document. */
export interface ComposerEnterHandler {
  /** Capture-phase keydown listener. */
  onKeyDown: (event: KeyboardEvent) => void
  /** Capture-phase compositionstart listener. */
  onCompositionStart: (event: CompositionEvent) => void
  /** Capture-phase compositionend listener. */
  onCompositionEnd: (event: CompositionEvent) => void
}

/**
 * Build the Enter handler.
 * @param now - clock, injectable so the composition window is testable.
 * @returns the listeners to install and remove.
 */
export function createComposerEnterHandler(now: () => number = Date.now): ComposerEnterHandler {
  // The host's watch (registerComposerKeymap): true through a composition on
  // one editor root and for one tick after that root's compositionend.
  let composing = false
  let composingUntil = 0
  let watchedInput: Element | null = null

  // A different input element is a different editor root to the host, which
  // resets its watch on every swap. Without this, a composition whose end was
  // never delivered (the input unmounted mid-composition) would keep the flag
  // set and silently disable the rewrite for the rest of the session.
  const adoptInput = (input: Element | null): Element | null => {
    if (input === null) return null
    if (input !== watchedInput) {
      composing = false
      composingUntil = 0
      watchedInput = input
    }
    return input
  }

  const compositionInput = (event: CompositionEvent): Element | null => {
    const target = event.target
    if (!(target instanceof Element)) return null
    return target.closest(COMPOSER_INPUT_SELECTOR)
  }

  const onCompositionStart = (event: CompositionEvent): void => {
    // A composition anywhere else (the command popup's search field, a settings
    // input) is not the composer's and must not count.
    if (adoptInput(compositionInput(event)) === null) return
    composing = true
  }

  const onCompositionEnd = (event: CompositionEvent): void => {
    if (adoptInput(compositionInput(event)) === null) return
    composing = false
    composingUntil = now() + COMPOSING_GRACE_MS
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const input = target.closest<HTMLElement>(COMPOSER_INPUT_SELECTOR)
    if (input === null) return
    adoptInput(input)
    composerEnterStats.seen += 1
    const verdict = enterGestureVerdict({
      key: event.key,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      isComposing: event.isComposing,
      keyCode: event.keyCode,
      recentlyComposing: composing || now() < composingUntil,
    }, () => {
      // Reached only for a plain Enter, so an open menu costs one query.
      const card = input.closest(COMPOSER_CARD_SELECTOR)
      return card !== null && card.querySelector(MENU_PICK_SELECTOR) !== null
    })
    if (verdict === 'ime') composerEnterStats.ime += 1
    else if (verdict === 'menu') composerEnterStats.menu += 1
    if (verdict !== 'break') return
    composerEnterStats.breaks += 1
    // The same event object the host's keymap will read, one phase later.
    Object.defineProperty(event, 'shiftKey', { configurable: true, get: () => true })
  }

  return { onKeyDown, onCompositionStart, onCompositionEnd }
}
