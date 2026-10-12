import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

export const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads"));
export const ALLOWED_EXTENSIONS = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".png", ".jpg", ".jpeg"];

export class StoragePathError extends Error {
  statusCode = 400;
  code = "unsafe_storage_path";

  constructor() {
    super("unsafe_storage_path");
  }
}

export function isValidLessonId(lessonId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lessonId);
}

function lessonDirectory(lessonId: string): string {
  if (!isValidLessonId(lessonId)) throw new StoragePathError();
  return resolve(UPLOAD_DIR, "lessons", lessonId.toLowerCase());
}

function checkedAttachmentPath(lessonId: string, diskPath: string): string {
  const lessonDir = lessonDirectory(lessonId);
  const path = resolve(diskPath);
  const fromRoot = relative(UPLOAD_DIR, path);
  if (fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)
      || isAbsolute(fromRoot) || dirname(path) !== lessonDir) {
    throw new StoragePathError();
  }
  return path;
}

export function attachmentPath(lessonId: string, storedName: string): string {
  // Only a leaf filename is accepted; old ordinary leaf names remain readable.
  if (!storedName || storedName === "." || storedName === ".." || /[/\\:\0]/.test(storedName)) {
    throw new StoragePathError();
  }
  return checkedAttachmentPath(lessonId, resolve(lessonDirectory(lessonId), storedName));
}

export function allowedExtension(originalName: string): string | null {
  if (/[/\\]$/.test(originalName) || originalName.includes("\0")) return null;
  const extension = extname(originalName).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(extension) ? extension : null;
}

export function storedFileName(originalName: string): string {
  const extension = allowedExtension(originalName);
  if (!extension) throw new StoragePathError();
  return `${randomUUID()}${extension}`;
}

async function assertDirectory(path: string, expectedRealPath?: string): Promise<string> {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new StoragePathError();
  const actual = await realpath(path);
  if (expectedRealPath && actual !== expectedRealPath) throw new StoragePathError();
  return actual;
}

async function mkdirPrivate(path: string, recursive = false) {
  try {
    await mkdir(path, { recursive, mode: 0o700 });
  } catch (error: any) {
    if (error.code !== "EEXIST") throw error;
  }
}

async function assertLessonDirectories(lessonId: string) {
  const lessonDir = lessonDirectory(lessonId);
  const root = await assertDirectory(UPLOAD_DIR);
  await assertDirectory(join(UPLOAD_DIR, "lessons"), join(root, "lessons"));
  await assertDirectory(lessonDir, join(root, "lessons", lessonId.toLowerCase()));
}

export async function ensureLessonDir(lessonId: string): Promise<string> {
  const lessonDir = lessonDirectory(lessonId); // validate before any mkdir
  await mkdirPrivate(UPLOAD_DIR, true);
  const root = await assertDirectory(UPLOAD_DIR);
  const lessonsDir = join(UPLOAD_DIR, "lessons");
  await mkdirPrivate(lessonsDir);
  await assertDirectory(lessonsDir, join(root, "lessons"));
  await mkdirPrivate(lessonDir);
  await assertDirectory(lessonDir, join(root, "lessons", lessonId.toLowerCase()));
  return lessonDir;
}

export async function openNewAttachment(lessonId: string, storedName: string) {
  const diskPath = attachmentPath(lessonId, storedName);
  await assertLessonDirectories(lessonId);
  // Never overwrite an existing file or follow a leaf symlink. Linux deployment.
  const handle = await open(diskPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  return { diskPath, handle };
}

export async function openStagedAttachment(lessonId: string, originalName: string) {
  const diskPath = attachmentPath(lessonId, storedFileName(originalName));
  await ensureLessonDir(lessonId);
  const { diskPath: temporaryPath, handle } = await openNewAttachment(lessonId, `.upload-${randomUUID()}.part`);
  let published = false;
  return {
    handle, temporaryPath, diskPath,
    async publish() {
      await assertLessonDirectories(lessonId);
      const stat = await lstat(temporaryPath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new StoragePathError();
      // Same directory/filesystem: atomic visibility without rename's overwrite.
      await link(temporaryPath, diskPath);
      published = true; // Only our successful link may be removed by cleanup.
      await removeAttachmentFile(lessonId, temporaryPath);
    },
    async cleanup(preservePublished = false) {
      // A failed close must never prevent either unlink attempt. Conversely,
      // a failed temporary unlink must not prevent removal of our final link.
      const closed = await Promise.allSettled([handle.close()]);
      const removed = await Promise.allSettled([
        removeAttachmentFile(lessonId, temporaryPath),
        ...(published && !preservePublished ? [removeAttachmentFile(lessonId, diskPath)] : [])
      ]);
      if ([...closed, ...removed].some(result => result.status === "rejected")) {
        throw new Error("upload_cleanup_failed");
      }
    }
  };
}

export async function openAttachmentForRead(lessonId: string, storedPath: string) {
  const diskPath = checkedAttachmentPath(lessonId, storedPath);
  await assertLessonDirectories(lessonId);
  const stat = await lstat(diskPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new StoragePathError();
  // NONBLOCK prevents a corrupt FIFO entry from hanging before fstat.
  const handle = await open(diskPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!(await handle.stat()).isFile()) throw new StoragePathError();
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function removeAttachmentFile(lessonId: string, storedPath: string) {
  const diskPath = checkedAttachmentPath(lessonId, storedPath);
  try {
    await assertLessonDirectories(lessonId);
    const stat = await lstat(diskPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new StoragePathError();
    await unlink(diskPath);
  } catch (error: any) {
    // A missing file can still have a stale DB record; other errors must surface.
    if (error.code !== "ENOENT") throw error;
  }
}
