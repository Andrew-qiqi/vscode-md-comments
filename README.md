# VSCode MD Comments

Add and manage review comments directly inside Markdown files.

VSCode MD Comments stores comments as inline CriticMarkup-like text, so the review state travels with the `.md` file and remains easy for people, Git, and AI tools to inspect.

## Features

- Add comments to selected Markdown source text from the context menu or keyboard shortcut.
- Add comments from the built-in Markdown preview without switching to a custom preview.
- Edit and resolve comments from hover actions, the Markdown preview, or the sidebar.
- Highlight commented text while hiding the raw comment syntax in the editor.
- Review all comments for the current Markdown file in the `MD Comments` sidebar.
- Keep comments inline in the document instead of using an external database.

## Usage

### Add a comment in source mode

1. Open a Markdown file.
2. Select text.
3. Run `Add Comment to Selection` from the context menu, or press:
   - Windows/Linux: `Ctrl+Shift+M`
   - macOS: `Cmd+Shift+M`
4. Enter the comment in the `MD Comments` sidebar and save.

### Add a comment in Markdown preview

1. Open VS Code's built-in Markdown preview.
2. Select rendered text in the preview.
3. Click `Add Comment`.
4. Enter the comment in the sidebar and save.

The extension keeps using VS Code's native Markdown preview. It does not replace the preview with a custom editor.

### Edit or resolve comments

- In source mode, hover over highlighted text and use `Edit` or `Resolve`.
- In preview mode, hover over a highlighted comment and use `Edit` or `Resolve`.
- In the `MD Comments` sidebar, use each card's edit or resolve action.
- Click a sidebar card to navigate to the matching comment. If a matching Markdown preview is already open, the extension tries to reuse that preview; otherwise it reveals the source range.

## Storage Format

Comments are stored inline:

```markdown
This is {==some text==}{>>andrew|2026-06-13: Reword this section<<} in a file.
```

When a comment is resolved, the marker is removed and the original highlighted text is kept.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `review-comments.authorName` | `you` | Name written into new comments. |
| `review-comments.dateFormat` | `iso` | Date format. Supported values: `iso`, `japanese`. |

## Commands

| Command | Description |
| --- | --- |
| `review-comments.add` | Add a comment to the selected Markdown source text. |
| `review-comments.edit` | Edit the comment under the cursor or from a preview/sidebar action. |
| `review-comments.resolve` | Resolve the comment under the cursor or from a preview/sidebar action. |

## Notes

- The extension targets Markdown files only.
- Comments are part of the Markdown file content, so they appear in Git diffs.
- Preview integration depends on VS Code's built-in Markdown preview extension points.
- If multiple comments have identical raw markup, some actions may target the first matching instance. A stable comment-id model is planned for a future cleanup.

## Development

```bash
npm install
npm run compile
```

Build a VSIX package:

```bash
npx @vscode/vsce package
```
