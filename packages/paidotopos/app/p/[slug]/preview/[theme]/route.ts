import { prototypes } from "@/lib/prototypes";
import { readFile } from "node:fs/promises";
import path from "node:path";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ slug: string; theme: string }> },
) {
  const { slug, theme } = await params;
  if (
    !prototypes.some((p) => p.slug === slug && p.public) ||
    !["dark", "light", "video"].includes(theme)
  )
    return new Response(null, { status: 404 });
  try {
    const file =
      theme === "video"
        ? `social/${slug}.mp4`
        : `thumbnails/${slug}-${theme}.png`;
    const data = await readFile(path.join(process.cwd(), "public", file));
    return new Response(data, {
      headers: {
        "Content-Type": theme === "video" ? "video/mp4" : "image/png",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
