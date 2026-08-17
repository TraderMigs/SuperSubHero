// Tests the real renderSubtitleOverlay against hostile subtitle text using a tiny fake DOM.
// The point: nothing from a subtitle file may ever become an element or an attribute.
import { renderSubtitleOverlay, overlayRenderKey, subtitleLineCss, fullscreenFontSize }
  from '../src/lib/subOverlay.js'

function makeEl(tag, doc) {
  return {
    tagName: tag.toUpperCase(), children: [], _text: '', style: { cssText: '' }, ownerDocument: doc,
    get firstChild() { return this.children[0] || null },
    appendChild(c) { this.children.push(c); return c },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c },
    set textContent(v) { this._text = String(v); this.children = [] },
    get textContent() { return this.children.length ? this.children.map(c => c.textContent).join('') : this._text },
    // If production code ever used innerHTML again, this records it as a failure.
    set innerHTML(v) { throw new Error('innerHTML was assigned: ' + String(v).slice(0, 60)) },
  }
}
const doc = { createElement: tag => makeEl(tag, doc) }
const newOverlay = () => makeEl('div', doc)

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name} ${detail}`) } }

console.log('\n-- hostile subtitle payloads --')
const payloads = [
  ['unterminated img tag (what parseSrt cannot strip)', '<img src=x onerror=alert(1)'],
  ['closed img tag', '<img src=x onerror="alert(1)">'],
  ['script tag', '<script>alert(1)</script>'],
  ['svg onload', '<svg/onload=alert(1)>'],
  ['attribute break-out against the old style="" sink', '"><img src=x onerror=alert(1)><span style="'],
  ['iframe javascript url', '<iframe src="javascript:alert(1)">'],
  ['entity-encoded script', '&lt;script&gt;alert(1)&lt;/script&gt;'],
]
for (const [label, payload] of payloads) {
  const ov = newOverlay()
  renderSubtitleOverlay(ov, { primary: payload })
  const tags = ov.children.map(c => c.tagName)
  const onlyDivs = tags.every(t => t === 'DIV')
  const textIsLiteral = ov.children.map(c => c.textContent).join('') === payload
  const noAttrsInjected = ov.children.every(c => !/onerror|onload|javascript:/i.test(c.style.cssText))
  check(`${label}: only div elements created`, onlyDivs, `got ${tags.join(',')}`)
  check(`${label}: payload kept as literal text`, textIsLiteral, `got ${JSON.stringify(ov.children.map(c => c.textContent))}`)
  check(`${label}: nothing leaked into the style attribute`, noAttrsInjected, ov.children[0]?.style.cssText)
}

console.log('\n-- normal rendering still correct --')
let ov = newOverlay()
let n = renderSubtitleOverlay(ov, { primary: 'first line\nsecond line', secondary: 'บรรทัดไทย' })
check('one div per line across both tracks', n === 3 && ov.children.length === 3, `got ${n}`)
check('primary lines are white', ov.children[0].style.cssText.includes('color:#fff'), ov.children[0].style.cssText)
check('secondary line is yellow', ov.children[2].style.cssText.includes('color:#ffe066'), ov.children[2].style.cssText)
check('thai text intact', ov.children[2].textContent === 'บรรทัดไทย', ov.children[2].textContent)
check('blank lines skipped', renderSubtitleOverlay(newOverlay(), { primary: 'a\n\n   \nb' }) === 2)
check('empty input renders nothing', renderSubtitleOverlay(newOverlay(), { primary: '', secondary: '' }) === 0)

console.log('\n-- previous children are cleared, not appended to --')
ov = newOverlay()
renderSubtitleOverlay(ov, { primary: 'old line' })
renderSubtitleOverlay(ov, { primary: 'new line' })
check('only the current line remains', ov.children.length === 1 && ov.children[0].textContent === 'new line', `${ov.children.length} children`)

console.log('\n-- styling matches the old inline styles --')
check('inline font-size 18px', subtitleLineCss({}).includes('font-size:18px'))
check('inline background 0.82', subtitleLineCss({}).includes('rgba(0,0,0,0.82)'))
check('fullscreen background 0.85', subtitleLineCss({ fullscreen: true, viewportHeight: 1080 }).includes('rgba(0,0,0,0.85)'))
check('fullscreen font scales with height (1080 -> 43.2px)', fullscreenFontSize(1080) === '43.2px', fullscreenFontSize(1080))
check('fullscreen font has a floor of 22px (300 -> 22px)', fullscreenFontSize(300) === '22px', fullscreenFontSize(300))

console.log('\n-- render key avoids rebuilding every frame --')
const a = { primary: 'x', secondary: 'y', fullscreen: false, viewportHeight: 900 }
check('same content -> same key', overlayRenderKey(a) === overlayRenderKey({ ...a }))
check('changed text -> new key', overlayRenderKey(a) !== overlayRenderKey({ ...a, primary: 'z' }))
check('entering fullscreen -> new key', overlayRenderKey(a) !== overlayRenderKey({ ...a, fullscreen: true }))
check('window resize in fullscreen -> new key', overlayRenderKey({ ...a, fullscreen: true }) !== overlayRenderKey({ ...a, fullscreen: true, viewportHeight: 600 }))
check('window resize inline -> same key (font is fixed)', overlayRenderKey(a) === overlayRenderKey({ ...a, viewportHeight: 600 }))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
