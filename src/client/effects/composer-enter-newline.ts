import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  createComposerEnterHandler,
  resetComposerEnterStats,
} from '../core/composer-enter-handler.ts'
import { installMobileEffect } from './phone-chrome.ts'

/**
 * Phone composer: a plain Enter inserts a line break instead of sending.
 *
 * Upstream `dsh-client-ui-conversation`'s keymap turns `KEY_ENTER_COMMAND` into
 * `submit()` and reserves the line break for Shift+Enter (see
 * `input/editor/keymap.ts` in the host: `if (event?.shiftKey === true) return
 * false` — false falls through to `@lexical/plain-text`). A touch keyboard has
 * no Shift key, so before this effect Enter could only send: the owner's
 * report is 「Enter 键老是直接发送，不换行」.
 *
 * Fix: rewrite the gesture, not the outcome. In the capture phase, before the
 * composer's own keydown listener (it rides the editor root, bubble phase),
 * shadow `shiftKey` on the event instance. The host then sees exactly the
 * hardware Shift+Enter it already handles — the same composer text model, no
 * second implementation of it. Sending stays on the send button, and
 * Ctrl/Cmd+Enter keeps its accelerated delivery.
 *
 * Scope is MOBILE_QUERY (`max-width: 1023px` + `pointer: coarse`), the same
 * gate as the rest of the phone chrome, so desktop windows keep Enter-to-send.
 * The decision and its host-mirrored inputs live in
 * `core/composer-enter.ts` + `core/composer-enter-handler.ts`, where the tests
 * drive them; this module only wires the listeners.
 */

/**
 * Install the phone Enter rewrite.
 * @param ctx - client root context.
 */
export function installComposerEnterNewline(ctx: ClientContext): void {
  installMobileEffect(ctx, 'dsh-web-mobile: composer Enter newline', () => {
    resetComposerEnterStats(true)
    const handler = createComposerEnterHandler()
    // Capture phase on the document: the host's keymap rides the editor root
    // (bubble), so this runs first. Composition events bubble too, so the same
    // document-level watch sees every one the host's root listener sees.
    document.addEventListener('keydown', handler.onKeyDown, true)
    document.addEventListener('compositionstart', handler.onCompositionStart, true)
    document.addEventListener('compositionend', handler.onCompositionEnd, true)
    return () => {
      resetComposerEnterStats(false)
      document.removeEventListener('keydown', handler.onKeyDown, true)
      document.removeEventListener('compositionstart', handler.onCompositionStart, true)
      document.removeEventListener('compositionend', handler.onCompositionEnd, true)
    }
  })
}
