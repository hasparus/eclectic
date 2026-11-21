import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import type { Prototype } from "@/lib/prototype-schema";
export function PrototypeCard({ prototype: p }: { prototype: Prototype }) {
  return (
    <Link
      href={`/prototypes/${p.slug}`}
      className="group overflow-hidden rounded-xl border bg-card transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"
    >
      <div className="relative aspect-[3/2] overflow-hidden bg-muted">
        {(["light", "dark"] as const).map((theme) => (
          <div
            key={theme}
            className={`absolute inset-0 ${theme === "light" ? "block dark:hidden" : "hidden dark:block"}`}
          >
            {p[theme] ? (
              <Image
                src={`/thumbnails/${p.slug}-${theme}.png`}
                alt={`${p.title} preview`}
                fill
                unoptimized
                className="object-cover"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No preview yet
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="space-y-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium">{p.title}</h2>
          {p.hidden && <Badge variant="outline">Hidden</Badge>}
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {p.description}
        </p>
        <div className="flex flex-wrap gap-2">
          {p.tags.map((t) => (
            <Badge key={t} variant="secondary" className="font-normal">
              {t}
            </Badge>
          ))}
        </div>
      </div>
    </Link>
  );
}
