const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await b.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto('https://athand-qnvq63y722x.qoder.zone', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(1500);
  await p.getByText('先随便看看', { exact: false }).first().click();
  await p.waitForTimeout(3500);
  const txt = await p.evaluate(() => document.body.innerText);
  const hrefs = await p.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a => ({ t: a.innerText.trim().slice(0, 14), h: a.getAttribute('href') })).filter(x => x.h && x.h.startsWith('/')).slice(0, 30));
  console.log(JSON.stringify({ url: p.url(), len: txt.length, txt: txt.slice(0, 1500), hrefs }, null, 1));
  await p.screenshot({ path: 'D:/AgentPrograms/AtHand/参赛材料-Qoder大赛/截图/_live_guest.png', fullPage: false });
  await b.close();
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
