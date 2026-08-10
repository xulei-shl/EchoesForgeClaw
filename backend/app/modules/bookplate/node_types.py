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
    },
    {
        "type": NODE_PROMPT,
        "name": "提示词生成",
        "description": "基于图书元数据与图片分析流式生成图像提示词",
        "category": "generate",
        "configurable": True,
    },
    {
        "type": NODE_IMAGE,
        "name": "图像生成",
        "description": "根据提示词生成藏书票图片",
        "category": "output",
        "configurable": True,
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
]

NODE_TEMPLATE_MAP = {t["type"]: t for t in NODE_TEMPLATES}
