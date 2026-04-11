// api/trigger-job.js
// Vercel serverless function - called by frontend after job is inserted
// This immediately calls the Supabase edge function to start processing

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { job_id } = req.body
  if (!job_id) return res.status(400).json({ error: 'job_id required' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/transcribe`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ job_id }),
    })

    const data = await response.json()
    return res.status(200).json(data)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
