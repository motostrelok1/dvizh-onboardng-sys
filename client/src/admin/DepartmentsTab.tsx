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
    await api.delete(`/admin/departments/${id}`);
    reload();
  }

  return (
    <div>
      <form onSubmit={create} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input placeholder="Название отдела" value={name} onChange={(e) => setName(e.target.value)} required />
        <button type="submit">Добавить</button>
      </form>
      <ul>
        {items.map((d) => (
          <li key={d.id} style={{ marginBottom: 6 }}>
            {d.name}{" "}
            <button onClick={() => remove(d.id)} style={{ fontSize: 12 }}>
              удалить
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
