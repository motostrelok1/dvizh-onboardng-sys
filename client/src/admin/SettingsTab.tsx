import { useEffect, useState } from "react";
import { api } from "./api";
import { NotificationRulesSection } from "./NotificationRulesSection";

type Settings = Record<string, any>;
type ProblemQuestion = {
  questionId: string;
  text: string;
  courseTitle: string | null;
  totalAnswers: number;
  correctPercent: number;
};
type LogEntry = {
  id: string;
  changed_by_name: string | null;
  course_title: string | null;
  key: string;
  old_value: any;
  new_value: any;
  changed_at: string;
};

const RULES: { key: string; label: string; fields: { key: string; label: string; suffix?: string }[] }[] = [
  {
    key: "problem_question",
    label: "Проблемный вопрос",
    fields: [
      { key: "problem_question.min_correct_percent", label: "Процент верных ниже", suffix: "%" },
      { key: "problem_question.min_answers", label: "Минимум ответов для срабатывания" }
    ]
  },
  {
    key: "skipped_lesson",
    label: "«Пролистал, не читая»",
    fields: [{ key: "skipped_lesson.max_percent_of_median", label: "Меньше % от медианного времени", suffix: "%" }]
  },
  {
    key: "needs_help",
    label: "Нужна помощь",
    fields: [{ key: "needs_help.attempts_without_improvement", label: "Попыток подряд без роста" }]
  },
  {
    key: "guessing",
    label: "Угадывание",
    fields: [{ key: "guessing.max_seconds_per_question", label: "Меньше секунд на вопрос", suffix: "с" }]
  },
  {
    key: "stuck",
    label: "Застрял / не начал",
    fields: [{ key: "stuck.inactive_days", label: "Дней без активности", suffix: "дн." }]
  },
  {
    key: "deadline_risk",
    label: "Риск просрочки",
    fields: [
      { key: "deadline_risk.days_before", label: "За сколько дней до дедлайна", suffix: "дн." },
      { key: "deadline_risk.max_progress_percent", label: "Прогресс меньше", suffix: "%" }
    ]
  }
];

export function SettingsTab() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings>({});
  const [problemQuestions, setProblemQuestions] = useState<ProblemQuestion[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [showLog, setShowLog] = useState(false);

  function reload() {
    api.get<{ settings: Settings }>("/admin/settings/analytics").then((d) => {
      setSettings(d.settings);
      setDraft(d.settings);
    });
    api.get<{ questions: ProblemQuestion[] }>("/admin/analytics/problem-questions").then((d) =>
      setProblemQuestions(d.questions)
    );
  }

  useEffect(reload, []);

  function setField(key: string, value: unknown) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function save() {
    const changed: Settings = {};
    for (const key of Object.keys(draft)) {
      if (draft[key] !== settings?.[key]) changed[key] = draft[key];
    }
    if (Object.keys(changed).length === 0) return;
    await api.put("/admin/settings/analytics", changed);
    reload();
  }

  async function resetDefaults() {
    await api.post("/admin/settings/analytics/reset");
    reload();
  }

  async function loadLog() {
    const d = await api.get<{ log: LogEntry[] }>("/admin/settings/log");
    setLog(d.log);
    setShowLog(true);
  }

  if (!settings) return <p>Загрузка…</p>;

  return (
    <div>
      <h2>Пороги правил аналитики</h2>
      <p style={{ color: "#888", fontSize: 13 }}>
        Общие значения. Для отдельного курса их можно переопределить в редакторе курса.
      </p>

      {RULES.map((rule) => (
        <div key={rule.key} style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12, marginBottom: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={!!draft[`${rule.key}.enabled`]}
              onChange={(e) => setField(`${rule.key}.enabled`, e.target.checked)}
            />
            <strong>{rule.label}</strong>
          </label>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginLeft: 24 }}>
            {rule.fields.map((f) => (
              <label key={f.key} style={{ fontSize: 13 }}>
                {f.label}:{" "}
                <input
                  type="number"
                  value={draft[f.key] ?? ""}
                  onChange={(e) => setField(f.key, Number(e.target.value))}
                  style={{ width: 60 }}
                />{" "}
                {f.suffix}
              </label>
            ))}
          </div>
        </div>
      ))}

      <div style={{ marginBottom: 24 }}>
        <button onClick={save}>Сохранить пороги</button>{" "}
        <button onClick={resetDefaults}>Вернуть значения по умолчанию</button>{" "}
        <button onClick={loadLog}>Журнал изменений</button>
      </div>

      {showLog && (
        <div style={{ marginBottom: 24 }}>
          <h3>Журнал изменений настроек</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                <th>Когда</th>
                <th>Кто</th>
                <th>Курс</th>
                <th>Параметр</th>
                <th>Было</th>
                <th>Стало</th>
              </tr>
            </thead>
            <tbody>
              {log.map((l) => (
                <tr key={l.id} style={{ borderBottom: "1px solid #eee" }}>
                  <td>{new Date(l.changed_at).toLocaleString()}</td>
                  <td>{l.changed_by_name ?? "—"}</td>
                  <td>{l.course_title ?? "общие"}</td>
                  <td>{l.key}</td>
                  <td>{JSON.stringify(l.old_value)}</td>
                  <td>{JSON.stringify(l.new_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NotificationRulesSection />

      <h2 style={{ marginTop: 24 }}>Проблемные вопросы</h2>
      {problemQuestions.length === 0 && <p style={{ color: "#888" }}>Пока ничего не превышает порог.</p>}
      {problemQuestions.map((q) => (
        <div key={q.questionId} style={{ border: "1px solid #f0d090", background: "#fff6e5", borderRadius: 8, padding: 10, marginBottom: 6 }}>
          <strong>{q.text}</strong>
          <div style={{ fontSize: 12, color: "#888" }}>
            {q.courseTitle ?? "—"} · верно {q.correctPercent}% из {q.totalAnswers} ответов
          </div>
        </div>
      ))}
    </div>
  );
}
