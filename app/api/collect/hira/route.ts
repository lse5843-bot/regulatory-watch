import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  summarized_at: string | null;
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

const STRONG_MEDICINE_KEYWORDS = [
  "약제",
  "약가",
  "의약품",
  "의약품명",
  "성분명",
  "성분코드",
  "제품코드",
  "약제급여",
  "약제 급여",
  "약가파일",
  "약가 파일",
  "투여기준",
  "투약기준",
  "주사제",
  "경구제",
  "항암제",
  "희귀의약품",
  "퇴장방지의약품",
  "생물학적제제",
  "약제 상한금액",
  "약제 상한 금액",
];

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
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trim()}…`;
}

function removeCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(value: string): string {
  const entities: Record<string, string> = {
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

  for (const [entity, replacement] of Object.entries(entities)) {
    decoded = decoded.replace(
      new RegExp(escapeRegExp(entity), "gi"),
      replacement
    );
  }

  decoded = decoded.replace(/&#(\d+);/g, (_match, code: string) => {
    try {
      return String.fromCodePoint(Number(code));
    } catch {
      return "";
    }
  });

  decoded = decoded.replace(
    /&#x([0-9a-f]+);/gi,
    (_match, code: string) => {
      try {
        return String.fromCodePoint(Number.parseInt(code, 16));
      } catch {
        return "";
      }
    }
  );

  return decoded;
}

function stripHtml(value: string): string {
  const cleaned = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/section>/gi, "\n")
    .replace(/<\/article>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<\/th>/gi, " ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return normalizeWhitespace(
    decodeHtmlEntities(removeCdata(cleaned))
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return "알 수 없는 오류";
  }
}

function normalizePublishedAt(value: string): string | null {
  const cleaned = normalizeWhitespace(value);
  if (!cleaned) return null;

  const timestamp = Date.parse(cleaned);

  if (!Number.isNaN(timestamp)) {
    return new Date(timestamp).toISOString().slice(0, 10);
  }

  const match = cleaned.match(
    /(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/
  );

  if (!match) return null;

  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function getXmlTagValue(xml: string, tagName: string): string {
  const match = xml.match(
    new RegExp(
      `<${escapeRegExp(tagName)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapeRegExp(
        tagName
      )}>`,
      "i"
    )
  );

  return match?.[1]
    ? normalizeWhitespace(
        decodeHtmlEntities(removeCdata(match[1]))
      )
    : "";
}

function normalizeUrl(value: string, baseUrl: string): string {
  const cleaned = decodeHtmlEntities(removeCdata(value))
    .replace(/&amp;/gi, "&")
    .trim();

  if (!cleaned) return "";

  try {
    const url = new URL(cleaned, baseUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return cleaned;
  }
}

function parseRss(xml: string, feed: HiraFeed): RssItem[] {
  const itemXmlList =
    xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) ?? [];

  return itemXmlList
    .map((itemXml): RssItem | null => {
      const title = stripHtml(
        getXmlTagValue(itemXml, "title")
      );

      const description = stripHtml(
        getXmlTagValue(itemXml, "description") ||
          getXmlTagValue(itemXml, "content:encoded")
      );

      const sourceUrl = normalizeUrl(
        getXmlTagValue(itemXml, "link") ||
          getXmlTagValue(itemXml, "guid"),
        feed.url
      );

      const publishedAt = normalizePublishedAt(
        getXmlTagValue(itemXml, "pubDate") ||
          getXmlTagValue(itemXml, "dc:date") ||
          getXmlTagValue(itemXml, "date")
      );

      if (!title || !sourceUrl) return null;

      return {
        feedName: feed.name,
        title,
        description,
        sourceUrl,
        publishedAt,
      };
    })
    .filter((item): item is RssItem => item !== null);
}

async function fetchText(
  url: string,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
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
    const xml = await fetchText(feed.url, RSS_TIMEOUT_MS);
    const items = parseRss(xml, feed);

    console.log(
      `[HIRA] ${feed.name} RSS 수집 완료: ${items.length}건`
    );

    return items;
  } catch (error) {
    console.error(`[HIRA] ${feed.name} RSS 수집 실패`, error);
    return [];
  }
}

function extractDetailText(html: string): string {
  const candidates: string[] = [];

  const patterns = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi,
    /<div\b[^>]+class=["'][^"']*(?:view|board|bbs|detail|content|cont)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<div\b[^>]+id=["'][^"']*(?:view|board|bbs|detail|content|cont)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(html)) !== null) {
      if (match[1]) candidates.push(stripHtml(match[1]));
      if (candidates.length >= 50) break;
    }
  }

  const body = html.match(
    /<body\b[^>]*>([\s\S]*?)<\/body>/i
  )?.[1];

  if (body) candidates.push(stripHtml(body));

  const best = candidates
    .filter((text) => text.length >= 100)
    .sort((a, b) => b.length - a.length)[0];

  return best
    ? truncate(best, DETAIL_TEXT_MAX_LENGTH)
    : "";
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

    if (detailText.length >= 100) return detailText;
  } catch (error) {
    console.warn(
      `[HIRA] 상세페이지 수집 실패: ${sourceUrl}`,
      error
    );
  }

  return fallbackDescription;
}

function uniqueItems(items: RssItem[]): RssItem[] {
  const map = new Map<string, RssItem>();

  for (const item of items) {
    const existing = map.get(item.sourceUrl);

    if (
      !existing ||
      item.description.length > existing.description.length
    ) {
      map.set(item.sourceUrl, item);
    }
  }

  return [...map.values()];
}

function classifyCategory(
  feedName: FeedName,
  title: string,
  description: string,
  detailText: string
): Category {
  if (feedName === "약제") return "의약품";
  if (feedName === "치료재료") return "의료기기";

  const normalizedTitle = title.toLowerCase();

  const titleMedicineMatches =
    STRONG_MEDICINE_KEYWORDS.filter((keyword) =>
      normalizedTitle.includes(keyword.toLowerCase())
    ).length;

  if (titleMedicineMatches >= 1) return "의약품";

  const bodyText = `${description}\n${detailText.slice(
    0,
    5_000
  )}`.toLowerCase();

  const bodyMedicineMatches =
    STRONG_MEDICINE_KEYWORDS.filter((keyword) =>
      bodyText.includes(keyword.toLowerCase())
    ).length;

  return bodyMedicineMatches >= 2
    ? "의약품"
    : "의료기기";
}

function compressDetailText(value: string): string {
  const text = normalizeWhitespace(value);

  if (text.length <= AI_SOURCE_TEXT_MAX_LENGTH) {
    return text;
  }

  return [
    text.slice(0, 5_200),
    "",
    "[중간 내용 생략]",
    "",
    text.slice(-1_800),
  ].join("\n");
}

function buildAiInput(notice: HiraNotice): string {
  return truncate(
    [
      "기관: 건강보험심사평가원",
      `RSS 구분: ${notice.feedName}`,
      `분류: ${notice.category}`,
      `제목: ${notice.title}`,
      `게시일: ${notice.publishedAt ?? "확인되지 않음"}`,
      `원문 주소: ${notice.sourceUrl}`,
      "",
      "[원문]",
      compressDetailText(
        notice.detailText ||
          notice.description ||
          notice.title
      ),
    ].join("\n"),
    AI_INPUT_MAX_LENGTH
  );
}

function normalizeImportance(
  value: unknown
): Importance | null {
  return value === "높음" ||
    value === "중간" ||
    value === "낮음"
    ? value
    : null;
}

function validateAiResult(value: unknown): AiResult {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("AI 결과 형식이 올바르지 않습니다.");
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

  if (!summary || !impact || !importance) {
    throw new Error("AI 결과 필수값이 누락되었습니다.");
  }

  return {
    summary,
    impact,
    importance,
    affected_area: ["보험급여"],
  };
}

function extractResponseText(response: unknown): string {
  if (!response || typeof response !== "object") return "";

  const object = response as Record<string, unknown>;

  if (typeof object.output_text === "string") {
    return object.output_text.trim();
  }

  if (!Array.isArray(object.output)) return "";

  const texts: string[] = [];

  for (const item of object.output) {
    if (!item || typeof item !== "object") continue;

    const content = (item as Record<string, unknown>).content;

    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (!part || typeof part !== "object") continue;

      const text = (part as Record<string, unknown>).text;

      if (typeof text === "string" && text.trim()) {
        texts.push(text.trim());
      }
    }
  }

  return texts.join("\n");
}

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
      "당신은 대한민국 건강보험 규제 전문가입니다.",
      "원문을 기업 및 의료기관 실무 관점에서 분석하세요.",
      "summary는 핵심 변경사항을 한국어 2~3문장으로 작성하세요.",
      "impact는 청구, 수가, 급여, 약가, 시장 진입 영향을 한국어 2~3문장으로 작성하세요.",
      "importance는 높음, 중간, 낮음 중 하나만 선택하세요.",
      "affected_area는 반드시 보험급여 하나만 반환하세요.",
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
            summary: { type: "string" },
            impact: { type: "string" },
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

function createFallbackAiResult(
  notice: HiraNotice
): AiResult {
  return {
    summary: truncate(
      notice.detailText ||
        notice.description ||
        notice.title,
      900
    ),
    impact:
      "관련 기업과 의료기관은 변경된 급여기준, 수가, 청구 코드 및 시행일을 원문에서 확인해야 합니다.",
    importance: "중간",
    affected_area: ["보험급여"],
  };
}

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
      warning: "OPENAI_API_KEY가 없습니다.",
    };
  }

  for (const maxTokens of [
    AI_FIRST_MAX_OUTPUT_TOKENS,
    AI_RETRY_MAX_OUTPUT_TOKENS,
  ]) {
    try {
      const response = await requestAiAnalysis(
        notice,
        maxTokens
      );

      const text = extractResponseText(response);

      if (text) {
        return {
          result: validateAiResult(JSON.parse(text)),
          aiMode: "generated",
          warning: null,
        };
      }
    } catch (error) {
      console.warn(
        `[HIRA] AI 요청 재시도: ${notice.title}`,
        error
      );
    }
  }

  return {
    result: createFallbackAiResult(notice),
    aiMode: "fallback",
    warning:
      "OpenAI 분석 실패로 대체 요약을 저장했습니다.",
  };
}

function isReusableAiResult(
  existing: ExistingRegulation | undefined
): existing is ExistingRegulation {
  return Boolean(
    existing?.ai_summary?.trim() &&
      existing?.ai_impact?.trim() &&
      normalizeImportance(existing.ai_importance) &&
      existing?.summarized_at
  );
}

function getLimit(request: Request): number {
  const raw = Number(
    new URL(request.url).searchParams.get("limit") ??
      DEFAULT_LIMIT
  );

  if (!Number.isFinite(raw)) return DEFAULT_LIMIT;

  return Math.min(
    Math.max(Math.floor(raw), 1),
    MAX_LIMIT
  );
}

function shouldForceAi(request: Request): boolean {
  const value = new URL(
    request.url
  ).searchParams.get("force");

  return value === "1" || value === "true";
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const limit = getLimit(request);
  const forceAi = shouldForceAi(request);

  try {
    const supabase = await createClient();

    const allItems = uniqueItems(
      (
        await Promise.all(
          HIRA_FEEDS.map((feed) => collectFeed(feed))
        )
      ).flat()
    ).sort(
      (a, b) =>
        Date.parse(b.publishedAt ?? "") -
        Date.parse(a.publishedAt ?? "")
    );

    const selectedItems = allItems.slice(0, limit);

    const sourceUrls = selectedItems.map(
      (item) => item.sourceUrl
    );

    const { data, error } = await supabase
      .from("regulations")
      .select(
        "source_url,ai_summary,ai_impact,ai_importance,summarized_at"
      )
      .in("source_url", sourceUrls);

    if (error) {
      throw new Error(
        `기존 규제 조회 실패: ${error.message}`
      );
    }

    const existingMap = new Map(
      ((data ?? []) as ExistingRegulation[]).map(
        (row) => [row.source_url, row]
      )
    );

    const saved = [];
    const failed = [];
    const warnings = [];

    let aiGeneratedCount = 0;
    let aiReusedCount = 0;
    let aiFallbackCount = 0;

    for (const item of selectedItems) {
      try {
        const existing = existingMap.get(
          item.sourceUrl
        );

        const detailText = await fetchDetailText(
          item.sourceUrl,
          item.description
        );

        const category = classifyCategory(
          item.feedName,
          item.title,
          item.description,
          detailText
        );

        let aiResult: AiResult;
        let aiMode: AiMode;

        if (
          !forceAi &&
          isReusableAiResult(existing)
        ) {
          aiResult = {
            summary: existing.ai_summary!,
            impact: existing.ai_impact!,
            importance: normalizeImportance(
              existing.ai_importance
            )!,
            affected_area: ["보험급여"],
          };

          aiMode = "reused";
          aiReusedCount++;
        } else {
          const ai = await summarizeWithAi({
            ...item,
            detailText,
            category,
          });

          aiResult = ai.result;
          aiMode = ai.aiMode;

          if (aiMode === "generated") {
            aiGeneratedCount++;
          } else {
            aiFallbackCount++;
          }

          if (ai.warning) {
            warnings.push({
              title: item.title,
              warning: ai.warning,
            });
          }
        }

        const summarizedAt =
          aiMode === "reused" &&
          existing?.summarized_at
            ? existing.summarized_at
            : new Date().toISOString();

        const { error: upsertError } = await supabase
          .from("regulations")
          .upsert(
            {
              country: "대한민국",
              agency: "건강보험심사평가원",
              category,
              subcategory: item.feedName,
              summary: aiResult.summary,
              published_at: item.publishedAt,
              importance: aiResult.importance,
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
            },
            {
              onConflict: "source_url",
            }
          );

        if (upsertError) {
          throw new Error(
            `Supabase 저장 실패: ${upsertError.message}`
          );
        }

        saved.push({
          title: item.title,
          feedName: item.feedName,
          category,
          subcategory: item.feedName,
          importance: aiResult.importance,
          aiMode,
        });
      } catch (error) {
        failed.push({
          title: item.title,
          sourceUrl: item.sourceUrl,
          error: getErrorMessage(error),
        });
      }
    }

    return NextResponse.json(
      {
        ok: saved.length > 0,
        agency: "건강보험심사평가원",
        scope: ["행위", "치료재료", "약제", "의료급여"],
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
        status: saved.length > 0 ? 200 : 500,
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        agency: "건강보험심사평가원",
        error: getErrorMessage(error),
        durationMs: Date.now() - startedAt,
      },
      {
        status: 500,
      }
    );
  }
}