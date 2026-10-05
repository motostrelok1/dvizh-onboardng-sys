import { useEffect, useRef, useState } from "react";
import { api } from "../admin/api";
import { enqueueEvent } from "../events";

type Lesson = {
  id: string;
  title: string;
  textContent: string | null;
  videoProvider: string | null;
  videoRef: string | null;
};
type Attachment = { id: string; file_name: string; size_bytes: number };

const ERROR_MESSAGE: Record<string, string> = {
  deadline_passed: "Срок прохождения этого курса истёк, доступ закрыт.",
  not_assigned: "Этот курс вам не назначен.",
  not_enrolled: "Сначала запишитесь на курс из каталога.",
  not_found: "Урок не найден."
};

export function LessonScreen({ lessonId, onBack }: { lessonId: string; onBack: () => void }) {
  const [data, setData] = useState<{ lesson: Lesson; attachments: Attachment[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    api
      .get<{ lesson: Lesson; attachments: Attachment[] }>(`/lessons/${lessonId}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [lessonId]);

  // Время, проведённое на уроке — пишем в журнал событий (этап 8), не
  // дожидаясь прогресса/аналитики, которые будут считаться из него позже.
  useEffect(() => {
    if (!data) return;
    startedAtRef.current = Date.now();
    enqueueEvent({ eventType: "lesson_view_start", entityId: lessonId });
    return () => {
      if (startedAtRef.current) {
        enqueueEvent({
          eventType: "lesson_view_end",
          entityId: lessonId,
          payload: { durationMs: Date.now() - startedAtRef.current }
        });
      }
    };
  }, [data, lessonId]);

  return (
    <div style={{ fontFamily: "system-ui", maxWidth: 480, margin: "0 auto", padding: 24 }}>
      <button onClick={onBack} style={{ marginBottom: 12 }}>
        ← Назад к курсу
      </button>

      {error && <p style={{ color: "crimson" }}>{ERROR_MESSAGE[error] ?? "Не удалось открыть урок."}</p>}

      {data && (
        <>
          <h1>{data.lesson.title}</h1>

          <VideoPlayer provider={data.lesson.videoProvider} videoRef={data.lesson.videoRef} />

          {data.lesson.textContent && (
            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{data.lesson.textContent}</p>
          )}

          {data.attachments.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 14 }}>Дополнительные материалы</h3>
              {data.attachments.map((a) => (
                <div key={a.id} style={{ marginBottom: 6 }}>
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
