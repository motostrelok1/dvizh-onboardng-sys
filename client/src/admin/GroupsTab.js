import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "./api";
export function GroupsTab() {
    const [groups, setGroups] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [name, setName] = useState("");
    const [openGroupId, setOpenGroupId] = useState(null);
    const [members, setMembers] = useState([]);
    const [selected, setSelected] = useState(new Set());
    function reloadGroups() {
        api.get("/admin/groups").then((d) => setGroups(d.groups));
    }
    useEffect(() => {
        reloadGroups();
        api
            .get("/admin/users")
            .then((d) => setEmployees(d.users.filter((u) => u.role === "employee")));
    }, []);
    async function create(e) {
        e.preventDefault();
        await api.post("/admin/groups", { name });
        setName("");
        reloadGroups();
    }
    async function remove(id) {
        await api.delete(`/admin/groups/${id}`);
        if (openGroupId === id)
            setOpenGroupId(null);
        reloadGroups();
    }
    async function openGroup(id) {
        setOpenGroupId(id);
        const d = await api.get(`/admin/groups/${id}/members`);
        setMembers(d.members);
        setSelected(new Set(d.members.map((m) => m.id)));
    }
    function toggle(userId) {
        setSelected((s) => {
            const next = new Set(s);
            if (next.has(userId))
                next.delete(userId);
            else
                next.add(userId);
            return next;
        });
    }
    async function saveMembers() {
        if (!openGroupId)
            return;
        await api.put(`/admin/groups/${openGroupId}/members`, { userIds: Array.from(selected) });
        reloadGroups();
        openGroup(openGroupId);
    }
    return (_jsxs("div", { style: { display: "flex", gap: 32 }, children: [_jsxs("div", { style: { flex: 1 }, children: [_jsxs("form", { onSubmit: create, style: { display: "flex", gap: 8, marginBottom: 16 }, children: [_jsx("input", { placeholder: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0433\u0440\u0443\u043F\u043F\u044B", value: name, onChange: (e) => setName(e.target.value), required: true }), _jsx("button", { type: "submit", children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C" })] }), _jsx("ul", { children: groups.map((g) => (_jsxs("li", { style: { marginBottom: 6 }, children: [_jsxs("button", { onClick: () => openGroup(g.id), style: { fontWeight: openGroupId === g.id ? 700 : 400 }, children: [g.name, " (", g.member_count, ")"] }), " ", _jsx("button", { onClick: () => remove(g.id), style: { fontSize: 12 }, children: "\u0443\u0434\u0430\u043B\u0438\u0442\u044C" })] }, g.id))) })] }), openGroupId && (_jsxs("div", { style: { flex: 1 }, children: [_jsx("h3", { children: "\u0423\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0438" }), employees.map((e) => (_jsxs("label", { style: { display: "block" }, children: [_jsx("input", { type: "checkbox", checked: selected.has(e.id), onChange: () => toggle(e.id) }), " ", e.full_name, " (", e.email, ")"] }, e.id))), _jsx("button", { onClick: saveMembers, style: { marginTop: 8 }, children: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0441\u043E\u0441\u0442\u0430\u0432" })] }))] }));
}
