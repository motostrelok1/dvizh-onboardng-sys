import { useEffect, useState } from "react";
import { api } from "./api";

type Department = { id: string; name: string };
type Group = { id: string; name: string };
type Report = {
  user_id: string;
  full_name: string;
  department_name: string | null;
  generated_at: string;
  trigger: string;
  summary: {
    answers: { today: { correct: number; incorrect: number } };
    sessions: { today: number };
    viewMinutesToday: number;
    tests: { attemptedToday: number; passedToday: number };
  };
  flags: { message: string }[];
};

function yesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function ReportsTab() {
  const [date, setDate] = useState(yesterday());
  const [departments, setDepartments] = useState<Department[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [reports, setReports] = useState<Report[]>([]);
  const [mode, setMode] = useState("login");
  const [scheduleTime, setScheduleTime] = useState("07:00");

  useEffect(() => {
    api.get<{ departments: Department[] }>("/admin/departments").then((d) => setDepartments(d.departments));
    api.get<{ groups: Group[] }>("/admin/groups").then((d) => setGroups(d.groups));
    api.get<{ mode: string; scheduleTime: string }>("/admin/settings/reports").then((d) => {
      setMode(d.mode);
      setScheduleTime(d.scheduleTime);
    });
  }, []);

  function reload() {
    const params = new URLSearchParams({ date });
    if (departmentId) params.set("departmentId", departmentId);
    if (groupId) params.set("groupId", groupId);
    api.get<{ reports: Report[] }>(`/admin/reports/daily?${params}`).then((d) => setReports(d.reports));
  }

  useEffect(reload, [date, departmentId, groupId]);

  async function regenerate() {
    await api.post("/admin/reports/daily/generate", { date });
    reload();
  }

  async function saveReportSettings() {
    await api.put("/admin/settings/reports", { mode, scheduleTime });
  }

  return (
    <div>
      <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12, marginBottom: 16 }}>
        <strong style={{ fontSize: 13 }}>Формирование отчёта</strong>
        <div style={{ display: "flex", gap: 12, marginTop: 6, alignItems: "center" }}>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="login">По входу администратора</option>
            <option value="schedule">По расписанию</option>
            <option value="both">И то и другое</option>
          </select>
          {(mode === "schedule" || mode === "both") && (
            <input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} />
          )}
          <button onClick={saveReportSettings} style={{ fontSize: 12 }}>
            Сохранить
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
          <option value="">Все отделы</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">Все группы</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <button onClick={regenerate}>Обновить</button>
        <a href={`/api/admin/reports/export.csv?from=${date}&to=${date}`} target="_blank" rel="noreferrer">
          Экспорт CSV
        </a>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
            <th>Сотрудник</th>
            <th>Отдел</th>
            <th>Верно/неверно</th>
            <th>Входов</th>
            <th>Минут</th>
            <th>Тестов</th>
            <th>Флаги</th>
          </tr>
        </thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.user_id} style={{ borderBottom: "1px solid #eee" }}>
              <td>{r.full_name}</td>
              <td>{r.department_name ?? "—"}</td>
              <td>
                {r.summary.answers.today.correct} / {r.summary.answers.today.incorrect}
              </td>
              <td>{r.summary.sessions.today}</td>
              <td>{r.summary.viewMinutesToday}</td>
              <td>
                {r.summary.tests.passedToday}/{r.summary.tests.attemptedToday}
              </td>
              <td style={{ color: r.flags.length > 0 ? "#c98000" : undefined }}>{r.flags.length || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {reports.length === 0 && <p style={{ color: "#888" }}>На эту дату отчётов нет.</p>}
    </div>
  );
}
