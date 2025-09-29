import { memo } from 'react';
import { useSetAtom } from 'jotai';
import { prepModeAtom } from '../atoms/prepState.js';
import { useInterviewHistory } from '../hooks/useInterviewHistory.js';
import { formatSidebarTimestamp, shortenSummary } from '../utils/formatters.js';
import { getListDisplayTitle } from '../utils/interviewHelpers.js';

function Sidebar() {
  const setPrepMode = useSetAtom(prepModeAtom);
  const {
    interviewList,
    selectedInterviewId,
    historyLoading,
    historyError,
    loadInterviewDetail,
    clearSelection
  } = useInterviewHistory();

  const handleNewInterview = () => {
    clearSelection();
    setPrepMode('prep');
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">Interview Coach</h1>
        <button type="button" className="sidebar-primary-action" onClick={handleNewInterview}>
          New Interview
        </button>
      </div>
      <div className="sidebar-body">
        {historyLoading ? (
          <div className="sidebar-placeholder subtle">Loading history…</div>
        ) : historyError ? (
          <div className="sidebar-placeholder error">{historyError}</div>
        ) : interviewList.length === 0 ? (
          <div className="sidebar-placeholder subtle">No interviews yet. Start a new session to see it here.</div>
        ) : (
          <ul className="interview-list">
            {interviewList.map(item => {
              const isActive = item.id === selectedInterviewId;
              const label = getListDisplayTitle(item);
              const subtitle = formatSidebarTimestamp(item.createdAt);
              const snippet = shortenSummary(item.evaluationSummary ?? '');
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`interview-list-item ${isActive ? 'active' : ''}`}
                    onClick={() => loadInterviewDetail(item.id)}
                  >
                    <span className="item-title">{label}</span>
                    <span className="item-meta">{subtitle}</span>
                    {snippet && <span className="item-snippet">{snippet}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

export default memo(Sidebar);


