import { describe, expect, it } from 'vitest';
import { findServices, serviceEvidence } from './serviceDirectory';
import { serviceSchema, type ServiceEntry } from './planner';

const entry: ServiceEntry = { id: 'library', title: '图书续借', category: '图书馆', entryType: 'wechat', entry: '测试图书馆', materials: '', hours: '', steps: '进入我的借阅', sourceUrl: '', sourceUpdated: null, verifiedAt: null, miniProgramQr: '' };
describe('service directory evidence', () => {
  it('searches titles, categories and instructions without guessing unrelated answers', () => {
    expect(findServices([entry], ' 借阅 ', '全部')).toEqual([entry]);
    expect(findServices([entry], '', '财务')).toEqual([]);
    expect(findServices([entry], '退学', '全部')).toEqual([]);
  });
  it('distinguishes missing sources, unknown hours and strictly older than 30 days', () => {
    expect(serviceEvidence(entry, '2026-11-21')).toMatchObject({ sourced: false, stale: false, availability: '能否现在办理未确认' });
    const verified = { ...entry, sourceUrl: 'https://example.com/official', verifiedAt: '2026-10-22' };
    expect(serviceEvidence(verified, '2026-11-21').stale).toBe(false);
    expect(serviceEvidence({ ...verified, verifiedAt: '2026-10-21' }, '2026-11-21').stale).toBe(true);
  });
  it('rejects script links and credential-bearing URLs at the saved-data boundary', () => {
    expect(serviceSchema.safeParse({ ...entry, sourceUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(serviceSchema.safeParse({ ...entry, entryType: 'web', entry: 'https://user:secret@example.com' }).success).toBe(false);
  });
});
