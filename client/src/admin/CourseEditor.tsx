import { useEffect, useState } from "react";
import { api } from "./api";
import { TestBlock } from "./TestBlock";
import { CourseAnalyticsSettings } from "./CourseAnalyticsSettings";

type Attachment = { id: string; file_name: string; size_bytes: number };
type Test = { id: string; max_attempts: number | null; show_correct_answers: boolean; pass_score: number };
type Lesson = {
  id: string;
  title: string;
  position: number;
  text_content: string | null;
  video_provider: string | null;
  video_ref: string | null;
  attachments: Attachment[];
  test: Test | null;
};
type Module = { id: string; title: string; position: number; test: Test | null; lessons: Lesson[] };
type Course = { id: string; title: string; description: string | null; status: string; visibility: string };
type Tree = { course: Course; modules: Module[] };

export function CourseEditor({ courseId, onBack }: { courseId: string; onBack: () => void }) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [newModuleTitle, setNewModuleTitle] = useState("");

  function reload() {
    api.get<Tree>(`/admin/courses/${courseId}/tree`).then(setTree);
  }

  useEffect(reload, [courseId]);

  if (!tree) return <p>Загрузка…</p>;
  const { course, modules } = tree;

  async function updateCourse(patch: Partial<Course>) {
    await api.patch(`/admin/courses/${courseId}`, patch);
    reload();
  }

  async function addModule(e: React.FormEvent) {
    e.preventDefault();
    await api.post(`/admin/courses/${courseId}/modules`, { title: newModuleTitle });
    setNewModuleTitle("");
    reload();
  }

  async function removeModule(id: string) {
    await api.delete(`/admin/modules/${id}`);
    reload();
  }

  async function moveModule(index: number, dir: -1 | 1) {
    const ids = modules.map((m) => m.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await api.post("/admin/modules/reorder", { courseId, orderedIds: ids });
    reload();
  }

  return (
    <div>
      <button onClick={onBack} style={{ marginBottom: 12 }}>
        ← К списку курсов
      </button>

      <h2>{course.title}</h2>
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <label>
          Статус:{" "}
          <select value={course.status} onChange={(e) => updateCourse({ status: e.target.value })}>
            <option value="draft">черновик</option>
            <option value="published">опубликован</option>
            <option value="archived">архив</option>
          </select>
        </label>
        <label>
          Доступ:{" "}
          <select value={course.visibility} onChange={(e) => updateCourse({ visibility: e.target.value })}>
            <option value="assigned_only">по назначению</option>
            <option value="open_catalog">открытый каталог</option>
          </select>
        </label>
      </div>

      <div style={{ marginBottom: 16 }}>
        <CourseAnalyticsSettings courseId={courseId} />
      </div>

      {modules.map((m, i) => (
        <ModuleBlock
          key={m.id}
          module={m}
          isFirst={i === 0}
          isLast={i === modules.length - 1}
          onMove={(dir) => moveModule(i, dir)}
          onRemove={() => removeModule(m.id)}
          onReload={reload}
        />
      ))}

      <form onSubmit={addModule} style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <input
          placeholder="Название модуля"
          value={newModuleTitle}
          onChange={(e) => setNewModuleTitle(e.target.value)}
          required
        />
        <button type="submit">Добавить модуль</button>
      </form>
    </div>
  );
}

function ModuleBlock({
  module,
  isFirst,
  isLast,
  onMove,
  onRemove,
  onReload
}: {
  module: Module;
  isFirst: boolean;
  isLast: boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onReload: () => void;
}) {
  const [newLessonTitle, setNewLessonTitle] = useState("");

  async function addLesson(e: React.FormEvent) {
    e.preventDefault();
    await api.post(`/admin/modules/${module.id}/lessons`, { title: newLessonTitle });
    setNewLessonTitle("");
    onReload();
  }

  async function moveLesson(index: number, dir: -1 | 1) {
    const ids = module.lessons.map((l) => l.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await api.post("/admin/lessons/reorder", { moduleId: module.id, orderedIds: ids });
    onReload();
  }

  async function removeLesson(id: string) {
    await api.delete(`/admin/lessons/${id}`);
    onReload();
  }

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>{module.title}</strong>
        <div>
          <button onClick={() => onMove(-1)} disabled={isFirst}>
            ↑
          </button>
          <button onClick={() => onMove(1)} disabled={isLast}>
            ↓
          </button>
          <button onClick={onRemove}>удалить модуль</button>
        </div>
      </div>

      <div style={{ marginTop: 6 }}>
        <TestBlock test={module.test} scope="module" parentId={module.id} onReload={onReload} />
      </div>

      <div style={{ marginLeft: 16, marginTop: 8 }}>
        {module.lessons.map((l, i) => (
          <LessonBlock
            key={l.id}
            lesson={l}
            isFirst={i === 0}
            isLast={i === module.lessons.length - 1}
            onMove={(dir) => moveLesson(i, dir)}
            onRemove={() => removeLesson(l.id)}
            onReload={onReload}
          />
        ))}

        <form onSubmit={addLesson} style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            placeholder="Название урока"
            value={newLessonTitle}
            onChange={(e) => setNewLessonTitle(e.target.value)}
            required
          />
          <button type="submit">Добавить урок</button>
        </form>
      </div>
    </div>
  );
}

function LessonBlock({
  lesson,
  isFirst,
  isLast,
  onMove,
  onRemove,
  onReload
}: {
  lesson: Lesson;
  isFirst: boolean;
  isLast: boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onReload: () => void;
}) {
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

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
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

  async function removeAttachment(id: string) {
    await api.delete(`/admin/attachments/${id}`);
    onReload();
  }

  return (
    <div style={{ background: "#fafafa", border: "1px solid #eee", borderRadius: 6, padding: 10, marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ fontWeight: 600 }} />
        <div>
          <button onClick={() => onMove(-1)} disabled={isFirst}>
            ↑
          </button>
          <button onClick={() => onMove(1)} disabled={isLast}>
            ↓
          </button>
          <button onClick={onRemove}>удалить урок</button>
        </div>
      </div>

      <textarea
        placeholder="Текст урока"
        value={textContent}
        onChange={(e) => setTextContent(e.target.value)}
        rows={3}
        style={{ width: "100%", marginTop: 6 }}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <select value={videoProvider} onChange={(e) => setVideoProvider(e.target.value)}>
          <option value="">Без видео</option>
          <option value="vimeo">Vimeo</option>
          <option value="cloudflare_stream">Cloudflare Stream</option>
          <option value="self_hosted">Свой хостинг</option>
        </select>
        <input
          placeholder="Идентификатор / ссылка видео"
          value={videoRef}
          onChange={(e) => setVideoRef(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>

      <button onClick={save} style={{ marginTop: 6 }}>
        Сохранить урок
      </button>

      <div style={{ marginTop: 8 }}>
        <strong style={{ fontSize: 13 }}>Дополнительные материалы:</strong>
        <ul style={{ margin: "4px 0" }}>
          {lesson.attachments.map((a) => (
            <li key={a.id} style={{ fontSize: 13 }}>
              {a.file_name} ({Math.ceil(a.size_bytes / 1024)} КБ){" "}
              <button onClick={() => removeAttachment(a.id)} style={{ fontSize: 11 }}>
                удалить
              </button>
            </li>
          ))}
        </ul>
        <input type="file" onChange={uploadFile} />
      </div>

      <div style={{ marginTop: 8 }}>
        <TestBlock test={lesson.test} scope="lesson" parentId={lesson.id} onReload={onReload} />
      </div>
    </div>
  );
}
