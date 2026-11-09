import { notFound } from "next/navigation";
import { Suspense } from "react";
import Arena from "../../arena";
import type { ArenaMode } from "@code-arena/contracts";

async function Workspace({ params, searchParams }: PageProps<"/arena/[mode]">) {
  const { mode } = await params;
  const query = await searchParams;
  if (!["svg", "3js", "html", "cube"].includes(mode)) notFound();
  return (
    <Arena
      key={mode + String(query.session ?? "new")}
      initialMode={mode as ArenaMode}
      sessionId={typeof query.session === "string" ? query.session : undefined}
    />
  );
}
export default function Page(props: PageProps<"/arena/[mode]">) {
  return (
    <Suspense
      fallback={<div className="loading-screen">Opening your workspace…</div>}
    >
      <Workspace {...props} />
    </Suspense>
  );
}
