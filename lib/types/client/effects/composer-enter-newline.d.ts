import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
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
 * shadow `shiftKey` on the event instance. The host then sees the hardware
 * Shift+Enter it already handles — the same composer text model, no second
 * implementation of it. Sending stays on the send button, and Ctrl/Cmd+Enter
 * keeps its accelerated delivery.
 *
 * Known ceiling: on iOS, `@lexical/plain-text` declines that branch and the
 * native `insertParagraph` lands instead, so the inserted node is a paragraph
 * rather than a `\n` line break. Both are a new line in the composer; only the
 * node type differs, and no Safari/WebKit run has confirmed it here.
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
export declare function installComposerEnterNewline(ctx: ClientContext): void;
//# sourceMappingURL=composer-enter-newline.d.ts.map