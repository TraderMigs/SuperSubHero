// The arithmetic behind the player, kept out of the component so it can be checked.
//
// All three of these were wrong at some point precisely because they were buried in JSX where
// nothing could get at them: the clock, whether full screen really happened, and where the
// subtitles sit.

// mm:ss, and h:mm:ss once a film runs past the hour.
export function clockTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds % 60)
  const m = Math.floor(seconds / 60) % 60
  const h = Math.floor(seconds / 3600)
  const pad = n => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

// Did full screen actually fill the display?
//
// Chrome can answer yes to requestFullscreen and apply its fullscreen styles while the window
// stays where it is, leaving the element the size of the page rather than the display. Nothing
// in the API reports the difference, so the only way to know is to measure what arrived.
//
// One reading of that state: outer height 1192 against a screen height of 1235, element sized
// to the page area at 2430x1333. Docked DevTools was blamed for it here and that was wrong,
// disproved by a screenshot of YouTube filling the same display with DevTools docked in the
// same window. The cause is still unidentified. This function reports the measurement and
// deliberately names no cause.
//
// The allowance matters more than the idea. A genuinely full screen Chrome window on Windows
// does NOT report the screen's exact height, because Windows gives such a window an invisible
// resize border. Measured on Migs' two displays while the picture provably filled the screen:
//
//   screen 2195x1235  ->  window 2187x1226   9px short
//   screen 1920x1080  ->  window 1904x1064  16px short
//
// against a merely maximised window on the same machine:
//
//   screen 2195x1235  ->  window 2199x1192  43px short, the taskbar
//
// An earlier 8px allowance sat below both real readings, so it called every successful full
// screen a fake and put a warning on screen every time it worked. 2% of the screen height, with
// a 24px floor, sits in the gap between 16 and 43. It errs towards silence: someone who hides
// their taskbar has a maximised window nearly the size of the screen, and saying nothing then is
// better than accusing a full screen that is fine.
//
// outerHeight is also not always worth trusting: measured in a real Chrome tab that had not been
// brought to the front, outerWidth and outerHeight both read 0.
export function fullscreenIsReal({ outerHeight, screenHeight, tolerance } = {}) {
  if (!isFinite(outerHeight) || !isFinite(screenHeight)) return true
  if (outerHeight <= 0 || screenHeight <= 0) return true
  const allowance = isFinite(tolerance) ? tolerance : Math.max(24, screenHeight * 0.02)
  return outerHeight >= screenHeight - allowance
}

// How far above the bottom of the player the subtitles belong.
//
// A fixed offset puts them in the black band rather than on the picture, because how tall that
// band is depends on the shape of the film. Measured on a 2.35:1 film in a 16:9 frame: a 65px
// band with the overlay 24px up, which left the first line on the picture and the second one
// stranded below it. The band is arithmetic from the film's own dimensions, so this works out
// rather than guesses, for any film in any window.
//
// fill crops instead of shrinking, so there is no band to clear.
export function subtitleBottomPx({ stageWidth, stageHeight, videoWidth, videoHeight, fill = false, lift = 0 } = {}) {
  const usable = [stageWidth, stageHeight, videoWidth, videoHeight].every(n => isFinite(n) && n > 0)
  if (!usable) return 24 + lift
  const scale = fill
    ? Math.max(stageWidth / videoWidth, stageHeight / videoHeight)
    : Math.min(stageWidth / videoWidth, stageHeight / videoHeight)
  const pictureHeight = Math.min(stageHeight, videoHeight * scale)
  const band = Math.max(0, (stageHeight - pictureHeight) / 2)
  return Math.round(band + pictureHeight * 0.045) + lift
}
