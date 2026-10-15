import { useEffect, useState } from "react";
import { api } from "./api";

type Department = { id: string; name: string };

export function DepartmentsTab() {
  const [items, setItems] = useState<Department[]>([]);
  const [name, setName] = useState("");

  function reload() {
    api.get<{ departments: Department[] }>("/admin/departments").then((d) => setItems(d.departments));
  }

  useEffect(reload, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await api.post("/admin/departments", { name });
    setName("");
    reload();
  }

  async function remove(id: string) {
    if (!window.confirm("Удалить отдел?")) return;
    await api.delete(`/admin/departments/${id}`);
    reload();
  }

  return (
    <section className="lms-admin-list-page">
      <div className="lms-dashboard-heading"><div><h2>Отделы</h2><p>Организационная структура сотрудников</p></div></div>
      <div className="lms-panel"><div className="lms-panel-head"><h3>Новый отдел</h3></div>
      <form onSubmit={create} className="lms-course-create-row">
        <input placeholder="Название отдела" value={name} onChange={(e) => setName(e.target.value)} required />
        <button type="submit">Добавить</button>
      </form></div>
      <div className="lms-panel"><div className="lms-panel-head"><h3>Список отделов</h3><span>Всего: {items.length}</span></div>
      {items.length === 0 && <div className="lms-empty">Отделов пока нет.</div>}
      <ul className="lms-management-list">
        {items.map((d) => (
          <li key={d.id} style={{ marginBottom: 6 }}>
            {d.name}{" "}
            <button onClick={() => remove(d.id)} style={{ fontSize: 12 }}>
              удалить
            </button>
          </li>
        ))}
      </ul></div>
    </section>
  );
}
