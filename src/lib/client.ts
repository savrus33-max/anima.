export async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(`/api/service?path=${encodeURIComponent(path)}`, {method:method || (body === undefined ? "GET" : "POST"), headers:body === undefined ? undefined : {"Content-Type":"application/json"}, body:body === undefined ? undefined : JSON.stringify(body), cache:"no-store"});
  const data = await response.json();
  if(!response.ok) throw new Error(data.error || "Не удалось выполнить запрос");
  return data as T;
}
export function errorMessage(error:unknown) {return error instanceof Error ? error.message : "Что-то пошло не так. Попробуйте ещё раз.";}
