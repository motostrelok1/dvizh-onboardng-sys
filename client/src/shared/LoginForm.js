import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { api } from "../admin/api";
export function LoginForm({ onLogin }) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);
    async function submit(e) {
        e.preventDefault();
        setError(null);
        try {
            const d = await api.post("/auth/login", { email, password });
            onLogin(d.user);
        }
        catch {
            setError("Неверный email или пароль");
        }
    }
    return (_jsxs("form", { onSubmit: submit, style: { maxWidth: 320, margin: "80px auto", fontFamily: "system-ui" }, children: [_jsx("h1", { children: "\u0412\u0445\u043E\u0434" }), _jsx("input", { placeholder: "Email", value: email, onChange: (e) => setEmail(e.target.value), style: { display: "block", width: "100%", marginBottom: 8, padding: 8 } }), _jsx("input", { placeholder: "\u041F\u0430\u0440\u043E\u043B\u044C", type: "password", value: password, onChange: (e) => setPassword(e.target.value), style: { display: "block", width: "100%", marginBottom: 8, padding: 8 } }), error && _jsx("p", { style: { color: "crimson" }, children: error }), _jsx("button", { type: "submit", children: "\u0412\u043E\u0439\u0442\u0438" })] }));
}
