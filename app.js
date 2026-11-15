"use strict";
/* 排列五开奖数据分析 — 前端逻辑（纯 vanilla，无外部依赖）
 * 数据：data/draws.json（{meta, draws:[{period,date,number(五位)}]}），按期号新→旧。
 * 仅统计分析，不预测、不荐号、不改变中奖概率。
 */

const POS = ["万位", "千位", "百位", "十位", "个位"];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

let draws = [], meta = {}, kills = [[], [], [], [], []], suggestions = [[], [], [], [], []];
let histPage = 0, histFiltered = [];
const PAGE_SIZE = 50;

/* ---------- 数据加载与规范化 ---------- */
function normalize(d) {
  const s = String(d.number ?? "").replace(/\D/g, "");
  if (s.length !== 5) return null;
  const p = String(d.period ?? d.expect ?? d.lotteryDrawNum ?? "");
  if (!p) return null;
  return { period: p, date: String(d.date ?? "").slice(0, 10), number: s };
}

async function loadData() {
  try {
    const r = await fetch("./data/draws.json?ts=" + Date.now());
    if (!r.ok) throw Error("HTTP " + r.status);
    const j = await r.json();
    const src = j.draws || j;
    draws = src.map(normalize).filter(Boolean)
      .sort((a, b) => (+b.period) - (+a.period));
    meta = j.meta || {};
    if (!draws.length) throw Error("数据为空或格式不符");
    renderAll();
    renderStatus();
  } catch (e) {
    $("sourceStatus").innerHTML =
      `未能读取 <code>data/draws.json</code>：${esc(e.message)}。可点“导入 JSON”手动载入符合格式的文件。`;
    renderAll();
  }
}

function renderStatus() {
  const m = meta || {};
  $("sourceStatus").innerHTML =
    `<span class="pill">来源</span>${esc(m.source || "data/draws.json")}` +
    ` ｜ <span class="pill">期数</span><b>${draws.length}</b> 期` +
    ` ｜ <span class="pill">最新</span>${draws[0] ? esc(draws[0].period) + " · " + esc(draws[0].date) : "—"}` +
    ` ｜ <span class="pill">同步</span>${esc((m.updated_at || "本地").slice(0, 19))}`;
}

/* ---------- 频率统计 ---------- */
function getCounts(win) {
  const arr = draws.slice(0, Math.min(win, draws.length));
  const m = POS.map(() => Array(10).fill(0));
  arr.forEach(d => { for (let p = 0; p < 5; p++) m[p][+d.number[p]]++; });
  return m;
}

function chiSquare(counts) {
  const n = counts.reduce((a, b) => a + b, 0);
  if (n === 0) return { chi2: 0, p: 1, n: 0, df: 9 };
  const e = n / 10;
  let chi2 = 0;
  for (let i = 0; i < 10; i++) { const d = counts[i] - e; chi2 += (d * d) / e; }
  const p = gammq(4.5, chi2 / 2); // df=9 → a=9/2=4.5
  return { chi2, p, n, df: 9 };
}

function renderFreq() {
  const windows = [30, 50, 100, 300, 500];
  const full = getCounts(draws.length);
  let html = "";
  POS.forEach((name, p) => {
    html += `<div class="freq-pos"><h3>${name}</h3>`;
    windows.forEach(w => {
      const m = getCounts(w);
      const used = Math.min(w, draws.length);
      const max = Math.max(1, ...m[p]);
      html += `<div class="small" style="margin:8px 0 5px">近 ${w} 期（实际 ${used} 期）</div>
               <div class="freq-grid">${m[p].map((v, n) => `
                 <div class="stat"><b>${v}</b>
                   <span>号 ${n} · ${(used ? (v / used * 100) : 0).toFixed(1)}%</span>
                   <div class="bar"><i style="width:${v / max * 100}%"></i></div>
                 </div>`).join("")}</div>`;
    });
    html += "</div>";
  });
  $("freqView").innerHTML = html;

  // χ² 均匀性检验（全样本）
  let chi = `<b>卡方均匀性检验（全样本 ${draws.length} 期，原假设：0-9 等概率，df=9）</b>
             <table><thead><tr><th>位置</th><th>χ²</th><th>p 值</th><th>结论</th></tr></thead><tbody>`;
  POS.forEach((name, p) => {
    const r = chiSquare(full[p]);
    const concl = r.p > 0.05 ? "未发现显著偏离均匀分布" : "p≤0.05，提示可能偏斜（仍不意味可预测）";
    chi += `<tr><td>${name}</td><td>${r.chi2.toFixed(2)}</td><td>${r.p.toFixed(3)}</td><td>${concl}</td></tr>`;
  });
  chi += `</tbody></table>
          <div class="muted" style="margin-top:8px">说明：p&gt;0.05 仅表示“未能拒绝均匀分布”，<b>不能解读为某数字更易出</b>；彩票各期独立。</div>`;
  $("chiView").innerHTML = chi;
}

/* ---------- 遗漏统计 ---------- */
function computeOmission() {
  const asc = [...draws].sort((a, b) => (+a.period) - (+b.period));
  return POS.map((_, p) => {
    const run = Array(10).fill(0), max = Array(10).fill(0);
    asc.forEach(d => {
      const dd = +d.number[p];
      for (let n = 0; n < 10; n++) {
        if (n === dd) { if (run[n] > max[n]) max[n] = run[n]; run[n] = 0; }
        else run[n]++;
      }
    });
    for (let n = 0; n < 10; n++) if (run[n] > max[n]) max[n] = run[n];
    return run.map((c, n) => ({ cur: c, max: max[n] }));
  });
}

function renderOmit() {
  const data = computeOmission();
  const maxCur = Math.max(1, ...data.flatMap(a => a.map(x => x.cur)));
  let html = "";
  POS.forEach((name, p) => {
    html += `<div class="omit-pos"><h3>${name}</h3><div class="omit-grid">`;
    data[p].forEach((x, n) => {
      const hot = x.cur >= maxCur * 0.6 ? "hot" : "";
      html += `<div class="omit-cell"><div class="n">号 ${n}</div>
               <div class="cur ${hot}">${x.cur}</div>
               <div class="max">最大 ${x.max}</div></div>`;
    });
    html += "</div></div>";
  });
  $("omitView").innerHTML = html + `<div class="muted" style="margin-top:6px">上数=当前遗漏（自上次出现至今期数），下数=历史最大遗漏。遗漏大≠“该出”。</div>`;
}

/* ---------- 杀号方案 ---------- */
function generate() {
  const w = +$("killWindow").value, k = +$("killCount").value;
  const m = getCounts(w);
  suggestions = m.map((cnt, p) =>
    cnt.map((v, n) => ({ n, v })).sort((a, b) => a.v - b.v || a.n - b.n).slice(0, k).map(x => x.n));
  kills = suggestions.map(a => a.slice());
  renderPositions();
}

function renderPositions() {
  const w = +$("killWindow").value;
  $("positions").innerHTML = POS.map((name, p) => {
    const cnt = getCounts(w)[p];
    const max = Math.max(1, ...cnt);
    return `<div class="position"><h3>${name}
              <span class="small">已杀 ${kills[p].length}</span></h3>
            <div class="digits">${Array.from({ length: 10 }, (_, n) =>
              `<button class="digit ${kills[p].includes(n) ? "on" : ""} ${suggestions[p].includes(n) && !kills[p].includes(n) ? "good" : ""}"
                       data-p="${p}" data-n="${n}" title="近${w}期出现 ${cnt[n]} 次">${n}</button>`
            ).join("")}</div>
            <div class="small">排除：${kills[p].length ? kills[p].slice().sort().join("、") : "未选"}</div></div>`;
  }).join("");
  document.querySelectorAll(".position .digit").forEach(b =>
    b.onclick = () => {
      const p = +b.dataset.p, n = +b.dataset.n;
      kills[p] = kills[p].includes(n) ? kills[p].filter(x => x !== n) : [...kills[p], n];
      renderPositions();
    });
  $("summary").innerHTML = POS.map((p, i) =>
    `<span class="pill">${p}：<b>${kills[i].length ? kills[i].slice().sort().join("") : "无"}</b></span>`).join(" ");
}

/* ---------- 回测 ---------- */
function runBacktest() {
  const W = +$("btWindow").value, K = +$("btK").value;
  if (draws.length <= W) { $("btResult").innerHTML = `<div class="bt-bad">数据不足：至少需要训练窗口 ${W} 期以外的额外一期（当前 ${draws.length} 期）。</div>`; return; }
  const asc = [...draws].sort((a, b) => (+a.period) - (+b.period));
  let tests = 0, allHits = 0;
  const per = [0, 0, 0, 0, 0], total = [0, 0, 0, 0, 0];
  for (let t = W; t < asc.length; t++) {
    const hist = asc.slice(t - W, t), target = asc[t];
    for (let p = 0; p < 5; p++) {
      const freq = Array(10).fill(0);
      hist.forEach(d => freq[+d.number[p]]++);
      const killed = freq.map((v, n) => ({ n, v })).sort((a, b) => a.v - b.v || a.n - b.n).slice(0, K).map(x => x.n);
      tests++; total[p]++;
      if (killed.includes(+target.number[p])) { per[p]++; allHits++; }
    }
  }
  const pct = tests ? (allHits / tests * 100) : 0;
  const baseline = K * 10; // 随机排除 K/10 个 → 命中率 K*10 %
  const diff = pct - baseline;
  const cls = Math.abs(diff) < 2 ? "bt-good" : "bt-bad";
  const concl = Math.abs(diff) < 2
    ? `命中率与随机基准差值仅 ${diff.toFixed(2)} 个百分点，<b>与随机不可区分</b>，历史频率未带来超额收益。`
    : `差值 ${diff.toFixed(2)} 个百分点，样本内略有偏离；这属于抽样波动，<b>不代表未来可获利</b>，更不可据此投注。`;
  $("btResult").innerHTML =
    `<div class="${cls}">
       测试样本：${Math.floor(tests / 5)} 期 × 5 位置，共 ${tests} 个位置判定<br>
       杀号命中：${allHits}/${tests}（<b>${pct.toFixed(2)}%</b>）<br>
       随机排除 ${K} 个数字的理论基准：<b>${baseline.toFixed(1)}%</b><br>
       差值：${diff.toFixed(2)} 个百分点<br>
       ${concl}
     </div>
     <table class="bt"><thead><tr><th>位置</th><th>命中</th><th>比例</th><th>基准</th></tr></thead><tbody>${
       POS.map((p, i) => `<tr><td>${p}</td><td>${per[i]}/${total[i]}</td><td>${(per[i] / total[i] * 100).toFixed(2)}%</td><td>${baseline.toFixed(1)}%</td></tr>`).join("")
     }</tbody></table>
     <div class="muted" style="margin-top:8px">注意：这是历史样本内回测，不代表未来表现；排列5各期独立同分布，杀号策略<b>不能提高中奖概率</b>。</div>`;
}

/* ---------- 历史开奖 ---------- */
function renderHistory() {
  const q = ($("search").value || "").trim();
  histFiltered = q ? draws.filter(d => d.period.includes(q) || d.number.includes(q)) : draws;
  const pages = Math.max(1, Math.ceil(histFiltered.length / PAGE_SIZE));
  if (histPage >= pages) histPage = pages - 1;
  if (histPage < 0) histPage = 0;
  const slice = histFiltered.slice(histPage * PAGE_SIZE, histPage * PAGE_SIZE + PAGE_SIZE);
  $("histCount").textContent = `共 ${histFiltered.length} 期`;
  $("pageInfo").textContent = `第 ${histPage + 1} / ${pages} 页`;
  $("drawTable").innerHTML = slice.length ? `<table class="dt"><thead><tr>
      <th>期号</th><th>开奖日期</th><th>开奖号码</th><th>和值</th></tr></thead><tbody>${
      slice.map(d => `<tr><td>${esc(d.period)}</td><td>${esc(d.date)}</td>
        <td class="num">${[...d.number].map(c => `<span>${c}</span>`).join("")}</td>
        <td>${[...d.number].reduce((a, c) => a + +c, 0)}</td></tr>`).join("")
    }</tbody></table>` : '<div class="empty">无匹配记录</div>';
}

/* ---------- 方案存档（localStorage） ---------- */
function renderPlans() {
  const plans = JSON.parse(localStorage.getItem("p5_plans") || "[]");
  $("planTable").innerHTML = plans.length
    ? `<table class="plans"><thead><tr><th>时间</th><th>窗口/杀数</th><th>五位置杀号</th></tr></thead><tbody>${
        plans.map(p => `<tr><td>${esc(p.time)}</td><td>${esc(p.window)} / ${esc(p.k)}</td>
          <td>${p.kills.map((a, i) => `${POS[i].slice(0,1)}:${a.slice().sort().join("") || "-"}`).join("  ")}</td></tr>`).join("")
      }</tbody></table>`
    : '<div class="empty">尚无方案</div>';
}

/* ---------- 渲染总入口 ---------- */
function renderAll() {
  renderPositions();
  renderFreq();
  renderOmit();
  renderHistory();
  renderPlans();
}

/* ---------- 事件绑定 ---------- */
function bindEvents() {
  document.querySelectorAll(".tab").forEach(t =>
    t.onclick = () => {
      document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(x => x.classList.remove("active"));
      t.classList.add("active");
      $("tab-" + t.dataset.tab).classList.add("active");
    });

  $("generate").onclick = generate;
  $("reset").onclick = () => { kills = [[], [], [], [], []]; suggestions = [[], [], [], [], []]; renderPositions(); };
  $("savePlan").onclick = () => {
    const plans = JSON.parse(localStorage.getItem("p5_plans") || "[]");
    plans.unshift({
      time: new Date().toLocaleString("zh-CN"),
      window: $("killWindow").value, k: $("killCount").value,
      kills: kills.map(a => a.slice().sort()),
    });
    localStorage.setItem("p5_plans", JSON.stringify(plans.slice(0, 50)));
    renderPlans();
    alert("方案已保存到当前浏览器。");
  };
  $("runBt").onclick = runBacktest;
  $("reload").onclick = loadData;
  $("search").oninput = () => { histPage = 0; renderHistory(); };
  $("prevPage").onclick = () => { histPage--; renderHistory(); };
  $("nextPage").onclick = () => { histPage++; renderHistory(); };
  $("killWindow").onchange = $("killCount").onchange = renderPositions;

  $("export").onclick = () => {
    const blob = new Blob([JSON.stringify({ meta, draws }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "p5-draws-backup.json";
    a.click(); URL.revokeObjectURL(a.href);
  };
  $("import").onchange = async e => {
    try {
      const j = JSON.parse(await e.target.files[0].text());
      const src = j.draws || j;
      const parsed = src.map(normalize).filter(Boolean).sort((a, b) => (+b.period) - (+a.period));
      if (!parsed.length) throw Error("未解析到有效记录");
      draws = parsed;
      meta = { source: "手动导入", updated_at: new Date().toISOString(), records: draws.length };
      renderAll(); renderStatus();
      $("sourceStatus").innerHTML = `已导入 ${draws.length} 期（仅本次会话有效；要永久同步请更新 data/draws.json）。`;
    } catch (err) {
      alert("JSON 格式不正确：" + err.message);
    }
    e.target.value = "";
  };
}

/* ---------- χ² p 值（上侧不完全伽马，Numerical Recipes 移植） ---------- */
function gammaln(xx) {
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = xx, y = xx, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) { y += 1; ser += cof[j] / y; }
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function gammq(a, x) {
  if (x <= 0) return 1;
  if (x < a + 1) {
    let ap = a, del = 1 / a, sum = del;
    for (let n = 1; n <= 200; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-12) break; }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - gammaln(a));
  }
  let b = x + 1 - a, c = 1e30, d = 1 / b, h = d;
  for (let i = 1; i <= 200; i++) {
    const an = -i * (i - a), bp = b + 2 * i;
    d = an * d + bp; if (Math.abs(d) < 1e-30) d = 1e-30;
    c = bp + an / c; if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammaln(a)) * h;
}

bindEvents();
loadData();
