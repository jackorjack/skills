---
name: wechat-typeset-publish
version: 1.1.0
description: "微信公众号排版和发布 — 用5种主题将 Markdown 排版为公众号专用 HTML，一键上传到草稿箱。支持多公众号账号管理。排版引擎来自 wechat-mp-suite（多主题、标准Markdown解析、全内联样式），发布功能来自 magicx-wechat-publisher（Node.js 调用微信API提交草稿）。当用户要求"公众号排版""排版文章""发布到公众号""上传草稿箱"时触发此技能。"
metadata:
  openclaw:
    emoji: "📝"
    requires:
      bins: ["python3", "node"]
    platforms: ["macos", "linux"]
---

# 微信公众号排版和发布

完整流程：**排版 → 预览 → 上传图片 → 发布草稿箱 → 通知用户**

排版引擎支持 5 种主题、标准 Markdown 语法解析、代码高亮、全内联样式（公众号兼容）。发布脚本通过微信官方 API 直接提交草稿。

---

## 触发词

"公众号排版" / "排版文章" / "帮我排版" / "发布到公众号" / "上传草稿箱" / "发公众号"

---

## 边界

- ✅ 排版：标准 Markdown → 公众号 HTML（5种主题可选）
- ✅ 上传图片：本地图片 → 微信图床 URL（正文图片 + 封面图）
- ✅ 发布：HTML → 微信公众号草稿箱（支持多账号）
- ✅ 通知：上传成功后通知用户检查草稿箱
- ❌ 不做：选题、写作、内容生成（由写作技能负责）

---

## Step 1: 排版（Python 排版引擎）

### 命令

```bash
# 基础排版（输出 body 片段，适合复制到微信编辑器）
python3 {baseDir}/scripts/typeset/cli.py input.md --theme lapis -o output.html

# 完整 HTML（含 section 包装，适合预览）
python3 {baseDir}/scripts/typeset/cli.py input.md --theme lapis --full-html -o output.html

# 从 stdin 读取
echo "# Hello" | python3 {baseDir}/scripts/typeset/cli.py --theme ocean

# 列出所有主题
python3 {baseDir}/scripts/typeset/cli.py --list-themes
```

### 参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `FILE` | 输入的 Markdown 文件路径（省略则从 stdin 读取） | - |
| `--theme, -t` | 主题 ID | lapis |
| `--code-theme, -c` | 代码高亮主题 | solarized-light |
| `--output, -o` | 输出文件路径（默认 stdout） | stdout |
| `--full-html, -f` | 输出完整 HTML（含 section 包装） | 否 |
| `--list-themes, -L` | 列出所有可用主题 | - |

### 5 种主题

| 主题 ID | 名称 | 风格 | 适合场景 |
|---------|------|------|----------|
| `lapis` | 青金石 | 沉稳蓝调，商务清新 | 默认推荐，B端商业文 |
| `forest` | 森林 | 自然绿意，清新舒爽 | 健康/环保/生活类 |
| `ocean` | 海洋 | 深邃海洋，专业沉稳 | 深度专业文章 |
| `sunset` | 日落 | 暖橙色调，温馨活力 | 故事/情感/品牌类 |
| `noir` | 暗夜 | 深色背景，护眼夜读 | 夜间阅读场景 |

### 5 种代码高亮主题

`solarized-light` / `vscode-dark` / `github` / `monokai` / `one-dark`

### 排版引擎特性

- **全内联样式** — 所有样式写在元素 style 属性上，公众号 100% 兼容
- **标准 Markdown 解析** — 支持 h1-h6、粗体/斜体/删除线、代码块、表格、引用、有序/无序列表、嵌套列表、图片、链接、脚注、分割线、任务列表、GitHub 风格警告框
- **代码高亮** — 纯 Python 无依赖，支持 python/javascript/json/html/css/bash，若安装了 pygments 则自动使用
- **主题系统** — 5 种预设主题，每种主题的标题、引用、代码块、表格、链接、分割线样式都不同
- **段落间距** — padding:8px 0、line-height:1.8，阅读体验舒适（不会像 3px 间距那样挤在一起）

### Markdown 格式要求（重要！）

排版引擎依靠标准 Markdown 语法标记来匹配样式。**如果 md 文件没有使用 Markdown 语法，所有内容会被当普通段落处理，样式出不来。**

必须包含的 Markdown 标记：

| 元素 | 语法 | 效果 |
|------|------|------|
| 文章标题 | `# 标题` | 居中大字 |
| 章节标题 | `## 小标题` | 带底边框的主题色标题 |
| 三级标题 | `### 小标题` | 主题色加粗 |
| 加粗 | `**文字**` | 主题色加粗 |
| 引用块 | `> 引用内容` | 带背景色+左边框+圆角 |
| 分割线 | `---` | 章节分隔 |
| 代码块 | \`\`\`语言 | 带语法高亮 |
| 表格 | `\| 表头 \|` | 主题色表头 |
| 图片 | `![描述](url)` | 居中+圆角 |
| 链接 | `[文字](url)` | 主题色下划线 |

---

## Step 2: 预览（可选）

排版后生成的是 HTML 片段（`<section>` 包装），浏览器直接打开看不到完整页面。如需预览，用以下方式包装：

```bash
# 生成预览版（带完整 HTML 外壳）
cat > preview.html << 'WRAPPER'
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>公众号文章预览</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #f5f5f5; padding: 20px 0; }
.preview-wrapper { max-width: 677px; margin: 0 auto; background: #fff; padding: 20px 0; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
</style>
</head>
<body>
<div class="preview-wrapper">
WRAPPER
cat output.html >> preview.html
echo '</div></body></html>' >> preview.html
```

---

## Step 3: 上传图片（Agent 执行，如有图片）

> 此步骤由 Agent 通过 curl 调用微信 API 完成，不通过脚本。

如果文章中包含本地图片，需要先上传到微信图床，否则公众号无法显示。

### 3.1 获取 access_token

从 `scripts/.wechat-config.json` 读取 appid 和 secret，调用微信 API：

```bash
curl -s "https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid={APPID}&secret={SECRET}"
```

返回 `access_token`，后续步骤都需要用到。

### 3.2 上传正文图片

将文章中的本地图片上传到微信图床，获取可用的 URL：

```bash
curl -s -X POST "https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token={TOKEN}" \
  -F "media=@/path/to/image.jpg"
```

返回微信图床 URL（`https://mmbiz.qpic.cn/...`），替换 HTML 中对应的 `<img src="...">`。

### 3.3 上传封面图（可选）

封面图需上传为永久素材，获取 media_id（发布时需要）：

```bash
curl -s -X POST "https://api.weixin.qq.com/cgi-bin/material/add_material?type=image&access_token={TOKEN}" \
  -F "media=@/path/to/cover.jpg"
```

返回 `media_id`，在 Step 4 发布草稿时可传入 `--thumb-media-id` 参数。

### 3.4 替换图片 src

将排版生成的 HTML 中所有本地图片路径替换为微信图床 URL：

```
原: <img src="/path/to/local/image.jpg" ...>
替: <img src="https://mmbiz.qpic.cn/..." ...>
```

---

## 排版规范（发布前 HTML 处理）

排版引擎生成的 HTML 已经是全内联样式，但发布前还需要做以下处理：

### 全局规则

- **所有样式必须内联**，禁止 `<style>` 标签和 CSS class（排版引擎已保证）
- **正文不含 `<h1>` 标题**（标题由公众号系统自动渲染），如 md 中有 `# 标题`，发布前应移除 `<h1>` 标签或将其改为摘要引导块
- **所有图片 src 必须是微信图床 URL**（Step 3 上传后替换），不能是本地路径或外部链接

### 摘要引导块

文章开头建议用摘要引导块代替标题，帮助读者快速了解文章核心内容：

```html
<section style="margin:10px 0 15px;padding:15px 20px;background:#f7f8fa;border-left:4px solid #2b6cb0;font-size:15px;color:#555;line-height:1.6;">
  一句话概括文章核心观点，吸引读者继续阅读。
</section>
```

> 摘要引导块的边框颜色建议与所选主题的 accent 色一致：
> - lapis: `#2b6cb0` | forest: `#276749` | ocean: `#1a365d` | sunset: `#c05621` | noir: `#38bdf8`

### 落款（可选）

文末可添加作者落款：

```html
<p style="margin-top:20px;padding-top:10px;border-top:1px solid #eee;font-size:14px;color:#999;text-align:center;line-height:2;">
  作者名 / 公众号名
</p>
```

### 禁止事项

- ❌ 使用 `<style>` 标签或 CSS class
- ❌ 正文包含 `<h1>`（标题由公众号系统渲染）
- ❌ 使用 base64 图片（必须上传到微信图床）
- ❌ 图片 src 为本地路径或外部链接（必须替换为微信图床 URL）
- ❌ 使用 `<div>` 模拟分割线（必须用 `<hr>`）

---

## Step 4: 发布到草稿箱（Node.js）

### 命令

```bash
# 使用默认账号直接上传
node {baseDir}/scripts/upload-draft.js --html output.html --title "文章标题"

# 指定账号上传
node {baseDir}/scripts/upload-draft.js --html output.html --title "文章标题" --account <账号名>

# 指定作者
node {baseDir}/scripts/upload-draft.js --html output.html --title "文章标题" --account <账号名> --author "作者名"

# 添加新账号
node {baseDir}/scripts/upload-draft.js --appid <APPID> --secret <SECRET> --save-config --account <账号名> --label "账号标签"

# 列出所有账号
node {baseDir}/scripts/upload-draft.js --list-accounts

# 设为默认账号
node {baseDir}/scripts/upload-draft.js --account <账号名> --set-default

# 删除账号
node {baseDir}/scripts/upload-draft.js --remove-account <账号名>
```

### 参数说明

| 参数 | 说明 |
|------|------|
| `--html <path>` | HTML 文章文件路径（必填） |
| `--title <title>` | 文章标题（必填） |
| `--account <name>` | 指定使用的公众号账号（默认使用 default 账号） |
| `--author <name>` | 文章作者（默认: 有用AI） |
| `--thumb-media-id <id>` | 封面图 media_id（可选） |
| `--cover-image <path>` | 封面图文件路径（可选） |
| `--appid <id>` | 公众号 AppID（添加账号时使用） |
| `--secret <secret>` | 公众号 AppSecret（添加账号时使用） |
| `--label <label>` | 账号标签/备注（添加账号时使用） |
| `--save-config` | 保存 AppID/Secret 到本地 |
| `--set-default` | 将指定账号设为默认账号 |
| `--list-accounts` | 列出所有已保存的账号 |
| `--remove-account <name>` | 删除指定账号 |

### 发布流程

1. 从 `scripts/.wechat-config.json` 读取指定账号的 AppID/Secret
2. 调用微信 API 获取 access_token
3. 读取 HTML 文件，提取 body 内容
4. 通过 `POST /cgi-bin/draft/add` 提交到草稿箱
5. 返回 media_id

### 多账号管理

配置文件 `scripts/.wechat-config.json` 支持存储多个公众号账号：

```json
{
  "default": "qisheng",
  "accounts": {
    "qisheng": {
      "appid": "wxc5113696807e7d46",
      "secret": "***",
      "label": "企盛教育"
    },
    "another": {
      "appid": "wx1234567890abcdef",
      "secret": "***",
      "label": "另一个号"
    }
  }
}
```

- `default`：默认使用的账号名，`--account` 省略时使用
- `accounts`：所有账号的 AppID/Secret 映射
- `label`：账号备注，仅用于显示，不影响 API 调用

### 配置说明

- AppID/Secret 存放于 `scripts/.wechat-config.json`（本地文件，请勿提交到版本控制）
- 每个公众号的服务器公网 IP 需分别加入各自公众号后台的 IP 白名单
- 脚本仅使用 Node.js 内置模块（https, fs, path），无需安装额外依赖

---

## Step 5: 通知用户

上传成功后通知用户：

1. 去公众号后台 → **内容与互动** → **草稿箱** 中检查草稿
2. 如有封面图，在草稿编辑页面手动设置封面图
3. 确认内容无误后点击发布
4. 提示用户：如需修改，可在草稿箱中编辑后重新发布

---

## 完整工作流示例

```
1. 排版：python3 {baseDir}/scripts/typeset/cli.py article.md --theme lapis -o article.html
2. 预览：用 Step 2 的方法包装为 preview.html，浏览器打开查看效果
3. 上传图片（如有）：curl 调用微信 API 上传正文图片和封面图，替换 HTML 中的图片 src
4. 发布：node {baseDir}/scripts/upload-draft.js --html article.html --title "文章标题" --account <账号名>
5. 通知用户去公众号后台 → 内容与互动 → 草稿箱 查看
```

---

## 文件结构

```
wechat-typeset-publish/
├── SKILL.md                          # 技能定义（本文件）
└── scripts/
    ├── typeset/                      # 排版模块（Python）
    │   ├── __init__.py
    │   ├── cli.py                    # CLI 入口
    │   ├── typeset.py                # 核心排版引擎
    │   ├── themes.py                 # 5种文章主题
    │   ├── code_themes.py            # 5种代码高亮主题
    │   └── syntax_highlight.py       # 语法高亮引擎
    ├── upload-draft.js               # 发布脚本（Node.js）
    └── .wechat-config.json           # 微信公众号凭证（本地文件）
```

---

## 注意事项

- 排版引擎要求 md 文件使用**标准 Markdown 语法**（# 标题、**加粗**、> 引用、--- 分割线等），纯文本不带标记的 md 不会生成样式
- 发布前请确保服务器 IP 已加入公众号后台白名单
- HTML 内容不超过 2MB（微信 API 限制）
- **正文图片必须先上传到微信图床**（Step 3），本地路径或外部链接在公众号中无法显示
- **正文不含 `<h1>` 标签**（标题由公众号系统自动渲染），发布前将 h1 移除或改为摘要引导块
- 封面图可在草稿箱中手动设置，或通过 Step 3.3 上传为永久素材后传入 media_id
- `noir`（暗夜）主题使用深色背景，适合夜间阅读场景但不适合所有公众号风格

---

## 技术来源

- **排版引擎**：来自 wechat-mp-suite 技能（Python 排版引擎，5主题系统，全内联样式）
- **发布脚本**：来自 magicx-wechat-publisher 技能（Node.js 调用微信 API 提交草稿）
- 合并两者优势：好的排版 + 可靠的发布，去掉多余模块（搜索/爬虫/写作/洗稿等）
