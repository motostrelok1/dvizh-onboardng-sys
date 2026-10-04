async function request(method, path, body) {
    const res = await fetch(`/api${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error ?? `Ошибка ${res.status}`);
    }
    return data;
}
export const api = {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
    patch: (path, body) => request("PATCH", path, body),
    put: (path, body) => request("PUT", path, body),
    delete: (path) => request("DELETE", path)
};
