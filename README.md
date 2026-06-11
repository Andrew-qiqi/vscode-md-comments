# VSCode MD Comments

A VS Code extension for adding and managing review comments in Markdown files using CriticMarkup syntax.

在 Markdown 文件中添加与管理 CriticMarkup 格式批注的 VS Code 插件。

---

## 核心设计 (Core Philosophy)

- **原生内联存储 (Inline Storage)**：批注使用 CriticMarkup 语法直接插入并保存在 `.md` 文件正文中（非外部或数据库分离存储），完全跟随文件流动。
- **AI 友好 (AI Agent Friendly)**：由于批注与文本一体化存放于 Markdown 文件中，极易被各种 LLM / AI 智能体读取、理解、修改或应用。
- **Inline Storage**: Comments are saved directly in the body of the `.md` file using CriticMarkup syntax. They are kept together with the file content, not stored separately.
- **AI Friendly**: Since comments are inline within the Markdown code, they are easily visible, parseable, and editable by LLMs and AI agents.

---

## 功能介绍 (Features)

1. **语法隐藏与高亮 (Syntax Concealment & Highlighting)**:
   - 隐藏 CriticMarkup 批注的原始标记（例如 `{==`、`==}`、`{>>...<<}`），保持正文整洁。
   - 仅对被批注的文本应用背景高亮，并在文本后方添加 `💬` 提示符。
   - 当光标移入批注范围内时，自动展开显示原始 CriticMarkup 语法以供手动编辑。
   - Hides raw CriticMarkup markers (`{==`, `==}`, `{>>...<<}`) in the editor and highlights the target text with a `💬` badge.
   - Automatically reveals raw markdown code when the text cursor enters the commented area.

2. **内联输入框 (Inline Input Box)**:
   - 选中文件中的文字并执行添加命令时，在选中文本下方直接弹出一个文本输入框，输入完成后保存即可生成批注。
   - Displays a compact input box directly below the selected text to write a comment.

3. **悬浮预览与操作 (Hover Preview & Actions)**:
   - 鼠标悬停在高亮文本上会显示包含作者、日期、高亮内容和批注正文的提示面板。
   - 悬浮面板底部提供 `[✏️ Edit]`（编辑）和 `[✔️ Resolve]`（解决：移除批注，保留原文）快捷链接。
   - Hovering over a highlighted section shows comment details and quick action links (`[✏️ Edit]` and `[✔️ Resolve]`).

4. **侧边栏列表 (Sidebar Panel)**:
   - 在侧边栏“MD Comments”面板中展示当前文件的所有批注卡片。
   - 支持点击卡片定位到正文对应行、在卡片中直接修改批注内容或标记解决。
   - Lists all review comments in the current active markdown file, allowing you to navigate, edit, or resolve them.

---

## 使用方法 (Usage)

### 1. 添加批注 (Add Comment)
- **快捷键 (Shortcut)**: `Ctrl + Shift + M` (macOS: `Cmd + Shift + M`)
- **操作 (Steps)**: 选中一段文本 -> 按快捷键或右键选择 **Add Comment to Selection** -> 在弹出框中输入内容 -> 点击对勾保存。
- Select text -> Press shortcut -> Type in the input box -> Click Save.

### 2. 编辑或删除批注 (Edit or Delete)
- **方法 A (Hover)**: 鼠标悬停在高亮文本上 -> 点击 `[✏️ Edit]` 重新编辑，或点击 `[✔️ Resolve]` 解决。
- **方法 B (Sidebar)**: 在侧边栏面板列表中，点击铅笔图标编辑，或点击对勾图标解决。
- Use hover action links or the sidebar panel list to edit or remove comments.

---

## 语法规范 (Syntax Specification)

插件读写与 Obsidian 兼容的 CriticMarkup 语法：
Uses CriticMarkup syntax, compatible with Obsidian:

```markdown
{==被批注的文本==}{>>作者|日期: 批注内容<<}
```

示例 (Example):
```markdown
This is {==some text==}{>>andrew|2026-06-11: Reword this section<<} in a file.
```

---

## 配置项 (Settings)

可在 VS Code 设置中配置以下项：
Available configurations:

- `review-comments.authorName`: 写入批注时记录的作者名字，默认值为 `you`。
- `review-comments.dateFormat`: 日期的写入格式，支持 `iso` 或 `japanese`，默认值为 `iso`。
