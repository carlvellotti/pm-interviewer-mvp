import { getUserCategoryById, updateUserCategory, deleteUserCategory } from '../../server/interviewStore.js';

const USER_PLACEHOLDER_ID = 'local';

export default async function handler(req, res) {
  const { method, query, body } = req;
  const { id } = query;

  try {
    if (method === 'PATCH') {
      const { title, questions } = body ?? {};
      const category = getUserCategoryById(id, USER_PLACEHOLDER_ID);
      if (!category) {
        return res.status(404).json({ error: 'Category not found.' });
      }
      const updated = updateUserCategory({ id, userId: USER_PLACEHOLDER_ID, title, questions });
      return res.json(updated);
    }

    if (method === 'DELETE') {
      deleteUserCategory(id, USER_PLACEHOLDER_ID);
      return res.status(204).send();
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Category operation error:', error);
    res.status(500).json({ error: 'Failed to process category.' });
  }
}
