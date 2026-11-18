import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { shouldBreakLineOnEnter } from '../core/composer-enter.ts'
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
 * Scope is MOBILE_QUERY (`max-width: 1023px` + `pointer: coarse`), so desktop
 * windows and tablets with a hardware keyboard keep Enter-to-send. The cases
 * that must not be rewritten (IME candidate pick, command/@-mention popup
 * pick) are decided in `core/composer-enter.ts` and pinned by its tests.
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

/** Root attribute the composer holds while an IME composition owns the keys. */
const COMPOSING_ATTRIBUTE = 'data-composer-composing'

/** The command / @-mention popup's listbox, mounted inside the card. */
const POPUP_SELECTOR = '[role="listbox"]'

/**
 * Install the phone Enter rewrite.
 * @param ctx - client root context.
 */
export function installComposerEnterNewline(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: composer Enter newline', () => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const input = target.closest<HTMLElement>(COMPOSER_INPUT_SELECTOR)
      if (input === null) return
      const card = input.closest(COMPOSER_CARD_SELECTOR)
      const menuOpen = card !== null && card.querySelector(POPUP_SELECTOR) !== null
      if (!shouldBreakLineOnEnter(event, input.hasAttribute(COMPOSING_ATTRIBUTE), menuOpen)) return
      // The same event object the host's keymap will read, one phase later.
      Object.defineProperty(event, 'shiftKey', { configurable: true, get: () => true })
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  })
}
