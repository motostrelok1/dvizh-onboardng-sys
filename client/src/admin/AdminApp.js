import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "./api";
import { EmployeesTab } from "./EmployeesTab";
import { DepartmentsTab } from "./DepartmentsTab";
import { GroupsTab } from "./GroupsTab";
import { CoursesTab } from "./CoursesTab";
import { AssignmentsTab } from "./AssignmentsTab";
import { LoginForm } from "../shared/LoginForm";
export default function AdminApp() {
    const [user, setUser] = useState(undefined); // undefined = ещё не проверили
    const [tab, setTab] = useState("courses");
    useEffect(() => {
        api
            .get("/auth/me")
            .then((d) => setUser(d.user))
            .catch(() => setUser(null));
    }, []);
    if (user === undefined)
        return _jsx("p", { style: { padding: 24 }, children: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430\u2026" });
    if (user === null)
        return _jsx(LoginForm, { onLogin: setUser });
    if (user.role !== "admin")
        return _jsx("p", { style: { padding: 24 }, children: "\u0414\u043E\u0441\u0442\u0443\u043F \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0430." });
    return (_jsxs("div", { style: { fontFamily: "system-ui", maxWidth: 900, margin: "0 auto", padding: 24 }, children: [_jsxs("header", { style: { display: "flex", justifyContent: "space-between", marginBottom: 20 }, children: [_jsx("h1", { children: "\u0410\u0434\u043C\u0438\u043D\u043A\u0430" }), _jsx("button", { onClick: () => api.post("/auth/logout").then(() => setUser(null)), children: "\u0412\u044B\u0439\u0442\u0438" })] }), _jsx("nav", { style: { display: "flex", gap: 8, marginBottom: 20 }, children: [
                    ["courses", "Курсы"],
                    ["assignments", "Назначения"],
                    ["employees", "Сотрудники"],
                    ["departments", "Отделы"],
                    ["groups", "Группы"]
                ].map(([key, label]) => (_jsx("button", { onClick: () => setTab(key), style: { fontWeight: tab === key ? 700 : 400 }, children: label }, key))) }), tab === "courses" && _jsx(CoursesTab, {}), tab === "assignments" && _jsx(AssignmentsTab, {}), tab === "employees" && _jsx(EmployeesTab, {}), tab === "departments" && _jsx(DepartmentsTab, {}), tab === "groups" && _jsx(GroupsTab, {})] }));
}
