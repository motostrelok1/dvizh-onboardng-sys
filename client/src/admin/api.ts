import { setEventOwner, pauseEvents } from "../events";

let authGeneration = 0;
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (["/auth/logout", "/auth/login", "/auth/invitations/accept"].includes(path)) authGeneration++;
  const generation = authGeneration;
  if (path === "/auth/logout") setEventOwner(null);
  const res = await fetch(`/api${path}`, {
    method,
    cache: "no-store",
    referrerPolicy: "no-referrer",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && generation === authGeneration) pauseEvents();
    throw new Error(data.error ?? `Ошибка ${res.status}`);
  }
  if (generation === authGeneration && data.user?.id && (path === "/auth/me" || path === "/auth/login")) {
    setEventOwner(data.user.id);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  delete: <T>(path: string) => request<T>("DELETE", path)
};
