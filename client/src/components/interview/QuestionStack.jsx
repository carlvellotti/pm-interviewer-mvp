export default function QuestionStack({ questions }) {
  return (
    <section className="card">
      <div className="card-header">
        <h3>Question Stack</h3>
        <p className="subtle">Reference while you interview.</p>
      </div>
      <div className="card-body question-stack">
        {questions.length === 0 ? (
          <div className="empty-state subtle">Question stack unavailable.</div>
        ) : (
          <ul className="question-stack-list">
            {questions.map(question => (
              <li key={question.id} className="question-stack-item">
                <strong>{question.prompt}</strong>
                <div className="question-meta">
                  {question.categoryId && <span className="tag category">{question.categoryId}</span>}
                  {question.source && <span className="tag source">{question.source}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
