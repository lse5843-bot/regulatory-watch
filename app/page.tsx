import RegulationList from "./components/RegulationList";
import { createClient } from "@/utils/supabase/server";

export default async function Home() {
  const supabase = await createClient();

  const { data: regulations, error } = await supabase
    .from("regulations")
    .select("*")
    .in("category", ["의료기기", "의약품"])
    .order("published_at", { ascending: false });

  if (error) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-3xl font-bold text-slate-900">
            Regulatory Watch
          </h1>

          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">
            <p className="font-semibold">
              규제 정보를 불러오지 못했습니다.
            </p>

            <p className="mt-2">{error.message}</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-10">
          <h1 className="text-5xl font-bold text-slate-900">
            Regulatory Watch by seung-eun
          </h1>

          <p className="mt-3 text-slate-600">
            의료기기·의약품 규제를 AI가 자동 수집하고
            요약합니다^0^
          </p>

          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <p className="text-sm text-slate-500">전체 공고</p>

              <p className="mt-2 text-3xl font-bold text-slate-900">
                {regulations?.length ?? 0}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <p className="text-sm text-slate-500">중요 공고</p>

              <p className="mt-2 text-3xl font-bold text-red-600">
                {regulations?.filter(
                  (regulation) => regulation.ai_importance === "높음"
                ).length ?? 0}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6">
              <p className="text-sm text-slate-500">AI 요약 완료</p>

              <p className="mt-2 text-3xl font-bold text-blue-600">
                {regulations?.filter(
                  (regulation) => Boolean(regulation.ai_summary)
                ).length ?? 0}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-8">
        <RegulationList regulations={regulations ?? []} />
      </section>
    </main>
  );
}