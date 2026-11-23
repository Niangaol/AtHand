import { CAMPUS_OPERATIONS, CAMPUS_DOMAINS, CAMPUS_SCOPES } from '../functions/campus-manifest.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const RISK = { 'read': '只读', 'sensitive-read': '敏感只读', 'write': '写入', 'high-risk-write': '高风险写入' };
const DOMAIN_NOTES = {
  academic: '课表、今明课程、成绩/GPA、考试、作业、教室、校历；校园页与助手都在用，优先保持。',
  campuslife: '校园卡余额/流水、电费、二课、天气、失物、就业、志愿；校园页已覆盖高频项。',
  librarybooking: '选座：空间分类 → 可约日期 → 实时空座 → 预约/取消；写操作必须确认。',
  emptyschedule: '空课表房间、收藏、成员、组队；读操作可接，组队/邀请属写操作需确认。',
  feed: '首页信息流与课表 ICS 订阅；只读。',
  groupchat: '课程群/班级群/年级群；创建/合并/同步/退出都影响他人，只留在校园页并要求确认。',
  identity: '本人身份、绑定状态、校区、会话、授权应用；只读为主，设置校区/默认身份为写操作。',
  knowledge: '知识检索与快速问答；只读，适合补进校园页快捷入口。',
  librarybooking2: '',
  messaging: '校友传话、黑名单、生日祝福；涉及他人消息，写操作需确认，助手默认不接。',
  moments: '社区动态：帖子、评论、点赞、收藏、关注、举报；只读可接，发布/撤回/举报需确认。',
  reminder: '提醒订阅、通知渠道偏好、阳光长跑；只读可接，订阅/退订需确认。',
  upload: '上传签名与续签；属于文件流程内部能力，页面不直接暴露。',
  agentops: 'Agent 长期记忆增删改查；供助手内部使用，不放进校园页。',
  graduate: '研究生成绩/学籍/导师；本科生账号不适用，仅研究生绑定后可用。',
};
const HIGH_FREQ = {
  academic: ['AcademicService_ScheduleNow（今明课程）', 'AcademicService_StudentExam（考试）', 'AcademicService_StudentGrade（成绩与绩点）', 'AcademicService_ListChaoxingHomework（学习通作业）'],
  campuslife: ['CampusLifeService_CardBalance（校园卡余额）', 'CampusLifeService_CardConsume（消费流水）', 'CampusLifeService_ElectricBalance（宿舍电费）', 'CampusLifeService_ListMyActivities（我的二课）'],
  librarybooking: ['LibraryBookingService_ListSpaceCategories（空间）', 'LibraryBookingService_SearchAvailableSeats（实时空座）', 'LibraryBookingService_CreateBooking（预约，写）'],
  emptyschedule: ['EmptyScheduleService_MyRooms（我的房间）', 'EmptyScheduleService_Favorites（收藏排班）'],
  feed: ['FeedService_Feed（信息流）', 'FeedService_IcsLink（课表订阅）'],
  identity: ['IdentityService_Me（我的身份）', 'IdentityService_GetBindStatus（绑定状态）', 'IdentityService_GetMyCampus（校区）'],
  reminder: ['ReminderService_SunrunOverview（阳光长跑）', 'ReminderService_ListSubscriptions（提醒订阅）'],
  knowledge: ['KnowledgeService_KnowledgeRetrieve（知识检索）', 'KnowledgeService_KnowledgeServiceChat（快速问答）'],
  moments: ['MomentsService_ListMyPosts（我的帖子）', 'MomentsService_ListMyCollections（我的收藏）'],
};

const byDomain = new Map(CAMPUS_DOMAINS.map((d) => [d.name, []]));
for (const op of CAMPUS_OPERATIONS) {
  if (!byDomain.has(op.domain)) byDomain.set(op.domain, []);
  byDomain.get(op.domain).push(op);
}

function requiredParams(op) {
  const params = op.params.filter((p) => p.required).map((p) => `${p.name}(${p.in})`);
  const fields = (op.body?.fields ?? []).filter((f) => f.required).map((f) => `${f.name}(body)`);
  return [...params, ...fields];
}

function verdict(op) {
  if (op.domain === 'graduate') return '本科生不适用；研究生绑定后可用';
  if (op.domain === 'upload') return '文件流程内部能力，页面不直接暴露';
  if (op.domain === 'agentops') return 'Agent 内部记忆，不进校园页';
  if (op.auth === 'public') return '公开接口，无需授权';
  if (op.requiresUser && !op.scopes.length) return '需本人登录，无额外 scope';
  if (op.risk.includes('write')) return '写操作，需显式确认 + Idempotency-Key';
  return '可用（需授权对应 scope）';
}

let md = '# 校园助手操作盘点（2026-11-22）\n\n';
md += '本文档由 `functions/campus-manifest.mjs` 自动生成，盘点云端校园代理内置的全部操作。生成命令见文末。\n\n';
md += `- 操作总数：**${CAMPUS_OPERATIONS.length}**\n- 权限总数：**${CAMPUS_SCOPES.length}**\n- 域：**${CAMPUS_DOMAINS.length}**\n\n`;
md += '> 可用性结论基于 manifest 的 `auth` / `scopes` / `requiresUser` / `risk` 字段推断，**未经真实账号逐项实测**；标「需授权」的操作要等用户完成 HDUHelp 设备授权后才能验证。\n\n';
md += '## 总表\n\n| 域 | 操作数 | 只读 | 敏感只读 | 写入 | 高风险写入 |\n| --- | --- | --- | --- | --- | --- |\n';
for (const domain of CAMPUS_DOMAINS) {
  const ops = byDomain.get(domain.name) ?? [];
  const count = (risk) => ops.filter((op) => op.risk === risk).length;
  md += `| ${domain.label}（${domain.name}） | ${ops.length} | ${count('read')} | ${count('sensitive-read')} | ${count('write')} | ${count('high-risk-write')} |\n`;
}
md += '\n## 分域明细\n';
for (const domain of CAMPUS_DOMAINS) {
  const ops = byDomain.get(domain.name) ?? [];
  md += `\n### ${domain.label}（${domain.name}）\n\n`;
  if (DOMAIN_NOTES[domain.name]) md += `${DOMAIN_NOTES[domain.name]}\n\n`;
  md += '| 操作 | 说明 | 风险 | 权限 | 必填参数 | 结论 |\n| --- | --- | --- | --- | --- | --- |\n';
  for (const op of ops) {
    const desc = op.summary.replace(/\|/g, '\\|').slice(0, 60);
    const scopes = op.scopes.length ? `${op.scopes.length} 项` : '无';
    const required = requiredParams(op).join('、') || '—';
    md += `| \`${op.command}\`（${op.id}） | ${desc} | ${RISK[op.risk] ?? op.risk} | ${scopes} | ${required} | ${verdict(op)} |\n`;
  }
}
md += '\n## 高频域接入建议\n\n';
md += '| 域 | 校园页快捷入口（已有） | 建议补充 | 助手是否接入 |\n| --- | --- | --- | --- |\n';
for (const domain of CAMPUS_DOMAINS) {
  const list = HIGH_FREQ[domain.name];
  const current = list ? '已覆盖：' + list.slice(0, 2).join('、') : '—';
  const suggest = list ? list.slice(2).join('、') || '—' : '—';
  const assistant = ['academic', 'campuslife'].includes(domain.name) ? '现有 7 个 campus_* 工具覆盖基础查询' : domain.name === 'librarybooking' ? '只读查询可接，预约需确认' : domain.name === 'moments' || domain.name === 'messaging' || domain.name === 'groupchat' ? '写操作影响他人，留在页面' : '页面入口即可';
  md += `| ${domain.label} | ${current} | ${suggest} | ${assistant} |\n`;
}
md += '\n## 缺口与边界\n\n';
md += '1. **199 个操作不都在页面上出现**：校园页只给高频域做快捷入口，其余在「全部」里搜索；不建议把 199 个操作全塞进助手，会挤爆小模型的工具表。\n';
md += '2. **写操作统一走确认**：`write` 需要勾选确认，`high-risk-write` 还要输入「确认执行」；请求带 `Idempotency-Key`，缺权限返回 `missing_scope` 并提供补充授权入口。\n';
md += '3. **研究生域不适用于本科生**：`graduate` 的 3 个操作只在绑定研究生身份后可用，本科生页面不置顶。\n';
md += '4. **文件上传不直接暴露**：`upload` 只用于社区头像/图片等内部流程。\n';
md += '5. **真实可用性待实测**：校园代理依赖 `api.hduhelp.com` 与用户 PAT；未授权时只验证了鉴权路径与错误格式，没有逐项调用上游。\n';
md += '\n## 生成命令\n\n```bash\nnode tools/campus-inventory.mjs\n```\n\n生成脚本：`tools/campus-inventory.mjs`。\n';

mkdirSync('docs', { recursive: true });
writeFileSync('docs/campus-operation-inventory.md', md);
console.log('written', CAMPUS_OPERATIONS.length, 'ops');
