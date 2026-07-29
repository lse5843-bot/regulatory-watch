import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Category = "신의료기술평가";

type AffectedArea =
  | "인허가"
  | "임상시험"
  | "보험급여";

type NecaSubcategory =
  | "신의료기술평가 보고서"
  | "신의료기술평가"
  | "혁신의료기술"
  | "평가유예신의료기술"
  | "통합운영";

type NecaPage = {
  url: string;
  subcategory: NecaSubcategory;
  limit: number;
};

type BasicNotice = {
  title: string;
  publishedAt: string | null;
  sourceUrl: string;
  subcategory: NecaSubcategory;
};

type NecaNotice = BasicNotice & {
  category: Category;
  department: string;
  detailText: string;
  affectedArea: AffectedArea[];
};

const NECA_PAGES: readonly NecaPage[] = [
  {
    url: "https://nhta.neca.re.kr/nhta/publication/nhtaU0601L.ecg",
    subcategory: "신의료기술평가 보고서",
    limit: 20,
  },
  {
    url: "https://nhta.neca.re.kr/nhta/application/nhtaU0509L.ecg",
    subcategory: "신의료기술평가",
    limit: 10,
  },
  {
    url: "https://nhta.neca.re.kr/nhta/application/nhtaU0510L.ecg",
    subcategory: "혁신의료기술",
    limit: 10,
  },
  {
    url: "https://nhta.neca.re.kr/nhta/application/nhtaU0505L.ecg",
    subcategory: "평가유예신의료기술",
    limit: 10,
  },
  {
    url: "https://nhta.neca.re.kr/nhta/application/nhtaU0508L.ecg",
    subcategory: "통합운영",
    limit: 10,
  },
] as const;

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/126.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9," +
    "image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
  Referer: "https://nhta.neca.re.kr/",
};

const EXCLUDED_TITLE_KEYWORDS = [
  "채용",
  "합격자",
  "입찰",
  "계약",
  "용역",
  "교육생 모집",
  "직원 모집",
  "개인정보",
  "시스템 점검",
  "서비스 중단",
] as const;

function normalize(value?: string | null): string {
  return (value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(
  source: string,
  keywords: readonly string[]
): boolean {
  const normalizedSource = normalize(source).toLowerCase();

  return keywords.some((keyword) =>
    normalizedSource.includes(keyword.toLowerCase())
  );
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
  value: string,
  currentPageUrl: string
): string | null {
  const text = normalize(value);

  if (
    !text ||
    text === "#" ||
    text.toLowerCase().startsWith("javascript:")
  ) {
    return null;
  }

  try {
    return new URL(text, currentPageUrl).toString();
  } catch {
    return null;
  }
}

function extractUrlFromOnclick(
  onclick: string,
  currentPageUrl: string
): string | null {
  const text = normalize(onclick);

  if (!text) {
    return null;
  }

  const absoluteOrRootMatch = text.match(
    /['"]((?:https?:\/\/|\/)[^'"]+\.ecg(?:\?[^'"]*)?)['"]/i
  );

  if (absoluteOrRootMatch?.[1]) {
    return createAbsoluteUrl(
      absoluteOrRootMatch[1],
      currentPageUrl
    );
  }

  const relativeMatch = text.match(
    /['"]([^'"]+\.ecg(?:\?[^'"]*)?)['"]/i
  );

  if (relativeMatch?.[1]) {
    return createAbsoluteUrl(
      relativeMatch[1],
      currentPageUrl
    );
  }

  return null;
}

function createFallbackSourceUrl(
  pageUrl: string,
  title: string,
  onclick: string
): string {
  const url = new URL(pageUrl);

  const identifierMatch = onclick.match(
    /['"]?(\d{2,})['"]?/g
  );

  if (identifierMatch?.length) {
    url.searchParams.set(
      "regulatory_watch_item",
      identifierMatch.join("-")
    );

    return url.toString();
  }

  const encodedTitle = Buffer.from(title)
    .toString("base64url")
    .slice(0, 100);

  url.searchParams.set(
    "regulatory_watch_title",
    encodedTitle
  );

  return url.toString();
}

function isPossibleNoticeTitle(
  title: string
): boolean {
  const normalizedTitle = normalize(title);

  if (normalizedTitle.length < 3) {
    return false;
  }

  if (
    includesAny(
      normalizedTitle,
      EXCLUDED_TITLE_KEYWORDS
    )
  ) {
    return false;
  }

  const navigationTexts = [
    "로그인",
    "회원가입",
    "사이트맵",
    "이전",
    "다음",
    "처음",
    "마지막",
    "목록",
    "검색",
    "상세보기",
    "전체메뉴",
    "바로가기",
    "홈",
  ];

  return !navigationTexts.includes(
    normalizedTitle
  );
}

function classifyAffectedArea(
  subcategory: NecaSubcategory,
  title: string,
  detailText: string
): AffectedArea[] {
  const text = `${title} ${detailText}`;
  const areas = new Set<AffectedArea>();

  areas.add("보험급여");

  if (
    includesAny(text, [
      "임상시험",
      "임상 시험",
      "임상연구",
      "임상 연구",
      "피험자",
      "시험기관",
      "IRB",
      "근거창출",
      "근거 창출",
      "임상적 유효성",
      "임상적 안전성",
    ])
  ) {
    areas.add("임상시험");
  }

  if (
    includesAny(text, [
      "품목허가",
      "허가사항",
      "허가 사항",
      "식품의약품안전처",
      "식약처",
      "인허가",
      "시장진입",
      "시장 진입",
    ])
  ) {
    areas.add("인허가");
  }

  if (
    subcategory === "혁신의료기술" ||
    subcategory ===
      "평가유예신의료기술" ||
    subcategory === "통합운영"
  ) {
    areas.add("인허가");
  }

  return Array.from(areas);
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

function parseListPage(
  html: string,
  page: NecaPage
): BasicNotice[] {
  const $ = cheerio.load(html);
  const results: BasicNotice[] = [];

  const addNotice = ({
    title,
    dateText,
    href,
    onclick,
  }: {
    title: string;
    dateText: string;
    href: string;
    onclick: string;
  }) => {
    const normalizedTitle = normalize(title);

    if (!isPossibleNoticeTitle(normalizedTitle)) {
      return;
    }

    const sourceUrl =
      createAbsoluteUrl(href, page.url) ??
      extractUrlFromOnclick(
        onclick,
        page.url
      ) ??
      createFallbackSourceUrl(
        page.url,
        normalizedTitle,
        onclick
      );

    results.push({
      title: normalizedTitle,
      publishedAt: normalizeDate(dateText),
      sourceUrl,
      subcategory: page.subcategory,
    });
  };

  $(
    [
      "table tbody tr",
      ".board_list tbody tr",
      ".bbs_list tbody tr",
      ".board-list tbody tr",
      ".bbs-list tbody tr",
    ].join(",")
  ).each((_, rowElement) => {
    const row = $(rowElement);
    const rowText = normalize(row.text());

    if (!rowText) {
      return;
    }

    const titleLink = row
      .find(
        [
          ".subject a",
          ".title a",
          ".tit a",
          "td a[href]",
          "td a[onclick]",
        ].join(",")
      )
      .filter((__, element) =>
        isPossibleNoticeTitle(
          normalize(
            $(element).attr("title") ||
              $(element).text()
          )
        )
      )
      .first();

    const title = normalize(
      titleLink.attr("title") ||
        titleLink.text() ||
        row
          .find(".subject, .title, .tit")
          .first()
          .text()
    );

    if (!title) {
      return;
    }

    const dateMatch = rowText.match(
      /20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}/
    );

    addNotice({
      title,
      dateText: dateMatch?.[0] ?? "",
      href: normalize(titleLink.attr("href")),
      onclick: normalize(
        titleLink.attr("onclick") ||
          row.attr("onclick")
      ),
    });
  });

  if (results.length === 0) {
    $(
      [
        ".board_list li",
        ".bbs_list li",
        ".list_type li",
        ".board-list li",
        ".bbs-list li",
        "ul.list li",
      ].join(",")
    ).each((_, itemElement) => {
      const item = $(itemElement);
      const itemText = normalize(item.text());

      const titleLink = item
        .find("a[href], a[onclick]")
        .filter((__, element) =>
          isPossibleNoticeTitle(
            normalize(
              $(element).attr("title") ||
                $(element).text()
            )
          )
        )
        .first();

      const title = normalize(
        titleLink.attr("title") ||
          titleLink.text()
      );

      if (!title) {
        return;
      }

      const dateMatch = itemText.match(
        /20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}/
      );

      addNotice({
        title,
        dateText: dateMatch?.[0] ?? "",
        href: normalize(
          titleLink.attr("href")
        ),
        onclick: normalize(
          titleLink.attr("onclick") ||
            item.attr("onclick")
        ),
      });
    });
  }

  if (results.length === 0) {
    $("a[href], a[onclick]").each(
      (_, element) => {
        const link = $(element);

        const title = normalize(
          link.attr("title") || link.text()
        );

        if (!isPossibleNoticeTitle(title)) {
          return;
        }

        const container = link.closest(
          "tr, li, article, div"
        );

        const containerText = normalize(
          container.text()
        );

        const dateMatch = containerText.match(
          /20\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}/
        );

        if (!dateMatch) {
          return;
        }

        addNotice({
          title,
          dateText: dateMatch[0],
          href: normalize(link.attr("href")),
          onclick: normalize(
            link.attr("onclick") ||
              container.attr("onclick")
          ),
        });
      }
    );
  }

  return Array.from(
    new Map(
      results.map((notice) => [
        notice.sourceUrl,
        notice,
      ])
    ).values()
  );
}

function extractDetailDate(
  $: cheerio.CheerioAPI
): string | null {
  const selectors = [
    ".date",
    ".regdate",
    ".write-date",
    ".view_date",
    ".board_date",
    "time",
    "th",
    "td",
    "span",
  ];

  for (const selector of selectors) {
    const elements = $(selector).toArray();

    for (const element of elements) {
      const text = normalize($(element).text());

      if (
        text.includes("등록일") ||
        text.includes("작성일") ||
        text.includes("게시일") ||
        text.includes("발행일") ||
        text.includes("평가일")
      ) {
        const date = normalizeDate(text);

        if (date) {
          return date;
        }
      }
    }
  }

  const bodyText = normalize($("body").text());

  return normalizeDate(bodyText);
}

async function fetchDetailPage(
  notice: BasicNotice
): Promise<{
  detailText: string;
  publishedAt: string | null;
}> {
  if (
    notice.sourceUrl.includes(
      "regulatory_watch_item="
    ) ||
    notice.sourceUrl.includes(
      "regulatory_watch_title="
    )
  ) {
    return {
      detailText: "",
      publishedAt: notice.publishedAt,
    };
  }

  try {
    const html = await fetchHtml(
      notice.sourceUrl
    );

    const $ = cheerio.load(html);

    const detailDate =
      notice.publishedAt ?? extractDetailDate($);

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
        ".file-list",
        ".file_list",
        ".btn-area",
        ".button-area",
      ].join(",")
    ).remove();

    const selectors = [
      ".board_view",
      ".board-view",
      ".bbs_view",
      ".bbs-view",
      ".view_cont",
      ".view-content",
      ".view_content",
      ".board_content",
      ".board-content",
      ".content_view",
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

    return {
      detailText: detailText.slice(0, 12000),
      publishedAt: detailDate,
    };
  } catch (error) {
    console.error(
      `[NECA] 상세 페이지 조회 실패: ${notice.sourceUrl}`,
      error
    );

    return {
      detailText: "",
      publishedAt: notice.publishedAt,
    };
  }
}

export async function GET() {
  try {
    const pageResults =
      await Promise.allSettled(
        NECA_PAGES.map(async (page) => {
          const html = await fetchHtml(page.url);

          const notices = parseListPage(
            html,
            page
          ).slice(0, page.limit);

          return {
            page,
            notices,
          };
        })
      );

    const basicNotices: BasicNotice[] = [];

    const pageStatus: Array<{
      subcategory: NecaSubcategory;
      url: string;
      count: number;
      success: boolean;
      error?: string;
    }> = [];

    pageResults.forEach(
      (result, index) => {
        const page = NECA_PAGES[index];

        if (result.status === "fulfilled") {
          basicNotices.push(
            ...result.value.notices
          );

          pageStatus.push({
            subcategory: page.subcategory,
            url: page.url,
            count:
              result.value.notices.length,
            success: true,
          });

          return;
        }

        pageStatus.push({
          subcategory: page.subcategory,
          url: page.url,
          count: 0,
          success: false,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : "알 수 없는 오류",
        });
      }
    );

    const uniqueNotices = Array.from(
      new Map(
        basicNotices.map((notice) => [
          notice.sourceUrl,
          notice,
        ])
      ).values()
    );

    if (uniqueNotices.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message:
            "NHTA 5개 페이지에서 게시글을 찾지 못했습니다.",
          pageStatus,
        },
        { status: 404 }
      );
    }

    const detailedNotices: NecaNotice[] =
      await Promise.all(
        uniqueNotices.map(
          async (notice) => {
            const detail =
              await fetchDetailPage(notice);

            return {
              ...notice,
              publishedAt:
                detail.publishedAt,
              category:
                "신의료기술평가",
              department:
                "신의료기술평가사업본부",
              detailText:
                detail.detailText,
              affectedArea:
                classifyAffectedArea(
                  notice.subcategory,
                  notice.title,
                  detail.detailText
                ),
            };
          }
        )
      );

    const supabase = await createClient();

    const sourceUrls = detailedNotices.map(
      (notice) => notice.sourceUrl
    );

    const {
      data: existingRows,
      error: existingError,
    } = await supabase
      .from("regulations")
      .select("source_url")
      .in("source_url", sourceUrls);

    if (existingError) {
      throw new Error(
        `기존 NECA 데이터 조회 실패: ${existingError.message}`
      );
    }

    const existingUrlSet = new Set(
      (existingRows ?? []).map(
        (row) => row.source_url
      )
    );

    const insertedCount =
      detailedNotices.filter(
        (notice) =>
          !existingUrlSet.has(
            notice.sourceUrl
          )
      ).length;

    const updatedCount =
      detailedNotices.length -
      insertedCount;

    const rows = detailedNotices.map(
      (notice) => ({
        country: "대한민국",
        agency: "한국보건의료연구원",
        category: "신의료기술평가",
        subcategory: notice.subcategory,
        title: notice.title,
        department: notice.department,
        published_at:
          notice.publishedAt,
        source_url: notice.sourceUrl,

        summary: notice.detailText
          ? notice.detailText.slice(0, 1000)
          : null,

        importance: "보통",
        affected_area:
          notice.affectedArea,
        is_relevant: true,
        exclusion_reason: null,
      })
    );

    const { data, error } = await supabase
      .from("regulations")
      .upsert(rows, {
        onConflict: "source_url",
        ignoreDuplicates: false,
      })
      .select(
        [
          "id",
          "title",
          "source_url",
          "category",
          "subcategory",
          "published_at",
          "affected_area",
        ].join(", ")
      );

    if (error) {
      throw new Error(
        `Supabase 저장 실패: ${error.message}`
      );
    }

    return NextResponse.json({
      success: true,
      agency: "한국보건의료연구원",
      category: "신의료기술평가",
      collectedCount:
        basicNotices.length,
      uniqueCount: uniqueNotices.length,
      processedCount:
        detailedNotices.length,
      insertedCount,
      updatedCount,
      pageStatus,
      results: data ?? [],
    });
  } catch (error) {
    console.error(
      "[NECA] 크롤링 실패",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          "NECA 신의료기술평가 페이지 크롤링 중 오류가 발생했습니다.",
        error:
          error instanceof Error
            ? error.message
            : "알 수 없는 오류",
      },
      { status: 500 }
    );
  }
}