// Downloads use fetch + a Bearer header rather than a plain <a href> because
// every export route is authenticated - a bare link can't carry the token, so
// each caller borrowed this dance already (patients/view, billing). This is
// that pattern in one place so new export buttons don't repeat it.
export async function downloadWithAuth(url: string, token: string | null, filename: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || 'Download failed');
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
