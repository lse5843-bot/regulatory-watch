"use client";

import { useMemo, useState } from "react";

type CategoryFilter = "전체" | "의료기기" | "의약품";

type Regulation = {
  id: string;
  country: string | null;
  agency: string | null;
  department?: string | null;
  category: string | null;
  title: string;

  summary: string | null;

  ai_summary?: string | null;
  ai_impact?: string | null;
  ai_action?: string | null;
  ai_importance?: string | null;

  published_at: string | null;
  source_url?: string | null;
};

export default function RegulationList({
  regulations,
}: {
  regulations: Regulation[];
}) {
  const [filter, setFilter] = useState<CategoryFilter>("전체");

  const filteredRegulations = useMemo(() => {
    const relevantRegulations = regulations.filter(
      (regulation) =>
        regulation.category === "의료기기" ||
        regulation.category === "의약품"
    );

    if (filter === "전체") {
      return relevantRegulations;
    }

    return relevantRegulations.filter(
      (regulation) => regulation.category === filter
    );
  }, [filter, regulations]);

  const filters: CategoryFilter[] = ["전체", "의료기기", "의약품"];

  return (
    <>
      <div className="mt-8 flex flex-wrap gap-3">
        {filters.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setFilter(item)}
            className={`rounded-full px-5 py-2 font-medium transition ${
              filter === item
                ? "bg-blue-600 text-white shadow-sm"
                : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100"
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="mt-8 space-y-5">
        {filteredRegulations.map((regulation) => (
          <article
            key={regulation.id}
            className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
          >
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
              <span>{regulation.country ?? "대한민국"}</span>

              <span>•</span>

              <span>{regulation.agency ?? "식품의약품안전처"}</span>

              {regulation.department && (
                <>
                  <span>•</span>
                  <span>{regulation.department}</span>
                </>
              )}

              <span>•</span>

              <span className="rounded-full bg-blue-50 px-2.5 py-1 font-medium text-blue-700">
                {regulation.category}
              </span>

              {regulation.ai_importance && (
                <span
                  className={`rounded-full px-2.5 py-1 font-medium ${
                    regulation.ai_importance === "높음"
                      ? "bg-red-100 text-red-700"
                      : regulation.ai_importance === "중간"
                      ? "bg-yellow-100 text-yellow-700"
                      : "bg-green-100 text-green-700"
                  }`}
                >
                  중요도 {regulation.ai_importance}
                </span>
              )}
            </div>

            <h2 className="mt-4 text-xl font-semibold text-gray-900">
              {regulation.title}
            </h2>

            {(regulation.ai_summary || regulation.summary) && (
              <div className="mt-5 rounded-lg bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-700">
                  🤖 AI 요약
                </p>

                <p className="mt-2 whitespace-pre-line text-gray-700">
                  {regulation.ai_summary ?? regulation.summary}
                </p>
              </div>
            )}

            {regulation.ai_impact && (
              <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-4">
                <p className="font-semibold text-blue-700">
                  📈 업계 영향
                </p>

                <p className="mt-2 text-gray-700">
                  {regulation.ai_impact}
                </p>
              </div>
            )}

            {regulation.ai_action && (
              <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 p-4">
                <p className="font-semibold text-emerald-700">
                  ✅ 권장 대응
                </p>

                <p className="mt-2 text-gray-700">
                  {regulation.ai_action}
                </p>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-gray-500">
                발행일: {regulation.published_at ?? "날짜 없음"}
              </span>

              {regulation.source_url && (
                <a
                  href={regulation.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
                >
                  원문보기 →
                </a>
              )}
            </div>
          </article>
        ))}

        {filteredRegulations.length === 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
            <p className="font-medium text-gray-700">
              해당 분야의 공고가 없습니다.
            </p>

            <p className="mt-2 text-sm text-gray-500">
              의료기기 또는 의약품 공고가 저장되어 있는지 확인해 주세요.
            </p>
          </div>
        )}
      </div>
    </>
  );
}