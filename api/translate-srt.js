export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { srtContent, targetLanguage, targetLanguageCode } = req.body
  if (!srtContent || !targetLanguage) return res.status(400).json({ error: 'srtContent and targetLanguage required' })

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  const BLOCK_DELIMITER = '==='

  try {
    // Parse SRT into blocks — preserve multi-line text as single unit
    const rawBlocks = srtContent.trim().replace(/\r\n/g, '\n').split(/\n\n+/)
    const blocks = rawBlocks.map(block => {
      const lines = block.trim().split('\n')
      const indexLine = lines[0]?.trim()
      const timeLine = lines[1]?.trim() || ''
      const text = lines.slice(2).join('\n').trim()
      return { index: indexLine, time: timeLine, text }
    }).filter(b => b.time.includes('-->') && b.text)

    if (!blocks.length) throw new Error('No subtitle blocks found')

    // Number each block explicitly so GPT can reference them
    const numbered = blocks.map((b, i) => `[${i + 1}] ${b.text}`)
    const batch = numbered.join(`\n${BLOCK_DELIMITER}\n`)

    const systemPrompt = `You are an expert professional subtitle translator specializing in ${targetLanguage}.

INPUT FORMAT: Each block starts with [N] where N is the block number, followed by the text to translate.
OUTPUT FORMAT: Return each translated block starting with [N] separated by ${BLOCK_DELIMITER}

STRICT RULES:
1. Translate EVERY block. Every single one. No exceptions.
2. Keep the [N] number prefix on each block exactly as given.
3. Return EXACTLY ${blocks.length} blocks — same count as input.
4. Preserve newlines within blocks if the original has them.
5. Translate ALL content — dialogue, stage directions, sound cues, everything.
6. NEVER leave any block in English. Every block must be in ${targetLanguage}.
7. Symbols only (♪ ♩ ♫ ♬) — keep as-is.
8. Proper nouns/names — transliterate into ${targetLanguage} script if applicable.

SELF-CHECK: Count your output blocks. If count ≠ ${blocks.length}, find the missing ones and add them before returning.`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: batch }
        ],
        temperature: 0.1,
        max_tokens: 16000,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`OpenAI error: ${err}`)
    }

    const data = await response.json()
    const translatedText = data.choices[0].message.content

    // Parse numbered blocks from response
    const rawTranslated = translatedText.split(BLOCK_DELIMITER).map(t => t.trim()).filter(t => t)
    
    // Build a map by block number — handles missing/reordered blocks
    const translationMap = {}
    for (const chunk of rawTranslated) {
      const match = chunk.match(/^\[(\d+)\]\s*([\s\S]*)/)
      if (match) {
        const num = parseInt(match[1])
        const text = match[2].trim()
        translationMap[num] = text
      }
    }

    // Rebuild SRT — use translation map by number, fall back to re-requesting missing ones
    const missingIndices = []
    blocks.forEach((_, i) => {
      if (!translationMap[i + 1]) missingIndices.push(i)
    })

    // If we have missing blocks, do a targeted retry for just those blocks
    if (missingIndices.length > 0 && missingIndices.length <= 10) {
      const retryBatch = missingIndices
        .map(i => `[${i + 1}] ${blocks[i].text}`)
        .join(`\n${BLOCK_DELIMITER}\n`)

      try {
        const retryResp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: `Translate each block into ${targetLanguage}. Keep [N] prefix. Separate blocks with ${BLOCK_DELIMITER}.` },
              { role: 'user', content: retryBatch }
            ],
            temperature: 0.1,
            max_tokens: 4000,
          }),
        })
        if (retryResp.ok) {
          const retryData = await retryResp.json()
          const retryText = retryData.choices[0].message.content
          for (const chunk of retryText.split(BLOCK_DELIMITER).map(t => t.trim()).filter(t => t)) {
            const match = chunk.match(/^\[(\d+)\]\s*([\s\S]*)/)
            if (match) translationMap[parseInt(match[1])] = match[2].trim()
          }
        }
      } catch (e) {
        console.error('Retry failed:', e)
      }
    }

    // Rebuild SRT
    const result = blocks.map((orig, i) => {
      const translated = translationMap[i + 1] || orig.text
      return `${orig.index}\n${orig.time}\n${translated}`
    }).join('\n\n') + '\n'

    return res.status(200).json({
      content: result,
      blocksTranslated: blocks.length,
      missingCount: missingIndices.length,
    })

  } catch (err) {
    console.error('Translation error:', err)
    return res.status(500).json({ error: err.message })
  }
}
