export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { srtContent, targetLanguage, targetLanguageCode } = req.body
  if (!srtContent || !targetLanguage) return res.status(400).json({ error: 'srtContent and targetLanguage required' })

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY

  try {
    // Parse SRT into blocks — only translate text lines, preserve timestamps and index numbers
    const lines = srtContent.split('\n')
    const textLines = [] // { idx, text }

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

    // Batch translate — send all text lines joined by delimiter
    const DELIMITER = '|||'
    const batch = textLines.map(l => l.text).join(`\n${DELIMITER}\n`)

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
            content: `You are a professional subtitle translator. Translate each line to ${targetLanguage}. Lines are separated by ${DELIMITER}. Return ONLY the translated lines separated by ${DELIMITER}. Keep the exact same number of lines. Never merge or split lines. Do not add any commentary or explanation.`
          },
          {
            role: 'user',
            content: batch
          }
        ],
        temperature: 0.1,
        max_tokens: 4000,
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

    // If count mismatch — pad or trim to match
    while (translated.length < textLines.length) translated.push('')
    const trimmedTranslated = translated.slice(0, textLines.length)

    // Rebuild lines with translations inserted
    const result = [...lines]
    textLines.forEach((item, i) => {
      result[item.idx] = trimmedTranslated[i] || item.text
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
