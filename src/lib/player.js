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
// Chrome answers yes to requestFullscreen and applies its fullscreen styles even when it keeps
// the element inside the page, which is what happens whenever something else shares the window.
// Docked DevTools is the everyday cause. Nothing in the API reports the difference.
//
// The tell is the window. A window that really went full screen is exactly as tall as the
// screen. Migs' case measured an outer height of 1192 against a screen height of 1235: still a
// taskbar short, with the element sized to the page area at 2430x1333 rather than the display.
//
// The 8px allowance is for the odd rounding between device pixels and CSS pixels on a scaled
// display, so a genuine full screen is never called a fake one.
//
// outerHeight is not always a number worth trusting: measured in a real Chrome tab that had not
// been brought to the front, window.outerWidth and window.outerHeight both read 0. Treating that
// as "the window is zero pixels tall" would accuse every such case of faking it, so anything at
// or below zero means we do not know, and saying nothing beats crying wolf.
export function fullscreenIsReal({ outerHeight, screenHeight, tolerance = 8 } = {}) {
  if (!isFinite(outerHeight) || !isFinite(screenHeight)) return true
  if (outerHeight <= 0 || screenHeight <= 0) return true
  return outerHeight >= screenHeight - tolerance
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
