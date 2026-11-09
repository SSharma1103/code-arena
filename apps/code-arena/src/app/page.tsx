import Arena from "./arena";
import { Suspense } from "react";
async function Landing({ searchParams }: PageProps<"/">) {
  const query = await searchParams;
  return <Arena initialCompare={query.compare === "1"} />;
}
export default function Home(props: PageProps<"/">) {
  return (
    <Suspense
      fallback={<div className="loading-screen">Opening Code Arena…</div>}
    >
      <Landing {...props} />
    </Suspense>
  );
}
