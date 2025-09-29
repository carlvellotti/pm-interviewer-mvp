import { useCallback, useMemo } from 'react';
import { useAtom } from 'jotai';
import { resumeUploadAtom, prepErrorAtom } from '../../atoms/prepState';
import { uploadResume, deleteResume } from '../../services/api';

export default function ResumeUploader() {
  const [resumeState, setResumeState] = useAtom(resumeUploadAtom);
  const [, setPrepError] = useAtom(prepErrorAtom);

  const isUploading = resumeState.status === 'uploading';

  const onFileChange = useCallback(async event => {
    const file = event.target.files?.[0];
    if (!file) return;

    setPrepError('');
    setResumeState(prev => ({ ...prev, status: 'uploading', error: '' }));

    try {
      const result = await uploadResume(file);
      setResumeState({
        resumeRef: result.resumeRef,
        filename: result.filename,
        size: result.size,
        mimetype: result.mimetype,
        status: 'uploaded',
        error: ''
      });
    } catch (error) {
      const message = error?.message || 'Unable to upload resume.';
      setResumeState({ resumeRef: null, filename: null, status: 'idle', error: message });
      setPrepError(message);
    } finally {
      event.target.value = '';
    }
  }, [setPrepError, setResumeState]);

  const onRemove = useCallback(async () => {
    if (!resumeState.resumeRef) {
      setResumeState({ resumeRef: null, filename: null, status: 'idle', error: '' });
      return;
    }
    try {
      await deleteResume(resumeState.resumeRef);
    } catch (error) {
      console.error('Failed to delete resume', error);
    }
    setResumeState({ resumeRef: null, filename: null, status: 'idle', error: '' });
  }, [resumeState.resumeRef, setResumeState]);

  const statusLabel = useMemo(() => {
    if (resumeState.status === 'uploading') return 'Uploading…';
    if (resumeState.status === 'uploaded') return 'Resume attached';
    return 'No resume attached (optional)';
  }, [resumeState.status]);

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h3>Resume Upload (optional)</h3>
          <p className="subtle">Attach a file to give the interviewer more context.</p>
        </div>
        {resumeState.status === 'uploaded' && (
          <button type="button" className="tone-button" onClick={onRemove} disabled={isUploading}>
            Remove
          </button>
        )}
      </div>
      <div className="card-body resume-uploader">
        <label className={`upload-dropzone ${isUploading ? 'disabled' : ''}`}>
          <input
            type="file"
            accept=".pdf,.doc,.docx,.txt"
            onChange={onFileChange}
            disabled={isUploading}
          />
          <span>{isUploading ? 'Uploading…' : 'Click to browse PDF, DOC, or TXT (max 5 MB)'}</span>
        </label>
        <div className="resume-status">
          <strong>{statusLabel}</strong>
          {resumeState.filename && (
            <span>
              {resumeState.filename}
              {resumeState.size ? ` • ${(resumeState.size / (1024 * 1024)).toFixed(2)} MB` : ''}
            </span>
          )}
          {resumeState.error && <span className="error">{resumeState.error}</span>}
        </div>
      </div>
    </section>
  );
}


