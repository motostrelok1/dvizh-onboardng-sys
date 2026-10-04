import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "../admin/api";
import { LoginForm } from "../shared/LoginForm";
import { CourseScreen } from "./CourseScreen";
const STATUS_LABEL = {
    assigned: "не начат",
    in_progress: "в процессе",
    completed: "завершён",
    overdue: "доступ закрыт (просрочен)",
    closed: "закрыт"
};
export default function EmployeeApp() {
    const [user, setUser] = useState(undefined);
    const [assigned, setAssigned] = useState([]);
    const [catalog, setCatalog] = useState([]);
    const [openCourseId, setOpenCourseId] = useState(null);
    function reload() {
        api
            .get("/me/courses")
            .then((d) => {
            setAssigned(d.assigned);
            setCatalog(d.catalog);
        });
    }
    useEffect(() => {
        api
            .get("/auth/me")
            .then((d) => setUser(d.user))
            .catch(() => setUser(null));
    }, []);
    useEffect(() => {
        if (user)
            reload();
    }, [user]);
    if (user === undefined)
        return _jsx("p", { style: { padding: 24 }, children: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430\u2026" });
    if (user === null)
        return _jsx(LoginForm, { onLogin: setUser });
    if (openCourseId) {
        return _jsx(CourseScreen, { courseId: openCourseId, onBack: () => setOpenCourseId(null) });
    }
    async function enroll(courseId) {
        await api.post(`/courses/${courseId}/enroll`);
        reload();
        setOpenCourseId(courseId);
    }
    return (_jsxs("div", { style: { fontFamily: "system-ui", maxWidth: 480, margin: "0 auto", padding: 24 }, children: [_jsxs("header", { style: { display: "flex", justifyContent: "space-between", marginBottom: 20 }, children: [_jsx("h1", { children: "\u041C\u043E\u0438 \u043A\u0443\u0440\u0441\u044B" }), _jsx("button", { onClick: () => api.post("/auth/logout").then(() => setUser(null)), children: "\u0412\u044B\u0439\u0442\u0438" })] }), assigned.map((c) => (_jsxs("div", { onClick: () => c.status !== "overdue" && setOpenCourseId(c.course_id), style: {
                    border: "1px solid #ddd",
                    borderRadius: 10,
                    padding: 14,
                    marginBottom: 10,
                    cursor: c.status === "overdue" ? "default" : "pointer",
                    opacity: c.status === "overdue" ? 0.6 : 1
                }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between" }, children: [_jsx("strong", { children: c.title }), _jsx("span", { style: { fontSize: 12, color: c.status === "overdue" ? "crimson" : "#666" }, children: STATUS_LABEL[c.status] ?? c.status })] }), c.deadline && (_jsxs("div", { style: { fontSize: 12, color: "#888" }, children: ["\u0421\u0440\u043E\u043A: ", new Date(c.deadline).toLocaleDateString()] }))] }, c.assignment_id))), catalog.length > 0 && (_jsxs(_Fragment, { children: [_jsx("h2", { style: { marginTop: 24 }, children: "\u041E\u0442\u043A\u0440\u044B\u0442\u044B\u0439 \u043A\u0430\u0442\u0430\u043B\u043E\u0433" }), catalog.map((c) => (_jsx("div", { style: { border: "1px solid #ddd", borderRadius: 10, padding: 14, marginBottom: 10 }, children: _jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [_jsx("strong", { children: c.title }), _jsx("button", { onClick: () => enroll(c.course_id), children: "\u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F" })] }) }, c.course_id)))] })), assigned.length === 0 && catalog.length === 0 && _jsx("p", { children: "\u041F\u043E\u043A\u0430 \u043D\u0435\u0442 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u043D\u044B\u0445 \u043A\u0443\u0440\u0441\u043E\u0432." })] }));
}
