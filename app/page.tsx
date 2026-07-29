import RegulationList from "./components/RegulationList";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  const supabase = await createClient();

  const { data: regulations, error } = await supabase
    .from("regulations")
    .select("*")
    .in("category", [
      "의료기기",
      "의약품",
      "신의료기술평가",
    ])
    .order("published_at", { ascending: false });

  if (error) {
    console.error("규제 데이터 조회 실패:", error);
  }

  console.log(
    "카테고리별 데이터:",
    (regulations ?? []).reduce<Record<string, number>>(
      (acc, regulation) => {
        const category = regulation.category ?? "미분류";
        acc[category] = (acc[category] ?? 0) + 1;
        return acc;
      },
      {}
    )
  );

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-3 py-6 sm:px-6 sm:py-10 lg:px-8">
        <RegulationList regulations={regulations ?? []} />
      </div>
    </main>
  );
}