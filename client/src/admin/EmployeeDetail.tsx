import { useEffect, useState } from "react";
import { api } from "./api";

type Assignment = {
  id: string;
  course_title: string;
  status: string;
  deadline: string | null;
  progress: { totalLessons: number; viewedLessons: number; percent: number };
};
type Stats = {
  totalSessions: number;
  correctAnswers: number;
  incorrectAnswers: number;
  testAttempts: number;
  totalViewMinutes: number;
};
type Event = { event_type: string; entity_type: string | null; payload: Record<string, any>; occurred_at: string };
type Flag = { rule: string; message: string; courseTitle?: string };
type Log = {
  user: { fullName: string; email: string; departmentName: string | null; timezone: string; isActive: boolean };
  assignments: Assignment[];
  stats: Stats;
  flags: Flag[];
  recentEvents: Event[];
};

const STATUS_LABEL: Record<string, string> = {
  assigned: "назначен",
  in_progress: "в процессе",
  completed: "завершён",
  overdue: "просрочен (доступ закрыт)",
  closed: "закрыт"
};

const EVENT_LABEL: Record<string, string> = {
  session_start: "Вход в систему",
  session_end: "Выход",
  lesson_view_start: "Открыл урок",
  lesson_view_end: "Закрыл урок",
  test_attempt_start: "Начал попытку теста",
  test_attempt_end: "Завершил попытку теста",
  question_answered: "Ответил на вопрос",
  assignment_created: "Назначен курс",
  deadline_extended: "Перенесён дедлайн",
  access_closed: "Доступ закрыт (просрочка)",
  attachment_download: "Скачал материал"
};

export function EmployeeDetail({ userId, onBack }: { userId: string; onBack: () => void }) {
  const [log, setLog] = useState<Log | null>(null);

  useEffect(() => {
    api.get<Log>(`/admin/users/${userId}/log`).then(setLog);
  }, [userId]);

  if (!log) return <p>Загрузка…</p>;

  return (
    <div>
      <button onClick={onBack} style={{ marginBottom: 12 }}>
        ← К дашборду
      </button>

      <h2>{log.user.fullName}</h2>
      <p style={{ color: "#666", fontSize: 13 }}>
        {log.user.email} · {log.user.departmentName ?? "без отдела"} · пояс {log.user.timezone} ·{" "}
        {log.user.isActive ? "активен" : "деактивирован"}
      </p>

      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <Tile label="Входов" value={log.stats.totalSessions} />
        <Tile label="Верных ответов" value={log.stats.correctAnswers} />
        <Tile label="Неверных ответов" value={log.stats.incorrectAnswers} />
        <Tile label="Попыток тестов" value={log.stats.testAttempts} />
        <Tile label="Времени на уроках" value={`${log.stats.totalViewMinutes} мин`} />
      </div>

      {log.flags.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3>На что обратить внимание</h3>
          {log.flags.map((f, i) => (
            <div
              key={i}
              style={{ background: "#fff6e5", border: "1px solid #f0d090", borderRadius: 8, padding: 8, marginBottom: 6, fontSize: 13 }}
            >
              {f.message}
            </div>
          ))}
        </div>
      )}

      <h3>Курсы</h3>
      {log.assignments.map((a) => (
        <div key={a.id} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>{a.course_title}</strong>
            <span style={{ fontSize: 12, color: a.status === "overdue" ? "crimson" : "#666" }}>
              {STATUS_LABEL[a.status] ?? a.status}
            </span>
          </div>
          <div style={{ height: 6, background: "#eee", borderRadius: 99, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${a.progress.percent}%`, background: "#2f6fed" }} />
          </div>
          <div style={{ fontSize: 12, color: "#888" }}>
            {a.progress.viewedLessons} из {a.progress.totalLessons} уроков просмотрено ({a.progress.percent}%)
            {a.deadline && ` · срок: ${new Date(a.deadline).toLocaleDateString()}`}
          </div>
        </div>
      ))}

      <h3 style={{ marginTop: 20 }}>Последние события</h3>
      <ul style={{ paddingLeft: 18 }}>
        {log.recentEvents.map((e, i) => (
          <li key={i} style={{ fontSize: 13, marginBottom: 4 }}>
            <span style={{ color: "#888" }}>{new Date(e.occurred_at).toLocaleString()}</span> —{" "}
            {EVENT_LABEL[e.event_type] ?? e.event_type}
            {e.payload?.score !== undefined && ` (результат ${e.payload.score}%)`}
            {e.payload?.fileName && ` — ${e.payload.fileName}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: "10px 16px", minWidth: 100 }}>
      <div style={{ fontSize: 12, color: "#888" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
