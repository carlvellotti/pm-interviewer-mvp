import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

function extractTextFromContent(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter(part => part && typeof part === 'object')
    .map(part => {
      if (typeof part.text === 'string') return part.text;
      if (typeof part.content === 'string') return part.content;
      return '';
    })
    .join('');
}

function normaliseDelta(delta) {
  if (!delta) return '';
  if (typeof delta === 'string') return delta;
  if (typeof delta === 'object' && typeof delta.text === 'string') return delta.text;
  return '';
}

function parseCoachingSummary(raw) {
  if (!raw) return null;
  const trimmed = typeof raw === 'string' ? raw.trim() : raw;
  if (!trimmed) return null;

  try {
    const parsed = typeof trimmed === 'string' ? JSON.parse(trimmed) : trimmed;
    const summaryText = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    const strengthsList = Array.isArray(parsed.strengths)
      ? parsed.strengths.filter(item => typeof item === 'string' && item.trim().length > 0)
      : [];
    const improvementsList = Array.isArray(parsed.improvements)
      ? parsed.improvements.filter(item => typeof item === 'string' && item.trim().length > 0)
      : [];

    return {
      summary: summaryText,
      strengths: strengthsList,
      improvements: improvementsList
    };
  } catch (error) {
    console.warn('Could not parse coaching summary JSON', error);
    return null;
  }
}

function App() {
  const [status, setStatus] = useState('idle'); // idle | connecting | in-progress | complete
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [questionOptions, setQuestionOptions] = useState([]);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState([]);
  const [evaluationFocus, setEvaluationFocus] = useState([]);
  const [personaOptions, setPersonaOptions] = useState([]);
  const [selectedDifficulty, setSelectedDifficulty] = useState('medium');
  const [displayMessages, setDisplayMessages] = useState([]);
  const [isMicActive, setIsMicActive] = useState(false);

  const remoteAudioRef = useRef(null);
  const peerRef = useRef(null);
  const dataChannelRef = useRef(null);
  const localStreamRef = useRef(null);
  const messageOrderRef = useRef([]);
  const messageMapRef = useRef(new Map());
  const conversationRef = useRef([]);
  const summaryRequestedRef = useRef(false);
  const instructionsRef = useRef('');
  const statusRef = useRef(status);
  const coaching = useMemo(() => parseCoachingSummary(summary), [summary]);
  const selectedQuestions = useMemo(() => {
    if (questionOptions.length === 0 || selectedQuestionIds.length === 0) {
      return [];
    }
    const map = new Map(questionOptions.map(option => [option.id, option]));
    return selectedQuestionIds.map(id => map.get(id)).filter(Boolean);
  }, [questionOptions, selectedQuestionIds]);
  const activePersona = useMemo(
    () => personaOptions.find(persona => persona.id === selectedDifficulty) || null,
    [personaOptions, selectedDifficulty]
  );
  const canStartInterview = status === 'idle' && selectedQuestionIds.length > 0;

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    async function loadConfiguration() {
      try {
        const response = await fetch(`${API_BASE_URL}/questions`);
        if (!response.ok) {
          throw new Error('Failed to load questions');
        }
        const data = await response.json();
        const questionList = Array.isArray(data.questions) ? data.questions : [];
        const personaList = Array.isArray(data.personas) ? data.personas : [];
        const defaults = data.defaults ?? {};

        setQuestionOptions(questionList);
        setPersonaOptions(personaList);
        setEvaluationFocus(Array.isArray(data.evaluationFocus) ? data.evaluationFocus : []);
        setSelectedQuestionIds(
          Array.isArray(defaults.questionIds) && defaults.questionIds.length > 0
            ? defaults.questionIds
            : questionList.slice(0, 3).map(option => option.id)
        );
        if (typeof defaults.difficulty === 'string') {
          setSelectedDifficulty(defaults.difficulty);
        }
      } catch (err) {
        console.error(err);
        setError('Unable to load interview configuration.');
      }
    }

    loadConfiguration();
  }, []);

  const handleQuestionSelect = event => {
    const values = Array.from(event.target.selectedOptions).map(option => option.value);
    setSelectedQuestionIds(values);
  };

  const handleDifficultyChange = id => {
    setSelectedDifficulty(id);
  };

  const commitMessages = () => {
    const ordered = messageOrderRef.current
      .map(id => messageMapRef.current.get(id))
      .filter(Boolean)
      .map(entry => ({ id: entry.id, role: entry.role, text: entry.text.trim() }));

    setDisplayMessages(ordered);
    conversationRef.current = ordered.map(({ role, text }) => ({ role, content: text }));
  };

  const upsertMessage = (itemId, role, textDelta, options = {}) => {
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
  };

  const handleRealtimeEvent = event => {
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
  };

  const handleDataChannelMessage = event => {
    try {
      const payload = JSON.parse(event.data);
      handleRealtimeEvent(payload);
    } catch (err) {
      console.debug('Non-JSON realtime payload', event.data);
    }
  };

  const cleanupConnection = () => {
    if (dataChannelRef.current) {
      try {
        dataChannelRef.current.close();
      } catch (err) {
        // ignore
      }
      dataChannelRef.current = null;
    }

    if (peerRef.current) {
      try {
        peerRef.current.close();
      } catch (err) {
        // ignore
      }
      peerRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    setIsMicActive(false);
  };

  const waitForIceGatheringComplete = pc =>
    new Promise(resolve => {
      if (!pc) {
        resolve();
        return;
      }

      if (pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      const checkState = () => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };

      pc.addEventListener('icegatheringstatechange', checkState);
    });

  const startInterview = async () => {
    if (status === 'connecting' || status === 'in-progress') return;
    if (selectedQuestionIds.length === 0) {
      setError('Select at least one question to practice.');
      return;
    }
    setError('');
    setSummary('');
    summaryRequestedRef.current = false;
    messageOrderRef.current = [];
    messageMapRef.current = new Map();
    conversationRef.current = [];
    commitMessages();

    try {
      setStatus('connecting');

      const tokenResponse = await fetch(`${API_BASE_URL}/realtime/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionIds: selectedQuestionIds,
          difficulty: selectedDifficulty
        })
      });

      if (!tokenResponse.ok) {
        const message = await tokenResponse.text();
        throw new Error(message || 'Failed to request realtime session');
      }

      const tokenData = await tokenResponse.json();
      if (!tokenData?.clientSecret) {
        throw new Error('Realtime session token missing');
      }
      instructionsRef.current = tokenData.instructions ?? '';

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access is not supported in this browser');
      }

      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = localStream;
      setIsMicActive(true);

      const pc = new RTCPeerConnection();
      peerRef.current = pc;

      pc.addTransceiver('audio', { direction: 'sendrecv' });

      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

      pc.ontrack = event => {
        const [remoteStream] = event.streams;
        if (remoteAudioRef.current && remoteStream) {
          remoteAudioRef.current.srcObject = remoteStream;
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
          cleanupConnection();
          if (statusRef.current === 'in-progress') {
            setError('Realtime connection interrupted.');
            setStatus('idle');
          }
        }
      };

      const dataChannel = pc.createDataChannel('oai-events');
      dataChannelRef.current = dataChannel;
      dataChannel.onmessage = handleDataChannelMessage;
      dataChannel.onclose = () => {
        if (statusRef.current === 'in-progress' && !summaryRequestedRef.current) {
          setError('The interviewer disconnected unexpectedly.');
          setStatus('idle');
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await waitForIceGatheringComplete(pc);

      const baseUrl = tokenData.baseUrl || 'https://api.openai.com/v1/realtime/calls';
      const model = tokenData.model || 'gpt-4o-realtime-preview-2024-12-17';
      const localSdp = pc.localDescription?.sdp || offer.sdp;

      if (import.meta.env.DEV) {
        console.debug('Local SDP preview', localSdp);
      }

      const sdpResponse = await fetch(`${baseUrl}?model=${encodeURIComponent(model)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.clientSecret}`,
          'Content-Type': 'application/sdp'
        },
        body: localSdp
      });

      if (!sdpResponse.ok) {
        const failureBody = await sdpResponse.text();
        console.error('Realtime SDP exchange failed', failureBody);
        let errorMessage = 'Failed to establish realtime session';
        try {
          const parsed = JSON.parse(failureBody);
          errorMessage = parsed?.error?.message || errorMessage;
        } catch (parseError) {
          errorMessage = failureBody || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const answer = await sdpResponse.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });

      dataChannel.onopen = () => {
        setStatus('in-progress');
        if (instructionsRef.current) {
          dataChannel.send(
            JSON.stringify({
              type: 'session.update',
              session: {
                instructions: instructionsRef.current
              }
            })
          );
        }

        dataChannel.send(
          JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: 'Begin the interview now.'
                }
              ]
            }
          })
        );

        dataChannel.send(JSON.stringify({ type: 'response.create' }));
      };
    } catch (err) {
      console.error(err);
      setError(err.message || 'Unable to start realtime interview.');
      cleanupConnection();
      setStatus('idle');
      setIsMicActive(false);
    }
  };

  const fetchSummary = async conversation => {
    if (!conversation || conversation.length === 0) {
      setSummary('Transcript unavailable, so feedback could not be generated.');
      return;
    }

    try {
      setSummary('Generating coaching feedback…');
      const response = await fetch(`${API_BASE_URL}/interview/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation })
      });

      if (!response.ok) {
        throw new Error('Failed to summarize interview');
      }

      const data = await response.json();
      setSummary(data.summary ?? '');
    } catch (err) {
      console.error(err);
      setSummary('Unable to generate summary right now.');
    }
  };

  const resetInterview = () => {
    cleanupConnection();
    setStatus('idle');
    setError('');
    setSummary('');
    setDisplayMessages([]);
    messageOrderRef.current = [];
    messageMapRef.current = new Map();
    conversationRef.current = [];
    summaryRequestedRef.current = false;
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Interview Assistant</h1>
        <p className="tagline">Practice with realtime voice conversations and get tailored feedback.</p>
      </header>

      <section className="config">
        <h2>Interview Setup</h2>
        <div className="config-grid">
          <div className="config-section">
            <h3>Choose Questions</h3>
            <p className="helper-text">Pick the prompts you want to practice in this run.</p>
            <select
              multiple
              className="question-select"
              value={selectedQuestionIds}
              onChange={handleQuestionSelect}
            >
              {questionOptions.map(option => (
                <option key={option.id} value={option.id}>
                  {option.prompt}
                </option>
              ))}
            </select>
            <p className="helper-text subtle">Hold Cmd/Ctrl to select multiple questions.</p>
            <div className="selected-questions">
              <h4>Included in this interview</h4>
              {selectedQuestions.length > 0 ? (
                <ol>
                  {selectedQuestions.map(question => (
                    <li key={question.id}>{question.prompt}</li>
                  ))}
                </ol>
              ) : (
                <p className="placeholder">Select at least one question to begin.</p>
              )}
            </div>
          </div>
          <div className="config-section">
            <h3>Interview Style</h3>
            <div className="difficulty-options">
              {personaOptions.map(persona => (
                <button
                  key={persona.id}
                  type="button"
                  className={`difficulty-button ${selectedDifficulty === persona.id ? 'active' : ''}`}
                  onClick={() => handleDifficultyChange(persona.id)}
                >
                  <span className="difficulty-label">{persona.label}</span>
                  <span className="difficulty-description">{persona.description}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="config-section">
            <h3>What the interviewer listens for</h3>
            <ul>
              {evaluationFocus.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {error && <div className="error">{error}</div>}

      <section className="interview-card">
        <div className="conversation">
          {displayMessages.length === 0 && (
            <p className="placeholder">Press start to connect with the interviewer.</p>
          )}
          {displayMessages.map(message => (
            <div key={message.id} className={`message ${message.role}`}>
              <span className="role">{message.role === 'assistant' ? 'Interviewer' : 'You'}:</span>
              <span className="content">{message.text}</span>
            </div>
          ))}
        </div>

        <div className="controls">
          {status === 'idle' && (
            <button className="primary" onClick={startInterview} disabled={!canStartInterview}>
              {activePersona ? `Start ${activePersona.label} Interview` : 'Start Voice Interview'}
            </button>
          )}

          {status === 'connecting' && (
            <button className="primary" disabled>
              Connecting…
            </button>
          )}

          {status === 'in-progress' && (
            <div className="voice-status">
              <div className={`mic-indicator ${isMicActive ? 'active' : ''}`}>
                <span className="dot" />
                <span>{isMicActive ? 'Microphone live' : 'Microphone unavailable'}</span>
              </div>
              <button className="secondary" onClick={resetInterview}>
                End Session
              </button>
            </div>
          )}

          {status === 'complete' && (
            <div className="action-row">
              <button className="secondary" onClick={resetInterview}>
                Reset
              </button>
              <button className="primary" onClick={startInterview}>
                Restart Interview
              </button>
            </div>
          )}
        </div>
      </section>

      {summary && (
        <section className="summary">
          <h2>Coaching Advice</h2>
          {coaching ? (
            <>
              {coaching.summary && (
                <div className="summary-block">
                  <h3>Summary of Overall Performance</h3>
                  <p>{coaching.summary}</p>
                </div>
              )}
              {coaching.strengths.length > 0 && (
                <div className="summary-block">
                  <h3>Strengths</h3>
                  <ul>
                    {coaching.strengths.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {coaching.improvements.length > 0 && (
                <div className="summary-block">
                  <h3>Improvements</h3>
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
    </div>
  );
}

export default App;
