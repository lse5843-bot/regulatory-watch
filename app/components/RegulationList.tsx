"use client";
<section className="mb-8">
  <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">
    Regulatory Watch by seungeun^^
  </h1>

  <p className="mt-3 text-slate-600">
    AI로 만든 한페이지에 몰아보기~
  </p>
</section>

import { useEffect, useMemo, useState } from "react";

type Category = "의료기기" | "의약품" | "신의료기술평가";
type Importance = "높음" | "중간" | "낮음";
type AffectedArea = "인허가" | "임상시험" | "보험급여";

export type Regulation = {
  id: string | number;
  country?: string | null;
  agency?: string | null;
  category: Category;
  title: string;
  department?: string | null;
  subcategory?: string | null;
  published_at?: string | null;
  source_url: string;

  ai_summary?: string | null;
  ai_impact?: string | null;
  ai_action?: string | null;
  ai_importance?: Importance | null;

  affected_area?: AffectedArea[] | null;
};

type RegulationListProps = {
  regulations: Regulation[];
};

const CATEGORY_FILTERS = [
  "전체",
  "의료기기",
  "의약품",
  "신의료기술평가",
] as const;

const AREA_FILTERS = [
  "전체",
  "인허가",
  "임상시험",
  "보험급여",
] as const;

function formatDate(value?: string | null) {
  if (!value) {
    return "날짜 미확인";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function getImportanceStyle(importance?: Importance | null) {
  switch (importance) {
    case "높음":
      return "border-red-200 bg-red-50 text-red-700";

    case "중간":
      return "border-amber-200 bg-amber-50 text-amber-700";

    case "낮음":
      return "border-slate-200 bg-slate-50 text-slate-600";

    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function getAreaStyle(area: AffectedArea) {
  switch (area) {
    case "인허가":
      return "border-violet-200 bg-violet-50 text-violet-700";

    case "임상시험":
      return "border-blue-200 bg-blue-50 text-blue-700";

    case "보험급여":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
}

function getImpactReasons(regulation: Regulation): string[] {
  const sourceText = [
    regulation.title,
    regulation.ai_summary,
    regulation.ai_impact,
  ]
    .filter(Boolean)
    .join(" ");

  const reasons: string[] = [];

  for (const area of regulation.affected_area ?? []) {
    if (area === "인허가") {
      if (
        /변경허가|변경신고|품목허가|허가심사|심사자료|제출자료|기술문서/.test(
          sourceText
        )
      ) {
        reasons.push("허가·신고 또는 심사자료 기준과 관련된 내용입니다.");
      } else {
        reasons.push("제품의 허가 및 심사 업무에 영향을 줄 수 있습니다.");
      }
    }

    if (area === "임상시험") {
      if (
        /임상시험계획|임상시험|임상평가|피험자|시험기관|IRB|GCP|IND|IDE/i.test(
          sourceText
        )
      ) {
        reasons.push("임상시험 계획이나 수행 기준과 관련된 내용입니다.");
      } else {
        reasons.push("임상시험 준비 또는 운영 업무에 영향을 줄 수 있습니다.");
      }
    }

    if (area === "보험급여") {
      if (
        /급여기준|보험급여|비급여|약가|상한금액|치료재료|건강보험|수가/.test(
          sourceText
        )
      ) {
        reasons.push("급여기준·약가·수가 검토와 관련된 내용입니다.");
      } else {
        reasons.push("보험급여 적용 또는 가격 업무에 영향을 줄 수 있습니다.");
      }
    }
  }

  return [...new Set(reasons)].slice(0, 3);
}

export default function RegulationList({
  regulations,
}: RegulationListProps) {
  const [categoryFilter, setCategoryFilter] =
    useState<(typeof CATEGORY_FILTERS)[number]>("전체");

  const [areaFilter, setAreaFilter] =
    useState<(typeof AREA_FILTERS)[number]>("전체");

  const [agencyFilter, setAgencyFilter] = useState("전체");
const [searchQuery, setSearchQuery] = useState("");
  const [selectedRegulation, setSelectedRegulation] =
    useState<Regulation | null>(null);
const [deviceOpen, setDeviceOpen] = useState(true);
const [drugOpen, setDrugOpen] = useState(true);
const [nhtaOpen, setNhtaOpen] = useState(true);
  const agencies = useMemo(() => {
    return [
      "전체",
      ...Array.from(
        new Set(
          regulations
            .map((regulation) => regulation.agency)
            .filter(
              (agency): agency is string =>
                typeof agency === "string" && agency.length > 0
            )
        )
      ),
    ];
  }, [regulations]);

  const filteredRegulations = useMemo(() => {
    return regulations.filter((regulation) => {
      const matchesCategory =
        categoryFilter === "전체" ||
        regulation.category === categoryFilter;

      const matchesArea =
        areaFilter === "전체" ||
        regulation.affected_area?.includes(areaFilter);

      const matchesAgency =
        agencyFilter === "전체" ||
        regulation.agency === agencyFilter;
const matchesSearch =
  searchQuery.trim() === "" ||
  [
    regulation.title,
    regulation.ai_summary,
    regulation.agency,
    regulation.department,
    regulation.subcategory,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(searchQuery.toLowerCase());
    return (
  matchesCategory &&
  matchesArea &&
  matchesAgency &&
  matchesSearch
);  
    });
  }, [
  regulations,
  categoryFilter,
  areaFilter,
  agencyFilter,
  searchQuery,
]);
const deviceRegulations = useMemo(
  () =>
    filteredRegulations.filter(
      (regulation) => regulation.category === "의료기기"
    ),
  [filteredRegulations]
);

const drugRegulations = useMemo(
  () =>
    filteredRegulations.filter(
      (regulation) => regulation.category === "의약품"
    ),
  [filteredRegulations]
);

const nhtaRegulations = useMemo(
  () =>
    filteredRegulations.filter(
      (regulation) => regulation.category === "신의료기술평가"
    ),
  [filteredRegulations]
);
  useEffect(() => {
    if (!selectedRegulation) {
      return;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedRegulation(null);
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [selectedRegulation]);

  const resetFilters = () => {
    setCategoryFilter("전체");
    setAreaFilter("전체");
    setAgencyFilter("전체");
  };

  return (
    <>
      <section className="space-y-6">
        {/* 필터 */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-5">
            <div>
  <input
    type="text"
    placeholder="제목, AI 요약, 기관 검색..."
    value={searchQuery}
    onChange={(e) => setSearchQuery(e.target.value)}
    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-violet-500 focus:outline-none"
  />
</div>
            <FilterGroup
              title="분야"
              options={CATEGORY_FILTERS}
              selected={categoryFilter}
              onSelect={setCategoryFilter}
            />

            <FilterGroup
              title="영향 업무"
              options={AREA_FILTERS}
              selected={areaFilter}
              onSelect={setAreaFilter}
            />

            {agencies.length > 1 && (
              <FilterGroup
                title="기관"
                options={agencies}
                selected={agencyFilter}
                onSelect={setAgencyFilter}
              />
            )}
          </div>

          <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
            <p className="text-sm text-slate-500">
              총{" "}
              <span className="font-semibold text-slate-900">
                {filteredRegulations.length}
              </span>
              건
            </p>

            <button
              type="button"
              onClick={resetFilters}
              className="text-sm font-medium text-slate-500 transition hover:text-slate-900"
            >
              필터 초기화
            </button>
          </div>
        </div>

        {/* 목록 */}
{filteredRegulations.length === 0 ? (
  <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
    <p className="font-medium text-slate-700">
      조건에 맞는 규제 정보가 없습니다.
    </p>

    <button
      type="button"
      onClick={resetFilters}
      className="mt-3 text-sm font-semibold text-violet-700"
    >
      전체 규제 보기
    </button>
  </div>
) : (
  <div className="space-y-8">
    {/* 모바일과 데스크톱 모두 의료기기·의약품 2열 */}
    <div className="grid grid-cols-2 gap-3 sm:gap-6 lg:gap-8">
      {/* 의료기기 */}
      <section className="min-w-0">
        <button
  type="button"
  onClick={() => setDeviceOpen(!deviceOpen)}
  className="mb-4 w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-violet-300 hover:shadow-md"
>
  <div className="flex items-center justify-between">
    <div>
      <p className="text-lg font-bold">🩺 의료기기</p>
      <p className="mt-1 text-sm text-slate-500">
        {deviceRegulations.length}건
      </p>
    </div>

    <span className="text-xl">
       {deviceOpen ? "▲" : "▼"}
    </span>
  </div>
</button>

        {deviceOpen && (
  <div className="space-y-3 sm:space-y-4">
          {deviceRegulations.map((regulation) => (
            <RegulationCard
              key={regulation.id}
              regulation={regulation}
              searchQuery={searchQuery}
              onOpen={() => setSelectedRegulation(regulation)}
              compactOnMobile
            />
          ))}
        </div>
        )}
      </section>

      {/* 의약품 */}
      <section className="min-w-0">
        <button
  type="button"
  onClick={() => setDrugOpen(!drugOpen)}
  className="mb-4 w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-violet-300 hover:shadow-md"
>
  <div className="flex items-center justify-between">
    <div>
      <p className="text-lg font-bold">💊 의약품</p>
      <p className="mt-1 text-sm text-slate-500">
        {drugRegulations.length}건
      </p>
    </div>

    <span className="text-xl">
      {drugOpen ? "▲" : "▼"}
    </span>
  </div>
</button>

      {drugOpen && (
  <div className="space-y-3 sm:space-y-4">  
          {drugRegulations.map((regulation) => (
            <RegulationCard
              key={regulation.id}
              regulation={regulation}
              searchQuery={searchQuery}
              onOpen={() => setSelectedRegulation(regulation)}
              compactOnMobile
            />
          ))}
        </div>
        )}
      </section>
    </div>

    <>
  <button
    type="button"
    onClick={() => setNhtaOpen(!nhtaOpen)}
    className="mb-4 w-full rounded-2xl border border-violet-200 bg-violet-50 p-4 text-left shadow-sm transition hover:shadow-md"
  >
    <div className="flex items-center justify-between">
      <div>
        <p className="text-lg font-bold">
          🧬 신의료기술평가
        </p>

        <p className="mt-1 text-sm text-slate-500">
          {nhtaRegulations.length}건
        </p>
      </div>

      <span className="text-xl">
        {nhtaOpen ? "▲" : "▼"}
      </span>
    </div>
  </button>

  {nhtaOpen && (
    <NhtaAccordionSection
      regulations={nhtaRegulations}
      searchQuery={searchQuery}
      onOpen={setSelectedRegulation}
    />
  )}
</>
  </div>
)}
      </section>

      {/* 상세 미리보기 */}
      {selectedRegulation && (
        <RegulationPreview
          regulation={selectedRegulation}
          onClose={() => setSelectedRegulation(null)}
        />
      )}
    </>
  );
}
function HighlightText({
  text,
  query,
}: {
  text?: string | null;
  query: string;
}) {
  if (!text) return null;

  if (!query.trim()) {
    return <>{text}</>;
  }

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, index) =>
        regex.test(part) ? (
          <mark
            key={index}
            className="rounded bg-yellow-200 px-0.5"
          >
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  );
}
type FilterGroupProps<T extends string> = {
  title: string;
  options: readonly T[];
  selected: T;
  onSelect: (option: T) => void;
};

function FilterGroup<T extends string>({
  title,
  options,
  selected,
  onSelect,
}: FilterGroupProps<T>) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-slate-700">
        {title}
      </p>

      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const isSelected = option === selected;

          return (
            <button
              key={option}
              type="button"
              onClick={() => onSelect(option)}
              className={[
                "rounded-full border px-3 py-1.5 text-sm font-medium transition",
                isSelected
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900",
              ].join(" ")}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RegulationCard({
  regulation,
  searchQuery,
  onOpen,
  compactOnMobile = false,
}: {
  regulation: Regulation;
  searchQuery: string;
  onOpen: () => void;
  compactOnMobile?: boolean;
}) {
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={[
        "group cursor-pointer rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2",
        compactOnMobile ? "p-3 sm:p-6" : "p-5 sm:p-6",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
          {regulation.agency || "기관 정보 없음"}
        </span>

        {regulation.subcategory && (
  <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
    {regulation.subcategory}
  </span>
)}

        {regulation.ai_importance && (
          <span
            className={[
              "rounded-full border px-2.5 py-1 text-xs font-semibold",
              getImportanceStyle(regulation.ai_importance),
            ].join(" ")}
          >
            중요도 {regulation.ai_importance}
          </span>
        )}
      </div>

      <h2
        className={[
          "mt-4 font-bold text-slate-900 transition group-hover:text-violet-700",
          compactOnMobile
            ? "text-sm leading-5 sm:text-xl sm:leading-7"
            : "text-lg leading-7 sm:text-xl",
        ].join(" ")}
      >
        <HighlightText
  text={regulation.title}
  query={searchQuery}
/>
      </h2>

      {(regulation.affected_area?.length ?? 0) > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {regulation.affected_area?.map((area) => (
            <span
              key={area}
              className={[
                "rounded-full border px-3 py-1 text-sm font-semibold",
                getAreaStyle(area),
              ].join(" ")}
            >
              {area}
            </span>
          ))}
        </div>
      )}

      {regulation.ai_summary && (
  <div className="mt-4">
    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
      AI 요약
    </p>

    <p className="line-clamp-3 leading-7 text-slate-600">
      <HighlightText
  text={regulation.ai_summary}
  query={searchQuery}
/>
    </p>
  </div>
)}

      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
        <time className="text-sm text-slate-500">
          {formatDate(regulation.published_at)}
        </time>

        <span className="text-sm font-semibold text-violet-700">
          상세 보기 →
        </span>
      </div>
    </article>
  );
}

function RegulationPreview({
  regulation,
  onClose,
}: {
  regulation: Regulation;
  onClose: () => void;
}) {
  const impactReasons = getImpactReasons(regulation);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="regulation-preview-title"
        className="max-h-[94vh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:max-w-3xl sm:rounded-3xl"
      >
        {/* 상단 */}
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:px-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                {regulation.agency || "기관 정보 없음"}
              </span>

              {regulation.subcategory && (
  <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
    {regulation.subcategory}
  </span>
)}

              {regulation.ai_importance && (
                <span
                  className={[
                    "rounded-full border px-2.5 py-1 text-xs font-semibold",
                    getImportanceStyle(regulation.ai_importance),
                  ].join(" ")}
                >
                  중요도 {regulation.ai_importance}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="상세 미리보기 닫기"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            >
              ×
            </button>
          </div>
        </header>

        <div className="px-5 py-7 sm:px-8 sm:py-8">
          <p className="text-sm text-slate-500">
            {regulation.department
              ? `${regulation.department} · `
              : ""}
            {formatDate(regulation.published_at)}
          </p>

          <h2
            id="regulation-preview-title"
            className="mt-2 text-2xl font-bold leading-9 text-slate-950 sm:text-3xl"
          >
            {regulation.title}
          </h2>

          {/* 영향 업무를 가장 위에 강조 */}
          <section className="mt-8 rounded-2xl border border-violet-200 bg-violet-50/70 p-5 sm:p-6">
            <p className="text-sm font-bold uppercase tracking-wide text-violet-700">
              영향 업무
            </p>

            {(regulation.affected_area?.length ?? 0) > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {regulation.affected_area?.map((area) => (
                  <span
                    key={area}
                    className={[
                      "rounded-full border bg-white px-4 py-2 text-base font-bold shadow-sm",
                      getAreaStyle(area),
                    ].join(" ")}
                  >
                    {area}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-slate-600">
                영향 업무가 아직 분류되지 않았습니다.
              </p>
            )}

            {impactReasons.length > 0 && (
              <div className="mt-5 border-t border-violet-200 pt-5">
                <h3 className="font-bold text-slate-900">
                  왜 봐야 하나요?
                </h3>

                <ul className="mt-3 space-y-2">
                  {impactReasons.map((reason) => (
                    <li
                      key={reason}
                      className="flex gap-2 leading-7 text-slate-700"
                    >
                      <span
                        aria-hidden="true"
                        className="font-bold text-violet-600"
                      >
                        ✓
                      </span>

                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <div className="mt-8 space-y-8">
            <PreviewSection title="AI 요약">
              <p className="whitespace-pre-line leading-8 text-slate-700">
                {regulation.ai_summary ||
                  "AI 요약이 아직 생성되지 않았습니다."}
              </p>
            </PreviewSection>

            <PreviewSection title="기업 영향">
              <p className="whitespace-pre-line leading-8 text-slate-700">
                {regulation.ai_impact ||
                  "기업 영향 분석이 아직 생성되지 않았습니다."}
              </p>
            </PreviewSection>
          </div>

          {/* 권장 대응은 표시하지 않음 */}
          <div className="mt-10 border-t border-slate-200 pt-6">
            <a
              href={regulation.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-5 py-3.5 font-bold text-white transition hover:bg-slate-700 sm:w-auto"
            >
              원문 보기
              <span className="ml-2" aria-hidden="true">
                ↗
              </span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
type NhtaAccordionSectionProps = {
  regulations: Regulation[];
  searchQuery: string;
  onOpen: (regulation: Regulation) => void;
};

function NhtaAccordionSection({
  regulations,
  searchQuery,
  onOpen,
}: NhtaAccordionSectionProps) {
  const [openSubcategory, setOpenSubcategory] = useState<string | null>(null);

  const grouped = useMemo(() => {
    return regulations.reduce<Record<string, Regulation[]>>((acc, regulation) => {
      const key = regulation.subcategory?.trim() || "기타";

      if (!acc[key]) acc[key] = [];

      acc[key].push(regulation);

      return acc;
    }, {});
  }, [regulations]);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold sm:text-xl">
          🧬 신의료기술평가
        </h2>

        <span className="rounded-full bg-violet-100 px-3 py-1 text-sm font-medium text-violet-700">
          {regulations.length}건
        </span>
      </div>

      <div className="space-y-3">
        {Object.entries(grouped).map(([subcategory, items]) => {
          const open = openSubcategory === subcategory;

          return (
            <div
              key={subcategory}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
            >
              <button
                type="button"
                onClick={() =>
                  setOpenSubcategory(open ? null : subcategory)
                }
                className="flex w-full items-center justify-between p-5 transition hover:bg-slate-50"
              >
                <span className="font-semibold text-slate-900">
                  {subcategory}
                </span>

                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-500">
                    {items.length}건
                  </span>

                  <span
                    className={`transition-transform ${
                      open ? "rotate-180" : ""
                    }`}
                  >
                    ▼
                  </span>
                </div>
              </button>

              {open && (
                <div className="grid gap-3 border-t border-slate-100 bg-slate-50 p-4 sm:grid-cols-2">
                  {items.map((regulation) => (
                    <RegulationCard
                      key={regulation.id}
                      regulation={regulation}
                      searchQuery={searchQuery}
                      onOpen={() => onOpen(regulation)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
function PreviewSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-3 text-lg font-bold text-slate-950">
        {title}
      </h3>

      <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5 sm:p-6">
        {children}
      </div>
    </section>
  );
}