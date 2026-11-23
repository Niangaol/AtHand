const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await b.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const r = await p.goto('https://athand-qnvq63y722x.qoder.zone', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(2500);
  const txt = await p.evaluate(() => document.body.innerText);
  const nav = await p.evaluate(() => Array.from(document.querySelectorAll('nav a, aside a, [role="navigation"] a')).map(a => a.innerText.trim()).filter(Boolean));
  console.log(JSON.stringify({ status: r.status(), len: txt.length, nav, sample: /示例/.test(txt), csv: /导出|CSV/.test(txt), units: /单位/.test(txt), head: txt.slice(0, 200) }, null, 1));
  await p.screenshot({ path: 'D:/AgentPrograms/AtHand/参赛材料-Qoder大赛/截图/_live_check.png' });
  await b.close();
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
