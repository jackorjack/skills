// 抖音搜索技能 — 公共模块
// 统一 Cookie 解析、浏览器启动、API 解析、格式化等逻辑

const path = require('path');
const fs = require('fs');
const os = require('os');

// ── 路径 ──

const SKILL_DIR = path.resolve(__dirname, '..');
const COOKIE_FILE = path.join(SKILL_DIR, 'cookie.txt');

// ── Stealth Browser 路径 ──

const STEALTH_NM = path.join(os.homedir(), '.openclaw', 'workspace', 'skills', 'xthezealot-stealth-browser', 'node_modules');
module.paths.unshift(STEALTH_NM);

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

// ── Cookie 键名白名单 ──

const LOGIN_NAMES = new Set([
  'sessionid','sessionid_ss','sid_guard','sid_tt','uid_tt','uid_tt_ss',
  'passport_csrf_token','passport_csrf_token_default','passport_auth_mix_state',
  'passport_assist_user','sid_ucp_v1','ssid_ucp_v1','session_tlb_tag',
  'is_staff_user','has_biz_token','login_time','IsDouyinActive','n_mh','odin_tt'
]);

// ── 浏览器启动配置 ──

const BROWSER_CONFIG = {
  headless: true,
  executablePath: '/usr/bin/chromium-browser',
  args: [
    '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
    '--disable-gpu','--window-size=1920,1080','--disable-blink-features=AutomationControlled',
  ],
};

const CONTEXT_CONFIG = {
  viewport: { width: 1920, height: 1080 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

// ── Cookie 读取与校验 ──

function readCookieRaw() {
  if (!fs.existsSync(COOKIE_FILE)) return null;
  const raw = fs.readFileSync(COOKIE_FILE, 'utf-8').trim();
  return raw.length >= 100 ? raw : null;
}

function checkCookie() {
  const raw = readCookieRaw();
  if (!raw) { console.error('NO_COOKIE'); process.exit(2); }

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

function parseCookies(raw) {
  return raw.split('; ')
    .filter(p => LOGIN_NAMES.has(p.split('=')[0].trim()))
    .map(p => {
      const idx = p.indexOf('=');
      return { name: p.substring(0, idx).trim(), value: p.substring(idx + 1), domain: '.douyin.com', path: '/' };
    });
}

// ── 浏览器启动 ──

async function launchBrowser() {
  return chromium.launch(BROWSER_CONFIG);
}

async function createContext(browser) {
  return browser.newContext(CONTEXT_CONFIG);
}

async function setupPage(context, cookieRaw) {
  const page = await context.newPage();
  // 首页建立信任
  await page.goto('https://www.douyin.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  // 注入 Cookie
  await context.addCookies(parseCookies(cookieRaw));
  return page;
}

// ── 响应解析 ──

function stripChunkedEncoding(body) {
  if (!body.startsWith('{')) {
    return body
      .replace(/^[0-9a-f]+\r\n/gm, '')
      .replace(/\r\n[0-9a-f]+\r\n/g, '\n')
      .replace(/\r\n0\r\n\r\n$/, '');
  }
  return body;
}

// ── 格式化 ──

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

// ── 风控检查 ──

async function checkPageBlocked(page) {
  const title = await page.title();
  if (title.includes('验证码中间页')) { console.error('CAPTCHA_BLOCKED'); process.exit(4); }

  const needLogin = await page.evaluate(() =>
    document.body?.innerText?.includes('登录后即可搜索'),
  ).catch(() => false);
  if (needLogin) { console.error('COOKIE_EXPIRED'); process.exit(3); }
}

module.exports = {
  SKILL_DIR,
  COOKIE_FILE,
  LOGIN_NAMES,
  BROWSER_CONFIG,
  CONTEXT_CONFIG,
  chromium,
  readCookieRaw,
  checkCookie,
  parseCookies,
  launchBrowser,
  createContext,
  setupPage,
  stripChunkedEncoding,
  formatNumber,
  formatDate,
  formatDuration,
  checkPageBlocked,
};
