/**
 * Cloudflare Worker — 排列五开奖数据中继
 *
 * 作用：GitHub Actions 的 Azure 服务器 IP 被体彩接口 WAF 拦截（HTTP 567），
 * 本 Worker 从 Cloudflare 边缘节点转发请求，绕过 IP 封锁。
 *
 * 部署步骤见 README.md「Cloudflare Worker 部署」章节。
 * 部署后将 Worker URL 设为 GitHub Actions Secret: PROXY_URL
 */
export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 仅 /health 返回健康状态；其他所有请求（含带 query params 的 /）一律转发
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'pailie5-proxy' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // 转发到体彩官方接口（透传所有 query params）
    const apiBase = 'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry';
    const fullUrl = apiBase + url.search;

    try {
      const resp = await fetch(fullUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Referer': 'https://www.lottery.gov.cn/',
        },
      });

      const data = await resp.text();
      return new Response(data, {
        status: resp.status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache',
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  },
};
