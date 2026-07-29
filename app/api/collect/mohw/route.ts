import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import OpenAI from "openai";
import { createClient } from "@/utils/supabase/server";

type Category = "의료기기" | "의약품";

type DocumentType =
  | "법률"
  | "시행령"
  | "시행규칙"
  | "규칙"
  | "훈령"
  | "예규"
  | "고시"
  | "지침"
  | "기타";

type BasicDocument = {
  title: string;
  sourceUrl: string;
  documentType: DocumentType;
  publishedAt: string;
  effectiveAt: string;
  documentNumber: string;
  amendmentType: string;
  sourceType: "law" | "board";
};

type MohwDocument = BasicDocument & {
  department: string;
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

type ExistingRegulationRow = Pick<
  RegulationRow,
  | "source_url"
  | "ai_summary"
  | "ai_impact"
  | "ai_action"
  | "ai_importance"
  | "summarized_at"
>;

const BASE_URL = "https://www.mohw.go.kr";

const LAW_LIST_URL =
  `${BASE_URL}/law.es?mid=a10409010000`;

const BOARD_LIST_URL =
  `${BASE_URL}/board.es?mid=a10409020000&bid=0026`;

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/126.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
};

function normalize(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function includesAny(
  text: string,
  keywords: readonly string[]
): boolean {
  const normalized = normalize(text).toLowerCase();

  return keywords.some((keyword) =>
    normalized.includes(keyword.toLowerCase())
  );
}

function normalizeDate(value: string): string {
  const match = normalize(value).match(
    /(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/
  );

  if (!match) {
    return "";
  }

  const [, year, month, day] = match;

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function absoluteUrl(
  href: string | undefined,
  baseUrl: string
): string {
  if (!href) {
    return "";
  }

  const cleaned = href.trim();

  if (
    !cleaned ||
    cleaned === "#" ||
    cleaned.toLowerCase().startsWith("javascript:")
  ) {
    return "";
  }

  try {
    return new URL(cleaned, baseUrl).toString();
  } catch {
    return "";
  }
}

function detectDocumentType(
  title: string,
  fallback = ""
): DocumentType {
  const text = normalize(`${title} ${fallback}`);

  if (text.includes("시행규칙")) {
    return "시행규칙";
  }

  if (text.includes("시행령")) {
    return "시행령";
  }

  if (text.includes("[훈령]") || text.includes(" 훈령 ")) {
    return "훈령";
  }

  if (text.includes("[예규]") || text.includes(" 예규 ")) {
    return "예규";
  }

  if (text.includes("[고시]") || text.includes(" 고시 ")) {
    return "고시";
  }

  if (text.includes("[지침]") || text.includes(" 지침 ")) {
    return "지침";
  }

  if (text.includes("규칙")) {
    return "규칙";
  }

  if (text.includes("법률")) {
    return "법률";
  }

  return "기타";
}

function removeDocumentTypePrefix(title: string): string {
  return normalize(
    title.replace(
      /^\s*\[(법률|시행령|시행규칙|규칙|훈령|예규|고시|지침)\]\s*/i,
      ""
    )
  );
}

const MEDICAL_DEVICE_KEYWORDS = [
  "의료기기",
  "의료 기기",
  "의료장비",
  "의료 장비",
  "체외진단",
  "체외 진단",
  "진단용 방사선",
  "방사선 발생장치",
  "특수의료장비",
  "디지털의료",
  "디지털 의료",
  "디지털헬스",
  "디지털 헬스",
  "혁신의료기기",
  "신의료기술",
  "의료기술평가",
  "의료 기술 평가",
  "진단시약",
  "보조기기",
  "복지용구",
  "치료재료",
  "인공관절",
  "인공호흡기",
  "심박조율기",
  "의료용품",
] as const;

const MEDICINE_KEYWORDS = [
  "의약품",
  "약사법",
  "약제",
  "보험약제",
  "약가",
  "약제급여",
  "약제 급여",
  "바이오의약품",
  "바이오 의약품",
  "제약",
  "의약외품",
  "마약류",
  "마약",
  "향정신성",
  "희귀의약품",
  "원료의약품",
  "완제의약품",
  "임상시험",
  "생물학적제제",
  "백신",
  "한약",
  "한약재",
  "신약",
  "제네릭",
  "복제약",
  "약국",
  "약사",
  "조제",
  "처방",
  "의약품유통",
  "의약품 유통",
] as const;

const EXCLUDED_KEYWORDS = [
  "채용",
  "합격자",
  "직원 모집",
  "인사발령",
  "공무원",
  "주식 거래 제한",
  "당직",
  "복무",
  "감사 규정",
  "청사",
  "직제",
  "소속기관 직제",
  "공무국외출장",
  "보안업무",
  "기록물관리",
] as const;

function classifyCategory(
  title: string,
  department: string,
  detailText: string
): Category | null {
  const titleText = normalize(title);
  const departmentText = normalize(department);
  const detail = normalize(detailText);

  if (includesAny(titleText, EXCLUDED_KEYWORDS)) {
    return null;
  }

  // 제목은 가장 강한 분류 기준
  const titleHasDevice = includesAny(
    titleText,
    MEDICAL_DEVICE_KEYWORDS
  );

  const titleHasMedicine = includesAny(
    titleText,
    MEDICINE_KEYWORDS
  );

  if (titleHasDevice && !titleHasMedicine) {
    return "의료기기";
  }

  if (titleHasMedicine && !titleHasDevice) {
    return "의약품";
  }

  // 담당 부서 기준
  if (
    includesAny(departmentText, [
      "의료기기",
      "의료자원",
      "의료기관정책",
      "보건산업",
      "의료기술",
    ])
  ) {
    return "의료기기";
  }

  if (
    includesAny(departmentText, [
      "약무",
      "약제",
      "보험약제",
      "의약품",
      "제약",
      "한의약",
    ])
  ) {
    return "의약품";
  }

  // 본문은 메뉴나 관련 게시물 문구가 섞이므로 점수제로 판별
  const deviceScore = MEDICAL_DEVICE_KEYWORDS.reduce(
    (score, keyword) =>
      detail.toLowerCase().includes(keyword.toLowerCase())
        ? score + 1
        : score,
    0
  );

  const medicineScore = MEDICINE_KEYWORDS.reduce(
    (score, keyword) =>
      detail.toLowerCase().includes(keyword.toLowerCase())
        ? score + 1
        : score,
    0
  );

  if (deviceScore >= 2 && deviceScore > medicineScore) {
    return "의료기기";
  }

  if (medicineScore >= 2 && medicineScore > deviceScore) {
    return "의약품";
  }

  // 양쪽이 모두 있는 경우 제목의 우선 키워드를 사용
  if (titleHasDevice) {
    return "의료기기";
  }

  if (titleHasMedicine) {
    return "의약품";
  }

  return null;
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: REQUEST_HEADERS,
    cache: "no-store",
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(
      `보건복지부 요청 실패: ${response.status} ${url}`
    );
  }

  return response.text();
}

/**
 * 법률 / 시행령 / 시행규칙 목록 수집
 */
async function fetchLawDocuments(): Promise<BasicDocument[]> {
  const html = await fetchHtml(LAW_LIST_URL);
  const $ = cheerio.load(html);

  const documents: BasicDocument[] = [];

  $("table tbody tr").each((index, row) => {
    const cells = $(row).find("td");

    if (cells.length < 5) {
      return;
    }

    const documentNumber = normalize(cells.eq(1).text());

    const titleCell = cells.eq(2);
    const link = titleCell.find("a").first();

    const title = removeDocumentTypePrefix(
      normalize(link.text()) || normalize(titleCell.text())
    );

    const publishedAt = normalizeDate(cells.eq(3).text());
    const effectiveAt = normalizeDate(cells.eq(4).text());

    if (!title) {
      return;
    }

    const href = link.attr("href");

    // 국가법령정보센터 링크가 있으면 사용하고,
    // 링크가 없으면 보건복지부 목록 주소를 고유 URL로 만듦
    const sourceUrl =
      absoluteUrl(href, LAW_LIST_URL) ||
      `${LAW_LIST_URL}&document=${encodeURIComponent(
        `${documentNumber}-${title}-${publishedAt}-${index}`
      )}`;

    documents.push({
      title,
      sourceUrl,
      documentType: detectDocumentType(title),
      publishedAt,
      effectiveAt,
      documentNumber,
      amendmentType: "",
      sourceType: "law",
    });
  });

  return documents;
}

/**
 * 훈령 / 예규 / 고시 / 지침 목록 수집
 */
async function fetchBoardPage(
  page: number
): Promise<BasicDocument[]> {
  const pageUrl = `${BOARD_LIST_URL}&nPage=${page}`;
  const html = await fetchHtml(pageUrl);
  const $ = cheerio.load(html);

  const documents: BasicDocument[] = [];

  $("table tbody tr").each((_, row) => {
    const cells = $(row).find("td");

    if (cells.length < 5) {
      return;
    }

    const amendmentType = normalize(cells.eq(1).text());
    const documentNumber = normalize(cells.eq(2).text());

    const titleCell = cells.eq(3);
    const link = titleCell
      .find("a[href*='act=view']")
      .first();

    const title =
      normalize(link.text()) || normalize(titleCell.text());

    const publishedAt = normalizeDate(cells.eq(4).text());
    const href = link.attr("href");
    const sourceUrl = absoluteUrl(href, pageUrl);

    if (!title || !sourceUrl) {
      return;
    }

    documents.push({
      title: removeDocumentTypePrefix(title),
      sourceUrl,
      documentType: detectDocumentType(
        title,
        normalize($(row).text())
      ),
      publishedAt,
      effectiveAt: "",
      documentNumber,
      amendmentType,
      sourceType: "board",
    });
  });

  /*
   * 표 선택자가 바뀌었을 경우의 예비 처리
   */
  if (documents.length === 0) {
    $("a[href*='act=view'][href*='bid=0026']").each(
      (_, element) => {
        const link = $(element);
        const title = normalize(link.text());
        const href = link.attr("href");
        const sourceUrl = absoluteUrl(href, pageUrl);

        if (!title || !sourceUrl) {
          return;
        }

        const row = link.closest("tr");
        const rowText = normalize(row.text());

        documents.push({
          title: removeDocumentTypePrefix(title),
          sourceUrl,
          documentType: detectDocumentType(title, rowText),
          publishedAt: normalizeDate(rowText),
          effectiveAt: "",
          documentNumber: "",
          amendmentType: "",
          sourceType: "board",
        });
      }
    );
  }

  return documents;
}

function extractLabelValue(
  $: cheerio.CheerioAPI,
  labels: string[]
): string {
  /*
   * dt/dd 형태
   */
  for (const label of labels) {
    let result = "";

    $("dt, th").each((_, element) => {
      if (result) {
        return;
      }

      const labelText = normalize($(element).text());

      if (
        labelText === label ||
        labelText.includes(label)
      ) {
        const valueElement = $(element).next("dd, td");

        if (valueElement.length) {
          result = normalize(valueElement.text());
        }
      }
    });

    if (result) {
      return result;
    }
  }

  /*
   * 전체 본문 정규식 예비 처리
   */
  const bodyText = normalize($("body").text());

  for (const label of labels) {
    const escapedLabel = label.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

    const match = bodyText.match(
      new RegExp(
        `${escapedLabel}\\s*[:|]?\\s*([^|]{1,100}?)(?=\\s*(?:작성일|조회수|담당자|연락처|담당부서|제\\.개정|분류|발령번호|첨부파일|$))`
      )
    );

    if (match?.[1]) {
      return normalize(match[1]);
    }
  }

  return "";
}

function extractDetailText(
  $: cheerio.CheerioAPI
): string {
  const selectors = [
    ".board_view",
    ".board-view",
    ".board_view_con",
    ".board-view-con",
    ".view_cont",
    ".view-content",
    ".board-content",
    ".bbs_view",
    ".bbs-view",
    ".cont",
    ".content",
    "#content",
  ];

  for (const selector of selectors) {
    const element = $(selector).first();

    if (!element.length) {
      continue;
    }

    // 메뉴·스크립트·첨부파일 영역이 요약에 섞이는 것을 줄임
    element
      .find(
        "script, style, nav, header, footer, .file, .attach, .attachment, .btn"
      )
      .remove();

    const text = normalize(element.text());

    if (text.length >= 80) {
      return text.slice(0, 6000);
    }
  }

  const body = $("body").clone();

  body
    .find(
      "script, style, nav, header, footer, form, .file, .attach, .attachment"
    )
    .remove();

  return normalize(body.text()).slice(0, 6000);
}

async function enrichBoardDocument(
  document: BasicDocument
): Promise<BasicDocument & {
  department: string;
  detailText: string;
}> {
  try {
    const html = await fetchHtml(document.sourceUrl);
    const $ = cheerio.load(html);

    const department = extractLabelValue($, [
      "담당부서",
      "부서",
    ]);

    const detailDocumentType = extractLabelValue($, [
      "분류",
    ]);

    const documentNumber = extractLabelValue($, [
      "발령번호",
    ]);

    const amendmentType = extractLabelValue($, [
      "제.개정 구분",
      "제·개정 구분",
      "제개정 구분",
    ]);

    const revisionDate = normalizeDate(
      extractLabelValue($, [
        "제.개정일",
        "제·개정일",
        "제개정일",
      ])
    );

    const writtenAt = normalizeDate(
      extractLabelValue($, ["작성일"])
    );

    return {
      ...document,
      department,
      detailText: extractDetailText($),
      documentType: detectDocumentType(
        document.title,
        detailDocumentType || document.documentType
      ),
      documentNumber:
        documentNumber || document.documentNumber,
      amendmentType:
        amendmentType || document.amendmentType,
      publishedAt:
        revisionDate ||
        writtenAt ||
        document.publishedAt,
    };
  } catch (error) {
    console.error(
      `상세 페이지 수집 실패: ${document.sourceUrl}`,
      error
    );

    return {
      ...document,
      department: "",
      detailText: "",
    };
  }
}

function buildLawDetailText(
  document: BasicDocument
): string {
  return normalize(`
    문서 유형: ${document.documentType}
    법령명: ${document.title}
    공포번호: ${document.documentNumber || "확인 필요"}
    공포일자: ${document.publishedAt || "확인 필요"}
    시행일: ${document.effectiveAt || "확인 필요"}
  `);
}

async function summarizeDocument(
  document: MohwDocument
): Promise<AiSummary> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY가 설정되지 않았습니다."
    );
  }

  // 빌드 시 환경변수 오류를 막기 위해 함수 안에서 생성
  const openai = new OpenAI({
    apiKey,
  });

  const response = await openai.responses.create({
    model:
      process.env.OPENAI_SUMMARY_MODEL ??
      "gpt-5-mini",
    store: false,
    instructions:
      "당신은 대한민국 보건복지부 법령을 분석하는 규제 전문가입니다. " +
      "의약품 및 의료기기 기업의 인허가, 제조, 수입, 유통, 보험급여, " +
      "임상시험 및 규제 대응 관점에서 분석하세요. " +
      "제공된 원문에 없는 내용은 추측하지 마세요. " +
      "의견 제출 기간이나 제출 방법은 다루지 마세요. " +
      "한국어로 간결하게 작성하세요.",
    input: `
다음 보건복지부 법령 문서를 분석하세요.

문서 유형: ${document.documentType}
분야: ${document.category}
제목: ${document.title}
담당 부서: ${document.department || "확인되지 않음"}
발령·공포 번호: ${document.documentNumber || "확인되지 않음"}
제·개정 구분: ${document.amendmentType || "확인되지 않음"}
공포·등록일: ${document.publishedAt || "확인되지 않음"}
시행일: ${document.effectiveAt || "확인되지 않음"}

본문 또는 법령 정보:
${document.detailText.slice(0, 5000)}
`,
    text: {
      format: {
        type: "json_schema",
        name: "mohw_regulation_summary",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: {
              type: "string",
              description:
                "문서의 핵심 변경사항 또는 규정 내용을 2~3문장으로 요약",
            },
            impact: {
              type: "string",
              description:
                "의약품 또는 의료기기 기업에 미칠 수 있는 영향을 작성",
            },
            action: {
              type: "string",
              description:
                "기업 담당자가 확인하거나 수행할 조치를 한 문장으로 작성",
            },
            importance: {
              type: "string",
              enum: ["높음", "중간", "낮음"],
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
      `AI 요약 결과가 비어 있습니다: ${document.title}`
    );
  }

  return JSON.parse(
    response.output_text
  ) as AiSummary;
}

export async function GET() {
  try {
    /*
     * 고시 게시판 최근 5페이지 수집
     * 비용과 실행 시간이 크면 [1, 2]로 줄여도 됨
     */
    const [lawDocuments, ...boardPages] =
      await Promise.all([
        fetchLawDocuments(),
        ...[1, 2, 3, 4, 5].map((page) =>
          fetchBoardPage(page)
        ),
      ]);

    const boardDocuments = boardPages.flat();

    const allDocuments = [
      ...lawDocuments,
      ...boardDocuments,
    ];

    const uniqueDocuments = Array.from(
      new Map(
        allDocuments.map((document) => [
          document.sourceUrl,
          document,
        ])
      ).values()
    );

    /*
     * 제목만으로 관련 가능성이 전혀 없는 문서는
     * 상세 페이지 요청 전에 제외
     */
    const preliminaryDocuments =
      uniqueDocuments.filter((document) => {
        const searchableText = normalize(
          `${document.title} ${document.documentNumber}`
        );

        return (
          includesAny(
            searchableText,
            MEDICAL_DEVICE_KEYWORDS
          ) ||
          includesAny(
            searchableText,
            MEDICINE_KEYWORDS
          )
        );
      });

    const enrichedDocuments = await Promise.all(
      preliminaryDocuments
        .slice(0, 40)
        .map(async (document) => {
          if (document.sourceType === "law") {
            return {
              ...document,
              department: "",
              detailText:
                buildLawDetailText(document),
            };
          }

          return enrichBoardDocument(document);
        })
    );

    const relevantDocuments = enrichedDocuments
      .map((document): MohwDocument | null => {
        const category = classifyCategory(
          document.title,
          document.department,
          document.detailText
        );

        if (!category) {
          return null;
        }

        return {
          ...document,
          category,
        };
      })
      .filter(
        (
          document
        ): document is MohwDocument =>
          document !== null
      )
      /*
       * 한 번 실행할 때 신규 AI 요약이 너무 많아지는 것을 방지
       */
      .slice(0, 15);

    if (relevantDocuments.length === 0) {
      return NextResponse.json({
        success: true,
        lawCollectedCount: lawDocuments.length,
        boardCollectedCount: boardDocuments.length,
        collectedCount: uniqueDocuments.length,
        preliminaryCount:
          preliminaryDocuments.length,
        relevantCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        summarizedCount: 0,
        message:
          "최근 법령에서 의약품 또는 의료기기 관련 문서를 찾지 못했습니다.",
      });
    }

    const supabase = await createClient();

    const sourceUrls = relevantDocuments.map(
      (document) => document.sourceUrl
    );

    const {
      data: existingRows,
      error: existingError,
    } = await supabase
      .from("regulations")
      .select(
        "source_url, ai_summary, ai_impact, ai_action, " +
          "ai_importance, summarized_at"
      )
      .in("source_url", sourceUrls);

    if (existingError) {
      throw new Error(
        `기존 데이터 확인 실패: ${existingError.message}`
      );
    }

    const typedExistingRows =
      (existingRows ?? []) as unknown as ExistingRegulationRow[];

    const existingUrlSet = new Set(
      typedExistingRows.map((row) => row.source_url)
    );

    const existingSummaryMap = new Map(
      typedExistingRows.map((row) => [
        row.source_url,
        row,
      ])
    );

    const rows: RegulationRow[] = [];
    let summarizedCount = 0;

    for (const document of relevantDocuments) {
      const existing = existingSummaryMap.get(
        document.sourceUrl
      );

      let aiSummary: AiSummary;

      if (
        existing?.ai_summary &&
        existing?.ai_impact &&
        existing?.ai_action
      ) {
        aiSummary = {
          summary: existing.ai_summary,
          impact: existing.ai_impact,
          action: existing.ai_action,
          importance:
            existing.ai_importance === "높음" ||
            existing.ai_importance === "낮음"
              ? existing.ai_importance
              : "중간",
        };
      } else {
        aiSummary =
          await summarizeDocument(document);

        summarizedCount += 1;
      }

      rows.push({
        country: "대한민국",
        agency: "보건복지부",
        category: document.category,
        title:
          `[${document.documentType}] ` +
          removeDocumentTypePrefix(document.title),
        department: document.department,
        published_at:
          document.publishedAt || null,
        source_url: document.sourceUrl,
        ai_summary: aiSummary.summary,
        ai_impact: aiSummary.impact,
        ai_action: aiSummary.action,
        ai_importance: aiSummary.importance,
        summarized_at:
          existing?.summarized_at ??
          new Date().toISOString(),
      });
    }

    const insertedCount = rows.filter(
      (row) =>
        !existingUrlSet.has(row.source_url)
    ).length;

    const updatedCount =
      rows.length - insertedCount;

    const { data, error } = await supabase
      .from("regulations")
      .upsert(rows, {
        onConflict: "source_url",
      })
      .select();

    if (error) {
      console.error(
        "Supabase 저장 오류:",
        error
      );

      return NextResponse.json(
        {
          success: false,
          message:
            "Supabase 저장에 실패했습니다.",
          error: error.message,
          details: error.details,
          hint: error.hint,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      lawCollectedCount: lawDocuments.length,
      boardCollectedCount:
        boardDocuments.length,
      collectedCount: uniqueDocuments.length,
      preliminaryCount:
        preliminaryDocuments.length,
      relevantCount:
        relevantDocuments.length,
      insertedCount,
      updatedCount,
      summarizedCount,
      savedRows: data?.length ?? 0,
      message:
        `${insertedCount}개 신규 저장, ` +
        `${updatedCount}개 업데이트, ` +
        `${summarizedCount}개 AI 요약 완료`,
      documents: relevantDocuments.map(
        (document) => ({
          title: document.title,
          documentType:
            document.documentType,
          category: document.category,
          department:
            document.department,
          documentNumber:
            document.documentNumber,
          amendmentType:
            document.amendmentType,
          publishedAt:
            document.publishedAt,
          effectiveAt:
            document.effectiveAt,
          sourceUrl: document.sourceUrl,
        })
      ),
    });
  } catch (error) {
    console.error(
      "MOHW 법령 수집 오류:",
      error
    );

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