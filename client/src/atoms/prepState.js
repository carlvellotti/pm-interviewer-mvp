import { atom } from 'jotai';

export const prepModeAtom = atom('prep'); // prep | interview | history

export const questionOptionsAtom = atom([]);
export const customCategoriesAtom = atom([]);
export const jdQuestionsAtom = atom([]);

export const selectedQuestionIdsAtom = atom([]);
export const selectedQuestionsAtom = atom(get => {
  const selectedIds = get(selectedQuestionIdsAtom);
  const options = get(questionOptionsAtom);
  const custom = get(customCategoriesAtom).flatMap(category => category.questions || []);
  const jdGenerated = get(jdQuestionsAtom);
  const lookup = new Map();
  for (const option of options) {
    lookup.set(option.id, option);
  }
  for (const question of custom) {
    lookup.set(question.id, question);
  }
  for (const question of jdGenerated) {
    lookup.set(question.id, question);
  }
  return selectedIds.map(id => lookup.get(id)).filter(Boolean);
});

export const personaOptionsAtom = atom([]);
export const selectedPersonaAtom = atom('medium');

export const evaluationFocusAtom = atom([]);

export const resumeUploadAtom = atom({ resumeRef: null, filename: null, status: 'idle', error: '' });

export const jdUploadAtom = atom({
  status: 'idle',
  error: '',
  promptSummary: '',
  generatedCategories: []
});

export const jdSummaryAtom = atom('');

export const prepErrorAtom = atom('');
export const isSubmittingPrepAtom = atom(false);

export const reviewSettingsAtom = atom({
  persona: 'medium',
  difficulty: 'medium'
});

export const prepSummaryAtom = atom(get => {
  const selectedQuestions = get(selectedQuestionsAtom);
  return {
    totalQuestions: selectedQuestions.length,
    estimatedDuration: selectedQuestions.reduce((acc, question) => acc + (question.estimatedDuration || 0), 0)
  };
});

export const interviewSessionAtom = atom(null);
export const interviewQuestionStackAtom = atom([]);
export const interviewPersonaAtom = atom(null);
export const interviewResumeAtom = atom(null);

export const prepLoadedAtom = atom(false);


