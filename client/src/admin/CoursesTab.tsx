import { useEffect, useState } from "react";
import { api } from "./api";
import { CourseBuilder } from "./CourseBuilder";

type Course = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  visibility: string;
};

const STATUS_LABEL: Record<string, string> = {
  draft: "черновик",
  published: "опубликован",
  archived: "архив"
};

export function CoursesTab() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [title, setTitle] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  function reload() {
    api.get<{ courses: Course[] }>("/admin/courses").then((d) => setCourses(d.courses));
  }

  useEffect(reload, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      const d = await api.post<{ course: Course }>("/admin/courses", { title: title.trim() });
      setTitle("");
      reload();
      setOpenId(d.course.id);
    } catch {
      setError("Не удалось создать курс. Повторите попытку.");
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Удалить курс? Это действие нельзя отменить.")) return;
    await api.delete(`/admin/courses/${id}`);
    if (openId === id) setOpenId(null);
    reload();
  }

  if (openId) {
    return (
      <CourseBuilder
        courseId={openId}
        onBack={() => {
          setOpenId(null);
          reload();
        }}
      />
    );
  }

  return (
    <section className="lms-courses">
      <div className="lms-dashboard-heading"><div><h2>Каталог курсов</h2><p>Создавайте материалы, публикуйте курсы и управляйте доступом</p></div></div>
      <div className="lms-panel">
        <div className="lms-panel-head"><h3>Новый курс</h3></div>
        <form onSubmit={create} className="lms-course-create">
          <label htmlFor="new-course-title">Название курса</label>
          <div className="lms-course-create-row">
            <input id="new-course-title" placeholder="Например: Введение для сотрудников" value={title} onChange={(e) => setTitle(e.target.value)} required disabled={creating} />
            <button type="submit" className="lms-primary-btn" disabled={creating || !title.trim()}>{creating ? "Создаём…" : "+ Создать курс"}</button>
          </div>
          {error && <p role="alert" className="lms-form-error">{error}</p>}
        </form>
      </div>
      <div className="lms-panel">
        <div className="lms-panel-head"><h3>Все курсы</h3><span>Всего: {courses.length}</span></div>
        {courses.length === 0 ? <div className="lms-empty"><strong>Курсов пока нет</strong>Создайте первый курс с помощью формы выше.</div> : (
          <div className="lms-table-scroll"><table className="lms-table lms-courses-table">
            <thead><tr><th>Название</th><th>Статус</th><th>Доступ</th><th>Действия</th></tr></thead>
            <tbody>{courses.map((course) => <tr key={course.id}>
              <td><button type="button" className="lms-course-title" onClick={() => setOpenId(course.id)}>{course.title}</button>{course.description && <div className="lms-course-desc">{course.description}</div>}</td>
              <td><span className={`lms-status lms-status-${course.status === "published" || course.status === "draft" || course.status === "archived" ? course.status : "default"}`}>{STATUS_LABEL[course.status] ?? course.status}</span></td>
              <td>{course.visibility === "open_catalog" ? "Открытый каталог" : "По назначению"}</td>
              <td><div className="lms-course-actions"><button type="button" className="lms-card-btn" onClick={() => setOpenId(course.id)}>Открыть</button><button type="button" className="lms-delete-btn" onClick={() => remove(course.id)}>Удалить</button></div></td>
            </tr>)}</tbody>
          </table></div>
        )}
      </div>
    </section>
  );
}
