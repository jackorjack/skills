#!/usr/bin/env node
// 提取单条抖音视频的元数据 + 视频下载地址
// 用法（须在 douyin-search 目录下运行以复用 node_modules）:
//   cd skills/douyin-search && node ../douyin-script-imitator/scripts/fetch_video_detail.js <aweme_id_or_url>
// 输出: JSON { title, desc, tags, videoSrc, authorName, followers, likes, comments, shares, publishDate }
//
// 视频源地址获取策略（按优先级）：
//   1. 拦截抖音详情 API 响应，直接从 JSON 提取 play_addr.url_list（最快最稳）
//   2. 轮询 <video>.currentSrc，等待 blob: 替换为真实 CDN 地址（兜底）
//   3. 以上都失败，返回空字符串

// 解析 node_modules 路径：优先从 douyin-search 目录找
const path = require('path');
const fs = require('fs');
const possiblePaths = [
  path.join(__dirname, '..', '..', 'douyin-search', 'node_modules'),
  path.join(__dirname, '..', 'node_modules'),
  path.join(process.cwd(), 'node_modules')
];
for (const p of possiblePaths) {
  if (fs.existsSync(path.join(p, 'playwright-extra'))) {
    module.paths.unshift(p);
    break;
  }
}

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

const input = process.argv[2];
if (!input) { console.error('用法: node fetch_video_detail.js <aweme_id_or_url>'); process.exit(1); }

// 支持 aweme_id 或完整 URL
let awemeId = input;
let targetUrl = input;
if (!input.startsWith('http')) {
  targetUrl = `https://www.douyin.com/video/${input}`;
} else {
  const m = input.match(/\/video\/(\d+)/);
  if (m) awemeId = m[1];
}

const COOKIE_FILE = path.join(__dirname, '..', '..', 'douyin-search', 'scripts', 'cookie.txt');
const COOKIE_RAW = fs.readFileSync(COOKIE_FILE, 'utf-8').trim();

const LOGIN_NAMES = new Set([
  'sessionid','sessionid_ss','sid_guard','sid_tt','uid_tt','uid_tt_ss',
  'passport_csrf_token','passport_csrf_token_default','passport_auth_mix_state',
  'passport_assist_user','sid_ucp_v1','ssid_ucp_v1','session_tlb_tag',
  'is_staff_user','has_biz_token','login_time','IsDouyinActive','n_mh','odin_tt'
]);

function parseCookies(raw) {
  return raw.split('; ')
    .filter(p => LOGIN_NAMES.has(p.split('=')[0].trim()) || true)
    .map(p => {
      const idx = p.indexOf('=');
      return { name: p.substring(0, idx).trim(), value: p.substring(idx + 1), domain: '.douyin.com', path: '/' };
    });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  });
  await context.addCookies(parseCookies(COOKIE_RAW));

  const page = await context.newPage();

  // ===== 策略1：拦截详情 API 响应，直接提取视频 URL =====
  let videoUrl = '';
  let apiDetail = null;

  page.on('response', async (response) => {
    const respUrl = response.url();
    // 匹配抖音视频详情 API
    if (respUrl.includes('/aweme/v1/web/aweme/detail/') ||
        respUrl.includes('/aweme/v1/web/aweme/post/')) {
      try {
        const json = await response.json();
        const detail = json.aweme_detail || json.aweme_list?.[0] || json.aweme;
        if (detail) {
          apiDetail = detail;
          const urls = detail.video?.play_addr?.url_list;
          if (urls && urls.length > 0) {
            videoUrl = urls[0];
            console.error(`✅ 拦截到视频地址（API响应）: ${videoUrl.substring(0, 80)}...`);
          }
        }
      } catch (e) {
        // 响应可能不是 JSON，忽略
      }
    }
  });

  // ===== 页面加载：用 domcontentloaded，不傻等 networkidle =====
  console.error(`⏳ 打开视频页面: ${targetUrl}`);
  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch (e) {
    console.error(`⚠️ 页面加载超时，继续尝试提取...`);
  }

  // ===== 策略2：如果 API 拦截没拿到，轮询 video 元素的 currentSrc =====
  if (!videoUrl) {
    console.error('⏳ API 未拦截到视频地址，尝试从 video 元素获取...');
    try {
      await page.waitForSelector('video', { timeout: 10000 });
      console.error('✅ 视频元素已加载');
    } catch {
      console.error('⚠️ 未检测到 video 元素');
    }

    // 轮询 currentSrc，最多尝试 5 次，每次间隔 1 秒
    for (let i = 0; i < 5; i++) {
      const src = await page.evaluate(() => {
        const v = document.querySelector('video');
        return v?.currentSrc || v?.src || '';
      });

      if (src && !src.startsWith('blob:')) {
        videoUrl = src;
        console.error(`✅ 获取到视频地址（video元素）: ${videoUrl.substring(0, 80)}...`);
        break;
      }

      if (i < 4) {
        console.error(`⏳ currentSrc 仍是 blob，等待重试 (${i + 1}/5)...`);
        await page.waitForTimeout(1000);
      }
    }

    if (!videoUrl) {
      console.error('⚠️ 未能从 video 元素获取真实地址');
    }
  }

  // ===== 提取页面元数据 =====
  const data = await page.evaluate(() => {
    const video = document.querySelector('video');
    const videoSrc = video?.currentSrc || video?.src || '';
    const h1 = document.querySelector('h1');
    const fullTitle = h1?.textContent?.trim() || '';
    const tags = [...document.querySelectorAll('h1 a')].map(a => a.textContent?.trim()).filter(t => t.startsWith('#'));

    // 作者
    const authorEl = document.querySelector('[data-e2e="user-info"]');
    const authorName = authorEl?.querySelector('span')?.textContent?.trim() || '';
    const followerEl = authorEl?.querySelector('[data-e2e="follower-count"]');
    const followers = followerEl?.textContent?.trim() || '';

    // 互动数据
    const likes = document.querySelector('[data-e2e="like-count"]')?.textContent?.trim() || '';
    const comments = document.querySelector('[data-e2e="comment-count"]')?.textContent?.trim() || '';
    const shares = document.querySelector('[data-e2e="share-count"]')?.textContent?.trim() || '';
    const publishDate = document.querySelector('[data-e2e="publish-time"]')?.textContent?.trim() || '';

    return { fullTitle, videoSrc, authorName, followers, likes, comments, shares, publishDate, tags };
  });

  // 优先使用拦截到的 API 视频地址
  data.videoSrc = videoUrl || data.videoSrc || '';

  // 如果 API 拦截到了完整详情，补充可能缺失的字段
  if (apiDetail) {
    if (!data.fullTitle && apiDetail.desc) {
      data.fullTitle = apiDetail.desc;
    }
    if (!data.tags.length && apiDetail.text_extra) {
      data.tags = apiDetail.text_extra
        .filter(t => t.hashtag_name)
        .map(t => '#' + t.hashtag_name);
    }
    if (!data.authorName && apiDetail.author?.nickname) {
      data.authorName = apiDetail.author.nickname;
    }
    if (!data.followers && apiDetail.author?.follower_count) {
      data.followers = String(apiDetail.author.follower_count);
    }
    // 补充点赞/评论/分享数据
    if (!data.likes && apiDetail.statistics?.digg_count != null) {
      data.likes = String(apiDetail.statistics.digg_count);
    }
    if (!data.comments && apiDetail.statistics?.comment_count != null) {
      data.comments = String(apiDetail.statistics.comment_count);
    }
    if (!data.shares && apiDetail.statistics?.share_count != null) {
      data.shares = String(apiDetail.statistics.share_count);
    }
    if (!data.publishDate && apiDetail.create_time) {
      const d = new Date(apiDetail.create_time * 1000);
      data.publishDate = `发布时间：${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
  }

  console.log(JSON.stringify(data, null, 2));
  await browser.close();
  process.exit(0);
})();
