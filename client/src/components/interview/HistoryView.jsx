import { useAtom, useAtomValue } from 'jotai';
import { prepModeAtom, selectedInterviewIdAtom, selectedInterviewAtom } from '../../atoms/prepState.js';
import { useInterviewHistory } from '../../hooks/useInterviewHistory.js';
import { normaliseTranscriptEntryContent, parseCoachingSummary, getRecordTitle } from '../../utils/interviewHelpers.js';
import { formatHeaderTimestamp } from '../../utils/formatters.js';
import { useMemo } from 'react';

export default function HistoryView({ onReturnToLive, summary }) {
  const [prepMode, setPrepMode] = useAtom(prepModeAtom);
  const selectedInterviewId = useAtomValue(selectedInterviewIdAtom);
  const selectedInterview = useAtomValue(selectedInterviewAtom);
  const { detailLoading, detailError } = useInterviewHistory();

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
  
  const isViewingHistory = prepMode === 'history' && selectedInterviewId !== null && selectedInterview !== null;

  if (!isViewingHistory) {
    return null;
  }

  return (
    <>
      <header className="workspace-header">
        <div className="header-text">
          <h2>{detailTitle}</h2>
          <p className="subtle">{detailTimestamp || 'Saved session'}</p>
        </div>
        <button
          type="button"
          className="tone-button"
          onClick={onReturnToLive}
        >
          Return to live mode
        </button>
      </header>

      {detailError && <div className="banner error">{detailError}</div>}

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
    </>
  );
}
