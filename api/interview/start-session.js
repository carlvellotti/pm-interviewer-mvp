import { OpenAI } from 'openai';
import path from 'path';
import fs from 'fs';
import os from 'os';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';

const REALTIME_MODEL = process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';
const REALTIME_VOICE = process.env.REALTIME_VOICE || 'alloy';

const tempStorageRoot = path.join(os.tmpdir(), 'interview-prep');

const personas = {
  easy: {
    id: 'easy',
    name: 'Supportive Coach',
    voice: 'alloy',
    instructions: `You are a warm, encouraging interview coach helping candidates practice common behavioral questions in a low-pressure setting. Your goal is to build confidence and help them articulate their experiences clearly. Be patient, ask gentle follow-up questions, and offer reassurance. Keep the tone conversational and supportive.`,
    turnDetection: { silenceDurationMs: 1300 }
  },
  medium: {
    id: 'medium',
    name: 'Balanced Interviewer',
    voice: 'verse',
    instructions: `You are a professional interviewer conducting a realistic practice session. Ask clear behavioral questions, listen actively, and probe for details when answers feel incomplete or vague. Maintain a neutral, respectful tone—neither overly warm nor intimidating. Keep the conversation focused and efficient.`,
    turnDetection: { silenceDurationMs: 1100 }
  },
  hard: {
    id: 'hard',
    name: 'Senior Bar Raiser',
    voice: 'sage',
    instructions: `You are a senior-level interviewer known for maintaining a high bar. Ask probing follow-up questions and challenge vague or surface-level answers. Expect candidates to provide specific examples with clear impact and data. Maintain a direct, no-nonsense tone. Be brief in your responses and move quickly between questions.`,
    turnDetection: { silenceDurationMs: 1050 }
  }
};

function resolvePersona(key) {
  return personas[key] ?? personas['medium'];
}

function buildSystemPrompt(persona, questionList, resumeText, jdSummary) {
  const questionsText = questionList.map((q, i) => `${i + 1}. ${q.prompt || q.text}`).join('\n');
  let prompt = `${persona.instructions}\n\nAsk the following questions in order:\n${questionsText}\n\nAfter you've asked all questions and received answers, say "INTERVIEW_COMPLETE" to signal the end.`;
  if (resumeText) {
    prompt += `\n\n--- Candidate Resume ---\n${resumeText}\n--- End Resume ---`;
  }
  if (jdSummary) {
    prompt += `\n\n--- Job Description Summary ---\n${jdSummary}\n--- End Job Description Summary ---`;
  }
  return prompt;
}

async function extractTextFromResume(filePath, originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  if (ext === '.txt') {
    return fs.readFileSync(filePath, 'utf8');
  }
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value || '';
  }
  if (ext === '.doc') {
    const extractor = new WordExtractor();
    const extracted = await extractor.extract(filePath);
    return extracted.getBody();
  }
  throw new Error(`Unsupported file extension: ${ext}`);
}

let openaiInstance;
function getOpenAI() {
  if (!openaiInstance) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('Missing OPENAI_API_KEY environment variable');
    }
    openaiInstance = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiInstance;
}

export default async function handler(req, res) {
  const { method, body } = req;

  try {
    if (method === 'POST') {
      const { questionStack, difficulty, resumeRef, jdSummary } = body ?? {};

      const persona = resolvePersona(difficulty);
      const questionList = Array.isArray(questionStack) && questionStack.length > 0
        ? questionStack
        : [];

      let resumeText = '';
      if (resumeRef && typeof resumeRef === 'string') {
        const resumePath = path.join(tempStorageRoot, path.basename(resumeRef));
        if (fs.existsSync(resumePath)) {
          try {
            resumeText = await extractTextFromResume(resumePath, resumeRef);
          } catch (err) {
            console.error('Error reading resume:', err);
          }
        }
      }

      const systemPrompt = buildSystemPrompt(persona, questionList, resumeText, jdSummary);

      const sessionBody = {
        session: {
          type: 'realtime',
          model: REALTIME_MODEL,
          instructions: systemPrompt,
          audio: {
            input: {
              transcription: {
                model: 'gpt-4o-mini-transcribe',
                language: 'en'
              },
              turn_detection: {
                type: 'server_vad',
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: persona.turnDetection?.silenceDurationMs || 800
              }
            },
            output: { voice: persona.voice || REALTIME_VOICE }
          }
        }
      };

      const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(sessionBody)
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        console.error('Failed to create realtime session:', payload);
        return res.status(500).json({ error: 'Failed to create realtime session.' });
      }

      const clientSecret = payload?.client_secret?.value || payload?.value;
      if (!clientSecret) {
        console.error('Unexpected realtime token response:', payload);
        return res.status(500).json({ error: 'Realtime token missing in response.' });
      }

      return res.json({
        session: {
          clientSecret,
          expiresAt: payload?.client_secret?.expires_at || payload?.expires_at || null,
          model: REALTIME_MODEL,
          instructions: systemPrompt
        },
        questionStack: questionList,
        persona,
        resume: resumeText ? { text: resumeText } : null,
        jdSummary
      });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Start session error:', error);
    res.status(500).json({ error: 'Failed to start session.' });
  }
}
