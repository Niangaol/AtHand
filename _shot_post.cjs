const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 }, deviceScaleFactor: 1 });
  const p = 'file:///D:/AgentPrograms/AtHand/%E5%8F%82%E8%B5%9B%E6%9D%90%E6%96%99-Qoder%E5%A4%A7%E8%B5%9B/%E4%BD%9C%E5%93%81%E5%B8%96-%E4%B8%93%E4%B8%9A%E7%89%88-v2.html';
  await page.goto(p, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => ({
    h: document.documentElement.scrollHeight,
    imgs: Array.from(document.images).map(i => ({ w: i.naturalWidth, h: i.naturalHeight, ok: i.complete && i.naturalWidth > 50 })),
    h2s: Array.from(document.querySelectorAll('h2')).map(h => h.textContent.trim()),
    tables: document.querySelectorAll('table').length,
    textLen: document.querySelector('article').innerText.length,
  }));
  console.log(JSON.stringify({ h: info.h, tables: info.tables, textLen: info.textLen, h2s: info.h2s, imgCount: info.imgs.length, imgOk: info.imgs.filter(x => x.ok).length, imgSizes: info.imgs.map(x => x.w + 'x' + x.h) }, null, 1));
  await page.screenshot({ path: 'D:/AgentPrograms/AtHand/参赛材料-Qoder大赛/_post_top.png' });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.62));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'D:/AgentPrograms/AtHand/参赛材料-Qoder大赛/_post_mid.png' });
  await browser.close();
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
