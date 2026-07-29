import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { createClient } from "@/utils/supabase/server";
import OpenAI from "openai";

type Category = "의료기기" | "의약품";

type MfdsNotice = {
  title: string;
  department: string;
  publishedAt: string;
  sourceUrl: string;
  detailText: string;
  category: Category;
};

type AiSummary = {
  summary: string;
  impact: string;
  action: string;
  importance: "높음" | "중간" | "낮음";
};

type RegulationRow = {
  country: string;
  agency: string;
  category: Category;
  title: string;
  department: string;
  published_at: string | null;
  source_url: string;
  ai_summary: string;
  ai_impact: string;
  ai_action: string;
  ai_importance: AiSummary["importance"];
  summarized_at: string;
};


const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function summarizeNotice(notice: MfdsNotice): Promise<AiSummary> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
  }

  const response = await openai.responses.create({
    model: process.env.OPENAI_SUMMARY_MODEL ?? "gpt-5-mini",
    store: false,
    instructions:
      "당신은 한국 식품의약품안전처 규제 공고를 기업 실무자 관점에서 요약하는 분석가입니다. 원문에 없는 사실은 추측하지 말고, 한국어로 간결하게 작성하세요.",
    input: `다음 공고를 분석하세요.

제목: ${notice.title}
담당부서: ${notice.department}
분야: ${notice.category}
게시일: ${notice.publishedAt}
본문: ${notice.detailText.slice(0, 4500)}`,
    text: {
      format: {
        type: "json_schema",
        name: "regulation_summary",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: {
              type: "string",
              description: "공고의 핵심 내용을 2~3문장으로 요약",
            },
            impact: {
              type: "string",
              description: "의약품 또는 의료기기 기업에 미칠 수 있는 영향. 불명확하면 확인 필요라고 명시",
            },
            action: {
              type: "string",
              description: "기업 담당자가 확인하거나 수행할 조치를 한 문장으로 작성",
            },
            importance: {
              type: "string",
              enum: ["높음", "중간", "낮음"],
            },
          },
          required: ["summary", "impact", "action", "importance"],
        },
      },
    },
  });

  if (!response.output_text) {
    throw new Error(`AI 요약 결과가 비어 있습니다: ${notice.title}`);
  }

  return JSON.parse(response.output_text) as AiSummary;
}

const requestHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "ko-KR,ko;q=0.9",
};

/**
 * 제목, 담당 부서, 상세 본문을 종합해서 분야를 분류합니다.
 */
function classifyNotice(
  title: string,
  department: string,
  detailText: string
): Category | null {
  const normalize = (value: string) =>
    value.replace(/\s+/g, " ").trim().toLowerCase();

  const titleText = normalize(title);
  const departmentText = normalize(department);
  const detail = normalize(detailText);

  const includesAny = (text: string, keywords: string[]) =>
    keywords.some((keyword) => text.includes(keyword));

  const medicalDeviceKeywords = [
    "의료기기",
    "의료 기기",
    "체외진단",
    "체외 진단",
    "디지털의료",
    "디지털 의료",
    "혁신의료기기",
    "진단시약",
  ];

  const medicineKeywords = [
    "의약품",
    "바이오의약품",
    "바이오 의약품",
    "의약외품",
    "마약류",
    "임시마약류",
    "희귀의약품",
    "한약",
    "한약재",
    "생약",
    "신약",
    "제네릭",
    "원료의약품",
    "완제의약품",
    "임상시험",
    "약사법",
    "생물학적제제",
    "백신",
  ];

  // 식품·채용·인사·모집처럼 규제 모니터링 대상이 아닌 공고를 먼저 제외합니다.
  const excludedTitleKeywords = [
    "식품",
    "건강기능식품",
    "고열량저영양",
    "고카페인",
    "학교",
    "판매 금지",
    "식생활",
    "영양",
    "후보자 모집",
    "모집공고",
    "모집 공고",
    "채용",
    "최종합격자",
    "합격자 공고",
    "공모직위",
    "해외정보리포터",
    "후보자",
    "인사",
  ];

  const excludedDepartmentKeywords = [
    "식생활",
    "식품",
    "영양",
    "운영지원",
    "위해정보",
  ];

  if (
    includesAny(titleText, excludedTitleKeywords) ||
    includesAny(departmentText, excludedDepartmentKeywords)
  ) {
    return null;
  }

  // 가장 신뢰도가 높은 제목을 우선 판정합니다.
  if (includesAny(titleText, medicalDeviceKeywords)) {
    return "의료기기";
  }

  if (includesAny(titleText, medicineKeywords)) {
    return "의약품";
  }

  // 제목이 모호하면 담당 부서로 판정합니다.
  if (
    includesAny(departmentText, [
      "의료기기",
      "체외진단",
      "혁신진단기기",
      "디지털의료",
    ])
  ) {
    return "의료기기";
  }

  if (
    includesAny(departmentText, [
      "의약품",
      "바이오",
      "의약외품",
      "마약",
      "한약",
    ])
  ) {
    return "의약품";
  }

  // 상세 본문은 메뉴·관련 게시물 문구가 섞일 수 있으므로 마지막 보조 수단으로만 사용합니다.
  const medicalDeviceMatches = medicalDeviceKeywords.filter((keyword) =>
    detail.includes(keyword)
  ).length;
  const medicineMatches = medicineKeywords.filter((keyword) =>
    detail.includes(keyword)
  ).length;

  if (medicalDeviceMatches >= 2 && medicalDeviceMatches > medicineMatches) {
    return "의료기기";
  }

  if (medicineMatches >= 2 && medicineMatches > medicalDeviceMatches) {
    return "의약품";
  }

  return null;
}

/**
 * 식약처 상세 페이지의 본문을 가져옵니다.
 */
async function fetchDetailText(sourceUrl: string): Promise<string> {
  try {
    const response = await fetch(sourceUrl, {
      headers: requestHeaders,
      cache: "no-store",
    });

    if (!response.ok) {
      return "";
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // 식약처 페이지 구조가 변경될 가능성을 고려해 여러 선택자를 확인합니다.
    const selectors = [
      ".board-view-content",
      ".board_view_content",
      ".view_cont",
      ".view-content",
      ".board-content",
      ".content",
      "#content",
    ];

    for (const selector of selectors) {
      const content = $(selector).first();

      if (content.length > 0) {
        const text = content
          .text()
          .replace(/\s+/g, " ")
          .trim();

        if (text.length > 30) {
          return text.slice(0, 5000);
        }
      }
    }

    // 선택자로 본문을 찾지 못하면 전체 페이지 텍스트 일부를 사용합니다.
    return $("body")
      .text()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 5000);
  } catch (error) {
    console.error(`상세 페이지 수집 실패: ${sourceUrl}`, error);
    return "";
  }
}

export async function GET() {
  try {
    const baseUrl = "https://www.mfds.go.kr";
    const listUrl = `${baseUrl}/brd/m_76/list.do`;

    // 1. 식약처 공고 목록 페이지 가져오기
    const response = await fetch(listUrl, {
      headers: requestHeaders,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`식약처 요청 실패: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // 2. 목록 페이지에서 기본 정보 추출
    const basicNotices: Omit<
      MfdsNotice,
      "detailText" | "category"
    >[] = [];

    $("a[href*='view.do']").each((_, element) => {
      const link = $(element);
      const href = link.attr("href");
      const title = link.text().replace(/\s+/g, " ").trim();

      if (!href || !title) return;
      if (!href.includes("seq=")) return;

      const container = link.closest("li");

      if (container.length === 0) return;

      const containerText = container
        .text()
        .replace(/\s+/g, " ")
        .trim();

      if (!containerText.includes("담당부서")) return;

      const departmentMatch = containerText.match(
        /담당부서\s*\|\s*(.+?)(?=\s*조회수\s*\|)/
      );

      const dateMatch = containerText.match(
        /(?:20\d{2}|'\d{2})[.-]\d{1,2}[.-]\d{1,2}/
      );

      const sourceUrl = new URL(href, listUrl).toString();

      basicNotices.push({
        title,
        department: departmentMatch?.[1]?.trim() ?? "",
        publishedAt: dateMatch?.[0] ?? "",
        sourceUrl,
      });
    });

    // 같은 URL이 여러 번 추출된 경우 제거합니다.
    // 식품 공고가 섞여 있을 수 있으므로 최근 30개까지 검사합니다.
    const uniqueBasicNotices = Array.from(
      new Map(
        basicNotices.map((notice) => [
          notice.sourceUrl,
          notice,
        ])
      ).values()
    ).slice(0, 30);

    if (uniqueBasicNotices.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "식약처 공고를 찾지 못했습니다.",
        },
        { status: 404 }
      );
    }

    // 3. 각 공고 상세 페이지를 확인하고 분야를 분류합니다.
    const classifiedResults = await Promise.all(
      uniqueBasicNotices.map(async (notice) => {
        const detailText = await fetchDetailText(
          notice.sourceUrl
        );

        const category = classifyNotice(
          notice.title,
          notice.department,
          detailText
        );

        if (!category) {
          return null;
        }

        return {
          ...notice,
          detailText,
          category,
        } satisfies MfdsNotice;
      })
    );

    // 의료기기와 의약품 공고만 최대 10개 저장합니다.
    const relevantNotices = classifiedResults
      .filter(
        (notice): notice is MfdsNotice => notice !== null
      )
      .slice(0, 10);

    if (relevantNotices.length === 0) {
      return NextResponse.json({
        success: true,
        collectedCount: uniqueBasicNotices.length,
        relevantCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        skippedCount: uniqueBasicNotices.length,
        message:
          "최근 공고에서 의료기기 또는 의약품 관련 공고를 찾지 못했습니다.",
      });
    }

    const supabase = await createClient();

    // 4. 기존 데이터와 AI 요약 여부를 먼저 확인합니다.
    const sourceUrls = relevantNotices.map((notice) => notice.sourceUrl);

    const { data: existingRows, error: existingError } =
      await supabase
        .from("regulations")
        .select(
          "source_url, ai_summary, ai_impact, ai_action, ai_importance, summarized_at"
        )
        .in("source_url", sourceUrls);

    if (existingError) {
      throw new Error(
        `기존 데이터 확인 실패: ${existingError.message}`
      );
    }

    const existingUrlSet = new Set(
      existingRows?.map((row) => row.source_url) ?? []
    );

    const existingSummaryMap = new Map(
      (existingRows ?? []).map((row) => [row.source_url, row])
    );

    // 요약이 없는 공고만 AI를 호출합니다. 자동 수집이 반복되어도 중복 비용이 발생하지 않습니다.
    let summarizedCount = 0;

    const rows: RegulationRow[] = [];

    for (const notice of relevantNotices) {
      const existing = existingSummaryMap.get(notice.sourceUrl);

      let aiSummary: AiSummary;

      if (existing?.ai_summary) {
        aiSummary = {
          summary: existing.ai_summary,
          impact: existing.ai_impact ?? "",
          action: existing.ai_action ?? "",
          importance: existing.ai_importance ?? "중간",
        };
      } else {
        aiSummary = await summarizeNotice(notice);
        summarizedCount += 1;
      }

      rows.push({
        country: "대한민국",
        agency: "식품의약품안전처",
        category: notice.category,
        title: notice.title,
        department: notice.department,
        published_at: notice.publishedAt || null,
        source_url: notice.sourceUrl,
        ai_summary: aiSummary.summary,
        ai_impact: aiSummary.impact,
        ai_action: aiSummary.action,
        ai_importance: aiSummary.importance,
        summarized_at:
          existing?.summarized_at ?? new Date().toISOString(),
      });
    }

    const insertedCount = rows.filter(
      (row) => !existingUrlSet.has(row.source_url)
    ).length;

    const updatedCount = rows.length - insertedCount;

    // 5. 같은 source_url이 있으면 중복 생성하지 않고 내용을 업데이트합니다.
    const { data, error } = await supabase
      .from("regulations")
      .upsert(rows, {
        onConflict: "source_url",
      })
      .select();

    if (error) {
      console.error("Supabase 저장 오류:", error);

      return NextResponse.json(
        {
          success: false,
          message: "Supabase 저장에 실패했습니다.",
          error: error.message,
          details: error.details,
          hint: error.hint,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      collectedCount: uniqueBasicNotices.length,
      relevantCount: relevantNotices.length,
      insertedCount,
      updatedCount,
      excludedCount:
        uniqueBasicNotices.length - relevantNotices.length,
      summarizedCount,
      message: `${insertedCount}개 신규 저장, ${updatedCount}개 기존 공고 업데이트, ${summarizedCount}개 AI 요약 완료`,
      notices: relevantNotices.map((notice) => ({
        title: notice.title,
        department: notice.department,
        publishedAt: notice.publishedAt,
        sourceUrl: notice.sourceUrl,
        category: notice.category,
        aiSummary: rows.find((row) => row.source_url === notice.sourceUrl)?.ai_summary,
        aiImportance: rows.find((row) => row.source_url === notice.sourceUrl)?.ai_importance,
      })),
      savedRows: data?.length ?? 0,
    });
  } catch (error) {
    console.error("MFDS 수집 오류:", error);

    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "알 수 없는 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}