# 图片打包下载说明

项目提供两种全量下载方式。

## 方式一：直接下载 Release ZIP

完整图片包已经由维护者打包为 GitHub Release 附件。访问页面的“下载素材”区域，点击“直接下载 ZIP”即可获得：

```text
zhongguo-traditional-colors-images.zip
```

这种方式是公开页面的推荐下载路径，不需要等待浏览器读取和重新打包全部图片。

## 方式二：浏览器端备用打包

如果 Release 附件暂时不可用，可以在页面的“下载素材”区域点击“浏览器备用打包”。浏览器会按 `assets/data/images.js` 的清单读取 `images/` 下的全部图片，并在本机生成同名 ZIP。

注意事项：

- 请通过本地服务器或 GitHub Pages 打开页面。
- 浏览器会读取全部图片，过程取决于网络速度和设备内存。
- ZIP 使用无压缩打包，避免引入第三方依赖。

## 方式三：本地生成 Release 附件

维护者可以运行：

```bash
npm run package:images
```

输出位置：

```text
downloads/zhongguo-traditional-colors-images.zip
```

然后把 ZIP 上传为 GitHub Release 附件。这样访问者可以直接从 Release 下载完整图片包。

## 为什么不直接提交 ZIP

当前 `images/` 目录约 709MB。若再把完整 ZIP 提交进仓库，会显著增加仓库体积，也不利于后续持续扩展到 700+ 张色卡。Release 附件或浏览器端打包更适合这种大体积素材分发。

## 更新流程

新增图片后建议按这个顺序操作：

```bash
npm run manifest
npm run start
npm run package:images
```

其中 `npm run package:images` 只在需要发布新的完整下载包时运行。
