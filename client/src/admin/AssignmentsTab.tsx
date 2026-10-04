import { useEffect, useState } from "react";
import { api } from "./api";

type Course = { id: string; title: string };
type Employee = { id: string; full_name: string };
type Department = { id: string; name: string };
type Group = { id: string; name: string };
type Assignment = {
  id: string;
  user_name: string;
  course_title: string;
  deadline: string | null;
  status: string;
  is_required: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  assigned: "назначен",
  in_progress: "в процессе",
  completed: "завершён",
  overdue: "просрочен (доступ закрыт)",
  closed: "закрыт"
};

export function AssignmentsTab() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  const [courseId, setCourseId] = useState("");
  const [targetType, setTargetType] = useState<"user" | "group" | "department">("user");
  const [targetId, setTargetId] = useState("");
  const [deadline, setDeadline] = useState("");
  const [isRequired, setIsRequired] = useState(true);

  function reloadAssignments() {
    api.get<{ assignments: Assignment[] }>("/admin/assignments").then((d) => setAssignments(d.assignments));
  }

  useEffect(() => {
    api.get<{ courses: Course[] }>("/admin/courses").then((d) => setCourses(d.courses));
    api
      .get<{ users: (Employee & { role: string })[] }>("/admin/users")
      .then((d) => setEmployees(d.users.filter((u) => u.role === "employee")));
    api.get<{ departments: Department[] }>("/admin/departments").then((d) => setDepartments(d.departments));
    api.get<{ groups: Group[] }>("/admin/groups").then((d) => setGroups(d.groups));
    reloadAssignments();
  }, []);

  async function assign(e: React.FormEvent) {
    e.preventDefault();
    await api.post("/admin/assignments", {
      courseId,
      targetType,
      targetId,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      isRequired
    });
    setTargetId("");
    setDeadline("");
    reloadAssignments();
  }

  async function extendDeadline(id: string) {
    const value = prompt("Новый дедлайн (ГГГГ-ММ-ДД ЧЧ:ММ), пусто — убрать дедлайн");
    if (value === null) return;
    const iso = value.trim() ? new Date(value).toISOString() : null;
    await api.post(`/admin/assignments/${id}/extend-deadline`, { deadline: iso });
    reloadAssignments();
  }

  async function unassign(id: string) {
    await api.delete(`/admin/assignments/${id}`);
    reloadAssignments();
  }

  const targetOptions =
    targetType === "user" ? employees : targetType === "group" ? groups : departments;

  return (
    <div>
      <form onSubmit={assign} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        <select value={courseId} onChange={(e) => setCourseId(e.target.value)} required>
          <option value="">Курс…</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>

        <select
          value={targetType}
          onChange={(e) => {
            setTargetType(e.target.value as any);
            setTargetId("");
          }}
        >
          <option value="user">Сотруднику</option>
          <option value="group">Группе</option>
          <option value="department">Отделу</option>
        </select>

        <select value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
          <option value="">Кому…</option>
          {targetOptions.map((t: any) => (
            <option key={t.id} value={t.id}>
              {t.full_name ?? t.name}
            </option>
          ))}
        </select>

        <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />

        <label>
          <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />{" "}
          обязательный
        </label>

        <button type="submit">Назначить</button>
      </form>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
            <th>Сотрудник</th>
            <th>Курс</th>
            <th>Дедлайн</th>
            <th>Статус</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {assignments.map((a) => (
            <tr key={a.id} style={{ borderBottom: "1px solid #eee" }}>
              <td>{a.user_name}</td>
              <td>{a.course_title}</td>
              <td>{a.deadline ? new Date(a.deadline).toLocaleString() : "—"}</td>
              <td style={{ color: a.status === "overdue" ? "crimson" : undefined }}>
                {STATUS_LABEL[a.status] ?? a.status}
              </td>
              <td>
                <button onClick={() => extendDeadline(a.id)} style={{ fontSize: 12 }}>
                  перенести дедлайн
                </button>{" "}
                <button onClick={() => unassign(a.id)} style={{ fontSize: 12 }}>
                  снять
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
