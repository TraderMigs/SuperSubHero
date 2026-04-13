export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { srtContent, targetLanguage, targetLanguageCode } = req.body
  if (!srtContent || !targetLanguage) return res.status(400).json({ error: 'srtContent and targetLanguage required' })

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY

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

    const DELIMITER = '|||'
    const batch = textLines.map(l => l.text).join(`\n${DELIMITER}\n`)

    const systemPrompt = `You are an expert professional subtitle translator specializing in ${targetLanguage}.

STRICT RULES — follow every one without exception:
1. Translate EVERY single line into ${targetLanguage}. No exceptions.
2. Lines are separated by the delimiter: ${DELIMITER}
3. Return ONLY the translated lines separated by ${DELIMITER}. Nothing else. No explanations, no commentary, no preamble.
4. Keep the EXACT same number of lines as the input. Never merge, split, add, or remove lines.
5. Translate ALL content including: dialogue, stage directions like [Door slams], sound cues like [Indistinct conversation], music notes like ♪, speaker labels, everything.
6. Never leave any line in English or any other language. Every line must be in ${targetLanguage}.
7. If a line contains only symbols (♪, ♩, ♫) keep those symbols as-is.

SELF-CHECK PROCESS — before returning your answer:
- Step 1: Translate all lines to ${targetLanguage}
- Step 2: Review every translated line — flag any line still in English or another language
- Step 3: Fix every flagged line
- Step 4: Confirm all lines are in ${targetLanguage}
- Step 5: Return ONLY the final corrected translations separated by ${DELIMITER}`

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
    const translated = data.choices[0].message.content
      .split(DELIMITER)
      .map(t => t.trim())
      .filter(t => t.length > 0)

    while (translated.length < textLines.length) translated.push('')
    const trimmedTranslated = translated.slice(0, textLines.length)

    const result = [...lines]
    textLines.forEach((item, i) => {
      result[item.idx] = trimmedTranslated[i] || ''
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
