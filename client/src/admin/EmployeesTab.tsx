import { useEffect, useState } from "react";
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

  function reload() {
    api.get<{ users: Employee[] }>("/admin/users").then((d) => setUsers(d.users));
  }

  useEffect(() => {
    reload();
    api.get<{ departments: Department[] }>("/admin/departments").then((d) => setDepartments(d.departments));
  }, []);

  async function createEmployee(e: React.FormEvent) {
    e.preventDefault();
    await api.post("/admin/users", {
      fullName,
      email,
      departmentId: departmentId || undefined,
      timezone
    });
    setFullName("");
    setEmail("");
    reload();
  }

  async function issueInvitation(id: string) {
    const d = await api.post<{ link: string }>(`/admin/users/${id}/invitations`);
    setInviteLinks((m) => ({ ...m, [id]: d.link }));
  }

  return (
    <div>
      <form onSubmit={createEmployee} style={{ marginBottom: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input placeholder="ФИО" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
          <option value="">Без отдела</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Часовой пояс (IANA)"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        />
        <button type="submit">Добавить сотрудника</button>
      </form>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
            <th>ФИО</th>
            <th>Email</th>
            <th>Отдел</th>
            <th>Пояс</th>
            <th>Активен</th>
            <th>Приглашение</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} style={{ borderBottom: "1px solid #eee" }}>
              <td>{u.full_name}</td>
              <td>{u.email}</td>
              <td>{u.department_name ?? "—"}</td>
              <td>{u.timezone}</td>
              <td>{u.is_active ? "да" : "нет"}</td>
              <td>
                {u.role === "employee" && (
                  <>
                    <button onClick={() => issueInvitation(u.id)}>Выпустить ссылку</button>
                    {inviteLinks[u.id] && (
                      <div style={{ fontSize: 12, wordBreak: "break-all" }}>{inviteLinks[u.id]}</div>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
