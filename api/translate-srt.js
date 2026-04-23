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

    // Send one entry per BLOCK — multi-line text joined with \n inside block
    const batch = blocks.map(b => b.text).join(`\n${BLOCK_DELIMITER}\n`)

    const systemPrompt = `You are an expert professional subtitle translator specializing in ${targetLanguage}.

STRICT RULES — no exceptions:
1. Translate EVERY block into ${targetLanguage}. Every single block. No exceptions.
2. Blocks are separated by the delimiter: ${BLOCK_DELIMITER}
3. Return ONLY the translated blocks separated by ${BLOCK_DELIMITER}. No explanations, no commentary, no preamble, no markdown.
4. Keep the EXACT same number of blocks as the input. Never merge, split, add, or remove blocks.
5. If a block has multiple lines separated by newlines, preserve the same number of lines in the translation.
6. Translate ALL content — dialogue, stage directions [like this], sound cues, speaker labels, everything.
7. NEVER leave any block in English or any source language. Every block must be in ${targetLanguage}.
8. Blocks containing only symbols (♪ ♩ ♫ ♬) — keep those symbols exactly as-is.
9. Proper nouns and names — transliterate into ${targetLanguage} script if applicable, otherwise keep as-is.

SELF-CHECK before returning:
- Count your output blocks — must equal input block count exactly.
- If ANY block is still in English, translate it now.
- Only return the final fully-translated result.`

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

    // Split back into blocks by delimiter
    const translatedBlocks = translatedText
      .split(BLOCK_DELIMITER)
      .map(t => t.trim())
      .filter(t => t.length > 0)

    // Pad if GPT returned fewer blocks
    while (translatedBlocks.length < blocks.length) translatedBlocks.push('')

    // Rebuild SRT — one translated block per original block
    const result = blocks.map((orig, i) => {
      const translatedText = translatedBlocks[i] || orig.text
      return `${orig.index}\n${orig.time}\n${translatedText}`
    }).join('\n\n') + '\n'

    return res.status(200).json({
      content: result,
      blocksTranslated: blocks.length,
    })

  } catch (err) {
    console.error('Translation error:', err)
    return res.status(500).json({ error: err.message })
  }
}
