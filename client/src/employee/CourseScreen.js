import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "../admin/api";
const ERROR_MESSAGE = {
    deadline_passed: "Срок прохождения этого курса истёк, доступ закрыт.",
    not_assigned: "Этот курс вам не назначен.",
    not_enrolled: "Сначала запишитесь на курс из каталога.",
    not_found: "Курс не найден."
};
export function CourseScreen({ courseId, onBack }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        api
            .get(`/me/courses/${courseId}`)
            .then(setData)
            .catch((e) => setError(e.message));
    }, [courseId]);
    return (_jsxs("div", { style: { fontFamily: "system-ui", maxWidth: 480, margin: "0 auto", padding: 24 }, children: [_jsx("button", { onClick: onBack, style: { marginBottom: 12 }, children: "\u2190 \u041C\u043E\u0438 \u043A\u0443\u0440\u0441\u044B" }), error && _jsx("p", { style: { color: "crimson" }, children: ERROR_MESSAGE[error] ?? "Не удалось открыть курс." }), data && (_jsxs(_Fragment, { children: [_jsx("h1", { children: data.course.title }), data.course.description && _jsx("p", { style: { color: "#555" }, children: data.course.description }), data.assignment.deadline && (_jsxs("p", { style: { fontSize: 13, color: "#888" }, children: ["\u0421\u0440\u043E\u043A: ", new Date(data.assignment.deadline).toLocaleDateString()] })), data.modules.map((m) => (_jsxs("div", { style: { border: "1px solid #ddd", borderRadius: 10, padding: 12, marginBottom: 10 }, children: [_jsx("strong", { children: m.title }), m.test && _jsx(TestBadge, { test: m.test }), m.lessons.map((l) => (_jsxs("div", { style: {
                                    marginTop: 8,
                                    marginLeft: 12,
                                    paddingLeft: 10,
                                    borderLeft: "2px solid #eee"
                                }, children: [_jsx("div", { children: l.title }), _jsxs("div", { style: { fontSize: 12, color: "#888" }, children: [l.hasVideo && "видео · ", l.hasText && "текст · ", l.attachmentsCount > 0 && `материалов: ${l.attachmentsCount} · `, l.test ? "есть тест" : ""] })] }, l.id)))] }, m.id))), data.modules.length === 0 && _jsx("p", { children: "\u0412 \u044D\u0442\u043E\u043C \u043A\u0443\u0440\u0441\u0435 \u043F\u043E\u043A\u0430 \u043D\u0435\u0442 \u043C\u043E\u0434\u0443\u043B\u0435\u0439." })] }))] }));
}
function TestBadge({ test }) {
    return (_jsxs("span", { style: { fontSize: 12, marginLeft: 8, color: "#2f6fed" }, children: ["\u00B7 \u0442\u0435\u0441\u0442 (\u043F\u0440\u043E\u0445\u043E\u0434\u043D\u043E\u0439 ", test.pass_score, "%, \u043F\u043E\u043F\u044B\u0442\u043E\u043A: ", test.max_attempts ?? "∞", ")"] }));
}
