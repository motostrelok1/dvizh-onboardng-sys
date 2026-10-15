import { useEffect, useState } from "react";
import { api } from "./api";
import type { PartialBlock } from "@blocknote/core";
import { RichLessonView } from "../editor/RichLessonView";

type TestRef = { id: string; pass_score: number };
type Attachment = { id: string; file_name: string; size_bytes: number };
type Lesson = { id: string; title: string; text_content: string | null; content_blocks?: PartialBlock[] | null; video_provider: string | null; video_ref: string | null; attachments: Attachment[]; test: TestRef | null };
type Module = { id: string; title: string; test: TestRef | null; lessons: Lesson[] };
type Tree = { course: { title: string; description: string | null }; modules: Module[] };
type Answer = { id: string; text: string; is_correct: boolean };
type Question = { id: string; text: string; multiple: boolean; answers: Answer[] };
type TestDetail = { test: { pass_score: number }; questions: Question[] };

export function CoursePreview({ courseId, onBack }: { courseId: string; onBack: () => void }) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [error, setError] = useState("");
  const [activeTest, setActiveTest] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.get<Tree>(`/admin/courses/${courseId}/tree`)
      .then((data) => { if (live) setTree(data); })
      .catch(() => { if (live) setError("Не удалось загрузить курс."); });
    return () => { live = false; };
  }, [courseId]);
  if (activeTest) return <DemoTest testId={activeTest} onBack={() => setActiveTest(null)} />;
  return <section className="lms-course-preview">
    <div className="lms-preview-toolbar"><button type="button" className="lms-card-btn" onClick={onBack}>← К редактированию</button><span className="lms-preview-badge">Демонстрационный просмотр · прогресс не записывается</span></div>
    {error && <p role="alert">{error}</p>}
    {!tree && !error && <p>Загрузка курса…</p>}
    {tree && <>
      <h2>{tree.course.title}</h2>
      {tree.course.description && <p>{tree.course.description}</p>}
      {tree.modules.length === 0 && <div className="lms-panel">В курсе пока нет модулей.</div>}
      {tree.modules.map((module, index) => <section key={module.id} className="lms-panel lms-preview-module">
        <h3>Модуль {index + 1}. {module.title}</h3>
        {module.lessons.map((lesson, i) => <article key={lesson.id} className="lms-preview-lesson">
          <h4>Урок {i + 1}. {lesson.title}</h4>
          {(lesson.content_blocks?.length || lesson.text_content) && <RichLessonView key={lesson.id} contentBlocks={lesson.content_blocks} textContent={lesson.text_content} />}
          {lesson.video_provider && lesson.video_ref && <PreviewVideo provider={lesson.video_provider} videoRef={lesson.video_ref} />}
          {lesson.attachments.length > 0 && <div><strong>Материалы</strong><ul>{lesson.attachments.map((file) => <li key={file.id}><a href={`/api/admin/attachments/${file.id}/preview`} download>{file.file_name}</a> ({Math.ceil(file.size_bytes / 1024)} КБ)</li>)}</ul></div>}
          {lesson.test && <button className="lms-primary-btn" onClick={() => setActiveTest(lesson.test!.id)}>Пройти демонстрационный тест урока</button>}
        </article>)}
        {module.test && <button className="lms-primary-btn" onClick={() => setActiveTest(module.test!.id)}>Пройти демонстрационный тест модуля</button>}
      </section>)}
    </>}
  </section>;
}

function DemoTest({ testId, onBack }: { testId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<TestDetail | null>(null);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    api.get<TestDetail>(`/admin/tests/${testId}`)
      .then((data) => { if (live) setDetail(data); })
      .catch(() => { if (live) setError("Не удалось загрузить вопросы теста."); });
    return () => { live = false; };
  }, [testId]);
  function choose(q: Question, id: string) {
    setSelected((prev) => {
      const existing = prev[q.id] ?? [];
      return { ...prev, [q.id]: q.multiple ? (existing.includes(id) ? existing.filter((a) => a !== id) : [...existing, id]) : [id] };
    });
  }
  const checks = detail?.questions.map((q) => {
    const actual = new Set(selected[q.id] ?? []);
    const correct = new Set(q.answers.filter((a) => a.is_correct).map((a) => a.id));
    return { question: q, correct: actual.size === correct.size && [...actual].every((id) => correct.has(id)) };
  }) ?? [];
  const score = checks.length ? Math.round(checks.filter((c) => c.correct).length / checks.length * 100) : 0;
  return <section className="lms-panel lms-demo-test">
    <div className="lms-preview-toolbar"><button className="lms-card-btn" onClick={onBack}>← К просмотру курса</button><span className="lms-preview-badge">Демо · без сохранения попытки</span></div>
    <h2>Демонстрационный тест</h2>
    {error && <p role="alert">{error}</p>}
    {!detail && !error && <p>Загрузка…</p>}
    {detail && <>
      {detail.questions.length === 0 && <p>В тесте пока нет вопросов.</p>}
      {detail.questions.map((q, i) => <fieldset key={q.id} className="lms-demo-question" disabled={finished}>
        <legend>{i + 1}. {q.text}</legend>
        {q.multiple && <p>Можно выбрать несколько ответов</p>}
        {q.answers.map((a) => <label key={a.id} className="lms-demo-answer">
          <input type={q.multiple ? "checkbox" : "radio"} name={q.id} checked={(selected[q.id] ?? []).includes(a.id)} onChange={() => choose(q, a.id)} /> {a.text}
          {finished && <span>{a.is_correct ? " ✓ верный ответ" : (selected[q.id] ?? []).includes(a.id) ? " ✕ ваш ответ" : ""}</span>}
        </label>)}
        {finished && <p>{checks[i]?.correct ? "Верно" : "Неверно"}</p>}
      </fieldset>)}
      {finished && <p className="lms-demo-result">Результат: {score}% · проходной балл {detail.test.pass_score}% · {score >= detail.test.pass_score ? "пройден" : "не пройден"}</p>}
      {!finished && detail.questions.length > 0 && <button type="button" className="lms-primary-btn" onClick={() => setFinished(true)}>Завершить демонстрационный тест</button>}
      {finished && <button type="button" className="lms-card-btn" onClick={() => { setSelected({}); setFinished(false); }}>Пройти ещё раз</button>}
    </>}
  </section>;
}

// Mirror the employee's currently supported players without recording lesson events.
function PreviewVideo({ provider, videoRef }: { provider: string; videoRef: string }) {
  if (provider === "vimeo" && /^\\d+$/.test(videoRef)) return <div className="lms-preview-video">
    <iframe title="Видео урока" src={`https://player.vimeo.com/video/${videoRef}`} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />
  </div>;
  if (provider === "self_hosted") {
    try {
      const url = new URL(videoRef, window.location.origin);
      if (url.protocol !== "https:" && url.origin !== window.location.origin) throw new Error("invalid");
      return <video className="lms-preview-video" controls preload="metadata"><source src={url.href} /></video>;
    } catch { /* Invalid URL: show a readable fallback instead of embedding it. */ }
  }
  return <p className="lms-preview-meta">Видео ({provider}): {videoRef}. Для этого источника встроенный плеер пока не поддерживается.</p>;
}
