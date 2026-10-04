import { useEffect, useState } from "react";
import { api } from "./api";

type Group = { id: string; name: string; member_count: number };
type Employee = { id: string; full_name: string; email: string };
type Member = { id: string; full_name: string; email: string };

export function GroupsTab() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [name, setName] = useState("");
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function reloadGroups() {
    api.get<{ groups: Group[] }>("/admin/groups").then((d) => setGroups(d.groups));
  }

  useEffect(() => {
    reloadGroups();
    api
      .get<{ users: Employee[] }>("/admin/users")
      .then((d) => setEmployees(d.users.filter((u: any) => u.role === "employee")));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await api.post("/admin/groups", { name });
    setName("");
    reloadGroups();
  }

  async function remove(id: string) {
    await api.delete(`/admin/groups/${id}`);
    if (openGroupId === id) setOpenGroupId(null);
    reloadGroups();
  }

  async function openGroup(id: string) {
    setOpenGroupId(id);
    const d = await api.get<{ members: Member[] }>(`/admin/groups/${id}/members`);
    setMembers(d.members);
    setSelected(new Set(d.members.map((m) => m.id)));
  }

  function toggle(userId: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function saveMembers() {
    if (!openGroupId) return;
    await api.put(`/admin/groups/${openGroupId}/members`, { userIds: Array.from(selected) });
    reloadGroups();
    openGroup(openGroupId);
  }

  return (
    <div style={{ display: "flex", gap: 32 }}>
      <div style={{ flex: 1 }}>
        <form onSubmit={create} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input placeholder="Название группы" value={name} onChange={(e) => setName(e.target.value)} required />
          <button type="submit">Добавить</button>
        </form>
        <ul>
          {groups.map((g) => (
            <li key={g.id} style={{ marginBottom: 6 }}>
              <button onClick={() => openGroup(g.id)} style={{ fontWeight: openGroupId === g.id ? 700 : 400 }}>
                {g.name} ({g.member_count})
              </button>{" "}
              <button onClick={() => remove(g.id)} style={{ fontSize: 12 }}>
                удалить
              </button>
            </li>
          ))}
        </ul>
      </div>

      {openGroupId && (
        <div style={{ flex: 1 }}>
          <h3>Участники</h3>
          {employees.map((e) => (
            <label key={e.id} style={{ display: "block" }}>
              <input
                type="checkbox"
                checked={selected.has(e.id)}
                onChange={() => toggle(e.id)}
              />{" "}
              {e.full_name} ({e.email})
            </label>
          ))}
          <button onClick={saveMembers} style={{ marginTop: 8 }}>
            Сохранить состав
          </button>
        </div>
      )}
    </div>
  );
}
