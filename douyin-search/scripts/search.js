#!/usr/bin/env node
// 抖音搜索 — Stealth Browser + Cookie + 评论咨询过滤
// 用法: node search.js <关键词>
// 退出码: 0=成功 1=缺参数 2=Cookie缺失 3=Cookie过期 4=验证码 5=其他错误

const path = require('path');
const fs = require('fs');
const os = require('os');

// 显式指向 xthezealot-stealth-browser 的 node_modules
const STEALTH_NM = path.join(os.homedir(), '.openclaw', 'workspace', 'skills', 'xthezealot-stealth-browser', 'node_modules');
module.paths.unshift(STEALTH_NM);

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

const KEYWORD = process.argv[2];
if (!KEYWORD) { console.error('用法: node search.js <关键词>'); process.exit(1); }

const SKILL_DIR = __dirname;
const COOKIE_FILE = path.join(SKILL_DIR, 'cookie.txt');

// ── 配置 ──

const SEARCH_API = '/aweme/v1/web/general/search/stream/';
const COMMENT_API = 'https://www.douyin.com/aweme/v1/web/comment/list/';
const TOP_N = 20;          // 最终输出条数（全部输出）
const POOL_SIZE = 20;      // 搜索池大小（从中筛选 top5）
const COMMENT_COUNT = 15;  // 每个视频拉取评论数

// ── 时间过滤：仅保留 2022 年及以后的视频 ──
// 2022-01-01 00:00:00 UTC+8 = 1640966400
const YEAR_CUTOFF = 1640966400;

// ── 咨询关键词（制造业 B2B 场景） ──

const CONSULTATION_KW = [
  // 询价类
  '多少钱', '什么价', '价格', '报价', '询价', '价位', '便宜点',
  // 购买意向
  '怎么买', '怎么卖', '哪里买', '在哪买', '链接', '上链接', '想要', '想买', '求购',
  // 联系方式
  '联系方式', '微信', '加微信', '加我', '电话', '手机', '私信', '私聊', '聊聊', 'VX', 'vx',
  // 合作/批发
  '怎么合作', '代理', '批发', '拿货', '进货', '经销商', '一件代发',
  // 工厂/OEM
  '厂家', '工厂', '源头', 'OEM', 'ODM', '贴牌', '定制', '定做',
  // 样品/起订
  '样品', '打样', '起订', '起订量', 'MOQ', '最小起订',
  // 发货
  '包邮', '发货', '货期', '交期', '多久到', '运费',
  // 咨询
  '咨询', '请问', '问一下', '了解一下', '介绍下',
];

// ── Cookie 键名白名单 ──

const LOGIN_NAMES = new Set([
  'sessionid','sessionid_ss','sid_guard','sid_tt','uid_tt','uid_tt_ss',
  'passport_csrf_token','passport_csrf_token_default','passport_auth_mix_state',
  'passport_assist_user','sid_ucp_v1','ssid_ucp_v1','session_tlb_tag',
  'is_staff_user','has_biz_token','login_time','IsDouyinActive','n_mh','odin_tt'
]);

// ── Cookie 检查 ──

function checkCookie() {
  if (!fs.existsSync(COOKIE_FILE)) { console.error('NO_COOKIE'); process.exit(2); }
  const raw = fs.readFileSync(COOKIE_FILE, 'utf-8').trim();
  if (raw.length < 100) { console.error('NO_COOKIE'); process.exit(2); }

  const sidMatch = raw.match(/sid_guard=([^;]+)/);
  if (sidMatch) {
    const val = decodeURIComponent(sidMatch[1]);
    const parts = val.split('|');
    if (parts.length >= 3) {
      const expiry = parseInt(parts[1]) + parseInt(parts[2]);
      if (expiry && (Date.now() / 1000 + 3600) > expiry) {
        console.error('COOKIE_EXPIRED'); process.exit(3);
      }
    }
  }
  return raw;
}

const COOKIE_RAW = checkCookie();

function parseLoginCookies(raw) {
  return raw.split('; ')
    .filter(p => LOGIN_NAMES.has(p.split('=')[0].trim()))
    .map(p => {
      const idx = p.indexOf('=');
      return { name: p.substring(0, idx).trim(), value: p.substring(idx + 1), domain: '.douyin.com', path: '/' };
    });
}

// ── 剥离 chunked transfer encoding ──

function stripChunkedEncoding(body) {
  if (!body.startsWith('{')) {
    // 格式: hex_size\r\nJSON\r\nhex_size\r\nJSON...
    return body
      .replace(/^[0-9a-f]+\r\n/gm, '')   // 行首 chunk size
      .replace(/\r\n[0-9a-f]+\r\n/g, '\n') // 中间 chunk size
      .replace(/\r\n0\r\n\r\n$/, '');     // 尾部结束标记
  }
  return body;
}

// ── 从 JSON 对象中提取视频列表 ──

function extractVideos(obj, results) {
  // 兼容多种响应结构:
  //   {status_code:0, data:[{type:1, aweme_info:{...}}]}
  //   {data:{aweme_list:[{aweme_info:{...}}]}}
  let items = obj.data || [];
  if (!Array.isArray(items)) {
    items = items.aweme_list || items.data?.aweme_list || [];
  }

  for (const item of items) {
    const info = item.aweme_info || item;
    if (!info.aweme_id) continue;

    // video.duration 是毫秒 (> 1000); aweme_info.duration 是秒
    const vdur = info.video?.duration || 0;
    const durSec = vdur > 1000 ? Math.floor(vdur / 1000) : (info.duration || 0);

    results.push({
      aweme_id: info.aweme_id,
      desc: (info.desc || '').replace(/\n/g, ' '),
      url: `https://www.douyin.com/video/${info.aweme_id}`,
      likes: info.statistics?.digg_count || 0,
      comments: info.statistics?.comment_count || 0,
      shares: info.statistics?.share_count || 0,
      duration: durSec,
      author_name: info.author?.nickname || '',
      author_followers: info.author?.follower_count || 0,
      create_time: info.create_time || 0,
    });
  }
}

// ── 解析搜索 API 响应（JSON → 降级正则） ──

function parseSearchResults(body) {
  const clean = stripChunkedEncoding(body);
  const results = [];

  // 尝试整段 JSON 解析
  try {
    extractVideos(JSON.parse(clean), results);
    if (results.length > 0) return results;
  } catch (_) { /* 分段解析 */ }

  // 逐行 NDJSON
  const lines = clean.split('\n').filter(l => l.trim());
  for (const line of lines) {
    try { extractVideos(JSON.parse(line), results); } catch (_) {}
  }

  return results;
}

// ── 降级正则解析（完全绕过 JSON 解析） ──

function parseSearchFallback(body) {
  const clean = stripChunkedEncoding(body);
  const ids = [...clean.matchAll(/"aweme_id":"(\d+)"/g)].map(m => m[1]);
  const descs = [...clean.matchAll(/"desc":"((?:[^"\\]|\\.)*)"/g)].map(m => m[1].replace(/\\"/g, '"').replace(/\\n/g, ' '));
  const diggs = [...clean.matchAll(/"digg_count":(\d+)/g)].map(m => parseInt(m[1]));
  const ccounts = [...clean.matchAll(/"comment_count":(\d+)/g)].map(m => parseInt(m[1]));
  const shares = [...clean.matchAll(/"share_count":(\d+)/g)].map(m => parseInt(m[1]));
  const nicknames = [...clean.matchAll(/"nickname":"((?:[^"\\]|\\.)*)"/g)].map(m => m[1].replace(/\\"/g, '"'));
  const followers = [...clean.matchAll(/"follower_count":(\d+)/g)].map(m => parseInt(m[1]));
  // duration 取毫秒值 (>100000) 转换为秒，跳过音乐 duration（<1000）
  const allDurations = [...clean.matchAll(/"duration":(\d+)/g)].map(m => parseInt(m[1]));
  const durations = allDurations.map(d => d > 100000 ? Math.floor(d / 1000) : d);
  const dates = [...clean.matchAll(/"create_time":(\d+)/g)].map(m => parseInt(m[1]));

  return [...new Set(ids)].slice(0, POOL_SIZE).map((id, i) => ({
    aweme_id: id,
    desc: (descs[i] || '').substring(0, 80),
    url: `https://www.douyin.com/video/${id}`,
    likes: diggs[i] || 0,
    comments: ccounts[i] || 0,
    shares: shares[i] || 0,
    duration: durations[i] || 0,
    author_name: nicknames[i] || '',
    author_followers: followers[i] || 0,
    create_time: dates[i] || 0,
  }));
}

// ── 评论文本拉取（从浏览器内 fetch，自动携带 Cookie） ──

async function fetchCommentText(page, awemeId) {
  const url = `${COMMENT_API}?aweme_id=${awemeId}&cursor=0&count=${COMMENT_COUNT}`;
  try {
    const text = await page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: 'include' });
      if (!r.ok) return '';
      return r.text();
    }, url);

    const data = JSON.parse(text);
    const comments = data.comments || [];
    return comments.map(c => c.text || '').join(' ');
  } catch {
    return '';
  }
}

// ── 咨询意图评分 ──

function calcConsultationScore(commentText, desc) {
  const haystack = (commentText + ' ' + (desc || '')).toLowerCase();
  let hits = 0;
  const matched = [];
  for (const kw of CONSULTATION_KW) {
    if (haystack.includes(kw)) {
      hits++;
      matched.push(kw);
    }
  }
  return { score: hits, matched };
}

// ── 分批并行拉取评论 ──

async function enrichWithComments(page, videos, concurrency = 5) {
  const enriched = [];
  for (let i = 0; i < videos.length; i += concurrency) {
    const batch = videos.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (v) => {
        const commentText = await fetchCommentText(page, v.aweme_id);
        const cs = calcConsultationScore(commentText, v.desc);
        return { ...v, consultation_score: cs.score, consultation_matched: cs.matched, has_consultation: cs.score > 0 };
      })
    );
    for (const r of results) {
      if (r.status === 'fulfilled') enriched.push(r.value);
      else enriched.push({ ...batch[results.indexOf(r)], consultation_score: 0, consultation_matched: [], has_consultation: false });
    }
  }
  return enriched;
}

// ── 排序：有咨询优先 → 点赞降序 ──

function sortByPriority(videos) {
  return videos.sort((a, b) => {
    // 有咨询意图的排前面
    if (a.has_consultation !== b.has_consultation) return b.has_consultation - a.has_consultation;
    // 都有咨询 → 按咨询命中数降序
    if (a.consultation_score !== b.consultation_score) return b.consultation_score - a.consultation_score;
    // 都无咨询或命中相同 → 按点赞降序
    return b.likes - a.likes;
  });
}

// ── 输出格式化：Markdown 表格 ──

function formatNumber(n) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDuration(sec) {
  if (!sec) return '-';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

function formatResults(keyword, videos) {
  const top = videos.slice(0, TOP_N);
  if (top.length === 0) {
    return `### 🔍 抖音搜索「${keyword}」
> 搜到 ${videos.length} 条，符合 2022 年后条件 0 条`;
  }

  const lines = [];
  lines.push(`### 🔍 抖音搜索「${keyword}」`);
  lines.push(`> 筛选条件：2022年及以后 | 共搜到 ${videos.length} 条，输出前 ${top.length} 条`);
  lines.push('');
  lines.push('| # | 视频标题 | 👍点赞 | 💬评论 | ⏱时长 | 👤作者 | 👥粉丝 | 📅发布日期 | 💰咨询意图 |');
  lines.push('|---|----------|--------|--------|--------|--------|--------|------------|------------|');

  for (const v of top) {
    const consultIcon = v.has_consultation ? `✅ ${v.consultation_matched.join('、')}` : '❌ 无';
    const title = (v.desc || '-').substring(0, 50).replace(/\|/g, '｜');
    const author = (v.author_name || '-').replace(/\|/g, '｜');
    lines.push(`| ${v.index || top.indexOf(v) + 1} | [${title}](${v.url}) | ${formatNumber(v.likes)} | ${formatNumber(v.comments)} | ${formatDuration(v.duration)} | ${author} | ${formatNumber(v.author_followers)} | ${formatDate(v.create_time)} | ${consultIcon} |`);
  }

  lines.push('');
  lines.push('> 💰 咨询意图列展示评论中匹配到的询价/购买/合作关键词；无咨询的视频为普通曝光内容');
  return lines.join('\n');
}

// ── 主流程 ──

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/usr/bin/chromium-browser',
    args: [
      '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
      '--disable-gpu','--window-size=1920,1080','--disable-blink-features=AutomationControlled',
    ],
  });

  let ctx;
  try {
    ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await ctx.newPage();

    // 1. 首页建立信任
    await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    // 2. 注入 Cookie
    await ctx.addCookies(parseLoginCookies(COOKIE_RAW));

    // 3. 搜索 + 拦截 API
    const encoded = encodeURIComponent(KEYWORD);
    const apiPromise = page.waitForResponse(
      r => r.url().includes(SEARCH_API) && r.status() === 200,
      { timeout: 20000 },
    ).catch(() => null);

    await page.goto(`https://www.douyin.com/search/${encoded}?type=general`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });

    const apiResp = await apiPromise;
    let apiBody = '';
    if (apiResp) {
      try { apiBody = await apiResp.text(); } catch (_) {}
    } else {
      await page.waitForTimeout(5000);
    }

    // 4. 风控/登录检查
    const title = await page.title();
    if (title.includes('验证码中间页')) { console.error('CAPTCHA_BLOCKED'); process.exit(4); }

    const needLogin = await page.evaluate(() =>
      document.body?.innerText?.includes('登录后即可搜索'),
    ).catch(() => false);
    if (needLogin) { console.error('COOKIE_EXPIRED'); process.exit(3); }

    // 5. 解析搜索结果
    let videos = [];
    if (apiBody) {
      videos = parseSearchResults(apiBody);
      if (videos.length === 0) videos = parseSearchFallback(apiBody);
    }

    if (videos.length === 0) {
      console.log(JSON.stringify({ keyword: KEYWORD, searched: 0, output: 0, results: [] }, null, 2));
      return;
    }

    // 6. 过滤：仅保留 2022 年及以后的视频
    videos = videos.filter(v => v.create_time >= YEAR_CUTOFF);

    if (videos.length === 0) {
      console.log(formatResults(KEYWORD, []));
      return;
    }

    // 7. 取前 POOL_SIZE 条拉评论
    const pool = videos.slice(0, POOL_SIZE);
    const enriched = await enrichWithComments(page, pool);

    // 8. 排序取 top5
    const sorted = sortByPriority(enriched);
    sorted.forEach((v, i) => { v.index = i + 1; });
    console.log(formatResults(KEYWORD, sorted));

  } finally {
    if (ctx) await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch(e => {
  console.error('SEARCH_ERROR:' + e.message);
  process.exit(5);
});
