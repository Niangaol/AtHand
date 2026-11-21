// 公网、无凭证的探测端点：证明 Sites 能执行函数，而不是只返回静态文件。
export function handler(request: Request): Response {
  const headers = { "Cache-Control": "no-store" };
  if (request.method !== "GET") {
    return Response.json(
      { ok: false, error: "method_not_allowed" },
      { status: 405, headers: { ...headers, Allow: "GET" } },
    );
  }
  const name = new URL(request.url).searchParams.get("name")?.trim() ?? "Visitor";
  if (!name || name.length > 80) {
    return Response.json({ ok: false, error: "invalid_name" }, { status: 400, headers });
  }
  return Response.json(
    {
      ok: true,
      message: `Hello, ${name}!`,
      runtime: "edge-function",
      at: new Date().toISOString(),
    },
    { headers },
  );
}
