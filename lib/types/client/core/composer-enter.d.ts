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
 * @-mention popup, whose highlighted row Enter picks. It reports WHY, so the
 * debug badge can show a phone-side report instead of a silent no-op.
 */
/** The keydown fields the decision reads (a DOM KeyboardEvent satisfies it). */
export interface EnterGesture {
    /** `KeyboardEvent.key`; only the exact `'Enter'` is the composer gesture. */
    readonly key: string;
    /** Shift already means a line break upstream — nothing to rewrite. */
    readonly shiftKey: boolean;
    /** Ctrl+Enter / Cmd+Enter select accelerated delivery upstream. */
    readonly ctrlKey: boolean;
    /** Cmd+Enter selects accelerated delivery upstream. */
    readonly metaKey: boolean;
    /** Alt+Enter belongs to application shortcuts. */
    readonly altKey: boolean;
    /** Native IME composition flag. */
    readonly isComposing: boolean;
    /** Legacy IME signal: engines emit 229 for a key the IME owns. */
    readonly keyCode: number;
}
/**
 * What the plugin does with one keydown: `break` rewrites it into the
 * Shift+Enter line break, every other verdict leaves the host untouched.
 */
export type EnterVerdict = 'break' | 'other-key' | 'modifier' | 'ime' | 'menu';
/**
 * Decide what to do with this keydown.
 *
 * The IME test reads the same two signals the host's own keymap reads
 * (`isComposing`, then the legacy 229 keyCode), so this decision can never
 * disagree with the host about whether an Enter belongs to a composition. The
 * composer root's `data-composer-composing` marker is deliberately NOT read:
 * it is derived from the editor's long-lived composition state, so a stale
 * marker (an engine that never delivers `compositionend`) would make this
 * function decline while the host still treats the same keydown as a send.
 *
 * @param gesture - the keydown's key and modifier/composition state.
 * @param menuOpen - whether the command / @-mention popup is open; its
 *   highlighted row is what Enter picks there.
 * @returns `break` when the caller should rewrite the gesture to Shift+Enter.
 */
export declare function enterGestureVerdict(gesture: EnterGesture, menuOpen: boolean): EnterVerdict;
//# sourceMappingURL=composer-enter.d.ts.map