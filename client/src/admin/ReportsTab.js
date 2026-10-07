import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "./api";
function yesterday() {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}
export function ReportsTab() {
    const [date, setDate] = useState(yesterday());
    const [departments, setDepartments] = useState([]);
    const [groups, setGroups] = useState([]);
    const [departmentId, setDepartmentId] = useState("");
    const [groupId, setGroupId] = useState("");
    const [reports, setReports] = useState([]);
    const [mode, setMode] = useState("login");
    const [scheduleTime, setScheduleTime] = useState("07:00");
    useEffect(() => {
        api.get("/admin/departments").then((d) => setDepartments(d.departments));
        api.get("/admin/groups").then((d) => setGroups(d.groups));
        api.get("/admin/settings/reports").then((d) => {
            setMode(d.mode);
            setScheduleTime(d.scheduleTime);
        });
    }, []);
    function reload() {
        const params = new URLSearchParams({ date });
        if (departmentId)
            params.set("departmentId", departmentId);
        if (groupId)
            params.set("groupId", groupId);
        api.get(`/admin/reports/daily?${params}`).then((d) => setReports(d.reports));
    }
    useEffect(reload, [date, departmentId, groupId]);
    async function regenerate() {
        await api.post("/admin/reports/daily/generate", { date });
        reload();
    }
    async function saveReportSettings() {
        await api.put("/admin/settings/reports", { mode, scheduleTime });
    }
    return (_jsxs("div", { children: [_jsxs("div", { style: { border: "1px solid #ddd", borderRadius: 10, padding: 12, marginBottom: 16 }, children: [_jsx("strong", { style: { fontSize: 13 }, children: "\u0424\u043E\u0440\u043C\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u043E\u0442\u0447\u0451\u0442\u0430" }), _jsxs("div", { style: { display: "flex", gap: 12, marginTop: 6, alignItems: "center" }, children: [_jsxs("select", { value: mode, onChange: (e) => setMode(e.target.value), children: [_jsx("option", { value: "login", children: "\u041F\u043E \u0432\u0445\u043E\u0434\u0443 \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430" }), _jsx("option", { value: "schedule", children: "\u041F\u043E \u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u044E" }), _jsx("option", { value: "both", children: "\u0418 \u0442\u043E \u0438 \u0434\u0440\u0443\u0433\u043E\u0435" })] }), (mode === "schedule" || mode === "both") && (_jsx("input", { type: "time", value: scheduleTime, onChange: (e) => setScheduleTime(e.target.value) })), _jsx("button", { onClick: saveReportSettings, style: { fontSize: 12 }, children: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C" })] })] }), _jsxs("div", { style: { display: "flex", gap: 8, marginBottom: 16, alignItems: "center" }, children: [_jsx("input", { type: "date", value: date, onChange: (e) => setDate(e.target.value) }), _jsxs("select", { value: departmentId, onChange: (e) => setDepartmentId(e.target.value), children: [_jsx("option", { value: "", children: "\u0412\u0441\u0435 \u043E\u0442\u0434\u0435\u043B\u044B" }), departments.map((d) => (_jsx("option", { value: d.id, children: d.name }, d.id)))] }), _jsxs("select", { value: groupId, onChange: (e) => setGroupId(e.target.value), children: [_jsx("option", { value: "", children: "\u0412\u0441\u0435 \u0433\u0440\u0443\u043F\u043F\u044B" }), groups.map((g) => (_jsx("option", { value: g.id, children: g.name }, g.id)))] }), _jsx("button", { onClick: regenerate, children: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C" }), _jsx("a", { href: `/api/admin/reports/export.csv?from=${date}&to=${date}`, target: "_blank", rel: "noreferrer", children: "\u042D\u043A\u0441\u043F\u043E\u0440\u0442 CSV" })] }), _jsxs("table", { style: { width: "100%", borderCollapse: "collapse" }, children: [_jsx("thead", { children: _jsxs("tr", { style: { textAlign: "left", borderBottom: "1px solid #ccc" }, children: [_jsx("th", { children: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A" }), _jsx("th", { children: "\u041E\u0442\u0434\u0435\u043B" }), _jsx("th", { children: "\u0412\u0435\u0440\u043D\u043E/\u043D\u0435\u0432\u0435\u0440\u043D\u043E" }), _jsx("th", { children: "\u0412\u0445\u043E\u0434\u043E\u0432" }), _jsx("th", { children: "\u041C\u0438\u043D\u0443\u0442" }), _jsx("th", { children: "\u0422\u0435\u0441\u0442\u043E\u0432" }), _jsx("th", { children: "\u0424\u043B\u0430\u0433\u0438" })] }) }), _jsx("tbody", { children: reports.map((r) => (_jsxs("tr", { style: { borderBottom: "1px solid #eee" }, children: [_jsx("td", { children: r.full_name }), _jsx("td", { children: r.department_name ?? "—" }), _jsxs("td", { children: [r.summary.answers.today.correct, " / ", r.summary.answers.today.incorrect] }), _jsx("td", { children: r.summary.sessions.today }), _jsx("td", { children: r.summary.viewMinutesToday }), _jsxs("td", { children: [r.summary.tests.passedToday, "/", r.summary.tests.attemptedToday] }), _jsx("td", { style: { color: r.flags.length > 0 ? "#c98000" : undefined }, children: r.flags.length || "—" })] }, r.user_id))) })] }), reports.length === 0 && _jsx("p", { style: { color: "#888" }, children: "\u041D\u0430 \u044D\u0442\u0443 \u0434\u0430\u0442\u0443 \u043E\u0442\u0447\u0451\u0442\u043E\u0432 \u043D\u0435\u0442." })] }));
}
