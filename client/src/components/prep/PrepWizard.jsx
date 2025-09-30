import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import * as Tabs from '@radix-ui/react-tabs';
import {
  prepModeAtom,
  prepLoadedAtom,
  questionOptionsAtom,
  customCategoriesAtom,
  jdQuestionsAtom,
  selectedQuestionIdsAtom,
  selectedQuestionsAtom,
  personaOptionsAtom,
  reviewSettingsAtom,
  evaluationFocusAtom,
  resumeUploadAtom,
  jdUploadAtom,
  jdSummaryAtom,
  prepErrorAtom,
  isSubmittingPrepAtom,
  prepSummaryAtom,
  interviewSessionAtom,
  interviewQuestionStackAtom,
  interviewPersonaAtom,
  interviewResumeAtom,
  // NEW: Category atoms
  interviewCategoriesAtom,
  selectedCategoryIdAtom,
  selectedCategoryAtom
} from '../../atoms/prepState.js';
import {
  fetchConfiguration,
  fetchCustomCategories,
  createCustomCategory,
  updateCustomCategory,
  deleteCustomCategory,
  uploadJobDescription,
  startInterviewSession
} from '../../services/api.js';
import QuestionSection from './QuestionSection.jsx';
import CustomCategoriesSection from './CustomCategoriesSection.jsx';
import ResumeUploader from './ResumeUploader.jsx';

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

export default function PrepWizard() {
  const setPrepMode = useSetAtom(prepModeAtom);
  const [prepLoaded, setPrepLoaded] = useAtom(prepLoadedAtom);

  const [questionOptions, setQuestionOptions] = useAtom(questionOptionsAtom);
  const [customCategories, setCustomCategories] = useAtom(customCategoriesAtom);
  const setJdGeneratedQuestions = useSetAtom(jdQuestionsAtom);

  const [selectedQuestionIds, setSelectedQuestionIds] = useAtom(selectedQuestionIdsAtom);
  const selectedQuestions = useAtomValue(selectedQuestionsAtom);

  const [personaOptions, setPersonaOptions] = useAtom(personaOptionsAtom);
  const [reviewSettings, setReviewSettings] = useAtom(reviewSettingsAtom);
  const setEvaluationFocus = useSetAtom(evaluationFocusAtom);

  const resumeState = useAtomValue(resumeUploadAtom);
  const [jdUploadState, setJdUploadState] = useAtom(jdUploadAtom);
  const [jdSummary, setJdSummary] = useAtom(jdSummaryAtom);
  const [prepError, setPrepError] = useAtom(prepErrorAtom);
  const [isSubmitting, setIsSubmitting] = useAtom(isSubmittingPrepAtom);
  const prepSummary = useAtomValue(prepSummaryAtom);

  const setInterviewSession = useSetAtom(interviewSessionAtom);
  const setInterviewStack = useSetAtom(interviewQuestionStackAtom);
  const setInterviewPersona = useSetAtom(interviewPersonaAtom);
  const setInterviewResume = useSetAtom(interviewResumeAtom);
  const jdTextRef = useRef('');
  const [jdText, setJdText] = useState('');

  // NEW: Category state
  const [interviewCategories, setInterviewCategories] = useAtom(interviewCategoriesAtom);
  const [selectedCategoryId, setSelectedCategoryId] = useAtom(selectedCategoryIdAtom);
  const selectedCategory = useAtomValue(selectedCategoryAtom);

  const loadInitialConfiguration = useCallback(async () => {
    try {
      setPrepError('');

      const config = await fetchConfiguration();
      const {
        categories: interviewCats = [],  // NEW: Interview categories
        questions = [],                  // OLD: Seed questions (backward compatible)
        evaluationFocus: focusAreas = [],
        personas = [],
        defaults = {}
      } = config || {};

      const safeInterviewCats = ensureArray(interviewCats);
      const safeQuestions = ensureArray(questions);
      const safePersonas = ensureArray(personas);
      const safeFocusAreas = ensureArray(focusAreas);

      // NEW: Set interview categories
      setInterviewCategories(safeInterviewCats);
      
      // OLD: Keep for backward compatibility
      setQuestionOptions(safeQuestions);
      setEvaluationFocus(safeFocusAreas);
      setPersonaOptions(safePersonas.map(persona => ({
        id: persona.id,
        label: persona.label,
        description: persona.description,
        voice: persona.voice
      })));

      setReviewSettings(prev => ({
        ...prev,
        persona:
          (typeof defaults.persona === 'string' && defaults.persona) ||
          prev.persona ||
          safePersonas[0]?.id ||
          'medium',
        difficulty:
          (typeof defaults.difficulty === 'string' && defaults.difficulty) ||
          prev.difficulty ||
          'medium'
      }));

      if (Array.isArray(defaults.questionIds) && defaults.questionIds.length > 0) {
        setSelectedQuestionIds(defaults.questionIds);
      } else {
        const fallbackIds = safeQuestions.slice(0, 3).map(question => question.id).filter(Boolean);
        setSelectedQuestionIds(fallbackIds);
      }

      setJdGeneratedQuestions([]);
      setJdUploadState({ status: 'idle', error: '', promptSummary: '', generatedCategories: [] });
      setJdSummary('');

      const categories = await fetchCustomCategories();
      setCustomCategories(ensureArray(categories));

      setPrepLoaded(true);
    } catch (error) {
      console.error('Failed to load prep configuration', error);
      setPrepError(error?.message || 'Unable to load interview prep data.');
    }
  }, [
    setCustomCategories,
    setEvaluationFocus,
    setInterviewCategories,  // NEW: Added for categories
    setJdGeneratedQuestions,
    setJdSummary,
    setJdUploadState,
    setPersonaOptions,
    setPrepError,
    setPrepLoaded,
    setQuestionOptions,
    setReviewSettings,
    setSelectedQuestionIds
  ]);

  useEffect(() => {
    if (!prepLoaded) {
      loadInitialConfiguration();
    }
  }, [loadInitialConfiguration, prepLoaded]);

  const handleToggleQuestion = useCallback(
    id => {
      setSelectedQuestionIds(prev => (prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]));
    },
    [setSelectedQuestionIds]
  );

  // NEW: Handle category selection
  const handleCategorySelect = useCallback(
    categoryId => {
      // When switching categories, clear question selections
      if (selectedCategoryId !== categoryId) {
        setSelectedQuestionIds([]);
      }
      setSelectedCategoryId(categoryId);
    },
    [selectedCategoryId, setSelectedCategoryId, setSelectedQuestionIds]
  );

  const handleCustomCategoryCreate = useCallback(
    async payload => {
      const category = await createCustomCategory(payload);
      setCustomCategories(prev => [...prev, category]);
    },
    [setCustomCategories]
  );

  const handleCustomCategoryUpdate = useCallback(
    async (id, updates) => {
      try {
        const updated = await updateCustomCategory(id, updates);
        setCustomCategories(prev => prev.map(category => (category.id === id ? updated : category)));
      } catch (error) {
        console.error('Failed to update category', error);
        setPrepError(error?.message || 'Unable to update category.');
      }
    },
    [setCustomCategories, setPrepError]
  );

  const handleCustomCategoryDelete = useCallback(
    async id => {
      await deleteCustomCategory(id);
      const removed = customCategories.find(category => category.id === id);
      setCustomCategories(prev => prev.filter(category => category.id !== id));
      if (removed && Array.isArray(removed.questions)) {
        const removedIds = new Set(removed.questions.map(question => question.id));
        setSelectedQuestionIds(prev => prev.filter(questionId => !removedIds.has(questionId)));
      }
    },
    [customCategories, setCustomCategories, setSelectedQuestionIds]
  );

  const handleJDUpload = useCallback(
    async jobDescription => {
      setJdUploadState({ status: 'uploading', error: '', promptSummary: '', generatedCategories: [] });
      try {
        const result = await uploadJobDescription({ jobDescription });
        const categories = ensureArray(result?.categories).map(category => ({
          title: category.title,
          questions: ensureArray(category.questions).map(question => ({
            ...question,
            prompt: question.text,
            source: 'JD',
            categoryId: category.title
          }))
        }));

        setJdUploadState({
          status: 'success',
          error: '',
          promptSummary: result?.promptSummary || '',
          generatedCategories: categories
        });

        const flattened = categories.flatMap(category => category.questions);
        setJdGeneratedQuestions(flattened);
        setJdSummary(result?.promptSummary || '');
        setJdText('');
        jdTextRef.current = '';
      } catch (error) {
        console.error('JD upload failed', error);
        setJdUploadState({
          status: 'error',
          error: error?.message || 'Failed to process job description.',
          promptSummary: '',
          generatedCategories: []
        });
        setJdGeneratedQuestions([]);
        setJdSummary('');
      }
    },
    [setJdGeneratedQuestions, setJdSummary, setJdUploadState]
  );

  const jdSelectionSections = useMemo(() => {
    if (!jdUploadState.generatedCategories || jdUploadState.generatedCategories.length === 0) {
      return null;
    }

    return jdUploadState.generatedCategories.map(category => (
      <QuestionSection
        key={category.title}
        title={category.title}
        subtitle="Generated from your job description"
        questions={category.questions}
        selectedQuestionIds={selectedQuestionIds}
        onToggle={handleToggleQuestion}
      />
    ));
  }, [handleToggleQuestion, jdUploadState.generatedCategories, selectedQuestionIds]);

  const handleStartInterview = useCallback(async () => {
    if (selectedQuestions.length === 0) {
      setPrepError('Select at least one question before starting.');
      return;
    }

    setPrepError('');
    setIsSubmitting(true);

    try {
      const payload = {
        questionStack: selectedQuestions.map(question => ({
          id: question.id,
          text: question.prompt || question.text,
          source: question.source || null,
          categoryId: question.categoryId || null,
          estimatedDuration: question.estimatedDuration || null
        })),
        persona: { id: reviewSettings.persona },
        difficulty: reviewSettings.difficulty,
        resumeRef: resumeState.resumeRef || null,
        jdSummary: jdSummary || jdUploadState.promptSummary || ''
      };

      const response = await startInterviewSession(payload);

      setInterviewSession(response.session);
      setInterviewStack(response.questionStack || []);
      setInterviewPersona(response.persona || null);
      setInterviewResume(response.resume || null);
      setJdSummary(response.jdSummary || '');
      setPrepMode('interview');
    } catch (error) {
      console.error('Failed to start interview session', error);
      setPrepError(error?.message || 'Unable to start interview.');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    jdSummary,
    jdUploadState.promptSummary,
    resumeState.resumeRef,
    reviewSettings.difficulty,
    reviewSettings.persona,
    selectedQuestions,
    setInterviewPersona,
    setInterviewResume,
    setInterviewSession,
    setInterviewStack,
    setIsSubmitting,
    setJdSummary,
    setPrepError,
    setPrepMode
  ]);

  const totalSelectedQuestions = prepSummary.totalQuestions ?? selectedQuestions.length;
  const estimatedDurationLabel = prepSummary.estimatedDuration
    ? `${prepSummary.estimatedDuration} min`
    : '—';

  if (!prepLoaded) {
    return (
      <div className="prep-wizard loading">
        <div className="spinner" aria-label="Loading interview prep" />
        <p>Loading interview prep data…</p>
      </div>
    );
  }

  return (
    <div className="prep-wizard">
      <header className="prep-header">
        <h2>Interview Prep Wizard</h2>
        <p className="subtle">Curate your question stack, upload context, and start when ready.</p>
      </header>

      <div className="prep-content">
        <div className="prep-tabs">
          <Tabs.Root className="TabsRoot" defaultValue="categories">
            <Tabs.List className="TabsList" aria-label="Prep modes">
              <Tabs.Trigger className="TabsTrigger" value="categories">
                Categories
              </Tabs.Trigger>
              <Tabs.Trigger className="TabsTrigger" value="upload">
                Upload JD
              </Tabs.Trigger>
              <Tabs.Trigger className="TabsTrigger" value="review">
                Review Stack
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content className="TabsContent tab-categories" value="categories" data-mobile-title="Categories" forceMount>
              <div className="categories-tab">
                {/* NEW: Category selector */}
                <section className="card">
                  <div className="card-header">
                    <h3>Select Interview Type</h3>
                    <p className="subtle">Choose one interview category</p>
                  </div>
                  <div className="card-body category-selector">
                    {interviewCategories.map(category => (
                      <label key={category.id} className="category-option">
                        <input
                          type="radio"
                          name="category"
                          checked={selectedCategoryId === category.id}
                          onChange={() => handleCategorySelect(category.id)}
                        />
                        <div className="category-content">
                          <strong>{category.name}</strong>
                          <p className="subtle">{category.description}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </section>

                {/* NEW: Questions appear when category selected */}
                {selectedCategory && (
                  <QuestionSection
                    title={`${selectedCategory.name} Questions`}
                    subtitle="Select questions for your interview"
                    questions={selectedCategory.questions}
                    selectedQuestionIds={selectedQuestionIds}
                    onToggle={handleToggleQuestion}
                  />
                )}

                {/* KEEP: Custom categories */}
                <CustomCategoriesSection
                  categories={customCategories}
                  selectedQuestionIds={selectedQuestionIds}
                  onToggle={handleToggleQuestion}
                  onCreate={handleCustomCategoryCreate}
                  onUpdate={handleCustomCategoryUpdate}
                  onDelete={handleCustomCategoryDelete}
                />
                {jdSelectionSections && jdSelectionSections.length > 0 && (
                  <section className="card">
                    <div className="card-header">
                      <h3>Job Description Suggestions</h3>
                      <p className="subtle">Add AI-generated prompts to your stack.</p>
                    </div>
                    <div className="card-body merged-question-sections">{jdSelectionSections}</div>
                  </section>
                )}
              </div>
            </Tabs.Content>

            <Tabs.Content className="TabsContent tab-upload" value="upload" data-mobile-title="Upload Job Description" forceMount>
              <section className="card">
                <div className="card-header">
                  <h3>Job Description Paste</h3>
                  <p className="subtle">Paste a job description to generate tailored prompts.</p>
                </div>
                <div className="card-body">
                  <label className="textarea-label">
                    <span className="textarea-title">Job Description Text</span>
                    <textarea
                      className="jd-textarea"
                      rows={12}
                      placeholder="Paste the job description here..."
                      disabled={jdUploadState.status === 'uploading'}
                      onChange={event => {
                        jdTextRef.current = event.target.value;
                        setJdText(event.target.value);
                        if (jdUploadState.error) {
                          setJdUploadState(prev => ({ ...prev, error: '' }));
                        }
                      }}
                      value={jdText}
                    />
                  </label>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      const text = jdTextRef.current.trim();
                      if (!text) {
                        setJdUploadState(prev => ({ ...prev, error: 'Paste a job description before generating.' }));
                        return;
                      }
                      setJdUploadState(prev => ({ ...prev, error: '' }));
                      handleJDUpload(text);
                    }}
                    disabled={jdUploadState.status === 'uploading'}
                  >
                    {jdUploadState.status === 'uploading' ? 'Generating…' : 'Generate Questions'}
                  </button>
                  {jdUploadState.error && <div className="error">{jdUploadState.error}</div>}
                  {jdUploadState.status === 'success' && jdUploadState.generatedCategories.length > 0 && (
                    <div className="generated-results">
                      <strong>Generated categories</strong>
                      <p className="subtle">Switch to the Categories tab to add these prompts.</p>
                      <ul>
                        {jdUploadState.generatedCategories.map(category => (
                          <li key={category.title}>
                            {category.title} ({category.questions.length})
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {jdUploadState.status === 'success' && jdUploadState.generatedCategories.length === 0 && (
                    <div className="generated-results subtle">No questions generated. Try another file.</div>
                  )}
                </div>
              </section>
            </Tabs.Content>

            <Tabs.Content className="TabsContent tab-review" value="review" data-mobile-title="Review Question Stack" forceMount>
              <section className="card">
                <div className="card-header">
                  <h3>Review Question Stack</h3>
                  <p className="subtle">Remove questions before starting.</p>
                </div>
                <div className="card-body review-list">
                  {selectedQuestions.length === 0 ? (
                    <div className="empty-state subtle">No questions selected yet.</div>
                  ) : (
                    selectedQuestions.map(question => (
                      <div key={question.id} className="review-item">
                        <div>
                          <strong>{question.prompt || question.text}</strong>
                          {question.source && <span className="tag source">{question.source}</span>}
                          {question.categoryId && <span className="tag category">{question.categoryId}</span>}
                        </div>
                        <button type="button" className="link-button danger" onClick={() => handleToggleQuestion(question.id)}>
                          Remove
                        </button>
                      </div>
                    ))
                  )}
                </div>
                {(jdSummary || resumeState.filename) && (
                  <div className="card-footer">
                    {jdSummary && (
                      <div className="summary-block">
                        <strong>JD Summary</strong>
                        <p>{jdSummary}</p>
                      </div>
                    )}
                    {resumeState.filename && (
                      <div className="summary-block">
                        <strong>Resume Attached</strong>
                        <p>{resumeState.filename}</p>
                      </div>
                    )}
                  </div>
                )}
              </section>
            </Tabs.Content>
          </Tabs.Root>
        </div>

        <aside className="prep-sidebar">
          <ResumeUploader />
          <section className="card">
            <div className="card-header">
              <h3>Prep Summary</h3>
            </div>
            <div className="card-body summary-card">
              <div>
                <span className="label">Questions selected</span>
                <strong>{totalSelectedQuestions}</strong>
              </div>
              <div>
                <span className="label">Est. Duration</span>
                <strong>{estimatedDurationLabel}</strong>
              </div>
              <div>
                <span className="label">JD summary</span>
                <strong>{jdSummary ? 'Included' : 'Not provided'}</strong>
              </div>
              <div>
                <span className="label">Resume</span>
                <strong>{resumeState.filename ? resumeState.filename : 'Not attached'}</strong>
              </div>
            </div>
          </section>
          <section className="card">
            <div className="card-header">
              <h3>Interview Settings</h3>
            </div>
            <div className="card-body interview-settings">
              <label>
                <span className="label">Difficulty</span>
                <select
                  value={reviewSettings.difficulty}
                  onChange={event =>
                    setReviewSettings(prev => ({
                      ...prev,
                      difficulty: event.target.value
                    }))
                  }
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
              </label>
              <button type="button" className="primary big-button" onClick={handleStartInterview} disabled={isSubmitting || selectedQuestions.length === 0}>
                {isSubmitting ? 'Starting…' : 'Start Interview'}
              </button>
            </div>
          </section>
        </aside>
      </div>

      {prepError && prepError.trim().length > 0 && (
        <div className="banner error fixed-bottom">{prepError}</div>
      )}
    </div>
  );
}


