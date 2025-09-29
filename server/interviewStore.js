import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use /tmp on Vercel (ephemeral), otherwise use persistent local storage
const dataDir = process.env.VERCEL 
  ? '/tmp' 
  : path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const databasePath = path.join(dataDir, 'interviews.db');
const db = new Database(databasePath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS interviews (
    id TEXT PRIMARY KEY,
    title TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    metadata TEXT,
    transcript TEXT NOT NULL,
    evaluation TEXT NOT NULL,
    evaluation_summary TEXT
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS user_question_categories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    questions TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

const insertInterviewStatement = db.prepare(`
  INSERT INTO interviews (
    id,
    title,
    created_at,
    updated_at,
    metadata,
    transcript,
    evaluation,
    evaluation_summary
  ) VALUES (@id, @title, @created_at, @updated_at, @metadata, @transcript, @evaluation, @evaluation_summary)
`);

const updateInterviewStatement = db.prepare(`
  UPDATE interviews
    SET
      title = @title,
      updated_at = @updated_at,
      metadata = @metadata,
      transcript = @transcript,
      evaluation = @evaluation,
      evaluation_summary = @evaluation_summary
    WHERE id = @id
`);

const selectInterviewStatement = db.prepare(
  `SELECT id, title, created_at, updated_at, metadata, transcript, evaluation, evaluation_summary FROM interviews WHERE id = ?`
);

const listInterviewsStatement = db.prepare(
  `SELECT id, title, created_at, updated_at, evaluation_summary FROM interviews ORDER BY datetime(created_at) DESC`
);

const deleteInterviewStatement = db.prepare('DELETE FROM interviews WHERE id = ?');

const listCategoriesStatement = db.prepare(
  `SELECT id, user_id, title, questions, created_at, updated_at FROM user_question_categories WHERE user_id = ? ORDER BY datetime(created_at) ASC`
);

const getCategoryStatement = db.prepare(
  `SELECT id, user_id, title, questions, created_at, updated_at FROM user_question_categories WHERE id = ? AND user_id = ?`
);

const insertCategoryStatement = db.prepare(`
  INSERT INTO user_question_categories (
    id,
    user_id,
    title,
    questions,
    created_at,
    updated_at
  ) VALUES (@id, @user_id, @title, @questions, @created_at, @updated_at)
`);

const updateCategoryStatement = db.prepare(`
  UPDATE user_question_categories
    SET
      title = @title,
      questions = @questions,
      updated_at = @updated_at
    WHERE id = @id AND user_id = @user_id
`);

const deleteCategoryStatement = db.prepare(
  `DELETE FROM user_question_categories WHERE id = ? AND user_id = ?`
);

function serialize(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

function deserialize(value) {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

export function listInterviews() {
  return listInterviewsStatement.all().map(row => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    evaluationSummary: row.evaluation_summary
  }));
}

export function getInterviewById(id) {
  const row = selectInterviewStatement.get(id);
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: deserialize(row.metadata),
    transcript: deserialize(row.transcript) ?? [],
    evaluation: deserialize(row.evaluation),
    evaluationSummary: row.evaluation_summary ?? null
  };
}

export function saveInterview({
  id,
  title = null,
  transcript,
  evaluation,
  metadata,
  createdAt,
  updatedAt
}) {
  const now = new Date().toISOString();
  const recordId = id || randomUUID();
  const created = createdAt || now;
  const updated = updatedAt || now;

  const payload = {
    id: recordId,
    title,
    created_at: created,
    updated_at: updated,
    metadata: serialize(metadata),
    transcript: serialize(transcript ?? []),
    evaluation: serialize(evaluation ?? null),
    evaluation_summary: evaluation?.summary ?? null
  };

  const existing = selectInterviewStatement.get(recordId);
  if (existing) {
    updateInterviewStatement.run(payload);
  } else {
    insertInterviewStatement.run(payload);
  }

  return getInterviewById(recordId);
}

export function deleteInterview(id) {
  deleteInterviewStatement.run(id);
}

function normaliseQuestions(questions) {
  if (!Array.isArray(questions)) {
    return [];
  }
  return questions
    .map(question => {
      if (!question || typeof question !== 'object') return null;
      const id = typeof question.id === 'string' && question.id.trim().length > 0
        ? question.id.trim()
        : randomUUID();
      const text = typeof question.text === 'string' ? question.text.trim() : '';
      const source = typeof question.source === 'string' ? question.source.trim() : null;
      const categoryId = typeof question.categoryId === 'string' ? question.categoryId.trim() : null;
      const estimatedDuration = Number.isFinite(question.estimatedDuration)
        ? Number(question.estimatedDuration)
        : null;
      if (!text) return null;
      return {
        id,
        text,
        source,
        categoryId,
        estimatedDuration
      };
    })
    .filter(Boolean);
}

export function listUserCategories(userId) {
  const rows = listCategoriesStatement.all(userId);
  return rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    title: row.title,
    questions: normaliseQuestions(deserialize(row.questions)),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export function getUserCategoryById(id, userId) {
  const row = getCategoryStatement.get(id, userId);
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    questions: normaliseQuestions(deserialize(row.questions)),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function saveUserCategory({ id, userId, title, questions }) {
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new Error('Category title is required');
  }
  const now = new Date().toISOString();
  const categoryId = id || randomUUID();
  const storedQuestions = serialize(normaliseQuestions(questions));
  const payload = {
    id: categoryId,
    user_id: userId,
    title: title.trim(),
    questions: storedQuestions,
    created_at: now,
    updated_at: now
  };

  const existing = getCategoryStatement.get(categoryId, userId);
  if (existing) {
    payload.created_at = existing.created_at;
    updateCategoryStatement.run(payload);
  } else {
    insertCategoryStatement.run(payload);
  }

  return getUserCategoryById(categoryId, userId);
}

export function updateUserCategory({ id, userId, title, questions }) {
  const existing = getCategoryStatement.get(id, userId);
  if (!existing) return null;
  const now = new Date().toISOString();
  const updatedTitle = typeof title === 'string' && title.trim().length > 0 ? title.trim() : existing.title;
  const updatedQuestions = Array.isArray(questions)
    ? normaliseQuestions(questions)
    : normaliseQuestions(deserialize(existing.questions));
  const payload = {
    id,
    user_id: userId,
    title: updatedTitle,
    questions: serialize(updatedQuestions),
    created_at: existing.created_at,
    updated_at: now
  };
  updateCategoryStatement.run(payload);
  return getUserCategoryById(id, userId);
}

export function deleteUserCategory(id, userId) {
  deleteCategoryStatement.run(id, userId);
}

export function __getDatabasePath() {
  return databasePath;
}


