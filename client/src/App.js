import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useState } from "react";
import { api } from "./admin/api";
import { LoginForm } from "./shared/LoginForm";
import AdminApp from "./admin/AdminApp";
import EmployeeApp from "./employee/EmployeeApp";
export default function App() {
    const [user, setUser] = useState(undefined);
    useEffect(() => {
        api
            .get("/auth/me")
            .then((d) => setUser(d.user))
            .catch(() => setUser(null));
    }, []);
    if (user === undefined)
        return _jsx("p", { style: { padding: 24 }, children: "\u0417\u0430\u0433\u0440\u0443\u0437\u043A\u0430\u2026" });
    if (user === null)
        return _jsx(LoginForm, { onLogin: setUser });
    return user.role === "admin" ? _jsx(AdminApp, {}) : _jsx(EmployeeApp, {});
}
