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
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

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
    if (submitting) return;
    setSubmitting(true);
    setFormError("");
    try {
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
    } catch { setFormError("Не удалось назначить курс. Проверьте данные."); }
    finally { setSubmitting(false); }
  }

  async function extendDeadline(id: string) {
    const value = prompt("Новый дедлайн (ГГГГ-ММ-ДД ЧЧ:ММ), пусто — убрать дедлайн");
    if (value === null) return;
    const date = value.trim() ? new Date(value) : null;
    if (date && Number.isNaN(date.getTime())) { window.alert("Неверный формат даты."); return; }
    const iso = date ? date.toISOString() : null;
    await api.post(`/admin/assignments/${id}/extend-deadline`, { deadline: iso });
    reloadAssignments();
  }

  async function unassign(id: string) {
    if (!window.confirm("Снять назначение курса?")) return;
    await api.delete(`/admin/assignments/${id}`);
    reloadAssignments();
  }

  const targetOptions =
    targetType === "user" ? employees : targetType === "group" ? groups : departments;

  return (
    <section className="lms-admin-list-page">
      <div className="lms-dashboard-heading"><div><h2>Назначения курсов</h2><p>Управление обучением сотрудников, групп и отделов</p></div></div>
      <div className="lms-panel"><div className="lms-panel-head"><h3>Новое назначение</h3></div>
        <form onSubmit={assign} className="lms-admin-form">
          <label>Курс<select value={courseId} onChange={e => setCourseId(e.target.value)} required><option value="">Выберите курс</option>{courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
          <label>Кому назначить<select value={targetType} onChange={e => { setTargetType(e.target.value as "user" | "group" | "department"); setTargetId(""); }}><option value="user">Сотруднику</option><option value="group">Группе</option><option value="department">Отделу</option></select></label>
          <label>Получатель<select value={targetId} onChange={e => setTargetId(e.target.value)} required><option value="">Выберите получателя</option>{targetOptions.map(t => <option key={t.id} value={t.id}>{"full_name" in t ? t.full_name : t.name}</option>)}</select></label>
          <label>Срок завершения<input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} /></label>
          <label className="lms-inline-check"><input type="checkbox" checked={isRequired} onChange={e => setIsRequired(e.target.checked)} /> Обязательный курс</label>
          <button type="submit" className="lms-primary-btn" disabled={submitting || !courseId || !targetId}>{submitting ? "Назначаем…" : "Назначить курс"}</button>
        </form>
        {formError && <p role="alert" className="lms-form-error">{formError}</p>}
      </div>
      <div className="lms-panel"><div className="lms-panel-head"><h3>Текущие назначения</h3><span>Всего: {assignments.length}</span></div>
        {assignments.length === 0 ? <div className="lms-empty"><strong>Назначений пока нет</strong>Создайте первое назначение через форму выше.</div> : <div className="lms-table-scroll"><table className="lms-table"><thead><tr><th>Сотрудник</th><th>Курс</th><th>Срок</th><th>Статус</th><th>Действия</th></tr></thead><tbody>{assignments.map(a => <tr key={a.id}><td className="lms-employee-name">{a.user_name}</td><td>{a.course_title}</td><td>{a.deadline ? new Date(a.deadline).toLocaleString() : "—"}</td><td><span className={`lms-status ${a.status === "completed" ? "lms-status-published" : a.status === "overdue" ? "lms-status-overdue" : "lms-status-default"}`}>{STATUS_LABEL[a.status] ?? a.status}</span></td><td><div className="lms-course-actions"><button type="button" className="lms-card-btn" onClick={() => extendDeadline(a.id)}>Изменить срок</button><button type="button" className="lms-delete-btn" onClick={() => unassign(a.id)}>Снять</button></div></td></tr>)}</tbody></table></div>}
      </div>
    </section>
  );
}
