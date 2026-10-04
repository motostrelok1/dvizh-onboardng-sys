import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "./api";
import { CourseEditor } from "./CourseEditor";
const STATUS_LABEL = {
    draft: "черновик",
    published: "опубликован",
    archived: "архив"
};
export function CoursesTab() {
    const [courses, setCourses] = useState([]);
    const [title, setTitle] = useState("");
    const [openId, setOpenId] = useState(null);
    function reload() {
        api.get("/admin/courses").then((d) => setCourses(d.courses));
    }
    useEffect(reload, []);
    async function create(e) {
        e.preventDefault();
        const d = await api.post("/admin/courses", { title });
        setTitle("");
        reload();
        setOpenId(d.course.id);
    }
    async function remove(id) {
        await api.delete(`/admin/courses/${id}`);
        if (openId === id)
            setOpenId(null);
        reload();
    }
    if (openId) {
        return (_jsx(CourseEditor, { courseId: openId, onBack: () => {
                setOpenId(null);
                reload();
            } }));
    }
    return (_jsxs("div", { children: [_jsxs("form", { onSubmit: create, style: { display: "flex", gap: 8, marginBottom: 16 }, children: [_jsx("input", { placeholder: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043A\u0443\u0440\u0441\u0430", value: title, onChange: (e) => setTitle(e.target.value), required: true }), _jsx("button", { type: "submit", children: "\u0421\u043E\u0437\u0434\u0430\u0442\u044C \u043A\u0443\u0440\u0441" })] }), _jsxs("table", { style: { width: "100%", borderCollapse: "collapse" }, children: [_jsx("thead", { children: _jsxs("tr", { style: { textAlign: "left", borderBottom: "1px solid #ccc" }, children: [_jsx("th", { children: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435" }), _jsx("th", { children: "\u0421\u0442\u0430\u0442\u0443\u0441" }), _jsx("th", { children: "\u0414\u043E\u0441\u0442\u0443\u043F" }), _jsx("th", {})] }) }), _jsx("tbody", { children: courses.map((c) => (_jsxs("tr", { style: { borderBottom: "1px solid #eee" }, children: [_jsx("td", { children: _jsx("button", { onClick: () => setOpenId(c.id), children: c.title }) }), _jsx("td", { children: STATUS_LABEL[c.status] ?? c.status }), _jsx("td", { children: c.visibility === "open_catalog" ? "открытый каталог" : "по назначению" }), _jsx("td", { children: _jsx("button", { onClick: () => remove(c.id), style: { fontSize: 12 }, children: "\u0443\u0434\u0430\u043B\u0438\u0442\u044C" }) })] }, c.id))) })] })] }));
}
