// Composer Enter on a phone: plain Enter must break the line, not send.
//
// Upstream `dsh-client-ui-conversation` sends on a plain Enter and reserves the
// line break for Shift+Enter, which a touch keyboard cannot produce. The plugin
// rewrites the gesture (shadows `shiftKey` on the event before the composer's
// own keydown listener sees it), so the decision is what these tests pin: which
// Enters are rewritten, and which ones must keep their upstream meaning.
//
// The DOM half (capture listener, closest() scoping, popup lookup) is
// browser-only; like the sibling effect tests, the source invariants it depends
// on are audited here and the behaviour is proven by
// `scripts/probes/composer-enter-newline-probe.mjs` against a live host.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { shouldBreakLineOnEnter } from '../src/client/core/composer-enter.ts'

const SOURCE = readFileSync(
  fileURLToPath(new URL('../src/client/effects/composer-enter-newline.ts', import.meta.url)),
  'utf8',
)
const ENTRY = readFileSync(
  fileURLToPath(new URL('../src/client/index.tsx', import.meta.url)),
  'utf8',
)

/** A bare Enter as a touch keyboard reports it. */
const PLAIN_ENTER = {
  key: 'Enter',
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  isComposing: false,
  keyCode: 13,
} as const

test('plain Enter is rewritten into the line break', () => {
  assert.equal(shouldBreakLineOnEnter(PLAIN_ENTER, false, false), true)
})

test('every modifier keeps its upstream meaning', () => {
  // Shift already breaks the line, Ctrl/Cmd select accelerated delivery, Alt is
  // an application shortcut: none of them is ours to rewrite.
  assert.equal(shouldBreakLineOnEnter({ ...PLAIN_ENTER, shiftKey: true }, false, false), false)
  assert.equal(shouldBreakLineOnEnter({ ...PLAIN_ENTER, ctrlKey: true }, false, false), false)
  assert.equal(shouldBreakLineOnEnter({ ...PLAIN_ENTER, metaKey: true }, false, false), false)
  assert.equal(shouldBreakLineOnEnter({ ...PLAIN_ENTER, altKey: true }, false, false), false)
})

test('an Enter the IME owns is never rewritten', () => {
  // Native composition flag.
  assert.equal(shouldBreakLineOnEnter({ ...PLAIN_ENTER, isComposing: true }, false, false), false)
  // Legacy signal engines emit without isComposing.
  assert.equal(shouldBreakLineOnEnter({ ...PLAIN_ENTER, keyCode: 229 }, false, false), false)
  // Safari delivers the closing keydown after compositionend; the composer
  // root still carries its marker for that window.
  assert.equal(shouldBreakLineOnEnter(PLAIN_ENTER, true, false), false)
})

test('an open command / @-mention popup keeps Enter as its pick gesture', () => {
  assert.equal(shouldBreakLineOnEnter(PLAIN_ENTER, false, true), false)
})

test('only the exact Enter key is touched', () => {
  for (const key of ['enter', 'Escape', ' ', 'Tab', 'Process']) {
    assert.equal(shouldBreakLineOnEnter({ ...PLAIN_ENTER, key }, false, false), false, key)
  }
})

test('the effect rewrites the gesture in the capture phase, before the composer', () => {
  // The host's keymap listener rides the editor root (bubble); document capture
  // is the one phase that runs before it.
  assert.match(SOURCE, /document\.addEventListener\('keydown', onKeyDown, true\)/)
  assert.match(SOURCE, /document\.removeEventListener\('keydown', onKeyDown, true\)/)
  assert.match(SOURCE, /Object\.defineProperty\(event, 'shiftKey', \{ configurable: true, get: \(\) => true \}\)/)
})

test('the rewrite is scoped to the composer input inside the composer card', () => {
  assert.match(SOURCE, /\[data-composer-input\]/)
  assert.match(SOURCE, /\[data-composer-card\]/)
  assert.match(SOURCE, /target\.closest<HTMLElement>\(COMPOSER_INPUT_SELECTOR\)/)
  assert.match(SOURCE, /input\.closest\(COMPOSER_CARD_SELECTOR\)/)
})

test('the decision reads the composition marker and the popup listbox', () => {
  assert.match(SOURCE, /data-composer-composing/)
  assert.match(SOURCE, /input\.hasAttribute\(COMPOSING_ATTRIBUTE\)/)
  // The command / @-mention popup mounts into `conversation.input.overlay`, the
  // zero-height anchor inside the card, and renders a role="listbox".
  assert.match(SOURCE, /\[role="listbox"\]/)
  assert.match(SOURCE, /card\.querySelector\(POPUP_SELECTOR\) !== null/)
})

test('the effect is gated on the mobile branch, so desktop keeps Enter-to-send', () => {
  // installMobileEffect re-arms on MOBILE_QUERY changes and is a no-op on a
  // fine-pointer window; the desktop half of the probe proves the same live.
  assert.match(SOURCE, /installMobileEffect\(ctx, 'dsh-web-mobile: composer Enter newline'/)
  assert.doesNotMatch(SOURCE, /TOUCH_QUERY|DESKTOP_QUERY/)
})

test('the plugin entry installs the effect', () => {
  assert.match(ENTRY, /import \{ installComposerEnterNewline \} from '\.\/effects\/composer-enter-newline\.ts'/)
  assert.match(ENTRY, /installComposerEnterNewline\(ctx\)/)
})
