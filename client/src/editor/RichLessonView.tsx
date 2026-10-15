import { ru } from "@blocknote/core/locales";
import type { PartialBlock } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { legacyTextToBlocks } from "./legacy-content";
import "./blocknote-theme.css";
import { lessonBlockSchema } from "./blocknote-schema";

/** Shared read-only view for course preview and employee lessons. */
export function RichLessonView({ contentBlocks, textContent }: {
  contentBlocks: PartialBlock[] | null | undefined;
  textContent: string | null | undefined;
}) {
  const initialContent = contentBlocks?.length ? contentBlocks : legacyTextToBlocks(textContent);
  const editor = useCreateBlockNote({
    dictionary: ru,
    schema: lessonBlockSchema,
    initialContent: initialContent as any
  });
  return <div className="lms-rich-preview">
    <BlockNoteView editor={editor} editable={false} theme="light" />
  </div>;
}
