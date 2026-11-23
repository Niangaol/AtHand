# -*- coding: utf-8 -*-
"""把 作品帖-专业版-正文-v2.md 渲染成可直接复制粘贴的富文本 HTML（单文件、图片内嵌）。

用法：
    cd "D:/AgentPrograms/AtHand/参赛材料-Qoder大赛"
    PYTHONIOENCODING=utf-8 python build_post_html.py
产出：
    作品帖-专业版-v2.html
"""
import base64
import html
import io
import os
import re

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "作品帖-专业版-正文-v2.md")
OUT = os.path.join(HERE, "作品帖-专业版-v2.html")
IMG_DIR = os.path.join(HERE, "截图")
MAX_W = 860
JPEG_Q = 86


def data_uri(fname):
    path = os.path.join(IMG_DIR, fname)
    im = Image.open(path)
    if im.mode in ("RGBA", "P", "LA"):
        bg = Image.new("RGB", im.size, (255, 255, 255))
        im = im.convert("RGBA")
        bg.paste(im, mask=im.split()[-1])
        im = bg
    else:
        im = im.convert("RGB")
    if im.width > MAX_W:
        h = round(im.height * MAX_W / im.width)
        im = im.resize((MAX_W, h), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=JPEG_Q, optimize=True, progressive=True)
    b = buf.getvalue()
    return "data:image/jpeg;base64," + base64.b64encode(b).decode(), len(b)


def inline(text):
    """行内标记：**粗体**、`代码`、裸链接。"""
    out = html.escape(text, quote=False)
    out = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    out = re.sub(
        r"(?<![\"'=])(https?://[^\s<>\u3000]+?)(?=[\s<>\u3000，。、；：！？）】」]|$)",
        r'<a href="\1">\1</a>',
        out,
    )
    return out


def parse_table(lines):
    rows = []
    for ln in lines:
        cells = [c.strip() for c in ln.strip().strip("|").split("|")]
        rows.append(cells)
    head, body = rows[0], [r for r in rows[1:] if not re.match(r"^[\s:\-|]+$", "|".join(r))]
    out = ["<table><thead><tr>"]
    out += ["<th>%s</th>" % inline(c) for c in head]
    out.append("</tr></thead><tbody>")
    for r in body:
        out.append("<tr>" + "".join("<td>%s</td>" % inline(c) for c in r) + "</tr>")
    out.append("</tbody></table>")
    return "\n".join(out)


def convert(md):
    lines = md.split("\n")
    out, i = [], 0
    img_total = 0
    pending_fig = None  # (label, caption)

    while i < len(lines):
        ln = lines[i]
        s = ln.strip()

        if not s:
            i += 1
            continue

        # 分隔线
        if re.match(r"^-{3,}$", s):
            out.append("<hr>")
            i += 1
            continue

        # 标题
        m = re.match(r"^(#{1,4})\s+(.*)$", s)
        if m:
            lvl = len(m.group(1))
            out.append("<h%d>%s</h%d>" % (lvl, inline(m.group(2)), lvl))
            i += 1
            continue

        # 表格
        if s.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:\-|]+\|$", lines[i + 1].strip()):
            blk = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                blk.append(lines[i])
                i += 1
            out.append(parse_table(blk))
            continue

        # 引用块
        if s.startswith(">"):
            blk = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                blk.append(lines[i].strip().lstrip(">").strip())
                i += 1
            out.append("<blockquote>%s</blockquote>" % inline(" ".join(x for x in blk if x)))
            continue

        # 附图标记：【图 N】说明  +  下一行（插入 `file.png`）
        m = re.match(r"^\*\*【图\s*(\d+)】\*\*\s*(.*)$", s)
        if m:
            label, caption = m.group(1), m.group(2)
            fname = None
            if i + 1 < len(lines):
                mf = re.search(r"（插入\s*`([^`]+)`）", lines[i + 1])
                if mf:
                    fname = mf.group(1)
                    i += 1
            if fname:
                uri, size = data_uri(fname)
                img_total += size
                out.append(
                    '<figure><img src="%s" alt="图%s"><figcaption><strong>图 %s</strong>　%s</figcaption></figure>'
                    % (uri, label, label, inline(caption))
                )
            else:
                out.append("<p><strong>【图 %s】</strong>%s</p>" % (label, inline(caption)))
            i += 1
            continue

        # 有序列表
        if re.match(r"^\d+\.\s+", s):
            blk = []
            while i < len(lines) and re.match(r"^\d+\.\s+", lines[i].strip()):
                blk.append(re.sub(r"^\d+\.\s+", "", lines[i].strip()))
                i += 1
            out.append("<ol>%s</ol>" % "".join("<li>%s</li>" % inline(x) for x in blk))
            continue

        # 无序列表
        if re.match(r"^[-*]\s+", s):
            blk = []
            while i < len(lines) and re.match(r"^[-*]\s+", lines[i].strip()):
                blk.append(re.sub(r"^[-*]\s+", "", lines[i].strip()))
                i += 1
            out.append("<ul>%s</ul>" % "".join("<li>%s</li>" % inline(x) for x in blk))
            continue

        # 普通段落
        out.append("<p>%s</p>" % inline(s))
        i += 1

    return "\n".join(out), img_total


TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>作品帖 · 顺手 AtHand（专业版 v2）</title>
<style>
  :root { color-scheme: light; }
  body {
    margin: 0; padding: 40px 20px 80px; background: #f4f5f7;
    font: 16px/1.85 "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
    color: #1f2329;
  }
  article {
    max-width: 900px; margin: 0 auto; background: #fff; padding: 44px 52px 56px;
    border-radius: 10px; box-shadow: 0 2px 18px rgba(0,0,0,.06);
  }
  h1 { font-size: 27px; line-height: 1.4; margin: 0 0 22px; font-weight: 700; }
  h2 {
    font-size: 21px; margin: 40px 0 14px; padding-left: 12px; font-weight: 700;
    border-left: 4px solid #2f6fed;
  }
  h3 { font-size: 17px; margin: 26px 0 10px; font-weight: 700; color: #2b2f36; }
  p { margin: 12px 0; }
  strong { font-weight: 700; }
  code {
    font-family: Consolas, "Courier New", monospace; font-size: 14px;
    background: #f2f3f5; padding: 1px 5px; border-radius: 4px; color: #c7254e;
  }
  a { color: #2f6fed; word-break: break-all; }
  hr { border: none; border-top: 1px solid #e6e8eb; margin: 30px 0; }
  blockquote {
    margin: 16px 0; padding: 10px 16px; background: #f7f8fa;
    border-left: 3px solid #c9cdd4; color: #4e5969;
  }
  ul, ol { margin: 12px 0; padding-left: 26px; }
  li { margin: 7px 0; }
  table {
    width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14.5px;
  }
  th, td { border: 1px solid #dcdfe6; padding: 9px 12px; text-align: left; vertical-align: top; }
  th { background: #f5f7fa; font-weight: 700; }
  figure { margin: 22px 0 26px; }
  figure img {
    display: block; width: 100%; height: auto; border: 1px solid #e6e8eb; border-radius: 6px;
  }
  figcaption { margin-top: 8px; font-size: 14px; color: #4e5969; }
  .tip {
    max-width: 900px; margin: 0 auto 18px; padding: 12px 18px; background: #fff8e6;
    border: 1px solid #ffe1a8; border-radius: 8px; font-size: 14px; color: #7a5b00;
    -webkit-user-select: none; user-select: none; cursor: default;
  }
</style>
</head>
<body>
<div class="tip">
  使用方式：在本页按 <strong>Ctrl+A</strong> 全选 → <strong>Ctrl+C</strong> 复制 → 到天池编辑框里
  <strong>Ctrl+V</strong> 粘贴。标题、加粗、表格、列表和 9 张截图都会一起带过去。
  如果编辑器吞掉了图片，就回到这个页面单独复制某一张图（在图上方右键 →「复制图片」），再粘到对应位置。
</div>
<article>
__BODY__
</article>
</body>
</html>
"""


def main():
    with open(SRC, encoding="utf-8") as f:
        md = f.read()
    body, imgbytes = convert(md)
    page = TEMPLATE.replace("__BODY__", body)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(page)
    print("已生成:", OUT)
    print("文件大小: %.2f MB" % (os.path.getsize(OUT) / 1024 / 1024))
    print("图片原始字节合计: %.2f MB" % (imgbytes / 1024 / 1024))


if __name__ == "__main__":
    main()
