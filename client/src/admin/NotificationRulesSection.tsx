import { useEffect, useState } from "react";
import { api } from "./api";

type Course = { id: string; title: string };
type Rule = {
  id: string;
  course_id: string | null;
  course_title: string | null;
  kind: string;
  offset_days: number;
  channel: string;
  is_active: boolean;
};

const KIND_LABEL: Record<string, string> = {
  before_deadline: "За N дней до дедлайна",
  on_deadline: "В день дедлайна",
  overdue: "При просрочке"
};

export function NotificationRulesSection() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [kind, setKind] = useState("before_deadline");
  const [offsetDays, setOffsetDays] = useState(3);
  const [channel, setChannel] = useState("in_app");
  const [courseId, setCourseId] = useState("");

  function reload() {
    api.get<{ rules: Rule[] }>("/admin/notification-rules").then((d) => setRules(d.rules));
  }

  useEffect(() => {
    reload();
    api.get<{ courses: Course[] }>("/admin/courses").then((d) => setCourses(d.courses));
  }, []);

  async function addRule(e: React.FormEvent) {
    e.preventDefault();
    await api.post("/admin/notification-rules", {
      courseId: courseId || null,
      kind,
      offsetDays: kind === "before_deadline" ? offsetDays : 0,
      channel
    });
    reload();
  }

  async function toggleActive(r: Rule) {
    await api.patch(`/admin/notification-rules/${r.id}`, { isActive: !r.is_active });
    reload();
  }

  async function remove(id: string) {
    await api.delete(`/admin/notification-rules/${id}`);
    reload();
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h2>Правила уведомлений о дедлайнах</h2>

      <form onSubmit={addRule} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="before_deadline">За N дней до дедлайна</option>
          <option value="on_deadline">В день дедлайна</option>
          <option value="overdue">При просрочке</option>
        </select>
        {kind === "before_deadline" && (
          <input
            type="number"
            min={1}
            value={offsetDays}
            onChange={(e) => setOffsetDays(Number(e.target.value))}
            style={{ width: 60 }}
          />
        )}
        <select value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="in_app">В приложении</option>
          <option value="push">Push</option>
        </select>
        <select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
          <option value="">Все курсы</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <button type="submit">Добавить правило</button>
      </form>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
            <th>Когда</th>
            <th>Канал</th>
            <th>Курс</th>
            <th>Активно</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid #eee" }}>
              <td>
                {KIND_LABEL[r.kind]}
                {r.kind === "before_deadline" && ` (${r.offset_days} дн.)`}
              </td>
              <td>{r.channel === "push" ? "Push" : "В приложении"}</td>
              <td>{r.course_title ?? "все курсы"}</td>
              <td>
                <input type="checkbox" checked={r.is_active} onChange={() => toggleActive(r)} />
              </td>
              <td>
                <button onClick={() => remove(r.id)} style={{ fontSize: 12 }}>
                  удалить
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
