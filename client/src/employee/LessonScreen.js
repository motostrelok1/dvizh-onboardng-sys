import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "../admin/api";
const ERROR_MESSAGE = {
    deadline_passed: "Срок прохождения этого курса истёк, доступ закрыт.",
    not_assigned: "Этот курс вам не назначен.",
    not_enrolled: "Сначала запишитесь на курс из каталога.",
    not_found: "Урок не найден."
};
export function LessonScreen({ lessonId, onBack }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        api
            .get(`/lessons/${lessonId}`)
            .then(setData)
            .catch((e) => setError(e.message));
    }, [lessonId]);
    return (_jsxs("div", { style: { fontFamily: "system-ui", maxWidth: 480, margin: "0 auto", padding: 24 }, children: [_jsx("button", { onClick: onBack, style: { marginBottom: 12 }, children: "\u2190 \u041D\u0430\u0437\u0430\u0434 \u043A \u043A\u0443\u0440\u0441\u0443" }), error && _jsx("p", { style: { color: "crimson" }, children: ERROR_MESSAGE[error] ?? "Не удалось открыть урок." }), data && (_jsxs(_Fragment, { children: [_jsx("h1", { children: data.lesson.title }), _jsx(VideoPlayer, { provider: data.lesson.videoProvider, videoRef: data.lesson.videoRef }), data.lesson.textContent && (_jsx("p", { style: { whiteSpace: "pre-wrap", lineHeight: 1.5 }, children: data.lesson.textContent })), data.attachments.length > 0 && (_jsxs("div", { style: { marginTop: 16 }, children: [_jsx("h3", { style: { fontSize: 14 }, children: "\u0414\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u043C\u0430\u0442\u0435\u0440\u0438\u0430\u043B\u044B" }), data.attachments.map((a) => (_jsxs("div", { style: { marginBottom: 6 }, children: [_jsxs("a", { href: `/api/attachments/${a.id}/download`, download: true, children: ["\uD83D\uDCC4 ", a.file_name] }), " ", _jsxs("span", { style: { fontSize: 12, color: "#888" }, children: ["(", Math.ceil(a.size_bytes / 1024), " \u041A\u0411)"] })] }, a.id)))] }))] }))] }));
}
// Встраивание плеера зависит от провайдера видео. Это упрощённая версия —
// полноценный выбор провайдера и формат ссылки см. SPEC §11.1–11.2.
function VideoPlayer({ provider, videoRef }) {
    if (!provider || !videoRef)
        return null;
    if (provider === "vimeo") {
        return (_jsx("div", { style: { aspectRatio: "16/9", marginBottom: 12 }, children: _jsx("iframe", { src: `https://player.vimeo.com/video/${videoRef}`, style: { width: "100%", height: "100%", border: 0 }, allow: "autoplay; fullscreen; picture-in-picture", allowFullScreen: true }) }));
    }
    if (provider === "self_hosted") {
        return (_jsx("video", { controls: true, style: { width: "100%", marginBottom: 12 }, children: _jsx("source", { src: videoRef }) }));
    }
    return (_jsxs("p", { style: { fontSize: 13, color: "#888" }, children: ["\u0412\u0438\u0434\u0435\u043E (", provider, "): ", videoRef, " \u2014 \u0432\u0441\u0442\u0440\u0430\u0438\u0432\u0430\u043D\u0438\u0435 \u0434\u043B\u044F \u044D\u0442\u043E\u0433\u043E \u043F\u0440\u043E\u0432\u0430\u0439\u0434\u0435\u0440\u0430 \u0435\u0449\u0451 \u043D\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043D\u043E."] }));
}
