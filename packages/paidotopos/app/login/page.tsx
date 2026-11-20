import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeNext } from "@/lib/auth";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <p className="eyebrow">PAIDOTOPOS</p>
        <h1 className="mt-3 text-3xl font-medium">A little space to play.</h1>
      </div>
      <form action="/api/auth" method="post" className="space-y-4">
        <input
          type="hidden"
          name="next"
          value={safeNext(params.next || null)}
        />
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="min-h-11"
        />
        {params.error && (
          <p role="alert" className="text-sm text-destructive">
            Incorrect password. Try again.
          </p>
        )}
        <Button className="min-h-11 w-full">Enter playground</Button>
      </form>
    </main>
  );
}
