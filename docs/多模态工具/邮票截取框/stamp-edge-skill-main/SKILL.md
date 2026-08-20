---
name: stamp-edge
description: 把任意图片处理成邮票风格——直接在原图四周边缘打半圆锯齿孔洞 + 柔和投影,默认无白边、输出真透明背景 PNG(锯齿孔洞和四周 alpha=0),可直接叠加到任何背景;可选加白色纸边;还能把多张邮票拼成等宽列瀑布流合集图(stamp sheet)。当用户提到"邮票边"、"邮票风格"、"邮票质感"、"锯齿边"、"打孔边"、"perforated edge"、"stamp style"、"postage stamp"、"邮票合集"、"邮票排版"、"stamp sheet",或要求把截图/帖子/图片做成邮票效果时使用。
version: 1.2.0
---

# 邮票风格边框 Skill

把图片处理成邮票样式:**默认直接在原图四周边缘打半圆锯齿孔洞(无白边)**,底部柔和投影,**输出真透明背景 PNG**(孔洞与四周 alpha=0),可直接当贴纸/素材叠加使用。需要白色纸边时加 `margin` 选项。

## 使用方式

直接运行本目录下的脚本(依赖 Pillow):

```bash
python3 ~/.agents/skills/stamp-edge/stamp_effect.py <输入图> <输出图.png>          # 无白边 + 透明背景(默认)
python3 ~/.agents/skills/stamp-edge/stamp_effect.py <输入图> <输出图.png> margin   # 加白边
python3 ~/.agents/skills/stamp-edge/stamp_effect.py <输入图> <输出图.png> bg       # 浅灰白背景
```

选项可组合,如 `margin bg`。

- 输入:任意常见格式截图/图片(PNG/JPG 等)
- 输出:PNG;默认 RGBA 真透明,加 `bg` 参数则为浅灰白底成品图
- 输出文件默认建议存到 `~/Desktop/`,文件名用内容语义命名(如 `analytics_stamp.png`)

## 拼合集图(stamp_sheet.py)

多张邮票生成后,用本目录下的 `stamp_sheet.py` 拼成一张合集:**等宽列瀑布流,每张邮票撑满列宽、无留白,列高自动贪心均衡**:

```bash
python3 ~/.agents/skills/stamp-edge/stamp_sheet.py ~/Desktop/stamp_grid.png *_stamp.png                 # 默认 4 列深色底
python3 ~/.agents/skills/stamp-edge/stamp_sheet.py ~/Desktop/sheet.png --cols 3 --bg "#f5f2ea" -- *_stamp.png     # 自定义列数/底色
```

- `--cols`:列数(默认 4);`--bg`:背景色 hex(默认 `#0e0e0e` 近黑,配投影效果好;米白纸面风用 `#f5f2ea`);`--colw`:列宽 px(默认 780)
- 邮票默认真透明背景,直接叠任意底色;排完后用 ReadMediaFile 读回确认效果
- 注意:贪心均衡会打乱传入顺序以平衡列高,这是预期行为

## 工作流

1. 从用户消息中定位输入图片路径(用户粘贴的图片通常在 `~/.kimi-code/files/` 下取最新文件)
2. 运行脚本生成邮票图(默认:无白边、透明背景;用户明确要白边时加 `margin`)
3. 用 ReadMediaFile 读回成品确认效果(透明背景可先在脚本外套棋盘格预览验证)
4. 告知用户输出路径

## 可调参数(脚本顶部)

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `margin` | 0(传 `margin` 选项时 46) | 内容到锯齿边的白边宽度 |
| `hole_r` | 14 | 打孔半圆半径 |
| `pitch` | 46 | 打孔间距(= hole_r*2+18) |
| `outer_pad` | 90 | 邮票外留白(投影空间) |
| `shadow_alpha` | 70 | 投影不透明度 |

用户要求"孔更密/更疏、白边更宽、投影更淡"等时,改对应参数重跑即可,不要重写脚本。

## 注意事项

- 投影是半透明灰色,叠深色背景无压力;叠纯白背景会看到淡影(正常设计)
- 微信等平台直接发图会把透明 PNG 压成 JPG 丢失透明,需要保透明时提醒用户以文件形式发送
- 批量处理多张图时,逐张调用脚本,不要改脚本去支持批量
