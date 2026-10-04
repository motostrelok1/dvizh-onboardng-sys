import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "./api";
export function DepartmentsTab() {
    const [items, setItems] = useState([]);
    const [name, setName] = useState("");
    function reload() {
        api.get("/admin/departments").then((d) => setItems(d.departments));
    }
    useEffect(reload, []);
    async function create(e) {
        e.preventDefault();
        await api.post("/admin/departments", { name });
        setName("");
        reload();
    }
    async function remove(id) {
        await api.delete(`/admin/departments/${id}`);
        reload();
    }
    return (_jsxs("div", { children: [_jsxs("form", { onSubmit: create, style: { display: "flex", gap: 8, marginBottom: 16 }, children: [_jsx("input", { placeholder: "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043E\u0442\u0434\u0435\u043B\u0430", value: name, onChange: (e) => setName(e.target.value), required: true }), _jsx("button", { type: "submit", children: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C" })] }), _jsx("ul", { children: items.map((d) => (_jsxs("li", { style: { marginBottom: 6 }, children: [d.name, " ", _jsx("button", { onClick: () => remove(d.id), style: { fontSize: 12 }, children: "\u0443\u0434\u0430\u043B\u0438\u0442\u044C" })] }, d.id))) })] }));
}
