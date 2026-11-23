// 真实 HDUHelp 公共接口冒烟：不登录，只验证云端代理的路径、参数和鉴权格式。
// 运行：node tools/campus-live-check.mjs
import { createDocs } from '../functions/lib.mjs';
import { createCampus } from '../functions/campus.mjs';

function fakeDb() {
  const tables = new Map();
  const rows = (name) => { if (!tables.has(name)) tables.set(name, []); return tables.get(name); };
  const matches = (row, filters) => filters.every(([column, value]) => row[column] === value);
  class Query {
    constructor(name) { this.name = name; this.op = null; this.payload = null; this.options = null; this.filters = []; this.columns = '*'; }
    select(columns = '*') { if (!this.op) this.op = 'select'; this.columns = columns; return this; }
    insert(payload) { this.op = 'insert'; this.payload = payload; return this; }
    insertIfAbsent(payload, options) { this.op = 'insertIfAbsent'; this.payload = payload; this.options = options; return this; }
    update(payload) { this.op = 'update'; this.payload = payload; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(column, value) { this.filters.push([column, value]); return this; }
    limit() { return this; }
    then(resolve, reject) { return this.run().then(resolve, reject); }
    async run() {
      const list = rows(this.name);
      if (this.op === 'select') return { data: list.filter((row) => matches(row, this.filters)).map((row) => ({ ...row })), error: null };
      if (this.op === 'insert') { list.push({ ...this.payload }); return { data: [{ ...this.payload }], error: null }; }
      if (this.op === 'insertIfAbsent') {
        const key = this.options?.onConflict ?? 'key';
        if (list.some((row) => row[key] === this.payload[key])) return { data: [], error: null };
        list.push({ ...this.payload }); return { data: [{ ...this.payload }], error: null };
      }
      if (this.op === 'update') {
        const changed = list.filter((row) => matches(row, this.filters));
        for (const row of changed) Object.assign(row, this.payload);
        return { data: changed.map((row) => ({ key: row.key })), error: null };
      }
      if (this.op === 'delete') { tables.set(this.name, list.filter((row) => !matches(row, this.filters))); return { data: [], error: null }; }
      throw new Error(`unsupported ${this.op}`);
    }
  }
  return { from: (name) => new Query(name) };
}

const db = fakeDb();
const campus = createCampus({ docs: createDocs(db), fetch: globalThis.fetch });

async function run(operationId) {
  const request = new Request('https://site.example/functions/v1/app/api/campus/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operationId }),
  });
  const response = await campus.handle(request);
  const body = await response.json();
  return body;
}

for (const operationId of ['AcademicService_AcademicConfig', 'AcademicService_SchoolTime', 'AcademicService_GetClassrooms', 'CampusLifeService_ListPublicCampuses']) {
  const result = await run(operationId);
  const summary = Array.isArray(result.data) ? `${result.data.length} 条` : result.data && typeof result.data === 'object' ? Object.keys(result.data).slice(0, 6).join(',') : String(result.data);
  console.log(operationId, result.ok ? 'ok' : 'FAIL', result.status ?? '', summary, result.message ?? '');
  if (!result.ok) process.exitCode = 1;
}