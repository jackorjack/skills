#!/usr/bin/env node
// 提取抖音视频元数据（video page scraper）

const path = require('path');
const fs = require('fs');

const STEALTH_NM = '/home/ubuntu/.openclaw/workspace/skills/xthezealot-stealth-browser/node_modules';
module.paths.unshift(STEALTH_NM);

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

const VIDEO_ID = process.argv[2] || '7176193748026592547';

(async () => {
  const browser = await chromium.launch({
    headless: true, executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--window-size=1920,1080','--disable-blink-features=AutomationControlled']
  });
  
  let ctx;
  try {
    ctx = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const page = await ctx.newPage();

    // Intercept video detail API
    let apiData = '';
    page.on('response', async r => {
      const url = r.url();
      if (url.includes('/aweme/v1/web/aweme/detail/') && !apiData) {
        try { apiData = await r.text(); } catch(e) {}
      }
    });

    // Load cookies
    const raw = fs.readFileSync(__dirname + '/cookie.txt', 'utf-8').trim();
    const LOGIN_NAMES = new Set(['sessionid','sessionid_ss','sid_guard','sid_tt','uid_tt','uid_tt_ss','passport_csrf_token','passport_csrf_token_default','passport_auth_mix_state','passport_assist_user','sid_ucp_v1','ssid_ucp_v1','session_tlb_tag','is_staff_user','has_biz_token','login_time','IsDouyinActive','n_mh','odin_tt']);
    const cookies = raw.split('; ').filter(p => LOGIN_NAMES.has(p.split('=')[0].trim())).map(p => { const idx = p.indexOf('='); return { name: p.substring(0, idx).trim(), value: p.substring(idx + 1), domain: '.douyin.com', path: '/' }; });

    await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    await ctx.addCookies(cookies);

    // Navigate to video and wait for API
    const apiPromise = page.waitForResponse(
      r => r.url().includes('/aweme/v1/web/aweme/detail/') && r.status() === 200,
      { timeout: 20000 }
    ).catch(() => null);

    await page.goto(`https://www.douyin.com/video/${VIDEO_ID}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    const apiResp = await apiPromise;
    if (apiResp) {
      try { apiData = await apiResp.text(); } catch(e) {}
    }
    
    // If API didn't fire, try to extract from page
    if (!apiData || apiData.length < 100) {
      await page.waitForTimeout(5000);
      // Try to get video src
      const info = await page.evaluate(() => {
        const v = document.querySelector('video');
        return {
          src: v?.src || v?.currentSrc || '',
          title: document.querySelector('h1')?.innerText || '',
          allText: document.body?.innerText?.substring(0, 2000) || '',
        };
      }).catch(() => ({src:'',title:'',allText:''}));
      
      console.log(JSON.stringify({
        source: 'page_evaluate',
        videoSrc: info.src,
        title: info.title,
        text: info.allText,
      }, null, 2));
    }

    // Parse API response
    if (apiData && apiData.length > 100) {
      // Clean chunked encoding
      let clean = apiData;
      if (!clean.startsWith('{')) {
        clean = clean.replace(/^[0-9a-f]+\r\n/gm, '').replace(/\r\n[0-9a-f]+\r\n/g, '\n').replace(/\r\n0\r\n\r\n$/, '');
      }
      
      try {
        const obj = JSON.parse(clean);
        const aweme = obj.aweme_detail || obj.data?.aweme_detail || {};
        const info = aweme;
        
        // Get video URL
        const videoPlay = info.video?.play_addr || info.video?.play_addr_265 || {};
        const urlList = videoPlay.url_list || [];
        
        // Music / audio
        const music = info.music || {};
        
        console.log(JSON.stringify({
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
        }, null, 2));
      } catch(e) {
        console.log(JSON.stringify({ source: 'api_raw', raw: apiData.substring(0, 3000), error: e.message }, null, 2));
      }
    }

  } finally {
    if (ctx) await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }
})();
