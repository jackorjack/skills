#!/usr/bin/env node

const path = require('path');
const fs = require('fs');

const STEALTH_NM = '/home/ubuntu/.openclaw/workspace/skills/xthezealot-stealth-browser/node_modules';
module.paths.unshift(STEALTH_NM);

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

(async () => {
  const browser = await chromium.launch({
    headless: true, executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--window-size=1920,1080','--disable-blink-features=AutomationControlled']
  });
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await ctx.newPage();

  // 拦截 API 响应
  const apiPromise = page.waitForResponse(
    r => r.url().includes('/aweme/v1/web/general/search/stream/') && r.status() === 200,
    { timeout: 30000 }
  );

  const raw = fs.readFileSync(__dirname + '/cookie.txt', 'utf-8').trim();
  const LOGIN_NAMES = new Set(['sessionid','sessionid_ss','sid_guard','sid_tt','uid_tt','uid_tt_ss','passport_csrf_token','passport_csrf_token_default','passport_auth_mix_state','passport_assist_user','sid_ucp_v1','ssid_ucp_v1','session_tlb_tag','is_staff_user','has_biz_token','login_time','IsDouyinActive','n_mh','odin_tt']);
  const cookies = raw.split('; ').filter(p => LOGIN_NAMES.has(p.split('=')[0].trim())).map(p => { const idx = p.indexOf('='); return { name: p.substring(0, idx).trim(), value: p.substring(idx + 1), domain: '.douyin.com', path: '/' }; });

  await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  await ctx.addCookies(cookies);
  await page.goto('https://www.douyin.com/search/' + encodeURIComponent('纸箱厂') + '?type=general', { waitUntil: 'domcontentloaded', timeout: 30000 });

  const apiResp = await apiPromise;
  const apiBody = await apiResp.text();
  console.error('API body length:', apiBody.length);
  fs.writeFileSync('/tmp/douyin_search_raw.json', apiBody);

  // 解析第一条
  const lines = apiBody.split('\n').filter(l => l.trim());
  console.error('lines:', lines.length);

  for (const line of lines.slice(0, 3)) {
    try {
      const obj = JSON.parse(line);
      const data = obj.data || obj;
      const awemeList = data.aweme_list || (data.data && data.data.aweme_list) || [];
      console.error('awemeList length:', awemeList.length);
      for (const aweme of awemeList.slice(0, 2)) {
        const info = aweme.aweme_info || aweme;
        console.log(JSON.stringify({
          aweme_id: info.aweme_id,
          duration: info.duration,
          duration_ms: info.video?.duration,
          author_follower_count: info.author?.follower_count,
          author_followers_detail: info.author?.followers_detail,
          author_fans_count: info.author?.fans_count,
          author_total_favorited: info.author?.total_favorited,
          statistics: info.statistics,
        }));
      }
    } catch(e) { console.error('parse error:', e.message); }
  }

  await ctx.close();
  await browser.close();
})();
