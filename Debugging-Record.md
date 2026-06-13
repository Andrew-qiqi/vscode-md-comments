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

## 2026-06-13 Sidebar preview jump ignores existing preview after hash navigation

- Method: Traced the sidebar `jump` message through `_jumpInOpenPreview`, preview tab matching, Markdown-it preview metadata, and `media/preview.js` hash handling.
- Finding: After the first preview jump, the preview tab/source URI can carry a `#review-comment-*` fragment. Later comparisons treated `file.md#review-comment-*` and `file.md` as different sources, so the existing preview was not reliably reused.
- Finding: Re-clicking the same sidebar card can keep the same hash, so the native preview page may not fire `hashchange` and the scroll highlight appears to do nothing.
- Change: Normalized Markdown source URIs by stripping fragments before storing navigation context, opening source documents, matching preview tabs, and emitting preview/sidebar command payloads.
- Change: Added a per-jump nonce to preview hash fragments and taught `media/preview.js` to strip that nonce before looking up the real comment element id.
- Verification: Ran `npx tsc --noEmit` and `npm run compile`; both completed successfully.
- Result: Sidebar card clicks should reuse the already-open native Markdown preview for the same source file and trigger scrolling even when the same comment is clicked repeatedly.

## 2026-06-13 Sidebar preview jump still opens new preview with hash URI

- Method: Rechecked VS Code's built-in Markdown preview implementation after user feedback. The custom editor preview identity includes the opened URI, so `vscode.openWith(file.md#hash, vscode.markdown.preview.editor)` can create a separate preview input.
- Finding: Native Markdown preview has an internal `scrollTo(line)` path, but it is not exposed as a public command to other extensions. It is triggered by source editor visible-range/selection sync.
- Change: Removed hash-based native preview opening from sidebar jumps. When a matching preview is open, the sidebar now reveals the source range to drive VS Code's built-in preview scroll sync, then refocuses the existing preview with the fragment-free source URI.
- Verification: Ran `npx tsc --noEmit` and `npm run compile`; both completed successfully.
- Result: Sidebar card clicks should stop creating hash-based duplicate previews and should scroll the existing native preview through VS Code's source-to-preview synchronization.

## 2026-06-13 Dynamic Markdown preview clears sidebar context

- Method: Checked VS Code tab input types and the built-in Markdown preview implementation after source-left/preview-right feedback.
- Finding: `Open Preview` can use a dynamic webview tab with view type `markdown.preview`, not only the custom editor view type `vscode.markdown.preview.editor`. `TabInputWebview` exposes the view type but not the source URI.
- Finding: When focus moved from the source editor to this dynamic preview, the sidebar could not resolve the active Markdown document and rendered an empty/no-editor state.
- Change: Treat `markdown.preview` as a Markdown surface. When it is active, use the stored or visible Markdown source document as the preview's source context.
- Change: Updated extension navigation context sync to mark dynamic Markdown preview focus as preview mode for the last/visible Markdown source.
- Verification: Ran `npx tsc --noEmit` and `npm run compile`; both completed successfully.
- Result: With source and preview open side by side, clicking the preview should keep the sidebar populated with the source document's comments.

## 2026-06-13 Preview source context should come from injected preview metadata

- Method: Revisited the dynamic preview context strategy after noting that fallback to recent/visible source is weaker than using metadata already injected into the preview.
- Finding: The Markdown-it plugin injects `#vscode-markdown-preview-data` into every preview render with the source URI, even when the document has no comments.
- Change: Tried a `previewActive` URI handler action so the preview script could report its injected source URI on pointer/focus/content-update events.
- Verification: Ran `npx tsc --noEmit` and `npm run compile`; both completed successfully.
- Result: Superseded by the next entry after user reported blank native previews.

## 2026-06-13 Preview goes blank after automatic previewActive URI reporting

- Method: Rechecked `media/preview.js` after user reported all Markdown preview variants rendered blank.
- Finding: Programmatically creating and clicking a custom-scheme anchor from inside the native preview can be treated as webview navigation, replacing the preview content with a blank page.
- Change: Removed automatic `previewActive` custom URI dispatch from preview load, pointer, focus, and content-update events, then removed the now-unused handler/provider method. Kept non-navigating dynamic preview/source fallback logic in the extension.
- Verification: Ran `npx tsc --noEmit` and `npm run compile`; both completed successfully.
- Result: Native Markdown preview should render again; do not use programmatic anchor clicks from preview scripts for background context reporting.

## 2026-06-13 Resolve dynamic native preview source through markdown.showSource

- Method: Rechecked the built-in Markdown extension command path. Dynamic `markdown.preview` keeps its source mapping internally and exposes it indirectly through `markdown.showSource`.
- Finding: Recent/visible-source fallback is not robust when only a dynamic preview remains or when multiple Markdown documents are open.
- Change: Added a dynamic-preview source cache keyed by preview column. If a dynamic preview has no cached/visible source, call `markdown.showSource`, read the source editor URI that VS Code opens, cache it, and try `workbench.action.navigateBack` to return focus to the preview.
- Change: Made tab/editor visibility handlers await navigation-context sync before refreshing the sidebar to avoid transient empty states.
- Verification: Ran `npx tsc --noEmit` and `npm run compile`; both completed successfully.
- Result: Dynamic native preview source resolution now uses VS Code's own preview-source mapping before falling back to stored context.

## 2026-06-13 Refresh sidebar from resolved dynamic preview source before returning

- Method: Rechecked the dynamic-preview-only flow after user feedback: `markdown.showSource` opened the correct source, then focus returned toward preview, but the sidebar still stayed empty.
- Finding: The source URI was resolved correctly, but the sidebar was still refreshed later through the normal active-context path. After `navigateBack`, that path can no longer see a source editor and can overwrite the resolved context with an empty state.
- Change: Made dynamic-preview context sync refresh the sidebar directly with the resolved source URI before attempting `workbench.action.navigateBack`.
- Change: Made context sync report when it already refreshed the sidebar, so editor/tab visibility events do not immediately run a second source-less refresh.
- Verification: Ran `npx tsc --noEmit` and `npm run compile`; both completed successfully.
- Result: Dynamic preview source resolution and sidebar loading now happen as one ordered operation.
