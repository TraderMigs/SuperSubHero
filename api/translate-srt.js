// Translates one chunk of SRT (the page sends 80-cue chunks) with OpenAI.
//
// Model: OPENAI_MODEL env var, default gpt-4.1-mini. If that model is not available to the
// key, gpt-4o-mini is tried once as a fallback. Output is requested as strict JSON
// ({ blocks: [{ n, text }] }) so block numbering cannot drift; anything still missing gets
// one targeted retry, and whatever is left keeps the original text and is counted in
// missingCount so the page can tell the user.

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
const FALLBACK_MODEL = 'gpt-4o-mini'
const MAX_RETRY_BLOCKS = 200

const RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'subtitle_translation',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        blocks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              n: { type: 'integer' },
              text: { type: 'string' },
            },
            required: ['n', 'text'],
            additionalProperties: false,
          },
        },
      },
      required: ['blocks'],
      additionalProperties: false,
    },
  },
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

function shortError(text) {
  try {
    const j = JSON.parse(text)
    const msg = j?.error?.message || text
    return String(msg).slice(0, 240)
  } catch {
    return String(text).slice(0, 240)
  }
}

// One chat-completions call with retries on rate limits / server errors.
// Throws an error with .code = 'model' when the model itself is rejected, so the caller can fall back.
async function chatCompletion({ apiKey, model, messages, maxOutputTokens }) {
  const supportsTemperature = !/^(gpt-5|o\d)/i.test(model)
  const body = {
    model,
    messages,
    response_format: RESPONSE_FORMAT,
    max_completion_tokens: maxOutputTokens,
  }
  if (supportsTemperature) body.temperature = 0.1

  let lastError = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (resp.ok) return resp.json()

    const text = await resp.text()
    const status = resp.status
    const modelProblem = status === 404 || (status === 400 && /model/i.test(text) && /(not found|does not exist|do not have access|not supported|unsupported)/i.test(text))
    if (modelProblem) {
      const e = new Error(`Model ${model} not available: ${shortError(text)}`)
      e.code = 'model'
      throw e
    }
    const quotaProblem = /insufficient_quota|credit_balance_exhausted|billing/i.test(text)
    if ((status === 429 && !quotaProblem) || status >= 500) {
      lastError = new Error(`OpenAI ${status}: ${shortError(text)}`)
      await sleep(800 * Math.pow(2, attempt) + Math.floor(Math.random() * 300))
      continue
    }
    throw new Error(`OpenAI ${status}: ${shortError(text)}`)
  }
  throw lastError || new Error('OpenAI request failed')
}

async function translateWithFallback(args) {
  try {
    return { data: await chatCompletion({ ...args, model: DEFAULT_MODEL }), model: DEFAULT_MODEL }
  } catch (e) {
    if (e.code === 'model' && DEFAULT_MODEL !== FALLBACK_MODEL) {
      console.warn(`Falling back to ${FALLBACK_MODEL}: ${e.message}`)
      return { data: await chatCompletion({ ...args, model: FALLBACK_MODEL }), model: FALLBACK_MODEL }
    }
    throw e
  }
}

function parseBlocksFromCompletion(data) {
  const choice = data?.choices?.[0]
  const content = choice?.message?.content
  if (!content) throw new Error('OpenAI returned an empty reply')
  let parsed
  try {
    parsed = JSON.parse(content)
  } catch {
    if (choice?.finish_reason === 'length') throw new Error('Reply was cut off (too long for one request)')
    throw new Error('OpenAI reply was not valid JSON')
  }
  const map = {}
  for (const b of parsed?.blocks || []) {
    const n = Number(b?.n)
    const text = typeof b?.text === 'string' ? b.text.trim() : ''
    if (Number.isInteger(n) && text) map[n] = text
  }
  return map
}

function buildSystemPrompt({ targetLanguage, count, title, contextBefore }) {
  const lines = [
    `You are a professional subtitle translator. Translate the numbered subtitle blocks into ${targetLanguage}.`,
    '',
    'RULES',
    `1. Return JSON with a "blocks" array holding exactly ${count} items, one per input block, using the same "n" numbers.`,
    '2. Translate every block completely into the target language: dialogue, sound cues in brackets, on-screen text, song lyrics. Never leave a block in the source language.',
    '3. Keep the line breaks of the original block (use \\n where the original breaks a line). Keep music symbols (♪ ♩ ♫ ♬) as they are.',
    '4. Keep names as names; write them the way the target language normally writes foreign names.',
    '5. Match the tone: casual stays casual, formal stays formal. Be consistent with how characters address each other across all blocks.',
    '6. Keep each block short enough to read on screen: prefer natural, compact phrasing over literal length.',
  ]
  if (title) lines.push('', `The film or episode is: ${title}.`)
  if (contextBefore) {
    lines.push('', 'For context only, these are the lines just before this batch. Do NOT translate or return them:', contextBefore)
  }
  return lines.join('\n')
}

function formatBatch(blocks, indices) {
  return indices.map(i => `[${i + 1}]\n${blocks[i].text}`).join('\n\n')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { srtContent, targetLanguage, contextBefore, title } = req.body || {}
  if (!srtContent || !targetLanguage) return res.status(400).json({ error: 'srtContent and targetLanguage required' })

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  if (!OPENAI_API_KEY) return res.status(500).json({ error: 'Translation is not configured on the server (missing OPENAI_API_KEY)' })

  try {
    // Parse SRT into blocks; multi-line text stays one unit.
    const rawBlocks = String(srtContent).trim().replace(/\r\n/g, '\n').split(/\n\n+/)
    const blocks = rawBlocks.map(block => {
      const lines = block.trim().split('\n')
      const indexLine = lines[0]?.trim()
      const timeLine = lines[1]?.trim() || ''
      const text = lines.slice(2).join('\n').trim()
      return { index: indexLine, time: timeLine, text }
    }).filter(b => b.time.includes('-->') && b.text)

    if (!blocks.length) throw new Error('No subtitle blocks found')

    const allIndices = blocks.map((_, i) => i)
    const safeTitle = typeof title === 'string' ? title.slice(0, 200) : ''
    const systemPrompt = buildSystemPrompt({
      targetLanguage,
      count: blocks.length,
      title: safeTitle,
      contextBefore: typeof contextBefore === 'string' ? contextBefore.slice(0, 1500) : '',
    })

    const first = await translateWithFallback({
      apiKey: OPENAI_API_KEY,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: formatBatch(blocks, allIndices) },
      ],
      maxOutputTokens: 16000,
    })
    const translationMap = parseBlocksFromCompletion(first.data)
    let modelUsed = first.model

    // Targeted retry for anything the model skipped.
    let missing = allIndices.filter(i => !translationMap[i + 1])
    if (missing.length > 0 && missing.length <= MAX_RETRY_BLOCKS) {
      try {
        const retry = await translateWithFallback({
          apiKey: OPENAI_API_KEY,
          messages: [
            { role: 'system', content: buildSystemPrompt({ targetLanguage, count: missing.length, title: safeTitle, contextBefore: '' }) },
            { role: 'user', content: formatBatch(blocks, missing) },
          ],
          maxOutputTokens: 8000,
        })
        Object.assign(translationMap, parseBlocksFromCompletion(retry.data))
        modelUsed = retry.model
      } catch (e) {
        console.error('Retry for missing blocks failed:', e.message)
      }
      missing = allIndices.filter(i => !translationMap[i + 1])
    }

    const result = blocks.map((orig, i) => {
      const translated = translationMap[i + 1] || orig.text
      return `${orig.index}\n${orig.time}\n${translated}`
    }).join('\n\n') + '\n'

    return res.status(200).json({
      content: result,
      blocksTranslated: blocks.length - missing.length,
      missingCount: missing.length,
      missing: missing.map(i => i + 1),
      model: modelUsed,
    })
  } catch (err) {
    console.error('Translation error:', err)
    return res.status(500).json({ error: err.message })
  }
}
