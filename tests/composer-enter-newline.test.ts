// Composer Enter on a phone: plain Enter must break the line, not send.
//
// Upstream `dsh-client-ui-conversation` sends on a plain Enter and reserves the
// line break for Shift+Enter, which a touch keyboard cannot produce. The plugin
// rewrites the gesture (shadows `shiftKey` on the event before the composer's
// own keydown listener sees it).
//
// These tests drive the real handler with minimal DOM stand-ins, so they fail
// when the wiring breaks: the wrong argument, the shadow applied on a declined
// verdict, a counter moved above its guard, the menu query run for every
// keydown, or the composition window ignored. The only source-text assertions
// left are the document registrations, which need a browser document.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { enterGestureVerdict } from '../src/client/core/composer-enter.ts'
import {
  COMPOSER_CARD_SELECTOR,
  COMPOSER_INPUT_SELECTOR,
  COMPOSING_GRACE_MS,
  MENU_PICK_SELECTOR,
  composerEnterStats,
  createComposerEnterHandler,
  resetComposerEnterStats,
} from '../src/client/core/composer-enter-handler.ts'

const SOURCE = readFileSync(
  fileURLToPath(new URL('../src/client/effects/composer-enter-newline.ts', import.meta.url)),
  'utf8',
)
const ENTRY = readFileSync(
  fileURLToPath(new URL('../src/client/index.tsx', import.meta.url)),
  'utf8',
)

// The handler only uses `instanceof Element`, `closest()` and `querySelector()`,
// so a bare class plus those two methods is a faithful stand-in.
class FakeElement {}
;(globalThis as unknown as { Element: unknown }).Element = FakeElement

interface FakeDom {
  /** Dispatch one keydown and report what the host would read afterwards. */
  press: (overrides?: Record<string, unknown>) => { shiftKey: boolean; menuQueries: number }
  onCompositionStart: () => void
  onCompositionEnd: () => void
  advance: (ms: number) => void
}

/**
 * Build the handler over a fake composer.
 * @param menuPicks - whether the card holds a highlighted menu row.
 * @param clockStart - the fake clock's first reading.
 * @returns the fake document's controls.
 */
function fakeDom(menuPicks: boolean, clockStart = 1000): FakeDom {
  let clock = clockStart
  const handler = createComposerEnterHandler(() => clock)
  let menuQueries = 0
  const card = {
    querySelector(selector: string) {
      menuQueries += 1
      return menuPicks && selector === MENU_PICK_SELECTOR ? new FakeElement() : null
    },
  }
  const input = Object.assign(new FakeElement(), {
    closest: (selector: string) => (selector === COMPOSER_CARD_SELECTOR ? card : null),
  })
  const target = Object.assign(new FakeElement(), {
    closest: (selector: string) => (selector === COMPOSER_INPUT_SELECTOR ? input : null),
  })
  resetComposerEnterStats(true)
  return {
    press: (overrides = {}) => {
      menuQueries = 0
      const event = {
        target,
        key: 'Enter',
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        isComposing: false,
        keyCode: 13,
        ...overrides,
      }
      handler.onKeyDown(event as unknown as KeyboardEvent)
      return { shiftKey: event.shiftKey, menuQueries }
    },
    onCompositionStart: handler.onCompositionStart,
    onCompositionEnd: handler.onCompositionEnd,
    advance: (ms: number) => { clock += ms },
  }
}

/** A bare Enter as a touch keyboard reports it. */
const PLAIN_ENTER = {
  key: 'Enter',
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  isComposing: false,
  keyCode: 13,
  recentlyComposing: false,
} as const

test('plain Enter is rewritten into the line break', () => {
  assert.equal(enterGestureVerdict(PLAIN_ENTER, () => false), 'break')
})

test('every modifier keeps its upstream meaning', () => {
  // Shift already breaks the line, Ctrl/Cmd select accelerated delivery, Alt is
  // an application shortcut: none of them is ours to rewrite.
  assert.equal(enterGestureVerdict({ ...PLAIN_ENTER, shiftKey: true }, () => false), 'modifier')
  assert.equal(enterGestureVerdict({ ...PLAIN_ENTER, ctrlKey: true }, () => false), 'modifier')
  assert.equal(enterGestureVerdict({ ...PLAIN_ENTER, metaKey: true }, () => false), 'modifier')
  assert.equal(enterGestureVerdict({ ...PLAIN_ENTER, altKey: true }, () => false), 'modifier')
})

test('an Enter the IME owns is never rewritten', () => {
  // Native composition flag.
  assert.equal(enterGestureVerdict({ ...PLAIN_ENTER, isComposing: true }, () => false), 'ime')
  // Legacy signal engines emit without isComposing.
  assert.equal(enterGestureVerdict({ ...PLAIN_ENTER, keyCode: 229 }, () => false), 'ime')
  // The host's own post-composition window, which the plugin mirrors.
  assert.equal(enterGestureVerdict({ ...PLAIN_ENTER, recentlyComposing: true }, () => false), 'ime')
})

test('only the exact Enter key is touched', () => {
  for (const key of ['enter', 'Escape', ' ', 'Tab', 'Process']) {
    assert.equal(enterGestureVerdict({ ...PLAIN_ENTER, key }, () => false), 'other-key', key)
  }
})

test('the menu decides only while it holds a highlighted row', () => {
  assert.equal(enterGestureVerdict(PLAIN_ENTER, () => true), 'menu')
  // An open menu with pending sources has no highlight, and the host sends in
  // that state, so the rewrite must still apply.
  assert.equal(enterGestureVerdict(PLAIN_ENTER, () => false), 'break')
})

test('a plain Enter on the composer is shadowed for the host', () => {
  const dom = fakeDom(false)
  assert.equal(dom.press().shiftKey, true)
  assert.equal(composerEnterStats.breaks, 1)
  assert.equal(composerEnterStats.seen, 1)
})

test('a highlighted menu row leaves the event untouched', () => {
  const dom = fakeDom(true)
  assert.equal(dom.press().shiftKey, false)
  assert.equal(composerEnterStats.menu, 1)
  assert.equal(composerEnterStats.breaks, 0)
})

test('the menu is queried only for a plain Enter', () => {
  // A keystroke that cannot be rewritten must not pay for a DOM query, and the
  // query must not run before the key and modifier checks.
  const dom = fakeDom(true)
  assert.equal(dom.press({ key: 'a' }).menuQueries, 0)
  assert.equal(dom.press({ shiftKey: true }).menuQueries, 0)
  assert.equal(dom.press({ isComposing: true }).menuQueries, 0)
  assert.equal(dom.press().menuQueries, 1)
})

test('the composition window is the host window, one tick past compositionend', () => {
  const dom = fakeDom(false)
  dom.onCompositionStart()
  assert.equal(dom.press().shiftKey, false)
  assert.equal(composerEnterStats.ime, 1)
  dom.onCompositionEnd()
  dom.advance(COMPOSING_GRACE_MS - 1)
  assert.equal(dom.press().shiftKey, false)
  dom.advance(1)
  // Exactly COMPOSING_GRACE_MS after compositionend the host no longer treats
  // the Enter as a composition key, so the rewrite applies.
  assert.equal(dom.press().shiftKey, true)
  assert.equal(composerEnterStats.breaks, 1)
  assert.equal(composerEnterStats.ime, 2)
})

test('a keydown outside the composer input is ignored', () => {
  const dom = fakeDom(false)
  const outside = Object.assign(new FakeElement(), { closest: () => null })
  const event = {
    target: outside, key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false,
    altKey: false, isComposing: false, keyCode: 13,
  }
  createComposerEnterHandler().onKeyDown(event as unknown as KeyboardEvent)
  assert.equal(composerEnterStats.seen, 0)
  assert.equal(composerEnterStats.breaks, 0)
})

test('the counters describe the current arm only', () => {
  const dom = fakeDom(false)
  dom.press()
  assert.equal(composerEnterStats.breaks, 1)
  resetComposerEnterStats(true)
  assert.deepEqual(
    { ...composerEnterStats },
    { armed: true, seen: 0, breaks: 0, menu: 0, ime: 0 },
  )
  resetComposerEnterStats(false)
  assert.equal(composerEnterStats.armed, false)
})

test('the effect registers capture-phase keydown and composition listeners', () => {
  // Document registration is the one part the fake DOM cannot exercise.
  assert.match(SOURCE, /document\.addEventListener\('keydown', handler\.onKeyDown, true\)/)
  assert.match(SOURCE, /document\.removeEventListener\('keydown', handler\.onKeyDown, true\)/)
  assert.match(SOURCE, /document\.addEventListener\('compositionstart', handler\.onCompositionStart, true\)/)
  assert.match(SOURCE, /document\.addEventListener\('compositionend', handler\.onCompositionEnd, true\)/)
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
