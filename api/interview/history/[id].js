import { getInterviewById } from '../../../server/interviewStore.js';

export default async function handler(req, res) {
  const { method, query } = req;
  const { id } = query;

  try {
    if (method === 'GET') {
      const interview = getInterviewById(id);
      if (!interview) {
        return res.status(404).json({ error: 'Interview not found.' });
      }
      return res.json(interview);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Interview detail error:', error);
    res.status(500).json({ error: 'Failed to load interview.' });
  }
}
