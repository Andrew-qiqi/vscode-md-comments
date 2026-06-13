# Debugging Record

## 2026-06-13 Preview add comment click has no effect

- Method: Searched the preview add-comment flow with `rg`, then inspected `media/preview.js`, `src/extension.ts`, and `src/commentsPreview.ts`.
- Finding: The preview floating button kept `lastPayload` undefined, so the click handler returned without doing anything. The same handler also called an undefined `executeCommand(...)`, and the element was a `button` even though native Markdown preview command routing depends on a URI link.
- Change: Converted the preview floating control to an anchor styled as a button, saved the current selection payload during `updateButton()`, and generated the existing extension URI handler URL for `review-comments.addFromPreview`.
- Change: Added `uriScheme` to the custom preview settings so URI handler links use the active VS Code-compatible scheme instead of always falling back to `vscode`.
- Simplification: Removed the unused preview `acquireVsCodeApi` wrapper after switching add-comment dispatch to URI handler links.
- Verification: Ran `npm run compile`; esbuild completed successfully.
- Result: Preview selection now produces a clickable Add Comment link that dispatches to the existing `review-comments.addFromPreview` command path and opens the sidebar comment form.

## 2026-06-13 Preview actions lose target document

- Method: Inspected the native Markdown preview URI flow, sidebar message handling, and source-document lookup. Used subagents to review the preview path and maintainability risks.
- Finding: Preview add/edit/resolve could enter the sidebar without preserving the originating Markdown URI. Sidebar save/resolve/jump then guessed the current Markdown document, which can be wrong after preview/sidebar focus changes.
- Finding: URI handler parsed `URLSearchParams.get("args")` with an extra `decodeURIComponent`, so preview selections or comments containing `%` could throw `URIError` before dispatching.
- Change: Added `onUri` activation so native preview URI callbacks activate the extension reliably.
- Change: Made preview Edit/Resolve links pass `{ source, rawComment }`, and made command handlers prioritize the source document when that payload is present.
- Change: Made sidebar messages carry and consume `source`, and made post-edit refreshes target the edited document URI.
- Verification: Ran `npx tsc --noEmit` and `npm run compile`; both completed successfully.
- Result: Native Markdown preview actions now keep their target document through sidebar create/save/resolve paths without introducing a custom preview.

## 2026-06-13 Preview edit opens duplicate source editor

- Method: Traced preview Add/Edit/Resolve command paths and sidebar edit activation after source-aware payload handling was added.
- Finding: Preview actions still called `showTextDocument` through `addFromPreview` and `getMarkdownEditorContaining`, so clicking Edit/Add in preview could open or reveal a Markdown source editor even when the user only wanted to edit from preview.
- Finding: The sidebar card Edit flow sent a `jump` message when entering edit mode, which could also trigger source navigation.
- Change: Made preview Add open only the sidebar new-comment form after resolving the preview selection in the background.
- Change: Made preview Edit verify the target source document in the background, refresh the sidebar to that document, and activate the matching card edit form without revealing the source editor.
- Change: Made preview Resolve apply the workspace edit directly against the source document without opening the source editor.
- Change: Removed the implicit sidebar `jump` from Edit; clicking the card body remains the explicit navigation path.
- Verification: Ran `npx tsc --noEmit` and `npm run compile`; both completed successfully.
- Result: Native preview Add/Edit/Resolve no longer intentionally open Markdown source editors; source navigation is reserved for explicit card clicks.

## 2026-06-13 Sidebar jump opens duplicate preview before source

- Method: Traced sidebar card `jump` handling after preview-mode navigation state was added.
- Finding: Sidebar jump still called `markdown.showPreview` with a hash URI when the last interaction mode was preview. In native Markdown preview this can open or recreate a preview tab instead of scrolling the existing preview.
- Finding: Normal sidebar refresh could keep stale comments visible when no Markdown editor or preview surface remained open.
- Change: Removed the `markdown.showPreview` jump path from sidebar card clicks. Card clicks now reuse a visible source editor when available, otherwise open a single source editor and reveal the comment range.
- Change: Added an open Markdown surface check before normal sidebar refresh. If no Markdown source or preview tab is open, sidebar context is cleared and the view reports `no_editor`.
- Verification: Ran `npx tsc --noEmit` and `npm run compile`; both completed successfully.
- Result: Sidebar card clicks no longer intentionally create duplicate preview tabs, and closing all Markdown surfaces clears the sidebar state promptly.

## 2026-06-13 Source add comment opens sidebar without input form

- Method: Traced the source-mode `review-comments.add` command through sidebar focus, webview ready handling, refresh, and `showNewForm` delivery.
- Finding: The sidebar `ready` handler started `refresh()` without awaiting it, then flushed pending actions. The later update message could clear the new-comment container after the form had been shown.
- Finding: When the sidebar was already visible, `showNewCommentForm` posted directly instead of sequencing after a refresh to the target source document.
- Change: Made `showNewCommentForm` asynchronous and route through a pending action. When the sidebar is visible, it refreshes the target document first, then flushes the pending `showNewForm`.
- Change: Awaited `showNewCommentForm` from both source and preview add commands.
- Change: Prevented normal update messages from clearing an already open new-comment form.
- Verification: Ran `npx tsc --noEmit` and `npm run compile`; both completed successfully.
- Result: Source-mode Add Comment should open the sidebar and enter the new-comment input form in a single command invocation.

## 2026-06-13 Sidebar card click should prefer current preview

- Method: Checked VS Code Markdown preview command behavior against the built-in markdown extension implementation. `markdown.showPreview` chooses a preview column from the active text editor, which is unstable after focus moves to the sidebar.
- Finding: Sidebar card clicks fell back to source navigation because the previous preview jump path could create duplicate preview tabs.
- Change: Added preview view-column tracking when the active tab is the native Markdown preview custom editor.
- Change: On sidebar card jump, first look for an already-open native Markdown preview for the same source URI and call `vscode.openWith` in that preview's editor group using the comment hash fragment.
- Change: Kept the source editor reveal path as a fallback when no open preview tab can be found.
- Verification: Ran `npx tsc --noEmit` and `npm run compile`; both completed successfully.
- Result: Sidebar card clicks now prefer the existing native preview tab before opening/revealing source.
