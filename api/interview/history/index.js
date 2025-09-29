import { listInterviews } from '../../../server/interviewStore.js';

export default async function handler(req, res) {
  const { method } = req;

  try {
    if (method === 'GET') {
      const interviews = listInterviews();
      return res.json({ interviews });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Interview history list error:', error);
    res.status(500).json({ error: 'Failed to load history.' });
  }
}
