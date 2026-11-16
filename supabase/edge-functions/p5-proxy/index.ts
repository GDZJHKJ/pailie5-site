/**
 * Supabase Edge Function — 排列五开奖数据中继
 *
 * 作用：GitHub Actions 的 Azure 服务器 IP 被体彩接口 WAF 拦截（HTTP 567），
 * Cloudflare Worker 的 IP 同样被拦截。Supabase Edge Functions 运行在
 * Deno Deploy 全球边缘网络，IP 段不同，可正常访问体彩接口。
 *
 * 部署步骤见 README.md「Supabase Edge Function 部署」章节。
 * 部署后将函数 URL 设为 GitHub Actions Secret: PROXY_URL
 *
 * 调用方式（透传所有 query params 到体彩官方接口）：
 *   GET https://[project-ref].supabase.co/functions/v1/p5-proxy?gameNo=350133&provinceId=0&pageSize=100&isVerify=1&pageNo=1
 */

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  // 健康检查：无 query params 时返回状态（避免拦截带参数的 API 请求）
  if (!url.search) {
    return new Response(
      JSON.stringify({ status: "ok", service: "pailie5-proxy", ts: Date.now() }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }

  // 转发到体彩官方接口（透传所有 query params）
  const apiBase = "https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry";
  const fullUrl = apiBase + url.search;

  try {
    const resp = await fetch(fullUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": "https://www.lottery.gov.cn/",
      },
    });

    const data = await resp.text();

    // 体彩 WAF 拦截时会返回 HTML 验证页面（非 JSON）
    const contentType = resp.headers.get("content-type") || "";
    if (contentType.includes("text/html") || resp.status === 567) {
      return new Response(
        JSON.stringify({
          error: "lottery_api_blocked",
          status: resp.status,
          message: "体彩接口返回 WAF 拦截页面",
        }),
        {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }

    return new Response(data, {
      status: resp.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 502,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  }
});
