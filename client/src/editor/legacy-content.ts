/**
 * Import old lessons.text_content into the BlockNote paragraph shape.
 * Pure conversion: never writes to the database and never treats legacy
 * plain text as HTML. A separate migration/API will own persisted JSON.
 */
export type LegacyTextNode = {
  type: "text";
  text: string;
  styles: Record<string, never>;
};

export type LegacyParagraphBlock = {
  type: "paragraph";
  content: LegacyTextNode[];
};

/**
 * Each legacy line becomes its own paragraph. Empty lines stay empty blocks
 * so the visual editor does not silently collapse intentional whitespace.
 * The original text_content column remains the source of truth until
 * rich JSON has been explicitly saved by an administrator.
 */
export function legacyTextToBlocks(input: string | null | undefined): LegacyParagraphBlock[] {
  if (input == null || input.length === 0) {
    return [{ type: "paragraph", content: [] }];
  }
  const normalized = input.replace(/\r\n?/g, "\n");
  return normalized.split("\n").map((line) => ({
    type: "paragraph",
    content: line ? [{ type: "text", text: line, styles: {} }] : []
  }));
}

/** Used only for compatibility fallback, not as the primary rich editor export. */
export function legacyBlocksToText(blocks: readonly LegacyParagraphBlock[]): string {
  return blocks.map((block) => block.content.map((span) => span.text).join("")).join("\n");
}
