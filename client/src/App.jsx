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
import { useInterviewMessages } from './hooks/useInterviewMessages.js';
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
import InterviewView from './components/interview/InterviewView.jsx';
import HistoryView from './components/interview/HistoryView.jsx';
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

  const {
    displayMessages,
    conversationRef,
    handleDataChannelMessage,
    resetMessages
  } = useInterviewMessages({
    onComplete: (conversation) => {
      setStatus('complete');
      cleanupConnection();
      fetchSummary(conversation);
    }
  });

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
  }, [prepMode, interviewSession, interviewStack, status, startInterview, handleDataChannelMessage]);

  const resetInterview = useCallback((options = {}) => {
    const { forceDiscard = false } = options;

    const hasConversation = conversationRef.current && conversationRef.current.length > 0;

    if (!forceDiscard && hasConversation) {
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
    resetMessages();
  }, [cleanupConnection, fetchSummary, resetMessages]);

  if (isViewingHistory) {
    return (
      <HistoryView
        onReturnToLive={() => resetInterview({ forceDiscard: true })}
        summary={summary}
      />
    );
  }

  return (
    <InterviewView
      status={status}
      error={error}
      isMicActive={isMicActive}
      remoteAudioRef={remoteAudioRef}
      remoteStream={remoteStream}
      displayMessages={displayMessages}
      summary={summary}
      onReset={() => resetInterview({ forceDiscard: true })}
    />
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
