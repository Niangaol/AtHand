import { test, expect } from '@playwright/test';

/**
 * 排版与对比度验收（W2）。
 *
 * 覆盖八个路由：/ /today /ledger /entry /schedule /focus /settings /assistant。
 * 每个路由断言：
 *   1) 可见文本的最小计算字号 >= 11px（排除 aria-hidden、sr-only/屏幕阅读器专用、
 *      display:none / visibility:hidden、折叠 details 等未渲染内容）；
 *   2) h1 的 font-family 含 serif（--font-display 的衬线展示字体）。
 * 另有一段 375px 视口检查：documentElement.scrollWidth <= innerWidth，
 * 并在同一轮把 11px 字号下限在移动端复测（扩大检查面，见报告）。
 *
 * 对比度（WCAG 相对亮度，>= 4.5）针对四个选择器，在各自实际出现的路由上断言：
 *   .chart-axis        /today  （由 W1 的 WeeklyChart.tsx + src/styles/chart.css 提供）
 *   .chart-day-label   /today  （同上；选择器不存在即失败，不允许降阈值或删断言）
 *   .home-glance dt    /       （src/features/home/HomePage.tsx）
 *   .record-day h3     /ledger （src/components/RecordList.tsx）
 * 算法与 e2e/foundation.spec.ts 一致：0.2126/0.7152/0.0722 加权，sRGB 反 gamma
 * (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)；
 * 背景取最近的非透明背景色并逐层合成（foundation 只按白底估算，这里更严格）。
 */

const typographyRoutes = ['/', '/today', '/ledger', '/entry', '/schedule', '/focus', '/settings', '/assistant'];

const minimumFontSize = 11;
const minimumContrast = 4.5;
const mobileViewport = { width: 375, height: 812 };

type FontScanResult = {
  minFontSize: number;
  counted: number;
  offenders: { text: string; fontSize: number; selector: string }[];
  h1Count: number;
  h1FontFamily: string;
};

/** 在页面里执行：扫描所有直接承载可见文本的元素，收集 < 11px 的落点。 */
function scanVisibleTypography(): FontScanResult {
  const floor = 11;
  const screenReaderOnlySelector = '.sr-only, .visually-hidden, .screen-reader-only, [data-sr-only]';

  const isRenderedText = (element: Element) => {
    if (element.closest('[aria-hidden="true"]')) return false;
    if (element.closest(screenReaderOnlySelector)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility !== 'visible') return false;
    const clip = style.clip.replace(/\s+/g, '');
    const clipped = ['rect(0px,0px,0px,0px)', 'rect(1px,1px,1px,1px)', 'rect(0,0,0,0)'].includes(clip);
    if (clipped || style.clipPath === 'inset(50%)') return false;
    const bounds = element.getBoundingClientRect();
    if (bounds.width <= 1 && bounds.height <= 1 && style.overflow === 'hidden') return false;
    // display 不继承：逐级往上确认没有 display:none 的祖先（也覆盖折叠的 <details>）。
    let ancestor: Element | null = element;
    while (ancestor) {
      if (window.getComputedStyle(ancestor).display === 'none') return false;
      ancestor = ancestor.parentElement;
    }
    return element.getClientRects().length > 0;
  };

  const describe = (element: Element) => {
    const parts = [element.tagName.toLowerCase()];
    if (element.id) parts.push(`#${element.id}`);
    Array.from(element.classList).slice(0, 3).forEach((name) => parts.push(`.${name}`));
    return parts.join('');
  };

  const directText = (element: Element) =>
    Array.from(element.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => (node.textContent ?? '').trim())
      .filter(Boolean)
      .join(' ');

  const offenders: { text: string; fontSize: number; selector: string }[] = [];
  let smallest = Number.POSITIVE_INFINITY;
  let counted = 0;

  const roots = [document.body, ...Array.from(document.body.querySelectorAll('*'))];
  for (const element of roots) {
    const text = directText(element);
    if (!text) continue;
    if (!isRenderedText(element)) continue;
    const style = window.getComputedStyle(element);
    const fontSize = Number.parseFloat(style.fontSize);
    if (!Number.isFinite(fontSize)) continue;
    counted += 1;
    smallest = Math.min(smallest, fontSize);
    if (fontSize < floor) offenders.push({ text: text.slice(0, 40), fontSize, selector: describe(element) });
  }

  offenders.sort((left, right) => left.fontSize - right.fontSize);
  const heading = document.querySelector('h1');
  return {
    minFontSize: counted > 0 ? Math.round(smallest * 100) / 100 : 0,
    counted,
    offenders: offenders.slice(0, 40),
    h1Count: document.querySelectorAll('h1').length,
    h1FontFamily: heading ? window.getComputedStyle(heading).fontFamily : '',
  };
}

type ContrastEntry = {
  selector: string;
  text: string;
  fontSize: number;
  foreground: string;
  background: string;
  backgroundImage: boolean;
  parseable: boolean;
  ratio: number;
};

/** 在页面里执行：取选择器内所有直接承载文本的节点，算 WCAG 对比度。 */
function readTextContrast(selectors: string[]): ContrastEntry[] {
  type Color = { r: number; g: number; b: number; a: number };

  const parseColor = (value: string): Color | null => {
    // color-mix(in srgb, ...) 在 Chromium 的计算值里序列化成 color(srgb r g b / a)。
    const srgb = value.match(/color\(srgb\s+([^)]+)\)/i);
    if (srgb) {
      const srgbParts = srgb[1]
        .split(/[\s/]+/)
        .filter(Boolean)
        .map(Number);
      if (srgbParts.length < 3 || srgbParts.some((part) => !Number.isFinite(part))) return null;
      return { r: srgbParts[0] * 255, g: srgbParts[1] * 255, b: srgbParts[2] * 255, a: srgbParts.length > 3 ? srgbParts[3] : 1 };
    }
    const match = value.match(/rgba?\(([^)]+)\)/i);
    if (!match) return null;
    const parts = match[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };

  const toLinear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  const relativeLuminance = (color: Color) => 0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b);

  const composite = (top: Color, bottom: Color): Color => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });

  const backgroundColor = (element: Element): Color => {
    const layers: Color[] = [];
    let node: Element | null = element;
    while (node) {
      const color = parseColor(window.getComputedStyle(node).backgroundColor);
      if (color && color.a > 0) {
        layers.push(color);
        if (color.a >= 1) break;
      }
      node = node.parentElement;
    }
    let base: Color = { r: 255, g: 255, b: 255, a: 1 };
    for (let index = layers.length - 1; index >= 0; index -= 1) base = composite(layers[index], base);
    return base;
  };

  const foregroundColor = (element: Element): Color | null => {
    // SVG 里的文字用 fill 上色，color 可能只是继承值，优先取 fill。
    if (element instanceof SVGElement) {
      const fill = parseColor(window.getComputedStyle(element).fill);
      if (fill && fill.a > 0) return fill;
    }
    return parseColor(window.getComputedStyle(element).color);
  };

  const usesBackgroundImage = (element: Element) => {
    let node: Element | null = element;
    while (node) {
      if (window.getComputedStyle(node).backgroundImage !== 'none') return true;
      const color = parseColor(window.getComputedStyle(node).backgroundColor);
      if (color && color.a >= 1) break;
      node = node.parentElement;
    }
    return false;
  };

  const format = (color: Color) => `rgb(${Math.round(color.r)} ${Math.round(color.g)} ${Math.round(color.b)})`;

  const results: ContrastEntry[] = [];
  for (const selector of selectors) {
    for (const root of Array.from(document.querySelectorAll(selector))) {
      const candidates = [root, ...Array.from(root.querySelectorAll('*'))];
      const holders = candidates.filter((node) =>
        Array.from(node.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim().length > 0),
      );
      const leaves = holders.length > 0 ? holders : (root.textContent ?? '').trim() ? [root] : [];
      for (const leaf of leaves) {
        const style = window.getComputedStyle(leaf);
        const foreground = foregroundColor(leaf);
        const background = backgroundColor(leaf);
        const foregroundLuminance = foreground ? relativeLuminance(foreground) : 0;
        const backgroundLuminance = relativeLuminance(background);
        const ratio = foreground
          ? (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
          : 0;
        results.push({
          selector,
          text: (leaf.textContent ?? '').trim().slice(0, 32),
          fontSize: Number.parseFloat(style.fontSize),
          foreground: foreground ? format(foreground) : style.color,
          background: format(background),
          backgroundImage: usesBackgroundImage(leaf),
          parseable: Boolean(foreground),
          ratio: Math.round(ratio * 100) / 100,
        });
      }
    }
  }
  return results;
}

test.describe('可见文本字号与 h1 展示字体', () => {
  for (const path of typographyRoutes) {
    test(`${path} 的可见文本不小于 ${minimumFontSize}px 且 h1 使用衬线字体`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      const scan = await page.evaluate(scanVisibleTypography);
      expect(scan.counted, `${path} 应扫描到足量可见文本，实际 ${scan.counted} 个文本元素`).toBeGreaterThan(10);

      const offenders = scan.offenders.map((item) => `${item.fontSize}px ${item.selector} “${item.text}”`).join('；');
      expect(scan.offenders, `${path} 存在小于 ${minimumFontSize}px 的可见文本：${offenders}`).toHaveLength(0);
      expect(scan.minFontSize, `${path} 最小可见字号`).toBeGreaterThanOrEqual(minimumFontSize);

      expect(scan.h1Count, `${path} 应至少有一个 h1`).toBeGreaterThanOrEqual(1);
      // "sans-serif" 也含 serif 子串，先剔除再判断真正落到衬线字族。
      const family = scan.h1FontFamily.toLowerCase().replace(/sans-serif/g, '');
      expect(family, `${path} h1 的 font-family 应含 serif，实际：${scan.h1FontFamily}`).toContain('serif');
    });
  }
});

test('375px 视口下八个路由不横向溢出，且可见文本仍不小于 11px', async ({ page }) => {
  await page.setViewportSize(mobileViewport);
  for (const path of typographyRoutes) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const sizes = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
    expect(sizes.content, `${path} 在 375px 下横向溢出：scrollWidth ${sizes.content} > innerWidth ${sizes.viewport}`).toBeLessThanOrEqual(sizes.viewport);

    const scan = await page.evaluate(scanVisibleTypography);
    const offenders = scan.offenders.map((item) => `${item.fontSize}px ${item.selector} “${item.text}”`).join('；');
    expect(scan.offenders, `${path} 在 375px 下存在小于 ${minimumFontSize}px 的可见文本：${offenders}`).toHaveLength(0);
  }
});

const contrastTargets = [
  { path: '/today', selectors: ['.chart-axis', '.chart-day-label'] },
  { path: '/', selectors: ['.home-glance dt'] },
  { path: '/ledger', selectors: ['.record-day h3'] },
];

for (const target of contrastTargets) {
  test(`${target.path} 的小字对比度不低于 ${minimumContrast}:1（${target.selectors.join('、')}）`, async ({ page }) => {
    await page.goto(target.path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    for (const selector of target.selectors) {
      const locator = page.locator(selector);
      // 先自动等待元素出现（React 同步渲染也需要一帧），再显式断言存在性。
      await expect(locator.first(), `${selector} 在 ${target.path} 上应可见；缺失即失败`).toBeVisible();
      const count = await locator.count();
      expect(
        count,
        `${target.path} 上找不到 ${selector}。图表选择器由 W1 的 WeeklyChart.tsx / src/styles/chart.css 提供；缺失即失败，不得降低阈值或删除断言。`,
      ).toBeGreaterThan(0);

      const entries = await page.evaluate(readTextContrast, [selector]);
      expect(entries.length, `${selector} 在 ${target.path} 上没有可测量的文本节点`).toBeGreaterThan(0);

      for (const entry of entries) {
        const detail = `${target.path} ${selector} “${entry.text}” ${entry.fontSize}px：前景 ${entry.foreground}，背景 ${entry.background}${entry.backgroundImage ? '（含背景图/渐变，未计入合成）' : ''}`;
        expect(entry.parseable, `${detail} 的颜色无法解析为 rgb()/rgba()`).toBe(true);
        expect(entry.ratio, `${detail} 对比度 ${entry.ratio}:1 < ${minimumContrast}:1`).toBeGreaterThanOrEqual(minimumContrast);
      }
    }
  });
}
