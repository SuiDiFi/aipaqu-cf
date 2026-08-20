/**
 * AI智能统计系统 - Cloudflare Pages Functions 统一 API 处理器
 * 对应本地版 server.py 的全部接口：
 *   /customer/* 业务接口（page/login/ping/getClz/getCust/saveCust/saveClz/logout）
 *   /admin/*    管理接口（overview/getPage/savePage/getUsers/addUser/delUser/
 *                         resetUserPwd/updatePassword/updateEndTime/getRule/updateRule）
 * 数据存储：Cloudflare KV（binding: AIPAQ_DATA）
 *   config -> {password, end_time}
 *   users  -> [{username, password}, ...]
 *   clz    -> 科目列表
 *   cust   -> 客户/上家配置 {clz: {a: rows, b: copyType, c: showType}}
 *   page   -> 页面文案 {key: {title, note, ...}}
 *   rule   -> 解析规则文本（业务端经 /customer/ping 下发，喂给本地 wasm）
 *   fail_count -> 登录失败计数（10 次机会）
 * 会话 token：无状态 HMAC 签名（base64url(payload).sig），payload = username|end_time
 */

const DEFAULT_CONFIG = { password: '3118385477', end_time: '2099-12-31' };

// ---------- 基础工具 ----------
const json = (data, code = 0, msg = 'success') =>
  new Response(JSON.stringify({ code, msg, data }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });

async function readBody(request) {
  try {
    const ct = request.headers.get('Content-Type') || '';
    const text = await request.text();
    if (!text) return {};
    if (ct.includes('application/json')) return JSON.parse(text);
    const params = new URLSearchParams(text);
    const obj = {};
    for (const [k, v] of params) obj[k] = v;
    return obj;
  } catch {
    return {};
  }
}

const kvGet = async (env, key, def) => {
  const v = await env.AIPAQ_DATA.get(key);
  if (v === null) return def;
  try { return JSON.parse(v); } catch { return def; }
};
const kvSet = (env, key, val) => env.AIPAQ_DATA.put(key, JSON.stringify(val));

const getConfig = (env) => kvGet(env, 'config', DEFAULT_CONFIG);

async function getUsers(env) {
  let users = await kvGet(env, 'users', null);
  if (users === null) {
    const cfg = await getConfig(env);
    users = [{ username: 'admin', password: cfg.password }];
    await kvSet(env, 'users', users);
  }
  return users;
}

const getRule = (env) => env.AIPAQ_DATA.get('rule') || '';

// ---------- 无状态签名 token ----------
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64urlEncode = (str) =>
  btoa(String.fromCharCode(...enc.encode(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlDecode = (str) =>
  dec.decode(Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

async function hmacSign(secret, payload) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return b64urlEncode(String.fromCharCode(...new Uint8Array(sig)));
}

const makeToken = async (secret, username, endTime) => {
  const payload = `${username}|${endTime}`;
  const sig = await hmacSign(secret, payload);
  return `${b64urlEncode(payload)}.${sig}`;
};

async function checkToken(env, token) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const secret = env.SECRET || 'aipaqu_cf_secret_2026';
  const decoded = b64urlDecode(payload);
  const expect = await hmacSign(secret, decoded);
  if (expect !== sig) return false;
  const endTime = decoded.split('|')[1];
  if (!endTime) return false;
  return new Date(endTime) > new Date();
}

// ---------- 业务接口 ----------
async function login(body, env) {
  const pwd = body.password || '';
  const users = await getUsers(env);
  const user = users.find((u) => u.password === pwd);
  if (!user) {
    const count = (parseInt(await env.AIPAQ_DATA.get('fail_count')) || 0) + 1;
    await env.AIPAQ_DATA.put('fail_count', String(count));
    const remain = Math.max(0, 10 - count);
    return json(remain, 10, `密码错误，您还有 ${remain} 次机会`);
  }
  await env.AIPAQ_DATA.put('fail_count', '0');
  const cfg = await getConfig(env);
  const token = await makeToken(env.SECRET || 'aipaqu_cf_secret_2026', user.username, cfg.end_time);
  return json({ token, endTime: cfg.end_time, username: user.username }, 0, '用户登录成功');
}

async function ping(body, env) {
  if (!(await checkToken(env, body.token))) return json(null, 999, '登录已失效，请重新登录');
  return json(await getRule(env));
}

async function getClz(body, env) {
  if (!(await checkToken(env, body.token))) return json(null, 999, '登录已失效，请重新登录');
  return json(await kvGet(env, 'clz', []));
}

async function getCust(body, env) {
  if (!(await checkToken(env, body.token))) return json(null, 999, '登录已失效，请重新登录');
  const clz = body.clz || '';
  const allCust = await kvGet(env, 'cust', {});
  const info = allCust[clz] || {};
  const rows = Array.isArray(info.a) ? info.a.map((r) => ({ ...r, clz })) : [];
  return json({ a: rows, b: info.b || 0, c: info.c || 0 });
}

async function saveCust(body, env) {
  if (!(await checkToken(env, body.token))) return json(null, 999, '登录已失效，请重新登录');
  const clz = body.clz || '';
  const rows = Array.isArray(body.userClzs)
    ? body.userClzs.map((r) => (r && typeof r === 'object' ? { ...r, clz } : r))
    : [];
  const allCust = await kvGet(env, 'cust', {});
  allCust[clz] = { a: rows, b: body.copyType || 0, c: body.showType || 0 };
  await kvSet(env, 'cust', allCust);
  return json(null, 0, '保存成功');
}

async function saveClz(body, env) {
  if (!(await checkToken(env, body.token))) return json(null, 999, '登录已失效，请重新登录');
  await kvSet(env, 'clz', Array.isArray(body.userClzs) ? body.userClzs : []);
  return json(null, 0, '保存成功');
}

async function logout() {
  return json(null, 0, '退出成功');
}

// ---------- 管理接口 ----------
async function adminVerify(body, env) {
  const cfg = await getConfig(env);
  if (body.password !== cfg.password) return json(null, 999, '管理密码错误');
  return null;
}

async function adminOverview(body, env) {
  const err = await adminVerify(body, env);
  if (err) return err;
  const clz = await kvGet(env, 'clz', []);
  const cust = await kvGet(env, 'cust', {});
  const cfg = await getConfig(env);
  const page = await kvGet(env, 'page', {});
  const custRows = Object.values(cust).reduce((s, v) => s + (Array.isArray(v.a) ? v.a.length : 0), 0);
  return json({
    clz_count: clz.length,
    cust_clz_count: Object.keys(cust).length,
    cust_count: custRows,
    rule_size: (await getRule(env)).length,
    end_time: cfg.end_time,
    page_fields: Object.keys(page).length,
  });
}

async function adminGetPage(body, env) {
  const err = await adminVerify(body, env);
  if (err) return err;
  return json(await kvGet(env, 'page', {}));
}

async function adminSavePage(body, env) {
  const err = await adminVerify(body, env);
  if (err) return err;
  await kvSet(env, 'page', body.page && typeof body.page === 'object' ? body.page : {});
  return json(null, 0, '页面文案已保存');
}

async function adminGetUsers(body, env) {
  const err = await adminVerify(body, env);
  if (err) return err;
  return json(await getUsers(env));
}

async function adminAddUser(body, env) {
  const err = await adminVerify(body, env);
  if (err) return err;
  const username = (body.username || '').trim();
  const password = (body.userPwd || '').trim();
  if (!username || !password) return json(null, 1, '用户名和密码不能为空');
  if (username === 'admin') return json(null, 1, 'admin 为系统内置管理账号，不可添加');
  const users = await getUsers(env);
  if (users.some((u) => u.username === username)) return json(null, 1, '用户名已存在');
  users.push({ username, password });
  await kvSet(env, 'users', users);
  return json(null, 0, '用户已添加');
}

async function adminDelUser(body, env) {
  const err = await adminVerify(body, env);
  if (err) return err;
  const username = (body.username || '').trim();
  if (!username) return json(null, 1, '用户名不能为空');
  if (username === 'admin') return json(null, 1, '不能删除管理员');
  const users = await getUsers(env);
  const newUsers = users.filter((u) => u.username !== username);
  if (newUsers.length === users.length) return json(null, 1, '用户不存在');
  await kvSet(env, 'users', newUsers);
  return json(null, 0, '用户已删除');
}

async function adminResetUserPwd(body, env) {
  const err = await adminVerify(body, env);
  if (err) return err;
  const username = (body.username || '').trim();
  const password = (body.userPwd || '').trim();
  if (!username || !password) return json(null, 1, '用户名和密码不能为空');
  const users = await getUsers(env);
  const user = users.find((u) => u.username === username);
  if (!user) return json(null, 1, '用户不存在');
  user.password = password;
  await kvSet(env, 'users', users);
  return json(null, 0, '密码已重置');
}

async function adminUpdatePassword(body, env) {
  const err = await adminVerify(body, env);
  if (err) return err;
  const newp = body.newPassword || '';
  if (!newp) return json(null, 1, '新密码不能为空');
  const cfg = await getConfig(env);
  cfg.password = newp;
  await kvSet(env, 'config', cfg);
  return json(null, 0, '登录密码已更新');
}

async function adminUpdateEndTime(body, env) {
  const err = await adminVerify(body, env);
  if (err) return err;
  const et = body.endTime || '';
  if (!et) return json(null, 1, '到期时间不能为空');
  const cfg = await getConfig(env);
  cfg.end_time = et;
  await kvSet(env, 'config', cfg);
  return json(null, 0, '会员到期时间已更新');
}

async function adminGetRule(body, env) {
  const err = await adminVerify(body, env);
  if (err) return err;
  return json({ size: (await getRule(env)).length });
}

async function adminUpdateRule(body, env) {
  const err = await adminVerify(body, env);
  if (err) return err;
  await env.AIPAQ_DATA.put('rule', body.rule || '');
  return json(null, 0, '解析规则已更新');
}

// ---------- 路由 ----------
const ROUTES = {
  '/customer/login': login,
  '/customer/ping': ping,
  '/customer/getClz': getClz,
  '/customer/getCust': getCust,
  '/customer/saveCust': saveCust,
  '/customer/saveClz': saveClz,
  '/customer/logout': logout,
  '/admin/overview': adminOverview,
  '/admin/getPage': adminGetPage,
  '/admin/savePage': adminSavePage,
  '/admin/getUsers': adminGetUsers,
  '/admin/addUser': adminAddUser,
  '/admin/delUser': adminDelUser,
  '/admin/resetUserPwd': adminResetUserPwd,
  '/admin/updatePassword': adminUpdatePassword,
  '/admin/updateEndTime': adminUpdateEndTime,
  '/admin/getRule': adminGetRule,
  '/admin/updateRule': adminUpdateRule,
};

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // 静态资源（含 /admin/ 下的 html/css/js 等）与目录请求（如 /admin/）交给静态资源托管
  const isStatic = /\.(html?|css|js|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|wasm|map|json|txt|xml|webp|avif)$/i.test(path);
  if (isStatic || path.endsWith('/') || (!path.startsWith('/customer/') && !path.startsWith('/admin/'))) {
    return next();
  }

  // GET /customer/page：登录页文案，无需鉴权
  if (path === '/customer/page' && request.method === 'GET') {
    return json(await kvGet(env, 'page', {}));
  }

  if (request.method !== 'POST') return json(null, 404, 'not found');

  const body = await readBody(request);
  const handler = ROUTES[path];
  if (!handler) return json(null, 404, 'not found');

  try {
    return await handler(body, env);
  } catch (e) {
    return json(null, 500, e && e.message ? e.message : String(e));
  }
}
