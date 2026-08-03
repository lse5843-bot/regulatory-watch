"use client";

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
  status?: string | null;
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
const STATUS_FILTERS = [
  "전체",
  "평가진행중",
  "평가중",
  "평가종료",
  "평가완료",
  "평가유예 신의료기술 대상",
] as const;
const DATE_FILTERS = [
  "전체",
  "최근 7일",
  "최근 30일",
  "최근 90일",
  "올해",
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

function getStatusStyle(status?: string | null) {
  switch (status) {
    case "평가진행중":
    case "평가중":
      return "border-blue-200 bg-blue-50 text-blue-700";

    case "평가종료":
    case "평가완료":
      return "border-slate-200 bg-slate-100 text-slate-700";

    case "평가유예 신의료기술 대상":
      return "border-purple-200 bg-purple-50 text-purple-700";

    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
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
function isNewRegulation(
  publishedAt: string | null | undefined
) {
  if (!publishedAt) {
    return false;
  }

  const publishedDate = new Date(
    `${publishedAt.slice(0, 10)}T00:00:00`
  );

  if (Number.isNaN(publishedDate.getTime())) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 6);

  return (
    publishedDate >= sevenDaysAgo &&
    publishedDate <= today
  );
}
function isTodayRegulation(
  publishedAt: string | null | undefined
) {
  if (!publishedAt) {
    return false;
  }

  const publishedDate = new Date(
    `${publishedAt.slice(0, 10)}T00:00:00`
  );

  if (Number.isNaN(publishedDate.getTime())) {
    return false;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return publishedDate.getTime() === today.getTime();
}
export default function RegulationList({
  regulations,
}: RegulationListProps) {
  const [categoryFilter, setCategoryFilter] =
    useState<(typeof CATEGORY_FILTERS)[number]>("전체");

  const [areaFilter, setAreaFilter] =
    useState<(typeof AREA_FILTERS)[number]>("전체");
const [statusFilter, setStatusFilter] =
  useState<(typeof STATUS_FILTERS)[number]>("전체");
 const [dateFilter, setDateFilter] =
  useState<(typeof DATE_FILTERS)[number]>("전체");
 const [startDate, setStartDate] = useState("");
const [endDate, setEndDate] = useState("");
  const [agencyFilter, setAgencyFilter] = useState("전체");
const [searchQuery, setSearchQuery] = useState("");
  const [selectedRegulation, setSelectedRegulation] =
    useState<Regulation | null>(null);
const [deviceOpen, setDeviceOpen] = useState(true);
const [drugOpen, setDrugOpen] = useState(true);
const [nhtaOpen, setNhtaOpen] = useState(true);
const [todayOpen, setTodayOpen] =
  useState(true);  
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

      const matchesStatus =
        statusFilter === "전체" ||
        regulation.status === statusFilter;

      const matchesDate = matchesDateFilter(
        regulation.published_at,
        dateFilter
      );

      const matchesCustomDate = matchesCustomDateRange(
        regulation.published_at,
        startDate,
        endDate
      );

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
          regulation.status,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(searchQuery.toLowerCase());

      return (
        matchesCategory &&
        matchesArea &&
        matchesStatus &&
        matchesDate &&
        matchesCustomDate &&
        matchesAgency &&
        matchesSearch
      );
    });
  }, [
    regulations,
    categoryFilter,
    areaFilter,
    statusFilter,
    dateFilter,
    startDate,
    endDate,
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

  const todayRegulations = useMemo(
    () =>
      filteredRegulations.filter((regulation) =>
        isTodayRegulation(regulation.published_at)
      ),
    [filteredRegulations]
  );

  const recentSevenDayRegulations = useMemo(
    () =>
      filteredRegulations.filter((regulation) =>
        isNewRegulation(regulation.published_at)
      ),
    [filteredRegulations]
  );

  const todayGroupCounts = useMemo(() => {
    return todayRegulations.reduce(
      (counts, regulation) => {
        if (regulation.category === "의료기기") counts.device += 1;
        if (regulation.category === "의약품") counts.drug += 1;
        if (regulation.category === "신의료기술평가") counts.nhta += 1;
        return counts;
      },
      { device: 0, drug: 0, nhta: 0 }
    );
  }, [todayRegulations]);

  useEffect(() => {
    if (!selectedRegulation) return;

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
    setStatusFilter("전체");
    setDateFilter("전체");
    setStartDate("");
    setEndDate("");
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
<FilterGroup
  title="게시일"
  options={DATE_FILTERS}
  selected={dateFilter}
  onSelect={setDateFilter}
/>
<div>
  <p className="mb-2 text-sm font-semibold text-slate-700">
    날짜 범위
  </p>

  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
    <input
      type="date"
      value={startDate}
      max={endDate || undefined}
      onChange={(event) => {
        setStartDate(event.target.value);
        setDateFilter("전체");
      }}
      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-violet-500 focus:outline-none sm:w-auto"
    />

    <span className="hidden text-slate-400 sm:inline">
      ~
    </span>

    <input
      type="date"
      value={endDate}
      min={startDate || undefined}
      onChange={(event) => {
        setEndDate(event.target.value);
        setDateFilter("전체");
      }}
      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-violet-500 focus:outline-none sm:w-auto"
    />

    {(startDate || endDate) && (
      <button
        type="button"
        onClick={() => {
          setStartDate("");
          setEndDate("");
        }}
        className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-500 transition hover:border-slate-400 hover:text-slate-900"
      >
        날짜 지우기
      </button>
    )}
  </div>
</div>
{filteredRegulations.some(
  (regulation) => regulation.category === "신의료기술평가"
) && (
  <FilterGroup
    title="평가 상태"
    options={STATUS_FILTERS}
    selected={statusFilter}
    onSelect={setStatusFilter}
  />
)}

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
{/* 신규 현황 */}
<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
  <div className="rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm">
    <p className="text-xs font-bold text-red-600">
      🔥 오늘 신규
    </p>

    <p className="mt-2 text-2xl font-black text-red-700">
      {todayRegulations.length}
      <span className="ml-1 text-sm font-semibold">
        건
      </span>
    </p>
  </div>

  <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 shadow-sm">
    <p className="text-xs font-bold text-orange-700">
      📅 최근 7일
    </p>

    <p className="mt-2 text-2xl font-black text-orange-700">
      {recentSevenDayRegulations.length}
      <span className="ml-1 text-sm font-semibold">
        건
      </span>
    </p>
  </div>

  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
    <p className="text-xs font-bold text-blue-700">
      🩺 오늘 의료기기
    </p>

    <p className="mt-2 text-2xl font-black text-blue-700">
      {todayGroupCounts.device}
      <span className="ml-1 text-sm font-semibold">
        건
      </span>
    </p>
  </div>

  <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4 shadow-sm">
    <p className="text-xs font-bold text-violet-700">
      💊·🧬 기타 오늘 신규
    </p>

    <p className="mt-2 text-2xl font-black text-violet-700">
      {todayGroupCounts.drug +
        todayGroupCounts.nhta}
      <span className="ml-1 text-sm font-semibold">
        건
      </span>
    </p>
  </div>
</div>
{/* 오늘 신규 목록 */}
{todayRegulations.length > 0 && (
  <section className="overflow-hidden rounded-2xl border border-red-200 bg-white shadow-sm">
    <button
      type="button"
      onClick={() => setTodayOpen(!todayOpen)}
      className="flex w-full items-center justify-between bg-red-50 p-4 text-left transition hover:bg-red-100 sm:p-5"
    >
      <div>
        <h2 className="text-lg font-black text-slate-900">
          🔥 오늘 새로 올라온 규제
        </h2>

        <p className="mt-1 text-sm text-slate-500">
          오늘 게시된 자료{" "}
          {todayRegulations.length}건
        </p>
      </div>

      <span className="text-xl text-red-600">
        {todayOpen ? "▲" : "▼"}
      </span>
    </button>

    {todayOpen && (
      <div className="grid gap-3 border-t border-red-100 bg-red-50/30 p-3 sm:grid-cols-2 sm:p-4">
        {todayRegulations.map((regulation) => (
          <RegulationCard
            key={`today-${regulation.id}`}
            regulation={regulation}
            searchQuery={searchQuery}
            onOpen={() =>
              setSelectedRegulation(regulation)
            }
          />
        ))}
      </div>
    )}
  </section>
)}
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
  <RegulationSubcategorySection
    regulations={deviceRegulations}
    searchQuery={searchQuery}
    onOpen={setSelectedRegulation}
    compactOnMobile
  />
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
  <RegulationSubcategorySection
    regulations={drugRegulations}
    searchQuery={searchQuery}
    onOpen={setSelectedRegulation}
    compactOnMobile
  />
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
{regulation.status && (
  <span
    className={[
      "rounded-full border px-2.5 py-1 text-xs font-semibold",
      getStatusStyle(regulation.status),
    ].join(" ")}
  >
    {regulation.status}
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

      <div className="mt-4 flex items-start justify-between gap-3">
  <h2
    className={[
      "min-w-0 font-bold text-slate-900 transition group-hover:text-violet-700",
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

  {isNewRegulation(regulation.published_at) && (
    <span className="shrink-0 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-600">
      NEW
    </span>
  )}
</div>

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
{regulation.status && (
  <span
    className={[
      "rounded-full border px-2.5 py-1 text-xs font-semibold",
      getStatusStyle(regulation.status),
    ].join(" ")}
  >
    {regulation.status}
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
type RegulationSubcategorySectionProps = {
  regulations: Regulation[];
  searchQuery: string;
  onOpen: (regulation: Regulation) => void;
  compactOnMobile?: boolean;
};
function matchesDateFilter(
  publishedAt: string | null | undefined,
  dateFilter: (typeof DATE_FILTERS)[number]
) {
  if (dateFilter === "전체") {
    return true;
  }

  if (!publishedAt) {
    return false;
  }

  const publishedDate = new Date(publishedAt);

  if (Number.isNaN(publishedDate.getTime())) {
    return false;
  }

  const now = new Date();

  if (dateFilter === "올해") {
    return (
      publishedDate.getFullYear() ===
      now.getFullYear()
    );
  }

  const daysByFilter = {
    "최근 7일": 7,
    "최근 30일": 30,
    "최근 90일": 90,
  } as const;

  const days = daysByFilter[dateFilter];
  const startDate = new Date(now);

  startDate.setHours(0, 0, 0, 0);
  startDate.setDate(
    startDate.getDate() - (days - 1)
  );

  return (
    publishedDate.getTime() >=
    startDate.getTime()
  );
}
function matchesCustomDateRange(
  publishedAt: string | null | undefined,
  startDate: string,
  endDate: string
) {
  if (!startDate && !endDate) {
    return true;
  }

  if (!publishedAt) {
    return false;
  }

  const published = new Date(`${publishedAt}T00:00:00`);

  if (Number.isNaN(published.getTime())) {
    return false;
  }

  if (startDate) {
    const start = new Date(`${startDate}T00:00:00`);

    if (
      !Number.isNaN(start.getTime()) &&
      published < start
    ) {
      return false;
    }
  }

  if (endDate) {
    const end = new Date(`${endDate}T23:59:59`);

    if (
      !Number.isNaN(end.getTime()) &&
      published > end
    ) {
      return false;
    }
  }

  return true;
}
function getRegulationGroup(
  regulation: Regulation
): "고시" | "공고" | "정책뉴스" | "기타" {
  const text = [
    regulation.subcategory,
    regulation.title,
    regulation.department,
    regulation.source_url,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // 정책뉴스를 가장 먼저 판별
  if (
    text.includes("정책뉴스") ||
    text.includes("정책 뉴스") ||
    text.includes("보도자료") ||
    text.includes("mnu20456")
  ) {
    return "정책뉴스";
  }

  // 고시·규정·행정예고 계열
  if (
    text.includes("고시") ||
    text.includes("행정예고") ||
    text.includes("제정안") ||
    text.includes("개정안") ||
    text.includes("일부개정") ||
    text.includes("전부개정") ||
    text.includes("규정 제정") ||
    text.includes("규정 개정")
  ) {
    return "고시";
  }

  // 공고·공지 계열
  if (
    text.includes("공고") ||
    text.includes("공지사항") ||
    text.includes("공지 사항") ||
    text.includes("모집공고") ||
    text.includes("재공고")
  ) {
    return "공고";
  }

  return "기타";
}

function getRegulationGroupLabel(
  group: "고시" | "공고" | "정책뉴스" | "기타"
) {
  switch (group) {
    case "고시":
      return "📜 고시";

    case "공고":
      return "📌 공고";

    case "정책뉴스":
      return "📢 정책뉴스";

    default:
      return "📂 기타";
  }
}

function getRegulationGroupStyle(
  group: "고시" | "공고" | "정책뉴스" | "기타"
) {
  switch (group) {
    case "고시":
      return "border-blue-200 bg-blue-50 hover:bg-blue-100";

    case "공고":
      return "border-emerald-200 bg-emerald-50 hover:bg-emerald-100";

    case "정책뉴스":
      return "border-orange-200 bg-orange-50 hover:bg-orange-100";

    default:
      return "border-slate-200 bg-slate-50 hover:bg-slate-100";
  }
}

function RegulationSubcategorySection({
  regulations,
  searchQuery,
  onOpen,
  compactOnMobile = false,
}: RegulationSubcategorySectionProps) {
  const [openGroups, setOpenGroups] = useState<
    Record<string, boolean>
  >({
    고시: true,
    공고: true,
    정책뉴스: true,
    기타: true,
  });

  const grouped = useMemo(() => {
    const result: Record<
      "고시" | "공고" | "정책뉴스" | "기타",
      Regulation[]
    > = {
      고시: [],
      공고: [],
      정책뉴스: [],
      기타: [],
    };

    for (const regulation of regulations) {
      const group = getRegulationGroup(regulation);
      result[group].push(regulation);
    }

    return result;
  }, [regulations]);

  const groupOrder = [
    "고시",
    "공고",
    "정책뉴스",
    "기타",
  ] as const;

  const visibleGroups = groupOrder.filter(
    (group) => grouped[group].length > 0
  );

  if (visibleGroups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
        표시할 항목이 없습니다.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {visibleGroups.map((group) => {
        const items = grouped[group];
        const open = openGroups[group] ?? true;

        return (
          <section
            key={group}
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            <button
              type="button"
              onClick={() =>
                setOpenGroups((current) => ({
                  ...current,
                  [group]: !open,
                }))
              }
              className={[
                "flex w-full items-center justify-between gap-3 border-b-0 p-4 text-left transition",
                getRegulationGroupStyle(group),
              ].join(" ")}
            >
              <div>
                <p className="font-bold text-slate-900">
                  {getRegulationGroupLabel(group)}
                </p>

                <p className="mt-1 text-xs text-slate-500">
                  {items.length}건
                </p>
              </div>

              <span className="text-lg text-slate-600">
                {open ? "▲" : "▼"}
              </span>
            </button>

            {open && (
              <div className="space-y-3 border-t border-slate-100 bg-slate-50 p-3 sm:p-4">
                {items.map((regulation) => (
                  <RegulationCard
                    key={regulation.id}
                    regulation={regulation}
                    searchQuery={searchQuery}
                    onOpen={() => onOpen(regulation)}
                    compactOnMobile={compactOnMobile}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
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