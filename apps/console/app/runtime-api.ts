export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch("/api" + path, {
    cache: "no-store",
    ...options,
  });
  if (!response.ok) {
    const value = await response.json().catch(() => ({}));
    throw new Error(
      typeof value.detail === "string"
        ? value.detail
        : `Request rejected (${response.status}). Check the field values.`,
    );
  }
  return response.json();
}
export function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const duration = (us: number | null) =>
  us == null
    ? "incomplete"
    : us < 1000
      ? `${us} µs`
      : `${(us / 1000).toFixed(2)} ms`;
