import { ru } from "@blocknote/core/locales";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PartialBlock } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { api } from "../admin/api";
import { legacyTextToBlocks } from "./legacy-content";
import "./blocknote-theme.css";
import { lessonBlockSchema, calloutChoices } from "./blocknote-schema";

type Props = {
  lessonId: string;
  contentBlocks: PartialBlock[] | null;
  textContent: string | null;
  contentRevision: number;
};
type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";
const emojiChoices = ["✅", "⚠️", "💡", "📌", "🚗", "📝", "📖", "🎯", "🔍", "⭐", "➡️", "❗"];

export function BlockLessonEditor({ lessonId, contentBlocks, textContent, contentRevision }: Props) {
  const revision = useRef(contentRevision);
  const dirtyVersion = useRef(0);
  const savedVersion = useRef(0);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [calloutOpen, setCalloutOpen] = useState(false);

  const uploadFile = useCallback(async (file: File) => {
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      throw new Error("Разрешены только JPG и PNG до 10 МБ");
    }
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`/api/admin/lessons/${lessonId}/attachments`, {
      method: "POST", credentials: "same-origin", body: form,
      cache: "no-store", referrerPolicy: "no-referrer"
    });
    const data = await response.json();
    if (!response.ok || !data?.attachment?.id) {
      throw new Error("Не удалось загрузить изображение");
    }
    return `/api/attachments/${data.attachment.id}/inline`;
  }, [lessonId]);

  const initialContent = contentBlocks?.length ? contentBlocks : legacyTextToBlocks(textContent);
  const editor = useCreateBlockNote({ dictionary: ru, schema: lessonBlockSchema, initialContent: initialContent as any, uploadFile }, [lessonId]);

  const save = useCallback(async () => {
    if (inFlight.current || savedVersion.current === dirtyVersion.current) return;
    inFlight.current = true;
    const version = dirtyVersion.current;
    setStatus("saving");
    setSaveError("");
    try {
      const result = await api.patch<{ contentRevision: number }>(
        `/admin/lessons/${lessonId}/blocks`,
        { contentBlocks: editor.document, expectedRevision: revision.current }
      );
      revision.current = result.contentRevision;
      savedVersion.current = version;
      setStatus(version === dirtyVersion.current ? "saved" : "dirty");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      setStatus(reason.includes("content_revision_conflict") ? "conflict" : "error");
      setSaveError(reason || "Ошибка соединения");
      return;
    } finally {
      inFlight.current = false;
    }
    if (dirtyVersion.current > savedVersion.current) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { void save(); }, 500);
    }
  }, [editor, lessonId]);

  const changed = () => {
    dirtyVersion.current += 1;
    setStatus("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(); }, 1400);
  };

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirtyVersion.current !== savedVersion.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return <section className="lms-rich-editor" aria-label="Содержимое урока">
    <div className="lms-rich-editor-toolbar">
      <strong>Содержимое урока</strong>
      <div className="lms-rich-editor-tools">
        <div className="lms-emoji-picker">
          <button type="button" aria-expanded={calloutOpen} onClick={() => setCalloutOpen(v => !v)}>💡 Учебный блок</button>
          {calloutOpen && <div className="lms-callout-options" role="group" aria-label="Тип учебного блока">
            {calloutChoices.map(choice => <button type="button" key={choice.variant}
              onClick={() => {
                editor.insertBlocks([{ type: "callout", props: { variant: choice.variant }, content: [] }],
                  editor.getTextCursorPosition().block, "after");
                setCalloutOpen(false); editor.focus();
              }}>
              {choice.icon} {choice.label}
            </button>)}
          </div>}
        </div>
        <div className="lms-emoji-picker">
          <button type="button" aria-expanded={emojiOpen} onClick={() => setEmojiOpen(v => !v)}>😀 Эмодзи</button>
          {emojiOpen && <div className="lms-emoji-options" role="group" aria-label="Эмодзи">
            {emojiChoices.map(emoji =>
              <button type="button" key={emoji} aria-label={`Вставить ${emoji}`}
                onClick={() => { editor.insertInlineContent(emoji); setEmojiOpen(false); editor.focus(); }}>
                {emoji}
              </button>)}
          </div>}
        </div>
        <span role="status" className={`lms-rich-status lms-rich-status-${status}`}>
          {{ saved: "✓ Сохранено", dirty: "Изменения…", saving: "Сохраняем…",
             error: "Ошибка сохранения", conflict: "Конфликт изменений — перезагрузите урок" }[status]}
        </span>
        <button type="button" disabled={status === "saved" || status === "saving" || status === "conflict"}
          onClick={() => { if (timer.current) clearTimeout(timer.current); void save(); }}>
          Сохранить
        </button>
      </div>
    </div>
    <p className="lms-rich-hint">Наберите / для выбора блока. Перетаскивайте блоки, добавляйте изображения и форматируйте текст.</p>
    <BlockNoteView editor={editor} onChange={changed} theme="light" />
    {status === "error" && <p role="alert" className="lms-form-error">
      Не удалось сохранить урок ({saveError}). Текст пока есть только в редакторе; не закрывайте страницу. Попробуйте «Сохранить» ещё раз.
    </p>}
    {status === "conflict" && <p role="alert" className="lms-form-error">
      Содержимое изменено в другой вкладке. Скопируйте несохранённый текст перед обновлением страницы.
    </p>}
  </section>;
}
