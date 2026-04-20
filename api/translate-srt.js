export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { srtContent, targetLanguage, targetLanguageCode } = req.body
  if (!srtContent || !targetLanguage) return res.status(400).json({ error: 'srtContent and targetLanguage required' })

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
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

    const batch = textLines.map(l => l.text).join('\n' + DELIMITER + '\n')

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

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: batch }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Anthropic error: ${err}`)
    }

    const data = await response.json()
    const translated = data.content[0].text
      .split(DELIMITER)
      .map(t => t.trim())
      .filter(t => t.length > 0)

    while (translated.length < textLines.length) translated.push('')

    const result = [...lines]
    textLines.forEach((item, i) => {
      result[item.idx] = translated[i] || ''
    })

    return res.status(200).json({
      content: result.join('\n'),
      linesTranslated: textLines.length,
    })

  } catch (err) {
    console.error('Translation error:', err)
    return res.status(500).json({ error: err.message })
  }
}
