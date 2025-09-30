import { listInterviews, getInterviewById } from '../../server/interviewStore.js';

export default async function handler(req, res) {
  const { method, query, url } = req;

  try {
    if (method === 'GET') {
      // Check for ID in query parameter first (e.g., ?id=xxx)
      if (query.id) {
        const interview = getInterviewById(query.id);
        if (!interview) {
          return res.status(404).json({ error: 'Interview not found.' });
        }
        return res.json(interview);
      }

      // Check for ID in URL path (e.g., /api/interview/history/xxx)
      const match = url.match(/\/api\/interview\/history\/([^/?]+)/);
      if (match && match[1]) {
        const id = match[1];
        const interview = getInterviewById(id);
        if (!interview) {
          return res.status(404).json({ error: 'Interview not found.' });
        }
        return res.json(interview);
      }

      // No ID - return list
      const interviews = listInterviews();
      return res.json({ interviews });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Interview history error:', error);
    res.status(500).json({ error: 'Failed to load history.' });
  }
}