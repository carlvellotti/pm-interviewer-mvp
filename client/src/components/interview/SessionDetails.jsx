import { formatLabel } from '../../utils/formatters.js';

export default function SessionDetails({ persona, personaFallback, difficulty, resumeFilename, jdSummary }) {
  return (
    <section className="card">
      <div className="card-header">
        <h3>Session Details</h3>
      </div>
      <div className="card-body summary-card">
        <div>
          <span className="label">Persona</span>
          <strong>{persona?.label || formatLabel(personaFallback)}</strong>
        </div>
        <div>
          <span className="label">Difficulty</span>
          <strong>{formatLabel(difficulty)}</strong>
        </div>
        <div>
          <span className="label">Resume</span>
          <strong>{resumeFilename || 'Not attached'}</strong>
        </div>
        <div>
          <span className="label">JD summary</span>
          <strong>{jdSummary ? 'Included' : 'Not provided'}</strong>
        </div>
      </div>
    </section>
  );
}
