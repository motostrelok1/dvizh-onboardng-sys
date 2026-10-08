import { useEffect, useState } from "react";
import { api } from "../admin/api";
import { LoginForm, type SessionUser } from "../shared/LoginForm";
import { CourseScreen } from "./CourseScreen";
import { Notifications } from "./Notifications";

type AssignedCourse = {
  assignment_id: string;
  course_id: string;
  title: string;
  description: string | null;
  status: string;
  deadline: string | null;
  is_required: boolean;
};
type CatalogCourse = { course_id: string; title: string; description: string | null };

const STATUS_LABEL: Record<string, string> = {
  assigned: "не начат",
  in_progress: "в процессе",
  completed: "завершён",
  overdue: "доступ закрыт (просрочен)",
  closed: "закрыт"
};

export default function EmployeeApp() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [assigned, setAssigned] = useState<AssignedCourse[]>([]);
  const [catalog, setCatalog] = useState<CatalogCourse[]>([]);
  const [openCourseId, setOpenCourseId] = useState<string | null>(null);

  function reload() {
    api
      .get<{ assigned: AssignedCourse[]; catalog: CatalogCourse[] }>("/me/courses")
      .then((d) => {
        setAssigned(d.assigned);
        setCatalog(d.catalog);
      });
  }

  useEffect(() => {
    api
      .get<{ user: SessionUser }>("/auth/me")
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (user) reload();
  }, [user]);

  if (user === undefined) return <p style={{ padding: 24 }}>Загрузка…</p>;
  if (user === null) return <LoginForm onLogin={setUser} />;

  if (openCourseId) {
    return <CourseScreen courseId={openCourseId} onBack={() => setOpenCourseId(null)} />;
  }

  async function enroll(courseId: string) {
    await api.post(`/courses/${courseId}/enroll`);
    reload();
    setOpenCourseId(courseId);
  }

  return (
    <div style={{ fontFamily: "system-ui", maxWidth: 480, margin: "0 auto", padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
        <h1>Мои курсы</h1>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Notifications />
          <button onClick={() => api.post("/auth/logout").then(() => setUser(null))}>Выйти</button>
        </div>
      </header>

      {assigned.map((c) => (
        <div
          key={c.assignment_id}
          onClick={() => c.status !== "overdue" && setOpenCourseId(c.course_id)}
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            padding: 14,
            marginBottom: 10,
            cursor: c.status === "overdue" ? "default" : "pointer",
            opacity: c.status === "overdue" ? 0.6 : 1
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>{c.title}</strong>
            <span style={{ fontSize: 12, color: c.status === "overdue" ? "crimson" : "#666" }}>
              {STATUS_LABEL[c.status] ?? c.status}
            </span>
          </div>
          {c.deadline && (
            <div style={{ fontSize: 12, color: "#888" }}>
              Срок: {new Date(c.deadline).toLocaleDateString()}
            </div>
          )}
        </div>
      ))}

      {catalog.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>Открытый каталог</h2>
          {catalog.map((c) => (
            <div key={c.course_id} style={{ border: "1px solid #ddd", borderRadius: 10, padding: 14, marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>{c.title}</strong>
                <button onClick={() => enroll(c.course_id)}>Записаться</button>
              </div>
            </div>
          ))}
        </>
      )}

      {assigned.length === 0 && catalog.length === 0 && <p>Пока нет назначенных курсов.</p>}
    </div>
  );
}
