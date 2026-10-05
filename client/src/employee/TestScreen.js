import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "../admin/api";
const ERROR_MESSAGE = {
    deadline_passed: "Срок прохождения этого курса истёк, доступ закрыт.",
    not_assigned: "Этот курс вам не назначен.",
    not_enrolled: "Сначала запишитесь на курс из каталога.",
    no_attempts_left: "Попытки закончились.",
    not_found: "Тест не найден."
};
export function TestScreen({ testId, onBack }) {
    const [attempt, setAttempt] = useState(null);
    const [questions, setQuestions] = useState([]);
    const [index, setIndex] = useState(0);
    const [selected, setSelected] = useState({});
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);
    function start() {
        setError(null);
        setResult(null);
        api
            .post(`/tests/${testId}/attempts`)
            .then((d) => {
            setAttempt(d.attempt);
            setQuestions(d.questions);
            setIndex(0);
            const initial = {};
            d.questions.forEach((q) => (initial[q.id] = new Set(q.selectedAnswerIds)));
            setSelected(initial);
        })
            .catch((e) => setError(e.message));
    }
    useEffect(start, [testId]);
    function toggle(question, answerId) {
        setSelected((prev) => {
            const set = new Set(prev[question.id]);
            if (question.multiple) {
                set.has(answerId) ? set.delete(answerId) : set.add(answerId);
            }
            else {
                set.clear();
                set.add(answerId);
            }
            return { ...prev, [question.id]: set };
        });
    }
    async function next() {
        const q = questions[index];
        await api.post(`/attempts/${attempt.id}/answers`, {
            questionId: q.id,
            selectedAnswerIds: Array.from(selected[q.id] ?? [])
        });
        if (index < questions.length - 1) {
            setIndex(index + 1);
        }
        else {
            const r = await api.post(`/attempts/${attempt.id}/finish`);
            setResult(r);
        }
    }
    if (error) {
        return (_jsxs("div", { style: { fontFamily: "system-ui", maxWidth: 480, margin: "0 auto", padding: 24 }, children: [_jsx("button", { onClick: onBack, style: { marginBottom: 12 }, children: "\u2190 \u041D\u0430\u0437\u0430\u0434" }), _jsx("p", { style: { color: "crimson" }, children: ERROR_MESSAGE[error] ?? "Не удалось начать тест." })] }));
    }
    if (result) {
        return (_jsxs("div", { style: { fontFamily: "system-ui", maxWidth: 480, margin: "0 auto", padding: 24 }, children: [_jsx("button", { onClick: onBack, style: { marginBottom: 12 }, children: "\u2190 \u041D\u0430\u0437\u0430\u0434 \u043A \u043A\u0443\u0440\u0441\u0443" }), _jsx("h1", { style: { color: result.passed ? "#1f9d55" : "#d64545" }, children: result.passed ? "Тест пройден" : "Тест не пройден" }), _jsxs("p", { children: ["\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442: ", result.score, "% (\u043F\u0440\u043E\u0445\u043E\u0434\u043D\u043E\u0439 \u0431\u0430\u043B\u043B ", result.passScore, "%)"] }), !result.passed && (_jsx("button", { onClick: start, style: { marginBottom: 16 }, children: "\u041F\u0440\u043E\u0439\u0442\u0438 \u0435\u0449\u0451 \u0440\u0430\u0437" })), result.review && (_jsx("div", { children: result.review.map((q, i) => (_jsxs("div", { style: { border: "1px solid #ddd", borderRadius: 8, padding: 10, marginBottom: 8 }, children: [_jsxs("strong", { style: { color: q.yourCorrect ? "#1f9d55" : "#d64545" }, children: [i + 1, ". ", q.text] }), _jsx("ul", { style: { marginTop: 6 }, children: q.answers.map((a) => (_jsxs("li", { style: {
                                        color: a.isCorrect ? "#1f9d55" : a.wasSelected ? "#d64545" : undefined,
                                        fontWeight: a.wasSelected ? 700 : 400
                                    }, children: [a.text, a.isCorrect && " ✓", a.wasSelected && !a.isCorrect && " (ваш ответ)"] }, a.id))) })] }, q.questionId))) }))] }));
    }
    if (!attempt || questions.length === 0)
        return _jsx("p", { style: { padding: 24 }, children: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430\u2026" });
    const q = questions[index];
    return (_jsxs("div", { style: { fontFamily: "system-ui", maxWidth: 480, margin: "0 auto", padding: 24 }, children: [_jsx("button", { onClick: onBack, style: { marginBottom: 12 }, children: "\u2190 \u041D\u0430\u0437\u0430\u0434 \u043A \u043A\u0443\u0440\u0441\u0443" }), _jsxs("p", { style: { color: "#888", fontSize: 13 }, children: ["\u0412\u043E\u043F\u0440\u043E\u0441 ", index + 1, " \u0438\u0437 ", questions.length, " \u00B7 \u043F\u043E\u043F\u044B\u0442\u043A\u0430 \u2116", attempt.attempt_number] }), _jsx("h2", { children: q.text }), q.multiple && _jsx("p", { style: { fontSize: 13, color: "#888" }, children: "\u041C\u043E\u0436\u043D\u043E \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0432\u0430\u0440\u0438\u0430\u043D\u0442\u043E\u0432" }), q.answers.map((a) => (_jsxs("label", { style: { display: "block", padding: 8, border: "1px solid #eee", borderRadius: 8, marginBottom: 6 }, children: [_jsx("input", { type: q.multiple ? "checkbox" : "radio", name: q.id, checked: selected[q.id]?.has(a.id) ?? false, onChange: () => toggle(q, a.id) }), " ", a.text] }, a.id))), _jsx("button", { onClick: next, style: { marginTop: 12 }, children: index < questions.length - 1 ? "Далее" : "Завершить тест" })] }));
}
