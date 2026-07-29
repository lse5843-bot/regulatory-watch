import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/* =========================================================
 * 타입
 * ======================================================= */

type FeedName = "행위" | "치료재료" | "약제" | "의료급여";

type Category = "의료기기" | "의약품";

type Importance = "높음" | "중간" | "낮음";

type AiMode = "generated" | "reused" | "fallback";

type HiraFeed = {
  name: FeedName;
  url: string;
};

type RssItem = {
  feedName: FeedName;
  title: string;
  description: string;
  sourceUrl: string;
  publishedAt: string | null;
};

type HiraNotice = RssItem & {
  detailText: string;
  category: Category;
};

type AiResult = {
  summary: string;
  impact: string;
  importance: Importance;
  affected_area: ["보험급여"];
};

type ExistingRegulation = {
  source_url: string;
  ai_summary: string | null;
  ai_impact: string | null;
  ai_importance: string | null;
  affected_area: string[] | null;
  summarized_at: string | null;
};

type RegulationRow = {
  country: "대한민국";
  agency: "건강보험심사평가원";
  category: Category;
  summary: string;
  published_at: string | null;
  importance: Importance;
  source_url: string;
  title: string;
  department: string;
  ai_summary: string;
  ai_impact: string;
  ai_importance: Importance;
  summarized_at: string;
  is_relevant: true;
  exclusion_reason: null;
  affected_area: ["보험급여"];
};

type SavedResult = {
  title: string;
  sourceUrl: string;
  feedName: FeedName;
  category: Category;
  importance: Importance;
  aiMode: AiMode;
};

type FailedResult = {
  title: string;
  sourceUrl: string;
  error: string;
};

type WarningResult = {
  title: string;
  sourceUrl: string;
  warning: string;
};

/* =========================================================
 * OpenAI
 * ======================================================= */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* =========================================================
 * HIRA RSS 주소
 * ======================================================= */

const HIRA_FEEDS: HiraFeed[] = [
  {
    name: "행위",
    url: "https://www.hira.or.kr/cms/policy/03/01/01/01/act_notice.xml",
  },
  {
    name: "치료재료",
    url: "https://www.hira.or.kr/cms/policy/03/01/01/02/care_notice.xml",
  },
  {
    name: "약제",
    url: "https://www.hira.or.kr/cms/policy/03/01/01/03/druginfo_notice.xml",
  },
  {
    name: "의료급여",
    url: "https://www.hira.or.kr/cms/policy/03/01/01/04/pay_notice.xml",
  },
];

/* =========================================================
 * 설정
 * ======================================================= */

const FETCH_HEADERS: HeadersInit = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/126.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml," +
    "application/rss+xml,text/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
  "Cache-Control": "no-cache",
};

const RSS_TIMEOUT_MS = 20_000;
const DETAIL_TIMEOUT_MS = 20_000;

const DETAIL_TEXT_MAX_LENGTH = 20_000;
const AI_SOURCE_TEXT_MAX_LENGTH = 7_000;
const AI_INPUT_MAX_LENGTH = 9_000;

const AI_FIRST_MAX_OUTPUT_TOKENS = 3_000;
const AI_RETRY_MAX_OUTPUT_TOKENS = 5_000;

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

/* =========================================================
 * 분류 키워드
 * ======================================================= */

const MEDICINE_KEYWORDS = [
  "약제",
  "약가",
  "의약품",
  "의약품안전성",
  "생물학적제제",
  "주사제",
  "경구제",
  "항암제",
  "희귀의약품",
  "퇴장방지의약품",
  "성분명",
  "투여기준",
  "투약기준",
  "처방",
  "보험인정기준",
  "약제급여",
  "약제 급여",
  "약가파일",
  "상한금액표",
];

const DEVICE_KEYWORDS = [
  "치료재료",
  "의료기기",
  "체외진단",
  "진단기기",
  "의료용품",
  "상한금액",
  "치료재료 고시",
  "디지털치료기기",
  "디지털의료",
  "디지털 의료",
  "인공지능 의료",
  "AI 의료",
  "AI의료",
  "소프트웨어 의료기기",
  "혁신의료기술",
  "혁신 의료기술",
  "신의료기술",
  "신의료 기술",
  "로봇수술",
  "영상진단",
  "검사료",
  "병리검사",
  "수술료",
  "처치료",
  "재료대",
  "임시등재",
  "임시 등재",
];

/* =========================================================
 * 일반 유틸리티
 * ======================================================= */

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trim()}…`;
}

function removeCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&#x27;": "'",
    "&apos;": "'",
  };

  let decoded = value;

  for (const [entity, replacement] of Object.entries(
    namedEntities
  )) {
    decoded = decoded.replace(
      new RegExp(escapeRegExp(entity), "gi"),
      replacement
    );
  }

  decoded = decoded.replace(
    /&#(\d+);/g,
    (_match, decimalCode: string) => {
      const code = Number(decimalCode);

      if (!Number.isFinite(code)) {
        return "";
      }

      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    }
  );

  decoded = decoded.replace(
    /&#x([0-9a-f]+);/gi,
    (_match, hexadecimalCode: string) => {
      const code = Number.parseInt(hexadecimalCode, 16);

      if (!Number.isFinite(code)) {
        return "";
      }

      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    }
  );

  return decoded;
}

function stripHtml(value: string): string {
  const withoutUnwantedElements = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const withLineBreaks = withoutUnwantedElements
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/section>/gi, "\n")
    .replace(/<\/article>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<\/th>/gi, " ")
    .replace(/<\/h[1-6]>/gi, "\n");

  const withoutTags = withLineBreaks.replace(/<[^>]+>/g, " ");

  return normalizeWhitespace(
    decodeHtmlEntities(removeCdata(withoutTags))
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "알 수 없는 오류";
  }
}

/* =========================================================
 * 날짜 처리
 * ======================================================= */

function normalizePublishedAt(value: string): string | null {
  const cleaned = normalizeWhitespace(value);

  if (!cleaned) {
    return null;
  }

  const timestamp = Date.parse(cleaned);

  if (!Number.isNaN(timestamp)) {
    return new Date(timestamp).toISOString().slice(0, 10);
  }

  const koreanDateMatch = cleaned.match(
    /(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/
  );

  if (!koreanDateMatch) {
    return null;
  }

  const year = koreanDateMatch[1];
  const month = koreanDateMatch[2].padStart(2, "0");
  const day = koreanDateMatch[3].padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getTimestampForSort(value: string | null): number {
  if (!value) {
    return 0;
  }

  const timestamp = Date.parse(value);

  return Number.isNaN(timestamp) ? 0 : timestamp;
}

/* =========================================================
 * XML / RSS 처리
 * ======================================================= */

function getXmlTagValue(xml: string, tagName: string): string {
  const escapedTagName = escapeRegExp(tagName);

  const match = xml.match(
    new RegExp(
      `<${escapedTagName}(?:\\s[^>]*)?>([\\s\\S]*?)` +
        `<\\/${escapedTagName}>`,
      "i"
    )
  );

  if (!match?.[1]) {
    return "";
  }

  return normalizeWhitespace(
    decodeHtmlEntities(removeCdata(match[1]))
  );
}

function splitRssItems(xml: string): string[] {
  return (
    xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) ?? []
  );
}

function normalizeUrl(
  value: string,
  baseUrl: string
): string {
  const cleaned = decodeHtmlEntities(removeCdata(value))
    .replace(/&amp;/gi, "&")
    .trim();

  if (!cleaned) {
    return "";
  }

  try {
    const url = new URL(cleaned, baseUrl);

    url.hash = "";

    return url.toString();
  } catch {
    return cleaned;
  }
}

function parseRss(xml: string, feed: HiraFeed): RssItem[] {
  return splitRssItems(xml)
    .map((itemXml): RssItem | null => {
      const title = stripHtml(
        getXmlTagValue(itemXml, "title")
      );

      const rawDescription =
        getXmlTagValue(itemXml, "description") ||
        getXmlTagValue(itemXml, "content:encoded");

      const description = stripHtml(rawDescription);

      const rawLink =
        getXmlTagValue(itemXml, "link") ||
        getXmlTagValue(itemXml, "guid");

      const sourceUrl = normalizeUrl(rawLink, feed.url);

      const rawPublishedAt =
        getXmlTagValue(itemXml, "pubDate") ||
        getXmlTagValue(itemXml, "dc:date") ||
        getXmlTagValue(itemXml, "date");

      if (!title || !sourceUrl) {
        return null;
      }

      return {
        feedName: feed.name,
        title,
        description,
        sourceUrl,
        publishedAt: normalizePublishedAt(rawPublishedAt),
      };
    })
    .filter((item): item is RssItem => item !== null);
}

/* =========================================================
 * HTTP 요청
 * ======================================================= */

async function fetchText(
  url: string,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: FETCH_HEADERS,
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText}`
      );
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function collectFeed(feed: HiraFeed): Promise<RssItem[]> {
  try {
    const xml = await fetchText(
      feed.url,
      RSS_TIMEOUT_MS
    );

    const items = parseRss(xml, feed);

    console.log(
      `[HIRA] ${feed.name} RSS 수집 완료: ${items.length}건`
    );

    return items;
  } catch (error) {
    console.error(
      `[HIRA] ${feed.name} RSS 수집 실패`,
      error
    );

    return [];
  }
}

/* =========================================================
 * 상세페이지 본문 추출
 * ======================================================= */

function removeNavigationText(value: string): string {
  const removableLines = [
    /^홈$/,
    /^제도·정책$/,
    /^보험인정기준$/,
    /^인쇄$/,
    /^목록$/,
    /^이전글/,
    /^다음글/,
    /^첨부파일 다운로드$/,
    /^페이스북$/,
    /^트위터$/,
    /^카카오스토리$/,
    /^경로복사$/,
  ];

  const lines = value
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean)
    .filter((line) => {
      return !removableLines.some((pattern) =>
        pattern.test(line)
      );
    });

  return normalizeWhitespace(lines.join("\n"));
}

function scoreDetailCandidate(text: string): number {
  let score = Math.min(text.length, 20_000);

  const positiveKeywords = [
    "주요내용",
    "시행일",
    "개정",
    "급여기준",
    "상한금액",
    "수가",
    "보건복지부",
    "요양급여",
    "의료급여",
    "적용기준",
    "신설",
    "삭제",
    "변경",
  ];

  const negativeKeywords = [
    "로그인",
    "전체메뉴",
    "개인정보처리방침",
    "이용약관",
    "고객센터",
    "관련사이트",
  ];

  for (const keyword of positiveKeywords) {
    if (text.includes(keyword)) {
      score += 1_000;
    }
  }

  for (const keyword of negativeKeywords) {
    if (text.includes(keyword)) {
      score -= 800;
    }
  }

  return score;
}

function extractHtmlCandidates(html: string): string[] {
  const candidates: string[] = [];

  const patterns = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi,
    /<div\b[^>]+class=["'][^"']*(?:view|board|bbs|detail|content|cont)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<div\b[^>]+id=["'][^"']*(?:view|board|bbs|detail|content|cont)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<section\b[^>]+class=["'][^"']*(?:view|board|bbs|detail|content|cont)[^"']*["'][^>]*>([\s\S]*?)<\/section>/gi,
    /<td\b[^>]+class=["'][^"']*(?:view|board|bbs|detail|content|cont)[^"']*["'][^>]*>([\s\S]*?)<\/td>/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(html)) !== null) {
      if (match[1]) {
        candidates.push(match[1]);
      }

      if (candidates.length >= 50) {
        break;
      }
    }
  }

  const bodyMatch = html.match(
    /<body\b[^>]*>([\s\S]*?)<\/body>/i
  );

  if (bodyMatch?.[1]) {
    candidates.push(bodyMatch[1]);
  }

  return candidates;
}

function extractDetailText(html: string): string {
  const candidates = extractHtmlCandidates(html)
    .map((candidate) => stripHtml(candidate))
    .map((candidate) => removeNavigationText(candidate))
    .filter((candidate) => candidate.length >= 100)
    .map((candidate) => ({
      text: candidate,
      score: scoreDetailCandidate(candidate),
    }))
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return "";
  }

  return truncate(
    candidates[0].text,
    DETAIL_TEXT_MAX_LENGTH
  );
}

async function fetchDetailText(
  sourceUrl: string,
  fallbackDescription: string
): Promise<string> {
  try {
    const html = await fetchText(
      sourceUrl,
      DETAIL_TIMEOUT_MS
    );

    const detailText = extractDetailText(html);

    if (detailText.length >= 100) {
      return detailText;
    }

    console.warn(
      `[HIRA] 상세 본문이 짧아 RSS 설명 사용: ${sourceUrl}`
    );
  } catch (error) {
    console.warn(
      `[HIRA] 상세페이지 수집 실패: ${sourceUrl}`,
      error
    );
  }

  return fallbackDescription;
}

/* =========================================================
 * 중복 제거와 정렬
 * ======================================================= */

function uniqueItems(items: RssItem[]): RssItem[] {
  const itemMap = new Map<string, RssItem>();

  for (const item of items) {
    const existing = itemMap.get(item.sourceUrl);

    if (!existing) {
      itemMap.set(item.sourceUrl, item);
      continue;
    }

    if (
      item.description.length >
      existing.description.length
    ) {
      itemMap.set(item.sourceUrl, item);
    }
  }

  return [...itemMap.values()];
}

function sortByPublishedAt(items: RssItem[]): RssItem[] {
  return [...items].sort((a, b) => {
    return (
      getTimestampForSort(b.publishedAt) -
      getTimestampForSort(a.publishedAt)
    );
  });
}

/* =========================================================
 * 카테고리 분류
 * ======================================================= */

function countKeywordMatches(
  text: string,
  keywords: readonly string[]
): number {
  const normalizedText = text.toLowerCase();

  return keywords.reduce((count, keyword) => {
    return normalizedText.includes(keyword.toLowerCase())
      ? count + 1
      : count;
  }, 0);
}

function classifyCategory(
  feedName: FeedName,
  title: string,
  description: string,
  detailText: string
): Category {
  if (feedName === "약제") {
    return "의약품";
  }

  if (feedName === "치료재료") {
    return "의료기기";
  }

  const combinedText = [
    feedName,
    title,
    description,
    detailText.slice(0, 5_000),
  ].join("\n");

  const medicineScore = countKeywordMatches(
    combinedText,
    MEDICINE_KEYWORDS
  );

  const deviceScore = countKeywordMatches(
    combinedText,
    DEVICE_KEYWORDS
  );

  if (medicineScore > deviceScore) {
    return "의약품";
  }

  return "의료기기";
}

/* =========================================================
 * AI 입력 압축
 * ======================================================= */

function compressDetailText(value: string): string {
  const text = normalizeWhitespace(value);

  if (text.length <= AI_SOURCE_TEXT_MAX_LENGTH) {
    return text;
  }

  const headLength = 5_200;
  const tailLength =
    AI_SOURCE_TEXT_MAX_LENGTH - headLength;

  const head = text.slice(0, headLength);
  const tail = text.slice(-tailLength);

  return [
    head,
    "",
    "[중간의 반복적이거나 긴 내용은 생략됨]",
    "",
    tail,
  ].join("\n");
}

function buildAiInput(notice: HiraNotice): string {
  const sourceText = compressDetailText(
    notice.detailText ||
      notice.description ||
      notice.title
  );

  return truncate(
    [
      "기관: 건강보험심사평가원",
      `RSS 구분: ${notice.feedName}`,
      `서비스 분류: ${notice.category}`,
      `제목: ${notice.title}`,
      `게시일: ${notice.publishedAt ?? "확인되지 않음"}`,
      `원문 주소: ${notice.sourceUrl}`,
      "",
      "[분석할 원문]",
      sourceText,
    ].join("\n"),
    AI_INPUT_MAX_LENGTH
  );
}

/* =========================================================
 * AI 결과 검증
 * ======================================================= */

function normalizeImportance(
  value: unknown
): Importance | null {
  if (
    value === "높음" ||
    value === "중간" ||
    value === "낮음"
  ) {
    return value;
  }

  return null;
}

function validateAiResult(value: unknown): AiResult {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      "AI 결과가 올바른 객체 형식이 아닙니다."
    );
  }

  const result = value as Record<string, unknown>;

  const summary =
    typeof result.summary === "string"
      ? normalizeWhitespace(result.summary)
      : "";

  const impact =
    typeof result.impact === "string"
      ? normalizeWhitespace(result.impact)
      : "";

  const importance = normalizeImportance(
    result.importance
  );

  if (!summary) {
    throw new Error(
      "AI 결과에 summary가 없습니다."
    );
  }

  if (!impact) {
    throw new Error(
      "AI 결과에 impact가 없습니다."
    );
  }

  if (!importance) {
    throw new Error(
      `AI 중요도 값이 올바르지 않습니다: ${String(
        result.importance
      )}`
    );
  }

  return {
    summary: truncate(summary, 2_000),
    impact: truncate(impact, 2_000),
    importance,
    affected_area: ["보험급여"],
  };
}

/* =========================================================
 * OpenAI 응답 텍스트 추출
 * ======================================================= */

function extractResponseText(response: unknown): string {
  if (
    response === null ||
    typeof response !== "object"
  ) {
    return "";
  }

  const responseObject = response as Record<
    string,
    unknown
  >;

  if (
    typeof responseObject.output_text === "string" &&
    responseObject.output_text.trim()
  ) {
    return responseObject.output_text.trim();
  }

  if (!Array.isArray(responseObject.output)) {
    return "";
  }

  const collectedTexts: string[] = [];

  for (const outputItem of responseObject.output) {
    if (
      outputItem === null ||
      typeof outputItem !== "object"
    ) {
      continue;
    }

    const outputObject = outputItem as Record<
      string,
      unknown
    >;

    if (!Array.isArray(outputObject.content)) {
      continue;
    }

    for (const contentItem of outputObject.content) {
      if (
        contentItem === null ||
        typeof contentItem !== "object"
      ) {
        continue;
      }

      const contentObject = contentItem as Record<
        string,
        unknown
      >;

      if (
        typeof contentObject.text === "string" &&
        contentObject.text.trim()
      ) {
        collectedTexts.push(
          contentObject.text.trim()
        );
      }
    }
  }

  return collectedTexts.join("\n").trim();
}

function getResponseStatus(response: unknown): string {
  if (
    response !== null &&
    typeof response === "object" &&
    "status" in response
  ) {
    const status = (
      response as Record<string, unknown>
    ).status;

    return typeof status === "string"
      ? status
      : "unknown";
  }

  return "unknown";
}

function getIncompleteReason(
  response: unknown
): string {
  if (
    response === null ||
    typeof response !== "object"
  ) {
    return "unknown";
  }

  const responseObject = response as Record<
    string,
    unknown
  >;

  const details = responseObject.incomplete_details;

  if (
    details === null ||
    typeof details !== "object"
  ) {
    return "unknown";
  }

  const reason = (
    details as Record<string, unknown>
  ).reason;

  return typeof reason === "string"
    ? reason
    : "unknown";
}

function getOpenAiError(response: unknown): string {
  if (
    response === null ||
    typeof response !== "object"
  ) {
    return "";
  }

  const responseObject = response as Record<
    string,
    unknown
  >;

  const error = responseObject.error;

  if (
    error === null ||
    typeof error !== "object"
  ) {
    return "";
  }

  const message = (
    error as Record<string, unknown>
  ).message;

  return typeof message === "string"
    ? message
    : "";
}

function describeOpenAiResponse(
  response: unknown
): string {
  return [
    `status=${getResponseStatus(response)}`,
    `incompleteReason=${getIncompleteReason(
      response
    )}`,
    `error=${getOpenAiError(response) || "없음"}`,
  ].join(", ");
}

/* =========================================================
 * OpenAI 요청
 * ======================================================= */

async function requestAiAnalysis(
  notice: HiraNotice,
  maxOutputTokens: number
) {
  return openai.responses.create({
    model: "gpt-5-mini",
    store: false,

    reasoning: {
      effort: "low",
    },

    instructions: [
      "당신은 대한민국 헬스케어 규제 및 건강보험 전문가입니다.",
      "건강보험심사평가원의 보험인정기준, 고시, 수가파일 및 안내문을 기업 실무자 관점에서 분석하세요.",
      "",
      "분석 대상에는 다음이 포함될 수 있습니다.",
      "- 의료행위 수가와 상대가치점수",
      "- 급여, 비급여 및 선별급여",
      "- 신의료기술과 혁신의료기술",
      "- 디지털의료기술과 인공지능 의료기술",
      "- 치료재료 급여기준과 상한금액",
      "- 약제 급여기준, 약가 및 보험인정기준",
      "- 의료급여 수가와 적용기준",
      "",
      "summary 작성 규칙:",
      "- 핵심 내용을 한국어 2~3문장으로 작성합니다.",
      "- 무엇이 신설, 변경, 확대, 축소 또는 삭제됐는지 설명합니다.",
      "- 시행일이 원문에 있으면 반드시 포함합니다.",
      "- 제목을 그대로 되풀이하지 않습니다.",
      "- 원문에 없는 내용을 추측하지 않습니다.",
      "- 불필요한 배경 설명은 줄입니다.",
      "",
      "impact 작성 규칙:",
      "- 한국어 2~3문장으로 작성합니다.",
      "- 제약사, 의료기기 기업, 디지털헬스 기업, 병원 중 실제 영향을 받는 대상을 설명합니다.",
      "- 급여 등재, 비급여 운영, 수가, 약가, 청구, 전산 코드, 시장 진입 및 제품 도입 영향을 중심으로 설명합니다.",
      "- 직접 영향이 명확하지 않으면 직접 영향이 제한적이라고 작성합니다.",
      "",
      "importance 판단 규칙:",
      "- 높음: 수가, 급여 지위, 약가, 상한금액, 청구, 시장 진입 또는 매출에 직접적인 변화가 있는 경우",
      "- 중간: 실무 절차나 적용기준이 바뀌지만 즉각적인 재무 영향은 제한적인 경우",
      "- 낮음: 단순 안내, 정정, 파일 재게시 또는 행정적인 변경인 경우",
      "",
      "affected_area에는 반드시 보험급여 하나만 넣습니다.",
      "반드시 지정된 JSON 스키마에 맞는 결과만 반환하세요.",
    ].join("\n"),

    input: buildAiInput(notice),

    text: {
      format: {
        type: "json_schema",
        name: "hira_regulation_analysis",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: {
              type: "string",
              description:
                "핵심 변경 내용을 설명하는 한국어 요약",
            },
            impact: {
              type: "string",
              description:
                "기업 또는 의료기관에 미치는 영향",
            },
            importance: {
              type: "string",
              enum: ["높음", "중간", "낮음"],
            },
            affected_area: {
              type: "array",
              items: {
                type: "string",
                enum: ["보험급여"],
              },
              minItems: 1,
              maxItems: 1,
            },
          },
          required: [
            "summary",
            "impact",
            "importance",
            "affected_area",
          ],
        },
      },
    },

    max_output_tokens: maxOutputTokens,
  });
}

/* =========================================================
 * AI 실패 시 안전한 대체값
 * ======================================================= */

function guessFallbackImportance(
  notice: HiraNotice
): Importance {
  const text = [
    notice.title,
    notice.description,
    notice.detailText.slice(0, 3_000),
  ].join("\n");

  const highKeywords = [
    "수가 신설",
    "수가 삭제",
    "상한금액",
    "약가",
    "급여기준",
    "비급여",
    "선별급여",
    "시행",
    "청구",
    "코드 신설",
    "코드 삭제",
    "일부개정",
    "일부 개정",
  ];

  const lowKeywords = [
    "정정",
    "재게시",
    "파일 교체",
    "안내",
    "오류 수정",
  ];

  if (
    highKeywords.some((keyword) =>
      text.includes(keyword)
    )
  ) {
    return "높음";
  }

  if (
    lowKeywords.some((keyword) =>
      text.includes(keyword)
    )
  ) {
    return "낮음";
  }

  return "중간";
}

function createFallbackAiResult(
  notice: HiraNotice
): AiResult {
  const sourceText = normalizeWhitespace(
    notice.detailText || notice.description
  );

  const fallbackContent = sourceText
    ? truncate(sourceText, 700)
    : notice.title;

  const summary = [
    notice.title,
    fallbackContent &&
    fallbackContent !== notice.title
      ? fallbackContent
      : "",
  ]
    .filter(Boolean)
    .join(" — ");

  const target =
    notice.category === "의약품"
      ? "제약사와 의료기관"
      : "의료기기·디지털헬스 기업과 의료기관";

  return {
    summary: truncate(summary, 1_000),
    impact:
      `${target}는 원문에서 변경된 급여기준, 수가, ` +
      "청구 코드와 시행일을 확인해야 합니다. " +
      "AI 분석이 일시적으로 완료되지 않아 원문 확인이 필요합니다.",
    importance: guessFallbackImportance(notice),
    affected_area: ["보험급여"],
  };
}

/* =========================================================
 * AI 분석: 최대 2번 요청 후 대체값 사용
 * ======================================================= */

async function summarizeWithAi(
  notice: HiraNotice
): Promise<{
  result: AiResult;
  aiMode: "generated" | "fallback";
  warning: string | null;
}> {
  if (!process.env.OPENAI_API_KEY) {
    return {
      result: createFallbackAiResult(notice),
      aiMode: "fallback",
      warning:
        "OPENAI_API_KEY가 없어 대체 요약을 저장했습니다.",
    };
  }

  let firstError = "";

  try {
    const firstResponse = await requestAiAnalysis(
      notice,
      AI_FIRST_MAX_OUTPUT_TOKENS
    );

    const firstStatus =
      getResponseStatus(firstResponse);

    const firstText =
      extractResponseText(firstResponse);

    if (
      firstStatus !== "incomplete" &&
      firstStatus !== "failed" &&
      firstText
    ) {
      return {
        result: validateAiResult(
          JSON.parse(firstText)
        ),
        aiMode: "generated",
        warning: null,
      };
    }

    firstError =
      `첫 요청 미완료: ${describeOpenAiResponse(
        firstResponse
      )}`;

    console.warn(
      `[HIRA] AI 첫 요청 재시도: ${notice.title}`,
      firstError
    );
  } catch (error) {
    firstError =
      `첫 요청 오류: ${getErrorMessage(error)}`;

    console.warn(
      `[HIRA] AI 첫 요청 오류: ${notice.title}`,
      error
    );
  }

  try {
    const retryResponse = await requestAiAnalysis(
      notice,
      AI_RETRY_MAX_OUTPUT_TOKENS
    );

    const retryStatus =
      getResponseStatus(retryResponse);

    const retryText =
      extractResponseText(retryResponse);

    if (
      retryStatus === "failed" ||
      retryStatus === "incomplete"
    ) {
      throw new Error(
        describeOpenAiResponse(retryResponse)
      );
    }

    if (!retryText) {
      throw new Error(
        `빈 응답: ${describeOpenAiResponse(
          retryResponse
        )}`
      );
    }

    return {
      result: validateAiResult(
        JSON.parse(retryText)
      ),
      aiMode: "generated",
      warning: firstError || null,
    };
  } catch (retryError) {
    const retryErrorMessage =
      getErrorMessage(retryError);

    const warning = [
      firstError,
      `재시도 오류: ${retryErrorMessage}`,
      "대체 요약을 저장했습니다.",
    ]
      .filter(Boolean)
      .join(" / ");

    console.error(
      `[HIRA] AI 요청 최종 실패: ${notice.title}`,
      retryError
    );

    return {
      result: createFallbackAiResult(notice),
      aiMode: "fallback",
      warning,
    };
  }
}

/* =========================================================
 * 기존 AI 결과 재사용
 * ======================================================= */

function isReusableAiResult(
  existing: ExistingRegulation | undefined
): existing is ExistingRegulation {
  if (!existing) {
    return false;
  }

  return Boolean(
    existing.ai_summary?.trim() &&
      existing.ai_impact?.trim() &&
      normalizeImportance(
        existing.ai_importance
      ) &&
      existing.summarized_at
  );
}

function getReusableAiResult(
  existing: ExistingRegulation
): AiResult {
  const importance = normalizeImportance(
    existing.ai_importance
  );

  if (
    !existing.ai_summary ||
    !existing.ai_impact ||
    !importance
  ) {
    throw new Error(
      "재사용할 AI 결과가 올바르지 않습니다."
    );
  }

  return {
    summary: existing.ai_summary.trim(),
    impact: existing.ai_impact.trim(),
    importance,
    affected_area: ["보험급여"],
  };
}

/* =========================================================
 * URL 파라미터
 * ======================================================= */

function getLimit(request: Request): number {
  const requestUrl = new URL(request.url);

  const rawLimit = Number(
    requestUrl.searchParams.get("limit") ??
      DEFAULT_LIMIT
  );

  if (!Number.isFinite(rawLimit)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(
    Math.max(Math.floor(rawLimit), 1),
    MAX_LIMIT
  );
}

function shouldForceAi(request: Request): boolean {
  const requestUrl = new URL(request.url);
  const value =
    requestUrl.searchParams.get("force");

  return value === "1" || value === "true";
}

/* =========================================================
 * GET API
 * ======================================================= */

export async function GET(request: Request) {
  const startedAt = Date.now();

  const limit = getLimit(request);
  const forceAi = shouldForceAi(request);

  try {
    const supabase = await createClient();

    /* -----------------------------------------------
     * 1. RSS 수집
     * --------------------------------------------- */

    const feedResults = await Promise.all(
      HIRA_FEEDS.map((feed) =>
        collectFeed(feed)
      )
    );

    const allItems = sortByPublishedAt(
      uniqueItems(feedResults.flat())
    );

    const selectedItems = allItems.slice(0, limit);

    if (selectedItems.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          agency: "건강보험심사평가원",
          error:
            "HIRA RSS에서 수집된 게시물이 없습니다.",
          rssItemCount: 0,
          durationMs: Date.now() - startedAt,
        },
        {
          status: 502,
        }
      );
    }

    /* -----------------------------------------------
     * 2. 기존 DB 자료 조회
     * --------------------------------------------- */

    const sourceUrls = selectedItems.map(
      (item) => item.sourceUrl
    );

    const {
      data: existingRows,
      error: existingRowsError,
    } = await supabase
      .from("regulations")
      .select(
        [
          "source_url",
          "ai_summary",
          "ai_impact",
          "ai_importance",
          "affected_area",
          "summarized_at",
        ].join(",")
      )
      .in("source_url", sourceUrls);

    if (existingRowsError) {
      throw new Error(
        `기존 규제 조회 실패: ${existingRowsError.message}`
      );
    }

    const existingMap = new Map<
      string,
      ExistingRegulation
    >(
      (
        (existingRows ?? []) as ExistingRegulation[]
      ).map((row) => [row.source_url, row])
    );

    /* -----------------------------------------------
     * 3. 게시물 처리
     * --------------------------------------------- */

    const saved: SavedResult[] = [];
    const failed: FailedResult[] = [];
    const warnings: WarningResult[] = [];

    let aiGeneratedCount = 0;
    let aiReusedCount = 0;
    let aiFallbackCount = 0;

    /*
     * OpenAI 요청이 동시에 몰리지 않게 순차 처리한다.
     */
    for (const item of selectedItems) {
      try {
        const existing = existingMap.get(
          item.sourceUrl
        );

        let detailText =
          item.description || item.title;

        let category = classifyCategory(
          item.feedName,
          item.title,
          item.description,
          detailText
        );

        let aiResult: AiResult;
        let aiMode: AiMode;

        /* -----------------------------------------
         * 기존 AI 분석이 있으면 재사용
         * --------------------------------------- */

        if (
          !forceAi &&
          isReusableAiResult(existing)
        ) {
          aiResult =
            getReusableAiResult(existing);

          aiMode = "reused";
          aiReusedCount += 1;
        } else {
          /* ---------------------------------------
           * 상세페이지 본문 가져오기
           * ------------------------------------- */

          detailText = await fetchDetailText(
            item.sourceUrl,
            item.description
          );

          category = classifyCategory(
            item.feedName,
            item.title,
            item.description,
            detailText
          );

          /* ---------------------------------------
           * AI 분석
           * ------------------------------------- */

          const aiAnalysis =
            await summarizeWithAi({
              ...item,
              detailText,
              category,
            });

          aiResult = aiAnalysis.result;
          aiMode = aiAnalysis.aiMode;

          if (aiMode === "generated") {
            aiGeneratedCount += 1;
          } else {
            aiFallbackCount += 1;
          }

          if (aiAnalysis.warning) {
            warnings.push({
              title: item.title,
              sourceUrl: item.sourceUrl,
              warning: aiAnalysis.warning,
            });
          }
        }

        /* -----------------------------------------
         * Supabase 저장
         * --------------------------------------- */

        const now = new Date().toISOString();

        const summarizedAt =
          aiMode === "reused" &&
          existing?.summarized_at
            ? existing.summarized_at
            : now;

        const row: RegulationRow = {
          country: "대한민국",
          agency: "건강보험심사평가원",
          category,

          /*
           * 기존 화면이 summary / importance를
           * 사용하는 경우를 위해 AI 값을 같이 저장한다.
           */
          summary: aiResult.summary,
          importance: aiResult.importance,

          published_at: item.publishedAt,
          source_url: item.sourceUrl,
          title: item.title,
          department: `보험인정기준 > ${item.feedName}`,

          ai_summary: aiResult.summary,
          ai_impact: aiResult.impact,
          ai_importance: aiResult.importance,
          summarized_at: summarizedAt,

          affected_area: ["보험급여"],

          is_relevant: true,
          exclusion_reason: null,
        };

        const { error: upsertError } =
          await supabase
            .from("regulations")
            .upsert(row, {
              onConflict: "source_url",
            });

        if (upsertError) {
          throw new Error(
            `Supabase 저장 실패: ${upsertError.message}`
          );
        }

        saved.push({
          title: item.title,
          sourceUrl: item.sourceUrl,
          feedName: item.feedName,
          category,
          importance: aiResult.importance,
          aiMode,
        });

        console.log(
          `[HIRA] 저장 완료: ${item.title} (${aiMode})`
        );
      } catch (error) {
        const errorMessage =
          getErrorMessage(error);

        console.error(
          `[HIRA] 게시물 처리 실패: ${item.title}`,
          error
        );

        failed.push({
          title: item.title,
          sourceUrl: item.sourceUrl,
          error: errorMessage,
        });
      }
    }

    /* -----------------------------------------------
     * 4. 결과 반환
     * --------------------------------------------- */

    const ok = saved.length > 0;

    return NextResponse.json(
      {
        ok,
        agency: "건강보험심사평가원",
        scope: [
          "행위",
          "치료재료",
          "약제",
          "의료급여",
        ],
        requestedLimit: limit,
        forceAi,

        rssItemCount: allItems.length,
        selectedCount: selectedItems.length,

        savedCount: saved.length,
        failedCount: failed.length,
        warningCount: warnings.length,

        aiGeneratedCount,
        aiReusedCount,
        aiFallbackCount,

        durationMs: Date.now() - startedAt,

        saved,
        failed,
        warnings,
      },
      {
        status: ok ? 200 : 500,
      }
    );
  } catch (error) {
    const errorMessage =
      getErrorMessage(error);

    console.error(
      "[HIRA] 수집기 전체 실행 실패",
      error
    );

    return NextResponse.json(
      {
        ok: false,
        agency: "건강보험심사평가원",
        error: errorMessage,
        durationMs: Date.now() - startedAt,
      },
      {
        status: 500,
      }
    );
  }
}