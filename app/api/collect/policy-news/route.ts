import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import OpenAI from "openai";

import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LIST_URL =
  "https://emedi.mfds.go.kr/brd/MNU20456";

const BASE_URL = "https://emedi.mfds.go.kr";

/**
 * 수집할 페이지 수
 * 한 페이지에 약 10건이므로 2페이지면 최근 약 20건
 */
const PAGE_COUNT = 2;

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/126.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9," +
    "image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
  Referer: BASE_URL,
};

type PolicyNewsItem = {
  title: string;
  publishedAt: string | null;
  sourceUrl: string;
};
type AiSummary = {
  summary: string;
  impact: string;
  action: string;
  importance: "높음" | "중간" | "낮음";
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function summarizePolicyNews(
  item: PolicyNewsItem & {
    detailText: string;
  }
): Promise<AiSummary> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY가 설정되지 않았습니다."
    );
  }

  const response =
    await openai.responses.create({
      model:
        process.env.OPENAI_SUMMARY_MODEL ??
        "gpt-5-mini",
      store: false,
      instructions:
        "당신은 한국 식품의약품안전처의 의료기기 정책뉴스를 기업 실무자와 임상연구원 관점에서 요약하는 분석가입니다. 원문에 없는 사실은 추측하지 말고, 한국어로 간결하게 작성하세요.",
      input: `다음 의료기기 정책뉴스를 분석하세요.

제목: ${item.title}
게시일: ${item.publishedAt ?? "날짜 미확인"}
본문: ${item.detailText.slice(0, 4500)}`,
      text: {
        format: {
          type: "json_schema",
          name: "policy_news_summary",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: {
                type: "string",
                description:
                  "정책뉴스의 핵심 내용을 2~3문장으로 요약",
              },
              impact: {
                type: "string",
                description:
                  "의료기기 기업 또는 임상연구 업무에 미칠 수 있는 영향을 설명. 불명확하면 확인 필요라고 명시",
              },
              action: {
                type: "string",
                description:
                  "실무자가 확인하거나 수행할 조치를 한 문장으로 작성",
              },
              importance: {
                type: "string",
                enum: [
                  "높음",
                  "중간",
                  "낮음",
                ],
              },
            },
            required: [
              "summary",
              "impact",
              "action",
              "importance",
            ],
          },
        },
      },
    });

  if (!response.output_text) {
    throw new Error(
      `AI 요약 결과가 비어 있습니다: ${item.title}`
    );
  }

  return JSON.parse(
    response.output_text
  ) as AiSummary;
}

function normalize(value?: string | null): string {
  return (value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(
  value?: string | null
): string | null {
  const text = normalize(value);

  const match = text.match(
    /(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/
  );

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;

  return `${year}-${month.padStart(
    2,
    "0"
  )}-${day.padStart(2, "0")}`;
}

function createAbsoluteUrl(
  href?: string | null
): string | null {
  const value = normalize(href);

  if (
    !value ||
    value === "#" ||
    value.toLowerCase().startsWith("javascript:")
  ) {
    return null;
  }

  try {
    return new URL(value, BASE_URL).toString();
  } catch {
    return null;
  }
}

async function fetchHtml(
  url: string
): Promise<string> {
  const response = await fetch(url, {
    method: "GET",
    headers: REQUEST_HEADERS,
    cache: "no-store",
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(
      `${url} 요청 실패: ${response.status} ${response.statusText}`
    );
  }

  return response.text();
}

function createListUrl(pageNum: number): string {
  const url = new URL(LIST_URL);

  url.searchParams.set(
    "pageNum",
    String(pageNum)
  );

  return url.toString();
}

function parseListPage(
  html: string
): PolicyNewsItem[] {
  const $ = cheerio.load(html);
  const results: PolicyNewsItem[] = [];

  $("table tbody tr").each(
    (_, rowElement) => {
      const row = $(rowElement);
      const cells = row.find("td");

      if (cells.length === 0) {
        return;
      }

      const titleLink = row
        .find(
          'a[href*="/brd/view/MNU20456"], a[href*="ntceSn="]'
        )
        .first();

      const title = normalize(
        titleLink.attr("title") ||
          titleLink.text()
      );

      if (!title || title.length < 3) {
        return;
      }

      const sourceUrl = createAbsoluteUrl(
        titleLink.attr("href")
      );

      if (!sourceUrl) {
        return;
      }

      const rowText = normalize(row.text());

      const publishedAt = normalizeDate(
        rowText
      );

      results.push({
        title,
        publishedAt,
        sourceUrl,
      });
    }
  );

  /**
   * 사이트 구조가 조금 바뀌었을 때의 보조 방식
   */
  if (results.length === 0) {
    $(
      'a[href*="/brd/view/MNU20456"], a[href*="ntceSn="]'
    ).each((_, linkElement) => {
      const link = $(linkElement);

      const title = normalize(
        link.attr("title") || link.text()
      );

      if (!title || title.length < 3) {
        return;
      }

      const sourceUrl = createAbsoluteUrl(
        link.attr("href")
      );

      if (!sourceUrl) {
        return;
      }

      const container = link.closest(
        "tr, li, article, div"
      );

      const publishedAt = normalizeDate(
        container.text()
      );

      results.push({
        title,
        publishedAt,
        sourceUrl,
      });
    });
  }

  return Array.from(
    new Map(
      results.map((item) => [
        item.sourceUrl,
        item,
      ])
    ).values()
  );
}

async function fetchDetailText(
  sourceUrl: string
): Promise<string> {
  try {
    const html = await fetchHtml(sourceUrl);
    const $ = cheerio.load(html);

    $(
      [
        "script",
        "style",
        "noscript",
        "header",
        "footer",
        "nav",
        ".header",
        ".footer",
        ".gnb",
        ".lnb",
        ".breadcrumb",
        ".pagination",
        ".paging",
        ".btn-area",
        ".button-area",
        ".file-list",
        ".file_list",
      ].join(",")
    ).remove();

    const selectors = [
      ".board-view",
      ".board_view",
      ".view-content",
      ".view_content",
      ".view-cont",
      ".view_cont",
      ".board-content",
      ".board_content",
      ".bbs-view",
      ".bbs_view",
      ".contents",
      "#contents",
      "article",
    ];

    let detailText = "";

    for (const selector of selectors) {
      $(selector).each((_, element) => {
        const candidate = normalize(
          $(element).text()
        );

        if (
          candidate.length >
          detailText.length
        ) {
          detailText = candidate;
        }
      });
    }

    /**
     * 지정 선택자로 본문을 못 찾았을 때
     */
    if (!detailText) {
      detailText = normalize(
        $("main").text() ||
          $("body").text()
      );
    }

    return detailText.slice(0, 12000);
  } catch (error) {
    console.error(
      `[정책뉴스] 상세 조회 실패: ${sourceUrl}`,
      error
    );

    return "";
  }
}

function classifyAffectedArea(
  title: string,
  detailText: string
): Array<
  "인허가" | "임상시험" | "보험급여"
> {
  const text = `${title} ${detailText}`;
  const areas = new Set<
    "인허가" | "임상시험" | "보험급여"
  >();

  /**
   * 의료기기 정책뉴스이므로 기본적으로 인허가 포함
   */
  areas.add("인허가");

  if (
    /임상시험|임상 시험|임상연구|임상 연구|피험자|시험기관|IRB|GCP|실사용증거|RWE/i.test(
      text
    )
  ) {
    areas.add("임상시험");
  }

  if (
    /보험급여|건강보험|급여기준|비급여|수가|치료재료|상한금액/.test(
      text
    )
  ) {
    areas.add("보험급여");
  }

  return Array.from(areas);
}

export async function GET() {
  try {
    const pageResults =
      await Promise.allSettled(
        Array.from(
          { length: PAGE_COUNT },
          (_, index) => index + 1
        ).map(async (pageNum) => {
          const listUrl =
            createListUrl(pageNum);

          const html = await fetchHtml(
            listUrl
          );

          const items = parseListPage(html);

          return {
            pageNum,
            listUrl,
            items,
          };
        })
      );

    const collectedItems: PolicyNewsItem[] =
      [];

    const pageStatus: Array<{
      pageNum: number;
      url: string;
      count: number;
      success: boolean;
      error?: string;
    }> = [];

    pageResults.forEach(
      (result, index) => {
        const pageNum = index + 1;
        const url = createListUrl(pageNum);

        if (result.status === "fulfilled") {
          collectedItems.push(
            ...result.value.items
          );

          pageStatus.push({
            pageNum,
            url,
            count:
              result.value.items.length,
            success: true,
          });

          return;
        }

        pageStatus.push({
          pageNum,
          url,
          count: 0,
          success: false,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : "알 수 없는 오류",
        });
      }
    );

    const uniqueItems = Array.from(
      new Map(
        collectedItems.map((item) => [
          item.sourceUrl,
          item,
        ])
      ).values()
    );

    if (uniqueItems.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message:
            "의료기기 정책뉴스를 찾지 못했습니다.",
          pageStatus,
        },
        { status: 404 }
      );
    }

    const detailedItems =
      await Promise.all(
        uniqueItems.map(async (item) => {
          const detailText =
            await fetchDetailText(
              item.sourceUrl
            );

          return {
            ...item,
            detailText,
            affectedArea:
              classifyAffectedArea(
                item.title,
                detailText
              ),
          };
        })
      );

    const supabase = await createClient();

    const sourceUrls = detailedItems.map(
      (item) => item.sourceUrl
    );

    const {
  data: existingRows,
  error: existingError,
} = await supabase
  .from("regulations")
  .select(
  "source_url, ai_summary, ai_impact, ai_action, ai_importance, summarized_at"
)
  .in("source_url", sourceUrls);

    if (existingError) {
      throw new Error(
        `기존 정책뉴스 조회 실패: ${existingError.message}`
      );
    }

    const existingUrlSet = new Set(
      (existingRows ?? []).map(
        (row) => row.source_url
      )
    );
    const existingSummaryMap = new Map(
  (existingRows ?? []).map((row) => [
    row.source_url,
    row,
  ])
);

    const insertedCount =
      detailedItems.filter(
        (item) =>
          !existingUrlSet.has(
            item.sourceUrl
          )
      ).length;

    const updatedCount =
      detailedItems.length -
      insertedCount;

    let summarizedCount = 0;

const rows = [];

for (const item of detailedItems) {
  const existing =
    existingSummaryMap.get(item.sourceUrl);

  let aiSummary: AiSummary;

  if (existing?.ai_summary) {
    aiSummary = {
      summary: existing.ai_summary,
      impact: existing.ai_impact ?? "",
      action: existing.ai_action ?? "",
      importance:
        existing.ai_importance ?? "중간",
    };
  } else {
    try {
      aiSummary =
        await summarizePolicyNews(item);

      summarizedCount += 1;
    } catch (error) {
      console.error(
        `[정책뉴스] AI 요약 실패: ${item.title}`,
        error
      );

      aiSummary = {
        summary:
          item.detailText.slice(0, 500) ||
          "본문을 확인해 주세요.",
        impact:
          "정책뉴스 원문을 확인하여 의료기기 업무에 미치는 영향을 검토해야 합니다.",
        action:
          "원문과 첨부자료를 확인하세요.",
        importance: "중간",
      };
    }
  }

  rows.push({
    country: "대한민국",
    agency: "식품의약품안전처",
    category: "의료기기",
    subcategory: "정책뉴스",
    title: item.title,
    department: "의료기기 정책 뉴스",
    status: null,
    published_at: item.publishedAt,
    source_url: item.sourceUrl,

    summary: item.detailText
      ? item.detailText.slice(0, 1000)
      : null,

    ai_summary: aiSummary.summary,
    ai_impact: aiSummary.impact,
    ai_action: aiSummary.action,
    ai_importance: aiSummary.importance,
    summarized_at:
      existing?.summarized_at ??
      new Date().toISOString(),

    importance: "보통",
    affected_area: item.affectedArea,
    is_relevant: true,
    exclusion_reason: null,
  });
}

    const { data, error } = await supabase
      .from("regulations")
      .upsert(rows, {
        onConflict: "source_url",
        ignoreDuplicates: false,
      })
    .select(
  "id, title, source_url, category, subcategory, published_at, affected_area, ai_summary, ai_impact, ai_importance, summarized_at"
);

    if (error) {
      throw new Error(
        `Supabase 저장 실패: ${error.message}`
      );
    }

    return NextResponse.json({
      success: true,
      agency: "식품의약품안전처",
      category: "의료기기",
      subcategory: "정책뉴스",
      collectedCount:
        collectedItems.length,
      uniqueCount: uniqueItems.length,
      processedCount:
        detailedItems.length,
      insertedCount,
      updatedCount,
summarizedCount,
pageStatus,
results: data ?? [],
    });
  } catch (error) {
    console.error(
      "[의료기기 정책뉴스] 크롤링 실패",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          "의료기기 정책뉴스 수집 중 오류가 발생했습니다.",
        error:
          error instanceof Error
            ? error.message
            : "알 수 없는 오류",
      },
      { status: 500 }
    );
  }
}