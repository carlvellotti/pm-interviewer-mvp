import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, '..', 'data');
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

export function __getDatabasePath() {
  return databasePath;
}


