import CFB from "cfb";
import { PDFDocument } from "pdf-lib";

// Generated locally, without downloaded third-party documents or personal data.
const document = await PDFDocument.create();
document.addPage([100, 100]);
export const PDF = Buffer.from(await document.save());
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8//8/AwMDEwMDAwMDAwAkBgMB/DXemwAAAABJRU5ErkJggg==", "base64");
export const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==", "base64");

export function zip(files) {
  const container = CFB.utils.cfb_new();
  for (const [name, content] of Object.entries(files)) CFB.utils.cfb_add(container, name, Buffer.from(content));
  return Buffer.from(CFB.write(container, { type: "buffer", fileType: "zip", compression: true }));
}

export function officeParts(kind = "docx") {
  const main = kind === "docx" ? "word/document.xml" : "xl/workbook.xml";
  const mime = kind === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
  return {
    "[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${main}" ContentType="${mime}"/></Types>`,
    "_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${main}"/></Relationships>`,
    [main]: kind === "docx"
      ? '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p/></w:body></w:document>'
      : '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>'
  };
}

// Minimal binary Office streams for checking the container/format boundary;
// these fixtures do not claim to cover every Word or BIFF record.
function legacy(kind) {
  const container = CFB.utils.cfb_new();
  if (kind === "doc") {
    const word = Buffer.alloc(64);
    word.writeUInt16LE(0xa5ec, 0);
    word.writeUInt16LE(0x00c1, 2);
    CFB.utils.cfb_add(container, "WordDocument", word);
    CFB.utils.cfb_add(container, "0Table", Buffer.alloc(16));
  } else {
    const book = Buffer.from([9, 8, 8, 0, 0, 6, 5, 0, 0, 0, 0, 0, 10, 0, 0, 0]);
    CFB.utils.cfb_add(container, "Workbook", book);
  }
  return Buffer.from(CFB.write(container, { type: "buffer" }));
}

export const DOC = legacy("doc");
export const XLS = legacy("xls");
export const DOCX = zip(officeParts("docx"));
export const XLSX = zip(officeParts("xlsx"));
