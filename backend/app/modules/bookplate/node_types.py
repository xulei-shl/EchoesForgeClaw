"""bookplate 节点模板定义。

节点模板是画板节点类型的静态定义（由代码内置）；管理端基于模板创建
「节点配置」（NodeConfig），同一模板的不同 llm/agent 绑定即不同节点变体。
"""

# 节点模板类型
NODE_BOOK_INFO = "book_info"
NODE_IMAGE_ANALYSIS = "image_analysis"
NODE_PROMPT = "prompt_generation"
NODE_IMAGE = "image_generation"
NODE_TEXT = "text"
NODE_IMAGE_UPLOAD = "image_upload"
NODE_CHAT = "chat"
NODE_TEXT_AGGREGATE = "text_aggregate"
NODE_PROMPT_SEARCH = "prompt_search"
NODE_SKILL_SEARCH = "skill_search"
NODE_CALENDAR = "calendar"
NODE_WEATHER = "weather"
NODE_MAP_POSTER = "map_poster"

NODE_TEMPLATES = [
    {
        "type": NODE_BOOK_INFO,
        "name": "图书元数据",
        "description": "通过豆瓣 API 获取 ISBN 对应的图书元数据",
        "category": "input",
        "configurable": False,
        "output_type": "text",
    },
    {
        "type": NODE_IMAGE_ANALYSIS,
        "name": "图片分析",
        "description": "多模态模型分析封面 / 参考图，输出艺术风格与主题色分析",
        "category": "analysis",
        "configurable": True,
        # 端口类型（唯一权威）：输出类型 + 接受的输入类型列表，经 node-registry 下发前端做连线校验。
        # 输入收集以「直接连线」为准（画线连上即输入），类型仅用于不匹配提示。
        "output_type": "text",
        "input_types": ["image", "text"],
    },
    {
        "type": NODE_PROMPT,
        "name": "提示词生成",
        "description": "基于图书元数据与图片分析流式生成图像提示词",
        "category": "generate",
        "configurable": True,
        "output_type": "text",
        "input_types": ["text"],
    },
    {
        "type": NODE_IMAGE,
        "name": "图像生成",
        "description": "根据提示词生成藏书票图片",
        "category": "output",
        "configurable": True,
        "output_type": "image",
        "input_types": ["text", "image"],
    },
    {
        "type": NODE_TEXT,
        "name": "文本",
        "description": "手动输入 / 编辑 Markdown 文本，作为工作流中的笔记或说明",
        "category": "input",
        "configurable": False,
        "output_type": "text",
    },
    {
        "type": NODE_IMAGE_UPLOAD,
        "name": "图片上传",
        "description": "手动上传一张图片到画布，作为工作流中的参考素材",
        "category": "input",
        "configurable": False,
        "output_type": "image",
    },
    {
        "type": NODE_CHAT,
        "name": "AI 对话",
        "description": "多轮对话 AI 助手，可绑定大模型或 FastClaw Agent，输出最后一轮回复",
        "category": "generate",
        "configurable": True,
        # 接受文本（上一级节点内容）+ 图片（图片上传 / 图像生成节点的输出，作为视觉上下文）
        # + document（Skill 检索节点的 skill 包，作为 Skill Agent 的 skill 来源）
        "output_type": "text",
        "input_types": ["text", "image", "document"],
    },
    {
        "type": NODE_TEXT_AGGREGATE,
        "name": "文本聚合",
        "description": "用占位符模板把多个上级文本按自定义格式拼接（如 ## 标题 + {占位符}）",
        "category": "tool",
        "configurable": False,
        "output_type": "text",
        "input_types": ["text"],
    },
    {
        "type": NODE_PROMPT_SEARCH,
        "name": "提示词检索",
        "description": "从 Bifrost 提示词库检索并选用一条提示词，将其内容作为文本输出",
        "category": "input",
        "configurable": False,
        "output_type": "text",
    },
    {
        "type": NODE_SKILL_SEARCH,
        "name": "Skill 检索",
        "description": "从 Bifrost Skills 仓库检索并安装 skill（或直接上传本地 skill zip），作为 Skill Agent 的 skill 来源",
        "category": "input",
        "configurable": False,
        # 输出为 skill 包（文件夹 + SKILL.md + scripts），作为 Skill Agent 的上游 skill 来源
        "output_type": "document",
    },
    {
        "type": NODE_CALENDAR,
        "name": "万年历",
        "description": "查询指定日期的节假日与农历万年历（MXNZP API，无需配置）",
        "category": "tool",
        "configurable": False,
        "output_type": "text",
    },
    {
        "type": NODE_WEATHER,
        "name": "天气查询",
        "description": "查询指定城市当前天气（wttr.in，可连线文本节点传入城市，无需配置）",
        "category": "tool",
        "configurable": False,
        "output_type": "text",
        "input_types": ["text"],
    },
    {
        "type": NODE_MAP_POSTER,
        "name": "地图海报生成",
        "description": "搜索地点并生成地图海报图片（Leaflet 瓦片 / MapLibre 艺术主题，浏览器端渲染导出）",
        "category": "multimodal",
        "configurable": False,
        "output_type": "image",
    },
]

NODE_TEMPLATE_MAP = {t["type"]: t for t in NODE_TEMPLATES}
