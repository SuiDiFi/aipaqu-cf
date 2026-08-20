# AI智能统计系统（Cloudflare 部署版）

本地版（E:\aipaqu）的云端部署版本。前端静态资源与本地版一致，后端由 Python 重写为 Cloudflare Pages Functions（JavaScript），数据存于 Cloudflare KV。

## 架构

| 组件 | 本地版 | Cloudflare 版 |
|---|---|---|
| 前端（index.html / css / js / element-ui / fonts / wasm） | E:\aipaqu | 本仓库根目录（Pages 静态托管） |
| 后端接口（/customer/* 8个 + /admin/* 11个） | server.py（Python http.server） | functions/[[path]].js（Pages Functions） |
| 数据（config/users/clz/cust/page.json、parse_rule.txt） | server/data 本地文件 | Cloudflare KV（binding: AIPAQ_DATA） |
| wasm 核心计算（订单解析/对单/校验） | 浏览器端本地运行 | 浏览器端本地运行（不变） |
| 科目/客户配置、订单数据 | 浏览器 localStorage | 浏览器 localStorage（不变） |

## KV 键设计

| Key | 内容 |
|---|---|
| config | {password, end_time} |
| users | [{username, password}, ...] |
| clz | 科目列表 |
| cust | 客户/上家配置 {clz: {a, b, c}} |
| page | 页面文案配置 |
| rule | 解析规则文本（63KB，业务端经 /customer/ping 下发） |
| fail_count | 登录失败计数（10 次机会） |

会话 token 为无状态 HMAC 签名（payload = username|end_time），无需存储，密钥由 `SECRET` 变量提供。

## 本地开发

```bash
npm install
wrangler pages dev . --kv AIPAQ_DATA
```

## 部署流程

1. 登录：`wrangler login`（或设置 `CLOUDFLARE_API_TOKEN`）
2. 创建 KV：`wrangler kv namespace create AIPAQ_DATA`，将 id 填入 wrangler.toml
3. 初始化数据：`npm run init:kv`（从本地版迁移 config/users/clz/cust/page/rule）
4. 部署：`npm run deploy`
5. 设置密钥：`wrangler secret put SECRET`

部署完成后访问 `https://aipaqu-cf.pages.dev`。

## 与本地版差异

- 无本地文件系统：数据全部存 KV（最终一致，写入后立即读取可能短暂不一致，可接受）
- 无内存会话：token 无状态化，登出仅清理前端 localStorage
- 登录失败计数存 KV，跨实例共享
