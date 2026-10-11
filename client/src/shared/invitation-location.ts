// Consume the fragment once and immediately remove it from the current history
// entry. Legacy /invite/<token> links use the same body-only API afterward.
export function readInviteToken(location: Pick<Location, "pathname" | "hash">, history: Pick<History, "replaceState">): string | null {
  const legacy = location.pathname.match(/^\/invite\/([^/]+)\/?$/);
  if (!legacy && !/^\/invite\/?$/.test(location.pathname)) return null;
  const raw = legacy ? legacy[1] : location.hash.slice(1);
  history.replaceState(null, "", "/invite");
  try { return decodeURIComponent(raw) || "invalid-invitation"; }
  catch { return "invalid-invitation"; }
}
