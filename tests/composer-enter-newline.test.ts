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
// keydown, the composition watch un-scoped or never reset, or a constant that
// drifted from the host's markup. Source-text assertions cover only what needs
// a real document (listener registration) or a real build (the plugin entry).
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

/**
 * A keydown whose `shiftKey` lives on the prototype as a getter, like a real
 * `KeyboardEvent`: reading works, and a plain assignment throws in strict mode.
 * That is what makes "shadow it" (defineProperty) different from "set it".
 */
class FakeKeydown {
  readonly target: unknown
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  readonly isComposing: boolean
  readonly keyCode: number
  private shift: boolean

  constructor(target: unknown, overrides: Record<string, unknown> = {}) {
    this.target = target
    this.key = 'Enter'
    this.ctrlKey = false
    this.metaKey = false
    this.altKey = false
    this.isComposing = false
    this.keyCode = 13
    this.shift = overrides.shiftKey === true
    for (const [key, value] of Object.entries(overrides)) {
      if (key !== 'shiftKey') (this as unknown as Record<string, unknown>)[key] = value
    }
  }

  get shiftKey(): boolean {
    return this.shift
  }
}

interface FakeComposer {
  /** An element inside the composer input, as a keydown target. */
  readonly target: FakeElement
  /** A second, distinct composer input (a replaced editor root). */
  readonly nextInput: () => { target: FakeElement; input: FakeElement }
  /** Dispatch one keydown and report what the host would read afterwards. */
  readonly press: (target: FakeElement, overrides?: Record<string, unknown>) => {
    shiftKey: boolean
    ownGetter: boolean
    menuQueries: number
  }
  /** Dispatch a composition event at an arbitrary target. */
  readonly compose: (phase: 'start' | 'end', target: FakeElement) => void
  readonly advance: (ms: number) => void
}

/**
 * Build a handler over a fake composer.
 * @param menuPicks - whether the card holds a highlighted menu row.
 * @param clockStart - the fake clock's first reading.
 * @returns the fake document's controls.
 */
function fakeComposer(menuPicks: boolean, clockStart = 1000): FakeComposer {
  let clock = clockStart
  let menuQueries = 0
  const handler = createComposerEnterHandler(() => clock)
  const card = {
    querySelector(selector: string) {
      menuQueries += 1
      return menuPicks && selector === MENU_PICK_SELECTOR ? new FakeElement() : null
    },
  }
  const makeInput = (): { target: FakeElement; input: FakeElement } => {
    const input = Object.assign(new FakeElement(), {
      closest: (selector: string) => (selector === COMPOSER_CARD_SELECTOR ? card : null),
    })
    const target = Object.assign(new FakeElement(), {
      closest: (selector: string) => (selector === COMPOSER_INPUT_SELECTOR ? input : null),
    })
    return { target, input }
  }
  const first = makeInput()
  resetComposerEnterStats(true)
  return {
    target: first.target,
    nextInput: makeInput,
    press: (target, overrides = {}) => {
      menuQueries = 0
      const event = new FakeKeydown(target, overrides)
      handler.onKeyDown(event as unknown as KeyboardEvent)
      return {
        shiftKey: event.shiftKey,
        ownGetter: Object.getOwnPropertyDescriptor(event, 'shiftKey')?.get !== undefined,
        menuQueries,
      }
    },
    compose: (phase, target) => {
      const event = { target } as unknown as CompositionEvent
      if (phase === 'start') handler.onCompositionStart(event)
      else handler.onCompositionEnd(event)
    },
    advance: (ms: number) => { clock += ms },
  }
}

/** An element that is not inside a composer input (a popup field, a setting). */
const outsideTarget = (): FakeElement => Object.assign(new FakeElement(), { closest: () => null })

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

test('the constants match the host markup and its composition window', () => {
  // ui-input-trigger's MenuView: `[data-trigger-menu]` root, `role="option"` rows
  // with `aria-selected` set from `state.highlight`. The controller consumes
  // Enter only when that highlight is not null.
  assert.equal(MENU_PICK_SELECTOR, '[data-trigger-menu] [role="option"][aria-selected="true"]')
  // registerComposerKeymap's `composingUntil = Date.now() + 10`.
  assert.equal(COMPOSING_GRACE_MS, 10)
})

test('a plain Enter on the composer is shadowed for the host', () => {
  const dom = fakeComposer(false)
  const press = dom.press(dom.target)
  assert.equal(press.shiftKey, true)
  // A shadow, not an assignment: the real event's shiftKey is a prototype
  // getter, so the handler must install its own getter on the instance.
  assert.equal(press.ownGetter, true)
  assert.equal(composerEnterStats.breaks, 1)
  assert.equal(composerEnterStats.seen, 1)
})

test('the fake keydown rejects a plain assignment, like a real event', () => {
  // Guards the test above: if this ever starts passing silently, the shadow
  // assertion no longer proves the handler uses defineProperty.
  const event = new FakeKeydown(fakeComposer(false).target)
  assert.throws(() => { (event as unknown as { shiftKey: boolean }).shiftKey = true }, TypeError)
})

test('a highlighted menu row leaves the event untouched', () => {
  const dom = fakeComposer(true)
  const press = dom.press(dom.target)
  assert.equal(press.shiftKey, false)
  assert.equal(press.ownGetter, false)
  assert.equal(composerEnterStats.menu, 1)
  assert.equal(composerEnterStats.breaks, 0)
})

test('the menu is queried only for a plain Enter', () => {
  // A keystroke that cannot be rewritten must not pay for a DOM query, and the
  // query must not run before the key and modifier checks.
  const dom = fakeComposer(true)
  assert.equal(dom.press(dom.target, { key: 'a' }).menuQueries, 0)
  assert.equal(dom.press(dom.target, { shiftKey: true }).menuQueries, 0)
  assert.equal(dom.press(dom.target, { isComposing: true }).menuQueries, 0)
  assert.equal(dom.press(dom.target).menuQueries, 1)
})

test('the composition window is the host window, one tick past compositionend', () => {
  const dom = fakeComposer(false)
  dom.compose('start', dom.target)
  assert.equal(dom.press(dom.target).shiftKey, false)
  assert.equal(composerEnterStats.ime, 1)
  dom.compose('end', dom.target)
  dom.advance(COMPOSING_GRACE_MS - 1)
  assert.equal(dom.press(dom.target).shiftKey, false)
  dom.advance(1)
  // Exactly COMPOSING_GRACE_MS after compositionend the host no longer treats
  // the Enter as a composition key, so the rewrite applies.
  assert.equal(dom.press(dom.target).shiftKey, true)
  assert.equal(composerEnterStats.breaks, 1)
  assert.equal(composerEnterStats.ime, 2)
})

test('a composition outside the composer never sets the watch', () => {
  // The command popup's search field composes too. A document-wide watch would
  // take it as the composer's, and an undelivered end would then decline every
  // later Enter while the host sends.
  const dom = fakeComposer(false)
  dom.compose('start', outsideTarget())
  assert.equal(dom.press(dom.target).shiftKey, true)
  assert.equal(composerEnterStats.ime, 0)
})

test('a replaced composer input starts a fresh watch', () => {
  // The host resets its composition state on every editor root swap, so a
  // composition whose end was never delivered must not outlive its input.
  const dom = fakeComposer(false)
  dom.compose('start', dom.target)
  assert.equal(dom.press(dom.target).shiftKey, false)
  const next = dom.nextInput()
  assert.equal(dom.press(next.target).shiftKey, true)
  assert.equal(composerEnterStats.breaks, 1)
})

test('a keydown outside the composer input is ignored', () => {
  const dom = fakeComposer(false)
  dom.press(outsideTarget())
  assert.equal(composerEnterStats.seen, 0)
  assert.equal(composerEnterStats.breaks, 0)
})

test('the counters describe the current arm only', () => {
  const dom = fakeComposer(false)
  dom.press(dom.target)
  assert.equal(composerEnterStats.breaks, 1)
  resetComposerEnterStats(true)
  assert.deepEqual(
    { ...composerEnterStats },
    { armed: true, seen: 0, breaks: 0, menu: 0, ime: 0 },
  )
  resetComposerEnterStats(false)
  assert.equal(composerEnterStats.armed, false)
})

test('the effect registers and removes capture-phase keydown and composition listeners', () => {
  // Document registration is the one part the fake DOM cannot exercise.
  for (const [type, listener] of [
    ['keydown', 'onKeyDown'],
    ['compositionstart', 'onCompositionStart'],
    ['compositionend', 'onCompositionEnd'],
  ]) {
    assert.match(SOURCE, new RegExp(`document\\.addEventListener\\('${type}', handler\\.${listener}, true\\)`), type)
    assert.match(SOURCE, new RegExp(`document\\.removeEventListener\\('${type}', handler\\.${listener}, true\\)`), type)
  }
  // Counters are per arm: both the install and the teardown reset them.
  assert.match(SOURCE, /resetComposerEnterStats\(true\)/)
  assert.match(SOURCE, /resetComposerEnterStats\(false\)/)
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
