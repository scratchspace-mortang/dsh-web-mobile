import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { enterGestureVerdict } from '../core/composer-enter.ts'
import { installMobileEffect } from './phone-chrome.ts'

/**
 * Phone composer: a plain Enter inserts a line break instead of sending.
 *
 * Upstream `dsh-client-ui-conversation`'s keymap turns `KEY_ENTER_COMMAND` into
 * `submit()` and reserves the line break for Shift+Enter (see
 * `input/editor/keymap.ts` in the host: `if (event?.shiftKey === true) return
 * false` — false falls through to `@lexical/plain-text`, which dispatches
 * `INSERT_LINE_BREAK_COMMAND`). A touch keyboard has no Shift key, so before
 * this effect Enter could only send: the owner's report is 「Enter 键老是直接
 * 发送，不换行」.
 *
 * Fix: rewrite the gesture, not the outcome. In the capture phase, before the
 * composer's own keydown listener (it rides the editor root, bubble phase),
 * shadow `shiftKey` on the event instance. The host then sees exactly the
 * hardware Shift+Enter it already handles — the same line break, the same
 * draft state, no second implementation of the composer's text model. Sending
 * stays on the send button, and Ctrl/Cmd+Enter keeps its accelerated delivery.
 *
 * Scope is MOBILE_QUERY (`max-width: 1023px` + `pointer: coarse`), the same
 * gate as the rest of the phone chrome, so desktop windows keep Enter-to-send.
 * The cases that must not be rewritten (IME candidate pick, command/@-mention
 * popup pick) are decided in `core/composer-enter.ts` and pinned by its tests.
 *
 * DOM contract (host 0.2.0-rc.2): `[data-composer-card]` is the InputBar card
 * root, `[data-composer-input]` the Lexical editing surface, and the command /
 * mention popup mounts into `conversation.input.overlay` — the zero-height
 * anchor inside that same card — as a `role="listbox"`. Audit all three when
 * the conversation package upgrades.
 */

/** The composer card root (InputBar). */
const COMPOSER_CARD_SELECTOR = '[data-composer-card]'

/** The Lexical editing surface: the only element whose Enter this rewrites. */
const COMPOSER_INPUT_SELECTOR = '[data-composer-input]'

/** The command / @-mention popup's listbox, mounted inside the card. */
const POPUP_SELECTOR = '[role="listbox"]'

/**
 * What the effect decided so far, read by the `?mobile-nav-debug=1` badge.
 *
 * The rewrite is invisible when it works (the draft just gains a line) and
 * invisible when it declines, so a phone-side "Enter still sends" report cannot
 * be told apart from a stale bundle or an unarmed gate without these counters.
 */
export const composerEnterStats = {
  /** Whether the effect is installed right now (MOBILE_QUERY matched). */
  armed: false,
  /** Keydowns seen on a composer input. */
  seen: 0,
  /** Keydowns rewritten into the Shift+Enter line break. */
  breaks: 0,
  /** Plain Enters declined because a laid-out popup listbox was open. */
  menu: 0,
  /** Enters declined because an IME composition owned them. */
  ime: 0,
}

/** A popup only counts while it is laid out: a stale node must not decline. */
const isVisible = (el: Element): boolean => {
  const box = el.getBoundingClientRect()
  return box.width > 0 && box.height > 0 && el.getClientRects().length > 0
}

/** Whether the card holds a laid-out popup listbox right now. */
const popupOpen = (card: Element): boolean => {
  for (const popup of card.querySelectorAll(POPUP_SELECTOR)) if (isVisible(popup)) return true
  return false
}

/**
 * Install the phone Enter rewrite.
 * @param ctx - client root context.
 */
export function installComposerEnterNewline(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: composer Enter newline', () => {
    composerEnterStats.armed = true
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const input = target.closest<HTMLElement>(COMPOSER_INPUT_SELECTOR)
      if (input === null) return
      composerEnterStats.seen += 1
      const card = input.closest(COMPOSER_CARD_SELECTOR)
      const verdict = enterGestureVerdict(event, card !== null && popupOpen(card))
      if (verdict === 'ime') composerEnterStats.ime += 1
      else if (verdict === 'menu') composerEnterStats.menu += 1
      if (verdict !== 'break') return
      composerEnterStats.breaks += 1
      // The same event object the host's keymap will read, one phase later.
      Object.defineProperty(event, 'shiftKey', { configurable: true, get: () => true })
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      composerEnterStats.armed = false
      document.removeEventListener('keydown', onKeyDown, true)
    }
  })
}
