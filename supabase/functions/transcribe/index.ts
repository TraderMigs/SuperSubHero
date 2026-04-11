import "https://deno.land/x/xhr@0.1.0/mod.ts"

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

async function updateJob(id: string, fields: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/sub_jobs?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY!,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(fields),
  })
}

async function downloadVideoAsBlob(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch video: ${res.status}`)
  return await res.blob()
}

async function transcribeWithWhisper(videoBlob: Blob, fileName: string): Promise<{ text: string, segments: unknown[] }> {
  const formData = new FormData()
  formData.append('file', videoBlob, fileName)
  formData.append('model', 'whisper-1')
  formData.append('response_format', 'verbose_json')
  formData.append('timestamp_granularities[]', 'segment')

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: formData,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Whisper error: ${err}`)
  }

  return await res.json()
}

function segmentsToSrt(segments: Array<{ start: number, end: number, text: string }>): string {
  return segments.map((seg, idx) => {
    const start = formatTime(seg.start)
    const end = formatTime(seg.end)
    return `${idx + 1}\n${start} --> ${end}\n${seg.text.trim()}\n`
  }).join('\n')
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.round((seconds % 1) * 1000)
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0')
}

async function uploadSrtToStorage(jobId: string, lang: string, srtContent: string): Promise<string> {
  const path = `srt/${jobId}/${lang}.srt`
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/subtitles/${path}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY!,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'text/plain',
      'x-upsert': 'true',
    },
    body: srtContent,
  })
  if (!res.ok) throw new Error(`Storage upload failed: ${await res.text()}`)
  return `${SUPABASE_URL}/storage/v1/object/public/subtitles/${path}`
}

async function translateSrt(srtContent: string, targetLang: string): Promise<string> {
  const lines = srtContent.split('\n')
  const textLines: Array<{ idx: number, text: string }> = []

  lines.forEach((line, idx) => {
    const isNumber = /^\d+$/.test(line.trim())
    const isTimestamp = /-->/.test(line)
    const isEmpty = line.trim() === ''
    if (!isNumber && !isTimestamp && !isEmpty) {
      textLines.push({ idx, text: line })
    }
  })

  const batch = textLines.map(l => l.text).join('\n|||SPLIT|||\n')

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a subtitle translator. Translate each line to ${targetLang}. Lines are separated by |||SPLIT|||. Return ONLY the translated lines separated by |||SPLIT|||. Keep the exact same number of lines. Do not add any commentary.`
        },
        { role: 'user', content: batch }
      ],
      temperature: 0.1,
    }),
  })

  if (!res.ok) throw new Error(`Translation error: ${await res.text()}`)
  const data = await res.json()
  const translated = data.choices[0].message.content.split('|||SPLIT|||').map((t: string) => t.trim())

  const result = [...lines]
  textLines.forEach((item, i) => {
    if (translated[i]) result[item.idx] = translated[i]
  })
  return result.join('\n')
}

function mergeDualSrt(srt1: string, srt2: string): string {
  const parse = (srt: string) => {
    const blocks = srt.trim().split(/\n\n+/)
    return blocks.map(block => {
      const lines = block.split('\n')
      const tsLine = lines.find(l => l.includes('-->')) || ''
      const [start, end] = tsLine.split(' --> ')
      const text = lines.filter(l => l && !/^\d+$/.test(l.trim()) && !l.includes('-->')).join(' ')
      return { start: start?.trim(), end: end?.trim(), text }
    }).filter(b => b.start && b.text)
  }

  const blocks1 = parse(srt1)
  const blocks2 = parse(srt2)

  const merged: Array<{ start: string, end: string, text: string }> = []
  const all = [...blocks1.map(b => ({ ...b, src: 1 })), ...blocks2.map(b => ({ ...b, src: 2 }))]
  all.sort((a, b) => a.start.localeCompare(b.start))

  const processed = new Set<string>()
  for (const block of all) {
    const key = block.start
    if (processed.has(key)) continue
    processed.add(key)
    const pair2 = block.src === 1 ? blocks2.find(b => b.start === block.start) : blocks1.find(b => b.start === block.start)
    if (pair2) {
      merged.push({ start: block.start, end: block.end, text: block.src === 1 ? `${block.text}\n${pair2.text}` : `${pair2.text}\n${block.text}` })
    } else {
      merged.push({ start: block.start, end: block.end, text: block.text })
    }
  }

  return merged.map((b, idx) => `${idx + 1}\n${b.start} --> ${b.end}\n${b.text}\n`).join('\n')
}

Deno.serve(async (req: Request) => {
  let jobId = ''
  try {
    const body = await req.json()
    jobId = body.job_id

    if (!jobId) return new Response(JSON.stringify({ error: 'job_id required' }), { status: 400 })

    const jobRes = await fetch(`${SUPABASE_URL}/rest/v1/sub_jobs?id=eq.${jobId}&select=*`, {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY!,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    })
    const jobs = await jobRes.json()
    const job = jobs[0]
    if (!job) return new Response(JSON.stringify({ error: 'Job not found' }), { status: 404 })

    await updateJob(jobId, { status: 'extracting' })

    const videoBlob = await downloadVideoAsBlob(job.video_url)
    const fileName = job.video_url.split('/').pop() || 'video.mp4'

    await updateJob(jobId, { status: 'transcribing' })

    const whisperResult = await transcribeWithWhisper(videoBlob, fileName)
    const baseSrt = segmentsToSrt(whisperResult.segments as Array<{ start: number, end: number, text: string }>)
    const detectedLang = (whisperResult as Record<string, unknown>).language as string || 'en'

    await updateJob(jobId, { status: 'translating' })

    const languages: string[] = job.languages || ['en']
    const srtFiles: Array<{ lang: string, url: string }> = []

    const baseLangCode = detectedLang.toLowerCase().slice(0, 2)
    const baseSrtUrl = await uploadSrtToStorage(jobId, baseLangCode, baseSrt)
    srtFiles.push({ lang: baseLangCode, url: baseSrtUrl })

    const srtCache: Record<string, string> = { [baseLangCode]: baseSrt }

    for (const lang of languages) {
      if (srtCache[lang]) {
        if (!srtFiles.find(f => f.lang === lang)) srtFiles.push({ lang, url: await uploadSrtToStorage(jobId, lang, srtCache[lang]) })
        continue
      }
      const translated = await translateSrt(baseSrt, lang)
      srtCache[lang] = translated
      const url = await uploadSrtToStorage(jobId, lang, translated)
      srtFiles.push({ lang, url })
    }

    await updateJob(jobId, { status: 'packaging' })

    let dualSrtUrl: string | null = null
    if (job.dual_sub && job.dual_pair && job.dual_pair.length === 2) {
      const [l1, l2] = job.dual_pair
      const srt1 = srtCache[l1] || (await (async () => { const t = await translateSrt(baseSrt, l1); srtCache[l1] = t; return t })())
      const srt2 = srtCache[l2] || (await (async () => { const t = await translateSrt(baseSrt, l2); srtCache[l2] = t; return t })())
      const dual = mergeDualSrt(srt1, srt2)
      dualSrtUrl = await uploadSrtToStorage(jobId, `dual-${l1}-${l2}`, dual)
    }

    const results = {
      srt_files: srtFiles,
      dual_srt: dualSrtUrl,
      detected_language: detectedLang,
    }

    await updateJob(jobId, { status: 'done', results })

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('Transcribe function error:', err)
    if (jobId) await updateJob(jobId, { status: 'error', error_msg: (err as Error).message })
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 })
  }
})
