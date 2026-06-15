#!/usr/bin/env node
// 抖音搜索 — Stealth Browser + Cookie + 评论咨询过滤
// 用法: node search.js <关键词> [poolSize] [yearFrom] [--no-followers]
//   poolSize: 可选，搜索池大小（默认 50，最大 100）
//   yearFrom: 可选，发布年份下限（默认 2022，仅保留该年 1 月 1 日及之后的视频）
//   --no-followers: 跳过粉丝数拉取（省 40-60s，粉丝列显示 -）
// 退出码: 0=成功 1=缺参数 2=Cookie缺失 3=Cookie过期 4=验证码 5=其他错误

const { checkCookie, launchBrowser, createContext, setupPage, stripChunkedEncoding, formatNumber, formatDate, formatDuration, checkPageBlocked } = require('./lib/common');

const KEYWORD = process.argv[2];
if (!KEYWORD) { console.error('用法: node search.js <关键词> [poolSize] [yearFrom] [--no-followers]'); process.exit(1); }

// 解析标志位
const NO_FOLLOWERS = process.argv.includes('--no-followers');
// 过滤掉标志位后取数值参数
const numArgs = process.argv.slice(2).filter(a => !a.startsWith('--'));

// 搜索池大小：默认 50，限制 1~100
const POOL_SIZE_ARG = parseInt(numArgs[1]);
const POOL_SIZE_DEFAULT = 50;
const POOL_SIZE_MAX = 100;
const POOL_SIZE = Number.isFinite(POOL_SIZE_ARG) && POOL_SIZE_ARG > 0
  ? Math.min(POOL_SIZE_ARG, POOL_SIZE_MAX)
  : POOL_SIZE_DEFAULT;

// 发布年份下限：默认 2022，限制 2010~当前年
const YEAR_FROM_ARG = parseInt(numArgs[2]);
const YEAR_FROM_DEFAULT = 2022;
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_FROM = Number.isFinite(YEAR_FROM_ARG) && YEAR_FROM_ARG >= 2010 && YEAR_FROM_ARG <= CURRENT_YEAR
  ? YEAR_FROM_ARG
  : YEAR_FROM_DEFAULT;

const COOKIE_RAW = checkCookie();

// ── 配置 ──

const SEARCH_API = '/aweme/v1/web/general/search/stream/';
const COMMENT_API = 'https://www.douyin.com/aweme/v1/web/comment/list/';
const TOP_N = 20;          // 最终输出条数
const COMMENT_COUNT = 15;  // 每个视频拉取评论数

// ── 时间过滤：根据 YEAR_FROM 计算 UTC+8 该年 1 月 1 日 0 点的 unix 时间戳 ──
const YEAR_CUTOFF = Math.floor(Date.UTC(YEAR_FROM, 0, 1) / 1000) - 8 * 3600;

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

// ── 从 JSON 对象中提取视频列表 ──

function extractVideos(obj, results) {
  let items = obj.data || [];
  if (!Array.isArray(items)) {
    items = items.aweme_list || items.data?.aweme_list || [];
  }

  for (const item of items) {
    const info = item.aweme_info || item;
    if (!info.aweme_id) continue;

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

  try {
    extractVideos(JSON.parse(clean), results);
    if (results.length > 0) return results;
  } catch (_) {}

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

// ── 视频详情 API ──

const DETAIL_API = '/aweme/v1/web/aweme/detail/';

// ── 拉取评论（从浏览器内 fetch，自动携带 Cookie） ──

async function fetchCommentText(page, awemeId) {
  const url = `${COMMENT_API}?aweme_id=${awemeId}&cursor=0&count=${COMMENT_COUNT}`;
  try {
    const text = await page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: 'include' });
      if (!r.ok) return '';
      return r.text();
    }, url);
    const data = JSON.parse(text);
    return (data.comments || []).map(c => c.text || '').join(' ');
  } catch {
    return '';
  }
}

// ── 批量拉取粉丝数（需导航到视频页拦截详情 API，串行执行） ──

async function enrichFollowers(page, videos) {
  const followerMap = {};
  for (const v of videos) {
    try {
      const detailPromise = page.waitForResponse(
        r => r.url().includes(DETAIL_API) && r.status() === 200,
        { timeout: 15000 }
      ).catch(() => null);

      await page.goto(`https://www.douyin.com/video/${v.aweme_id}`, {
        waitUntil: 'domcontentloaded', timeout: 20000,
      });

      const resp = await detailPromise;
      if (resp) {
        const text = await resp.text();
        const clean = stripChunkedEncoding(text);
        const m = clean.match(/"follower_count":(\d+)/);
        if (m) followerMap[v.aweme_id] = parseInt(m[1]);
      }
    } catch (_) {}
  }
  return followerMap;
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

// ── 排序：有咨询优先 → 咨询命中数降序 → 点赞降序 ──

function sortByPriority(videos) {
  return videos.sort((a, b) => {
    if (a.has_consultation !== b.has_consultation) return b.has_consultation - a.has_consultation;
    if (a.consultation_score !== b.consultation_score) return b.consultation_score - a.consultation_score;
    return b.likes - a.likes;
  });
}

// ── 输出格式化：Markdown 表格 ──

function formatResults(keyword, videos, totalSearched) {
  const top = videos;
  const total = totalSearched != null ? totalSearched : videos.length;
  if (top.length === 0) {
    return `### 🔍 抖音搜索「${keyword}」
> 搜到 ${total} 条，符合 ${YEAR_FROM} 年后条件 0 条`;
  }

  const lines = [];
  lines.push(`### 🔍 抖音搜索「${keyword}」`);
  lines.push(`> 筛选条件：${YEAR_FROM}年及以后 | 池容量=${POOL_SIZE} | 共搜到 ${total} 条，输出前 ${top.length} 条`);
  lines.push('');
  lines.push('| # | 视频标题 | 👍点赞 | 💬评论 | ⏱时长 | 👤作者 | 👥粉丝 | 📅发布日期 | 💰咨询意图 |');
  lines.push('|---|----------|--------|--------|--------|--------|--------|------------|------------|');

  for (const v of top) {
    const consultIcon = v.has_consultation ? `✅ ${v.consultation_matched.join('、')}` : '❌ 无';
    const title = (v.desc || '-').substring(0, 50).replace(/\|/g, '｜');
    const author = (v.author_name || '-').replace(/\|/g, '｜');
    const followers = NO_FOLLOWERS ? '-' : formatNumber(v.author_followers);
    lines.push(`| ${v.index || top.indexOf(v) + 1} | [${title}](${v.url}) | ${formatNumber(v.likes)} | ${formatNumber(v.comments)} | ${formatDuration(v.duration)} | ${author} | ${followers} | ${formatDate(v.create_time)} | ${consultIcon} |`);
  }

  lines.push('');
  lines.push('> 💰 咨询意图列展示评论中匹配到的询价/购买/合作关键词；无咨询的视频为普通曝光内容');
  return lines.join('\n');
}

// ── 主流程 ──

async function main() {
  const browser = await launchBrowser();
  let ctx;
  try {
    ctx = await createContext(browser);
    const page = await setupPage(ctx, COOKIE_RAW);

    // 搜索 + 拦截 API（多批拦截，收集足够 POOL_SIZE 条）
    const encoded = encodeURIComponent(KEYWORD);
    const apiBodies = [];
    const onResponse = async (r) => {
      if (r.url().includes(SEARCH_API) && r.status() === 200) {
        try { apiBodies.push(await r.text()); } catch (_) {}
      }
    };
    page.on('response', onResponse);

    await page.goto(`https://www.douyin.com/search/${encoded}?type=general`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // 风控/登录检查
    await checkPageBlocked(page);

    // 滚动加载直到收集足够 POOL_SIZE 条或连续未增长
    let videos = [];
    let lastCount = 0;
    let stagnant = 0;
    const MAX_SCROLLS = 12;
    for (let i = 0; i < MAX_SCROLLS; i++) {
      videos = [];
      const seen = new Set();
      for (const body of apiBodies) {
        let parsed = parseSearchResults(body);
        if (parsed.length === 0) parsed = parseSearchFallback(body);
        for (const v of parsed) {
          if (!seen.has(v.aweme_id)) { seen.add(v.aweme_id); videos.push(v); }
        }
      }
      const valid = videos.filter(v => v.create_time >= YEAR_CUTOFF);
      if (valid.length >= POOL_SIZE) break;

      if (videos.length === lastCount) {
        stagnant++;
        if (stagnant >= 3) break;
      } else {
        stagnant = 0;
        lastCount = videos.length;
      }

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
    }
    page.off('response', onResponse);

    // 过滤：仅保留 YEAR_FROM 年及以后的视频
    videos = videos.filter(v => v.create_time >= YEAR_CUTOFF);
    const totalSearched = videos.length;

    if (videos.length === 0) {
      console.log(formatResults(KEYWORD, []));
      return;
    }

    // 取前 POOL_SIZE 条拉评论
    const pool = videos.slice(0, POOL_SIZE);
    const enriched = await enrichWithComments(page, pool);

    // 排序取 top20
    const sorted = sortByPriority(enriched);
    sorted.forEach((v, i) => { v.index = i + 1; });
    const top = sorted.slice(0, TOP_N);

    // 补充粉丝数（仅 top20，需导航到视频页拦截详情 API）
    if (!NO_FOLLOWERS) {
      const followerMap = await enrichFollowers(page, top);
      for (const v of top) {
        if (followerMap[v.aweme_id]) v.author_followers = followerMap[v.aweme_id];
      }
    }

    console.log(formatResults(KEYWORD, top, totalSearched));

  } finally {
    if (ctx) await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch(e => {
  console.error('SEARCH_ERROR:' + e.message);
  process.exit(5);
});
