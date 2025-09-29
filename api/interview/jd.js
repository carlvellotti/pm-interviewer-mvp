export default async function handler(req, res) {
  const { method, body } = req;

  try {
    if (method === 'POST') {
      const { jd } = body ?? {};
      if (!jd || typeof jd !== 'string' || jd.trim().length === 0) {
        return res.status(400).json({ error: 'Job description text required.' });
      }
      return res.json({ summary: jd.trim() });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('JD processing error:', error);
    res.status(500).json({ error: 'Failed to process job description.' });
  }
}
