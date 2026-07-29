import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { createClient } from "@/utils/supabase/server";

type MfdsNotice = {
  title: string;
  department: string;
  publishedAt: string;
  sourceUrl: string;
};

export async function GET() {
  try {
    const baseUrl = "https://www.mfds.go.kr";
    const listUrl = `${baseUrl}/brd/m_76/list.do`;

    // 1. 식약처 공고 페이지 가져오기
    const response = await fetch(listUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`식약처 요청 실패: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // 2. 공고 정보 추출
    const notices: MfdsNotice[] = [];

    $("a[href*='view.do']").each((_, element) => {
      const link = $(element);
      const href = link.attr("href");
      const title = link.text().replace(/\s+/g, " ").trim();

      if (!href || !title) return;
      if (!href.includes("seq=")) return;

      const container = link.closest("li");

      if (container.length === 0) return;

      const containerText = container.text().replace(/\s+/g, " ").trim();

      if (!containerText.includes("담당부서")) return;

      const departmentMatch = containerText.match(
        /담당부서\s*\|\s*(.+?)(?=\s*조회수\s*\|)/
      );

      const dateMatch = containerText.match(
        /(?:20\d{2}|'\d{2})[.-]\d{1,2}[.-]\d{1,2}/
      );

      const sourceUrl = new URL(href, listUrl).toString();

      notices.push({
        title,
        department: departmentMatch?.[1]?.trim() ?? "",
        publishedAt: dateMatch?.[0] ?? "",
        sourceUrl,
      });
    });

    // 같은 URL이 여러 번 추출된 경우 제거
    const uniqueNotices = Array.from(
      new Map(notices.map((notice) => [notice.sourceUrl, notice])).values()
    ).slice(0, 5);

    if (uniqueNotices.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: "식약처 공고를 찾지 못했습니다.",
        },
        { status: 404 }
      );
    }

    // 3. Supabase 저장용 데이터로 변환
    const rows = uniqueNotices.map((notice) => ({
      country: "대한민국",
      agency: "식품의약품안전처",
      category: "식약처 공고",
      title: notice.title,
      department: notice.department,
      published_at: notice.publishedAt || null,
      source_url: notice.sourceUrl,
    }));

    // 4. Supabase 연결
    const supabase = await createClient();

    // 5. source_url이 같으면 중복 저장하지 않기
    const { data, error } = await supabase
      .from("regulations")
      .upsert(rows, {
        onConflict: "source_url",
        ignoreDuplicates: true,
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

    const insertedCount = data?.length ?? 0;

    return NextResponse.json({
      success: true,
      collectedCount: uniqueNotices.length,
      insertedCount,
      skippedCount: uniqueNotices.length - insertedCount,
      message:
        insertedCount > 0
          ? `${insertedCount}개의 새 공고를 저장했습니다.`
          : "새로운 공고가 없습니다. 기존 데이터는 중복 저장하지 않았습니다.",
      notices: uniqueNotices,
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