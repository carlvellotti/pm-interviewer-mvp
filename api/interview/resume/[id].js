import path from 'path';
import fs from 'fs';
import os from 'os';

const tempStorageRoot = path.join(os.tmpdir(), 'interview-prep');

export default async function handler(req, res) {
  const { method, query } = req;
  const { id } = query;

  try {
    if (method === 'DELETE') {
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'Resume reference required.' });
      }
      const resumePath = path.join(tempStorageRoot, path.basename(id));
      if (fs.existsSync(resumePath)) {
        fs.unlinkSync(resumePath);
      }
      return res.status(204).send();
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Resume delete error:', error);
    res.status(500).json({ error: 'Failed to delete resume file.' });
  }
}
