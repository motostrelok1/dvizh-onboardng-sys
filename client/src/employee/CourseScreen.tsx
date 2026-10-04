import { useEffect, useState } from "react";
import { api } from "../admin/api";

type Test = { id: string; max_attempts: number | null; pass_score: number };
type Lesson = {
  id: string;
  title: string;
  hasText: boolean;
  hasVideo: boolean;
  attachmentsCount: number;
  test: Test | null;
};
type Module = { id: string; title: string; test: Test | null; lessons: Lesson[] };
type Course = { id: string; title: string; description: string | null };
type Assignment = { status: string; deadline: string | null };

const ERROR_MESSAGE: Record<string, string> = {
  deadline_passed: "Срок прохождения этого курса истёк, доступ закрыт.",
  not_assigned: "Этот курс вам не назначен.",
  not_enrolled: "Сначала запишитесь на курс из каталога.",
  not_found: "Курс не найден."
};

export function CourseScreen({ courseId, onBack }: { courseId: string; onBack: () => void }) {
  const [data, setData] = useState<{ course: Course; assignment: Assignment; modules: Module[] } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ course: Course; assignment: Assignment; modules: Module[] }>(`/me/courses/${courseId}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [courseId]);

  return (
    <div style={{ fontFamily: "system-ui", maxWidth: 480, margin: "0 auto", padding: 24 }}>
      <button onClick={onBack} style={{ marginBottom: 12 }}>
        ← Мои курсы
      </button>

      {error && <p style={{ color: "crimson" }}>{ERROR_MESSAGE[error] ?? "Не удалось открыть курс."}</p>}

      {data && (
        <>
          <h1>{data.course.title}</h1>
          {data.course.description && <p style={{ color: "#555" }}>{data.course.description}</p>}
          {data.assignment.deadline && (
            <p style={{ fontSize: 13, color: "#888" }}>
              Срок: {new Date(data.assignment.deadline).toLocaleDateString()}
            </p>
          )}

          {data.modules.map((m) => (
            <div key={m.id} style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12, marginBottom: 10 }}>
              <strong>{m.title}</strong>
              {m.test && <TestBadge test={m.test} />}
              {m.lessons.map((l) => (
                <div
                  key={l.id}
                  style={{
                    marginTop: 8,
                    marginLeft: 12,
                    paddingLeft: 10,
                    borderLeft: "2px solid #eee"
                  }}
                >
                  <div>{l.title}</div>
                  <div style={{ fontSize: 12, color: "#888" }}>
                    {l.hasVideo && "видео · "}
                    {l.hasText && "текст · "}
                    {l.attachmentsCount > 0 && `материалов: ${l.attachmentsCount} · `}
                    {l.test ? "есть тест" : ""}
                  </div>
                </div>
              ))}
            </div>
          ))}

          {data.modules.length === 0 && <p>В этом курсе пока нет модулей.</p>}
        </>
      )}
    </div>
  );
}

function TestBadge({ test }: { test: Test }) {
  return (
    <span style={{ fontSize: 12, marginLeft: 8, color: "#2f6fed" }}>
      · тест (проходной {test.pass_score}%, попыток: {test.max_attempts ?? "∞"})
    </span>
  );
}
