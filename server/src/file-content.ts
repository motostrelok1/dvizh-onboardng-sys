import { extname } from "node:path";
import { Worker } from "node:worker_threads";
import { FILE_INSPECTOR_SOURCE } from "./file-content-worker.js";

const MIME_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

export function attachmentContentType(storedPath: string): string {
  return MIME_TYPES[extname(storedPath).toLowerCase()] ?? "application/octet-stream";
}

// Only call for a newly created, private upload, before publishing its DB row.
// Parsing runs off the request thread; malformed files, resource limits and
// timeouts all fail closed. This is format validation, not a malware scanner.
export async function hasAllowedFileContent(diskPath: string, extension: string, declaredMime?: string): Promise<boolean> {
  if (!MIME_TYPES[extension]) return false;
  // Treat a recognized conflicting client MIME as an additional rejection
  // signal. Missing/unknown MIME and octet-stream never bypass byte inspection.
  const mime = declaredMime?.split(";", 1)[0].trim().toLowerCase();
  if (mime && Object.values(MIME_TYPES).includes(mime) && mime !== MIME_TYPES[extension]) return false;
  const worker = new Worker(FILE_INSPECTOR_SOURCE, {
    eval: true,
    // The static CommonJS worker needs no app TS loader or --input-type flags.
    execArgv: [],
    workerData: { diskPath, extension },
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 }
  });
  try {
    return await new Promise<boolean>((resolve) => {
      const finish = (allowed: boolean) => {
        clearTimeout(timer);
        resolve(allowed);
      };
      const timer = setTimeout(() => finish(false), 5_000);
      worker.once("message", (result) => finish(result === true));
      worker.once("error", () => finish(false));
      worker.once("exit", () => finish(false));
    });
  } finally {
    await worker.terminate();
  }
}
