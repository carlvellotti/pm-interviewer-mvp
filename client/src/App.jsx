import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
  prepModeAtom,
  interviewSessionAtom,
  interviewQuestionStackAtom,
  interviewPersonaAtom,
  interviewResumeAtom,
  selectedQuestionsAtom,
  selectedQuestionIdsAtom,
  evaluationFocusAtom,
  reviewSettingsAtom,
  resumeUploadAtom,
  jdSummaryAtom,
  selectedInterviewAtom,
  selectedInterviewIdAtom,
  interviewListAtom
} from './atoms/prepState.js';
import { saveInterview, summarizeInterview, createRealtimeSession } from './services/api.js';
import { useRealtimeInterview } from './hooks/useRealtimeInterview.js';
import {
  buildInterviewerSystemPrompt,
  deriveSessionTitleFromQuestions,
  extractTextFromContent,
  getListDisplayTitle,
  getRecordTitle,
  normaliseDelta,
  normaliseTranscriptEntryContent,
  parseCoachingSummary,
  sortInterviewsByDate
} from './utils/interviewHelpers.js';
import {
  formatDetailTimestamp,
  formatHeaderTimestamp,
  formatLabel,
  formatSidebarTimestamp,
  shortenSummary
} from './utils/formatters.js';
import PrepWizard from './components/prep/PrepWizard.jsx';
import Sidebar from './components/Sidebar.jsx';
import QuestionStack from './components/interview/QuestionStack.jsx';
import SessionDetails from './components/interview/SessionDetails.jsx';
import AudioVisualizer from './components/interview/AudioVisualizer.jsx';
import './redesign.css';

function InterviewExperience() {
  const [prepMode, setPrepMode] = useAtom(prepModeAtom);
  const [interviewSession, setInterviewSession] = useAtom(interviewSessionAtom);
  const [interviewStack, setInterviewStack] = useAtom(interviewQuestionStackAtom);
  const [interviewPersona, setInterviewPersona] = useAtom(interviewPersonaAtom);
  const interviewResume = useAtomValue(interviewResumeAtom);
  const selectedQuestions = useAtomValue(selectedQuestionsAtom);
  const selectedQuestionIds = useAtomValue(selectedQuestionIdsAtom);
  const evaluationFocus = useAtomValue(evaluationFocusAtom);
  const reviewSettings = useAtomValue(reviewSettingsAtom);
  const resumeState = useAtomValue(resumeUploadAtom);
  const jdSummary = useAtomValue(jdSummaryAtom);


  const [summary, setSummary] = useState('');
  const [displayMessages, setDisplayMessages] = useState([]);
  const [displayMode, setDisplayMode] = useState('equalizer'); // equalizer | transcript
  
  const [selectedInterviewId] = useAtom(selectedInterviewIdAtom);
  const [selectedInterview] = useAtom(selectedInterviewAtom);
  const [interviewList, setInterviewList] = useAtom(interviewListAtom);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const {
    status,
    error,
    isMicActive,
    remoteAudioRef,
    remoteStream,
    dataChannelRef,
    startInterview,
    cleanupConnection
  } = useRealtimeInterview();
  
  const messageOrderRef = useRef([]);
  const messageMapRef = useRef(new Map());
  const conversationRef = useRef([]);
  const summaryRequestedRef = useRef(false);
  const statusRef = useRef(status);
  const audioContextRef = useRef(null);
  const coaching = useMemo(() => parseCoachingSummary(summary), [summary]);
  const isViewingHistory = prepMode === 'history' && selectedInterviewId !== null && selectedInterview !== null;
  const detailTitle = useMemo(() => getRecordTitle(selectedInterview), [selectedInterview]);
  const detailTimestamp = useMemo(() => formatHeaderTimestamp(selectedInterview?.createdAt), [selectedInterview]);
  const detailEvaluation = selectedInterview?.evaluation ?? null;
  const detailCoaching = useMemo(() => {
    if (!detailEvaluation) return null;
    const summaryValue = detailEvaluation.summary ?? detailEvaluation.rawSummary;
    const strengthsValue = Array.isArray(detailEvaluation.strengths)
      ? detailEvaluation.strengths
      : [];
    const improvementsValue = Array.isArray(detailEvaluation.improvements)
      ? detailEvaluation.improvements
      : [];

    if (summaryValue || strengthsValue.length > 0 || improvementsValue.length > 0) {
      return {
        summary: summaryValue ?? '',
        strengths: strengthsValue,
        improvements: improvementsValue
      };
    }

    if (typeof detailEvaluation.rawSummary === 'string') {
      return parseCoachingSummary(detailEvaluation.rawSummary);
    }

    if (typeof detailEvaluation.text === 'string') {
      return parseCoachingSummary(detailEvaluation.text);
    }

    return null;
  }, [detailEvaluation]);
  const detailTranscript = selectedInterview?.transcript ?? [];

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (prepMode === 'interview' && interviewSession && status === 'idle') {
      const initInterview = async () => {
        const session = interviewSession || await createRealtimeSession({});
        await startInterview(session, interviewStack, handleDataChannelMessage);
      };
      initInterview();
    }
  }, [prepMode, interviewSession, interviewStack, status, startInterview]);

  const commitMessages = useCallback(() => {
    const ordered = messageOrderRef.current
      .map(id => messageMapRef.current.get(id))
      .filter(Boolean)
      .map(entry => ({ id: entry.id, role: entry.role, text: entry.text.trim() }));

    setDisplayMessages(ordered);
    conversationRef.current = ordered.map(({ role, text }) => ({ role, content: text }));
  }, []);

  const upsertMessage = useCallback((itemId, role, textDelta, options = {}) => {
    if (!itemId) return;
    const current = messageMapRef.current.get(itemId) ?? { id: itemId, role, text: '' };
    if (role && !current.role) {
      current.role = role;
    }
    if (options.replace) {
      current.text = textDelta ?? '';
    } else {
      current.text = `${current.text || ''}${textDelta ?? ''}`;
    }

    messageMapRef.current.set(itemId, current);
    if (!messageOrderRef.current.includes(itemId)) {
      messageOrderRef.current.push(itemId);
    }

    commitMessages();

    if (
      current.role === 'assistant' &&
      current.text.includes('INTERVIEW_COMPLETE') &&
      !summaryRequestedRef.current
    ) {
      summaryRequestedRef.current = true;
      setStatus('complete');
      cleanupConnection();
      fetchSummary(conversationRef.current);
    }
  }, [commitMessages, cleanupConnection]);

  const handleRealtimeEvent = useCallback(event => {
    if (!event || typeof event !== 'object') return;

    if (import.meta.env.DEV) {
      console.debug('Realtime event', event.type, event);
    }

    switch (event.type) {
      case 'conversation.item.created':
      case 'conversation.item.added': {
        const item = event.item;
        if (!item || item.type !== 'message') return;
        const text = extractTextFromContent(item.content);
        upsertMessage(item.id, item.role, text, { replace: true });
        break;
      }
      case 'conversation.item.input_audio_transcription.delta':
        upsertMessage(event.item_id, 'user', normaliseDelta(event.delta));
        break;
      case 'conversation.item.input_audio_transcription.completed':
      case 'conversation.item.input_audio_transcription.done':
      case 'conversation.item.input_audio_transcription.segment':
        if (typeof event.text === 'string') {
          upsertMessage(event.item_id, 'user', event.text, { replace: true });
        }
        break;
      case 'response.output_text.delta':
        upsertMessage(event.item_id, 'assistant', normaliseDelta(event.delta));
        break;
      case 'response.output_text.done':
        if (typeof event.text === 'string') {
          upsertMessage(event.item_id, 'assistant', event.text, { replace: true });
        }
        break;
      case 'response.output_audio_transcript.delta':
        upsertMessage(event.item_id, 'assistant', normaliseDelta(event.delta));
        break;
      case 'response.output_audio_transcript.done':
        if (typeof event.transcript === 'string') {
          upsertMessage(event.item_id, 'assistant', event.transcript, { replace: true });
        }
        break;
      default:
        break;
    }
  }, [upsertMessage]);

  const handleDataChannelMessage = useCallback(event => {
    try {
      const payload = JSON.parse(event.data);
      handleRealtimeEvent(payload);
    } catch (err) {
      console.debug('Non-JSON realtime payload', event.data);
    }
  }, [handleRealtimeEvent]);

  const fetchSummary = useCallback(async conversation => {
    if (!conversation || conversation.length === 0) {
      setSummary('Transcript unavailable, so feedback could not be generated.');
      return;
    }

    try {
      setSummary('Generating coaching feedback…');
      const { summary: summaryText } = await summarizeInterview(conversation);
      setSummary(summaryText || '');

      const metadata = {
        difficulty: reviewSettings.difficulty,
        persona: reviewSettings.persona,
        questionIds: selectedQuestionIds,
        questions: selectedQuestions.map(question => ({
          id: question.id,
          prompt: question.prompt || question.text,
          description: question.description ?? null
        })),
        evaluationFocus,
        savedAt: new Date().toISOString(),
        resume: resumeState,
        jdSummary
      };

      const evaluationPayload = (() => {
        try {
          const parsed = parseCoachingSummary(summaryText);
          return parsed
            ? {
                summary: parsed.summary,
                strengths: parsed.strengths,
                improvements: parsed.improvements,
                rawSummary: summaryText
              }
            : { rawSummary: summaryText };
        } catch (_err) {
          return { rawSummary: summaryText };
        }
      })();

      const record = await saveInterview({
        transcript: conversation,
        evaluation: evaluationPayload,
        metadata,
        title: deriveSessionTitleFromQuestions(metadata.questions)
      });

      setInterviewList(prev => sortInterviewsByDate([record, ...prev.filter(item => item.id !== record?.id)]));
    } catch (err) {
      console.error(err);
      setSummary('Unable to generate summary right now.');
    }
  }, [evaluationFocus, jdSummary, reviewSettings.difficulty, reviewSettings.persona, resumeState, selectedQuestionIds, selectedQuestions, setInterviewList]);

  const resetInterview = useCallback((options = {}) => {
    const { forceDiscard = false } = options;

    const hasConversation = conversationRef.current && conversationRef.current.length > 0;
    const alreadyRequested = summaryRequestedRef.current;

    if (!forceDiscard && hasConversation && !alreadyRequested) {
      summaryRequestedRef.current = true;
      setStatus('complete');
      setError('');
      fetchSummary(conversationRef.current);
      cleanupConnection();
      return;
    }

    cleanupConnection();
    setStatus('idle');
    setError('');
    setSummary('');
    setDisplayMessages([]);
    messageOrderRef.current = [];
    messageMapRef.current = new Map();
    conversationRef.current = [];
    summaryRequestedRef.current = false;
  }, [cleanupConnection, fetchSummary]);

  return (
    <>
      <header className="workspace-header">
        <div className="header-text">
          <h2>{isViewingHistory ? detailTitle : 'New Interview'}</h2>
          <p className="subtle">
            {isViewingHistory
              ? detailTimestamp || 'Saved session'
              : 'Configure questions and start when ready'}
          </p>
        </div>
        {isViewingHistory ? (
          <button
            type="button"
            className="tone-button"
            onClick={() => resetInterview({ forceDiscard: true })}
          >
            Return to live mode
          </button>
        ) : (
          <div className="persona-chip">
            {reviewSettings.persona ? reviewSettings.persona : 'Medium'}
          </div>
        )}
      </header>

      {error && <div className="banner error">{error}</div>}
      {detailError && isViewingHistory && <div className="banner error">{detailError}</div>}

        {isViewingHistory ? (
          <div className="history-view">
            <section className="history-section">
              <h3>Transcript</h3>
              {detailLoading ? (
                <div className="history-placeholder subtle">Loading transcript…</div>
              ) : detailTranscript.length === 0 ? (
                <div className="history-placeholder subtle">Transcript unavailable for this session.</div>
              ) : (
                <div className="history-transcript">
                  {detailTranscript.map((entry, index) => {
                    const role = entry.role || 'unknown';
                    const label = role === 'assistant' ? 'Interviewer' : role === 'user' ? 'You' : role;
                    const text = normaliseTranscriptEntryContent(entry.content ?? entry.text ?? entry.contentText);
                    return (
                      <div className="history-turn" key={entry.id || index}>
                        <div className="turn-role">{label}</div>
                        <div className="turn-text">{text || '—'}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="history-section">
              <h3>Evaluation</h3>
              {detailLoading ? (
                <div className="history-placeholder subtle">Loading evaluation…</div>
              ) : detailCoaching ? (
                <div className="summary">
                  {detailCoaching.summary && (
                    <div className="summary-block">
                      <h4>Summary</h4>
                      <p>{detailCoaching.summary}</p>
                    </div>
                  )}
                  {detailCoaching.strengths.length > 0 && (
                    <div className="summary-block">
                      <h4>Strengths</h4>
                      <ul>
                        {detailCoaching.strengths.map((item, index) => (
                          <li key={index}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {detailCoaching.improvements.length > 0 && (
                    <div className="summary-block">
                      <h4>Improvements</h4>
                      <ul>
                        {detailCoaching.improvements.map((item, index) => (
                          <li key={index}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : summary ? (
                <pre className="history-summary-text">{summary}</pre>
              ) : (
                <div className="history-placeholder subtle">Evaluation unavailable for this session.</div>
              )}
            </section>
          </div>
        ) : (
          <div className="live-layout">
            <section className="live-stage">
              <div className="panel">
                <div className="panel-header">
                  {status === 'in-progress' ? (
                    <div className={`mic-indicator ${isMicActive ? 'active' : ''}`}>
                      <span className="dot" />
                      <span>{isMicActive ? 'Microphone live' : 'Microphone unavailable'}</span>
                    </div>
                  ) : (
                    <div></div>
                  )}
                  <button
                    type="button"
                    className="toggle-button"
                    onClick={() => setDisplayMode(displayMode === 'equalizer' ? 'transcript' : 'equalizer')}
                  >
                    Switch to {displayMode === 'equalizer' ? 'Transcript' : 'Visualization'}
                  </button>
                </div>

                {displayMode === 'transcript' ? (
                  <div className={`transcript-view ${status === 'in-progress' ? 'active' : ''}`}>
                    {displayMessages.length === 0 ? (
                      <span className="placeholder subtle">Transcript will appear here once the interview starts…</span>
                    ) : (
                      <pre>
                        {displayMessages
                          .map(m => `${m.role === 'assistant' ? 'Interviewer' : 'You'}: ${m.text}`)
                          .join('\n\n')}
                        {status === 'in-progress' ? '▋' : ''}
                      </pre>
                    )}
                  </div>
                ) : (
                  <AudioVisualizer remoteStream={remoteStream} status={status} />
                )}
              </div>
            </section>

            <aside className="live-sidebar">
              <QuestionStack questions={interviewStack} />
              <SessionDetails
                persona={interviewPersona}
                personaFallback={reviewSettings.persona}
                difficulty={reviewSettings.difficulty}
                resumeFilename={interviewResume?.filename || resumeState.filename}
                jdSummary={jdSummary}
              />
            </aside>
          </div>
        )}

        {!isViewingHistory && summary && (
          <section className="summary">
            <h3>Coaching Advice</h3>
            {coaching ? (
              <>
                {coaching.summary && (
                  <div className="summary-block">
                    <h4>Summary of Overall Performance</h4>
                    <p>{coaching.summary}</p>
                  </div>
                )}
                {coaching.strengths.length > 0 && (
                  <div className="summary-block">
                    <h4>Strengths</h4>
                    <ul>
                      {coaching.strengths.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {coaching.improvements.length > 0 && (
                  <div className="summary-block">
                    <h4>Improvements</h4>
                    <ul>
                      {coaching.improvements.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <pre>{summary}</pre>
            )}
          </section>
        )}

      <audio ref={remoteAudioRef} autoPlay playsInline className="sr-only" />
    </>
  );
}

export default function App() {
  const prepMode = useAtomValue(prepModeAtom);
  
  if (prepMode === 'prep') {
    return (
      <div className="app-shell">
        <Sidebar />
        <PrepWizard />
      </div>
    );
  }
  
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="workspace">
        <InterviewExperience />
      </main>
    </div>
  );
}
