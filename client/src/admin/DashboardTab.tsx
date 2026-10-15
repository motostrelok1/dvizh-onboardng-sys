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
  flagsCount: number;
  lastSessionAt: string | null;
};
type Summary = {
  totalEmployees: number;
  activeEmployees: number;
  averageProgressPercent: number | null;
  overdueAssignmentsCount: number;
  flaggedEmployeesCount: number;
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
    <div className="lms-dashboard">
      <div className="lms-dashboard-heading">
        <div><h2>Обзор обучения</h2><p>Актуальные показатели и сотрудники, требующие внимания</p></div>
        <div className="lms-filters">
          <select aria-label="Фильтр по отделу" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">Все отделы</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select aria-label="Фильтр по группе" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">Все группы</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
      </div>
      {summary ? (
        <div className="lms-stats">
          <Tile label="Всего сотрудников" value={summary.totalEmployees} />
          <Tile label="Активных за 7 дней" value={summary.activeEmployees} />
          <Tile label="Средний прогресс" value={summary.averageProgressPercent !== null ? `${summary.averageProgressPercent}%` : "—"} />
          <Tile label="Просроченные назначения" value={summary.overdueAssignmentsCount} alert={summary.overdueAssignmentsCount > 0} />
          <Tile label="Требуют внимания" value={summary.flaggedEmployeesCount} alert={summary.flaggedEmployeesCount > 0} />
        </div>
      ) : <div className="lms-panel">Загрузка показателей…</div>}
      <section className="lms-panel">
        <div className="lms-panel-head"><h3>Сотрудники</h3><span>Найдено: {employees.length}</span></div>
        {employees.length === 0 ? (
          <div className="lms-empty"><strong>Сотрудников пока нет</strong>Добавьте сотрудников или измените фильтры, чтобы увидеть результаты.</div>
        ) : (
          <div className="lms-table-scroll">
            <table className="lms-table">
              <thead><tr><th>Сотрудник</th><th>Отдел</th><th>Курсов</th><th>Прогресс</th><th>Просрочено</th><th>Флагов</th><th>Последний вход</th><th>Действие</th></tr></thead>
              <tbody>{employees.map((e) => (
                <tr key={e.id}>
                  <td className="lms-employee-name">{e.fullName}</td>
                  <td>{e.departmentName ?? "—"}</td>
                  <td>{e.assignedCourses}</td>
                  <td>{e.averageProgress !== null ? <>{e.averageProgress}%<div className="lms-progress"><span style={{ width: `${Math.max(0, Math.min(100, e.averageProgress))}%` }} /></div></> : "—"}</td>
                  <td className={e.overdueCount > 0 ? "lms-attention" : ""}>{e.overdueCount || "—"}</td>
                  <td className={e.flagsCount > 0 ? "lms-attention" : ""}>{e.flagsCount || "—"}</td>
                  <td>{e.lastSessionAt ? new Date(e.lastSessionAt).toLocaleString() : "никогда"}</td>
                  <td><button className="lms-card-btn" onClick={() => setOpenEmployeeId(e.id)}>Карточка</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, alert }: { label: string; value: string | number; alert?: boolean }) {
  return <div className={`lms-stat${alert ? " lms-stat-warning" : ""}`}><div className="lms-stat-label">{label}</div><div className="lms-stat-value">{value}</div><div className="lms-stat-accent" /></div>;
}
