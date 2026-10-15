/** Safe subset of BlockNote's persisted JSON schema. Never render raw HTML. */
const blockTypes = new Set([
  "paragraph", "heading", "bulletListItem", "numberedListItem",
  "checkListItem", "toggleListItem", "quote", "codeBlock", "table", "image", "callout"
]);
const propsKeys = new Set([
  "textColor", "backgroundColor", "textAlignment", "level", "checked",
  "language", "isToggleable", "url", "name", "caption", "showPreview", "previewWidth", "variant"
]);
const styleKeys = new Set(["bold", "italic", "underline", "strike", "code", "textColor", "backgroundColor"]);
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const imageURL = new RegExp(`^/api/attachments/(${uuid})/inline$`, "i");

type RecordData = Record<string, unknown>;
function object(v: unknown): v is RecordData {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function allowedKeys(v: RecordData, allowed: readonly string[]): boolean {
  return Object.keys(v).every((key) => allowed.includes(key));
}
function simpleColor(v: unknown): boolean {
  return typeof v === "string" && v.length < 40 && (/^[a-zA-Z]+$/.test(v) || /^#[0-9a-f]{6}$/i.test(v));
}
function validProps(value: unknown, type: string): boolean {
  if (value === undefined) return true;
  if (!object(value) || Object.keys(value).some(k => !propsKeys.has(k))) return false;
  for (const [key, v] of Object.entries(value)) {
    if (key === "textColor" || key === "backgroundColor") {
      if (!simpleColor(v)) return false;
    } else if (key === "textAlignment") {
      if (!["left", "center", "right", "justify"].includes(String(v))) return false;
    } else if (key === "url") {
      if (type !== "image" || typeof v !== "string" || !imageURL.test(v)) return false;
    } else if (key === "name" || key === "caption" || key === "language") {
      if (typeof v !== "string" || v.length > 1000) return false;
    } else if (key === "variant") {
      if (type !== "callout" || !["important", "tip", "warning", "example", "remember"].includes(String(v))) return false;
    } else if (key === "level") {
      if (![1, 2, 3].includes(v as number)) return false;
    } else if (key === "previewWidth") {
      if (v !== undefined && (typeof v !== "number" || v < 100 || v > 2400)) return false;
    } else if (typeof v !== "boolean") return false;
  }
  return true;
}
export function validateLessonBlocks(value: unknown): value is RecordData[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) return false;
  let count = 0;
  function inlines(value: unknown): boolean {
    if (!Array.isArray(value) || value.length > 1000) return false;
    return value.every(v => {
      if (++count > 3000 || !object(v)) return false;
      if (v.type === "text") {
        if (!allowedKeys(v, ["type", "text", "styles"]) || typeof v.text !== "string" || v.text.length > 10000) return false;
        if (!object(v.styles) || Object.keys(v.styles).some(k => !styleKeys.has(k))) return false;
        return Object.entries(v.styles).every(([k, val]) =>
          k.endsWith("Color") ? simpleColor(val) : typeof val === "boolean");
      }
      if (v.type === "link") {
        if (!allowedKeys(v, ["type", "href", "content"]) || typeof v.href !== "string" || v.href.length > 2048) return false;
        if (!/^https?:\/\//i.test(v.href) && !/^mailto:/i.test(v.href)) return false;
        return typeof v.content === "string"
          ? v.content.length <= 10000
          : inlines(v.content);
      }
      return false;
    });
  }
  function table(value: unknown): boolean {
    if (!object(value) || value.type !== "tableContent" || !Array.isArray(value.rows) ||
        value.rows.length > 40 || !allowedKeys(value, ["type", "rows", "columnWidths", "headerRows", "headerCols"])) return false;
    if (value.columnWidths !== undefined &&
        (!Array.isArray(value.columnWidths) || value.columnWidths.length > 20 ||
         value.columnWidths.some(w => w !== null && (typeof w !== "number" || w < 40 || w > 3000)))) return false;
    for (const key of ["headerRows", "headerCols"]) {
      if (value[key] !== undefined && (!Number.isInteger(value[key]) || (value[key] as number) < 0 || (value[key] as number) > 40)) return false;
    }
    return value.rows.every(row => {
      if (++count > 3000 || !object(row) || !allowedKeys(row, ["cells"]) || !Array.isArray(row.cells) || row.cells.length > 20) return false;
      return row.cells.every(cell => {
        if (typeof cell === "string") return cell.length <= 10000;
        if (Array.isArray(cell)) return inlines(cell);
        if (!object(cell) || cell.type !== "tableCell" || !allowedKeys(cell, ["type", "props", "content"])) return false;
        if (!object(cell.props) || !Object.keys(cell.props).every(k => ["colspan","rowspan","backgroundColor","textColor","textAlignment"].includes(k))) return false;
        for (const key of ["colspan", "rowspan"]) {
          if (cell.props[key] !== undefined && (!Number.isInteger(cell.props[key]) || (cell.props[key] as number) < 1 || (cell.props[key] as number) > 20)) return false;
        }
        for (const key of ["backgroundColor","textColor"]) {
          if (cell.props[key] !== undefined && !simpleColor(cell.props[key])) return false;
        }
        if (cell.props.textAlignment !== undefined && !["left", "center", "right", "justify"].includes(String(cell.props.textAlignment))) return false;
        return inlines(cell.content);
      });
    });
  }
  function blocks(items: unknown[], depth: number): boolean {
    if (depth > 5 || items.length > 500) return false;
    return items.every(v => {
      if (++count > 3000 || !object(v) || !allowedKeys(v, ["id", "type", "props", "content", "children"])) return false;
      if (typeof v.type !== "string" || !blockTypes.has(v.type)) return false;
      if (v.id !== undefined && (typeof v.id !== "string" || v.id.length > 100)) return false;
      if (!validProps(v.props, v.type)) return false;
      if (v.type === "image") {
        if (!object(v.props) || typeof v.props.url !== "string" || !imageURL.test(v.props.url)) return false;
        if (v.content !== undefined && v.content !== null) return false;
      } else if (v.type === "table") {
        if (!table(v.content)) return false;
      } else if (v.content !== undefined && !inlines(v.content)) return false;
      if (v.children !== undefined && (!Array.isArray(v.children) || !blocks(v.children, depth + 1))) return false;
      return true;
    });
  }
  return blocks(value, 0);
}
export function lessonImageIds(blocks: readonly unknown[]): string[] {
  const ids = new Set<string>();
  function walk(items: readonly unknown[]) {
    for (const raw of items) {
      if (!object(raw)) continue;
      if (raw.type === "image" && object(raw.props) && typeof raw.props.url === "string") {
        const m = imageURL.exec(raw.props.url);
        if (m) ids.add(m[1].toLowerCase());
      }
      if (Array.isArray(raw.children)) walk(raw.children);
    }
  }
  walk(blocks);
  return [...ids];
}
