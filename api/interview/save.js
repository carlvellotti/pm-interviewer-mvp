import { saveInterview } from '../../server/interviewStore.js';

export default async function handler(req, res) {
  const { method, body } = req;

  try {
    if (method === 'POST') {
      const {
        persona,
        difficulty,
        resumeFilename,
        jdSummary,
        questionStack,
        transcript,
        summary,      // OLD format (deprecated)
        evaluation,   // NEW format
        metadata,
        title
      } = body ?? {};

      // Support both old and new formats
      const evaluationData = evaluation || summary || { summary: 'No evaluation provided', strengths: [], improvements: [] };

      const interview = saveInterview({
        persona,
        difficulty,
        resumeFilename,
        jdSummary,
        questionStack,
        transcript: transcript || [],
        evaluation: evaluationData,
        metadata: metadata || { persona, difficulty, resumeFilename, jdSummary, questionStack },
        title: title || null
      });

      return res.json(interview);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Save interview error:', error);
    res.status(500).json({ error: 'Failed to save interview.' });
  }
}
