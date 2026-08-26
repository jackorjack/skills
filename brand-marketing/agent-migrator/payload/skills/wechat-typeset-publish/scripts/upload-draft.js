#!/usr/bin/env node
/**
 * 微信公众号草稿箱API自动上传工具（多账号版）
 *
 * @package  wechat-publisher (ClawHub Skill)
 * @author   magicx
 * @email    youyouyoumagic@gmail.com
 * @wechat   公众号「有用AI」| 视频号「有用AI」
 * @license  ISC
 *
 * 功能：
 * 1. 支持多公众号账号管理
 * 2. 通过微信API将文章上传到公众号草稿箱
 * 3. 支持HTML格式内容
 * 4. 自动获取 access_token 并提交草稿
 *
 * 使用方式：
 *   node upload-draft.js --html <文件路径> --title "标题" --account <账号名>
 *   node upload-draft.js --list-accounts
 *   node upload-draft.js --appid <appid> --secret *** --save-config --account <账号名> --label "账号标签"
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ======== 配置 ========
const CONFIG_FILE = path.join(__dirname, '.wechat-config.json');

// ======== 参数解析 ========
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--appid') opts.appid = args[++i];
    else if (args[i] === '--secret') opts.secret = args[++i];
    else if (args[i] === '--html') opts.html = args[++i];
    else if (args[i] === '--title') opts.title = args[++i];
    else if (args[i] === '--author') opts.author = args[++i];
    else if (args[i] === '--thumb-media-id') opts.thumbMediaId = args[++i];
    else if (args[i] === '--cover-image') opts.coverImage = args[++i];
    else if (args[i] === '--account') opts.account = args[++i];
    else if (args[i] === '--label') opts.label = args[++i];
    else if (args[i] === '--save-config') opts.saveConfig = true;
    else if (args[i] === '--set-default') opts.setDefault = true;
    else if (args[i] === '--list-accounts') opts.listAccounts = true;
    else if (args[i] === '--remove-account') opts.removeAccount = args[++i];
    else if (args[i] === '--help' || args[i] === '-h') {
      showHelp();
      process.exit(0);
    }
  }
  return opts;
}

function showHelp() {
  console.log(`
微信公众号草稿箱API上传工具（多账号版）
by magicx | 公众号/视频号: 有用AI | youyouyoumagic@gmail.com

用法:
  node upload-draft.js --html <文件> --title <标题> [--account <账号名>] [--author <作者>]

参数:
  --html <path>        HTML文章文件路径
  --title <title>      文章标题
  --account <name>     指定使用的公众号账号（默认使用 default 账号）
  --author <name>      文章作者（默认: 有用AI）
  --thumb-media-id <id>  封面图media_id（可选）
  --cover-image <path>   封面图文件路径（可选）
  --appid <id>         公众号AppID（首次保存配置时使用）
  --secret ***         公众号AppSecret（首次保存配置时使用）
  --label <label>      账号标签/备注（保存配置时使用）
  --save-config        保存AppID和Secret到本地
  --set-default        将当前账号设为默认账号
  --list-accounts      列出所有已保存的账号
  --remove-account <name>  删除指定账号
  -h, --help           显示帮助

账号管理:
  # 添加第一个账号
  node upload-draft.js --appid xxx --secret *** --save-config --account myaccount --label "我的公众号"
  
  # 添加更多账号
  node upload-draft.js --appid yyy --secret *** --save-config --account another --label "另一个号"
  
  # 设为默认账号
  node upload-draft.js --account myaccount --set-default
  
  # 列出所有账号
  node upload-draft.js --list-accounts
  
  # 使用指定账号发布
  node upload-draft.js --html article.html --title "标题" --account myaccount

  # 删除账号
  node upload-draft.js --remove-account myaccount
`);
}

// ======== 配置管理 ========
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return { default: null, accounts: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    // 兼容旧格式：直接包含 appid/secret 的配置
    if (raw.appid && raw.secret && !raw.accounts) {
      return {
        default: 'default',
        accounts: {
          default: { appid: raw.appid, secret: raw.secret, label: '默认账号' }
        }
      };
    }
    return raw;
  } catch (e) {
    return { default: null, accounts: {} };
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  console.log(`✅ 配置已保存到 ${CONFIG_FILE}`);
}

// ======== 微信API调用 ========
function httpsRequest(url, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      options.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(data));
    }

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (result.errcode && result.errcode !== 0) {
            reject(new Error(`API错误 ${result.errcode}: ${result.errmsg}`));
          } else {
            resolve(result);
          }
        } catch (e) {
          reject(new Error('响应解析失败: ' + body));
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

// 获取access_token
async function getAccessToken(appid, secret) {
  console.log('🔑 正在获取access_token...');
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`;
  const result = await httpsRequest(url);
  console.log(`✅ access_token获取成功（有效期7200秒）`);
  return result.access_token;
}

// 上传封面图（永久素材）
async function uploadCoverImage(accessToken, imagePath) {
  console.log('🖼️  正在上传封面图...');
  const boundary = '----WechatUpload' + Date.now();
  const imageData = fs.readFileSync(imagePath);
  const filename = path.basename(imagePath);

  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`),
    imageData,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  return new Promise((resolve, reject) => {
    const urlObj = new URL(`https://api.weixin.qq.com/cgi-bin/material/add_material?type=image&access_token=***}`);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (result.errcode && result.errcode !== 0) {
            reject(new Error(`封面图上传失败 ${result.errcode}: ${result.errmsg}`));
          } else {
            console.log(`✅ 封面图上传成功 media_id: ${result.media_id}`);
            resolve(result.media_id);
          }
        } catch (e) {
          reject(new Error('封面图响应解析失败: ' + body));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// 生成默认封面图
async function generateDefaultCover(title) {
  console.log('🎨 正在生成默认封面图...');
  const { execSync } = require('child_process');
  const coverPath = '/tmp/wechat_cover_default.jpg';
  try {
    const safeTitle = title.replace(/'/g, "'\\''");
    execSync(`python3 -c "
from PIL import Image, ImageDraw, ImageFont
img = Image.new('RGB', (900, 500), color=(43, 108, 176))
draw = ImageDraw.Draw(img)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc', 42)
except:
    font = ImageFont.load_default()
text = '${safeTitle}'
bbox = draw.textbbox((0, 0), text, font=font)
tw = bbox[2] - bbox[0]
draw.text(((900-tw)//2, 200), text, fill='white', font=font)
img.save('${coverPath}', 'JPEG', quality=85)
"`, { stdio: 'pipe' });
    console.log('✅ 默认封面图生成完成');
    return coverPath;
  } catch (e) {
    console.log('⚠️  封面图生成失败，将跳过封面图上传');
    return null;
  }
}

// 新增草稿
async function addDraft(accessToken, { title, author, content, thumbMediaId }) {
  console.log('📝 正在上传草稿到公众号...');

  const url = `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${accessToken}`;
  const data = {
    articles: [{
      title: title,
      author: author || '有用AI',
      digest: '',
      content: content,
      content_source_url: '',
      thumb_media_id: thumbMediaId || '',
      need_open_comment: 0,
      only_fans_can_comment: 0
    }]
  };

  const result = await httpsRequest(url, 'POST', data);
  console.log(`✅ 草稿上传成功！media_id: ${result.media_id}`);
  console.log(`📱 请在公众号后台 → 内容与互动 → 草稿箱 中查看`);
  return result.media_id;
}

// 列出所有账号
function listAccounts(config) {
  const accounts = config.accounts;
  const names = Object.keys(accounts);
  if (names.length === 0) {
    console.log('📭 暂无已保存的账号');
    console.log('   使用 --appid --secret --save-config --account <name> 添加第一个账号');
    return;
  }
  console.log(`\n📋 已保存的公众号账号 (${names.length}个):\n`);
  for (const name of names) {
    const acc = accounts[name];
    const isDefault = name === config.default ? ' ⭐默认' : '';
    const label = acc.label ? ` - ${acc.label}` : '';
    console.log(`  ${name}${isDefault}${label}`);
    console.log(`    AppID: ${acc.appid}`);
  }
  console.log('');
}

// ======== 主流程 ========
async function main() {
  const opts = parseArgs();
  const config = loadConfig();

  // 列出账号
  if (opts.listAccounts) {
    listAccounts(config);
    process.exit(0);
  }

  // 删除账号
  if (opts.removeAccount) {
    const name = opts.removeAccount;
    if (!config.accounts[name]) {
      console.log(`❌ 账号 "${name}" 不存在`);
      console.log('   使用 --list-accounts 查看所有账号');
      process.exit(1);
    }
    delete config.accounts[name];
    if (config.default === name) {
      config.default = Object.keys(config.accounts)[0] || null;
    }
    saveConfig(config);
    console.log(`✅ 账号 "${name}" 已删除`);
    if (config.default) {
      console.log(`   当前默认账号: ${config.default}`);
    }
    process.exit(0);
  }

  // 保存配置（添加/更新账号）
  if (opts.saveConfig) {
    if (!opts.appid || !opts.secret) {
      console.log('❌ --save-config 需要同时提供 --appid 和 --secret');
      process.exit(1);
    }
    const name = opts.account || 'default';
    config.accounts[name] = {
      appid: opts.appid,
      secret: opts.secret,
      label: opts.label || name
    };
    if (!config.default) {
      config.default = name;
    }
    if (opts.setDefault) {
      config.default = name;
    }
    saveConfig(config);
    console.log(`✅ 账号 "${name}"${opts.label ? ' (' + opts.label + ')' : ''} 已保存`);
    console.log(`   当前默认账号: ${config.default}`);
    if (Object.keys(config.accounts).length === 1) {
      console.log(`   下次直接使用: node upload-draft.js --html <文件> --title <标题>`);
    }
    process.exit(0);
  }

  // 设为默认账号
  if (opts.setDefault) {
    const name = opts.account || config.default;
    if (!config.accounts[name]) {
      console.log(`❌ 账号 "${name}" 不存在`);
      process.exit(1);
    }
    config.default = name;
    saveConfig(config);
    console.log(`✅ 默认账号已设为 "${name}"`);
    process.exit(0);
  }

  // 确定使用的账号
  const accountName = opts.account || config.default;
  if (!accountName) {
    console.log('❌ 未指定账号，也没有默认账号');
    console.log('   首次使用: node upload-draft.js --appid xxx --secret *** --save-config --account <账号名>');
    console.log('   或使用 --help 查看帮助');
    process.exit(1);
  }

  const account = config.accounts[accountName];
  if (!account) {
    console.log(`❌ 账号 "${accountName}" 不存在`);
    console.log('   使用 --list-accounts 查看所有已保存的账号');
    process.exit(1);
  }

  const appid = opts.appid || account.appid;
  const secret = opts.secret || account.secret;

  if (!appid || !secret) {
    console.log('❌ 缺少AppID或AppSecret');
    console.log('   使用 --list-accounts 检查账号配置');
    process.exit(1);
  }

  if (!opts.html || !opts.title) {
    console.log('❌ 缺少必要参数');
    console.log('   使用方式: node upload-draft.js --html <文件> --title <标题> [--account <账号名>]');
    console.log('   使用 --help 查看完整帮助');
    process.exit(1);
  }

  console.log(`📱 当前使用账号: ${accountName}${account.label ? ' (' + account.label + ')' : ''}`);

  // 如果没有提供封面图media_id，尝试自动生成并上传
  let thumbMediaId = opts.thumbMediaId || null;
  if (!thumbMediaId) {
    console.log('⚠️  未提供封面图，尝试自动生成...');
  }

  // 读取HTML文件
  const htmlPath = path.resolve(opts.html);
  if (!fs.existsSync(htmlPath)) {
    console.log(`❌ 文件不存在: ${htmlPath}`);
    process.exit(1);
  }

  let htmlContent = fs.readFileSync(htmlPath, 'utf8');

  // 如果是完整HTML，提取body内容
  const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) {
    htmlContent = bodyMatch[1];
  }

  console.log(`📄 已读取文章: ${htmlPath} (${(htmlContent.length / 1024).toFixed(1)}KB)`);

  // 检查内容大小
  if (htmlContent.length > 2000000) { // 2MB
    console.log('❌ 文章内容超过2MB限制');
    process.exit(1);
  }

  try {
    // 1. 获取access_token
    const accessToken = await getAccessToken(appid, secret);

    // 2. 如果没有封面图，自动生成并上传
    if (!thumbMediaId) {
      const coverPath = opts.coverImage || await generateDefaultCover(opts.title);
      if (coverPath && fs.existsSync(coverPath)) {
        try {
          thumbMediaId = await uploadCoverImage(accessToken, coverPath);
        } catch (e) {
          console.log(`⚠️  封面图上传失败: ${e.message}，将不上传封面图`);
        }
      }
    }

    // 3. 上传草稿
    const mediaId = await addDraft(accessToken, {
      title: opts.title,
      author: opts.author,
      content: htmlContent,
      thumbMediaId: thumbMediaId
    });

    console.log('\n🎉 上传完成！');
    console.log(`📱 请在公众号后台查看草稿并发布`);
    console.log(`💡 提示：如需上传封面图，请先在公众号后台手动上传到素材库`);

  } catch (e) {
    console.error('❌ 上传失败:', e.message);
    process.exit(1);
  }
}

main().catch(console.error);