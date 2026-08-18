// Translates one chunk of SRT (the page sends 80-cue chunks) with OpenAI.
//
// Model: OPENAI_MODEL env var, default gpt-4.1-mini. If that model is not available to the
// key, gpt-4o-mini is tried once as a fallback. Output is requested as strict JSON
// ({ blocks: [{ n, text }] }) so block numbering cannot drift; anything still missing gets
// one targeted retry, and whatever is left keeps the original text and is counted in
// missingCount so the page can tell the user.

import { requireAuth } from './_auth.js'

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
const FALLBACK_MODEL = 'gpt-4o-mini'
const MAX_RETRY_BLOCKS = 200
// Retries go out in small batches: a sentence split across cues has far less room to be merged
// into one when only a handful of blocks are in front of the model at once.
const RETRY_BATCH_SIZE = 8

// Each returned block echoes the first words of the block it claims to be translating.
//
// Without it, a whole class of failure passes silently. A sentence often runs across two cues;
// the model translates it as one sentence, returns one block where two were asked for, and every
// later block in the chunk carries the line before it. The numbering still looks perfect. In a
// real 1,322-line film this put the wrong Thai line on roughly forty cues. The echo makes the
// mistake checkable, so those blocks can be asked for again.
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
              echo: { type: 'string', description: 'The first few words of the SOURCE block, copied exactly, untranslated.' },
              text: { type: 'string' },
            },
            required: ['n', 'echo', 'text'],
            additionalProperties: false,
          },
        },
      },
      required: ['blocks'],
      additionalProperties: false,
    },
  },
}

// Compare an echoed opening against the source block it claims to come from. Deliberately
// forgiving: it only has to prove which block was being translated, not be a perfect copy.
const wordsOf = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)

// Exported for tests; Vercel only ever calls the default export.
export function echoMatches(echo, sourceText) {
  const want = wordsOf(sourceText)
  const got = wordsOf(echo)
  if (want.length < 2) return true // symbols, numbers or a single word prove nothing either way
  if (got.length < 1) return false
  const need = Math.min(2, want.length)
  return want.slice(0, need).every((w, i) => got[i] === w)
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

// Returns { map, rejected }: translations keyed by block number, and the numbers whose echo
// showed they were translating a different block than they claimed.
export function parseBlocksFromCompletion(data, blocks) {
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
  const rejected = []
  for (const b of parsed?.blocks || []) {
    const n = Number(b?.n)
    const text = typeof b?.text === 'string' ? b.text.trim() : ''
    if (!Number.isInteger(n) || !text) continue
    const source = blocks && blocks[n - 1]
    if (source && !echoMatches(b?.echo, source.text)) { rejected.push(n); continue }
    map[n] = text
  }
  return { map, rejected }
}

// A sentence spanning two cues sometimes comes back whole in the first block and correctly in
// the second, so its tail shows twice: one cue displays a line that belongs to the next.
//
// Distinguishable from dialogue that genuinely repeats. Real repeats ("- Make way!" answered by
// "- Make way!") have a source block with the same number of lines as its translation. This
// artifact leaves the block with MORE lines than its source, and the surplus is exactly what the
// following block already says.
export function dropDuplicatedTails(blocks, map) {
  let removed = 0
  for (let i = 0; i + 1 < blocks.length; i++) {
    const current = map[i + 1], next = map[i + 2]
    if (!current || !next) continue
    const currentLines = current.split('\n')
    const sourceLines = String(blocks[i].text || '').split('\n')
    if (currentLines.length <= sourceLines.length) continue

    const nextLines = new Set(next.split('\n').map(l => l.trim()).filter(Boolean))
    // Never touch the first line: whatever else is true, it belongs to this block.
    const kept = currentLines.filter((line, idx) => !(idx > 0 && nextLines.has(line.trim())))
    if (kept.length && kept.length < currentLines.length) {
      removed += currentLines.length - kept.length
      map[i + 1] = kept.join('\n')
    }
  }
  return removed
}

function buildSystemPrompt({ targetLanguage, count, title, contextBefore }) {
  const lines = [
    `You are a professional subtitle translator. Translate the numbered subtitle blocks into ${targetLanguage}.`,
    '',
    'RULES',
    `1. Return JSON with a "blocks" array holding exactly ${count} items, one per input block, using the same "n" numbers.`,
    '2. For each block set "echo" to the first three or four words of that block\'s SOURCE text, copied exactly and left untranslated. It is a check that each translation is attached to the right block.',
    // The failure this prevents: one sentence spread over two cues, translated as a single
    // sentence, so every later block in the batch carries the line before it.
    '3. A sentence is often split across two or three blocks. Translate the part that belongs to each block and leave the split exactly where it is. Never merge blocks together, never move wording from one block into another, and never leave a block empty because you already said it in a previous block.',
    '4. Translate every block completely into the target language: dialogue, sound cues in brackets, on-screen text, song lyrics. Never leave a block in the source language.',
    '5. Keep the line breaks of the original block (use \\n where the original breaks a line). Keep music symbols (♪ ♩ ♫ ♬) as they are.',
    '6. Keep names as names; write them the way the target language normally writes foreign names.',
    '7. Match the tone: casual stays casual, formal stays formal. Be consistent with how characters address each other across all blocks.',
    '8. Keep each block short enough to read on screen: prefer natural, compact phrasing over literal length.',
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

async function handler(req, res) {
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
    const firstPass = parseBlocksFromCompletion(first.data, blocks)
    const translationMap = firstPass.map
    let modelUsed = first.model
    let misaligned = firstPass.rejected.length

    // Blocks the model skipped, plus blocks whose echo showed they were translating something
    // else. Both are re-requested in small batches, where a sentence spanning cues has far less
    // room to be merged than in a batch of eighty.
    let missing = allIndices.filter(i => !translationMap[i + 1])
    if (missing.length > 0 && missing.length <= MAX_RETRY_BLOCKS) {
      const batches = []
      for (let i = 0; i < missing.length; i += RETRY_BATCH_SIZE) batches.push(missing.slice(i, i + RETRY_BATCH_SIZE))
      for (const batch of batches) {
        try {
          const retry = await translateWithFallback({
            apiKey: OPENAI_API_KEY,
            messages: [
              { role: 'system', content: buildSystemPrompt({ targetLanguage, count: batch.length, title: safeTitle, contextBefore: '' }) },
              { role: 'user', content: formatBatch(blocks, batch) },
            ],
            maxOutputTokens: 4000,
          })
          const again = parseBlocksFromCompletion(retry.data, blocks)
          Object.assign(translationMap, again.map)
          misaligned += again.rejected.length
          modelUsed = retry.model
        } catch (e) {
          console.error('Retry for missing blocks failed:', e.message)
        }
      }
      missing = allIndices.filter(i => !translationMap[i + 1])
    }

    const duplicatedLines = dropDuplicatedTails(blocks, translationMap)

    if (misaligned || duplicatedLines) {
      console.log(`Rejected ${misaligned} block(s) whose echo did not match their source; trimmed ${duplicatedLines} duplicated line(s); ${missing.length} still untranslated after retries.`)
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
      misalignedCount: misaligned,
      duplicatedLines,
      model: modelUsed,
    })
  } catch (err) {
    console.error('Translation error:', err)
    return res.status(500).json({ error: err.message })
  }
}

export default requireAuth(handler)
