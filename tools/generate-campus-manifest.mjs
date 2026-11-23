// 从 hduhelp-cli 的 schema 导出裁剪后的云端操作清单。
// 用法：node tools/generate-campus-manifest.mjs <all-schemas.json> functions/campus-manifest.mjs
import fs from 'node:fs';

const [, , input = '.tmp-hduhelp-bin/all-schemas.json', output = 'functions/campus-manifest.mjs'] = process.argv;
const items = JSON.parse(fs.readFileSync(input, 'utf8'));

const DOMAIN_LABELS = {
  academic: '教务',
  agentops: '长期记忆',
  campuslife: '校园生活',
  emptyschedule: '空课表',
  feed: '信息流与订阅',
  graduate: '研究生',
  groupchat: '群聊',
  identity: '身份',
  knowledge: '知识检索',
  librarybooking: '图书馆选座',
  messaging: '校友传话',
  moments: '社区动态',
  reminder: '提醒与阳光长跑',
  upload: '文件上传',
};

const operations = items.map((item) => ({
  id: item.id,
  domain: item.domain,
  command: item.command,
  summary: item.summary,
  description: item.description ?? '',
  method: item.http_method,
  path: item.path,
  auth: item.auth ?? 'bearer',
  scopes: item.requires_scopes ?? [],
  risk: item.risk ?? 'read',
  sensitive: item.sensitive === true,
  requiresUser: item.requires_user === true,
  params: (item.parameters ?? []).map((param) => ({
    name: param.name,
    in: param.in,
    required: param.required === true,
    type: param.type ?? 'string',
    ...(param.format ? { format: param.format } : {}),
  })),
  body: item.has_body
    ? {
      contentType: item.request_content_type ?? 'application/json',
      fields: (item.request_body_fields ?? []).map((field) => ({
        name: field.name,
        required: field.required === true,
        type: field.type ?? 'string',
        ...(field.format ? { format: field.format } : {}),
      })),
    }
    : null,
}));

const scopes = [...new Set(operations.flatMap((operation) => operation.scopes))].sort();
const domains = [...new Set(operations.map((operation) => operation.domain))]
  .map((name) => ({
    name,
    label: DOMAIN_LABELS[name] ?? name,
    operations: operations.filter((operation) => operation.domain === name).length,
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

const source = `// 由 tools/generate-campus-manifest.mjs 从 hduhelp-cli 0.4.126 生成，请勿手改。\n`
  + `export const CAMPUS_OPERATIONS = ${JSON.stringify(operations)};\n`
  + `export const CAMPUS_SCOPES = ${JSON.stringify(scopes)};\n`
  + `export const CAMPUS_DOMAINS = ${JSON.stringify(domains)};\n`;

fs.writeFileSync(output, source);
console.log(`wrote ${output}: ${operations.length} operations, ${scopes.length} scopes, ${domains.length} domains, ${source.length} bytes`);