import { jsx as _jsx } from "react/jsx-runtime";
import AdminApp from "./admin/AdminApp";
export default function App() {
    // Пока нет роутинга между кабинетом сотрудника и админкой (появится
    // в следующих этапах) — для проверки этапа 3 открываем админку напрямую.
    return _jsx(AdminApp, {});
}
