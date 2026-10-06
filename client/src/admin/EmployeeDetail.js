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
const EVENT_LABEL = {
    session_start: "Вход в систему",
    session_end: "Выход",
    lesson_view_start: "Открыл урок",
    lesson_view_end: "Закрыл урок",
    test_attempt_start: "Начал попытку теста",
    test_attempt_end: "Завершил попытку теста",
    question_answered: "Ответил на вопрос",
    assignment_created: "Назначен курс",
    deadline_extended: "Перенесён дедлайн",
    access_closed: "Доступ закрыт (просрочка)",
    attachment_download: "Скачал материал"
};
export function EmployeeDetail({ userId, onBack }) {
    const [log, setLog] = useState(null);
    useEffect(() => {
        api.get(`/admin/users/${userId}/log`).then(setLog);
    }, [userId]);
    if (!log)
        return _jsx("p", { children: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430\u2026" });
    return (_jsxs("div", { children: [_jsx("button", { onClick: onBack, style: { marginBottom: 12 }, children: "\u2190 \u041A \u0434\u0430\u0448\u0431\u043E\u0440\u0434\u0443" }), _jsx("h2", { children: log.user.fullName }), _jsxs("p", { style: { color: "#666", fontSize: 13 }, children: [log.user.email, " \u00B7 ", log.user.departmentName ?? "без отдела", " \u00B7 \u043F\u043E\u044F\u0441 ", log.user.timezone, " \u00B7", " ", log.user.isActive ? "активен" : "деактивирован"] }), _jsxs("div", { style: { display: "flex", gap: 12, marginBottom: 20 }, children: [_jsx(Tile, { label: "\u0412\u0445\u043E\u0434\u043E\u0432", value: log.stats.totalSessions }), _jsx(Tile, { label: "\u0412\u0435\u0440\u043D\u044B\u0445 \u043E\u0442\u0432\u0435\u0442\u043E\u0432", value: log.stats.correctAnswers }), _jsx(Tile, { label: "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0445 \u043E\u0442\u0432\u0435\u0442\u043E\u0432", value: log.stats.incorrectAnswers }), _jsx(Tile, { label: "\u041F\u043E\u043F\u044B\u0442\u043E\u043A \u0442\u0435\u0441\u0442\u043E\u0432", value: log.stats.testAttempts }), _jsx(Tile, { label: "\u0412\u0440\u0435\u043C\u0435\u043D\u0438 \u043D\u0430 \u0443\u0440\u043E\u043A\u0430\u0445", value: `${log.stats.totalViewMinutes} мин` })] }), _jsx("h3", { children: "\u041A\u0443\u0440\u0441\u044B" }), log.assignments.map((a) => (_jsxs("div", { style: { marginBottom: 10 }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between" }, children: [_jsx("strong", { children: a.course_title }), _jsx("span", { style: { fontSize: 12, color: a.status === "overdue" ? "crimson" : "#666" }, children: STATUS_LABEL[a.status] ?? a.status })] }), _jsx("div", { style: { height: 6, background: "#eee", borderRadius: 99, overflow: "hidden" }, children: _jsx("div", { style: { height: "100%", width: `${a.progress.percent}%`, background: "#2f6fed" } }) }), _jsxs("div", { style: { fontSize: 12, color: "#888" }, children: [a.progress.viewedLessons, " \u0438\u0437 ", a.progress.totalLessons, " \u0443\u0440\u043E\u043A\u043E\u0432 \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0435\u043D\u043E (", a.progress.percent, "%)", a.deadline && ` · срок: ${new Date(a.deadline).toLocaleDateString()}`] })] }, a.id))), _jsx("h3", { style: { marginTop: 20 }, children: "\u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u0441\u043E\u0431\u044B\u0442\u0438\u044F" }), _jsx("ul", { style: { paddingLeft: 18 }, children: log.recentEvents.map((e, i) => (_jsxs("li", { style: { fontSize: 13, marginBottom: 4 }, children: [_jsx("span", { style: { color: "#888" }, children: new Date(e.occurred_at).toLocaleString() }), " \u2014", " ", EVENT_LABEL[e.event_type] ?? e.event_type, e.payload?.score !== undefined && ` (результат ${e.payload.score}%)`, e.payload?.fileName && ` — ${e.payload.fileName}`] }, i))) })] }));
}
function Tile({ label, value }) {
    return (_jsxs("div", { style: { border: "1px solid #ddd", borderRadius: 10, padding: "10px 16px", minWidth: 100 }, children: [_jsx("div", { style: { fontSize: 12, color: "#888" }, children: label }), _jsx("div", { style: { fontSize: 20, fontWeight: 700 }, children: value })] }));
}
