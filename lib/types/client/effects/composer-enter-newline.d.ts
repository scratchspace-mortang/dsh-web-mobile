import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
/**
 * What the effect decided so far, read by the `?mobile-nav-debug=1` badge.
 *
 * The rewrite is invisible when it works (the draft just gains a line) and
 * invisible when it declines, so a phone-side "Enter still sends" report cannot
 * be told apart from a stale bundle or an unarmed gate without these counters.
 */
export declare const composerEnterStats: {
    /** Whether the effect is installed right now (MOBILE_QUERY matched). */
    armed: boolean;
    /** Keydowns seen on a composer input. */
    seen: number;
    /** Keydowns rewritten into the Shift+Enter line break. */
    breaks: number;
    /** Plain Enters declined because a laid-out popup listbox was open. */
    menu: number;
    /** Enters declined because an IME composition owned them. */
    ime: number;
};
/**
 * Install the phone Enter rewrite.
 * @param ctx - client root context.
 */
export declare function installComposerEnterNewline(ctx: ClientContext): void;
//# sourceMappingURL=composer-enter-newline.d.ts.map