import { listInterviews, getInterviewById } from '../../server/interviewStore.js';

export default async function handler(req, res) {
  const { method, query } = req;

  try {
    if (method === 'GET') {
      // If there's an ID in the query, get single interview
      if (query.id) {
        const interview = getInterviewById(query.id);
        if (!interview) {
          return res.status(404).json({ error: 'Interview not found.' });
        }
        return res.json(interview);
      }
      
      // Otherwise list all interviews
      const interviews = listInterviews();
      return res.json({ interviews });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Interview history error:', error);
    res.status(500).json({ error: 'Failed to load history.' });
  }
}
