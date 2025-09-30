import { useCallback, useEffect, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import {
  prepModeAtom,
  interviewSessionAtom,
  interviewQuestionStackAtom,
  selectedQuestionsAtom,
  selectedQuestionIdsAtom,
  evaluationFocusAtom,
  reviewSettingsAtom,
  jdSummaryAtom,
  selectedInterviewAtom,
  selectedInterviewIdAtom,
  interviewListAtom
} from './atoms/prepState.js';
import { saveInterview, summarizeInterview, createRealtimeSession } from './services/api.js';
import { useRealtimeInterview } from './hooks/useRealtimeInterview.js';
import { useInterviewMessages } from './hooks/useInterviewMessages.js';
import {
  deriveSessionTitleFromQuestions,
  parseCoachingSummary,
  sortInterviewsByDate
} from './utils/interviewHelpers.js';
import PrepWizard from './components/prep/PrepWizard.jsx';
import Sidebar from './components/Sidebar.jsx';
import InterviewView from './components/interview/InterviewView.jsx';
import HistoryView from './components/interview/HistoryView.jsx';
import './redesign.css';

function InterviewExperience() {
  const prepMode = useAtomValue(prepModeAtom);
  const [interviewSession, setInterviewSession] = useAtom(interviewSessionAtom);
  const interviewStack = useAtomValue(interviewQuestionStackAtom);
  const selectedQuestions = useAtomValue(selectedQuestionsAtom);
  const selectedQuestionIds = useAtomValue(selectedQuestionIdsAtom);
  const evaluationFocus = useAtomValue(evaluationFocusAtom);
  const reviewSettings = useAtomValue(reviewSettingsAtom);
  const jdSummary = useAtomValue(jdSummaryAtom);


  const [summary, setSummary] = useState('');
  
  const selectedInterviewId = useAtomValue(selectedInterviewIdAtom);
  const selectedInterview = useAtomValue(selectedInterviewAtom);
  const [interviewList, setInterviewList] = useAtom(interviewListAtom);

  // Scroll to top when interview starts
  useEffect(() => {
    if (prepMode === 'interview') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [prepMode]);

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
  
  const isViewingHistory = prepMode === 'history' && selectedInterviewId !== null;

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
  }, [evaluationFocus, jdSummary, reviewSettings.difficulty, reviewSettings.persona, selectedQuestionIds, selectedQuestions, setInterviewList]);

  const {
    displayMessages,
    conversationRef,
    handleDataChannelMessage,
    resetMessages
  } = useInterviewMessages({
    onComplete: (conversation) => {
      cleanupConnection();
      setInterviewSession(null); // Clear session to prevent auto-restart
      fetchSummary(conversation);
    }
  });

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
      fetchSummary(conversationRef.current);
      cleanupConnection();
      setInterviewSession(null); // Clear session to prevent auto-restart
      return;
    }

    cleanupConnection();
    setInterviewSession(null); // Clear session to prevent auto-restart
    setSummary('');
    resetMessages();
  }, [cleanupConnection, fetchSummary, resetMessages, setInterviewSession]);

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
      onReset={() => resetInterview()}
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
