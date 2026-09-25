import { CommitteeAccessError, CommitteeNotFoundError } from "./access";

/** A file response, or the refusal a committee service raised. */
export async function download(type: string, fn: () => Promise<{ filename: string; body: string }>): Promise<Response> {
  try {
    const { filename, body } = await fn();
    return new Response(body, {
      headers: {
        "content-type": `${type}; charset=utf-8`,
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof CommitteeAccessError) return new Response(error.message, { status: 403 });
    if (error instanceof CommitteeNotFoundError) return new Response("Not found", { status: 404 });
    throw error;
  }
}
