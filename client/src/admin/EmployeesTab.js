import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "./api";
export function EmployeesTab() {
    const [users, setUsers] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [fullName, setFullName] = useState("");
    const [email, setEmail] = useState("");
    const [departmentId, setDepartmentId] = useState("");
    const [timezone, setTimezone] = useState("Europe/Moscow");
    const [inviteLinks, setInviteLinks] = useState({});
    function reload() {
        api.get("/admin/users").then((d) => setUsers(d.users));
    }
    useEffect(() => {
        reload();
        api.get("/admin/departments").then((d) => setDepartments(d.departments));
    }, []);
    async function createEmployee(e) {
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
    async function issueInvitation(id) {
        const d = await api.post(`/admin/users/${id}/invitations`);
        setInviteLinks((m) => ({ ...m, [id]: d.link }));
    }
    return (_jsxs("div", { children: [_jsxs("form", { onSubmit: createEmployee, style: { marginBottom: 20, display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsx("input", { placeholder: "\u0424\u0418\u041E", value: fullName, onChange: (e) => setFullName(e.target.value), required: true }), _jsx("input", { placeholder: "Email", value: email, onChange: (e) => setEmail(e.target.value), required: true }), _jsxs("select", { value: departmentId, onChange: (e) => setDepartmentId(e.target.value), children: [_jsx("option", { value: "", children: "\u0411\u0435\u0437 \u043E\u0442\u0434\u0435\u043B\u0430" }), departments.map((d) => (_jsx("option", { value: d.id, children: d.name }, d.id)))] }), _jsx("input", { placeholder: "\u0427\u0430\u0441\u043E\u0432\u043E\u0439 \u043F\u043E\u044F\u0441 (IANA)", value: timezone, onChange: (e) => setTimezone(e.target.value) }), _jsx("button", { type: "submit", children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0430" })] }), _jsxs("table", { style: { width: "100%", borderCollapse: "collapse" }, children: [_jsx("thead", { children: _jsxs("tr", { style: { textAlign: "left", borderBottom: "1px solid #ccc" }, children: [_jsx("th", { children: "\u0424\u0418\u041E" }), _jsx("th", { children: "Email" }), _jsx("th", { children: "\u041E\u0442\u0434\u0435\u043B" }), _jsx("th", { children: "\u041F\u043E\u044F\u0441" }), _jsx("th", { children: "\u0410\u043A\u0442\u0438\u0432\u0435\u043D" }), _jsx("th", { children: "\u041F\u0440\u0438\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u0435" })] }) }), _jsx("tbody", { children: users.map((u) => (_jsxs("tr", { style: { borderBottom: "1px solid #eee" }, children: [_jsx("td", { children: u.full_name }), _jsx("td", { children: u.email }), _jsx("td", { children: u.department_name ?? "—" }), _jsx("td", { children: u.timezone }), _jsx("td", { children: u.is_active ? "да" : "нет" }), _jsx("td", { children: u.role === "employee" && (_jsxs(_Fragment, { children: [_jsx("button", { onClick: () => issueInvitation(u.id), children: "\u0412\u044B\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u0441\u0441\u044B\u043B\u043A\u0443" }), inviteLinks[u.id] && (_jsx("div", { style: { fontSize: 12, wordBreak: "break-all" }, children: inviteLinks[u.id] }))] })) })] }, u.id))) })] })] }));
}
