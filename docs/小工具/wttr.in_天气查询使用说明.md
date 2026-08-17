# wttr.in 天气查询使用说明

> 一个基于命令行的天气查询工具，通过 `curl` 即可获取全球各地天气信息。

---

## 1. 基本用法

```bash
# 自动定位当前所在地（基于 IP）
curl wttr.in

# 指定城市
curl wttr.in/beijing           # 城市拼音
curl wttr.in/上海               # 中文名
curl wttr.in/Tokyo             # 英文名
curl wttr.in/muc               # 机场代码（3字母）
curl wttr.in/94107             # 邮编（美国）
curl wttr.in/-78.46,106.79     # GPS 经纬度
curl wttr.in/@stackoverflow.com # 域名定位
```

---

## 2. 显示模式

| 参数 | 说明 |
|------|------|
| `?0` | 仅当前天气 |
| `?1` | 当前天气 + 今日预报 |
| `?2` | 当前天气 + 今明两天预报 |
| `?q` | 安静模式（不显示 "Weather report" 文字） |
| `?Q` | 超级安静模式（不显示城市名） |
| `?n` | 紧凑版（仅白天/夜间） |
| `?d` | 限制为控制台标准字体符号 |
| `?F` | 不显示 "Follow" 行 |
| `?T` | 关闭终端颜色序列 |

### 组合示例

```bash
# 当前天气，安静模式，无颜色
curl wttr.in/beijing?0qT

# 今明两天预报，安静模式
curl wttr.in/beijing?2q

# 最简洁：仅当前天气 + 安静 + 无颜色
curl wttr.in/beijing?0qF
```

---

## 3. 单位设置

| 参数 | 说明 |
|------|------|
| `m` | 公制（默认，除美国外） |
| `u` | 美制（美国默认） |
| `M` | 风速显示为 m/s |

```bash
curl wttr.in/beijing?0m     # 公制
curl wttr.in/beijing?0u     # 美制
curl wttr.in/beijing?0M     # 风速用 m/s
```

---

## 4. 中文本地化

```bash
curl wttr.in/beijing?lang=zh

# 或通过 HTTP 请求头
curl -H "Accept-Language: zh" wttr.in/beijing

# 子域名方式
curl zh.wttr.in/beijing
```

---

## 5. 月相信息

```bash
curl wttr.in/moon                    # 当前月相
curl wttr.in/moon@2026-12-25         # 指定日期月相
curl wttr.in/moon,+China            # 指定地区月相
```

---

## 6. PNG 图片输出

```bash
curl wttr.in/beijing.png             # 生成 PNG 图片
curl wttr.in/beijing_0pq.png        # 组合参数（用下划线分隔）
curl wttr.in/beijing.png?0pq        # 或使用 ? 传参

# PNG 专用选项
curl wttr.in/paris.png?p            # 添加边框
curl wttr.in/paris.png?t            # 透明度 150
curl wttr.in/paris.png?transparency=200
curl wttr.in/paris.png?background=00aaaa  # 自定义背景色
```

---

## 7. 实用技巧

### 7.1 定义 Shell 函数（alias）

将以下内容添加到 `~/.bashrc` 或 `~/.zshrc`：

```bash
# 天气查询函数
weather() {
    local city="${1:-}"        # 城市，默认为当前定位
    local days="${2:-0}"       # 天数：0=当前, 1=今天, 2=今明
    local lang="${3:-zh}"      # 语言：zh=中文, en=英文

    if [ -z "$city" ]; then
        curl "wttr.in?${days}q&lang=${lang}"
    else
        curl "wttr.in/${city}?${days}q&lang=${lang}"
    fi
}
```

用法示例：

```bash
weather               # 当前定位，当前天气，中文
weather beijing 2     # 北京，今明两天，中文
weather Tokyo 1 en    # 东京，今日预报，英文
```

### 7.2 备用域名

如果 `wttr.in` 无法访问，可使用等效备用域名：

```bash
curl wttr.is                # 完全等效的备用域名
curl wttr.is/London         # 支持所有功能
```

---

## 8. 快速参考速查表

| 目标 | 命令 |
|------|------|
| 本地天气 | `curl wttr.in` |
| 指定城市当前天气 | `curl wttr.in/beijing?0` |
| 指定城市两天预报 | `curl wttr.in/beijing?2` |
| 中文显示 | `curl wttr.in/beijing?lang=zh` |
| 中文明天预报 | `curl wttr.in/beijing?1&lang=zh` |
| 月相 | `curl wttr.in/moon` |
| 输出PNG | `curl wttr.in/beijing.png` |
| 备用域名 | `curl wttr.is/beijing` |

---

> **信息来源**：[wttr.in](https://github.com/chubin/wttr.in) — 一个面向控制台的世界天气查询服务。
