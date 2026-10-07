import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "./api";
const FIELDS = [
    { key: "problem_question.min_correct_percent", label: "Проблемный вопрос: верных ниже, %" },
    { key: "problem_question.min_answers", label: "Проблемный вопрос: минимум ответов" },
    { key: "skipped_lesson.max_percent_of_median", label: "Пролистал: меньше % от медианы" },
    { key: "needs_help.attempts_without_improvement", label: "Нужна помощь: попыток подряд" },
    { key: "guessing.max_seconds_per_question", label: "Угадывание: меньше секунд на вопрос" },
    { key: "stuck.inactive_days", label: "Застрял: дней без активности" },
    { key: "deadline_risk.days_before", label: "Риск просрочки: за сколько дней" },
    { key: "deadline_risk.max_progress_percent", label: "Риск просрочки: прогресс меньше, %" }
];
export function CourseAnalyticsSettings({ courseId }) {
    const [open, setOpen] = useState(false);
    const [effective, setEffective] = useState({});
    const [overrides, setOverrides] = useState({});
    const [draft, setDraft] = useState({});
    function reload() {
        api
            .get(`/admin/courses/${courseId}/analytics-settings`)
            .then((d) => {
            setEffective(d.effective);
            setOverrides(d.overrides);
            const draftInit = {};
            for (const f of FIELDS)
                draftInit[f.key] = d.overrides[f.key] !== undefined ? String(d.overrides[f.key]) : "";
            setDraft(draftInit);
        });
    }
    useEffect(() => {
        if (open)
            reload();
    }, [open]);
    async function save() {
        const patch = {};
        for (const f of FIELDS) {
            if (draft[f.key] !== "" && Number(draft[f.key]) !== overrides[f.key]) {
                patch[f.key] = Number(draft[f.key]);
            }
        }
        if (Object.keys(patch).length > 0) {
            await api.put(`/admin/courses/${courseId}/analytics-settings`, patch);
        }
        reload();
    }
    async function resetAll() {
        await api.post(`/admin/courses/${courseId}/analytics-settings/reset`);
        reload();
    }
    if (!open) {
        return (_jsx("button", { onClick: () => setOpen(true), style: { fontSize: 12 }, children: "\u041F\u043E\u0440\u043E\u0433\u0438 \u0430\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0438 \u043A\u0443\u0440\u0441\u0430" }));
    }
    return (_jsxs("div", { style: { border: "1px solid #ddd", borderRadius: 8, padding: 10, marginTop: 8 }, children: [_jsx("strong", { style: { fontSize: 13 }, children: "\u041F\u043E\u0440\u043E\u0433\u0438 \u0430\u043D\u0430\u043B\u0438\u0442\u0438\u043A\u0438 \u0434\u043B\u044F \u044D\u0442\u043E\u0433\u043E \u043A\u0443\u0440\u0441\u0430" }), _jsx("p", { style: { fontSize: 12, color: "#888" }, children: "\u041F\u0443\u0441\u0442\u043E \u2014 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u043E\u0431\u0449\u0435\u0435 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0435. \u0417\u0430\u043F\u043E\u043B\u043D\u0438\u0442\u0435, \u0447\u0442\u043E\u0431\u044B \u043F\u0435\u0440\u0435\u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0438\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u044D\u0442\u043E\u0433\u043E \u043A\u0443\u0440\u0441\u0430." }), FIELDS.map((f) => (_jsxs("div", { style: { fontSize: 13, marginBottom: 6 }, children: [f.label, ":", " ", _jsx("input", { type: "number", placeholder: String(effective[f.key] ?? ""), value: draft[f.key] ?? "", onChange: (e) => setDraft((d) => ({ ...d, [f.key]: e.target.value })), style: { width: 70 } })] }, f.key))), _jsx("button", { onClick: save, style: { fontSize: 12 }, children: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C" }), " ", _jsx("button", { onClick: resetAll, style: { fontSize: 12 }, children: "\u0421\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u043F\u0435\u0440\u0435\u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u044F" }), " ", _jsx("button", { onClick: () => setOpen(false), style: { fontSize: 12 }, children: "\u0421\u0432\u0435\u0440\u043D\u0443\u0442\u044C" })] }));
}
