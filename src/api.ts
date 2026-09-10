export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal })
  if (!response.ok) {
    let message = `Request failed (${response.status}). Please try again.`
    try {
      const data = await response.json()
      if (typeof data.detail === 'string') message = data.detail
      else if (Array.isArray(data.detail)) message = data.detail.map((d: {loc: string[]; msg: string}) => `${d.loc.slice(1).join(' → ')}: ${d.msg}`).join('; ')
    } catch { /* The server may return non-JSON during restart. */ }
    throw new Error(message)
  }
  return response.json()
}
