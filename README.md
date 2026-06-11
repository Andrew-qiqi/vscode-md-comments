# VSCode MD Comments

Notion-style review comments stored as CriticMarkup. Highlighting/Concealment inside your markdown documents.

存放为 CriticMarkup 格式的 Notion 式批注/评论插件。在 Markdown 编辑器中进行优雅的高亮与遮罩隐藏。

---

## Features / 特色功能

1. **Elegant Highlighting & Concealment (优雅的高亮与隐藏遮罩)**:
   - Hides the raw braces and meta tags (`{==`, `==}`, `{>>...<<}`) in the editor.
   - Highlights the annotated text with a warm background, showing a subtle `💬` badge.
   - 自动隐藏编辑器中的原始大括号与元数据标记，仅高亮标注文本并伴随 `💬` 气泡提示。

2. **Compact Inline Comment Input (极致精简的内联输入框)**:
   - Selecting text and running "Add Comment" pops up a clean, single-textarea input box directly below your cursor.
   - 选中文字执行“Add Comment”，将在光标下方弹出精炼的文本框输入批注，绝不占用多余空间。

3. **Hover Panel Actions (悬浮面板快捷操作)**:
   - Hovering over a comment displays its details, along with quick links to **[✏️ Edit]** or **[✔️ Resolve]**.
   - 悬浮在批注文本上可查看详情，并能通过快捷链接直接 **[✏️ 编辑]** 或 **[✔️ 解决]**（保留原文并移去批注）。

4. **Interactive Sidebar (互动式侧边栏)**:
   - Displays all comments in the current file in a sidebar, allowing you to jump, edit, or resolve comments.
   - 侧边栏集中展示当前文件的所有批注卡片，支持点击定位跳转、快捷修改与删除。

5. **Cursor-Based Reveal (光标移入自动展现原码)**:
   - Move your cursor into the comment zone to reveal the raw CriticMarkup instantly for manual editing.
   - 光标移入批注区域时自动恢复 CriticMarkup 源代码，方便手动精准修改。

---

## Quick Start / 快速上手

### Add Comment / 添加评论
- **Shortcut / 快捷键**: `Ctrl + Shift + M` (macOS: `Cmd + Shift + M`)
- Select any text, press the shortcut, type your comment in the popup, and click **Save** (check icon).
- 选中任意文本，按下快捷键，在弹出的输入框中输入批注，然后点击对勾保存。

### Edit or Resolve / 编辑或解决
- **Hover**: Move mouse over highlighted text -> click `[✏️ Edit]` or `[✔️ Resolve]`.
- **Sidebar**: Click the speech bubble icon in the Activity Bar to manage comments.
- **悬停预览**：鼠标移到高亮文字上 -> 点击 `[✏️ Edit]` 重新编辑，或 `[✔️ Resolve]` 标记解决。
- **侧边栏**：点击左侧活动栏气泡图标，在面板中统一管理与跳转。

---

## Configuration / 配置项

You can customize the following settings in your VS Code settings:
您可以在 VS Code 设置中配置以下项：

- `review-comments.authorName`: The name recorded in the comment (default: `you`).
  - 批注中记录的作者名称（默认值：`you`）。
- `review-comments.dateFormat`: Format of the date (`iso` or `japanese`, default: `iso`).
  - 日期时间戳的格式（`iso` 或 `japanese`，默认值：`iso`）。

---

## Syntax Specification / 语法规范

This extension reads and writes CriticMarkup comments natively compatible with Obsidian and standard markdown tools:
本插件原生支持与 Obsidian 及通用 Markdown 工具完美兼容的 CriticMarkup 语法：

```markdown
{==Highlighted Text==}{>>Author|Date: Comment Body<<}
```

*Example / 示例*:
```markdown
This is {==some text==}{>>andrew|2026-06-11: Reword this section<<} in a file.
```
