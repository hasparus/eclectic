import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prototypes, pages } from "@/lib/prototypes";
export const dynamic = "force-dynamic";
async function get(params: Promise<{ slug: string }>) {
  const { slug } = await params;
  const p = prototypes.find((p) => p.slug === slug && p.public);
  if (!p) notFound();
  return p;
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const p = await get(params);
  const h = await headers();
  const base =
    process.env.SITE_URL ||
    `${h.get("x-forwarded-proto") || "https"}://${h.get("host") || "localhost:3000"}`;
  return {
    title: p.title,
    description: p.description,
    openGraph: {
      title: p.title,
      description: p.description,
      url: new URL(`/p/${p.slug}`, base),
      images: [
        {
          url: new URL(`/p/${p.slug}/preview/dark`, base),
          width: 1200,
          height: 800,
        },
      ],
      videos: [
        {
          url: new URL(`/p/${p.slug}/preview/video`, base),
          type: "video/mp4",
          width: 1200,
          height: 800,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      images: [new URL(`/p/${p.slug}/preview/dark`, base).href],
    },
  };
}
export default async function PublicPrototype({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const p = await get(params);
  const Page = pages[p.slug];
  return <Page />;
}
