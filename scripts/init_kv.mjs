/**
 * 初始化 Cloudflare KV 数据（将本地版数据文件迁移到 KV）
 * 前置：已完成 wrangler 登录（wrangler login 或 CLOUDFLARE_API_TOKEN）
 * 运行：npm run init:kv
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// [KV key, 本地数据文件路径]
const FILES = [
  ['config', 'E:/aipaqu/server/data/config.json'],
  ['users', 'E:/aipaqu/server/data/users.json'],
  ['clz', 'E:/aipaqu/server/data/clz.json'],
  ['cust', 'E:/aipaqu/server/data/cust.json'],
  ['page', 'E:/aipaqu/server/data/page.json'],
  ['rule', 'E:/aipaqu/server/parse_rule.txt'],
];

for (const [key, path] of FILES) {
  if (!existsSync(path)) {
    console.error(`[跳过] 文件不存在: ${path}`);
    continue;
  }
  const cmd = `wrangler kv key put --binding=AIPAQ_DATA "${key}" --path="${path}"`;
  console.log(`>>> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', shell: true });
  console.log(`[完成] ${key} <- ${path}`);
}

console.log('\nKV 数据初始化完成');
