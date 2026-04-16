import React, { useState, useCallback, useRef, useEffect } from 'react'
import { LANGUAGES } from '../lib/languages.js'
import { parseSrt, buildSrt, mergeSrts, downloadFile, applyOffset } from '../lib/srt.js'

const PREVIEW_LINES = [
  { en: "I'll be back.", th: 'ฉันจะกลับมา' },
  { en: "May the Force be with you.", th: 'ขอให้พลังสถิตกับเจ้า' },
  { en: "Why so serious?", th: 'ทำไมต้องจริงจังนัก?' },
]

function CollapsiblePanel({ title, langLabel, blocks, loading, translating, error, onBlockChange, emptyIcon, emptyText, emptySubText }) {
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
          {translating && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>This takes ~30 seconds for a full movie</div>}
        </div>
      )}
      {error && error !== 'not_found' && !hasContent && (
        <div className="status-bar error" style={{ margin: '0 16px 16px' }}>{error}</div>
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

export default function Home() {
  const [query, setQuery] = useState('')
  const [contentType, setContentType] = useState('movie')
  const [season, setSeason] = useState('')
  const [episode, setEpisode] = useState('')

  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [selectedTitle, setSelectedTitle] = useState(null)

  const [lang1, setLang1] = useState('EN')
  const [lang2, setLang2] = useState('')

  const [fetchingL1, setFetchingL1] = useState(false)
  const [fetchingL2, setFetchingL2] = useState(false)
  const [subResultsL1, setSubResultsL1] = useState([])
  const [subResultsL2, setSubResultsL2] = useState([])
  const [selectedSubL1, setSelectedSubL1] = useState(null)
  const [selectedSubL2, setSelectedSubL2] = useState(null)

  const [loadingL1, setLoadingL1] = useState(false)
  const [loadingL2, setLoadingL2] = useState(false)
  const [blocksL1, setBlocksL1] = useState([])
  const [blocksL2, setBlocksL2] = useState([])
  const [errorL1, setErrorL1] = useState('')
  const [errorL2, setErrorL2] = useState('')

  const [translatingL1, setTranslatingL1] = useState(false)
  const [translatingL2, setTranslatingL2] = useState(false)

  const [offsetMs, setOffsetMs] = useState(0)

  const [videoFile, setVideoFile] = useState(null)
  const [videoUrl, setVideoUrl] = useState(null)
  const [videoDragging, setVideoDragging] = useState(false)
  const [videoSpeed, setVideoSpeed] = useState(1)
  const [liveOffset, setLiveOffset] = useState(0)
  const [currentSubText, setCurrentSubText] = useState('')
  const [currentSubText2, setCurrentSubText2] = useState('')
  const [currentLineIndex, setCurrentLineIndex] = useState(-1)
  const videoRef = useRef(null)
  const animFrameRef = useRef(null)

  const [previewStyle] = useState('transparent')
  const previewLine = PREVIEW_LINES[1]

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

  const fetchSubtitleList = async (language, setResults, setFetching, setError) => {
    if (!selectedTitle) return
    setFetching(true)
    setError('')
    setResults([])
    try {
      const params = new URLSearchParams({ language, type: contentType })
      if (selectedTitle.sd_id) params.append('sd_id', selectedTitle.sd_id)
      else if (selectedTitle.imdb_id) params.append('imdb_id', selectedTitle.imdb_id)
      else if (selectedTitle.tmdb_id) params.append('tmdb_id', selectedTitle.tmdb_id)
      if (selectedTitle.title) params.append('title', selectedTitle.title)
      if (contentType === 'tv' && season) params.append('season', season)
      if (contentType === 'tv' && episode) params.append('episode', episode)
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

  const loadSubContent = async (sub, setLoading, setBlocks, setError, fallbackList) => {
    setLoading(true)
    setError('')
    setBlocks([])

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

    try {
      const parsed = await tryFetch(sub)
      setBlocks(parsed)
    } catch (err) {
      if (fallbackList && fallbackList.length > 0) {
        for (const next of fallbackList) {
          if (next.id === sub.id) continue
          try {
            const parsed = await tryFetch(next)
            setBlocks(parsed)
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
  const translateFallback = async (targetLangCode, setBlocks, setError, setTranslating) => {
    setTranslating(true)
    setError('')
    setBlocks([])
    try {
      const params = new URLSearchParams({ language: 'EN', type: contentType })
      if (selectedTitle.sd_id) params.append('sd_id', selectedTitle.sd_id)
      else if (selectedTitle.imdb_id) params.append('imdb_id', selectedTitle.imdb_id)
      else if (selectedTitle.tmdb_id) params.append('tmdb_id', selectedTitle.tmdb_id)
      if (selectedTitle.title) params.append('title', selectedTitle.title)
      if (contentType === 'tv' && season) params.append('season', season)
      if (contentType === 'tv' && episode) params.append('episode', episode)

      const listResp = await fetch(`/api/subtitles?${params}`)
      const listData = await listResp.json()
      if (!listData.subtitles?.length) throw new Error('No English subtitles found to translate from')

      let englishContent = ''
      let lastDownloadError = 'Could not download English subtitles'

      // Sort: try OS and SubSource first (SubDL CDN is blocked from Vercel)
      const sortedCandidates = [
        ...listData.subtitles.filter(c => c.source !== 'subdl'),
        ...listData.subtitles.filter(c => c.source === 'subdl'),
      ]

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
          break
        }
        lastDownloadError = fetchData.error || lastDownloadError
      }

      if (!englishContent) throw new Error(lastDownloadError)

      const targetLang = LANGUAGES.find(l => l.code === targetLangCode)?.label || targetLangCode
      const translateResp = await fetch('/api/translate-srt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ srtContent: englishContent, targetLanguage: targetLang, targetLanguageCode: targetLangCode }),
      })
      const translateData = await translateResp.json()
      if (translateData.error) throw new Error(translateData.error)

      const parsed = parseSrt(translateData.content)
      if (!parsed.length) throw new Error('Translation produced empty result')
      setBlocks(parsed)
    } catch (err) {
      setError(err.message)
    } finally {
      setTranslating(false)
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
    const tick = () => {
      const t = video.currentTime * 1000
      const offset = offsetMs + liveOffset
      const adjustedT = t - offset
      const matchIdx = blocksL1.findIndex(b => adjustedT >= toMs(b.start) && adjustedT <= toMs(b.end))
      const match1 = matchIdx >= 0 ? blocksL1[matchIdx] : null
      const match2 = blocksL2.length > 0 ? blocksL2.find(b => adjustedT >= toMs(b.start) && adjustedT <= toMs(b.end)) : null
      setCurrentSubText(match1 ? match1.text : '')
      setCurrentSubText2(match2 ? match2.text : '')
      setCurrentLineIndex(matchIdx)
      animFrameRef.current = requestAnimationFrame(tick)
    }
    animFrameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [videoUrl, blocksL1, blocksL2, offsetMs, liveOffset])

  const handleDownloadSingle = () => {
    if (!blocksL1.length) return
    const srt = buildSrt(applyOffset(blocksL1, offsetMs))
    const title = selectedTitle?.title?.replace(/[^a-z0-9]/gi, '_') || 'subtitles'
    downloadFile(srt, `${title}_${lang1}.srt`)
  }

  const handleDownloadMerged = () => {
    if (!blocksL1.length || !blocksL2.length) return
    const merged = mergeSrts(applyOffset(blocksL1, offsetMs), applyOffset(blocksL2, offsetMs))
    const srt = buildSrt(merged)
    const title = selectedTitle?.title?.replace(/[^a-z0-9]/gi, '_') || 'subtitles'
    downloadFile(srt, `${title}_${lang1}_${lang2}_merged.srt`)
  }

  const lang1Label = LANGUAGES.find(l => l.code === lang1)?.label || lang1
  const lang2Label = lang2 ? (LANGUAGES.find(l => l.code === lang2)?.label || lang2) : null
  const hasDual = lang2 && blocksL2.length > 0

  return (
    <div>
      {/* NAV */}
      <nav className="nav">
        <div className="nav-logo-wrap">
          <img src="/logo.png" alt="SuperSubHero" className="nav-logo-img" />
        </div>
        <div className="nav-sub">Subtitle Search Engine</div>
      </nav>

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
              <div className="result-badge">{r.imdb_id || r.tmdb_id || ''}</div>
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
            <button onClick={() => { setSelectedTitle(null); setBlocksL1([]); setBlocksL2([]) }} className="close-btn">×</button>
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
            emptyIcon="📄"
            emptyText="Subtitle text will appear here"
            emptySubText="Select a subtitle from Controls"
          />

          {/* CENTER CONTROLS */}
          <div className="controls">
            <div className="controls-title">Controls</div>

            <div className="ctrl-label">Primary Language</div>
            <select className="lang-select" value={lang1} onChange={e => { setLang1(e.target.value); setBlocksL1([]); setSubResultsL1([]); setSelectedSubL1(null); setErrorL1('') }}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
            <button className="fetch-btn" onClick={() => fetchSubtitleList(lang1, setSubResultsL1, setFetchingL1, setErrorL1)} disabled={fetchingL1 || !selectedTitle}>
              {fetchingL1 ? 'Searching...' : `Find ${lang1Label} Subtitles`}
            </button>

            {errorL1 === 'not_found' && !blocksL1.length && !translatingL1 && (
              <div className="ai-fallback-box">
                <div className="ai-fallback-text">No {lang1Label} subtitles found.</div>
                <button className="fetch-btn ai-btn" onClick={() => translateFallback(lang1, setBlocksL1, setErrorL1, setTranslatingL1)}>
                  ✨ AI Translate from English
                </button>
              </div>
            )}

            {errorL1 && errorL1 !== 'not_found' && !subResultsL1.length && <div className="status-bar error">{errorL1}</div>}

            {subResultsL1.length > 0 && (
              <div>
                <div className="ctrl-label">Pick a release</div>
                {subResultsL1.slice(0, 8).map((s, i) => (
                  <div key={i} className={`sub-result-item ${selectedSubL1?.id === s.id ? 'selected' : ''}`} onClick={() => { setSelectedSubL1(s); loadSubContent(s, setLoadingL1, setBlocksL1, setErrorL1, subResultsL1) }}>
                    <div className="sub-result-name">{s.name}</div>
                    {s.episode > 0 && <div className="sub-result-meta">E{s.episode}</div>}
                    {(s.full_season || s.episode === 0) && <div className="sub-result-meta" style={{ color: 'var(--muted)' }}>Full</div>}
                  </div>
                ))}
              </div>
            )}

            <div className="divider" />

            <div className="ctrl-label">Second Language (Optional)</div>
            <select className="lang-select" value={lang2} onChange={e => { setLang2(e.target.value); setBlocksL2([]); setSubResultsL2([]); setSelectedSubL2(null); setErrorL2('') }}>
              <option value="">— None —</option>
              {LANGUAGES.filter(l => l.code !== lang1).map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>

            {lang2 && (
              <>
                <button className="fetch-btn" onClick={() => fetchSubtitleList(lang2, setSubResultsL2, setFetchingL2, setErrorL2)} disabled={fetchingL2 || !selectedTitle}>
                  {fetchingL2 ? 'Searching...' : `Find ${lang2Label} Subtitles`}
                </button>

                {errorL2 === 'not_found' && !blocksL2.length && !translatingL2 && (
                  <div className="ai-fallback-box">
                    <div className="ai-fallback-text">No {lang2Label} subtitles found.</div>
                    <button className="fetch-btn ai-btn" onClick={() => translateFallback(lang2, setBlocksL2, setErrorL2, setTranslatingL2)}>
                      ✨ AI Translate from English
                    </button>
                  </div>
                )}

                {errorL2 && errorL2 !== 'not_found' && !subResultsL2.length && <div className="status-bar error">{errorL2}</div>}

                {subResultsL2.length > 0 && (
                  <div>
                    <div className="ctrl-label">Pick a release</div>
                    {subResultsL2.slice(0, 8).map((s, i) => (
                      <div key={i} className={`sub-result-item ${selectedSubL2?.id === s.id ? 'selected' : ''}`} onClick={() => { setSelectedSubL2(s); loadSubContent(s, setLoadingL2, setBlocksL2, setErrorL2, subResultsL2) }}>
                        <div className="sub-result-name">{s.name}</div>
                        {s.episode > 0 && <div className="sub-result-meta">E{s.episode}</div>}
                        {(s.full_season || s.episode === 0) && <div className="sub-result-meta" style={{ color: 'var(--muted)' }}>Full</div>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="divider" />

            <div className="ctrl-label">Preview</div>
            <div className={`preview-box ${previewStyle === 'black' ? 'bg-black' : 'bg-transparent'}`}>
              <div className="preview-line">{previewLine.en}</div>
              {lang2 && <div className="preview-line lang2">{previewLine.th}</div>}
            </div>

            <div className="divider" />


            {/* SYNC OFFSET */}
            <div className="ctrl-label">Sync Adjustment</div>
            <div className="sync-wrap">
              <input
                type="range"
                min="-10000"
                max="10000"
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
            blocks={blocksL2}
            loading={loadingL2}
            translating={translatingL2}
            error={errorL2}
            onBlockChange={updateBlockL2}
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
              <div className="video-container">
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  className="video-el"
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
                    {currentLineIndex >= 0 ? `Line ${currentLineIndex + 1} of ${blocksL1.length}` : `0 of ${blocksL1.length}`}
                  </div>
                )}
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

                <div className="video-ctrl-group">
                  <div className="video-ctrl-label">
                    Live Sync &nbsp;
                    <span className={`sync-value ${liveOffset > 0 ? 'delay' : liveOffset < 0 ? 'advance' : ''}`}>
                      {liveOffset === 0 ? 'No offset' : liveOffset > 0 ? `+${(liveOffset/1000).toFixed(1)}s` : `${(liveOffset/1000).toFixed(1)}s`}
                    </span>
                  </div>
                  <div className="video-sync-row">
                    <input
                      type="range"
                      min="-300000"
                      max="300000"
                      step="100"
                      value={liveOffset}
                      onChange={e => setLiveOffset(Number(e.target.value))}
                      className="sync-slider"
                    />
                    <input
                      type="number"
                      className="sync-input"
                      value={(liveOffset/1000).toFixed(1)}
                      step="0.1"
                      onChange={e => setLiveOffset(Math.round(parseFloat(e.target.value || 0) * 1000))}
                    />
                    <span className="sync-unit">s</span>
                    <button className="sync-reset" onClick={() => setLiveOffset(0)} title="Reset">↺</button>
                  </div>
                </div>

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

    </div>
  )
}
