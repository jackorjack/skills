# Cookie 提示话术

当脚本退出码为 2/3/4 时，使用对应话术向用户索要 Cookie。

## 退出码 2：Cookie 缺失

> 老板，抖音搜索需要登录 Cookie，麻烦提供一下。
>
> **获取方法：** 电脑浏览器登录 `douyin.com` → F12 → Application → Cookies → `www.douyin.com` → 全选复制发给我。

## 退出码 3：Cookie 过期

> 老板，Cookie 过期了（有效期通常 60 天），需要重新提供。
>
> **获取方法：** 重新登录 `douyin.com` → F12 → Application → Cookies → 全选复制发给我。

## 退出码 4：触发验证码

> 搜索触发了抖音验证码，Cookie 可能已失效。请重新登录并提供最新 Cookie。

## 保存方式

收到用户提供的 Cookie 后，直接写入 `scripts/cookie.txt` 覆盖旧文件即可。

## 注意事项

- 从 `www.douyin.com` 域名下复制，不要遗漏
- Cookie 有效期约 60 天（由 `sid_guard` 字段决定）
- 脚本会提前 1 小时判定过期，留出缓冲时间
