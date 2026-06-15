#!/usr/bin/env node
// 提取单条抖音视频的元数据 + 视频下载地址
// 用法: node video_detail.js <aweme_id>
// 策略: 优先拦截 API → 降级 DOM 抓取
// 输出: JSON

const { checkCookie, launchBrowser, createContext, setupPage, stripChunkedEncoding } = require('./lib/common');

const AWEME_ID = process.argv[2];
if (!AWEME_ID) { console.error('用法: node video_detail.js <aweme_id>'); process.exit(1); }

const COOKIE_RAW = checkCookie();

// ── 从 API 响应中提取视频详情 ──

function parseApiResponse(body) {
  const clean = stripChunkedEncoding(body);
  try {
    const obj = JSON.parse(clean);
    const aweme = obj.aweme_detail || obj.data?.aweme_detail || {};
    const info = aweme;

    const videoPlay = info.video?.play_addr || info.video?.play_addr_265 || {};
    const urlList = videoPlay.url_list || [];
    const music = info.music || {};

    return {
      source: 'api',
      aweme_id: info.aweme_id,
      desc: info.desc || '',
      create_time: info.create_time || 0,
      duration: Math.floor((info.video?.duration || info.duration || 0) / (info.video?.duration > 1000 ? 1000 : 1)),
      author: {
        uid: info.author?.uid || '',
        nickname: info.author?.nickname || '',
        signature: info.author?.signature || '',
        follower_count: info.author?.follower_count || 0,
        following_count: info.author?.following_count || 0,
        aweme_count: info.author?.aweme_count || 0,
        total_favorited: info.author?.total_favorited || 0,
      },
      statistics: {
        digg_count: info.statistics?.digg_count || 0,
        comment_count: info.statistics?.comment_count || 0,
        share_count: info.statistics?.share_count || 0,
        collect_count: info.statistics?.collect_count || 0,
      },
      video_urls: urlList.slice(0, 3),
      music: {
        title: music.title || '',
        author: music.author || '',
        duration: music.duration || 0,
        play_url: (music.play_url?.url_list || [])[0] || '',
      },
      tag_list: (info.text_extra || []).map(t => t.hashtag_name || '').filter(Boolean),
    };
  } catch (e) {
    return { source: 'api_error', error: e.message, raw: clean.substring(0, 500) };
  }
}

// ── 从 DOM 中提取视频详情（降级方案） ──

async function scrapeFromDom(page) {
  return page.evaluate(() => {
    const video = document.querySelector('video');
    const videoSrc = video?.currentSrc || video?.src || '';
    const h1 = document.querySelector('h1');
    const fullTitle = h1?.textContent?.trim() || '';
    const tags = [...document.querySelectorAll('h1 a')].map(a => a.textContent?.trim()).filter(t => t.startsWith('#'));

    const authorEl = document.querySelector('[data-e2e="user-info"]');
    const authorName = authorEl?.querySelector('span')?.textContent?.trim() || '';
    const followerEl = authorEl?.querySelector('[data-e2e="follower-count"]');
    const followers = followerEl?.textContent?.trim() || '';

    const likes = document.querySelector('[data-e2e="like-count"]')?.textContent?.trim() || '';
    const comments = document.querySelector('[data-e2e="comment-count"]')?.textContent?.trim() || '';
    const shares = document.querySelector('[data-e2e="share-count"]')?.textContent?.trim() || '';
    const publishDate = document.querySelector('[data-e2e="publish-time"]')?.textContent?.trim() || '';

    return {
      source: 'dom',
      fullTitle, videoSrc, authorName, followers, likes, comments, shares, publishDate, tags,
    };
  });
}

// ── 主流程 ──

async function main() {
  const browser = await launchBrowser();
  let ctx;
  try {
    ctx = await createContext(browser);
    const page = await setupPage(ctx, COOKIE_RAW);

    // 拦截视频详情 API
    let apiData = '';
    const apiPromise = page.waitForResponse(
      r => r.url().includes('/aweme/v1/web/aweme/detail/') && r.status() === 200,
      { timeout: 20000 }
    ).catch(() => null);

    console.error(`⏳ 打开视频页面: https://www.douyin.com/video/${AWEME_ID}`);
    await page.goto(`https://www.douyin.com/video/${AWEME_ID}`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });

    const apiResp = await apiPromise;
    if (apiResp) {
      try { apiData = await apiResp.text(); } catch (_) {}
    }

    // 优先 API 解析
    if (apiData && apiData.length > 100) {
      const result = parseApiResponse(apiData);
      if (result.source === 'api') {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
    }

    // 降级 DOM 抓取
    console.error('⚠️ API 拦截失败，降级为 DOM 抓取');
    try {
      await page.waitForSelector('video', { timeout: 15000 });
    } catch {
      console.error('⚠️ 未检测到 video 元素');
    }
    await page.waitForTimeout(5000);

    const domData = await scrapeFromDom(page);
    console.log(JSON.stringify(domData, null, 2));

  } finally {
    if (ctx) await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch(e => {
  console.error('VIDEO_DETAIL_ERROR:' + e.message);
  process.exit(5);
});
