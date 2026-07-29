"use client";

import { useMemo, useState } from "react";

type CategoryFilter = "전체" | "의료기기" | "의약품";
type AgencyFilter = "전체 기관" | string;

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

function formatDate(date: string | null) {
  if (!date) {
    return "날짜 없음";
  }

  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsedDate);
}

export default function RegulationList({
  regulations,
}: {
  regulations: Regulation[];
}) {
  const [categoryFilter, setCategoryFilter] =
    useState<CategoryFilter>("전체");

  const [agencyFilter, setAgencyFilter] =
    useState<AgencyFilter>("전체 기관");

  const categoryFilters: CategoryFilter[] = [
    "전체",
    "의료기기",
    "의약품",
  ];

  const agencies = useMemo(() => {
    return Array.from(
      new Set(
        regulations
          .map((regulation) => regulation.agency)
          .filter((agency): agency is string => Boolean(agency))
      )
    ).sort((a, b) => a.localeCompare(b, "ko"));
  }, [regulations]);

  const filteredRegulations = useMemo(() => {
    return regulations.filter((regulation) => {
      const isRelevantCategory =
        regulation.category === "의료기기" ||
        regulation.category === "의약품";

      if (!isRelevantCategory) {
        return false;
      }

      const matchesCategory =
        categoryFilter === "전체" ||
        regulation.category === categoryFilter;

      const matchesAgency =
        agencyFilter === "전체 기관" ||
        regulation.agency === agencyFilter;

      return matchesCategory && matchesAgency;
    });
  }, [agencyFilter, categoryFilter, regulations]);

  return (
    <>
      <div className="mt-8 space-y-4">
        <div>
          <p className="mb-2 text-sm font-semibold text-slate-700">
            분야
          </p>

          <div className="flex flex-wrap gap-3">
            {categoryFilters.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCategoryFilter(item)}
                className={`rounded-full px-5 py-2 font-medium transition ${
                  categoryFilter === item
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-slate-700">
            기관
          </p>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setAgencyFilter("전체 기관")}
              className={`rounded-full px-5 py-2 font-medium transition ${
                agencyFilter === "전체 기관"
                  ? "bg-slate-800 text-white shadow-sm"
                  : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100"
              }`}
            >
              전체 기관
            </button>

            {agencies.map((agency) => (
              <button
                key={agency}
                type="button"
                onClick={() => setAgencyFilter(agency)}
                className={`rounded-full px-5 py-2 font-medium transition ${
                  agencyFilter === agency
                    ? "bg-slate-800 text-white shadow-sm"
                    : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100"
                }`}
              >
                {agency}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between gap-4">
        <p className="text-sm text-slate-500">
          총{" "}
          <span className="font-semibold text-slate-900">
            {filteredRegulations.length}
          </span>
          개의 공고
        </p>

        {(categoryFilter !== "전체" ||
          agencyFilter !== "전체 기관") && (
          <button
            type="button"
            onClick={() => {
              setCategoryFilter("전체");
              setAgencyFilter("전체 기관");
            }}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            필터 초기화
          </button>
        )}
      </div>

      <div className="mt-5 space-y-5">
        {filteredRegulations.map((regulation) => (
          <article
            key={regulation.id}
            className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
          >
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
              <span>{regulation.country ?? "대한민국"}</span>

              <span>•</span>

              <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
                {regulation.agency ?? "기관 정보 없음"}
              </span>

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

                <p className="mt-2 whitespace-pre-line leading-7 text-gray-700">
                  {regulation.ai_summary ?? regulation.summary}
                </p>
              </div>
            )}

            {regulation.ai_impact && (
              <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-4">
                <p className="font-semibold text-blue-700">
                  📈 업계 영향
                </p>

                <p className="mt-2 whitespace-pre-line leading-7 text-gray-700">
                  {regulation.ai_impact}
                </p>
              </div>
            )}

            {regulation.ai_action && (
              <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 p-4">
                <p className="font-semibold text-emerald-700">
                  ✅ 권장 대응
                </p>

                <p className="mt-2 whitespace-pre-line leading-7 text-gray-700">
                  {regulation.ai_action}
                </p>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-gray-500">
                발행일: {formatDate(regulation.published_at)}
              </span>

              {regulation.source_url && (
                <a
                  href={regulation.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
                >
                  원문 보기 →
                </a>
              )}
            </div>
          </article>
        ))}

        {filteredRegulations.length === 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
            <p className="font-medium text-gray-700">
              선택한 조건에 해당하는 공고가 없습니다.
            </p>

            <p className="mt-2 text-sm text-gray-500">
              기관 또는 분야 필터를 변경해 주세요.
            </p>
          </div>
        )}
      </div>
    </>
  );
}