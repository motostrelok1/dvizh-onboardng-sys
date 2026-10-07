import { useEffect, useState } from "react";
import { api } from "./api";

const FIELDS: { key: string; label: string }[] = [
  { key: "problem_question.min_correct_percent", label: "Проблемный вопрос: верных ниже, %" },
  { key: "problem_question.min_answers", label: "Проблемный вопрос: минимум ответов" },
  { key: "skipped_lesson.max_percent_of_median", label: "Пролистал: меньше % от медианы" },
  { key: "needs_help.attempts_without_improvement", label: "Нужна помощь: попыток подряд" },
  { key: "guessing.max_seconds_per_question", label: "Угадывание: меньше секунд на вопрос" },
  { key: "stuck.inactive_days", label: "Застрял: дней без активности" },
  { key: "deadline_risk.days_before", label: "Риск просрочки: за сколько дней" },
  { key: "deadline_risk.max_progress_percent", label: "Риск просрочки: прогресс меньше, %" }
];

export function CourseAnalyticsSettings({ courseId }: { courseId: string }) {
  const [open, setOpen] = useState(false);
  const [effective, setEffective] = useState<Record<string, any>>({});
  const [overrides, setOverrides] = useState<Record<string, any>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});

  function reload() {
    api
      .get<{ effective: Record<string, any>; overrides: Record<string, any> }>(
        `/admin/courses/${courseId}/analytics-settings`
      )
      .then((d) => {
        setEffective(d.effective);
        setOverrides(d.overrides);
        const draftInit: Record<string, string> = {};
        for (const f of FIELDS) draftInit[f.key] = d.overrides[f.key] !== undefined ? String(d.overrides[f.key]) : "";
        setDraft(draftInit);
      });
  }

  useEffect(() => {
    if (open) reload();
  }, [open]);

  async function save() {
    const patch: Record<string, number> = {};
    for (const f of FIELDS) {
      if (draft[f.key] !== "" && Number(draft[f.key]) !== overrides[f.key]) {
        patch[f.key] = Number(draft[f.key]);
      }
    }
    if (Object.keys(patch).length > 0) {
      await api.put(`/admin/courses/${courseId}/analytics-settings`, patch);
    }
    reload();
  }

  async function resetAll() {
    await api.post(`/admin/courses/${courseId}/analytics-settings/reset`);
    reload();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ fontSize: 12 }}>
        Пороги аналитики курса
      </button>
    );
  }

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10, marginTop: 8 }}>
      <strong style={{ fontSize: 13 }}>Пороги аналитики для этого курса</strong>
      <p style={{ fontSize: 12, color: "#888" }}>
        Пусто — используется общее значение. Заполните, чтобы переопределить только для этого курса.
      </p>
      {FIELDS.map((f) => (
        <div key={f.key} style={{ fontSize: 13, marginBottom: 6 }}>
          {f.label}:{" "}
          <input
            type="number"
            placeholder={String(effective[f.key] ?? "")}
            value={draft[f.key] ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            style={{ width: 70 }}
          />
        </div>
      ))}
      <button onClick={save} style={{ fontSize: 12 }}>
        Сохранить
      </button>{" "}
      <button onClick={resetAll} style={{ fontSize: 12 }}>
        Сбросить переопределения
      </button>{" "}
      <button onClick={() => setOpen(false)} style={{ fontSize: 12 }}>
        Свернуть
      </button>
    </div>
  );
}
