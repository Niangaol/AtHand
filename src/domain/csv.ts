import type { RecordEntry, Workplace } from './records';

function cell(value: string): string {
  const safe = /^[\t\r\n]|^\s*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function exportCsv(records: readonly RecordEntry[], workplaces: readonly Workplace[]): string {
  const rows: string[][] = [['类型', '日期', '备注', '开始时间', '结束时间', '时长（分钟）', '金额（元）', '单价（元/小时）', '单位名称', '分类', '出处']];
  const unitNames = new Map(workplaces.map((unit) => [unit.id, unit.name]));
  const sources = { demo: '示例', manual: '手动', school: '学校', import: '导入' };
  for (const record of [...records].sort((a, b) => a.date.localeCompare(b.date))) {
    rows.push([
      record.type === 'work' ? '工时' : '支出', record.date, record.title,
      record.type === 'work' ? record.startTime : '', record.type === 'work' ? record.endTime : '',
      record.type === 'work' ? String(record.durationMinutes) : '', (record.amountCents / 100).toFixed(2),
      record.type === 'work' ? (record.hourlyRateCents / 100).toFixed(2) : '',
      record.type === 'work' ? unitNames.get(record.workplaceId) ?? '' : '',
      record.type === 'expense' ? record.category : '', sources[record.source],
    ]);
  }
  return '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n');
}

export function downloadText(content: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
