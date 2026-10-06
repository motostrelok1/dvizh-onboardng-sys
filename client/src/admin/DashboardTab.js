import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "./api";
import { EmployeeDetail } from "./EmployeeDetail";
export function DashboardTab() {
    const [departments, setDepartments] = useState([]);
    const [groups, setGroups] = useState([]);
    const [departmentId, setDepartmentId] = useState("");
    const [groupId, setGroupId] = useState("");
    const [summary, setSummary] = useState(null);
    const [employees, setEmployees] = useState([]);
    const [openEmployeeId, setOpenEmployeeId] = useState(null);
    useEffect(() => {
        api.get("/admin/departments").then((d) => setDepartments(d.departments));
        api.get("/admin/groups").then((d) => setGroups(d.groups));
    }, []);
    function reload() {
        const params = new URLSearchParams();
        if (departmentId)
            params.set("departmentId", departmentId);
        if (groupId)
            params.set("groupId", groupId);
        api
            .get(`/admin/dashboard?${params}`)
            .then((d) => {
            setSummary(d.summary);
            setEmployees(d.employees);
        });
    }
    useEffect(reload, [departmentId, groupId]);
    if (openEmployeeId) {
        return _jsx(EmployeeDetail, { userId: openEmployeeId, onBack: () => setOpenEmployeeId(null) });
    }
    return (_jsxs("div", { children: [_jsxs("div", { style: { display: "flex", gap: 8, marginBottom: 16 }, children: [_jsxs("select", { value: departmentId, onChange: (e) => setDepartmentId(e.target.value), children: [_jsx("option", { value: "", children: "\u0412\u0441\u0435 \u043E\u0442\u0434\u0435\u043B\u044B" }), departments.map((d) => (_jsx("option", { value: d.id, children: d.name }, d.id)))] }), _jsxs("select", { value: groupId, onChange: (e) => setGroupId(e.target.value), children: [_jsx("option", { value: "", children: "\u0412\u0441\u0435 \u0433\u0440\u0443\u043F\u043F\u044B" }), groups.map((g) => (_jsx("option", { value: g.id, children: g.name }, g.id)))] })] }), summary && (_jsxs("div", { style: { display: "flex", gap: 12, marginBottom: 20 }, children: [_jsx(Tile, { label: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u043E\u0432", value: summary.totalEmployees }), _jsx(Tile, { label: "\u0410\u043A\u0442\u0438\u0432\u043D\u044B\u0445 (7 \u0434\u043D\u0435\u0439)", value: summary.activeEmployees }), _jsx(Tile, { label: "\u0421\u0440\u0435\u0434\u043D\u0438\u0439 \u043F\u0440\u043E\u0433\u0440\u0435\u0441\u0441", value: summary.averageProgressPercent !== null ? `${summary.averageProgressPercent}%` : "—" }), _jsx(Tile, { label: "\u041F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u043E", value: summary.overdueAssignmentsCount, alert: summary.overdueAssignmentsCount > 0 })] })), _jsxs("table", { style: { width: "100%", borderCollapse: "collapse" }, children: [_jsx("thead", { children: _jsxs("tr", { style: { textAlign: "left", borderBottom: "1px solid #ccc" }, children: [_jsx("th", { children: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A" }), _jsx("th", { children: "\u041E\u0442\u0434\u0435\u043B" }), _jsx("th", { children: "\u041A\u0443\u0440\u0441\u043E\u0432" }), _jsx("th", { children: "\u041F\u0440\u043E\u0433\u0440\u0435\u0441\u0441" }), _jsx("th", { children: "\u041F\u0440\u043E\u0441\u0440\u043E\u0447\u0435\u043D\u043E" }), _jsx("th", { children: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u0432\u0445\u043E\u0434" }), _jsx("th", {})] }) }), _jsx("tbody", { children: employees.map((e) => (_jsxs("tr", { style: { borderBottom: "1px solid #eee" }, children: [_jsx("td", { children: e.fullName }), _jsx("td", { children: e.departmentName ?? "—" }), _jsx("td", { children: e.assignedCourses }), _jsx("td", { children: e.averageProgress !== null ? `${e.averageProgress}%` : "—" }), _jsx("td", { style: { color: e.overdueCount > 0 ? "crimson" : undefined }, children: e.overdueCount || "—" }), _jsx("td", { children: e.lastSessionAt ? new Date(e.lastSessionAt).toLocaleString() : "никогда" }), _jsx("td", { children: _jsx("button", { onClick: () => setOpenEmployeeId(e.id), style: { fontSize: 12 }, children: "\u043A\u0430\u0440\u0442\u043E\u0447\u043A\u0430" }) })] }, e.id))) })] })] }));
}
function Tile({ label, value, alert }) {
    return (_jsxs("div", { style: { border: "1px solid #ddd", borderRadius: 10, padding: "10px 16px", minWidth: 100 }, children: [_jsx("div", { style: { fontSize: 12, color: "#888" }, children: label }), _jsx("div", { style: { fontSize: 22, fontWeight: 700, color: alert ? "crimson" : undefined }, children: value })] }));
}
