/**
 * Explicit allowlist for initial BlockNote content. All rich documents are
 * structured JSON, never raw HTML. Future block types need server review.
 */
const allowedTypes = new Set([
  "paragraph", "heading", "bulletListItem", "numberedListItem",
  "checkListItem", "quote", "codeBlock"
]);
const safeKeys = new Set(["id", "type", "props", "content", "children"]);
const safeStyles = new Set([
  "bold", "italic", "underline", "strike", "code", "textColor", "backgroundColor"
]);

export function validateLessonBlocks(value: unknown): value is Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) return false;
  let totalNodes = 0;
  function validateBlocks(blocks: unknown[], depth: number): boolean {
    if (depth > 5) return false;
    return blocks.every((raw) => {
      totalNodes++;
      if (totalNodes > 3000 || !raw || typeof raw !== "object" || Array.isArray(raw)) return false;
      const b = raw as Record<string, unknown>;
      if (Object.keys(b).some((key) => !safeKeys.has(key))) return false;
      if (typeof b.type !== "string" || !allowedTypes.has(b.type)) return false;
      if (b.id !== undefined && (typeof b.id !== "string" || b.id.length > 100)) return false;
      if (b.props !== undefined) {
        if (!b.props || typeof b.props !== "object" || Array.isArray(b.props)) return false;
        const props = b.props as Record<string, unknown>;
        const allowed = new Set(["textColor", "backgroundColor", "textAlignment", "level", "checked"]);
        if (Object.keys(props).some((key) => !allowed.has(key))) return false;
        if (Object.values(props).some((v) => !["string", "number", "boolean"].includes(typeof v))) return false;
      }
      if (b.content !== undefined) {
        if (!Array.isArray(b.content) || b.content.length > 1000) return false;
        for (const rawInline of b.content) {
          totalNodes++;
          if (totalNodes > 3000 || !rawInline || typeof rawInline !== "object" || Array.isArray(rawInline)) return false;
          const inline = rawInline as Record<string, unknown>;
          if (inline.type !== "text" || typeof inline.text !== "string" || inline.text.length > 10000) return false;
          if (Object.keys(inline).some((key) => !["type", "text", "styles"].includes(key))) return false;
          if (!inline.styles || typeof inline.styles !== "object" || Array.isArray(inline.styles)) return false;
          const styles = inline.styles as Record<string, unknown>;
          if (Object.keys(styles).some((key) => !safeStyles.has(key))) return false;
          if (Object.values(styles).some((v) => !["string", "boolean"].includes(typeof v))) return false;
        }
      }
      if (b.children !== undefined && (!Array.isArray(b.children) || !validateBlocks(b.children, depth + 1))) return false;
      return true;
    });
  }
  return validateBlocks(value, 0);
}
