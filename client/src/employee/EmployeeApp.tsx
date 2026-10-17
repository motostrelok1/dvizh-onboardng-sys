import { useEffect, useState } from "react";
import { api } from "../admin/api";
import { LoginForm, type SessionUser } from "../shared/LoginForm";
import { CourseScreen } from "./CourseScreen";
import { Notifications } from "./Notifications";
import { MyCoursesDashboard } from "./MyCoursesDashboard";

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
  const [actionError,setActionError]=useState<string|null>(null);
  const [enrolling,setEnrolling]=useState(false);

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
    if(enrolling)return;
    setEnrolling(true);setActionError(null);
    try { await api.post(`/courses/${courseId}/enroll`);reload();setOpenCourseId(courseId); }
    catch(e) { setActionError(e instanceof Error?e.message:"Не удалось записаться на курс"); }
    finally { setEnrolling(false); }
  }
  return <MyCoursesDashboard assigned={assigned} catalog={catalog} onOpen={setOpenCourseId}
    onEnroll={id=>void enroll(id)} notifications={<Notifications />}
    onLogout={()=>{void api.post("/auth/logout").then(()=>setUser(null)).catch(()=>setActionError("Не удалось выйти"))}}
    error={actionError} busy={enrolling} />;
}
