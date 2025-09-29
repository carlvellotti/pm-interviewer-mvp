import { listUserCategories, saveUserCategory } from '../server/interviewStore.js';

const USER_PLACEHOLDER_ID = 'local';

export default async function handler(req, res) {
  const { method, body } = req;

  try {
    if (method === 'GET') {
      const categories = listUserCategories(USER_PLACEHOLDER_ID);
      return res.json({ categories });
    }

    if (method === 'POST') {
      const { title, questions } = body ?? {};
      if (!title?.trim() || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ error: 'Title and questions required.' });
      }
      const category = saveUserCategory({ userId: USER_PLACEHOLDER_ID, title, questions });
      return res.json(category);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Categories error:', error);
    res.status(500).json({ error: 'Failed to process categories.' });
  }
}
