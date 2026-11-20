import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <Link
          href="/"
          className="flex min-h-11 items-center text-sm text-muted-foreground"
        >
          Paidotopos / playground
        </Link>
        <ThemeToggle />
      </header>
      {children}
    </>
  );
}
