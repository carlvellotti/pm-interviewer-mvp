import { evaluationFocus, personas, questionBank, defaultQuestionIds, DEFAULT_DIFFICULTY } from './_lib/config.js';
import { withCors } from './_lib/cors.js';

async function handler(_req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(JSON.stringify({
    questions: questionBank,
    evaluationFocus,
    personas: Object.values(personas).map(persona => ({
      id: persona.id,
      label: persona.label,
      description: persona.description,
      voice: persona.voice
    })),
    defaults: {
      questionIds: defaultQuestionIds,
      difficulty: DEFAULT_DIFFICULTY
    }
  }));
}

export default withCors(handler);

