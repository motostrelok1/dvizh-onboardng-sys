import { useEffect, useRef, useState } from "react";
import { api } from "./api";

type Employee = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  department_id: string | null;
  department_name: string | null;
  timezone: string;
  is_active: boolean;
};

type Department = { id: string; name: string };

export function EmployeesTab() {
  const [users, setUsers] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [timezone, setTimezone] = useState("Europe/Moscow");
  const [inviteLinks, setInviteLinks] = useState<Record<string, string>>({});
  const [copiedFor, setCopiedFor] = useState<string | null>(null);
  const issuing = useRef(false);
  const [issuingId, setIssuingId] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  function reload() {
    api.get<{ users: Employee[] }>("/admin/users").then((d) => setUsers(d.users));
  }

  useEffect(() => {
    reload();
    api.get<{ departments: Department[] }>("/admin/departments").then((d) => setDepartments(d.departments));
  }, []);

  async function createEmployee(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateError("");
    try {
      await api.post("/admin/users", {
      fullName,
      email,
      departmentId: departmentId || undefined,
      timezone
    });
      setFullName("");
      setEmail("");
      reload();
    } catch {
      setCreateError("Не удалось добавить сотрудника. Проверьте данные и попробуйте снова.");
    } finally { setCreating(false); }
  }

  async function issueInvitation(id: string) {
    if (issuing.current) return;
    issuing.current = true;
    setIssuingId(id);
    setInviteError(null);
    try {
      const d = await api.post<{ link: string }>(`/admin/users/${id}/invitations`);
      // Сервер отдаёт относительный путь (/invite#<токен>) — для отправки
      // сотруднику нужна полная ссылка на домен, где развёрнуто приложение.
      const fullLink = new URL(d.link, window.location.origin).toString();
      setInviteLinks((m) => ({ ...m, [id]: fullLink }));
      setCopiedFor(null);
    } catch (err) {
      setInviteError(err instanceof Error && err.message === "user_inactive"
        ? "Сотрудник отключён. Для восстановления доступа администратор должен сначала включить учётную запись."
        : "Не удалось выпустить приглашение. Обновите список сотрудников и попробуйте снова.");
    } finally {
      issuing.current = false;
      setIssuingId(null);
    }
  }

  async function copyLink(id: string, link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedFor(id);
      setTimeout(() => setCopiedFor((cur) => (cur === id ? null : cur)), 2000);
    } catch {
      // Буфер обмена недоступен (нет разрешения/не HTTPS) — ссылка и так
      // видна текстом рядом с кнопкой, пользователь скопирует вручную.
    }
  }

  return (
    <section className="lms-admin-list-page">
      <div className="lms-dashboard-heading"><div><h2>Сотрудники</h2><p>Учётные записи, отделы и приглашения в LMS</p></div></div>
      <div className="lms-panel">
        <div className="lms-panel-head"><h3>Добавить сотрудника</h3></div>
        <form onSubmit={createEmployee} className="lms-admin-form">
          <label>ФИО<input placeholder="Иванов Иван" value={fullName} onChange={(e) => setFullName(e.target.value)} required disabled={creating}/></label>
          <label>Email<input type="email" placeholder="user@example.ru" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={creating}/></label>
          <label>Отдел<select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}><option value="">Без отдела</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label>Часовой пояс (IANA)<input value={timezone} onChange={(e) => setTimezone(e.target.value)} required /></label>
          <button type="submit" className="lms-primary-btn" disabled={creating}>{creating ? "Добавляем…" : "+ Добавить сотрудника"}</button>
        </form>
        {createError && <p role="alert" className="lms-form-error">{createError}</p>}
      </div>
      <div className="lms-panel">
        <div className="lms-panel-head"><h3>Список сотрудников</h3><span>Всего: {users.length}</span></div>
        <p className="lms-info-note">Новая ссылка отменяет предыдущую. После установки пароля сотрудник выйдет из остальных сессий.</p>
        {inviteError && <p role="alert" className="lms-form-error">{inviteError}</p>}
        {users.length === 0 ? <div className="lms-empty"><strong>Сотрудников пока нет</strong>Добавьте первого сотрудника с помощью формы выше.</div> :
        <div className="lms-table-scroll"><table className="lms-table">
          <thead><tr><th>ФИО</th><th>Email</th><th>Отдел</th><th>Пояс</th><th>Статус</th><th>Приглашение</th></tr></thead>
          <tbody>{users.map(u => <tr key={u.id}>
            <td className="lms-employee-name">{u.full_name}</td><td>{u.email}</td><td>{u.department_name ?? "—"}</td><td>{u.timezone}</td>
            <td><span className={`lms-status ${u.is_active ? "lms-status-published" : "lms-status-archived"}`}>{u.is_active ? "Активен" : "Отключён"}</span></td>
            <td>{u.role === "employee" && <><button type="button" className="lms-card-btn" disabled={!u.is_active || issuingId !== null} title={!u.is_active ? "Учётная запись отключена" : undefined} onClick={() => issueInvitation(u.id)}>{issuingId === u.id ? "Выпускаем…" : "Выпустить ссылку"}</button>
              {inviteLinks[u.id] && <div className="lms-invitation-link"><div>{inviteLinks[u.id]}</div><button type="button" className="lms-card-btn" onClick={() => copyLink(u.id, inviteLinks[u.id])}>{copiedFor === u.id ? "Скопировано" : "Копировать"}</button></div>}</>}</td>
          </tr>)}</tbody>
        </table></div>}
      </div>
    </section>
  );
}
