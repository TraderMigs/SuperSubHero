// Covers the arithmetic behind the player.
//
// Each of these got something wrong in the real app before it was pulled out here: the clock,
// the check for whether full screen actually happened, and where the subtitles sit.
import { clockTime, fullscreenIsReal, subtitleBottomPx } from '../src/lib/player.js'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name} ${detail}`) } }

console.log('\n-- the clock --')
check('zero', clockTime(0) === '0:00', clockTime(0))
check('seconds are padded', clockTime(7) === '0:07', clockTime(7))
check('a minute', clockTime(60) === '1:00', clockTime(60))
check('minutes are not padded below the hour', clockTime(571) === '9:31', clockTime(571))
check('the hour brings a third field', clockTime(3600) === '1:00:00', clockTime(3600))
check("Migs' film length", clockTime(6592) === '1:49:52', clockTime(6592))
check('a fraction rounds down, so it never shows a second early', clockTime(59.9) === '0:59', clockTime(59.9))
check('a fresh video reporting NaN does not print NaN', clockTime(NaN) === '0:00', clockTime(NaN))
check('a stream reporting Infinity does not print Infinity', clockTime(Infinity) === '0:00', clockTime(Infinity))
check('a negative does not print a negative', clockTime(-5) === '0:00', clockTime(-5))
check('undefined is safe', clockTime(undefined) === '0:00', clockTime(undefined))

console.log('\n-- was that really full screen --')
// The real measurement from Migs' browser: the element reported itself fullscreen at 2430x1333
// while the window was still 1192 tall on a 1235 screen, because DevTools was docked.
check("Migs' docked-DevTools case is caught", fullscreenIsReal({ outerHeight: 1192, screenHeight: 1235 }) === false)
check('a window filling the screen passes', fullscreenIsReal({ outerHeight: 1235, screenHeight: 1235 }) === true)
check('a few pixels of rounding is not called a fake', fullscreenIsReal({ outerHeight: 1230, screenHeight: 1235 }) === true)
check('nine pixels short is called out', fullscreenIsReal({ outerHeight: 1226, screenHeight: 1235 }) === false)
check('a taskbar-height shortfall is called out', fullscreenIsReal({ outerHeight: 1032, screenHeight: 1080 }) === false)
check('a window taller than the screen is fine', fullscreenIsReal({ outerHeight: 1080, screenHeight: 1032 }) === true)
check('missing numbers never cry wolf', fullscreenIsReal({}) === true)
check('a zero screen height never cries wolf', fullscreenIsReal({ outerHeight: 0, screenHeight: 0 }) === true)
// Measured in a real Chrome tab that had not been fronted: outerWidth and outerHeight both 0.
check('a window reporting zero height is not accused', fullscreenIsReal({ outerHeight: 0, screenHeight: 1235 }) === true)
check('a negative height is not accused either', fullscreenIsReal({ outerHeight: -1, screenHeight: 1235 }) === true)

console.log('\n-- where the subtitles sit --')
// The case that was wrong on screen: a 940x400 film in a 952x535.5 frame, a 65px black band,
// with the overlay pinned 24px up, so the second line landed below the picture.
let bottom = subtitleBottomPx({ stageWidth: 952, stageHeight: 535.5, videoWidth: 940, videoHeight: 400 })
check('the offset clears the measured 65px band', bottom > 65, String(bottom))
check('and is not thrown to the top of the picture', bottom < 535.5 * 0.25, String(bottom))
check('it matches what the browser produced', bottom === 83, String(bottom))

// A scope film on a 16:9 screen in full screen: 131px of black top and bottom at 1080p.
bottom = subtitleBottomPx({ stageWidth: 1920, stageHeight: 1080, videoWidth: 2350, videoHeight: 1000 })
check('full screen clears its own band too', bottom > 131, String(bottom))

// A 16:9 film has no band at all, so the offset is purely a margin.
bottom = subtitleBottomPx({ stageWidth: 1920, stageHeight: 1080, videoWidth: 1920, videoHeight: 1080 })
check('a 16:9 film gets a plain margin', bottom === Math.round(1080 * 0.045), String(bottom))

// Cropping removes the band, so the subtitles come back down with the picture.
const fit = subtitleBottomPx({ stageWidth: 952, stageHeight: 535.5, videoWidth: 940, videoHeight: 400 })
const fill = subtitleBottomPx({ stageWidth: 952, stageHeight: 535.5, videoWidth: 940, videoHeight: 400, fill: true })
check('filling drops the offset', fill < fit, `${fill} vs ${fit}`)
check('and leaves no band to clear', fill === Math.round(535.5 * 0.045), String(fill))

// Taller than the frame rather than wider, which happens with phone footage.
bottom = subtitleBottomPx({ stageWidth: 1000, stageHeight: 562, videoWidth: 1080, videoHeight: 1920 })
check('pillarboxed footage gets no vertical band', bottom === Math.round(562 * 0.045), String(bottom))

console.log('\n-- before the video reports its size --')
check('no dimensions yet falls back', subtitleBottomPx({ stageWidth: 952, stageHeight: 535, videoWidth: 0, videoHeight: 0 }) === 24)
check('nothing at all falls back', subtitleBottomPx({}) === 24)
check('the fallback still takes the lift', subtitleBottomPx({ lift: 96 }) === 120)

console.log('\n-- lifting clear of the control band in full screen --')
const rest = subtitleBottomPx({ stageWidth: 1920, stageHeight: 1080, videoWidth: 2350, videoHeight: 1000 })
const lifted = subtitleBottomPx({ stageWidth: 1920, stageHeight: 1080, videoWidth: 2350, videoHeight: 1000, lift: 96 })
check('the lift is added on top', lifted === rest + 96, `${lifted} vs ${rest}`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
