import { useEffect, useState } from "react";
import { api } from "../admin/api";

type Answer = { id: string; text: string };
type Question = { id: string; text: string; multiple: boolean; answers: Answer[]; selectedAnswerIds: string[] };
type Attempt = { id: string; attempt_number: number };
type ReviewAnswer = { id: string; text: string; isCorrect: boolean; wasSelected: boolean };
type ReviewQuestion = { questionId: string; text: string; yourCorrect: boolean; answers: ReviewAnswer[] };
type FinishResult = { score: number; passed: boolean; passScore: number; review?: ReviewQuestion[] };

const ERROR_MESSAGE: Record<string, string> = {
  deadline_passed: "Срок прохождения этого курса истёк, доступ закрыт.",
  not_assigned: "Этот курс вам не назначен.",
  not_enrolled: "Сначала запишитесь на курс из каталога.",
  no_attempts_left: "Попытки закончились.",
  not_found: "Тест не найден."
};

export function TestScreen({ testId, onBack }: { testId: string; onBack: () => void }) {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FinishResult | null>(null);

  function start() {
    setError(null);
    setResult(null);
    api
      .post<{ attempt: Attempt; questions: Question[] }>(`/tests/${testId}/attempts`)
      .then((d) => {
        setAttempt(d.attempt);
        setQuestions(d.questions);
        setIndex(0);
        const initial: Record<string, Set<string>> = {};
        d.questions.forEach((q) => (initial[q.id] = new Set(q.selectedAnswerIds)));
        setSelected(initial);
      })
      .catch((e) => setError(e.message));
  }

  useEffect(start, [testId]);

  function toggle(question: Question, answerId: string) {
    setSelected((prev) => {
      const set = new Set(prev[question.id]);
      if (question.multiple) {
        set.has(answerId) ? set.delete(answerId) : set.add(answerId);
      } else {
        set.clear();
        set.add(answerId);
      }
      return { ...prev, [question.id]: set };
    });
  }

  async function next() {
    const q = questions[index];
    await api.post(`/attempts/${attempt!.id}/answers`, {
      questionId: q.id,
      selectedAnswerIds: Array.from(selected[q.id] ?? [])
    });
    if (index < questions.length - 1) {
      setIndex(index + 1);
    } else {
      const r = await api.post<FinishResult>(`/attempts/${attempt!.id}/finish`);
      setResult(r);
    }
  }

  if (error) {
    return (
      <div style={{ fontFamily: "system-ui", maxWidth: 480, margin: "0 auto", padding: 24 }}>
        <button onClick={onBack} style={{ marginBottom: 12 }}>
          ← Назад
        </button>
        <p style={{ color: "crimson" }}>{ERROR_MESSAGE[error] ?? "Не удалось начать тест."}</p>
      </div>
    );
  }

  if (result) {
    return (
      <div style={{ fontFamily: "system-ui", maxWidth: 480, margin: "0 auto", padding: 24 }}>
        <button onClick={onBack} style={{ marginBottom: 12 }}>
          ← Назад к курсу
        </button>
        <h1 style={{ color: result.passed ? "#1f9d55" : "#d64545" }}>
          {result.passed ? "Тест пройден" : "Тест не пройден"}
        </h1>
        <p>
          Результат: {result.score}% (проходной балл {result.passScore}%)
        </p>
        {!result.passed && (
          <button onClick={start} style={{ marginBottom: 16 }}>
            Пройти ещё раз
          </button>
        )}
        {result.review && (
          <div>
            {result.review.map((q, i) => (
              <div key={q.questionId} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <strong style={{ color: q.yourCorrect ? "#1f9d55" : "#d64545" }}>
                  {i + 1}. {q.text}
                </strong>
                <ul style={{ marginTop: 6 }}>
                  {q.answers.map((a) => (
                    <li
                      key={a.id}
                      style={{
                        color: a.isCorrect ? "#1f9d55" : a.wasSelected ? "#d64545" : undefined,
                        fontWeight: a.wasSelected ? 700 : 400
                      }}
                    >
                      {a.text}
                      {a.isCorrect && " ✓"}
                      {a.wasSelected && !a.isCorrect && " (ваш ответ)"}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (!attempt || questions.length === 0) return <p style={{ padding: 24 }}>Загрузка…</p>;

  const q = questions[index];

  return (
    <div style={{ fontFamily: "system-ui", maxWidth: 480, margin: "0 auto", padding: 24 }}>
      <button onClick={onBack} style={{ marginBottom: 12 }}>
        ← Назад к курсу
      </button>
      <p style={{ color: "#888", fontSize: 13 }}>
        Вопрос {index + 1} из {questions.length} · попытка №{attempt.attempt_number}
      </p>
      <h2>{q.text}</h2>
      {q.multiple && <p style={{ fontSize: 13, color: "#888" }}>Можно выбрать несколько вариантов</p>}

      {q.answers.map((a) => (
        <label key={a.id} style={{ display: "block", padding: 8, border: "1px solid #eee", borderRadius: 8, marginBottom: 6 }}>
          <input
            type={q.multiple ? "checkbox" : "radio"}
            name={q.id}
            checked={selected[q.id]?.has(a.id) ?? false}
            onChange={() => toggle(q, a.id)}
          />{" "}
          {a.text}
        </label>
      ))}

      <button onClick={next} style={{ marginTop: 12 }}>
        {index < questions.length - 1 ? "Далее" : "Завершить тест"}
      </button>
    </div>
  );
}
