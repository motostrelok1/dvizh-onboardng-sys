import { useEffect, useState } from "react";
import { api } from "./api";
import { EmployeeDetail } from "./EmployeeDetail";

type Department = { id: string; name: string };
type Group = { id: string; name: string };
type EmployeeRow = {
  id: string;
  fullName: string;
  departmentName: string | null;
  assignedCourses: number;
  averageProgress: number | null;
  overdueCount: number;
  lastSessionAt: string | null;
};
type Summary = {
  totalEmployees: number;
  activeEmployees: number;
  averageProgressPercent: number | null;
  overdueAssignmentsCount: number;
};

export function DashboardTab() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [openEmployeeId, setOpenEmployeeId] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ departments: Department[] }>("/admin/departments").then((d) => setDepartments(d.departments));
    api.get<{ groups: Group[] }>("/admin/groups").then((d) => setGroups(d.groups));
  }, []);

  function reload() {
    const params = new URLSearchParams();
    if (departmentId) params.set("departmentId", departmentId);
    if (groupId) params.set("groupId", groupId);
    api
      .get<{ summary: Summary; employees: EmployeeRow[] }>(`/admin/dashboard?${params}`)
      .then((d) => {
        setSummary(d.summary);
        setEmployees(d.employees);
      });
  }

  useEffect(reload, [departmentId, groupId]);

  if (openEmployeeId) {
    return <EmployeeDetail userId={openEmployeeId} onBack={() => setOpenEmployeeId(null)} />;
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
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
      </div>

      {summary && (
        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          <Tile label="Сотрудников" value={summary.totalEmployees} />
          <Tile label="Активных (7 дней)" value={summary.activeEmployees} />
          <Tile
            label="Средний прогресс"
            value={summary.averageProgressPercent !== null ? `${summary.averageProgressPercent}%` : "—"}
          />
          <Tile label="Просрочено" value={summary.overdueAssignmentsCount} alert={summary.overdueAssignmentsCount > 0} />
        </div>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
            <th>Сотрудник</th>
            <th>Отдел</th>
            <th>Курсов</th>
            <th>Прогресс</th>
            <th>Просрочено</th>
            <th>Последний вход</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {employees.map((e) => (
            <tr key={e.id} style={{ borderBottom: "1px solid #eee" }}>
              <td>{e.fullName}</td>
              <td>{e.departmentName ?? "—"}</td>
              <td>{e.assignedCourses}</td>
              <td>{e.averageProgress !== null ? `${e.averageProgress}%` : "—"}</td>
              <td style={{ color: e.overdueCount > 0 ? "crimson" : undefined }}>{e.overdueCount || "—"}</td>
              <td>{e.lastSessionAt ? new Date(e.lastSessionAt).toLocaleString() : "никогда"}</td>
              <td>
                <button onClick={() => setOpenEmployeeId(e.id)} style={{ fontSize: 12 }}>
                  карточка
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Tile({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: "10px 16px", minWidth: 100 }}>
      <div style={{ fontSize: 12, color: "#888" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: alert ? "crimson" : undefined }}>{value}</div>
    </div>
  );
}
