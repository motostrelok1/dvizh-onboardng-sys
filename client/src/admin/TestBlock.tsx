import { useState } from "react";
import { api } from "./api";

type Answer = { id: string; text: string; is_correct: boolean };
type Question = { id: string; text: string; multiple: boolean; answers: Answer[] };
type Test = {
  id: string;
  max_attempts: number | null;
  show_correct_answers: boolean;
  pass_score: number;
};
type TestDetail = { test: Test; questions: Question[] };

export function TestBlock({
  test,
  scope,
  parentId,
  onReload
}: {
  test: Test | null;
  scope: "module" | "lesson";
  parentId: string;
  onReload: () => void;
}) {
  const [detail, setDetail] = useState<TestDetail | null>(null);
  const [open, setOpen] = useState(false);

  async function createTest() {
    await api.post("/admin/tests", { scope, parentId });
    onReload();
  }

  async function openTest() {
    if (!test) return;
    const d = await api.get<TestDetail>(`/admin/tests/${test.id}`);
    setDetail(d);
    setOpen(true);
  }

  async function removeTest() {
    if (!test) return;
    await api.delete(`/admin/tests/${test.id}`);
    setOpen(false);
    onReload();
  }

  if (!test) {
    return (
      <button onClick={createTest} style={{ fontSize: 12 }}>
        + добавить тест
      </button>
    );
  }

  if (!open) {
    return (
      <button onClick={openTest} style={{ fontSize: 12 }}>
        📝 тест ({test.max_attempts ?? "∞"} попыт., проходной {test.pass_score}%)
      </button>
    );
  }

  return (
    <div style={{ background: "#eef", border: "1px solid #ccd", borderRadius: 6, padding: 10, marginTop: 6 }}>
      <TestSettings test={test} onSaved={openTest} />
      {detail && (
        <QuestionsEditor testId={test.id} questions={detail.questions} onReload={openTest} />
      )}
      <div style={{ marginTop: 8 }}>
        <button onClick={() => setOpen(false)} style={{ fontSize: 12 }}>
          свернуть
        </button>{" "}
        <button onClick={removeTest} style={{ fontSize: 12 }}>
          удалить тест
        </button>
      </div>
    </div>
  );
}

function TestSettings({ test, onSaved }: { test: Test; onSaved: () => void }) {
  const [maxAttempts, setMaxAttempts] = useState(test.max_attempts?.toString() ?? "");
  const [showCorrect, setShowCorrect] = useState(test.show_correct_answers);
  const [passScore, setPassScore] = useState(test.pass_score);

  async function save() {
    await api.patch(`/admin/tests/${test.id}`, {
      maxAttempts: maxAttempts === "" ? null : Number(maxAttempts),
      showCorrectAnswers: showCorrect,
      passScore
    });
    onSaved();
  }

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
      <label>
        Попыток (пусто = безлимит):{" "}
        <input
          type="number"
          min={1}
          value={maxAttempts}
          onChange={(e) => setMaxAttempts(e.target.value)}
          style={{ width: 60 }}
        />
      </label>
      <label>
        <input type="checkbox" checked={showCorrect} onChange={(e) => setShowCorrect(e.target.checked)} />{" "}
        показывать правильные ответы
      </label>
      <label>
        Проходной балл, %:{" "}
        <input
          type="number"
          min={0}
          max={100}
          value={passScore}
          onChange={(e) => setPassScore(Number(e.target.value))}
          style={{ width: 50 }}
        />
      </label>
      <button onClick={save}>Сохранить настройки</button>
    </div>
  );
}

function QuestionsEditor({
  testId,
  questions,
  onReload
}: {
  testId: string;
  questions: Question[];
  onReload: () => void;
}) {
  const [newQuestion, setNewQuestion] = useState("");
  const [multiple, setMultiple] = useState(false);

  async function addQuestion(e: React.FormEvent) {
    e.preventDefault();
    await api.post(`/admin/tests/${testId}/questions`, { text: newQuestion, multiple });
    setNewQuestion("");
    setMultiple(false);
    onReload();
  }

  async function removeQuestion(id: string) {
    await api.delete(`/admin/questions/${id}`);
    onReload();
  }

  return (
    <div style={{ marginTop: 10 }}>
      {questions.map((q, i) => (
        <QuestionBlock key={q.id} index={i + 1} question={q} onReload={onReload} onRemove={() => removeQuestion(q.id)} />
      ))}

      <form onSubmit={addQuestion} style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
        <input
          placeholder="Текст вопроса"
          value={newQuestion}
          onChange={(e) => setNewQuestion(e.target.value)}
          required
          style={{ flex: 1 }}
        />
        <label style={{ fontSize: 12 }}>
          <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} /> неск. верных
        </label>
        <button type="submit">Добавить вопрос</button>
      </form>
    </div>
  );
}

function QuestionBlock({
  index,
  question,
  onReload,
  onRemove
}: {
  index: number;
  question: Question;
  onReload: () => void;
  onRemove: () => void;
}) {
  const [newAnswer, setNewAnswer] = useState("");
  const [newCorrect, setNewCorrect] = useState(false);

  async function addAnswer(e: React.FormEvent) {
    e.preventDefault();
    await api.post(`/admin/questions/${question.id}/answers`, { text: newAnswer, isCorrect: newCorrect });
    setNewAnswer("");
    setNewCorrect(false);
    onReload();
  }

  async function toggleCorrect(a: Answer) {
    await api.patch(`/admin/answers/${a.id}`, { isCorrect: !a.is_correct });
    onReload();
  }

  async function removeAnswer(id: string) {
    await api.delete(`/admin/answers/${id}`);
    onReload();
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 6, padding: 8, marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 13 }}>
          {index}. {question.text} {question.multiple && "(неск. верных)"}
        </strong>
        <button onClick={onRemove} style={{ fontSize: 11 }}>
          удалить вопрос
        </button>
      </div>
      <ul style={{ margin: "6px 0", paddingLeft: 18 }}>
        {question.answers.map((a) => (
          <li key={a.id} style={{ fontSize: 13 }}>
            <label>
              <input type="checkbox" checked={a.is_correct} onChange={() => toggleCorrect(a)} /> {a.text}
            </label>{" "}
            <button onClick={() => removeAnswer(a.id)} style={{ fontSize: 11 }}>
              удалить
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={addAnswer} style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          placeholder="Вариант ответа"
          value={newAnswer}
          onChange={(e) => setNewAnswer(e.target.value)}
          required
          style={{ fontSize: 12 }}
        />
        <label style={{ fontSize: 12 }}>
          <input type="checkbox" checked={newCorrect} onChange={(e) => setNewCorrect(e.target.checked)} /> верный
        </label>
        <button type="submit" style={{ fontSize: 12 }}>
          Добавить
        </button>
      </form>
    </div>
  );
}
