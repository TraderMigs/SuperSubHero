import React, { useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { LANGUAGES } from '../lib/languages.js'

const STEPS = [
  { key: 'uploading', label: 'Uploading video...', pct: 15 },
  { key: 'queued', label: 'Job queued...', pct: 25 },
  { key: 'extracting', label: 'Extracting audio...', pct: 40 },
  { key: 'transcribing', label: 'Transcribing speech...', pct: 60 },
  { key: 'translating', label: 'Translating subtitles...', pct: 80 },
  { key: 'packaging', label: 'Packaging SRT files...', pct: 92 },
  { key: 'done', label: 'Done!', pct: 100 },
]

const CHUNK_SIZE = 20 * 1024 * 1024 // 20MB chunks

export default function Home() {
  const navigate = useNavigate()
  const fileInputRef = useRef()
  const pollRef = useRef()

  const [file, setFile] = useState(null)
  const [dragover, setDragover] = useState(false)
  const [languages, setLanguages] = useState(['en'])
  const [dualSub, setDualSub] = useState(false)
  const [dualPair, setDualPair] = useState(['en', 'es'])
  const [phase, setPhase] = useState('idle')
  const [progress, setProgress] = useState(0)
  const [stepLabel, setStepLabel] = useState('')
  const [jobId, setJobId] = useState(null)
  const [results, setResults] = useState(null)
  const [error, setError] = useState('')

  const handleFile = (f) => {
    if (!f) return
    const ok = f.type.startsWith('video/') || f.name.match(/\.(mp4|mkv|mov|avi|webm|m4v)$/i)
    if (!ok) { setError('Please upload a video file (mp4, mkv, mov, avi, webm)'); return }
    setError('')
    setFile(f)
  }

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragover(false)
    handleFile(e.dataTransfer.files[0])
  }, [])

  const addLanguage = () => {
    if (languages.length >= 6) return
    const unused = LANGUAGES.find(l => !languages.includes(l.code))
    if (unused) setLanguages([...languages, unused.code])
  }

  const removeLanguage = (idx) => {
    if (languages.length <= 1) return
    setLanguages(languages.filter((_, i) => i !== idx))
  }

  const updateLanguage = (idx, val) => {
    const updated = [...languages]
    updated[idx] = val
    setLanguages(updated)
  }

  const pollJob = (id) => {
    pollRef.current = setInterval(async () => {
      const { data } = await supabase
        .from('sub_jobs')
        .select('*')
        .eq('id', id)
        .single()

      if (!data) return

      const stepObj = STEPS.find(s => s.key === data.status) || STEPS[1]
      setProgress(stepObj.pct)
      setStepLabel(stepObj.label)

      if (data.status === 'done') {
        clearInterval(pollRef.current)
        setResults(data.results)
        setPhase('done')
      } else if (data.status === 'error') {
        clearInterval(pollRef.current)
        setError(data.error_msg || 'Processing failed. Please try again.')
        setPhase('error')
      }
    }, 3000)
  }

  const uploadFileInChunks = async (f) => {
    const fileType = f.type || 'video/mp4'

    // Step 1: start multipart upload
    const startRes = await fetch('/api/upload-chunk', {
      method: 'POST',
      headers: {
        'x-action': 'start',
        'x-file-name': f.name,
        'x-file-type': fileType,
      },
    })
    if (!startRes.ok) throw new Error('Failed to start upload')
    const { uploadId, key } = await startRes.json()

    const totalChunks = Math.ceil(f.size / CHUNK_SIZE)
    const parts = []

    // Step 2: upload each chunk
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, f.size)
      const chunk = f.slice(start, end)

      const pct = Math.round(8 + ((i / totalChunks) * 12))
      setProgress(pct)
      setStepLabel(`Uploading part ${i + 1} of ${totalChunks}...`)

      const partRes = await fetch('/api/upload-chunk', {
        method: 'POST',
        headers: {
          'x-action': 'part',
          'x-upload-id': uploadId,
          'x-key': key,
          'x-part-number': String(i + 1),
          'Content-Type': fileType,
        },
        body: chunk,
      })

      if (!partRes.ok) {
        // abort on failure
        await fetch('/api/upload-chunk', {
          method: 'POST',
          headers: { 'x-action': 'abort', 'x-upload-id': uploadId, 'x-key': key },
        })
        throw new Error(`Chunk ${i + 1} upload failed`)
      }

      const { ETag } = await partRes.json()
      parts.push({ PartNumber: i + 1, ETag })
    }

    // Step 3: complete multipart upload
    setStepLabel('Finalizing upload...')
    const completeRes = await fetch('/api/upload-chunk', {
      method: 'POST',
      headers: {
        'x-action': 'complete',
        'x-upload-id': uploadId,
        'x-key': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parts }),
    })

    if (!completeRes.ok) throw new Error('Failed to finalize upload')
    const { publicUrl } = await completeRes.json()
    return { publicUrl, key }
  }

  const handleSubmit = async () => {
    if (!file) return
    setError('')
    setPhase('uploading')
    setProgress(5)
    setStepLabel('Starting upload...')

    try {
      const { publicUrl, key } = await uploadFileInChunks(file)

      setProgress(20)
      setStepLabel('Queuing job...')
      setPhase('processing')

      const payload = {
        video_url: publicUrl,
        file_path: key,
        languages,
        dual_sub: dualSub,
        dual_pair: dualSub ? dualPair : null,
        status: 'queued',
        created_at: new Date().toISOString(),
      }

      const { data: job, error: jobErr } = await supabase
        .from('sub_jobs')
        .insert(payload)
        .select()
        .single()

      if (jobErr) throw jobErr

      setJobId(job.id)
      setProgress(25)
      setStepLabel('Job queued...')

      await fetch('/api/trigger-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.id }),
      })

      pollJob(job.id)

    } catch (err) {
      console.error(err)
      setError(err.message || 'Upload failed. Please try again.')
      setPhase('error')
    }
  }

  const reset = () => {
    clearInterval(pollRef.current)
    setFile(null)
    setPhase('idle')
    setProgress(0)
    setStepLabel('')
    setJobId(null)
    setResults(null)
    setError('')
    setLanguages(['en'])
    setDualSub(false)
    setDualPair(['en', 'es'])
  }

  const langName = (code) => LANGUAGES.find(l => l.code === code)?.label || code

  return (
    <div className="page">
      <nav className="nav">
        <div className="nav-logo">Super<span>Sub</span>Hero</div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>Personal Subtitle Engine</div>
      </nav>

      {phase === 'idle' || phase === 'error' ? (
        <>
          <div className="hero">
            <h1>Turn Any Movie Into<br /><em>Perfect Subtitles</em></h1>
            <p>Upload a video. Get SRT files in any language in minutes. Watch with subs in your browser.</p>
          </div>

          <div className="upload-section">
            <div className="upload-card">
              <div
                className={`drop-zone ${file ? 'file-selected' : ''} ${dragover ? 'dragover' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragover(true) }}
                onDragLeave={() => setDragover(false)}
                onDrop={onDrop}
              >
                <input
                  type="file"
                  accept="video/*,.mkv"
                  ref={fileInputRef}
                  onChange={(e) => handleFile(e.target.files[0])}
                />
                {file ? (
                  <>
                    <div className="drop-icon">🎬</div>
                    <h3>Video Ready</h3>
                    <div className="file-name">{file.name}</div>
                    <p style={{ marginTop: 6 }}>{(file.size / 1024 / 1024 / 1024).toFixed(2)} GB</p>
                  </>
                ) : (
                  <>
                    <div className="drop-icon">📁</div>
                    <h3>Drop Your Movie Here</h3>
                    <p>MP4, MKV, MOV, AVI, WebM supported</p>
                  </>
                )}
              </div>

              <div className="lang-section">
                <label>Output Languages</label>
                {languages.map((code, idx) => (
                  <div key={idx} className="lang-pair-row">
                    <select value={code} onChange={(e) => updateLanguage(idx, e.target.value)}>
                      {LANGUAGES.map(l => (
                        <option key={l.code} value={l.code}>{l.label}</option>
                      ))}
                    </select>
                    {languages.length > 1 && (
                      <button className="remove-lang-btn" onClick={() => removeLanguage(idx)}>x</button>
                    )}
                  </div>
                ))}
                {languages.length < 6 && (
                  <button className="add-lang-btn" onClick={addLanguage} style={{ marginTop: 10 }}>
                    + Add Language
                  </button>
                )}
              </div>

              <div className="options-section">
                <label
                  className={`option-toggle ${dualSub ? 'active' : ''}`}
                  onClick={() => setDualSub(!dualSub)}
                >
                  <input type="checkbox" checked={dualSub} readOnly />
                  Dual Subtitle Merge
                </label>
              </div>

              {dualSub && (
                <div className="lang-section" style={{ marginTop: 20 }}>
                  <label>Merge These Two Languages Into One SRT</label>
                  <div className="lang-row">
                    <select value={dualPair[0]} onChange={(e) => setDualPair([e.target.value, dualPair[1]])}>
                      {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                    </select>
                    <select value={dualPair[1]} onChange={(e) => setDualPair([dualPair[0], e.target.value])}>
                      {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {error && <div className="error-msg">{error}</div>}

              <button className="submit-btn" disabled={!file} onClick={handleSubmit}>
                Generate Subtitles
              </button>
            </div>
          </div>

          <div className="features">
            {[
              { icon: '🎙', title: 'Whisper AI', desc: 'OpenAI transcription engine' },
              { icon: '🌍', title: '30 Languages', desc: 'Any language you need' },
              { icon: '🎬', title: 'Browser Player', desc: 'Watch with subs instantly' },
              { icon: '⬇️', title: 'SRT Download', desc: 'Use anywhere' },
              { icon: '🔀', title: 'Dual Subs', desc: 'Two languages merged' },
            ].map(f => (
              <div className="feature" key={f.title}>
                <div className="feature-icon">{f.icon}</div>
                <h4>{f.title}</h4>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </>
      ) : phase === 'uploading' || phase === 'processing' ? (
        <div className="upload-section" style={{ marginTop: 60 }}>
          <div className="progress-card">
            <h2>Processing Your Movie</h2>
            <p className="progress-label">This takes a few minutes for a full film — sit back.</p>
            <div className="progress-bar-wrap">
              <div className="progress-bar" style={{ width: `${progress}%` }} />
            </div>
            <div className="progress-step">{stepLabel}</div>
            <div style={{ marginTop: 20, color: 'var(--muted)', fontSize: 13 }}>{file?.name}</div>
          </div>
        </div>
      ) : phase === 'done' && results ? (
        <div className="upload-section" style={{ marginTop: 60 }}>
          <div className="results-card">
            <h2>Subtitles Ready</h2>
            <p>Download your SRT files or watch directly in your browser.</p>
            <div className="download-grid">
              {results.srt_files && results.srt_files.map((item) => (
                <div className="download-item" key={item.lang}>
                  <div className="download-item-info">
                    <div className="download-flag">{LANGUAGES.find(l => l.code === item.lang)?.flag || item.lang.toUpperCase()}</div>
                    <div>
                      <div className="download-label">{langName(item.lang)}</div>
                      <div className="download-sub">SRT subtitle file</div>
                    </div>
                  </div>
                  <a className="download-btn" href={item.url} download>Download</a>
                </div>
              ))}
              {results.dual_srt && (
                <div className="download-item">
                  <div className="download-item-info">
                    <div className="download-flag">2x</div>
                    <div>
                      <div className="download-label">{langName(dualPair[0])} + {langName(dualPair[1])}</div>
                      <div className="download-sub">Dual language merged SRT</div>
                    </div>
                  </div>
                  <a className="download-btn" href={results.dual_srt} download>Download</a>
                </div>
              )}
            </div>
            <button className="watch-btn" onClick={() => navigate(`/player/${jobId}`)}>
              Watch Movie With Subtitles
            </button>
            <button className="new-btn" onClick={reset}>Process Another Movie</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
