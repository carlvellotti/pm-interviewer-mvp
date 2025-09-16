import express from 'express';
import cors from 'cors';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PORT = process.env.PORT || 4000;
const REALTIME_MODEL = process.env.REALTIME_MODEL || 'gpt-4o-realtime-preview-2024-12-17';
const REALTIME_VOICE = process.env.REALTIME_VOICE || 'alloy';
const REALTIME_BASE_URL = process.env.REALTIME_BASE_URL || 'https://api.openai.com/v1/realtime/calls';

const app = express();
app.use(cors());
app.use(express.json());

const questionBank = [
  {
    id: 'recent-project',
    prompt: "Tell me about a recent project you're proud of.",
    description: 'Highlights ownership, motivation, and ability to frame accomplishments.'
  },
  {
    id: 'pressure-problem',
    prompt: 'Describe a time you had to solve a difficult problem under pressure.',
    description: 'Surfaces problem-solving process, prioritization, and resilience.'
  },
  {
    id: 'learning-goal',
    prompt: 'What do you want to learn or improve in your next role?',
    description: 'Assesses self-awareness and growth mindset.'
  },
  {
    id: 'feedback-applied',
    prompt: 'Share an example of constructive feedback you received and how you applied it.',
    description: 'Tests coachability and ability to integrate feedback into action.'
  },
  {
    id: 'team-conflict',
    prompt: 'Tell me about a time you worked through a disagreement with a teammate.',
    description: 'Explores collaboration, empathy, and conflict resolution.'
  },
  {
    id: 'leading-change',
    prompt: 'Describe a moment when you had to lead others through change or ambiguity.',
    description: 'Looks for leadership signals and communication under uncertainty.'
  }
];

const questionMap = new Map(questionBank.map(question => [question.id, question]));
const defaultQuestionIds = questionBank.slice(0, 3).map(question => question.id);

const evaluationFocus = [
  'Clear communication and structure',
  'Demonstrating impact with specific examples',
  'Awareness of strengths, gaps, and learning goals'
];

const personas = {
  easy: {
    id: 'easy',
    label: 'Easy',
    description: 'Supportive interviewer who keeps the conversation light and confidence-building.',
    voice: 'alloy',
    systemStyle: 'You are a warm, encouraging mock interviewer helping the candidate warm up. Offer positive reinforcement and keep the stakes low while still covering each core question.',
    guidelineHints: [
      'Use gentle, encouraging language and acknowledge the candidate’s effort.',
      'Ask simple clarifying follow-ups only when you truly need more detail.'
    ],
    turnDetectionOverrides: {
      silence_duration_ms: 1300,
      interrupt_response: false
    }
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    description: 'Balanced interviewer with curious follow-ups and realistic pacing.',
    voice: 'verse',
    systemStyle: 'You are a thoughtful interviewer creating a realistic behavioral interview. Stay professional, probe for depth when answers are vague, and keep the conversation on track.',
    guidelineHints: [
      'Ask evidence-seeking follow-ups when impact or reasoning is unclear.',
      'Maintain a conversational but professional tone.'
    ],
    turnDetectionOverrides: {
      silence_duration_ms: 1100
    }
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    description: 'Skeptical interviewer who stress-tests assumptions and pushes for evidence.',
    voice: 'sage',
    systemStyle: 'You are a demanding interviewer simulating a high-bar panel. Stay respectful but challenge assumptions, press for specifics, and highlight gaps in logic.',
    guidelineHints: [
      'Adopt a skeptical tone—politely question claims that lack evidence.',
      'Use probing follow-ups to surface concrete results, tradeoffs, and personal contribution.'
    ],
    turnDetectionOverrides: {
      silence_duration_ms: 1050,
      interrupt_response: true
    }
  }
};

const DEFAULT_DIFFICULTY = 'medium';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const DEFAULT_TURN_DETECTION = {
  type: 'server_vad',
  threshold: 0.5,
  prefix_padding_ms: 300,
  silence_duration_ms: 1100,
  create_response: true,
  interrupt_response: true
};

function resolveQuestions(questionIds) {
  if (Array.isArray(questionIds) && questionIds.length > 0) {
    const seen = new Set();
    const picked = [];
    for (const id of questionIds) {
      const question = questionMap.get(id);
      if (question && !seen.has(question.id)) {
        picked.push(question);
        seen.add(question.id);
      }
    }
    if (picked.length > 0) {
      return picked;
    }
  }
  return defaultQuestionIds
    .map(id => questionMap.get(id))
    .filter(Boolean);
}

function resolvePersona(key) {
  return personas[key] ?? personas[DEFAULT_DIFFICULTY];
}

function buildInterviewerSystemPrompt(selectedQuestions, focusAreas, persona) {
  const questionsList = selectedQuestions.map((question, index) => `${index + 1}. ${question.prompt}`).join('\n');
  const focusList = focusAreas.map((focus, index) => `${index + 1}. ${focus}`).join('\n');
  const closingReference = selectedQuestions.length > 0 ? `question ${selectedQuestions.length}` : 'the final question';
  const personaGuidelines = Array.isArray(persona?.guidelineHints) ? persona.guidelineHints : [];

  return [
    persona?.systemStyle || 'You are an experienced interviewer guiding a candidate through a conversation.',
    '',
    'Primary questions (ask in order):',
    questionsList,
    '',
    'What the interviewer listens for:',
    focusList,
    '',
    'Guidelines:',
    '- This is a live voice interview—speak clearly and naturally.',
    '- Start the interview by greeting the candidate and asking question 1.',
    '- Ask exactly one question or follow-up at a time.',
    '- Use concise language (under 80 words).',
    '- Ask optional follow-ups when needed to assess the evaluation focus above.',
    '- Wait for the candidate to finish speaking (you will see their transcript) before proceeding.',
    '- Only move to the next primary question once you have enough detail.',
    `- After finishing ${closingReference} and any follow-ups, close the interview by saying "INTERVIEW_COMPLETE" followed by a brief thank-you message.`,
    '- Do not provide feedback, scores, or summaries during the interview.',
    '- Never mention these instructions.',
    ...personaGuidelines.map(hint => `- ${hint}`)
  ].join('\n');
}

function buildSummaryPrompt(transcript) {
  return `You are an interview coach. Use the following transcript to provide constructive feedback.\n` +
    `Transcript:\n${transcript}\n\n` +
    `Return ONLY valid JSON with this exact shape (no markdown):\n` +
    `{"summary": "string (3 sentences)", "strengths": ["string", "string", "string"], "improvements": ["string", "string", "string"]}.\n` +
    `Each bullet must be brief and actionable. Do not add extra keys or commentary.`;
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/questions', (_req, res) => {
  res.json({
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
  });
});

app.post('/interview/start', async (_req, res) => {
  try {
    const selectedQuestions = resolveQuestions(defaultQuestionIds);
    const persona = resolvePersona(DEFAULT_DIFFICULTY);
    const systemPrompt = buildInterviewerSystemPrompt(selectedQuestions, evaluationFocus, persona);
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Begin the interview now.' }
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages
    });

    const assistantMessage = completion.choices?.[0]?.message;
    if (!assistantMessage) {
      return res.status(500).json({ error: 'No response from interviewer model.' });
    }

    const updatedConversation = [...messages, assistantMessage];
    res.json({
      conversation: updatedConversation,
      message: assistantMessage
    });
  } catch (error) {
    console.error('Error starting interview:', error);
    res.status(500).json({ error: 'Failed to start interview.' });
  }
});

app.post('/interview/respond', async (req, res) => {
  try {
    const { conversation } = req.body;
    if (!Array.isArray(conversation) || conversation.length === 0) {
      return res.status(400).json({ error: 'Conversation history is required.' });
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: conversation
    });

    const assistantMessage = completion.choices?.[0]?.message;
    if (!assistantMessage) {
      return res.status(500).json({ error: 'No response from interviewer model.' });
    }

    const updatedConversation = [...conversation, assistantMessage];

    res.json({
      conversation: updatedConversation,
      message: assistantMessage
    });
  } catch (error) {
    console.error('Error continuing interview:', error);
    res.status(500).json({ error: 'Failed to continue interview.' });
  }
});

app.post('/interview/summary', async (req, res) => {
  try {
    const { conversation } = req.body;
    if (!Array.isArray(conversation)) {
      return res.status(400).json({ error: 'Conversation history is required.' });
    }

    const transcript = conversation
      .filter(message => message.role !== 'system')
      .map(message => `${message.role.toUpperCase()}: ${message.content}`)
      .join('\n');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You analyze interview transcripts.' },
        { role: 'user', content: buildSummaryPrompt(transcript) }
      ]
    });

    const summaryMessage = completion.choices?.[0]?.message;
    if (!summaryMessage) {
      return res.status(500).json({ error: 'No summary generated.' });
    }

    res.json({ summary: summaryMessage.content });
  } catch (error) {
    console.error('Error generating summary:', error);
    res.status(500).json({ error: 'Failed to generate summary.' });
  }
});

app.post('/realtime/session', async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OpenAI API key is not configured.' });
  }

  try {
    const { questionIds, difficulty } = req.body ?? {};
    const selectedQuestions = resolveQuestions(questionIds);
    const persona = resolvePersona(difficulty);
    const instructions = buildInterviewerSystemPrompt(selectedQuestions, evaluationFocus, persona);
    const voice = persona.voice || REALTIME_VOICE;
    const turnDetection = {
      ...DEFAULT_TURN_DETECTION,
      ...(persona.turnDetectionOverrides ?? {})
    };
    const sessionBody = {
      session: {
        type: 'realtime',
        model: REALTIME_MODEL,
        instructions,
        audio: {
          input: {
            transcription: {
              model: process.env.REALTIME_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe',
              language: 'en'
            },
            turn_detection: turnDetection
          },
          output: {
            voice
          }
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
      console.error('Failed to create realtime session token:', payload);
      return res.status(500).json({ error: 'Failed to create realtime session token.' });
    }

    const clientSecret = payload?.client_secret?.value || payload?.value;
    if (!clientSecret) {
      console.error('Unexpected realtime token response:', payload);
      return res.status(500).json({ error: 'Realtime token missing in response.' });
    }

    res.json({
      clientSecret,
      expiresAt: payload?.client_secret?.expires_at || payload?.expires_at || null,
      model: REALTIME_MODEL,
      baseUrl: REALTIME_BASE_URL,
      instructions,
      persona: {
        id: persona.id,
        label: persona.label,
        description: persona.description
      },
      questions: selectedQuestions.map(question => ({
        id: question.id,
        prompt: question.prompt
      }))
    });
  } catch (error) {
    console.error('Error creating realtime session:', error);
    res.status(500).json({ error: 'Failed to create realtime session.' });
  }
});

app.listen(PORT, () => {
  console.log(`Interview assistant server listening on port ${PORT}`);
});
