import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "./api";
const STATUS_LABEL = {
    assigned: "назначен",
    in_progress: "в процессе",
    completed: "завершён",
    overdue: "просрочен (доступ закрыт)",
    closed: "закрыт"
};
export function AssignmentsTab() {
    const [courses, setCourses] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [groups, setGroups] = useState([]);
    const [assignments, setAssignments] = useState([]);
    const [courseId, setCourseId] = useState("");
    const [targetType, setTargetType] = useState("user");
    const [targetId, setTargetId] = useState("");
    const [deadline, setDeadline] = useState("");
    const [isRequired, setIsRequired] = useState(true);
    function reloadAssignments() {
        api.get("/admin/assignments").then((d) => setAssignments(d.assignments));
    }
    useEffect(() => {
        api.get("/admin/courses").then((d) => setCourses(d.courses));
        api
            .get("/admin/users")
            .then((d) => setEmployees(d.users.filter((u) => u.role === "employee")));
        api.get("/admin/departments").then((d) => setDepartments(d.departments));
        api.get("/admin/groups").then((d) => setGroups(d.groups));
        reloadAssignments();
    }, []);
    async function assign(e) {
        e.preventDefault();
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
    }
    async function extendDeadline(id) {
        const value = prompt("Новый дедлайн (ГГГГ-ММ-ДД ЧЧ:ММ), пусто — убрать дедлайн");
        if (value === null)
            return;
        const iso = value.trim() ? new Date(value).toISOString() : null;
        await api.post(`/admin/assignments/${id}/extend-deadline`, { deadline: iso });
        reloadAssignments();
    }
    async function unassign(id) {
        await api.delete(`/admin/assignments/${id}`);
        reloadAssignments();
    }
    const targetOptions = targetType === "user" ? employees : targetType === "group" ? groups : departments;
    return (_jsxs("div", { children: [_jsxs("form", { onSubmit: assign, style: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }, children: [_jsxs("select", { value: courseId, onChange: (e) => setCourseId(e.target.value), required: true, children: [_jsx("option", { value: "", children: "\u041A\u0443\u0440\u0441\u2026" }), courses.map((c) => (_jsx("option", { value: c.id, children: c.title }, c.id)))] }), _jsxs("select", { value: targetType, onChange: (e) => {
                            setTargetType(e.target.value);
                            setTargetId("");
                        }, children: [_jsx("option", { value: "user", children: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0443" }), _jsx("option", { value: "group", children: "\u0413\u0440\u0443\u043F\u043F\u0435" }), _jsx("option", { value: "department", children: "\u041E\u0442\u0434\u0435\u043B\u0443" })] }), _jsxs("select", { value: targetId, onChange: (e) => setTargetId(e.target.value), required: true, children: [_jsx("option", { value: "", children: "\u041A\u043E\u043C\u0443\u2026" }), targetOptions.map((t) => (_jsx("option", { value: t.id, children: t.full_name ?? t.name }, t.id)))] }), _jsx("input", { type: "datetime-local", value: deadline, onChange: (e) => setDeadline(e.target.value) }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: isRequired, onChange: (e) => setIsRequired(e.target.checked) }), " ", "\u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0439"] }), _jsx("button", { type: "submit", children: "\u041D\u0430\u0437\u043D\u0430\u0447\u0438\u0442\u044C" })] }), _jsxs("table", { style: { width: "100%", borderCollapse: "collapse" }, children: [_jsx("thead", { children: _jsxs("tr", { style: { textAlign: "left", borderBottom: "1px solid #ccc" }, children: [_jsx("th", { children: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A" }), _jsx("th", { children: "\u041A\u0443\u0440\u0441" }), _jsx("th", { children: "\u0414\u0435\u0434\u043B\u0430\u0439\u043D" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", {})] }) }), _jsx("tbody", { children: assignments.map((a) => (_jsxs("tr", { style: { borderBottom: "1px solid #eee" }, children: [_jsx("td", { children: a.user_name }), _jsx("td", { children: a.course_title }), _jsx("td", { children: a.deadline ? new Date(a.deadline).toLocaleString() : "—" }), _jsx("td", { style: { color: a.status === "overdue" ? "crimson" : undefined }, children: STATUS_LABEL[a.status] ?? a.status }), _jsxs("td", { children: [_jsx("button", { onClick: () => extendDeadline(a.id), style: { fontSize: 12 }, children: "\u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438 \u0434\u0435\u0434\u043B\u0430\u0439\u043D" }), " ", _jsx("button", { onClick: () => unassign(a.id), style: { fontSize: 12 }, children: "\u0441\u043D\u044F\u0442\u044C" })] })] }, a.id))) })] })] }));
}
