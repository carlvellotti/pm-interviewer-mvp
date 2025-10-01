import { useCallback, useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import {
  interviewListAtom,
  prepModeAtom,
  selectedInterviewAtom,
  selectedInterviewIdAtom
} from '../atoms/prepState.js';
import { getInterviews, getInterviewById } from '../services/localStorage.js';
import { sortInterviewsByDate } from '../utils/interviewHelpers.js';

export function useInterviewHistory() {
  const [interviewList, setInterviewList] = useAtom(interviewListAtom);
  const [selectedInterviewId, setSelectedInterviewId] = useAtom(selectedInterviewIdAtom);
  const [selectedInterview, setSelectedInterview] = useAtom(selectedInterviewAtom);
  const [, setPrepMode] = useAtom(prepModeAtom);

  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const loadHistory = useCallback(() => {
    try {
      setHistoryLoading(true);
      setHistoryError('');
      const interviews = getInterviews();
      setInterviewList(sortInterviewsByDate(interviews));
    } catch (err) {
      console.error(err);
      setHistoryError('Unable to load interview history.');
    } finally {
      setHistoryLoading(false);
    }
  }, [setInterviewList]);

  const loadInterviewDetail = useCallback(id => {
    if (!id) {
      setSelectedInterviewId(null);
      setSelectedInterview(null);
      setDetailError('');
      setDetailLoading(false);
      setPrepMode('interview');
      return;
    }

    try {
      setDetailLoading(true);
      setDetailError('');
      const record = getInterviewById(id);
      
      if (!record) {
        setDetailError('Interview not found. It may have been removed.');
        setInterviewList(prev => sortInterviewsByDate(prev.filter(item => item.id !== id)));
        setSelectedInterviewId(null);
        setSelectedInterview(null);
        setPrepMode('interview');
      } else {
        setSelectedInterviewId(id);
        setSelectedInterview(record);
        setPrepMode('history');
      }
    } catch (err) {
      console.error(err);
      setDetailError('Unable to load interview details.');
      setSelectedInterviewId(null);
      setSelectedInterview(null);
      setPrepMode('interview');
    } finally {
      setDetailLoading(false);
    }
  }, [setInterviewList, setPrepMode, setSelectedInterview, setSelectedInterviewId]);

  const clearSelection = useCallback(() => {
    setSelectedInterviewId(null);
    setSelectedInterview(null);
  }, [setSelectedInterview, setSelectedInterviewId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  return {
    interviewList,
    selectedInterviewId,
    selectedInterview,
    historyLoading,
    historyError,
    detailLoading,
    detailError,
    loadHistory,
    loadInterviewDetail,
    clearSelection
  };
}


