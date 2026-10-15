import { useEffect, useState } from "react";
import type { PartialBlock } from "@blocknote/core";
import { BlockLessonEditor } from "../editor/BlockLessonEditor";
import { api } from "./api";
import { TestBlock } from "./TestBlock";
import { CoursePreview } from "./CoursePreview";
import { CourseAnalyticsSettings } from "./CourseAnalyticsSettings";

type Attachment = { id: string; file_name: string; size_bytes: number };
type Test = { id: string; max_attempts: number | null; show_correct_answers: boolean; pass_score: number };
type Lesson = {
  id: string;
  title: string;
  position: number;
  text_content: string | null;
  content_blocks?: PartialBlock[] | null;
  content_revision?: number;
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
  const [preview, setPreview] = useState(false);
  const [newModuleTitle, setNewModuleTitle] = useState("");
  const [dragModuleId, setDragModuleId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  function reload() {
    api.get<Tree>(`/admin/courses/${courseId}/tree`).then(setTree);
  }

  useEffect(reload, [courseId]);

  if (preview) return <CoursePreview courseId={courseId} onBack={() => setPreview(false)} />;
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

  async function dropModule(targetId: string) {
    const sourceId = dragModuleId;
    setDragModuleId(null);
    if (!sourceId || sourceId === targetId || reordering) return;
    const ids = modules.map((m) => m.id);
    const source = ids.indexOf(sourceId), target = ids.indexOf(targetId);
    if (source < 0 || target < 0) return;
    ids.splice(target, 0, ids.splice(source, 1)[0]);
    setReordering(true);
    try { await api.post("/admin/modules/reorder", { courseId, orderedIds: ids }); reload(); }
    catch { window.alert("Не удалось изменить порядок модулей."); }
    finally { setReordering(false); }
  }

  return (
    <div className="lms-course-editor">
      <button className="lms-card-btn" onClick={onBack} style={{ marginBottom: 12 }}>
        ← К списку курсов
      </button>

      <div className="lms-preview-toolbar"><h2>{course.title}</h2><button type="button" className="lms-primary-btn" onClick={() => setPreview(true)}>Предпросмотр курса</button></div>
      <div className="lms-course-settings lms-panel">
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

      <div className="lms-panel" style={{ marginBottom: 16 }}>
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
          dragging={dragModuleId === m.id}
          onDragStart={() => setDragModuleId(m.id)}
          onDragEnd={() => setDragModuleId(null)}
          onDrop={() => void dropModule(m.id)}
        />
      ))}

      <form onSubmit={addModule} className="lms-add-row lms-panel">
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
  onReload,
  dragging,
  onDragStart,
  onDragEnd,
  onDrop
}: {
  module: Module;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  isFirst: boolean;
  isLast: boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onReload: () => void;
}) {
  const [newLessonTitle, setNewLessonTitle] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [dragLessonId, setDragLessonId] = useState<string | null>(null);
  const [reorderingLessons, setReorderingLessons] = useState(false);

  async function dropLesson(targetId: string) {
    const sourceId = dragLessonId;
    setDragLessonId(null);
    if (!sourceId || sourceId === targetId || reorderingLessons) return;
    const ids = module.lessons.map((l) => l.id);
    const source = ids.indexOf(sourceId), target = ids.indexOf(targetId);
    if (source < 0 || target < 0) return;
    ids.splice(target, 0, ids.splice(source, 1)[0]);
    setReorderingLessons(true);
    try { await api.post("/admin/lessons/reorder", { moduleId: module.id, orderedIds: ids }); onReload(); }
    catch { window.alert("Не удалось изменить порядок уроков."); }
    finally { setReorderingLessons(false); }
  }

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
    <div className={`lms-module-card lms-panel ${dragging ? "lms-dragging" : ""}`} onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-lms-module")) e.preventDefault(); }} onDrop={(e) => { if (e.dataTransfer.types.includes("application/x-lms-module")) { e.preventDefault(); e.stopPropagation(); onDrop(); } }}>
      <div className="lms-collapse-header">
        <span draggable onDragStart={(e) => { e.dataTransfer.setData("application/x-lms-module", module.id); e.dataTransfer.effectAllowed = "move"; onDragStart(); }} onDragEnd={onDragEnd} className="lms-drag-handle" title="Перетащить модуль" aria-label="Перетащить модуль">⠿</span>
        <button type="button" className="lms-collapse-toggle" aria-expanded={expanded} aria-controls={`module-content-${module.id}`} onClick={() => setExpanded((v) => !v)}>{expanded ? "▾" : "▸"} {module.title} <span className="lms-collapse-count">({module.lessons.length} уроков)</span></button>
        <div className="lms-editor-actions">
          <button type="button" className="lms-editor-icon" title="Переместить выше" aria-label="Переместить выше" onClick={() => onMove(-1)} disabled={isFirst}>
            ↑
          </button>
          <button type="button" className="lms-editor-icon" title="Переместить ниже" aria-label="Переместить ниже" onClick={() => onMove(1)} disabled={isLast}>
            ↓
          </button>
          <button type="button" className="lms-editor-delete" onClick={onRemove}>Удалить модуль</button>
        </div>
      </div>

      <div id={`module-content-${module.id}`} hidden={!expanded}>
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
            dragging={dragLessonId === l.id}
            onDragStart={() => setDragLessonId(l.id)}
            onDragEnd={() => setDragLessonId(null)}
            onDrop={() => void dropLesson(l.id)}
          />
        ))}

        <form className="lms-lesson-add" onSubmit={addLesson} style={{ display: "flex", gap: 8, marginTop: 8 }}>
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
    </div>
  );
}

function LessonBlock({
  lesson,
  isFirst,
  isLast,
  onMove,
  onRemove,
  onReload,
  dragging,
  onDragStart,
  onDragEnd,
  onDrop
}: {
  lesson: Lesson;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  isFirst: boolean;
  isLast: boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onReload: () => void;
}) {
  const [title, setTitle] = useState(lesson.title);
  const [videoProvider, setVideoProvider] = useState(lesson.video_provider ?? "");
  const [videoRef, setVideoRef] = useState(lesson.video_ref ?? "");
  const [uploading, setUploading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [editorOpened, setEditorOpened] = useState(false);

  async function save() {
    await api.patch(`/admin/lessons/${lesson.id}`, {
      title,
      videoProvider: videoProvider || null,
      videoRef: videoRef || null
    });
    onReload();
  }

  async function uploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget, file = input.files?.[0];
    if (!file || uploading) return;
    setUploading(true);
    try {
      const form = new FormData(); form.append("file", file);
      const res = await fetch(`/api/admin/lessons/${lesson.id}/attachments`, {
        method: "POST", cache: "no-store", referrerPolicy: "no-referrer", body: form
      });
      const data = await res.json();
      if (!res.ok) {
        const messages: Record<string, string> = {
          file_type_not_allowed: "Этот тип файла не разрешён.",
          storage_full: "Недостаточно свободного места. Сообщите администратору сервера.",
          upload_busy: "Сейчас загружаются другие файлы. Повторите через несколько секунд.",
          upload_timeout: "Загрузка заняла слишком много времени. Повторите попытку.",
          upload_unavailable: "Загрузка временно недоступна. Повторите позже."
        };
        alert(messages[data.error] ?? "Ошибка загрузки.");
      } else { onReload(); }
    } catch { alert("Не удалось загрузить файл. Проверьте соединение и повторите попытку."); }
    finally { input.value = ""; setUploading(false); }
  }

  async function removeAttachment(id: string) {
    await api.delete(`/admin/attachments/${id}`);
    onReload();
  }

  return (
    <div className={`lms-lesson-card ${dragging ? "lms-dragging" : ""}`} onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-lms-lesson")) e.preventDefault(); }} onDrop={(e) => { if (e.dataTransfer.types.includes("application/x-lms-lesson")) { e.preventDefault(); e.stopPropagation(); onDrop(); } }}>
      <div className="lms-collapse-header">
        <span draggable onDragStart={(e) => { e.dataTransfer.setData("application/x-lms-lesson", lesson.id); e.dataTransfer.effectAllowed = "move"; onDragStart(); }} onDragEnd={onDragEnd} className="lms-drag-handle" title="Перетащить урок" aria-label="Перетащить урок">⠿</span>
        <button type="button" className="lms-collapse-toggle" aria-expanded={expanded} aria-controls={`lesson-content-${lesson.id}`} onClick={() => { setEditorOpened(true); setExpanded((v) => !v); }}>{expanded ? "▾" : "▸"} {title || "Без названия"}</button>
        <div className="lms-editor-actions">
          <button type="button" className="lms-editor-icon" title="Переместить выше" aria-label="Переместить выше" onClick={() => onMove(-1)} disabled={isFirst}>
            ↑
          </button>
          <button type="button" className="lms-editor-icon" title="Переместить ниже" aria-label="Переместить ниже" onClick={() => onMove(1)} disabled={isLast}>
            ↓
          </button>
          <button type="button" className="lms-editor-delete" onClick={onRemove}>Удалить урок</button>
        </div>
      </div>

      <div id={`lesson-content-${lesson.id}`} hidden={!expanded}>
      {editorOpened && <>
      <input aria-label="Название урока" value={title} onChange={(e) => setTitle(e.target.value)} style={{ fontWeight: 600, width: "100%", marginTop: 10 }} />
      <BlockLessonEditor key={lesson.id} lessonId={lesson.id}
        contentBlocks={lesson.content_blocks ?? null}
        textContent={lesson.text_content}
        contentRevision={lesson.content_revision ?? 0} />

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

      <button type="button" className="lms-editor-save" onClick={save} style={{ marginTop: 6 }}>
        Сохранить название и видео
      </button>

      <div style={{ marginTop: 8 }}>
        <strong style={{ fontSize: 13 }}>Дополнительные материалы:</strong>
        <ul style={{ margin: "4px 0" }}>
          {lesson.attachments.map((a) => (
            <li key={a.id} style={{ fontSize: 13 }}>
              {a.file_name} ({Math.ceil(a.size_bytes / 1024)} КБ){" "}
              <button type="button" className="lms-editor-delete" onClick={() => removeAttachment(a.id)} style={{ fontSize: 11 }}>
                удалить
              </button>
            </li>
          ))}
        </ul>
        <input type="file" onChange={uploadFile} disabled={uploading} />
      </div>

      <div style={{ marginTop: 8 }}>
        <TestBlock test={lesson.test} scope="lesson" parentId={lesson.id} onReload={onReload} />
      </div>
      </>}
      </div>
    </div>
  );
}
