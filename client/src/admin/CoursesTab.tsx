import { useEffect, useState } from "react";
import { api } from "./api";
import { CourseEditor } from "./CourseEditor";

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

  function reload() {
    api.get<{ courses: Course[] }>("/admin/courses").then((d) => setCourses(d.courses));
  }

  useEffect(reload, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const d = await api.post<{ course: Course }>("/admin/courses", { title });
    setTitle("");
    reload();
    setOpenId(d.course.id);
  }

  async function remove(id: string) {
    await api.delete(`/admin/courses/${id}`);
    if (openId === id) setOpenId(null);
    reload();
  }

  if (openId) {
    return (
      <CourseEditor
        courseId={openId}
        onBack={() => {
          setOpenId(null);
          reload();
        }}
      />
    );
  }

  return (
    <div>
      <form onSubmit={create} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          placeholder="Название курса"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <button type="submit">Создать курс</button>
      </form>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
            <th>Название</th>
            <th>Статус</th>
            <th>Доступ</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {courses.map((c) => (
            <tr key={c.id} style={{ borderBottom: "1px solid #eee" }}>
              <td>
                <button onClick={() => setOpenId(c.id)}>{c.title}</button>
              </td>
              <td>{STATUS_LABEL[c.status] ?? c.status}</td>
              <td>{c.visibility === "open_catalog" ? "открытый каталог" : "по назначению"}</td>
              <td>
                <button onClick={() => remove(c.id)} style={{ fontSize: 12 }}>
                  удалить
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
