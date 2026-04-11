import React, { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { LANGUAGES } from '../lib/languages.js'

function srtToVtt(srt) {
  return 'WEBVTT\n\n' + srt
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    .replace(/^\d+\n/gm, '')
    .trim()
}

export default function Player() {
  const { jobId } = useParams()
  const videoRef = useRef()
  const trackRef = useRef()

  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedSrt, setSelectedSrt] = useState(null)
  const [vttUrl, setVttUrl] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    loadJob()
  }, [jobId])

  const loadJob = async () => {
    const { data, error: err } = await supabase
      .from('sub_jobs')
      .select('*')
      .eq('id', jobId)
      .single()

    if (err || !data) {
      setError('Job not found.')
      setLoading(false)
      return
    }
    setJob(data)
    setLoading(false)

    if (data.results?.srt_files?.length > 0) {
      loadSubtitle(data.results.srt_files[0].url)
      setSelectedSrt(data.results.srt_files[0].url)
    }
  }

  const loadSubtitle = async (url) => {
    if (vttUrl) URL.revokeObjectURL(vttUrl)
    try {
      const res = await fetch(url)
      const srtText = await res.text()
      const vtt = srtToVtt(srtText)
      const blob = new Blob([vtt], { type: 'text/vtt' })
      const objUrl = URL.createObjectURL(blob)
      setVttUrl(objUrl)
    } catch (e) {
      console.error('Subtitle load error', e)
    }
  }

  const handleSubChange = (url) => {
    setSelectedSrt(url)
    loadSubtitle(url)
  }

  useEffect(() => {
    if (vttUrl && trackRef.current && videoRef.current) {
      trackRef.current.src = vttUrl
      for (let t of videoRef.current.textTracks) {
        t.mode = 'showing'
      }
    }
  }, [vttUrl])

  const langName = (code) => LANGUAGES.find(l => l.code === code)?.label || code

  if (loading) {
    return (
      <div className="player-page" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--muted)', fontFamily: 'Bebas Neue', fontSize: 28, letterSpacing: '0.05em' }}>
          Loading...
        </div>
      </div>
    )
  }

  if (error || !job) {
    return (
      <div className="player-page" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="error-msg">{error || 'Job not found'}</div>
        <Link to="/" className="back-btn" style={{ marginTop: 16 }}>Back to Home</Link>
      </div>
    )
  }

  const srtFiles = job.results?.srt_files || []
  const dualSrt = job.results?.dual_srt
  const videoUrl = job.video_url

  const allSubs = [
    ...srtFiles.map(f => ({ label: langName(f.lang), url: f.url })),
    ...(dualSrt ? [{ label: 'Dual Language', url: dualSrt }] : [])
  ]

  return (
    <div className="player-page">
      <div className="player-nav">
        <div className="player-nav-logo">SuperSubHero</div>
        <Link to="/" className="back-btn">Back</Link>
      </div>

      <div className="video-container">
        <video
          ref={videoRef}
          controls
          crossOrigin="anonymous"
          src={videoUrl}
        >
          {vttUrl && (
            <track
              ref={trackRef}
              kind="subtitles"
              src={vttUrl}
              default
            />
          )}
        </video>
      </div>

      <div className="player-controls">
        <label>Subtitle Track</label>
        <select
          value={selectedSrt || ''}
          onChange={(e) => handleSubChange(e.target.value)}
        >
          <option value="">No Subtitles</option>
          {allSubs.map((s, i) => (
            <option key={i} value={s.url}>{s.label}</option>
          ))}
        </select>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {allSubs.map((s, i) => (
            <a
              key={i}
              href={s.url}
              download
              className="download-btn secondary"
            >
              Download {s.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
