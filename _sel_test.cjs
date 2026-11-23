const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const p = 'file:///D:/AgentPrograms/AtHand/%E5%8F%82%E8%B5%9B%E6%9D%90%E6%96%99-Qoder%E5%A4%A7%E8%B5%9B/%E4%BD%9C%E5%93%81%E5%B8%96-%E4%B8%93%E4%B8%9A%E7%89%88-v2.html';
  await page.goto(p, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.click('article h2');
  await page.keyboard.press('Control+A');
  await page.waitForTimeout(300);
  const sel = await page.evaluate(() => window.getSelection().toString());
  console.log('selLen', sel.length, 'hasTip', sel.includes('使用方式'), 'head', JSON.stringify(sel.slice(0, 60)), 'tail', JSON.stringify(sel.slice(-40)));
  // 复制并检查剪贴板 HTML 长度（file:// 下 clipboard API 可能不可用，用 execCommand 兜底）
  const len = await page.evaluate(() => {
    const r = document.execCommand('copy');
    return r;
  });
  console.log('execCommand copy:', len);
  await browser.close();
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
