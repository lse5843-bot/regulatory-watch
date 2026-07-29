import { createClient } from "@/utils/supabase/server";

export default async function Home() {
  const supabase = await createClient();

  const { data: regulations, error } = await supabase
    .from("regulations")
    .select("*")
    .order("published_at", { ascending: false });

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 p-8">
        <h1 className="text-3xl font-bold">Regulatory Watch</h1>

        <div className="mt-6 rounded-lg bg-red-100 p-4 text-red-700">
          Supabase 오류: {error.message}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-4xl font-bold text-gray-900">
          Regulatory Watch
        </h1>

        <p className="mt-2 text-gray-600">
          최신 규제 및 정책 업데이트
        </p>

        <div className="mt-8 space-y-4">
          {regulations?.map((regulation) => (
            <article
              key={regulation.id}
              className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
            >
              <div className="flex flex-wrap gap-2 text-sm text-gray-500">
                <span>{regulation.country}</span>
                <span>•</span>
                <span>{regulation.agency}</span>
                <span>•</span>
                <span>{regulation.category}</span>
              </div>

              <h2 className="mt-3 text-xl font-semibold text-gray-900">
                {regulation.title}
              </h2>

              <p className="mt-3 text-gray-700">
                {regulation.summary}
              </p>

              <div className="mt-4 text-sm text-gray-500">
                발행일: {regulation.published_at ?? "날짜 없음"}
              </div>
            </article>
          ))}

          {regulations?.length === 0 && (
            <div className="rounded-xl border bg-white p-6 text-gray-600">
              등록된 규제 데이터가 없습니다.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
