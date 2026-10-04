import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "./api";
import { TestBlock } from "./TestBlock";
export function CourseEditor({ courseId, onBack }) {
    const [tree, setTree] = useState(null);
    const [newModuleTitle, setNewModuleTitle] = useState("");
    function reload() {
        api.get(`/admin/courses/${courseId}/tree`).then(setTree);
    }
    useEffect(reload, [courseId]);
    if (!tree)
        return _jsx("p", { children: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430\u2026" });
    const { course, modules } = tree;
    async function updateCourse(patch) {
        await api.patch(`/admin/courses/${courseId}`, patch);
        reload();
    }
    async function addModule(e) {
        e.preventDefault();
        await api.post(`/admin/courses/${courseId}/modules`, { title: newModuleTitle });
        setNewModuleTitle("");
        reload();
    }
    async function removeModule(id) {
        await api.delete(`/admin/modules/${id}`);
        reload();
    }
    async function moveModule(index, dir) {
        const ids = modules.map((m) => m.id);
        const target = index + dir;
        if (target < 0 || target >= ids.length)
            return;
        [ids[index], ids[target]] = [ids[target], ids[index]];
        await api.post("/admin/modules/reorder", { courseId, orderedIds: ids });
        reload();
    }
    return (_jsxs("div", { children: [_jsx("button", { onClick: onBack, style: { marginBottom: 12 }, children: "\u2190 \u041A \u0441\u043F\u0438\u0441\u043A\u0443 \u043A\u0443\u0440\u0441\u043E\u0432" }), _jsx("h2", { children: course.title }), _jsxs("div", { style: { display: "flex", gap: 12, marginBottom: 20 }, children: [_jsxs("label", { children: ["\u0421\u0442\u0430\u0442\u0443\u0441:", " ", _jsxs("select", { value: course.status, onChange: (e) => updateCourse({ status: e.target.value }), children: [_jsx("option", { value: "draft", children: "\u0447\u0435\u0440\u043D\u043E\u0432\u0438\u043A" }), _jsx("option", { value: "published", children: "\u043E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D" }), _jsx("option", { value: "archived", children: "\u0430\u0440\u0445\u0438\u0432" })] })] }), _jsxs("label", { children: ["\u0414\u043E\u0441\u0442\u0443\u043F:", " ", _jsxs("select", { value: course.visibility, onChange: (e) => updateCourse({ visibility: e.target.value }), children: [_jsx("option", { value: "assigned_only", children: "\u043F\u043E \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u0438\u044E" }), _jsx("option", { value: "open_catalog", children: "\u043E\u0442\u043A\u0440\u044B\u0442\u044B\u0439 \u043A\u0430\u0442\u0430\u043B\u043E\u0433" })] })] })] }), modules.map((m, i) => (_jsx(ModuleBlock, { module: m, isFirst: i === 0, isLast: i === modules.length - 1, onMove: (dir) => moveModule(i, dir), onRemove: () => removeModule(m.id), onReload: reload }, m.id))), _jsxs("form", { onSubmit: addModule, style: { display: "flex", gap: 8, marginTop: 16 }, children: [_jsx("input", { placeholder: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043C\u043E\u0434\u0443\u043B\u044F", value: newModuleTitle, onChange: (e) => setNewModuleTitle(e.target.value), required: true }), _jsx("button", { type: "submit", children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043C\u043E\u0434\u0443\u043B\u044C" })] })] }));
}
function ModuleBlock({ module, isFirst, isLast, onMove, onRemove, onReload }) {
    const [newLessonTitle, setNewLessonTitle] = useState("");
    async function addLesson(e) {
        e.preventDefault();
        await api.post(`/admin/modules/${module.id}/lessons`, { title: newLessonTitle });
        setNewLessonTitle("");
        onReload();
    }
    async function moveLesson(index, dir) {
        const ids = module.lessons.map((l) => l.id);
        const target = index + dir;
        if (target < 0 || target >= ids.length)
            return;
        [ids[index], ids[target]] = [ids[target], ids[index]];
        await api.post("/admin/lessons/reorder", { moduleId: module.id, orderedIds: ids });
        onReload();
    }
    async function removeLesson(id) {
        await api.delete(`/admin/lessons/${id}`);
        onReload();
    }
    return (_jsxs("div", { style: { border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 12 }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [_jsx("strong", { children: module.title }), _jsxs("div", { children: [_jsx("button", { onClick: () => onMove(-1), disabled: isFirst, children: "\u2191" }), _jsx("button", { onClick: () => onMove(1), disabled: isLast, children: "\u2193" }), _jsx("button", { onClick: onRemove, children: "\u0443\u0434\u0430\u043B\u0438\u0442\u044C \u043C\u043E\u0434\u0443\u043B\u044C" })] })] }), _jsx("div", { style: { marginTop: 6 }, children: _jsx(TestBlock, { test: module.test, scope: "module", parentId: module.id, onReload: onReload }) }), _jsxs("div", { style: { marginLeft: 16, marginTop: 8 }, children: [module.lessons.map((l, i) => (_jsx(LessonBlock, { lesson: l, isFirst: i === 0, isLast: i === module.lessons.length - 1, onMove: (dir) => moveLesson(i, dir), onRemove: () => removeLesson(l.id), onReload: onReload }, l.id))), _jsxs("form", { onSubmit: addLesson, style: { display: "flex", gap: 8, marginTop: 8 }, children: [_jsx("input", { placeholder: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0443\u0440\u043E\u043A\u0430", value: newLessonTitle, onChange: (e) => setNewLessonTitle(e.target.value), required: true }), _jsx("button", { type: "submit", children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0443\u0440\u043E\u043A" })] })] })] }));
}
function LessonBlock({ lesson, isFirst, isLast, onMove, onRemove, onReload }) {
    const [title, setTitle] = useState(lesson.title);
    const [textContent, setTextContent] = useState(lesson.text_content ?? "");
    const [videoProvider, setVideoProvider] = useState(lesson.video_provider ?? "");
    const [videoRef, setVideoRef] = useState(lesson.video_ref ?? "");
    async function save() {
        await api.patch(`/admin/lessons/${lesson.id}`, {
            title,
            textContent,
            videoProvider: videoProvider || null,
            videoRef: videoRef || null
        });
        onReload();
    }
    async function uploadFile(e) {
        const file = e.target.files?.[0];
        if (!file)
            return;
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`/api/admin/lessons/${lesson.id}/attachments`, {
            method: "POST",
            body: form
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error === "file_type_not_allowed" ? "Этот тип файла не разрешён" : "Ошибка загрузки");
        }
        e.target.value = "";
        onReload();
    }
    async function removeAttachment(id) {
        await api.delete(`/admin/attachments/${id}`);
        onReload();
    }
    return (_jsxs("div", { style: { background: "#fafafa", border: "1px solid #eee", borderRadius: 6, padding: 10, marginBottom: 8 }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between" }, children: [_jsx("input", { value: title, onChange: (e) => setTitle(e.target.value), style: { fontWeight: 600 } }), _jsxs("div", { children: [_jsx("button", { onClick: () => onMove(-1), disabled: isFirst, children: "\u2191" }), _jsx("button", { onClick: () => onMove(1), disabled: isLast, children: "\u2193" }), _jsx("button", { onClick: onRemove, children: "\u0443\u0434\u0430\u043B\u0438\u0442\u044C \u0443\u0440\u043E\u043A" })] })] }), _jsx("textarea", { placeholder: "\u0422\u0435\u043A\u0441\u0442 \u0443\u0440\u043E\u043A\u0430", value: textContent, onChange: (e) => setTextContent(e.target.value), rows: 3, style: { width: "100%", marginTop: 6 } }), _jsxs("div", { style: { display: "flex", gap: 8, marginTop: 6 }, children: [_jsxs("select", { value: videoProvider, onChange: (e) => setVideoProvider(e.target.value), children: [_jsx("option", { value: "", children: "\u0411\u0435\u0437 \u0432\u0438\u0434\u0435\u043E" }), _jsx("option", { value: "vimeo", children: "Vimeo" }), _jsx("option", { value: "cloudflare_stream", children: "Cloudflare Stream" }), _jsx("option", { value: "self_hosted", children: "\u0421\u0432\u043E\u0439 \u0445\u043E\u0441\u0442\u0438\u043D\u0433" })] }), _jsx("input", { placeholder: "\u0418\u0434\u0435\u043D\u0442\u0438\u0444\u0438\u043A\u0430\u0442\u043E\u0440 / \u0441\u0441\u044B\u043B\u043A\u0430 \u0432\u0438\u0434\u0435\u043E", value: videoRef, onChange: (e) => setVideoRef(e.target.value), style: { flex: 1 } })] }), _jsx("button", { onClick: save, style: { marginTop: 6 }, children: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0443\u0440\u043E\u043A" }), _jsxs("div", { style: { marginTop: 8 }, children: [_jsx("strong", { style: { fontSize: 13 }, children: "\u0414\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u043C\u0430\u0442\u0435\u0440\u0438\u0430\u043B\u044B:" }), _jsx("ul", { style: { margin: "4px 0" }, children: lesson.attachments.map((a) => (_jsxs("li", { style: { fontSize: 13 }, children: [a.file_name, " (", Math.ceil(a.size_bytes / 1024), " \u041A\u0411)", " ", _jsx("button", { onClick: () => removeAttachment(a.id), style: { fontSize: 11 }, children: "\u0443\u0434\u0430\u043B\u0438\u0442\u044C" })] }, a.id))) }), _jsx("input", { type: "file", onChange: uploadFile })] }), _jsx("div", { style: { marginTop: 8 }, children: _jsx(TestBlock, { test: lesson.test, scope: "lesson", parentId: lesson.id, onReload: onReload }) })] }));
}
