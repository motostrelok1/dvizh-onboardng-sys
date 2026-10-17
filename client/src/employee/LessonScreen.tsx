import { lazy, Suspense, useEffect, useState } from "react";
import { api } from "../admin/api";
import { enqueueEvent } from "../events";
import type { PartialBlock } from "@blocknote/core";
const RichLessonView = lazy(() => import("../editor/RichLessonView").then(m => ({ default: m.RichLessonView })));

type Lesson = {
  id: string;
  title: string;
  textContent: string | null;
  contentBlocks?: PartialBlock[] | null;
  videoProvider: string | null;
  videoRef: string | null;
};
type Attachment = { id: string; file_name: string; size_bytes: number };

const ERROR_MESSAGE: Record<string, string> = {
  deadline_passed: "Срок прохождения этого курса истёк, доступ закрыт.",
  not_assigned: "Этот курс вам не назначен.",
  not_enrolled: "Сначала запишитесь на курс из каталога.",
  not_found: "Блок не найден."
};

export function LessonScreen({ lessonId, onBack }: { lessonId: string; onBack: () => void }) {
  const [data, setData] = useState<{ lesson: Lesson; attachments: Attachment[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null); setError(null);
    api
      .get<{ lesson: Lesson; attachments: Attachment[] }>(`/lessons/${lessonId}`)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [lessonId]);

  // Время, проведённое на уроке — пишем в журнал событий (этап 8), не
  // дожидаясь прогресса/аналитики, которые будут считаться из него позже.
  useEffect(() => {
    if (!data || data.lesson.id !== lessonId) return;
    const startedAt = performance.now();
    enqueueEvent({ eventType: "lesson_view_start", entityId: lessonId });
    return () => {
      enqueueEvent({
        eventType: "lesson_view_end",
        entityId: lessonId,
        payload: { durationMs: Math.min(2147483647, Math.max(0, Math.round(performance.now() - startedAt))) }
      });
    };
  }, [data, lessonId]);

  return (
    <article className="dv-learning-content-card">
      <button onClick={onBack} style={{ marginBottom: 12 }}>
        ← Назад к курсу
      </button>

      {error && <p style={{ color: "crimson" }}>{ERROR_MESSAGE[error] ?? "Не удалось открыть блок."}</p>}

      {data && (
        <>
          <h1 className="dv-learning-lesson-title">{data.lesson.title}</h1>

          <VideoPlayer provider={data.lesson.videoProvider} videoRef={data.lesson.videoRef} />

          {(data.lesson.contentBlocks?.length || data.lesson.textContent) && (
            <Suspense fallback={<p>Загружаем содержимое блока…</p>}><RichLessonView key={data.lesson.id} contentBlocks={data.lesson.contentBlocks} textContent={data.lesson.textContent} /></Suspense>
          )}

          {data.attachments.length > 0 && (
            <section className="dv-learning-attachments">
              <h3>♧ Дополнительные материалы</h3><div className="dv-learning-files">
              {data.attachments.map((a) => (
                <a key={a.id} className="dv-learning-file" href={`/api/attachments/${a.id}/download`} download>
                  <a href={`/api/attachments/${a.id}/download`} download>
                    📄 {a.file_name}
                  </a>{" "}
                  <span style={{ fontSize: 12, color: "#888" }}>
                    ({Math.ceil(a.size_bytes / 1024)} КБ)
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Встраивание плеера зависит от провайдера видео. Это упрощённая версия —
// полноценный выбор провайдера и формат ссылки см. SPEC §11.1–11.2.
function VideoPlayer({ provider, videoRef }: { provider: string | null; videoRef: string | null }) {
  if (!provider || !videoRef) return null;

  if (provider === "vimeo") {
    return (
      <div style={{ aspectRatio: "16/9", marginBottom: 12 }}>
        <iframe
          src={`https://player.vimeo.com/video/${videoRef}`}
          style={{ width: "100%", height: "100%", border: 0 }}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  if (provider === "self_hosted") {
    return (
      <video controls style={{ width: "100%", marginBottom: 12 }}>
        <source src={videoRef} />
      </video>
    );
  }

  return (
    <p style={{ fontSize: 13, color: "#888" }}>
      Видео ({provider}): {videoRef} — встраивание для этого провайдера ещё не настроено.
    </p>
  );
}
