# 排列五 · 开奖数据分析与杀号排除

一个部署在 GitHub Pages 的纯静态网站：自动从**中国体育彩票官方公开接口**拉取排列五（排列5，游戏编码 `350133`）历史开奖号码，提供频率统计、遗漏统计、杀号排除方案与滑动窗口回测。

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
├─ cloudflare-worker.js    # Cloudflare Worker 中继（备用，IP 被体彩 WAF 拦截）
├─ supabase/
│  └─ edge-functions/
│     └─ p5-proxy/
│        └─ index.ts       # Supabase Edge Function 中继（推荐方案）
├─ data/
│  └─ draws.json           # 种子数据（500 期，官方接口抓取）
├─ scripts/
│  └─ fetch_data.py        # 官方接口抓取脚本（标准库，原子写，支持 PROXY_URL）
└─ .github/workflows/
   └─ update-draws.yml     # 21:25-22:00 每分钟轮询，自动拉取并提交更新
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

### ⚠️ 必须部署 Supabase Edge Function（否则 Actions 无法访问体彩接口）

体彩官方接口的 WAF 会拦截 GitHub Actions 的 Azure 服务器 IP（返回 HTTP 567），Cloudflare Worker 的 IP 同样被拦截。**Supabase Edge Functions** 运行在 Deno Deploy 全球边缘网络，IP 段不同，可正常访问体彩接口。

**1. 创建 Supabase 项目（2 分钟，免费）**

1. 打开 <https://supabase.com> → 注册/登录（免费，不需信用卡）
2. 点 **New Project**，Name 填 `pailie5`，设一个数据库密码，选 **Free** 区域
3. 等待约 1 分钟项目初始化完成

**2. 部署 Edge Function**

1. 在 Supabase Dashboard 左侧菜单找到 **Edge Functions**（或 Functions）
2. 点 **Create a new function** / **Deploy a new function**
3. Function name 填 `p5-proxy`
4. 将 `supabase/edge-functions/p5-proxy/index.ts` 的全部内容粘贴到编辑器
5. 点 **Deploy**
6. 复制函数 URL（形如 `https://abcdefgh.supabase.co/functions/v1/p5-proxy`）

> **重要**：确保函数的 **JWT verification** 设为 **关闭**（Verify JWT = off），否则 GitHub Actions 无法调用。在 Dashboard 的 Edge Functions 页面可切换此设置。

**3. 测试函数**

浏览器打开 `https://你的项目.supabase.co/functions/v1/p5-proxy/?gameNo=350133&provinceId=0&pageSize=1&isVerify=1&pageNo=1`，应返回 JSON 开奖数据（含 `value.list` 数组）。

**4. 添加 GitHub Secret**

仓库 **Settings → Secrets and variables → Actions → New repository secret**：
- Name: `PROXY_URL`
- Value: 你的 Supabase 函数 URL（如 `https://abcdefgh.supabase.co/functions/v1/p5-proxy`）

设置后 Actions 工作流会自动通过 Supabase 中继访问体彩接口。未设置时脚本直连（适用于本地/非云环境）。

### 手动触发

也可在仓库 **Actions** 页手动触发 `Update P5 Draws` 工作流（`workflow_dispatch`）测试。

### 工作流逻辑

1. 北京时间 21:25 启动，共 36 轮（每轮间隔 60 秒，覆盖 21:25-22:00）
2. 每轮先用 `--check` 模式轻量检查（1 次 API 调用，比较最新期号）
3. 检测到新数据 → 全量拉取 500 期 → `git commit` → `git push` → 退出
4. 无新数据 → 等 60 秒 → 下一轮

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
