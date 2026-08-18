import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { LANGUAGES, SEARCH_LANGUAGES } from '../lib/languages.js'
import { parseSrt, buildSrt, mergeSrts, mergeSrtsDetailed, downloadFile, applyOffset, retimeBlocks } from '../lib/srt.js'
import { renderSubtitleOverlay, overlayRenderKey, fullscreenPaddingBottom } from '../lib/subOverlay.js'
import { analyzeAlignment, describeAlignment, isIdentityTransform } from '../lib/align.js'
import { parseRelease, compareReleases, MATCH_COLORS } from '../lib/release.js'
import { verifyLanguage } from '../lib/language.js'
import { loadSession, saveSession, clearSession, restored } from '../lib/session.js'

// Shown in the Preview box only until real subtitle lines are loaded.
const PREVIEW_SAMPLE = 'May the Force be with you.'

// Trim a subtitle line to something that fits the small preview box.
function previewText(value, fallback = '') {
  const line = String(value || '').split('\n').find(l => l.trim()) || ''
  if (!line) return fallback
  return line.length > 60 ? line.slice(0, 57).trimEnd() + '...' : line
}

const PROVIDER_ABBR = { opensubtitles: 'OS', subsource: 'SS', subdl: 'SDL' }
const RELEASES_SHOWN = 12

// One release row, shared by both language panels so they cannot drift apart.
// The badge compares this release against whatever is selected on the other side, which is what
// tells you up front whether the two files will line up.
function ReleaseRow({ sub, selected, comparedToName, onClick }) {
  const info = React.useMemo(() => parseRelease(sub.name), [sub.name])
  const match = React.useMemo(
    () => (comparedToName ? compareReleases(comparedToName, info) : null),
    [comparedToName, info]
  )
  const showBadge = match && match.level !== 'unsure'
  const color = showBadge ? MATCH_COLORS[match.level] : null

  return (
    <div
      className={`sub-result-item ${selected ? 'selected' : ''}`}
      onClick={onClick}
      style={{ position: 'relative' }}
    >
      {showBadge && (
        <div
          title={match.reason}
          style={{
            position: 'absolute', top: 6, right: 6, fontSize: 9, fontWeight: 700,
            letterSpacing: '0.04em', textTransform: 'uppercase', padding: '2px 6px',
            borderRadius: 4, color: color.fg, background: color.bg, whiteSpace: 'nowrap',
          }}
        >
          {match.label}
        </div>
      )}
      <div className="sub-result-name" title={sub.name} style={{ paddingRight: showBadge ? 60 : 0 }}>
        {sub.name}
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>
        {sub.episode > 0 && <div className="sub-result-meta">E{sub.episode}</div>}
        {sub.full_season && <div className="sub-result-meta" style={{ color: 'var(--muted)' }}>Full season</div>}
        {info.chips.length > 0
          ? info.chips.map(chip => <div key={chip} className="sub-result-meta">{chip}</div>)
          : <div className="sub-result-meta" style={{ opacity: 0.6 }}>Unknown source</div>}
        <div className="sub-result-meta" style={{ opacity: 0.6, fontSize: 10, textTransform: 'uppercase' }}>
          {PROVIDER_ABBR[sub.source] || sub.source}
        </div>
      </div>
    </div>
  )
}

// Find existing subtitles, or translate from the other panel.
//
// Translation used to be reachable only after a search came back empty, and the dropdowns only
// listed the 37 languages subtitle sites actually carry, while the translator handles 103. So a
// language could be impossible to reach in search mode purely because files for it existed.
function ModeToggle({ mode, onChange, otherLabel }) {
  return (
    <div className="type-toggle" style={{ marginBottom: 8 }}>
      <button className={`type-btn ${mode === 'find' ? 'active' : ''}`} onClick={() => onChange('find')}>
        Find file
      </button>
      <button
        className={`type-btn ${mode === 'translate' ? 'active' : ''}`}
        onClick={() => onChange('translate')}
        title={`Translate the ${otherLabel} track with AI instead of downloading a file`}
      >
        ✨ Translate
      </button>
    </div>
  )
}

// Wrong-language warning, shown wherever the choice is being made.
function LanguageWarning({ message }) {
  if (!message) return null
  return (
    <div
      style={{
        marginTop: 8, padding: '8px 10px', borderRadius: 8, fontSize: 11, lineHeight: 1.5,
        border: '1px solid var(--error)', background: 'rgba(241,53,74,0.1)', color: 'var(--error)',
      }}
    >
      <div style={{ fontWeight: 600 }}>Wrong language</div>
      <div style={{ marginTop: 2 }}>{message}</div>
      <div style={{ marginTop: 2 }}>Pick a different release below.</div>
    </div>
  )
}

// The release list, which folds away once a release is chosen.
//
// It runs to twelve tall rows per language and had no way to close, so choosing a release left
// the controls column enormous and the rest of the page pushed far below the fold.
function ReleasePicker({ releases, selected, comparedToName, onPick, langLabel, warning }) {
  const [open, setOpen] = React.useState(true)
  const wasSelected = React.useRef(false)

  // Fold up the moment a release is picked, and open again if the list itself changes.
  React.useEffect(() => {
    if (selected && !wasSelected.current) { setOpen(false); wasSelected.current = true }
    if (!selected) wasSelected.current = false
  }, [selected])
  React.useEffect(() => { setOpen(!selected) }, [releases])

  if (!releases.length) return null

  return (
    <div>
      <div
        className="ctrl-label"
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', gap: 8 }}
      >
        <span>{selected ? `${langLabel} release` : 'Pick a release'}</span>
        <span style={{ color: 'var(--accent2)', textTransform: 'none', letterSpacing: 0 }}>
          {open ? '▲ Hide' : `▼ Change (${releases.length})`}
        </span>
      </div>

      {!open && selected && (
        <ReleaseRow sub={selected} selected comparedToName={comparedToName} onClick={() => setOpen(true)} />
      )}

      <LanguageWarning message={warning} />

      {open && releases.map((s, i) => (
        <ReleaseRow
          key={s.id || i}
          sub={s}
          selected={selected?.id === s.id}
          comparedToName={comparedToName}
          onClick={() => onPick(s)}
        />
      ))}
    </div>
  )
}

const TRANSLATE_CHUNK_SIZE = 80
const TRANSLATE_CONCURRENCY = 6
const TRANSLATE_HINT = 'A full movie takes about 1-2 minutes.'

async function translateOneChunk(chunk, prevChunk, targetLang, title) {
  const resp = await fetch('/api/translate-srt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      srtContent: buildSrt(chunk),
      targetLanguage: targetLang,
      // The last few lines before this chunk, so tone and names stay consistent across chunks.
      contextBefore: prevChunk ? prevChunk.slice(-4).map(b => b.text).join('\n') : '',
      title: title || '',
    }),
  })
  let data
  try {
    data = await resp.json()
  } catch {
    throw new Error(`The translation service gave an unreadable reply (HTTP ${resp.status})`)
  }
  if (!resp.ok || data.error) throw new Error(data.error || `Translation failed (HTTP ${resp.status})`)
  const parsed = parseSrt(data.content)
  return {
    blocks: chunk.map((orig, i) => ({ ...orig, text: parsed[i]?.text || orig.text })),
    missingCount: Number(data.missingCount) || 0,
  }
}

// Translate all blocks in chunks, a few at a time. A chunk that fails twice keeps its
// original text and is counted as missing, so one bad request cannot throw the whole
// job away. Returns the assembled blocks plus what could not be translated.
async function translateBlocksInChunks(allBlocks, targetLang, { title = '', onProgress } = {}) {
  const chunks = []
  for (let i = 0; i < allBlocks.length; i += TRANSLATE_CHUNK_SIZE) chunks.push(allBlocks.slice(i, i + TRANSLATE_CHUNK_SIZE))
  const results = new Array(chunks.length)
  let done = 0, missingCount = 0, failedChunks = 0, lastError = null, next = 0
  const report = () => onProgress && onProgress(`Translated ${done} of ${chunks.length} parts`)
  report()

  const worker = async () => {
    while (next < chunks.length) {
      const idx = next++
      const chunk = chunks[idx]
      const prev = idx > 0 ? chunks[idx - 1] : null
      let result = null
      for (let attempt = 0; attempt < 2 && !result; attempt++) {
        try {
          result = await translateOneChunk(chunk, prev, targetLang, title)
        } catch (e) {
          lastError = e
        }
      }
      if (result) {
        results[idx] = result.blocks
        missingCount += result.missingCount
      } else {
        results[idx] = chunk.map(b => ({ ...b }))
        missingCount += chunk.length
        failedChunks++
      }
      done++
      report()
    }
  }
  await Promise.all(Array.from({ length: Math.min(TRANSLATE_CONCURRENCY, chunks.length) }, worker))

  if (chunks.length && failedChunks === chunks.length) {
    throw new Error(lastError?.message || 'Translation failed')
  }
  return { blocks: results.flat(), missingCount, failedChunks, total: allBlocks.length }
}

function missingNote(missingCount, total) {
  if (!missingCount) return ''
  return ` · ${missingCount.toLocaleString()} of ${total.toLocaleString()} lines could not be translated and were kept as they were`
}

function CollapsiblePanel({ title, langLabel, blocks, loading, translating, error, onBlockChange, emptyIcon, emptyText, emptySubText, translateSource, progress, warning }) {
  const [open, setOpen] = useState(false)
  const hasContent = blocks.length > 0
  const isActive = loading || translating

  return (
    <div className="panel">
      <div
        className={`panel-header ${hasContent ? 'panel-header-clickable' : ''}`}
        onClick={() => hasContent && setOpen(o => !o)}
        style={{ cursor: hasContent ? 'pointer' : 'default' }}
      >
        <div className="panel-header-left">
          <div className="panel-title">{title}</div>
          {hasContent && <div className="panel-lang">{langLabel} · {blocks.length} lines</div>}
          {hasContent && translateSource && <div className="panel-lang" style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>{translateSource}</div>}
          {isActive && <div className="panel-lang" style={{ color: 'var(--accent2)' }}>{translating ? 'Translating...' : 'Loading...'}</div>}
        </div>
        {hasContent && (
          <div className="panel-chevron">{open ? '▲ Collapse' : '▼ View Subtitles'}</div>
        )}
      </div>

      {!hasContent && !isActive && (
        <div className="panel-empty">
          <div className="panel-empty-icon">{emptyIcon}</div>
          <div>{emptyText}</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>{emptySubText}</div>
        </div>
      )}
      {isActive && (
        <div className="panel-empty">
          <div className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
          <div>{translating ? `Translating to ${langLabel}...` : 'Loading subtitle...'}</div>
          {translating && progress && <div style={{ fontSize: 12, color: 'var(--accent2)', marginTop: 4 }}>{progress}</div>}
          {translating && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{TRANSLATE_HINT}</div>}
        </div>
      )}
      {error && error !== 'not_found' && !hasContent && (
        <div className="status-bar error" style={{ margin: '0 16px 16px' }}>{error}</div>
      )}

      {/* Repeated here as well as in the controls: this panel is where the text is actually
          read, and reading it is the moment you would otherwise notice nothing is wrong. */}
      {warning && (
        <div style={{ margin: '0 16px 16px' }}>
          <div style={{ padding: '8px 10px', borderRadius: 8, fontSize: 11, lineHeight: 1.5, border: '1px solid var(--error)', background: 'rgba(241,53,74,0.1)', color: 'var(--error)' }}>
            <div style={{ fontWeight: 600 }}>Wrong language</div>
            <div style={{ marginTop: 2 }}>{warning}</div>
          </div>
        </div>
      )}

      {hasContent && open && (
        <div className="panel-body">
          {blocks.map((block, idx) => (
            <div key={idx} className="sub-line">
              <div className="sub-time">{block.start?.slice(0, 8)}</div>
              <textarea
                className="sub-text"
                value={block.text}
                onChange={e => onBlockChange(idx, e.target.value)}
                rows={block.text.split('\n').length}
              />
            </div>
          ))}
        </div>
      )}

    </div>
  )
}

function SrtDropZone({ onFile, fileName, blocks, onReset: resetFn, label }) {
  const [dragging, setDragging] = React.useState(false)
  if (blocks.length > 0) {
    return (
      <div className="upload-file-loaded">
        <span style={{ fontSize: 18 }}>📄</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{blocks.length} lines loaded</div>
        </div>
        <button className="upload-reset-btn" onClick={resetFn}>✕</button>
      </div>
    )
  }
  return (
    <div
      className={`upload-dropzone ${dragging ? 'dragging' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
      onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.srt,.ass,.vtt'; inp.onchange = e => { if (e.target.files[0]) onFile(e.target.files[0]) }; inp.click() }}
    >
      <div style={{ fontSize: 28, marginBottom: 6 }}>⬆</div>
      <div style={{ fontWeight: 500 }}>{label || 'Drop your SRT file here'}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>or click to browse · .srt .ass .vtt</div>
    </div>
  )
}

function SubPanel({ blocks, label, translating, translateSource, error, onBlockChange, progress }) {
  const [elapsed, setElapsed] = React.useState(0)
  React.useEffect(() => {
    if (!translating) { setElapsed(0); return }
    const t = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [translating])

  const fmt = s => s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`

  if (translating) return (
    <div className="upload-sub-panel">
      <div className="panel-empty" style={{ padding: '1.5rem' }}>
        <div className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
        <div style={{ fontWeight: 500, marginTop: 8 }}>Translating with AI...</div>
        <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 6, fontFamily: 'monospace' }}>⏱ {fmt(elapsed)}</div>
        {progress && <div style={{ fontSize: 12, color: 'var(--accent2)', marginTop: 4 }}>{progress}</div>}
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{TRANSLATE_HINT}</div>
      </div>
    </div>
  )
  if (!blocks.length) return null
  return (
    <div className="upload-sub-panel">
      <div className="upload-sub-header">
        <div>
          <span style={{ fontWeight: 500 }}>{label}</span>
          <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>{blocks.length} lines</span>
          {translateSource && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{translateSource}</div>}
        </div>
      </div>
      {error && <div className="status-bar error" style={{ margin: '0 16px 12px' }}>{error}</div>}
      <div className="panel-body sub-panel-scroll">
        {blocks.map((b, i) => (
          <div key={i} className="sub-line">
            <div className="sub-time">{b.start?.slice(0, 8)}</div>
            <textarea
              className="sub-text"
              value={b.text}
              onChange={e => onBlockChange && onBlockChange(i, e.target.value)}
              rows={b.text.split('\n').length}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function UploadTranslateSection({
  uploadedBlocks, uploadedBlocks2, uploadFileName, uploadFileName2,
  uploadTargetLang, setUploadTargetLang, uploadTargetLang2, setUploadTargetLang2,
  uploadTranslating, uploadTranslating2,
  uploadTranslatedBlocks, uploadTranslatedBlocks2,
  uploadError, uploadError2,
  uploadOffsetMs, setUploadOffsetMs,
  uploadOffsetMs2, setUploadOffsetMs2,
  uploadTranslateSource, uploadTranslateSource2,
  uploadProgress, uploadProgress2,
  onUpload, onUpload2, onTranslate, onTranslate2,
  onDownloadOriginal, onDownloadTranslated, onDownloadMerged,
  onDownloadOriginal2, onDownloadTranslated2, onDownloadMerged2,
  onReset, onReset2,
  onUpdateBlock, onUpdateTranslated, onUpdateBlock2, onUpdateTranslated2,
}) {
  const targetLangLabel = lang => LANGUAGES.find(l => l.code === lang)?.label || lang

  return (
    <div className="upload-wrap">
      <div className="hero" style={{ paddingBottom: '1.5rem' }}>
        <h1>Upload & Translate<br /><em>Any Subtitle File</em></h1>
        <p>Upload an SRT, pick any of 100+ languages, get an AI translation synced and ready to download.</p>
      </div>

      <div className="upload-grid">
        {/* SLOT 1 */}
        <div className="upload-card">
          <div className="upload-card-title">Subtitle 1</div>
          <SrtDropZone onFile={onUpload} fileName={uploadFileName} blocks={uploadedBlocks} onReset={onReset} />

          {uploadedBlocks.length > 0 && (
            <>
              <SubPanel blocks={uploadedBlocks} label="Original" translateSource="" error="" onBlockChange={onUpdateBlock} />

              <div className="ctrl-label" style={{ marginTop: 16 }}>Translate to</div>
              <select
                className="lang-select"
                value={uploadTargetLang}
                onChange={e => setUploadTargetLang(e.target.value)}
              >
                {LANGUAGES.filter(l => l.code !== 'EN').map(l => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>

              <button
                className="fetch-btn ai-btn"
                style={{ marginTop: 8 }}
                onClick={onTranslate}
                disabled={uploadTranslating}
              >
                {uploadTranslating ? 'Translating...' : `✨ Translate to ${targetLangLabel(uploadTargetLang)}`}
              </button>

              {uploadError && <div className="status-bar error" style={{ marginTop: 8 }}>{uploadError}</div>}

              <SubPanel
                blocks={uploadTranslatedBlocks}
                label={targetLangLabel(uploadTargetLang)}
                translating={uploadTranslating}
                translateSource={uploadTranslateSource}
                error={uploadError}
                onBlockChange={onUpdateTranslated}
                progress={uploadProgress}
              />

              <div className="ctrl-label" style={{ marginTop: 16 }}>Sync Adjustment</div>
              <div className="sync-wrap">
                <input type="range" min="-300000" max="300000" step="100" value={uploadOffsetMs}
                  onChange={e => setUploadOffsetMs(Number(e.target.value))} className="sync-slider" />
                <div className="sync-display">
                  <button className="sync-reset" onClick={() => setUploadOffsetMs(0)}>↺</button>
                  <span className={`sync-value ${uploadOffsetMs > 0 ? 'delay' : uploadOffsetMs < 0 ? 'advance' : ''}`}>
                    {uploadOffsetMs === 0 ? 'No offset' : uploadOffsetMs > 0 ? `+${(uploadOffsetMs/1000).toFixed(1)}s` : `${(uploadOffsetMs/1000).toFixed(1)}s`}
                  </span>
                </div>
              </div>

              {uploadTranslatedBlocks.length > 0 && (
                <>
                  <button className="dl-btn" style={{ marginTop: 8 }} onClick={onDownloadTranslated}>
                    ↓ Download {targetLangLabel(uploadTargetLang)} SRT
                  </button>
                  <button className="dl-btn secondary" style={{ marginTop: 6 }} onClick={onDownloadMerged}>
                    ↓ Download Merged Dual SRT ({targetLangLabel(uploadTargetLang)})
                  </button>
                </>
              )}
            </>
          )}
        </div>

        {/* SLOT 2 — only show after Slot 1 is loaded */}
        {uploadedBlocks.length > 0 && (
        <div className="upload-card">
          <div className="upload-card-title">Subtitle 2 <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></div>
          <SrtDropZone onFile={onUpload2} fileName={uploadFileName2} blocks={uploadedBlocks2} onReset={onReset2} label="Drop a second SRT file here" />

          {uploadedBlocks2.length > 0 && (
            <>
              <SubPanel blocks={uploadedBlocks2} label="Original" translateSource="" error="" onBlockChange={onUpdateBlock2} />

              <div className="ctrl-label" style={{ marginTop: 16 }}>Translate to</div>
              <select
                className="lang-select"
                value={uploadTargetLang2}
                onChange={e => setUploadTargetLang2(e.target.value)}
              >
                <option value="">— Select language —</option>
                {LANGUAGES.filter(l => l.code !== 'EN').map(l => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>

              <button
                className="fetch-btn ai-btn"
                style={{ marginTop: 8 }}
                onClick={onTranslate2}
                disabled={uploadTranslating2 || !uploadTargetLang2}
              >
                {uploadTranslating2 ? 'Translating...' : uploadTargetLang2 ? `✨ Translate to ${targetLangLabel(uploadTargetLang2)}` : '— Pick a language above —'}
              </button>

              {uploadError2 && <div className="status-bar error" style={{ marginTop: 8 }}>{uploadError2}</div>}

              <SubPanel
                blocks={uploadTranslatedBlocks2}
                label={targetLangLabel(uploadTargetLang2)}
                translating={uploadTranslating2}
                translateSource={uploadTranslateSource2}
                error={uploadError2}
                onBlockChange={onUpdateTranslated2}
                progress={uploadProgress2}
              />

              <div className="ctrl-label" style={{ marginTop: 16 }}>Sync Adjustment</div>
              <div className="sync-wrap">
                <input type="range" min="-300000" max="300000" step="100" value={uploadOffsetMs2}
                  onChange={e => setUploadOffsetMs2(Number(e.target.value))} className="sync-slider" />
                <div className="sync-display">
                  <button className="sync-reset" onClick={() => setUploadOffsetMs2(0)}>↺</button>
                  <span className={`sync-value ${uploadOffsetMs2 > 0 ? 'delay' : uploadOffsetMs2 < 0 ? 'advance' : ''}`}>
                    {uploadOffsetMs2 === 0 ? 'No offset' : uploadOffsetMs2 > 0 ? `+${(uploadOffsetMs2/1000).toFixed(1)}s` : `${(uploadOffsetMs2/1000).toFixed(1)}s`}
                  </span>
                </div>
              </div>

              {uploadTranslatedBlocks2.length > 0 && (
                <>
                  <button className="dl-btn" style={{ marginTop: 8 }} onClick={onDownloadTranslated2}>
                    ↓ Download {targetLangLabel(uploadTargetLang2)} SRT
                  </button>
                  <button className="dl-btn secondary" style={{ marginTop: 6 }} onClick={onDownloadMerged2}>
                    ↓ Download Merged Dual SRT ({targetLangLabel(uploadTargetLang2)})
                  </button>
                </>
              )}
            </>
          )}
        </div>
        )}
      </div>
    </div>
  )
}

export default function Home() {
  // Whatever was on screen before the last refresh. A reload used to discard the search, the
  // chosen title, both subtitle tracks and any AI translation, which costs money to redo.
  const saved = useRef(loadSession()).current
  // True only on the load right after a refresh, so the video note is not shown forever.
  const [restoredSession, setRestoredSession] = useState(() => Array.isArray(saved.blocksL1) && saved.blocksL1.length > 0)

  const [query, setQuery] = useState(() => restored(saved, 'query', ''))
  const [year, setYear] = useState(() => restored(saved, 'year', ''))
  const [contentType, setContentType] = useState(() => restored(saved, 'contentType', 'movie'))
  const [season, setSeason] = useState(() => restored(saved, 'season', ''))
  const [episode, setEpisode] = useState(() => restored(saved, 'episode', ''))

  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState(() => restored(saved, 'searchResults', []))
  const [selectedTitle, setSelectedTitle] = useState(() => saved.selectedTitle || null)

  const [lang1, setLang1] = useState(() => restored(saved, 'lang1', 'EN'))
  const [lang2, setLang2] = useState(() => restored(saved, 'lang2', ''))
  // Per panel: download a file, or translate the other panel's track.
  const [mode1, setMode1] = useState(() => restored(saved, 'mode1', 'find'))
  const [mode2, setMode2] = useState(() => restored(saved, 'mode2', 'find'))

  const [fetchingL1, setFetchingL1] = useState(false)
  const [fetchingL2, setFetchingL2] = useState(false)
  const [subResultsL1, setSubResultsL1] = useState(() => restored(saved, 'subResultsL1', []))
  const [subResultsL2, setSubResultsL2] = useState(() => restored(saved, 'subResultsL2', []))
  const [selectedSubL1, setSelectedSubL1] = useState(() => saved.selectedSubL1 || null)
  const [selectedSubL2, setSelectedSubL2] = useState(() => saved.selectedSubL2 || null)

  const [loadingL1, setLoadingL1] = useState(false)
  const [loadingL2, setLoadingL2] = useState(false)
  const [blocksL1, setBlocksL1] = useState(() => restored(saved, 'blocksL1', []))
  const [blocksL2, setBlocksL2] = useState(() => restored(saved, 'blocksL2', []))
  const [errorL1, setErrorL1] = useState('')
  const [errorL2, setErrorL2] = useState('')
  // Set when a downloaded file turns out not to be in the language it was filed under.
  const [langWarnL1, setLangWarnL1] = useState(() => restored(saved, 'langWarnL1', ''))
  const [langWarnL2, setLangWarnL2] = useState(() => restored(saved, 'langWarnL2', ''))

  const [translatingL1, setTranslatingL1] = useState(false)
  const [translatingL2, setTranslatingL2] = useState(false)
  const [autoTranslatingL1, setAutoTranslatingL1] = useState(false)
  const [autoTranslatingL2, setAutoTranslatingL2] = useState(false)
  const [translateSourceL1, setTranslateSourceL1] = useState(() => restored(saved, 'translateSourceL1', ''))
  const [translateSourceL2, setTranslateSourceL2] = useState(() => restored(saved, 'translateSourceL2', ''))
  const [translateProgressL1, setTranslateProgressL1] = useState('')
  const [translateProgressL2, setTranslateProgressL2] = useState('')

  // Upload & Translate mode
  const [pageMode, setPageMode] = useState(() => restored(saved, 'pageMode', 'search')) // 'search' | 'upload'
  const [uploadedBlocks, setUploadedBlocks] = useState([])
  const [uploadedBlocks2, setUploadedBlocks2] = useState([])
  const [uploadFileName, setUploadFileName] = useState('')
  const [uploadFileName2, setUploadFileName2] = useState('')
  const [uploadTargetLang, setUploadTargetLang] = useState('TH')
  const [uploadTargetLang2, setUploadTargetLang2] = useState('')
  const [uploadTranslating, setUploadTranslating] = useState(false)
  const [uploadTranslating2, setUploadTranslating2] = useState(false)
  const [uploadTranslatedBlocks, setUploadTranslatedBlocks] = useState([])
  const [uploadTranslatedBlocks2, setUploadTranslatedBlocks2] = useState([])
  const [uploadError, setUploadError] = useState('')
  const [uploadError2, setUploadError2] = useState('')
  const [uploadOffsetMs, setUploadOffsetMs] = useState(0)
  const [uploadOffsetMs2, setUploadOffsetMs2] = useState(0)
  const [uploadProgress, setUploadProgress] = useState('')
  const [uploadProgress2, setUploadProgress2] = useState('')
  const [uploadTranslateSource, setUploadTranslateSource] = useState('')
  const [uploadTranslateSource2, setUploadTranslateSource2] = useState('')

  const [offsetMs, setOffsetMs] = useState(() => restored(saved, 'offsetMs', 0))
  // Extra nudge for the second track only. The single shared offset could never fix a second
  // language that was out of step, because it moved both tracks by the same amount.
  const [secondaryOffsetMs, setSecondaryOffsetMs] = useState(() => restored(saved, 'secondaryOffsetMs', 0))
  const [autoAlign, setAutoAlign] = useState(() => restored(saved, 'autoAlign', true))
  const [alignment, setAlignment] = useState(null)
  const [aligning, setAligning] = useState(false)

  const [videoFile, setVideoFile] = useState(null)
  const [videoUrl, setVideoUrl] = useState(null)
  const [videoDragging, setVideoDragging] = useState(false)
  const [videoSpeed, setVideoSpeed] = useState(1)
  const [currentSubText, setCurrentSubText] = useState('')
  const [currentSubText2, setCurrentSubText2] = useState('')
  const [currentLineIndex, setCurrentLineIndex] = useState(-1)
  const [currentLineIndex2, setCurrentLineIndex2] = useState(-1)
  const videoRef = useRef(null)
  const containerRef = useRef(null)
  const animFrameRef = useRef(null)
  const fsOverlayRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const hideControlsTimer = useRef(null)
  // Live refs — updated every render, read inside rAF without stale closures
  const offsetMsRef = useRef(0)
  const blocksL1Ref = useRef([])
  const blocksL2Ref = useRef([])


  const handleSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    setSearchResults([])
    setSelectedTitle(null)
    setBlocksL1([])
    setBlocksL2([])
    setSubResultsL1([])
    setSubResultsL2([])
    setSelectedSubL1(null)
    setSelectedSubL2(null)

    try {
      const params = new URLSearchParams({ query: query.trim(), type: contentType })
      if (year.trim()) params.append('year', year.trim())
      if (contentType === 'tv' && season) params.append('season', season)
      if (contentType === 'tv' && episode) params.append('episode', episode)
      const resp = await fetch(`/api/search?${params}`)
      const data = await resp.json()
      setSearchResults(data.results || [])
    } catch (err) {
      console.error(err)
    } finally {
      setSearching(false)
    }
  }

  const handleSelectTitle = (title) => {
    setSelectedTitle(title)
    setSearchResults([])
    setBlocksL1([])
    setBlocksL2([])
    setSubResultsL1([])
    setSubResultsL2([])
    setSelectedSubL1(null)
    setSelectedSubL2(null)
    setErrorL1('')
    setErrorL2('')
  }

  // Every identifier we have goes to the server: SubDL wants sd_id, OpenSubtitles wants
  // imdb/tmdb, SubSource wants imdb or the title. Sending only one starves the others.
  const buildTitleParams = (language) => {
    const params = new URLSearchParams({ language, type: contentType })
    if (selectedTitle.sd_id) params.append('sd_id', selectedTitle.sd_id)
    if (selectedTitle.imdb_id) params.append('imdb_id', selectedTitle.imdb_id)
    if (selectedTitle.tmdb_id) params.append('tmdb_id', selectedTitle.tmdb_id)
    if (selectedTitle.title) params.append('title', selectedTitle.title)
    if (selectedTitle.year) params.append('year', selectedTitle.year)
    if (contentType === 'tv' && season) params.append('season', season)
    if (contentType === 'tv' && episode) params.append('episode', episode)
    return params
  }

  const fetchSubtitleList = async (language, setResults, setFetching, setError) => {
    if (!selectedTitle) return
    setFetching(true)
    setError('')
    setResults([])
    try {
      const params = buildTitleParams(language)
      const resp = await fetch(`/api/subtitles?${params}`)
      const data = await resp.json()
      if (data.error) { setError('not_found'); return }
      if (!data.subtitles || data.subtitles.length === 0) { setError('not_found'); return }
      setResults(data.subtitles)
    } catch (err) {
      setError('not_found')
    } finally {
      setFetching(false)
    }
  }

  const loadSubContent = async (sub, setLoading, setBlocks, setError, fallbackList, langCode = null, langLabel = '', setLangWarning = null) => {
    setLoading(true)
    setError('')
    setBlocks([])
    if (setLangWarning) setLangWarning('')

    const tryFetch = async (subItem) => {
      const resp = await fetch('/api/fetch-sub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: subItem.url || null,
          file_id: subItem.file_id || null,
          ss_id: subItem.ss_id || null,
        }),
      })
      const data = await resp.json()
      if (!data.success || data.error) throw new Error(data.error || 'Subtitle download failed')
      const parsed = parseSrt(data.content)
      if (!parsed.length) throw new Error('Could not parse subtitle file')
      return parsed
    }

    // Providers go by whatever the uploader filed the file under, and that is sometimes simply
    // wrong: a file offered as Thai turned out to be Sinhala, and it aligned and merged
    // perfectly, because nothing else here looks at what language the text actually is.
    const checkLanguage = (parsed) => {
      if (!setLangWarning || !langCode) return
      const sample = parsed.slice(0, 400).map(b => b.text).join('\n')
      const result = verifyLanguage(sample, langCode, langLabel || langCode)
      setLangWarning(result.status === 'mismatch' ? result.message : '')
    }

    try {
      const parsed = await tryFetch(sub)
      setBlocks(parsed)
      checkLanguage(parsed)
    } catch (err) {
      if (fallbackList && fallbackList.length > 0) {
        for (const next of fallbackList) {
          if (next.id === sub.id) continue
          try {
            const parsed = await tryFetch(next)
            setBlocks(parsed)
            checkLanguage(parsed)
            setError('')
            setLoading(false)
            return
          } catch { continue }
        }
      }
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }
  const translateFallback = async (targetLangCode, setBlocks, setError, setTranslating, setTranslateSource, sourceBlocks = null, setProgress = null) => {
    setTranslating(true)
    setError('')
    setBlocks([])
    if (setProgress) setProgress('')
    try {
      const targetLang = LANGUAGES.find(l => l.code === targetLangCode)?.label || targetLangCode
      let allBlocks = []
      let sourceLabel = ''

      // Smart source selection: use other window's blocks if available, otherwise fetch English
      if (sourceBlocks && sourceBlocks.length > 0) {
        allBlocks = sourceBlocks
        sourceLabel = 'Translated from: other panel'
      } else {
        const params = buildTitleParams('EN')

        const listResp = await fetch(`/api/subtitles?${params}`)
        const listData = await listResp.json()
        if (!listData.subtitles?.length) throw new Error('No English subtitles found to translate from')

        let englishContent = ''
        let lastDownloadError = 'Could not download English subtitles'

        const sortedCandidates = [
          ...listData.subtitles.filter(c => c.source !== 'subdl'),
          ...listData.subtitles.filter(c => c.source === 'subdl'),
        ]

        let usedCandidate = null
        for (const candidate of sortedCandidates) {
          const fetchResp = await fetch('/api/fetch-sub', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: candidate.url || null,
              file_id: candidate.file_id || null,
              ss_id: candidate.ss_id || null,
            }),
          })
          const fetchData = await fetchResp.json()
          if (fetchData.success && fetchData.content) {
            englishContent = fetchData.content
            usedCandidate = candidate
            break
          }
          lastDownloadError = fetchData.error || lastDownloadError
        }

        if (!englishContent) throw new Error(lastDownloadError)
        if (usedCandidate) {
          const epLabel = usedCandidate.episode > 0 ? ` · E${usedCandidate.episode}` : ''
          sourceLabel = `Translated from: English${epLabel} (${usedCandidate.source})`
        }
        allBlocks = parseSrt(englishContent)
      }

      if (!allBlocks.length) throw new Error('Could not parse source subtitle')
      if (setTranslateSource) setTranslateSource(sourceLabel)

      const { blocks: allTranslated, missingCount, total } = await translateBlocksInChunks(allBlocks, targetLang, {
        title: selectedTitle?.title || '',
        onProgress: setProgress || undefined,
      })
      if (!allTranslated.length) throw new Error('Translation produced empty result')
      setBlocks(allTranslated)
      if (setTranslateSource) setTranslateSource(`${sourceLabel}${missingNote(missingCount, total)}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setTranslating(false)
      if (setProgress) setProgress('')
    }
  }

  const updateBlockL1 = (idx, newText) => {
    const updated = [...blocksL1]
    updated[idx] = { ...updated[idx], text: newText }
    setBlocksL1(updated)
  }

  const updateBlockL2 = (idx, newText) => {
    const updated = [...blocksL2]
    updated[idx] = { ...updated[idx], text: newText }
    setBlocksL2(updated)
  }


  const handleVideoFile = (file) => {
    if (!file || !file.type.startsWith('video/')) return
    if (videoUrl) URL.revokeObjectURL(videoUrl)
    setRestoredSession(false)
    setVideoFile(file)
    setVideoUrl(URL.createObjectURL(file))
    setCurrentSubText('')
  }

  const handleVideoDrop = (e) => {
    e.preventDefault()
    setVideoDragging(false)
    const file = e.dataTransfer.files[0]
    handleVideoFile(file)
  }

  const handleVideoSpeed = (speed) => {
    setVideoSpeed(speed)
    if (videoRef.current) videoRef.current.playbackRate = speed
  }

  // The fullscreen button follows the player's own controls: it appears when the mouse moves and
  // fades a few seconds later, but stays put whenever the film is paused.
  const revealControls = () => {
    setControlsVisible(true)
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current)
    hideControlsTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setControlsVisible(false)
    }, 2600)
  }

  useEffect(() => () => { if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current) }, [])

  const handleContainerFullscreen = () => {
    const el = containerRef.current
    if (!el) return
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) document.exitFullscreen()
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen()
    } else {
      if (el.requestFullscreen) el.requestFullscreen()
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen()
    }
  }

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(!!(document.fullscreenElement || document.webkitFullscreenElement))
    }
    document.addEventListener('fullscreenchange', onChange)
    document.addEventListener('webkitfullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('webkitfullscreenchange', onChange)
    }
  }, [])

  // Write the workspace down whenever it changes, so a refresh picks up where you left off.
  // Debounced because the sliders fire continuously while being dragged.
  useEffect(() => {
    const id = setTimeout(() => {
      saveSession({
        query, year, contentType, season, episode,
        searchResults, selectedTitle,
        lang1, lang2, mode1, mode2,
        subResultsL1, subResultsL2, selectedSubL1, selectedSubL2,
        blocksL1, blocksL2,
        langWarnL1, langWarnL2,
        translateSourceL1, translateSourceL2,
        offsetMs, secondaryOffsetMs, autoAlign, pageMode,
      })
    }, 400)
    return () => clearTimeout(id)
  }, [
    query, year, contentType, season, episode, searchResults, selectedTitle,
    lang1, lang2, mode1, mode2, subResultsL1, subResultsL2, selectedSubL1, selectedSubL2,
    blocksL1, blocksL2, langWarnL1, langWarnL2, translateSourceL1, translateSourceL2,
    offsetMs, secondaryOffsetMs, autoAlign, pageMode,
  ])

  // Measure how the two tracks line up. Sweeping a feature-length pair takes up to a second,
  // so it runs after a paint rather than during render, and the panel says it is working.
  // Declared before the ref-sync effects below, which depend on the aligned track.
  useEffect(() => {
    if (!blocksL1.length || !blocksL2.length) { setAlignment(null); setAligning(false); return }
    setAligning(true)
    let cancelled = false
    const id = setTimeout(() => {
      let result = null
      try {
        result = analyzeAlignment(blocksL1, blocksL2)
      } catch (err) {
        console.error('Alignment check failed:', err)
      }
      if (!cancelled) { setAlignment(result); setAligning(false) }
    }, 30)
    return () => { cancelled = true; clearTimeout(id) }
  }, [blocksL1, blocksL2])

  // The second track as it will actually be used: auto-aligned when that helps, plus any
  // manual nudge. Everything downstream (merge, downloads, the video overlay) reads this, so
  // what you see in the player is what lands in the file.
  const alignedL2 = useMemo(() => {
    let out = blocksL2
    if (autoAlign && alignment && !isIdentityTransform(alignment.transform) && alignment.verdict !== 'incompatible') {
      out = retimeBlocks(out, alignment.transform)
    }
    if (secondaryOffsetMs) out = applyOffset(out, secondaryOffsetMs)
    return out
  }, [blocksL2, autoAlign, alignment, secondaryOffsetMs])

  // Keep live refs in sync with state so the single rAF loop always has fresh values
  useEffect(() => { offsetMsRef.current = offsetMs }, [offsetMs])
  useEffect(() => { blocksL1Ref.current = blocksL1 }, [blocksL1])
  useEffect(() => { blocksL2Ref.current = alignedL2 }, [alignedL2])


  // ── Create subtitle portal overlay on mount (once) ──
  useEffect(() => {
    const overlay = document.createElement('div')
    overlay.id = 'ssh-sub-portal'
    overlay.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'z-index:2147483647',
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'justify-content:flex-end',
      'gap:3px',
      'box-sizing:border-box',
      'left:0','top:0','width:0','height:0',
    ].join(';')
    document.body.appendChild(overlay)
    fsOverlayRef.current = overlay
    return () => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay) }
  }, [])

  // ── Single unified rAF loop — reads all live values from refs, never restarts on slider drag ──
  useEffect(() => {
    if (!videoUrl) return
    const video = videoRef.current
    if (!video) return

    const toMs = (ts) => {
      if (!ts) return 0
      const m = ts.match(/(\d{2}):(\d{2}):(\d{2})[,.]?(\d{3})?/)
      if (!m) return 0
      return parseInt(m[1])*3600000 + parseInt(m[2])*60000 + parseInt(m[3])*1000 + parseInt(m[4]||0)
    }

    // Pre-parse all timestamps once — never re-parse per frame
    const buildParsed = (blocks) => blocks.map(b => ({ text: b.text, start: toMs(b.start), end: toMs(b.end) }))
    let parsed1 = buildParsed(blocksL1Ref.current)
    let parsed2 = buildParsed(blocksL2Ref.current)
    let lastBl1 = blocksL1Ref.current
    let lastBl2 = blocksL2Ref.current

    let rafId
    let lastSubText = ''
    let lastSubText2 = ''
    let lastLineIdx = -1
    let lastLineIdx2 = -1
    let lastOverlayKey = null

    const tick = () => {
      // Rebuild parsed cache only when blocks actually change
      const bl1 = blocksL1Ref.current
      const bl2 = blocksL2Ref.current
      if (bl1 !== lastBl1) { parsed1 = buildParsed(bl1); lastBl1 = bl1 }
      if (bl2 !== lastBl2) { parsed2 = buildParsed(bl2); lastBl2 = bl2 }

      // ── 1. Subtitle matching (uses refs — no stale closures, no re-mount on slider) ──
      const t = video.currentTime * 1000
      const offset = offsetMsRef.current
      const adjustedT = t - offset

      const matchIdx = parsed1.findIndex(b => adjustedT >= b.start && adjustedT <= b.end)
      const match1 = matchIdx >= 0 ? parsed1[matchIdx] : null
      const matchIdx2 = parsed2.length > 0 ? parsed2.findIndex(b => adjustedT >= b.start && adjustedT <= b.end) : -1
      const match2 = matchIdx2 >= 0 ? parsed2[matchIdx2] : null

      const newSub1 = match1 ? match1.text : ''
      const newSub2 = match2 ? match2.text : ''

      // Only trigger React state updates when text actually changes
      if (newSub1 !== lastSubText) { lastSubText = newSub1; setCurrentSubText(newSub1) }
      if (newSub2 !== lastSubText2) { lastSubText2 = newSub2; setCurrentSubText2(newSub2) }
      if (matchIdx !== lastLineIdx) { lastLineIdx = matchIdx; setCurrentLineIndex(matchIdx) }
      if (matchIdx2 !== lastLineIdx2) { lastLineIdx2 = matchIdx2; setCurrentLineIndex2(matchIdx2) }

      // ── 2. Portal overlay position + subtitle render ──
      const overlay = fsOverlayRef.current
      if (overlay) {
        const isFS = !!(
          document.fullscreenElement ||
          document.webkitFullscreenElement ||
          document.mozFullScreenElement ||
          document.msFullscreenElement
        )

        if (isFS) {
          // Fullscreen: cover entire screen — video rect is unreliable in native FS
          overlay.style.left = '0'
          overlay.style.top = '0'
          overlay.style.width = '100vw'
          overlay.style.height = '100vh'
          overlay.style.paddingBottom = fullscreenPaddingBottom(window.innerHeight)
        } else {
          // Normal mode: track exact video element position
          const rect = video.getBoundingClientRect()
          overlay.style.left = rect.left + 'px'
          overlay.style.top = rect.top + 'px'
          overlay.style.width = rect.width + 'px'
          overlay.style.height = rect.height + 'px'
          overlay.style.paddingBottom = '52px'
        }

        // Subtitle text is third-party content, so it is rendered as text nodes, never as
        // HTML. Rebuilt only when the visible text (or the fullscreen size) changes.
        const draw = { primary: newSub1, secondary: newSub2, fullscreen: isFS, viewportHeight: window.innerHeight }
        const key = overlayRenderKey(draw)
        if (key !== lastOverlayKey) {
          lastOverlayKey = key
          renderSubtitleOverlay(overlay, draw)
        }
      }

      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [videoUrl])


  const handleUploadSrt = (file, setBlocks, setFileName) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = e => {
      const parsed = parseSrt(e.target.result)
      if (!parsed.length) { setUploadError('Could not parse SRT file — check the file format.'); return }
      setBlocks(parsed)
      setFileName(file.name)
      setUploadError('')
    }
    reader.readAsText(file)
  }

  const handleUploadTranslate = async (blocks, targetLangCode, setTranslating, setTranslatedBlocks, setError, setTranslateSource, setProgress, fileName = '') => {
    if (!blocks.length) return
    setTranslating(true)
    setError('')
    setTranslatedBlocks([])
    if (setProgress) setProgress('')
    try {
      const targetLang = LANGUAGES.find(l => l.code === targetLangCode)?.label || targetLangCode
      // The file name usually carries the title (Inception.2010.1080p...), which helps the model with names and tone.
      const title = (fileName || '').replace(/\.(srt|ass|vtt)$/i, '').replace(/[._]+/g, ' ').trim()
      const { blocks: allTranslated, missingCount, total } = await translateBlocksInChunks(blocks, targetLang, {
        title,
        onProgress: setProgress || undefined,
      })
      if (!allTranslated.length) throw new Error('Translation produced empty result')
      setTranslatedBlocks(allTranslated)
      setTranslateSource(`Translated to: ${targetLang} via AI${missingNote(missingCount, total)}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setTranslating(false)
      if (setProgress) setProgress('')
    }
  }

  const handleUploadDownloadSingle = (blocks, langCode, filename, offsetMs = 0) => {
    if (!blocks.length) return
    const srt = buildSrt(applyOffset(blocks, offsetMs))
    const base = filename.replace(/\.srt$/i, '') || 'subtitle'
    downloadFile(srt, `${base}_${langCode}.srt`)
  }

  const handleUploadDownloadMerged = (originalBlocks, translatedBlocks, langCode, filename, offsetMs = 0) => {
    if (!originalBlocks.length || !translatedBlocks.length) return
    const merged = mergeSrts(applyOffset(originalBlocks, offsetMs), applyOffset(translatedBlocks, offsetMs))
    const srt = buildSrt(merged)
    const base = filename.replace(/\.srt$/i, '') || 'subtitle'
    downloadFile(srt, `${base}_merged_${langCode}.srt`)
  }

  const updateUploadBlock = useCallback((idx, val) => { setUploadedBlocks(u => { const a = [...u]; a[idx] = { ...a[idx], text: val }; return a }) }, [])
  const updateUploadTranslatedBlock = useCallback((idx, val) => { setUploadTranslatedBlocks(u => { const a = [...u]; a[idx] = { ...a[idx], text: val }; return a }) }, [])
  const updateUploadBlock2 = useCallback((idx, val) => { setUploadedBlocks2(u => { const a = [...u]; a[idx] = { ...a[idx], text: val }; return a }) }, [])
  const updateUploadTranslatedBlock2 = useCallback((idx, val) => { setUploadTranslatedBlocks2(u => { const a = [...u]; a[idx] = { ...a[idx], text: val }; return a }) }, [])

  // The player's Live Sync used to be display-only: whatever you lined up by eye was dropped
  // when you downloaded. Both offsets now count, so the file matches what you watched.
  const totalOffsetMs = offsetMs

  const handleDownloadSingle = () => {
    if (!blocksL1.length) return
    const srt = buildSrt(applyOffset(blocksL1, totalOffsetMs))
    const title = selectedTitle?.title?.replace(/[^a-z0-9]/gi, '_') || 'subtitles'
    downloadFile(srt, `${title}_${lang1}.srt`)
  }

  const handleDownloadMerged = () => {
    if (!blocksL1.length || !alignedL2.length) return
    const merged = mergeSrts(applyOffset(blocksL1, totalOffsetMs), applyOffset(alignedL2, totalOffsetMs))
    const srt = buildSrt(merged)
    const title = selectedTitle?.title?.replace(/[^a-z0-9]/gi, '_') || 'subtitles'
    downloadFile(srt, `${title}_${lang1}_${lang2}_merged.srt`)
  }

  // Auto-trigger translation when the other window already has content
  useEffect(() => {
    if (errorL2 === 'not_found' && !blocksL2.length && !translatingL2 && !autoTranslatingL2 && blocksL1.length > 0 && lang2) {
      setAutoTranslatingL2(true)
      translateFallback(lang2, setBlocksL2, setErrorL2, setTranslatingL2, setTranslateSourceL2, blocksL1, setTranslateProgressL2)
        .finally(() => setAutoTranslatingL2(false))
    }
  }, [errorL2, blocksL1.length, lang2])

  useEffect(() => {
    if (errorL1 === 'not_found' && !blocksL1.length && !translatingL1 && !autoTranslatingL1 && blocksL2.length > 0) {
      setAutoTranslatingL1(true)
      translateFallback(lang1, setBlocksL1, setErrorL1, setTranslatingL1, setTranslateSourceL1, blocksL2, setTranslateProgressL1)
        .finally(() => setAutoTranslatingL1(false))
    }
  }, [errorL1, blocksL2.length])

  const lang1Label = LANGUAGES.find(l => l.code === lang1)?.label || lang1
  const lang2Label = lang2 ? (LANGUAGES.find(l => l.code === lang2)?.label || lang2) : null
  const hasDual = lang2 && blocksL2.length > 0

  const isSearchable = code => SEARCH_LANGUAGES.some(l => l.code === code)

  // Switching mode clears whatever the other mode produced, and drops a language that the new
  // mode cannot offer: the translate list has 103 entries, the download list only 37.
  const changeMode1 = next => {
    setMode1(next)
    setBlocksL1([]); setSubResultsL1([]); setSelectedSubL1(null); setErrorL1(''); setLangWarnL1('')
    if (next === 'find' && !isSearchable(lang1)) setLang1('EN')
  }
  const changeMode2 = next => {
    setMode2(next)
    setBlocksL2([]); setSubResultsL2([]); setSelectedSubL2(null); setErrorL2(''); setLangWarnL2('')
    if (next === 'find' && !isSearchable(lang2)) setLang2('')
  }

  const translateOptions1 = LANGUAGES.filter(l => l.code !== lang2)
  const translateOptions2 = LANGUAGES.filter(l => l.code !== lang1)

  // What a translation would actually read from: the other panel when it holds text, otherwise
  // English, which gets downloaded as a pivot. Asking for the language it is already in would
  // spend API credit to produce a copy, so that combination is refused.
  const sourceLangFor1 = blocksL2.length && lang2 ? lang2 : 'EN'
  const sourceLangFor2 = blocksL1.length && lang1 ? lang1 : 'EN'
  const pointlessTranslate1 = mode1 === 'translate' && lang1 === sourceLangFor1
  const pointlessTranslate2 = mode2 === 'translate' && lang2 === sourceLangFor2

  // How the two tracks will be merged: line by line when they share a timeline (one is a
  // translation of the other), by time overlap when they are two different files.
  const mergeInfo = useMemo(
    () => (hasDual && blocksL1.length ? mergeSrtsDetailed(blocksL1, alignedL2) : null),
    [hasDual, blocksL1, alignedL2]
  )

  const alignmentSummary = useMemo(
    () => (alignment ? describeAlignment(alignment, { primaryLabel: lang1Label, secondaryLabel: lang2Label || 'second' }) : null),
    [alignment, lang1Label, lang2Label]
  )

  return (
    <div>
      {/* NAV */}
      <nav className="nav">
        <div className="nav-logo-wrap">
          <img src="/logo.png" alt="SuperSubHero" className="nav-logo-img" />
        </div>
        <div className="nav-sub">Subtitle Search Engine</div>
        <div className="nav-mode-toggle">
          <button className={`nav-mode-btn ${pageMode === 'search' ? 'active' : ''}`} onClick={() => setPageMode('search')}>🔍 Search</button>
          <button className={`nav-mode-btn ${pageMode === 'upload' ? 'active' : ''}`} onClick={() => setPageMode('upload')}>⬆ Upload & Translate</button>
        </div>
      </nav>

      {pageMode === 'upload' && (
        <UploadTranslateSection
          uploadedBlocks={uploadedBlocks}
          uploadedBlocks2={uploadedBlocks2}
          uploadFileName={uploadFileName}
          uploadFileName2={uploadFileName2}
          uploadTargetLang={uploadTargetLang}
          setUploadTargetLang={setUploadTargetLang}
          uploadTargetLang2={uploadTargetLang2}
          setUploadTargetLang2={setUploadTargetLang2}
          uploadTranslating={uploadTranslating}
          uploadTranslating2={uploadTranslating2}
          uploadTranslatedBlocks={uploadTranslatedBlocks}
          uploadTranslatedBlocks2={uploadTranslatedBlocks2}
          uploadError={uploadError}
          uploadError2={uploadError2}
          uploadOffsetMs={uploadOffsetMs}
          setUploadOffsetMs={setUploadOffsetMs}
          uploadOffsetMs2={uploadOffsetMs2}
          setUploadOffsetMs2={setUploadOffsetMs2}
          uploadTranslateSource={uploadTranslateSource}
          uploadTranslateSource2={uploadTranslateSource2}
          uploadProgress={uploadProgress}
          uploadProgress2={uploadProgress2}
          onUpload={(file) => handleUploadSrt(file, setUploadedBlocks, setUploadFileName)}
          onUpload2={(file) => handleUploadSrt(file, setUploadedBlocks2, setUploadFileName2)}
          onTranslate={() => handleUploadTranslate(uploadedBlocks, uploadTargetLang, setUploadTranslating, setUploadTranslatedBlocks, setUploadError, setUploadTranslateSource, setUploadProgress, uploadFileName)}
          onTranslate2={() => handleUploadTranslate(uploadedBlocks2, uploadTargetLang2, setUploadTranslating2, setUploadTranslatedBlocks2, setUploadError2, setUploadTranslateSource2, setUploadProgress2, uploadFileName2)}
          onDownloadOriginal={() => handleUploadDownloadSingle(uploadedBlocks, 'original', uploadFileName)}
          onDownloadTranslated={() => handleUploadDownloadSingle(uploadTranslatedBlocks, uploadTargetLang, uploadFileName, uploadOffsetMs)}
          onDownloadMerged={() => handleUploadDownloadMerged(uploadedBlocks, uploadTranslatedBlocks, uploadTargetLang, uploadFileName, uploadOffsetMs)}
          onDownloadOriginal2={() => handleUploadDownloadSingle(uploadedBlocks2, 'original', uploadFileName2)}
          onDownloadTranslated2={() => handleUploadDownloadSingle(uploadTranslatedBlocks2, uploadTargetLang2, uploadFileName2, uploadOffsetMs2)}
          onDownloadMerged2={() => handleUploadDownloadMerged(uploadedBlocks2, uploadTranslatedBlocks2, uploadTargetLang2, uploadFileName2, uploadOffsetMs2)}
          onReset={() => { setUploadedBlocks([]); setUploadTranslatedBlocks([]); setUploadFileName(''); setUploadError(''); setUploadTranslateSource('') }}
          onReset2={() => { setUploadedBlocks2([]); setUploadTranslatedBlocks2([]); setUploadFileName2(''); setUploadError2(''); setUploadTranslateSource2('') }}
          onUpdateBlock={updateUploadBlock}
          onUpdateTranslated={updateUploadTranslatedBlock}
          onUpdateBlock2={updateUploadBlock2}
          onUpdateTranslated2={updateUploadTranslatedBlock2}
        />
      )}

      {pageMode === 'search' && (<>

      {/* HERO */}
      <div className="hero">
        <h1>Find Subtitles for<br /><em>Any Movie or Series</em></h1>
        <p>Search by title. Pick your languages. Edit if needed. Download single or dual-language SRT.</p>
      </div>

      {/* SEARCH */}
      <div className="search-wrap">
        <div className="type-toggle">
          <button className={`type-btn ${contentType === 'movie' ? 'active' : ''}`} onClick={() => setContentType('movie')}>🎬 Movie</button>
          <button className={`type-btn ${contentType === 'tv' ? 'active' : ''}`} onClick={() => setContentType('tv')}>📺 TV Series</button>
        </div>

        <div className="search-box">
          <input
            type="text"
            placeholder={contentType === 'tv' ? 'Search TV series, anime...' : 'Search movies, films, anime...'}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
          />
          <button className="search-btn" onClick={handleSearch} disabled={searching || !query.trim()}>
            {searching ? '...' : 'Search'}
          </button>
        </div>

        <div className="season-ep-row" style={{ marginTop: 8 }}>
          <input type="number" min="1900" max="2100" placeholder="Year (optional)" value={year} onChange={e => setYear(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} style={{ flex: 1 }} />
        </div>

        {contentType === 'tv' && (
          <div className="season-ep-row">
            <input type="number" min="1" placeholder="Season" value={season} onChange={e => setSeason(e.target.value)} />
            <input type="number" min="1" placeholder="Episode" value={episode} onChange={e => setEpisode(e.target.value)} />
          </div>
        )}
      </div>

      {/* SEARCH RESULTS */}
      {searchResults.length > 0 && (
        <div className="results-list">
          <div className="results-label">Select a title</div>
          {searchResults.map(r => (
            <div key={r.id} className={`result-item ${selectedTitle?.id === r.id ? 'selected' : ''}`} onClick={() => handleSelectTitle(r)}>
              <div className="result-poster-placeholder">🎬</div>
              <div className="result-info">
                <div className="result-title">{r.title}</div>
                <div className="result-meta">{r.year || '—'} · {r.type === 'tv' ? 'TV Series' : 'Movie'}</div>
              </div>
              <div className="result-badge" title={r.providers ? `Found on: ${r.providers.join(', ')}` : ''}>
                {r.providers ? r.providers.map(p => p === 'opensubtitles' ? 'OS' : p === 'subsource' ? 'SS' : 'SDL').join(' · ') : (r.imdb_id || r.tmdb_id || '')}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SELECTED TITLE BANNER */}
      {selectedTitle && (
        <div className="selected-banner-wrap">
          <div className="selected-banner">
            <span style={{ fontSize: 20 }}>🎬</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="selected-banner-title">{selectedTitle.title}</div>
              <div className="selected-banner-meta">{selectedTitle.year} · {selectedTitle.type === 'tv' ? 'TV Series' : 'Movie'}</div>
            </div>
            <button
              onClick={() => {
                setSelectedTitle(null); setBlocksL1([]); setBlocksL2([])
                setSubResultsL1([]); setSubResultsL2([]); setSelectedSubL1(null); setSelectedSubL2(null)
                setErrorL1(''); setErrorL2(''); setLangWarnL1(''); setLangWarnL2('')
                setTranslateSourceL1(''); setTranslateSourceL2('')
                clearSession()
              }}
              className="close-btn"
              title="Clear this title and start over"
            >×</button>
          </div>
        </div>
      )}

      {/* WORKSPACE */}
      {selectedTitle && (
        <div className="workspace">
          {/* LEFT PANEL */}
          <CollapsiblePanel
            title="Primary Language"
            langLabel={lang1Label}
            blocks={blocksL1}
            loading={loadingL1}
            translating={translatingL1}
            error={errorL1}
            onBlockChange={updateBlockL1}
            translateSource={translateSourceL1}
            progress={translateProgressL1}
            warning={langWarnL1}
            emptyIcon="📄"
            emptyText="Subtitle text will appear here"
            emptySubText="Select a subtitle from Controls"
          />

          {/* CENTER CONTROLS */}
          <div className="controls">
            <div className="controls-title">Controls</div>

            <div className="ctrl-label">Primary Language</div>
            <ModeToggle mode={mode1} onChange={changeMode1} otherLabel={lang2Label || 'other'} />
            <select className="lang-select" value={lang1} onChange={e => { setLang1(e.target.value); setBlocksL1([]); setSubResultsL1([]); setSelectedSubL1(null); setErrorL1(''); setLangWarnL1('') }}>
              {(mode1 === 'translate' ? translateOptions1 : SEARCH_LANGUAGES.filter(l => l.code !== lang2))
                .map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>

            {mode1 === 'find' ? (
              <button className="fetch-btn" onClick={() => fetchSubtitleList(lang1, setSubResultsL1, setFetchingL1, setErrorL1)} disabled={fetchingL1 || !selectedTitle}>
                {fetchingL1 ? 'Searching...' : `Find ${lang1Label} Subtitles`}
              </button>
            ) : (
              <>
                <button
                  className="fetch-btn ai-btn"
                  onClick={() => translateFallback(lang1, setBlocksL1, setErrorL1, setTranslatingL1, setTranslateSourceL1, blocksL2.length > 0 ? blocksL2 : null, setTranslateProgressL1)}
                  disabled={translatingL1 || !selectedTitle || pointlessTranslate1}
                >
                  {translatingL1 ? 'Translating...' : blocksL1.length ? `Redo ${lang1Label} translation` : `✨ Translate to ${lang1Label}`}
                </button>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
                  {pointlessTranslate1
                    ? `The source is already ${lang1Label}. Pick a different language, or use Find file instead.`
                    : blocksL2.length > 0
                      ? `Translated from the ${lang2Label} track, so the timing matches it exactly.`
                      : 'English subtitles are downloaded and translated from, so the timing comes from those.'}
                </div>
              </>
            )}

            {mode1 === 'find' && errorL1 === 'not_found' && !blocksL1.length && !translatingL1 && !autoTranslatingL1 && (
              <div className="ai-fallback-box">
                <div className="ai-fallback-text">No {lang1Label} subtitles found.</div>
                <button className="fetch-btn ai-btn" onClick={() => translateFallback(lang1, setBlocksL1, setErrorL1, setTranslatingL1, setTranslateSourceL1, blocksL2.length > 0 ? blocksL2 : null, setTranslateProgressL1)}>
                  ✨ AI Translate
                </button>
              </div>
            )}

            {errorL1 && errorL1 !== 'not_found' && !subResultsL1.length && <div className="status-bar error">{errorL1}</div>}

            {mode1 === 'find' && (
              <ReleasePicker
                releases={subResultsL1
                  .filter(s => !episode || !s.episode || s.episode === parseInt(episode) || s.full_season)
                  .slice(0, RELEASES_SHOWN)}
                selected={selectedSubL1}
                comparedToName={selectedSubL2?.name}
                langLabel={lang1Label}
                warning={langWarnL1}
                onPick={s => { setSelectedSubL1(s); loadSubContent(s, setLoadingL1, setBlocksL1, setErrorL1, subResultsL1, lang1, lang1Label, setLangWarnL1) }}
              />
            )}

            <div className="divider" />

            <div className="ctrl-label">Second Language (Optional)</div>
            <ModeToggle mode={mode2} onChange={changeMode2} otherLabel={lang1Label} />
            <select className="lang-select" value={lang2} onChange={e => { setLang2(e.target.value); setBlocksL2([]); setSubResultsL2([]); setSelectedSubL2(null); setErrorL2(''); setLangWarnL2('') }}>
              <option value="">— None —</option>
              {(mode2 === 'translate' ? translateOptions2 : SEARCH_LANGUAGES.filter(l => l.code !== lang1))
                .map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>

            {lang2 && (
              <>
                {mode2 === 'find' ? (
                  <button className="fetch-btn" onClick={() => fetchSubtitleList(lang2, setSubResultsL2, setFetchingL2, setErrorL2)} disabled={fetchingL2 || !selectedTitle}>
                    {fetchingL2 ? 'Searching...' : `Find ${lang2Label} Subtitles`}
                  </button>
                ) : (
                  <>
                    <button
                      className="fetch-btn ai-btn"
                      onClick={() => translateFallback(lang2, setBlocksL2, setErrorL2, setTranslatingL2, setTranslateSourceL2, blocksL1.length > 0 ? blocksL1 : null, setTranslateProgressL2)}
                      disabled={translatingL2 || !selectedTitle || pointlessTranslate2}
                    >
                      {translatingL2 ? 'Translating...' : blocksL2.length ? `Redo ${lang2Label} translation` : `✨ Translate to ${lang2Label}`}
                    </button>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
                      {pointlessTranslate2
                        ? `The source is already ${lang2Label}. Pick a different language, or use Find file instead.`
                        : blocksL1.length > 0
                          ? `Translated from the ${lang1Label} track, so both tracks line up exactly.`
                          : `Load the ${lang1Label} track first, or English subtitles are downloaded and translated from instead.`}
                    </div>
                  </>
                )}

                {mode2 === 'find' && errorL2 === 'not_found' && !blocksL2.length && !translatingL2 && !autoTranslatingL2 && (
                  <div className="ai-fallback-box">
                    <div className="ai-fallback-text">No {lang2Label} subtitles found.</div>
                    <button className="fetch-btn ai-btn" onClick={() => translateFallback(lang2, setBlocksL2, setErrorL2, setTranslatingL2, setTranslateSourceL2, blocksL1.length > 0 ? blocksL1 : null, setTranslateProgressL2)}>
                      ✨ AI Translate
                    </button>
                  </div>
                )}

                {errorL2 && errorL2 !== 'not_found' && !subResultsL2.length && <div className="status-bar error">{errorL2}</div>}

                {mode2 === 'find' && (
                  <ReleasePicker
                    releases={subResultsL2
                      .filter(s => !episode || !s.episode || s.episode === parseInt(episode) || s.full_season)
                      .slice(0, RELEASES_SHOWN)}
                    selected={selectedSubL2}
                    comparedToName={selectedSubL1?.name}
                    langLabel={lang2Label || 'Second'}
                    warning={langWarnL2}
                    onPick={s => { setSelectedSubL2(s); loadSubContent(s, setLoadingL2, setBlocksL2, setErrorL2, subResultsL2, lang2, lang2Label, setLangWarnL2) }}
                  />
                )}
              </>
            )}

            <div className="divider" />

            <div className="ctrl-label">Preview</div>
            <div className="preview-box bg-transparent">
              <div className="preview-line">{previewText(blocksL1[0]?.text, PREVIEW_SAMPLE)}</div>
              {lang2 && (
                <div className="preview-line lang2">
                  {previewText(blocksL2[0]?.text, `Your ${lang2Label} line appears here`)}
                </div>
              )}
            </div>

            <div className="divider" />


            {/* SYNC OFFSET */}
            <div className="ctrl-label">Sync Adjustment</div>
            <div className="sync-wrap">
              <input
                type="range"
                min="-300000"
                max="300000"
                step="100"
                value={offsetMs}
                onChange={e => setOffsetMs(Number(e.target.value))}
                className="sync-slider"
              />
              <div className="sync-display">
                <button className="sync-reset" onClick={() => setOffsetMs(0)} title="Reset">↺</button>
                <span className={`sync-value ${offsetMs > 0 ? 'delay' : offsetMs < 0 ? 'advance' : ''}`}>
                  {offsetMs === 0 ? 'No offset' : offsetMs > 0 ? `+${(offsetMs/1000).toFixed(1)}s delay` : `${(offsetMs/1000).toFixed(1)}s advance`}
                </span>
              </div>
            </div>

            <button className="dl-btn" onClick={handleDownloadSingle} disabled={!blocksL1.length}>
              ↓ Download Single ({lang1Label})
            </button>
            <button className="dl-btn secondary" onClick={handleDownloadMerged} disabled={!hasDual}>
              ↓ Download Merged ({lang2 ? `${lang1} + ${lang2}` : 'select 2nd lang'})
            </button>
            {hasDual && aligning && (
              <div style={{ fontSize: 11, color: 'var(--accent2)', marginTop: 6 }}>Checking how the two tracks line up...</div>
            )}

            {hasDual && !aligning && alignmentSummary && (
              <div
                style={{
                  marginTop: 8, padding: '8px 10px', borderRadius: 8, lineHeight: 1.5, fontSize: 11,
                  border: `1px solid ${alignmentSummary.tone === 'bad' ? 'var(--error)' : alignmentSummary.tone === 'warn' ? '#c8a135' : 'var(--border)'}`,
                  background: alignmentSummary.tone === 'bad' ? 'rgba(241,53,74,0.08)' : 'transparent',
                  color: alignmentSummary.tone === 'bad' ? 'var(--error)' : 'var(--muted)',
                }}
              >
                <div style={{ fontWeight: 500, color: alignmentSummary.tone === 'bad' ? 'var(--error)' : 'var(--text)' }}>
                  {alignmentSummary.headline}
                </div>
                {alignmentSummary.detail && <div style={{ marginTop: 3 }}>{alignmentSummary.detail}</div>}
                {mergeInfo && alignment?.verdict === 'unknown' && (
                  <div style={{ marginTop: 3 }}>
                    {mergeInfo.matched} of {blocksL1.length} {lang1Label} lines were paired by time.
                  </div>
                )}
                {mergeInfo && mergeInfo.unmatchedSecond > 0 && alignmentSummary.tone !== 'bad' && (
                  <div style={{ marginTop: 3 }}>
                    {mergeInfo.unmatchedSecond} {lang2Label}-only {mergeInfo.unmatchedSecond === 1 ? 'line is kept on its own' : 'lines are kept on their own'} so nothing is lost.
                  </div>
                )}
              </div>
            )}

            {hasDual && alignment && !isIdentityTransform(alignment.transform) && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={autoAlign} onChange={e => setAutoAlign(e.target.checked)} />
                Correct the {lang2Label} timing automatically
              </label>
            )}

            {hasDual && (
              <>
                <div className="ctrl-label" style={{ marginTop: 12 }}>Nudge {lang2Label} only</div>
                <div className="sync-wrap">
                  <input type="range" min="-60000" max="60000" step="100" value={secondaryOffsetMs}
                    onChange={e => setSecondaryOffsetMs(Number(e.target.value))} className="sync-slider" />
                  <div className="sync-display">
                    <button className="sync-reset" onClick={() => setSecondaryOffsetMs(0)} title="Reset">↺</button>
                    <span className={`sync-value ${secondaryOffsetMs > 0 ? 'delay' : secondaryOffsetMs < 0 ? 'advance' : ''}`}>
                      {secondaryOffsetMs === 0 ? 'No extra nudge' : `${secondaryOffsetMs > 0 ? '+' : ''}${(secondaryOffsetMs / 1000).toFixed(1)}s`}
                    </span>
                  </div>
                </div>
              </>
            )}


            {/* VPN AFFILIATES */}
            <div className="vpn-strip">
              <div className="vpn-label">🔒 Watch without limits</div>
              <div className="vpn-cards">
                <a href="https://nordvpn.com/" target="_blank" rel="noreferrer sponsored" className="vpn-card">
                  <div className="vpn-name nord">Nord<span>VPN</span></div>
                  <div className="vpn-pitch">Best overall</div>
                  <div className="vpn-cta">Get Deal →</div>
                </a>
                <a href="https://www.expressvpn.com/" target="_blank" rel="noreferrer sponsored" className="vpn-card">
                  <div className="vpn-name express">Express<span>VPN</span></div>
                  <div className="vpn-pitch">Fastest speeds</div>
                  <div className="vpn-cta">Get Deal →</div>
                </a>
                <a href="https://surfshark.com/" target="_blank" rel="noreferrer sponsored" className="vpn-card">
                  <div className="vpn-name surf">Surf<span>shark</span></div>
                  <div className="vpn-pitch">Best value</div>
                  <div className="vpn-cta">Get Deal →</div>
                </a>
              </div>
            </div>

            <div className="fallback-link">
              Can't find it? Try <a href="https://www.subtitlecat.com" target="_blank" rel="noreferrer">SubtitleCat</a> or <a href="https://subdl.com" target="_blank" rel="noreferrer">SubDL</a> manually.
            </div>
          </div>

          {/* RIGHT PANEL */}
          <CollapsiblePanel
            title="Second Language"
            langLabel={lang2Label || ''}
            blocks={alignedL2}
            loading={loadingL2}
            translating={translatingL2}
            error={errorL2}
            onBlockChange={updateBlockL2}
            translateSource={translateSourceL2}
            progress={translateProgressL2}
            warning={langWarnL2}
            emptyIcon="🌍"
            emptyText={lang2 ? 'Second subtitle will appear here' : 'Select a second language'}
            emptySubText={lang2 ? `Find and select a ${lang2Label} release` : 'Optional — for dual-language SRT'}
          />
        </div>
      )}

      {/* VIDEO PLAYER */}
      {selectedTitle && blocksL1.length > 0 && (
        <div className="video-section">
          <div className="video-section-title">🎬 Watch with Subtitles</div>

          {!videoFile ? (
            <div
              className={`video-dropzone ${videoDragging ? 'dragging' : ''}`}
              onDragOver={e => { e.preventDefault(); setVideoDragging(true) }}
              onDragLeave={() => setVideoDragging(false)}
              onDrop={handleVideoDrop}
              onClick={() => document.getElementById('video-file-input').click()}
            >
              <div className="video-drop-icon">▶</div>
              <div className="video-drop-text">Drop your video file here</div>
              <div className="video-drop-sub">or click to browse · MP4, MKV, WebM</div>
              {/* Subtitles survive a refresh; the film cannot. A browser is not allowed to
                  reopen a file from your disk on its own, so it has to be picked again. */}
              {restoredSession && (
                <div className="video-drop-sub" style={{ marginTop: 8, color: 'var(--accent2)' }}>
                  Your subtitles were kept. The video has to be picked again, as browsers cannot
                  reopen a file from your computer on their own.
                </div>
              )}
              <input
                id="video-file-input"
                type="file"
                accept="video/*"
                style={{ display: 'none' }}
                onChange={e => handleVideoFile(e.target.files[0])}
              />
            </div>
          ) : (
            <div className="video-player-wrap">
              <div
                className="video-container"
                ref={containerRef}
                onMouseMove={revealControls}
                onMouseLeave={() => { if (videoRef.current && !videoRef.current.paused) setControlsVisible(false) }}
                onTouchStart={revealControls}
              >
                {/* Picture-in-picture is turned off: its icon looks like a fullscreen control
                    and is not one, which is the second button that appeared to do nothing. */}
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  controlsList="nofullscreen nodownload noremoteplayback"
                  disablePictureInPicture
                  className="video-el"
                  onPlay={revealControls}
                  onPause={() => { if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current); setControlsVisible(true) }}
                />
                {(currentSubText || currentSubText2) && (
                  <div className="video-sub-overlay">
                    {currentSubText && currentSubText.split('\n').map((line, i) => (
                      <div key={i} className="video-sub-line">{line}</div>
                    ))}
                    {currentSubText2 && currentSubText2.split('\n').map((line, i) => (
                      <div key={`l2-${i}`} className="video-sub-line lang2">{line}</div>
                    ))}
                  </div>
                )}
                {blocksL1.length > 0 && (
                  <div className="video-line-counter">
                    {`${lang1} ${currentLineIndex >= 0 ? currentLineIndex + 1 : 0}/${blocksL1.length}`}
                    {hasDual && ` · ${lang2} ${currentLineIndex2 >= 0 ? currentLineIndex2 + 1 : 0}/${alignedL2.length}`}
                  </div>
                )}
                <button
                  className={`video-fs-btn ${controlsVisible ? 'visible' : ''}`}
                  onClick={handleContainerFullscreen}
                  title={isFullscreen ? 'Exit full screen' : 'Full screen (keeps the subtitles on screen)'}
                >
                  {isFullscreen ? '✕ Exit' : '⛶ Full'}
                </button>
              </div>

              <div className="video-controls-bar">
                <div className="video-ctrl-group">
                  <div className="video-ctrl-label">Speed</div>
                  <div className="video-speed-btns">
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map(s => (
                      <button
                        key={s}
                        className={`video-speed-btn ${videoSpeed === s ? 'active' : ''}`}
                        onClick={() => handleVideoSpeed(s)}
                      >{s}x</button>
                    ))}
                  </div>
                </div>

                {/* One sync control, shared with the Controls panel and applied to downloads.
                    There used to be two sliders that looked independent but were added together,
                    and only one of them reached the downloaded file. */}
                <div className="video-ctrl-group">
                  <div className="video-ctrl-label">
                    Sync both tracks &nbsp;
                    <span className={`sync-value ${offsetMs > 0 ? 'delay' : offsetMs < 0 ? 'advance' : ''}`}>
                      {offsetMs === 0 ? 'No offset' : `${offsetMs > 0 ? '+' : ''}${(offsetMs / 1000).toFixed(1)}s`}
                    </span>
                  </div>
                  <div className="video-sync-row">
                    <input
                      type="range"
                      min="-300000"
                      max="300000"
                      step="100"
                      value={offsetMs}
                      onChange={e => setOffsetMs(Number(e.target.value))}
                      className="sync-slider"
                    />
                    <input
                      type="number"
                      className="sync-input"
                      value={(offsetMs / 1000).toFixed(1)}
                      step="0.1"
                      onChange={e => setOffsetMs(Math.round(parseFloat(e.target.value || 0) * 1000))}
                    />
                    <span className="sync-unit">s</span>
                    <button className="sync-reset" onClick={() => setOffsetMs(0)} title="Reset">↺</button>
                  </div>
                </div>

                {hasDual && (
                  <div className="video-ctrl-group">
                    <div className="video-ctrl-label">
                      Nudge {lang2Label} only &nbsp;
                      <span className={`sync-value ${secondaryOffsetMs > 0 ? 'delay' : secondaryOffsetMs < 0 ? 'advance' : ''}`}>
                        {secondaryOffsetMs === 0 ? 'No nudge' : `${secondaryOffsetMs > 0 ? '+' : ''}${(secondaryOffsetMs / 1000).toFixed(1)}s`}
                      </span>
                    </div>
                    <div className="video-sync-row">
                      <input
                        type="range"
                        min="-60000"
                        max="60000"
                        step="100"
                        value={secondaryOffsetMs}
                        onChange={e => setSecondaryOffsetMs(Number(e.target.value))}
                        className="sync-slider"
                      />
                      <input
                        type="number"
                        className="sync-input"
                        value={(secondaryOffsetMs / 1000).toFixed(1)}
                        step="0.1"
                        onChange={e => setSecondaryOffsetMs(Math.round(parseFloat(e.target.value || 0) * 1000))}
                      />
                      <span className="sync-unit">s</span>
                      <button className="sync-reset" onClick={() => setSecondaryOffsetMs(0)} title="Reset">↺</button>
                    </div>
                    {alignmentSummary && (
                      <div style={{ fontSize: 11, marginTop: 4, color: alignmentSummary.tone === 'bad' ? 'var(--error)' : 'var(--muted)' }}>
                        {alignmentSummary.headline}
                      </div>
                    )}
                  </div>
                )}

                <button
                  className="video-change-btn"
                  onClick={() => { setVideoFile(null); setVideoUrl(null); setCurrentSubText('') }}
                >
                  ✕ Remove Video
                </button>
              </div>
            </div>
          )}
        </div>
      )}

  </>
  )}

    </div>
  )
}
