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

NODE_TEMPLATES = [
    {
        "type": NODE_BOOK_INFO,
        "name": "图书元数据",
        "description": "通过豆瓣 API 获取 ISBN 对应的图书元数据",
        "category": "input",
        "configurable": False,
    },
    {
        "type": NODE_IMAGE_ANALYSIS,
        "name": "图片分析",
        "description": "多模态模型分析封面 / 参考图，输出艺术风格与主题色分析",
        "category": "analysis",
        "configurable": True,
        # 输入槽位声明（唯一权威）：哪些上游节点类型 → 提供什么输入；
        # 前端经 node-registry 获取后驱动执行引擎（resolveNodeInputs）
        "input_slots": [
            {"slot": "metadata", "from": [NODE_BOOK_INFO]},
            {"slot": "image", "from": [NODE_IMAGE_UPLOAD]},
        ],
    },
    {
        "type": NODE_PROMPT,
        "name": "提示词生成",
        "description": "基于图书元数据与图片分析流式生成图像提示词",
        "category": "generate",
        "configurable": True,
        "input_slots": [
            {"slot": "metadata", "from": [NODE_BOOK_INFO]},
            {"slot": "analysis", "from": [NODE_IMAGE_ANALYSIS]},
            # AI 对话节点的回复同样作为补充文本上下文
            {"slot": "text", "from": [NODE_TEXT, NODE_CHAT]},
        ],
    },
    {
        "type": NODE_IMAGE,
        "name": "图像生成",
        "description": "根据提示词生成藏书票图片",
        "category": "output",
        "configurable": True,
        "input_slots": [
            {"slot": "prompt", "from": [NODE_PROMPT, NODE_BOOK_INFO]},
            {"slot": "image", "from": [NODE_IMAGE_UPLOAD]},
        ],
    },
    {
        "type": NODE_TEXT,
        "name": "文本",
        "description": "手动输入 / 编辑 Markdown 文本，作为工作流中的笔记或说明",
        "category": "input",
        "configurable": False,
    },
    {
        "type": NODE_IMAGE_UPLOAD,
        "name": "图片上传",
        "description": "手动上传一张图片到画布，作为工作流中的参考素材",
        "category": "input",
        "configurable": False,
    },
    {
        "type": NODE_CHAT,
        "name": "AI 对话",
        "description": "多轮对话 AI 助手，可绑定大模型或 FastClaw Agent，输出最后一轮回复",
        "category": "generate",
        "configurable": True,
        # 图书元数据作为可选上下文；「紧随的上一级节点内容」为通用直接父节点机制（前端逻辑）
        "input_slots": [
            {"slot": "metadata", "from": [NODE_BOOK_INFO]},
        ],
    },
]

NODE_TEMPLATE_MAP = {t["type"]: t for t in NODE_TEMPLATES}
