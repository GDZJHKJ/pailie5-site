# 排列五 · 开奖数据分析与杀号排除

一个部署在 GitHub Pages 的纯静态网站：自动拉取**中国体育彩票排列5**（游戏编码 `350133`）历史开奖号码（官方接口优先，境外被 WAF 拦截时自动降级到数据一致的公开镜像），提供频率统计、遗漏统计、杀号排除方案与滑动窗口回测。

> ⚠️ **免责声明**：彩票开奖号码由随机设备产生、各期相互独立、**无法预测**。本站仅提供公开开奖信息的统计与回测工具，“杀号/排除”是基于历史频率的统计观察，**不改变中奖概率、不承诺任何中奖结果**。请理性购彩、量力而行，未成年人不得购彩。

---

## 功能

| 模块 | 说明 |
|---|---|
| 数据状态 | 显示来源、期数、最新期号/日期、同步时间 |
| 杀号方案 | 选定窗口 + 每位置杀号数 K，按频率最低生成 5 个位置（万千百十个）的杀号候选，可手动增删、保存方案 |
| 频率统计 | 各位置 0-9 在 30/50/100/300/500 期窗口内的次数与占比，附 χ² 均匀性检验（含 p 值） |
| 遗漏统计 | 各位置每个数字的当前遗漏、历史最大遗漏 |
| 回测验证 | 滑动窗口回测，杀号命中率 vs 随机基准 `K/10`，按位置拆分 |
| 历史开奖 | 全量翻页、按期号/号码搜索 |
| 导入/导出 | 支持手动导入 JSON（离线使用）、导出备份 |

## 数据来源

- **官方来源**：中国体彩网（国家体育总局体育彩票管理中心）<https://www.lottery.gov.cn/>
- **接口**：`https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry?gameNo=350133&provinceId=0&pageSize=100&isVerify=1&pageNo=1`
- 游戏：排列5 / `350133`
- 号码为**完整五位字符串，保留前导零**（如 `02917`）；按期号新→旧排序

## 目录结构

```
pailie5-site/
├─ index.html              # 页面
├─ style.css               # 样式（深色主题）
├─ app.js                  # 分析与交互逻辑（纯 vanilla，无依赖）
├─ .nojekyll               # 让 GitHub Pages 原样输出 data/*.json
├─ cloudflare-worker.js    # Cloudflare Worker 中继（实测出口 IP 被体彩 WAF 拦截，仅留档）
├─ supabase/
│  └─ edge-functions/
│     └─ p5-proxy/
│        └─ index.ts       # Supabase Edge Function 中继（实测同样被拦，仅留档）
├─ data/
│  └─ draws.json           # 种子数据（500 期，官方接口抓取）
├─ scripts/
│  └─ fetch_data.py        # 官方接口抓取脚本（标准库，原子写，支持 PROXY_URL）
└─ .github/workflows/
   ├─ update-draws.yml     # 21:25-22:00 每分钟轮询，官方优先 + 镜像兜底
   └─ probe-sources.yml    # 数据源可达性探测（排查用）
```

## 本地运行

无需构建，任意静态服务器即可：

```bash
cd pailie5-site
python3 -m http.server 8077
# 浏览器打开 http://localhost:8077
```

手动刷新数据（覆盖 `data/draws.json`）：

```bash
python3 scripts/fetch_data.py
```

## 部署到 GitHub Pages

1. 在 GitHub 新建仓库（例如 `pailie5-site`）。
2. 推送本项目：
   ```bash
   cd pailie5-site
   git init && git add . && git commit -m "init: 排列五分析站"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/pailie5-site.git
   git push -u origin main
   ```
3. 仓库 **Settings → Pages**：Source 选 `Deploy from a branch`，分支 `main`、目录 `/ (root)`，保存。
4. 等待 1~2 分钟，访问 `https://<你的用户名>.github.io/pailie5-site/`。

## 自动更新开奖数据

`.github/workflows/update-draws.yml` 每天北京时间 **21:25-22:00 每分钟轮询**体彩官方接口，开奖后第一时间抓取并提交更新。

### 数据链路：官方优先，被拦时自动降级镜像

体彩官方接口 `webapi.sporttery.cn` 部署在腾讯 EdgeOne CDN 上，会对**境外数据中心 IP** 返回 `HTTP 567`（WAF 拦截页）。实测结论（2026-11-16 由 Actions 实机探测）：

| 数据源 | GitHub Actions（Azure） | 说明 |
|---|---|---|
| `webapi.sporttery.cn` 官方接口 | ❌ 567 | WAF 拦截境外云 IP，DNS 正常但被拒 |
| `pdf.sporttery.cn` 官方公告 PDF | ❌ 567 | 同上 |
| Cloudflare Worker 中继 | ❌ 567 | Worker 出口 IP 同样被拦 |
| Supabase Edge Function 中继 | ❌ 502/567 | 边缘函数出口 IP 同样被拦 |
| 公共 CORS 代理（allorigins / codetabs / jina） | ❌ 500 / 522 / 403 | 均无法穿透 |
| **`kaijiang.500.com` 静态 XML** | ✅ 200 | 境外可直连，数据与官方逐条一致 |

因此工作流按 **官方 → 镜像** 顺序取数：

1. **官方优先**：`scripts/fetch_data.py` 直连官方接口（设了 `PROXY_URL` 则走中继），拿到即用，`meta.source` 标为官方。
2. **降级镜像**：官方被拦（567 / 超时 / 中继 502）时，`scripts/fetch_mirror.py` 从
   `https://kaijiang.500.com/static/info/kaijiang/xml/plw/list.xml` 取数。
3. **写入前强校验**：镜像记录必须与本地已有官方数据做**重叠期逐条比对**（期号、五位号码、开奖日期），
   不一致条数 > 0 或重叠样本 < 50 期就**拒绝写入**，宁可停在旧数据也不写错数据。
   当前 500 期重叠样本的校验结果为 **0 条不一致**，且镜像覆盖至 `04001` 期（7778 期历史）。
4. 写入成功后才 `git commit` + `git push`，触发 Pages 重新部署。

> 镜像只是取数通道，数据本身仍是官方开奖结果；每次镜像写入都会在 `meta.verification` 里留下
> 校验快照（重叠期数、不一致条数）。若你有国内服务器 / 可用的中继，把它设为仓库 Secret
> `PROXY_URL`（形如 `https://你的中继/fetch`，接受 `?gameNo=&pageSize=&pageNo=` 参数），
> 官方通道即可恢复，镜像只作为兜底。

### 手动触发

仓库 **Actions** → `Update P5 Draws` → **Run workflow**，可填 `rounds`（轮询次数，默认 1）：

- `rounds=1`：只抓一次，约 1 分钟出结果，用于验证链路
- `rounds=36`：等同定时任务的 21:25-22:00 全程轮询

另有一个 `Probe Data Sources` 工作流，一次性探测各数据源在 Actions 环境下的可达性（排查用，可随时手动跑）。

### 工作流逻辑

1. 北京时间 21:25 启动（cron `25 13 * * *`，UTC），共 36 轮、每轮间隔 60 秒，覆盖 21:25-22:00
2. 每轮先 `fetch_data.py --check`（官方，拉 1 条比期号，不写文件）
3. 官方有新数据 → 全量拉 500 期 → 校验 → 提交推送 → 退出
4. 官方不可用 → `fetch_mirror.py --check`（镜像 + 重叠校验）；有新数据则全量写入 → 提交推送 → 退出
5. 双方都无新数据 → 等 60 秒 → 下一轮；22:00 仍未出新号则正常结束（保留旧数据）

## 杀号排除逻辑

**频率法**（本站默认）：对万/千/百/十/个每个位置独立处理，在选定窗口内统计 0-9 出现次数，取**出现最少**的 K 个作为该位置杀号候选。

**回测**：将数据按时间排序，对每个测试期 t，用其前 W 期统计杀 K 个最低频数字，看 t 期实际开出数字是否落在被杀集合；命中率与随机排除 K 个的理论基准 `K×10%` 对比。

**重要结论**：排列五每位为 0-9 独立等概率随机，历史频率不影响下一期分布。本站 500 期样本内回测显示杀号命中率与随机基准差值在 ±2 个百分点内（与随机不可区分），**不能提高中奖概率**，仅供统计学习与娱乐。

## 导入 JSON 格式

网页“导入 JSON”接受如下结构（`draws` 数组，每条 `period` / `date` / `number` 五位字符串）：

```json
{
  "draws": [
    { "period": "26305", "date": "2026-11-15", "number": "26081" }
  ]
}
```

导入仅在当前浏览会话有效；要永久生效请更新 `data/draws.json` 或等 Actions 自动同步。

## 技术栈

纯 HTML / CSS / JavaScript，零依赖、零构建，适合 GitHub Pages 静态托管。χ² p 值由内置不完全伽马函数（Numerical Recipes 算法移植）计算，断网可用。

## 许可与署名

数据版权归中国体育彩票管理中心所有，本站仅作公开信息转述与统计展示。代码可自由使用。
