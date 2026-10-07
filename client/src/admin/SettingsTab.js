import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "./api";
const RULES = [
    {
        key: "problem_question",
        label: "Проблемный вопрос",
        fields: [
            { key: "problem_question.min_correct_percent", label: "Процент верных ниже", suffix: "%" },
            { key: "problem_question.min_answers", label: "Минимум ответов для срабатывания" }
        ]
    },
    {
        key: "skipped_lesson",
        label: "«Пролистал, не читая»",
        fields: [{ key: "skipped_lesson.max_percent_of_median", label: "Меньше % от медианного времени", suffix: "%" }]
    },
    {
        key: "needs_help",
        label: "Нужна помощь",
        fields: [{ key: "needs_help.attempts_without_improvement", label: "Попыток подряд без роста" }]
    },
    {
        key: "guessing",
        label: "Угадывание",
        fields: [{ key: "guessing.max_seconds_per_question", label: "Меньше секунд на вопрос", suffix: "с" }]
    },
    {
        key: "stuck",
        label: "Застрял / не начал",
        fields: [{ key: "stuck.inactive_days", label: "Дней без активности", suffix: "дн." }]
    },
    {
        key: "deadline_risk",
        label: "Риск просрочки",
        fields: [
            { key: "deadline_risk.days_before", label: "За сколько дней до дедлайна", suffix: "дн." },
            { key: "deadline_risk.max_progress_percent", label: "Прогресс меньше", suffix: "%" }
        ]
    }
];
export function SettingsTab() {
    const [settings, setSettings] = useState(null);
    const [draft, setDraft] = useState({});
    const [problemQuestions, setProblemQuestions] = useState([]);
    const [log, setLog] = useState([]);
    const [showLog, setShowLog] = useState(false);
    function reload() {
        api.get("/admin/settings/analytics").then((d) => {
            setSettings(d.settings);
            setDraft(d.settings);
        });
        api.get("/admin/analytics/problem-questions").then((d) => setProblemQuestions(d.questions));
    }
    useEffect(reload, []);
    function setField(key, value) {
        setDraft((d) => ({ ...d, [key]: value }));
    }
    async function save() {
        const changed = {};
        for (const key of Object.keys(draft)) {
            if (draft[key] !== settings?.[key])
                changed[key] = draft[key];
        }
        if (Object.keys(changed).length === 0)
            return;
        await api.put("/admin/settings/analytics", changed);
        reload();
    }
    async function resetDefaults() {
        await api.post("/admin/settings/analytics/reset");
        reload();
    }
    async function loadLog() {
        const d = await api.get("/admin/settings/log");
        setLog(d.log);
        setShowLog(true);
    }
    if (!settings)
        return _jsx("p", { children: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430\u2026" });
    return (_jsxs("div", { children: [_jsx("h2", { children: "\u041F\u043E\u0440\u043E\u0433\u0438 \u043F\u0440\u0430\u0432\u0438\u043B \u0430\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0438" }), _jsx("p", { style: { color: "#888", fontSize: 13 }, children: "\u041E\u0431\u0449\u0438\u0435 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u044F. \u0414\u043B\u044F \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E\u0433\u043E \u043A\u0443\u0440\u0441\u0430 \u0438\u0445 \u043C\u043E\u0436\u043D\u043E \u043F\u0435\u0440\u0435\u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0438\u0442\u044C \u0432 \u0440\u0435\u0434\u0430\u043A\u0442\u043E\u0440\u0435 \u043A\u0443\u0440\u0441\u0430." }), RULES.map((rule) => (_jsxs("div", { style: { border: "1px solid #ddd", borderRadius: 10, padding: 12, marginBottom: 10 }, children: [_jsxs("label", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }, children: [_jsx("input", { type: "checkbox", checked: !!draft[`${rule.key}.enabled`], onChange: (e) => setField(`${rule.key}.enabled`, e.target.checked) }), _jsx("strong", { children: rule.label })] }), _jsx("div", { style: { display: "flex", gap: 16, flexWrap: "wrap", marginLeft: 24 }, children: rule.fields.map((f) => (_jsxs("label", { style: { fontSize: 13 }, children: [f.label, ":", " ", _jsx("input", { type: "number", value: draft[f.key] ?? "", onChange: (e) => setField(f.key, Number(e.target.value)), style: { width: 60 } }), " ", f.suffix] }, f.key))) })] }, rule.key))), _jsxs("div", { style: { marginBottom: 24 }, children: [_jsx("button", { onClick: save, children: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u043F\u043E\u0440\u043E\u0433\u0438" }), " ", _jsx("button", { onClick: resetDefaults, children: "\u0412\u0435\u0440\u043D\u0443\u0442\u044C \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u044F \u043F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E" }), " ", _jsx("button", { onClick: loadLog, children: "\u0416\u0443\u0440\u043D\u0430\u043B \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0439" })] }), showLog && (_jsxs("div", { style: { marginBottom: 24 }, children: [_jsx("h3", { children: "\u0416\u0443\u0440\u043D\u0430\u043B \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0439 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043A" }), _jsxs("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 13 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { textAlign: "left", borderBottom: "1px solid #ccc" }, children: [_jsx("th", { children: "\u041A\u043E\u0433\u0434\u0430" }), _jsx("th", { children: "\u041A\u0442\u043E" }), _jsx("th", { children: "\u041A\u0443\u0440\u0441" }), _jsx("th", { children: "\u041F\u0430\u0440\u0430\u043C\u0435\u0442\u0440" }), _jsx("th", { children: "\u0411\u044B\u043B\u043E" }), _jsx("th", { children: "\u0421\u0442\u0430\u043B\u043E" })] }) }), _jsx("tbody", { children: log.map((l) => (_jsxs("tr", { style: { borderBottom: "1px solid #eee" }, children: [_jsx("td", { children: new Date(l.changed_at).toLocaleString() }), _jsx("td", { children: l.changed_by_name ?? "—" }), _jsx("td", { children: l.course_title ?? "общие" }), _jsx("td", { children: l.key }), _jsx("td", { children: JSON.stringify(l.old_value) }), _jsx("td", { children: JSON.stringify(l.new_value) })] }, l.id))) })] })] })), _jsx("h2", { children: "\u041F\u0440\u043E\u0431\u043B\u0435\u043C\u043D\u044B\u0435 \u0432\u043E\u043F\u0440\u043E\u0441\u044B" }), problemQuestions.length === 0 && _jsx("p", { style: { color: "#888" }, children: "\u041F\u043E\u043A\u0430 \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043F\u0440\u0435\u0432\u044B\u0448\u0430\u0435\u0442 \u043F\u043E\u0440\u043E\u0433." }), problemQuestions.map((q) => (_jsxs("div", { style: { border: "1px solid #f0d090", background: "#fff6e5", borderRadius: 8, padding: 10, marginBottom: 6 }, children: [_jsx("strong", { children: q.text }), _jsxs("div", { style: { fontSize: 12, color: "#888" }, children: [q.courseTitle ?? "—", " \u00B7 \u0432\u0435\u0440\u043D\u043E ", q.correctPercent, "% \u0438\u0437 ", q.totalAnswers, " \u043E\u0442\u0432\u0435\u0442\u043E\u0432"] })] }, q.questionId)))] }));
}
