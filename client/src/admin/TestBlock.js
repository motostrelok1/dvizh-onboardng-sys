import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { api } from "./api";
export function TestBlock({ test, scope, parentId, onReload }) {
    const [detail, setDetail] = useState(null);
    const [open, setOpen] = useState(false);
    async function createTest() {
        await api.post("/admin/tests", { scope, parentId });
        onReload();
    }
    async function openTest() {
        if (!test)
            return;
        const d = await api.get(`/admin/tests/${test.id}`);
        setDetail(d);
        setOpen(true);
    }
    async function removeTest() {
        if (!test)
            return;
        await api.delete(`/admin/tests/${test.id}`);
        setOpen(false);
        onReload();
    }
    if (!test) {
        return (_jsx("button", { onClick: createTest, style: { fontSize: 12 }, children: "+ \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0442\u0435\u0441\u0442" }));
    }
    if (!open) {
        return (_jsxs("button", { onClick: openTest, style: { fontSize: 12 }, children: ["\uD83D\uDCDD \u0442\u0435\u0441\u0442 (", test.max_attempts ?? "∞", " \u043F\u043E\u043F\u044B\u0442., \u043F\u0440\u043E\u0445\u043E\u0434\u043D\u043E\u0439 ", test.pass_score, "%)"] }));
    }
    return (_jsxs("div", { style: { background: "#eef", border: "1px solid #ccd", borderRadius: 6, padding: 10, marginTop: 6 }, children: [_jsx(TestSettings, { test: test, onSaved: openTest }), detail && (_jsx(QuestionsEditor, { testId: test.id, questions: detail.questions, onReload: openTest })), _jsxs("div", { style: { marginTop: 8 }, children: [_jsx("button", { onClick: () => setOpen(false), style: { fontSize: 12 }, children: "\u0441\u0432\u0435\u0440\u043D\u0443\u0442\u044C" }), " ", _jsx("button", { onClick: removeTest, style: { fontSize: 12 }, children: "\u0443\u0434\u0430\u043B\u0438\u0442\u044C \u0442\u0435\u0441\u0442" })] })] }));
}
function TestSettings({ test, onSaved }) {
    const [maxAttempts, setMaxAttempts] = useState(test.max_attempts?.toString() ?? "");
    const [showCorrect, setShowCorrect] = useState(test.show_correct_answers);
    const [passScore, setPassScore] = useState(test.pass_score);
    async function save() {
        await api.patch(`/admin/tests/${test.id}`, {
            maxAttempts: maxAttempts === "" ? null : Number(maxAttempts),
            showCorrectAnswers: showCorrect,
            passScore
        });
        onSaved();
    }
    return (_jsxs("div", { style: { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 13 }, children: [_jsxs("label", { children: ["\u041F\u043E\u043F\u044B\u0442\u043E\u043A (\u043F\u0443\u0441\u0442\u043E = \u0431\u0435\u0437\u043B\u0438\u043C\u0438\u0442):", " ", _jsx("input", { type: "number", min: 1, value: maxAttempts, onChange: (e) => setMaxAttempts(e.target.value), style: { width: 60 } })] }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: showCorrect, onChange: (e) => setShowCorrect(e.target.checked) }), " ", "\u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u043F\u0440\u0430\u0432\u0438\u043B\u044C\u043D\u044B\u0435 \u043E\u0442\u0432\u0435\u0442\u044B"] }), _jsxs("label", { children: ["\u041F\u0440\u043E\u0445\u043E\u0434\u043D\u043E\u0439 \u0431\u0430\u043B\u043B, %:", " ", _jsx("input", { type: "number", min: 0, max: 100, value: passScore, onChange: (e) => setPassScore(Number(e.target.value)), style: { width: 50 } })] }), _jsx("button", { onClick: save, children: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438" })] }));
}
function QuestionsEditor({ testId, questions, onReload }) {
    const [newQuestion, setNewQuestion] = useState("");
    const [multiple, setMultiple] = useState(false);
    async function addQuestion(e) {
        e.preventDefault();
        await api.post(`/admin/tests/${testId}/questions`, { text: newQuestion, multiple });
        setNewQuestion("");
        setMultiple(false);
        onReload();
    }
    async function removeQuestion(id) {
        await api.delete(`/admin/questions/${id}`);
        onReload();
    }
    return (_jsxs("div", { style: { marginTop: 10 }, children: [questions.map((q, i) => (_jsx(QuestionBlock, { index: i + 1, question: q, onReload: onReload, onRemove: () => removeQuestion(q.id) }, q.id))), _jsxs("form", { onSubmit: addQuestion, style: { display: "flex", gap: 8, marginTop: 8, alignItems: "center" }, children: [_jsx("input", { placeholder: "\u0422\u0435\u043A\u0441\u0442 \u0432\u043E\u043F\u0440\u043E\u0441\u0430", value: newQuestion, onChange: (e) => setNewQuestion(e.target.value), required: true, style: { flex: 1 } }), _jsxs("label", { style: { fontSize: 12 }, children: [_jsx("input", { type: "checkbox", checked: multiple, onChange: (e) => setMultiple(e.target.checked) }), " \u043D\u0435\u0441\u043A. \u0432\u0435\u0440\u043D\u044B\u0445"] }), _jsx("button", { type: "submit", children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432\u043E\u043F\u0440\u043E\u0441" })] })] }));
}
function QuestionBlock({ index, question, onReload, onRemove }) {
    const [newAnswer, setNewAnswer] = useState("");
    const [newCorrect, setNewCorrect] = useState(false);
    async function addAnswer(e) {
        e.preventDefault();
        await api.post(`/admin/questions/${question.id}/answers`, { text: newAnswer, isCorrect: newCorrect });
        setNewAnswer("");
        setNewCorrect(false);
        onReload();
    }
    async function toggleCorrect(a) {
        await api.patch(`/admin/answers/${a.id}`, { isCorrect: !a.is_correct });
        onReload();
    }
    async function removeAnswer(id) {
        await api.delete(`/admin/answers/${id}`);
        onReload();
    }
    return (_jsxs("div", { style: { background: "#fff", border: "1px solid #ddd", borderRadius: 6, padding: 8, marginBottom: 6 }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between" }, children: [_jsxs("strong", { style: { fontSize: 13 }, children: [index, ". ", question.text, " ", question.multiple && "(неск. верных)"] }), _jsx("button", { onClick: onRemove, style: { fontSize: 11 }, children: "\u0443\u0434\u0430\u043B\u0438\u0442\u044C \u0432\u043E\u043F\u0440\u043E\u0441" })] }), _jsx("ul", { style: { margin: "6px 0", paddingLeft: 18 }, children: question.answers.map((a) => (_jsxs("li", { style: { fontSize: 13 }, children: [_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: a.is_correct, onChange: () => toggleCorrect(a) }), " ", a.text] }), " ", _jsx("button", { onClick: () => removeAnswer(a.id), style: { fontSize: 11 }, children: "\u0443\u0434\u0430\u043B\u0438\u0442\u044C" })] }, a.id))) }), _jsxs("form", { onSubmit: addAnswer, style: { display: "flex", gap: 6, alignItems: "center" }, children: [_jsx("input", { placeholder: "\u0412\u0430\u0440\u0438\u0430\u043D\u0442 \u043E\u0442\u0432\u0435\u0442\u0430", value: newAnswer, onChange: (e) => setNewAnswer(e.target.value), required: true, style: { fontSize: 12 } }), _jsxs("label", { style: { fontSize: 12 }, children: [_jsx("input", { type: "checkbox", checked: newCorrect, onChange: (e) => setNewCorrect(e.target.checked) }), " \u0432\u0435\u0440\u043D\u044B\u0439"] }), _jsx("button", { type: "submit", style: { fontSize: 12 }, children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C" })] })] }));
}
