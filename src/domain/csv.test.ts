import { describe, expect, it } from 'vitest';
import { exportCsv } from './csv';
import type { RecordEntry } from './records';

const expense: RecordEntry = { id: 'e', type: 'expense', date: '2026-11-20', title: '午饭', amountCents: 1850, source: 'manual', category: '吃饭' };
describe('CSV export', () => {
  it('uses a BOM and fixed decimal currency for Excel', () => {
    const csv = exportCsv([expense], []);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"18.50"');
    expect(csv).toContain('"吃饭"');
    expect(csv.split('\r\n')).toHaveLength(2);
  });
  it('escapes commas, double quotes and line breaks', () => {
    expect(exportCsv([{ ...expense, title: '饭,"好吃"\n第二行' }], [])).toContain('"饭,""好吃""\n第二行"');
  });
  it.each(['=1+1', '+cmd', '-cmd', '@SUM(A1)', '  =1+1', '\t=1+1'])('neutralizes formula-like user text %s', (title) => {
    expect(exportCsv([{ ...expense, title }], [])).toContain(`"'${title}"`);
  });
  it('includes a full work record and its unit', () => {
    const work: RecordEntry = { id: 'w', type: 'work', date: '2026-11-20', title: '工作', amountCents: 6000, source: 'manual', durationMinutes: 180, hourlyRateCents: 2000, startTime: '14:00', endTime: '17:00', workplaceId: 'u' };
    const csv = exportCsv([work], [{ id: 'u', name: '奶茶店', description: '', hourlyRateCents: 3000, source: 'manual' }]);
    expect(csv).toContain('"14:00","17:00","180","60.00","20.00","奶茶店"');
  });
  it('still exports a complete header for an empty ledger', () => {
    expect(exportCsv([], [])).toContain('"类型","日期","备注","开始时间","结束时间","时长（分钟）","金额（元）","单价（元/小时）","单位名称","分类","出处"');
  });
});
