---
name: canvas-multimodal-presets
description: "多模态视觉与排版节点的预设词典：玻璃折射、微浮雕、物理水彩、水墨写意、图片处理、图书卡片、图书小票。当用户用风格词描述想要的效果（朦胧感、复古、国潮、胶片、赛博感……），需要把它落成某个 node_type 的 presetId / mode / effectId / templateId 时使用。"
---

# 多模态预设词典

用法：把下表的预设 ID 放进 `canvas_create_node` 的 `data` 对应键里，例如
`{ "type": "glass_refract", "data": { "presetId": "vintage_cross" } }`。
`canvas_get_presets(node_type)` 返回同一份 ID，需要确认时再调。

本词典只覆盖节点与预设的对应关系，节点本身的用途与端口见 `canvas-node-catalog`。

## 1. 玻璃折射 (`glass_refract`)，配置参数：`data: { presetId: "..." }`
- `classic_fluted`: 经典长虹（纵向条纹经典长虹玻璃，法式门窗隔断感）
- `vintage_cross`: 法式十字格（枕状透镜方格，经典优雅）
- `retro_block`: 复古玻璃砖（方形厚重平顶倒角采光玻璃砖）
- `rainy_window`: 雨夜车窗（密布不规则雨水水痕小透镜，朦胧街景感）
- `water_ripple`: 水波倒影（同心圆波纹涟漪，微风水面倒影）
- `dynamic_wave`: 律动波浪（锯齿折线流线型韵律波纹）
- `hammered_facet`: 欧式锤纹（手工压花荔枝纹不规则锤击切面）
- `flemish_flow`: 佛兰芒流动曲面（双层自然流动波荡手工吹制玻璃感）
- `frosted_blur`: 冰霜磨砂（高频微噪点折射，柔和隐私磨砂质感）

## 2. 微浮雕高光 (`emboss_foil`)，配置参数：`data: { presetId: "..." }`
- `topography_opal`: 欧泊等高线（等高线指纹肌理 + 欧泊翡翠天青幻彩高光 + 邮票打孔）
- `cyber_neon`: 赛博霓虹卡（几何等高网格 + 赛博电光洋红/电青激光）
- `rose_emboss`: 玫瑰香槟浮雕（纸张微凹凸浮雕 + 暮色玫瑰粉金微光 + 邮票纸边）
- `nebula_grain`: 星云幻夜磨砂（细腻磨砂肌理 + 星云魅夜紫蓝荧光）
- `rainbow_foil`: 全息彩虹闪卡（宝可梦式全光谱彩虹镭射全息光斑）
- `warm_gold`: 经典烫金浮雕（纸质微浮雕 + 奢雅古典香槟暖金）
- `platinum_minimal`: 珠光铂金冷光（冰蓝淡粉纯净冷冽铂金 + 满版无白边）
- `obsidian_metal`: 黑曜黑金卡（几何等高网格 + 黑曜暗金与黑钛重金属高光）

## 3. 物理水彩 (`watercolor_brush`)，配置参数：`data: { mode: "..." }`
- `spiral_vortex`: 螺线律动（连续曲线笔触、流光彩带与漩涡星云）
- `woven_grid`: 浮水织锦（海床流场波动经纬、水彩光斑与交错排线）
- `watercolor_clouds`: 云阶水彩（纯净水彩有机云团晕染）
- `topographic_strata`: 山川层峦（东方青绿等高线山峦）
- `matisse_cutouts`: 剪纸留白（马蒂斯现代几何剪纸造型）
- `botanical_bloom`: 绽放花轮（植物花瓣层次渐变）
- `bauhaus_grid`: 包豪斯版画（现代主义色块构成与贯穿排线）
- `zen_splash`: 破墨飞白（东方水墨书法粗重圆相与写意渗透）
- `abstract_sketch`: 表现手绘（纯粹向量流场速写与飞线动势）
- `ukiyo_wave`: 浮世浪涌（浮世绘巨浪浪峰与密实排线）
- `aerosol_spray`: 气溶胶喷绘（喷枪微粒、气溶胶街头晕染与星云散点）
- `mineral_rubbing`: 拓印岩彩（干画粉彩多层涂抹与粗粝矿物岩石截面）

## 4. 水墨写意 (`ink_wash`)，配置参数：`data: { mode: "..." }`
- `zen_splash`: 破墨飞白（苍劲书法圆相、浓墨破水、飞白留韵）
- `mountain_mist`: 远山烟岚（层峦叠嶂、远山如黛、烟雨溟蒙）
- `misty_rain`: 烟雨江南（柔水润墨、水汽氤氲、水墨清岚）
- `plum_branch`: 疏影横斜（劲挺寒枝、点染墨梅、虚实相生）
- `lone_boat`: 寒江独钓（澄江如练、一叶轻舟、计白当黑）
- `scorched_bamboo`: 焦墨劲竹（焦墨干擦、节节凌云、骨法用笔）
- `splashing_waves`: 惊涛骇浪（激流翻卷、水汽喷涌、气势磅礴）
- `image_trace`: 底图拓印（根据上游图像明暗与边缘梯度，宣纸水墨拓印）

## 5. 图片处理 (`image_process`)，配置参数：`data: { effectId: "..." }`
- `crt`: CRT 扫描线（显像管电视扫描线与色差效果）
- `texture`: 纸质纹理（叠加各种纸张或材质肌理）
- `grain`: 胶片颗粒（模拟银盐胶片颗粒感噪点）
- `halftone`: 网点半色调（波普艺术与报刊印刷网点效果）
- `dither`: 复古抖动（经典 8-bit / 16-bit 像素抖动质感）
- `ascii`: 字符画（将图像转换为 ASCII 字符排列效果）

## 6. 图书卡片排版模板 (`book_card`)，配置参数：`data: { templateId: "..." }`
（仅用于把上游图文排成卡片；录入图书数据请用 `book_info`）
- 内置 20 种卡片排版模板：`默认`、`2026黑色`、`claude背景色极简`、`做旧卡片`、`可爱猫咪`、`圆盘做旧`、`学术手账`、`封面图白色蒙版极简`、`左红线条简洁`、`打字机`、`杂乱线条`、`点阵`、`瑞士灰色网格风格`、`电路板`、`绿色大字`、`色子`、`蓝天白墙`、`蓝色档案`、`黄色电光`、`黑灰极简`

## 7. 图书小票 (`receipt_printer`)，配置参数：`data: { templateId: "..." }`
- `book_recommend`: 图书推荐小票（经典热敏纸排版、书目推荐与金句）
- `reading_log`: 借阅记录卡（借还日期、图书馆印章与借阅流水）
- `itemized`: 消费/书单清单（条目清单式热敏小票）
- `book_excerpt`: 摘录折页（书籍精选段落折页卡片）
- `retro_menu`: 复古单据（仿旧式账单/收据格式）
- `ancient_bookmark`: 古籍仿宣书签（仿宣纸折页与竖排古籍书签样式）
