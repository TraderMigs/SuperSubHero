export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { srtContent, targetLanguage, targetLanguageCode } = req.body
  if (!srtContent || !targetLanguage) return res.status(400).json({ error: 'srtContent and targetLanguage required' })

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY
  const CHUNK_SIZE = 150
  const DELIMITER = '|||'

  try {
    const lines = srtContent.split('\n')
    const textLines = []

    lines.forEach((line, idx) => {
      const trimmed = line.trim()
      const isIndex = /^\d+$/.test(trimmed)
      const isTimestamp = /-->/.test(trimmed)
      const isEmpty = trimmed === ''
      if (!isIndex && !isTimestamp && !isEmpty) {
        textLines.push({ idx, text: trimmed })
      }
    })

    if (!textLines.length) throw new Error('No text found to translate')

    const systemPrompt = `You are an expert professional subtitle translator specializing in ${targetLanguage}.

STRICT RULES — no exceptions:
1. Translate EVERY single line into ${targetLanguage}. Every line. No exceptions.
2. Lines are separated by the delimiter: ${DELIMITER}
3. Return ONLY the translated lines separated by ${DELIMITER}. No explanations, no commentary, no preamble, no markdown.
4. Keep the EXACT same number of lines as the input. Never merge, split, add, or remove lines.
5. Translate ALL content — dialogue, stage directions [like this], sound cues, speaker labels, everything.
6. NEVER leave any line in English or any source language. Every single line must be in ${targetLanguage}.
7. Lines containing only symbols (♪ ♩ ♫ ♬) — keep those symbols exactly as-is.
8. If a line is a name or untranslatable proper noun, transliterate it into ${targetLanguage} script if applicable, otherwise keep it.

SELF-CHECK before returning:
- Scan every line — if ANY line is still in English or the source language, translate it now.
- Only return the final fully-translated result.`

    // Split textLines into chunks of CHUNK_SIZE
    const chunks = []
    for (let i = 0; i < textLines.length; i += CHUNK_SIZE) {
      chunks.push(textLines.slice(i, i + CHUNK_SIZE))
    }

    // Translate each chunk sequentially
    const allTranslated = []

    for (const chunk of chunks) {
      const batch = chunk.map(l => l.text).join(`\n${DELIMITER}\n`)

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
          max_tokens: 8000,
        }),
      })

      if (!response.ok) {
        const err = await response.text()
        throw new Error(`OpenAI error: ${err}`)
      }

      const data = await response.json()
      const chunkTranslated = data.choices[0].message.content
        .split(DELIMITER)
        .map(t => t.trim())
        .filter(t => t.length > 0)

      // Pad if GPT returned fewer lines than sent
      while (chunkTranslated.length < chunk.length) chunkTranslated.push('')
      allTranslated.push(...chunkTranslated.slice(0, chunk.length))
    }

    // Rebuild SRT with translations
    const result = [...lines]
    textLines.forEach((item, i) => {
      result[item.idx] = allTranslated[i] || ''
    })

    return res.status(200).json({
      content: result.join('\n'),
      linesTranslated: textLines.length,
      chunksProcessed: chunks.length,
    })

  } catch (err) {
    console.error('Translation error:', err)
    return res.status(500).json({ error: err.message })
  }
}
