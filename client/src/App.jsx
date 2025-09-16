import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import './redesign.css';

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
  const [displayMode, setDisplayMode] = useState('equalizer'); // equalizer | transcript

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

  // Shared AudioContext for visualizations
  const audioContextRef = useRef(null);

  // Remote (live) visualizer refs
  const remoteVizCanvasRef = useRef(null);
  const remoteAnalyserRef = useRef(null);
  const remoteStreamSourceRef = useRef(null);
  const remoteVizFrameRef = useRef(0);
  const remoteVizDataArrayRef = useRef(null);
  const remoteFreqArrayRef = useRef(null);
  const remoteBinIndexRef = useRef(null);
  const remoteVizContainerRef = useRef(null);

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

  const handleQuestionToggle = id => {
    setSelectedQuestionIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
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
        if (remoteStream) {
          // Kick off the remote visualizer using the incoming audio stream
          startRemoteVisualizer(remoteStream);
          // Cleanup if the track ends
          const track = event.track;
          if (track) {
            track.onended = () => {
              stopRemoteVisualizer();
            };
          }
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

  // Live remote visualizer: start/stop
  const stopRemoteVisualizer = () => {
    if (remoteVizFrameRef.current) {
      cancelAnimationFrame(remoteVizFrameRef.current);
      remoteVizFrameRef.current = 0;
    }
    try {
      if (remoteAnalyserRef.current) remoteAnalyserRef.current.disconnect();
    } catch (e) {
      // ignore
    }
    try {
      if (remoteStreamSourceRef.current) remoteStreamSourceRef.current.disconnect();
    } catch (e) {
      // ignore
    }
    remoteAnalyserRef.current = null;
    remoteStreamSourceRef.current = null;
    remoteVizDataArrayRef.current = null;
  };

  const startRemoteVisualizer = async remoteStream => {
    const canvas = remoteVizCanvasRef.current;
    if (!remoteStream || !canvas) return;

    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    // Create or reuse shared AudioContext
    const audioCtx = audioContextRef.current || new AC();
    audioContextRef.current = audioCtx;
    if (audioCtx.state === 'suspended') {
      try { await audioCtx.resume(); } catch (e) { /* ignore */ }
    }

    // Create or reuse media stream source
    if (!remoteStreamSourceRef.current) {
      try {
        remoteStreamSourceRef.current = audioCtx.createMediaStreamSource(remoteStream);
      } catch (e) {
        // ignore if already created
      }
    }

    // Create or reuse analyser
    const analyser = remoteAnalyserRef.current || audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.7;
    remoteAnalyserRef.current = analyser;

    // Connect stream -> analyser (no destination to avoid double audio with <audio>)
    try {
      remoteStreamSourceRef.current.connect(analyser);
    } catch (e) {
      // ignore duplicate connections
    }

    const ctx = canvas.getContext('2d');

    // Allocate time-domain buffer once
    const timeBufferLength = analyser.fftSize;
    if (!remoteVizDataArrayRef.current || remoteVizDataArrayRef.current.length !== timeBufferLength) {
      remoteVizDataArrayRef.current = new Uint8Array(timeBufferLength);
    }

    // Allocate frequency buffer once
    const freqBufferLength = analyser.frequencyBinCount;
    if (!remoteFreqArrayRef.current || remoteFreqArrayRef.current.length !== freqBufferLength) {
      remoteFreqArrayRef.current = new Uint8Array(freqBufferLength);
    }

    // Build log-spaced bin indices once for a ring of bars
    if (!remoteBinIndexRef.current) {
      const numBars = 48; // visual density
      const startIndex = 2; // skip DC/very low bins
      const endIndex = freqBufferLength - 1;
      const indices = [];
      for (let i = 0; i < numBars; i++) {
        const t = i / (numBars - 1);
        const ratio = Math.pow(endIndex / startIndex, t);
        const idx = Math.min(endIndex, Math.max(startIndex, Math.floor(startIndex * ratio)));
        indices.push(idx);
      }
      remoteBinIndexRef.current = indices;
    }

    const draw = () => {
      // Width/height may change if container resizes; read per-frame
      const width = canvas.width;
      const height = canvas.height;
      const timeArray = remoteVizDataArrayRef.current;
      const freqArray = remoteFreqArrayRef.current;
      if (!timeArray || !freqArray) return;

      // Pull data
      analyser.getByteTimeDomainData(timeArray);
      analyser.getByteFrequencyData(freqArray);

      // Compute RMS for center pulse
      let sumSquares = 0;
      for (let i = 0; i < timeArray.length; i++) {
        const v = (timeArray[i] - 128) / 128;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / timeArray.length);
      const level = Math.max(0, Math.min(1, (rms - 0.02) / 0.3));

      // Clear background
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#070b12';
      ctx.fillRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const minDim = Math.min(width, height);
      const innerRadius = minDim * 0.28;
      const maxBarLength = minDim * 0.22;

      // Draw center pulse
      const pulseRadius = innerRadius * (0.7 + 0.25 * level);
      ctx.beginPath();
      ctx.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = `rgba(80, 200, 255, ${0.15 + 0.35 * level})`;
      ctx.fill();

      // Draw radial bars (log-spaced)
      const indices = remoteBinIndexRef.current;
      const numBars = indices.length;
      ctx.lineCap = 'round';
      for (let i = 0; i < numBars; i++) {
        const idx = indices[i];
        const magnitude = (freqArray[idx] || 0) / 255;
        // perceptual ease-in
        const m = Math.pow(Math.max(0, magnitude - 0.05) / 0.95, 0.8);
        const angle = (i / numBars) * Math.PI * 2 - Math.PI / 2;
        const length = innerRadius + m * maxBarLength;
        const x0 = cx + Math.cos(angle) * innerRadius;
        const y0 = cy + Math.sin(angle) * innerRadius;
        const x1 = cx + Math.cos(angle) * length;
        const y1 = cy + Math.sin(angle) * length;

        // Color by angle with brightness by magnitude
        const hue = (220 + (i / numBars) * 120) % 360;
        const light = 45 + 30 * m;
        ctx.strokeStyle = `hsl(${hue}, 85%, ${light}%)`;
        ctx.lineWidth = Math.max(2, minDim * 0.006);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }

      remoteVizFrameRef.current = requestAnimationFrame(draw);
    };

    // Start draw loop (it will keep running while stream is live)
    remoteVizFrameRef.current = requestAnimationFrame(draw);
  };

  // Keep the remote visualization canvas sized to its container at device pixel ratio
  useEffect(() => {
    const canvas = remoteVizCanvasRef.current;
    const container = remoteVizContainerRef.current;
    if (!canvas || !container) return;

    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const resize = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (!cw || !ch) return;
      const displayW = Math.floor(cw * dpr);
      const displayH = Math.floor(ch * dpr);
      if (canvas.width !== displayW || canvas.height !== displayH) {
        canvas.width = displayW;
        canvas.height = displayH;
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    window.addEventListener('resize', resize);
    return () => {
      try { ro.disconnect(); } catch (e) { /* ignore */ }
      window.removeEventListener('resize', resize);
    };
  }, [status]);

  // Ensure the remote visualizer starts when the canvas becomes available (and stop otherwise)
  useEffect(() => {
    if (status === 'in-progress') {
      const stream = remoteAudioRef.current && remoteAudioRef.current.srcObject;
      if (stream) {
        startRemoteVisualizer(stream);
      }
    } else {
      stopRemoteVisualizer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        try {
          audioContextRef.current.close();
        } catch (e) {
          // ignore
        }
        audioContextRef.current = null;
      }
    };
  }, []);

  return (
    <div className="app-container">
      <header className="hero">
        <h1>AI Interview Assistant</h1>
        <p className="tagline">Prepare for your next interview with AI assistance</p>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="redesign-grid">
        <div className="config-card">
          <h2>Select Interview Questions</h2>
          <div className="question-checkboxes">
            {questionOptions.map(option => (
              <label key={option.id} className="question-row">
                <input
                  type="checkbox"
                  checked={selectedQuestionIds.includes(option.id)}
                  onChange={() => handleQuestionToggle(option.id)}
                />
                <span>{option.prompt}</span>
              </label>
            ))}
          </div>
          <p className="helper-text subtle">Selected: {selectedQuestionIds.length} / {questionOptions.length}</p>

          <h2>Select Difficulty Level</h2>
          <div className="pill-options">
            {personaOptions.map(persona => (
              <button
                key={persona.id}
                type="button"
                className={`pill ${selectedDifficulty === persona.id ? 'active' : ''}`}
                onClick={() => handleDifficultyChange(persona.id)}
              >
                {persona.label}
              </button>
            ))}
          </div>

          {status === 'idle' && (
            <button className="primary full" onClick={startInterview} disabled={!canStartInterview}>
              Start Interview
            </button>
          )}
          {status === 'connecting' && (
            <button className="primary full" disabled>Connecting…</button>
          )}
          {status === 'in-progress' && (
            <div className="voice-status column">
              <div className={`mic-indicator ${isMicActive ? 'active' : ''}`}>
                <span className="dot" />
                <span>{isMicActive ? 'Microphone live' : 'Microphone unavailable'}</span>
              </div>
              <button className="secondary full" onClick={resetInterview}>End Session</button>
            </div>
          )}
          {status === 'complete' && (
            <div className="action-row">
              <button className="secondary" onClick={resetInterview}>Reset</button>
              <button className="primary" onClick={startInterview}>Restart Interview</button>
            </div>
          )}

          {status === 'idle' && selectedQuestionIds.length === 0 && (
            <p className="warning-text">Please select at least one question to start the interview.</p>
          )}
        </div>

        <div className="right-panel">
          <div className="panel">
            <div className="panel-header">
              <h3>{displayMode === 'equalizer' ? 'AI Visualization' : 'Interview Transcript'}</h3>
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
              <div className={`equalizer ${status === 'in-progress' ? 'active' : ''}`}>
                {status !== 'in-progress' && (
                  <p className="placeholder subtle">AI visualization will activate when interview starts</p>
                )}
                {status === 'in-progress' && (
                  <div ref={remoteVizContainerRef} style={{ position: 'absolute', inset: 0 }}>
                    <canvas
                      ref={remoteVizCanvasRef}
                      style={{ width: '100%', height: '100%', display: 'block', background: '#0b0f1a' }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
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

      {/* Visualizer Playground removed */}

      <audio ref={remoteAudioRef} autoPlay playsInline className="sr-only" />
    </div>
  );
}

export default App;
