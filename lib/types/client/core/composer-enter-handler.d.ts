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
export declare const COMPOSER_CARD_SELECTOR = "[data-composer-card]";
/** The Lexical editing surface: the only element whose Enter is rewritten. */
export declare const COMPOSER_INPUT_SELECTOR = "[data-composer-input]";
/** The host's menu row that Enter would pick. */
export declare const MENU_PICK_SELECTOR = "[data-trigger-menu] [role=\"option\"][aria-selected=\"true\"]";
/** The host's post-composition window: one tick, in milliseconds. */
export declare const COMPOSING_GRACE_MS = 10;
/**
 * What the handler decided so far, read by the `?mobile-nav-debug=1` badge.
 *
 * The rewrite is invisible when it works (the draft just gains a line) and
 * invisible when it declines, so a phone-side "Enter still sends" report cannot
 * be told apart from a stale bundle or an unarmed gate without these counters.
 */
export declare const composerEnterStats: {
    /** Whether the effect is installed right now (MOBILE_QUERY matched). */
    armed: boolean;
    /** Keydowns seen on a composer input since the current arm. */
    seen: number;
    /** Keydowns rewritten into the Shift+Enter line break. */
    breaks: number;
    /** Plain Enters left alone because the menu had a highlighted row. */
    menu: number;
    /** Enters left alone because an IME composition owned them. */
    ime: number;
};
/** Reset every counter, so the badge describes the current arm only. */
export declare const resetComposerEnterStats: (armed: boolean) => void;
/** The listeners the install wires onto the document. */
export interface ComposerEnterHandler {
    /** Capture-phase keydown listener. */
    onKeyDown: (event: KeyboardEvent) => void;
    /** Capture-phase compositionstart listener. */
    onCompositionStart: (event: CompositionEvent) => void;
    /** Capture-phase compositionend listener. */
    onCompositionEnd: (event: CompositionEvent) => void;
}
/**
 * Build the Enter handler.
 * @param now - clock, injectable so the composition window is testable.
 * @returns the listeners to install and remove.
 */
export declare function createComposerEnterHandler(now?: () => number): ComposerEnterHandler;
//# sourceMappingURL=composer-enter-handler.d.ts.map