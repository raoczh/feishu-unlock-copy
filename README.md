# 飞书文档一键复制解锁脚本

一个油猴脚本，用于解除飞书云文档的复制限制，支持一键复制全部内容。

## 功能特点

- 解除飞书文档禁止复制、禁止选中、禁止右键的限制
- 支持 Wiki / Docs / Docx 等飞书云文档类型
- 提供「复制全部」按钮，一键复制全文内容
- 自动滚动页面收集虚拟列表中的全部内容
- 兼容 feishu.cn / larksuite.com / feishu.net 域名

## 安装方法

1. 首先安装油猴扩展（Tampermonkey）
   - Chrome: [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - Firefox: [Tampermonkey](https://addons.mozilla.org/firefox/addon/tampermonkey/)
   - Edge: [Tampermonkey](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

2. 点击安装脚本：[安装链接](https://greasyfork.org/zh-CN/scripts/577009-%E4%B8%80%E9%94%AE%E5%A4%8D%E5%88%B6%E9%A3%9E%E4%B9%A6%E6%96%87%E6%A1%A3%E5%85%A8%E9%83%A8%E5%86%85%E5%AE%B9)（或手动添加脚本）

3. 打开飞书文档，页面右下角会出现「📋 复制全部」按钮

## 使用方法

1. 打开任意飞书云文档
2. 页面加载完成后，右下角会显示「已解除复制限制 ✓」提示
3. 你可以：
   - 直接选中复制文本（原本禁止复制的现在可以复制了）
   - 点击右下角「📋 复制全部」按钮一键复制全文

## 技术原理

- 注入 CSS 强制开启文本选择
- 拦截事件阻止，绕过 preventDefault / stopPropagation
- 清理 inline 属性禁用事件
- 使用 TreeWalker 解决飞书 block 编辑器跨段落复制问题
- 滚动虚拟列表收集完整内容

## 兼容性

- Chrome / Firefox / Edge 等现代浏览器
- 支持 Tampermonkey / Violentmonkey / Greasemonkey

## 许可证

MIT License

## 作者

[raoczh](https://github.com/raoczh)
