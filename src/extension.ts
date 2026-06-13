import * as vscode from 'vscode';
import { parseAllComments, parseMeta, getCommentHash } from './commentParser';
import { ReviewCommentsSidebarProvider } from './sidebar';
import { PreviewSelectionPayload, locatePreviewSelection } from './previewProjection';

class ReviewComment implements vscode.Comment {
  constructor(
    public body: string | vscode.MarkdownString,
    public mode: vscode.CommentMode,
    public author: vscode.CommentAuthorInformation,
    public parent: vscode.CommentThread,
    public contextValue?: string
  ) {}
}

type PreviewAddCommandPayload = PreviewSelectionPayload & {
  source?: string;
  body?: string;
};

interface PreviewCommentCommandPayload {
  source?: string;
  rawComment: string;
  body?: string;
}

type CommentCommandPayload = string | PreviewCommentCommandPayload | undefined;

let highlightDecorationType: vscode.TextEditorDecorationType;
let braceDecorationType: vscode.TextEditorDecorationType;
let commentDecorationType: vscode.TextEditorDecorationType;
let logChannel: vscode.OutputChannel;
let decorationTimeout: NodeJS.Timeout | undefined = undefined;
let lastMarkdownDocumentUri: vscode.Uri | undefined = undefined;



export function activate(context: vscode.ExtensionContext) {
  logChannel = vscode.window.createOutputChannel("Review Comments");
  logChannel.appendLine("[ReviewComments] Activating...");
  // Initialize decoration types
  highlightDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(245, 166, 35, 0.25)',
    borderStyle: 'solid',
    borderWidth: '0 0 1.5px 0',
    borderColor: 'rgba(245, 166, 35, 0.6)',
    borderRadius: '3px'
  });

  braceDecorationType = vscode.window.createTextEditorDecorationType({
    color: 'transparent',
    textDecoration: 'none; font-size: 0px; display: inline-block; width: 0px; height: 0px; letter-spacing: -100px;'
  });

  commentDecorationType = vscode.window.createTextEditorDecorationType({
    color: 'transparent',
    textDecoration: 'none; font-size: 0px; display: inline-block; width: 0px; height: 0px; letter-spacing: -100px;',
    after: {
      contentText: '💬',
      backgroundColor: new vscode.ThemeColor('editorWidget.background'),
      color: new vscode.ThemeColor('editor.foreground'),
      border: '1px solid var(--vscode-widget-border, #3c3c3c)',
      margin: '0 3px',
      fontStyle: 'normal',
      textDecoration: 'none; font-size: 10px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; width: 14px; height: 14px; cursor: pointer; vertical-align: middle;'
    }
  });

  // Sidebar webview initialization
  const sidebarProvider = new ReviewCommentsSidebarProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ReviewCommentsSidebarProvider.viewType,
      sidebarProvider
    )
  );


  async function getBestMarkdownEditor(): Promise<vscode.TextEditor | undefined> {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor?.document.languageId === 'markdown') {
      lastMarkdownDocumentUri = activeEditor.document.uri;
      return activeEditor;
    }

    const visibleEditor = vscode.window.visibleTextEditors.find(editor => editor.document.languageId === 'markdown');
    if (visibleEditor) {
      lastMarkdownDocumentUri = visibleEditor.document.uri;
      return visibleEditor;
    }

    if (lastMarkdownDocumentUri) {
      const document = await vscode.workspace.openTextDocument(lastMarkdownDocumentUri);
      return vscode.window.showTextDocument(document, {
        preview: false,
        viewColumn: vscode.ViewColumn.Beside
      });
    }

    const markdownDocument = vscode.workspace.textDocuments.find(document => document.languageId === 'markdown');
    if (markdownDocument) {
      lastMarkdownDocumentUri = markdownDocument.uri;
      return vscode.window.showTextDocument(markdownDocument, {
        preview: false,
        viewColumn: vscode.ViewColumn.Beside
      });
    }

    return undefined;
  }

  async function getMarkdownEditorContaining(text: string, source?: string): Promise<vscode.TextEditor | undefined> {
    if (source) {
      try {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(source));
        if (document.languageId === 'markdown' && document.getText().includes(text)) {
          lastMarkdownDocumentUri = document.uri;
          return vscode.window.showTextDocument(document, {
            preview: false,
            viewColumn: vscode.ViewColumn.Beside
          });
        }
      } catch {
        // Fall back to visible/open markdown documents below.
      }
    }

    const visibleEditor = vscode.window.visibleTextEditors.find(editor =>
      editor.document.languageId === 'markdown' && editor.document.getText().includes(text)
    );
    if (visibleEditor) {
      lastMarkdownDocumentUri = visibleEditor.document.uri;
      return visibleEditor;
    }

    const openDocument = vscode.workspace.textDocuments.find(document =>
      document.languageId === 'markdown' && document.getText().includes(text)
    );
    if (openDocument) {
      lastMarkdownDocumentUri = openDocument.uri;
      return vscode.window.showTextDocument(openDocument, {
        preview: false,
        viewColumn: vscode.ViewColumn.Beside
      });
    }

    return getBestMarkdownEditor();
  }

  async function getMarkdownDocument(source?: string): Promise<vscode.TextDocument | undefined> {
    if (source) {
      try {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(source));
        if (document.languageId === 'markdown') {
          lastMarkdownDocumentUri = document.uri;
          return document;
        }
      } catch {
        // Fall back to visible/open markdown documents below.
      }
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor?.document.languageId === 'markdown') {
      lastMarkdownDocumentUri = activeEditor.document.uri;
      return activeEditor.document;
    }

    const visibleEditor = vscode.window.visibleTextEditors.find(editor => editor.document.languageId === 'markdown');
    if (visibleEditor) {
      lastMarkdownDocumentUri = visibleEditor.document.uri;
      return visibleEditor.document;
    }

    if (lastMarkdownDocumentUri) {
      const document = await vscode.workspace.openTextDocument(lastMarkdownDocumentUri);
      return document.languageId === 'markdown' ? document : undefined;
    }

    return vscode.workspace.textDocuments.find(document => document.languageId === 'markdown');
  }

  function normalizeCommentCommandPayload(payload: CommentCommandPayload): PreviewCommentCommandPayload | undefined {
    if (typeof payload === 'string') {
      return { rawComment: payload };
    }
    if (payload && typeof payload.rawComment === 'string') {
      return payload;
    }
    return undefined;
  }

  function parseUriArgs(argsStr: string): any[] {
    const parsed = JSON.parse(argsStr);
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  async function applyWorkspaceReplacement(document: vscode.TextDocument, range: vscode.Range, replacement: string) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, range, replacement);
    await vscode.workspace.applyEdit(edit);
  }

  async function getActiveMarkdownUri(resource?: vscode.Uri): Promise<vscode.Uri | undefined> {
    if (resource instanceof vscode.Uri) {
      return resource;
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor?.document.languageId === 'markdown') {
      return activeEditor.document.uri;
    }

    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (input instanceof vscode.TabInputText) {
      const document = await vscode.workspace.openTextDocument(input.uri);
      return document.languageId === 'markdown' ? document.uri : undefined;
    }

    if (input instanceof vscode.TabInputCustom && input.viewType === 'vscode.markdown.preview.editor') {
      return input.uri;
    }

    return undefined;
  }

  function syncSidebarNavigationContext() {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor?.document.languageId === 'markdown') {
      sidebarProvider.setNavigationTarget(activeEditor.document.uri, 'source');
      return;
    }

    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (input instanceof vscode.TabInputCustom && input.viewType === 'vscode.markdown.preview.editor') {
      sidebarProvider.setNavigationTarget(input.uri, 'preview', vscode.window.tabGroups.activeTabGroup.viewColumn);
    }
  }

  // Command: Add Comment to Selection
  const addCommand = vscode.commands.registerCommand('review-comments.add', async () => {
    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('Please open a Markdown file first.');
        return;
      }

      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);
      if (!selectedText || selectedText.trim() === '') {
        vscode.window.showInformationMessage('Please select some text first.');
        return;
      }

      if (
        selectedText.includes('{==') ||
        selectedText.includes('==}') ||
        selectedText.includes('{>>') ||
        selectedText.includes('<<}')
      ) {
        vscode.window.showWarningMessage('Selection already contains comment syntax.');
        return;
      }

      // Focus sidebar
      await vscode.commands.executeCommand('review-comments-sidebar.focus');
      // Show form in sidebar
      await sidebarProvider.showNewCommentForm(selectedText, selection, editor.document.uri, 'source');
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error in Add Comment: ${err.message || err}`);
    }
  });

  const addFromPreviewCommand = vscode.commands.registerCommand('review-comments.addFromPreview', async (payload: PreviewAddCommandPayload) => {
    try {
      const document = await getMarkdownDocument(payload.source);
      if (!document) {
        vscode.window.showWarningMessage('Please open a Markdown file first.');
        return;
      }

      const located = locatePreviewSelection(document.getText(), payload);
      if (!located) {
        vscode.window.showInformationMessage('Could not reliably locate this preview selection in the Markdown source. Please add the comment in Source mode.');
        return;
      }

      const range = new vscode.Range(
        document.positionAt(located.start),
        document.positionAt(located.end)
      );
      const selectedText = document.getText(range);
      if (
        selectedText.includes('{==') ||
        selectedText.includes('==}') ||
        selectedText.includes('{>>') ||
        selectedText.includes('<<}')
      ) {
        vscode.window.showWarningMessage('Selection already contains comment syntax.');
        return;
      }

      sidebarProvider.setNavigationTarget(document.uri, 'preview');
      // Focus sidebar
      await vscode.commands.executeCommand('review-comments-sidebar.focus');
      // Show form in sidebar
      await sidebarProvider.showNewCommentForm(selectedText, range, document.uri, 'preview');
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error in Add Comment from Preview: ${err.message || err}`);
    }
  });

  // Command: Resolve Comment
  const resolveCommand = vscode.commands.registerCommand('review-comments.resolve', async (payload?: CommentCommandPayload) => {
    try {
      const commandPayload = normalizeCommentCommandPayload(payload);
      const rawComment = commandPayload?.rawComment;
      if (commandPayload?.source && rawComment) {
        const document = await getMarkdownDocument(commandPayload.source);
        const source = document?.getText();
        const index = source?.indexOf(rawComment) ?? -1;
        if (!document || index === -1) {
          vscode.window.showInformationMessage('No comment found for this preview item.');
          return;
        }

        sidebarProvider.setNavigationTarget(document.uri, 'preview');
        const highlightMatch = rawComment.match(/^\{==([\s\S]+?)==\}/);
        const highlighted = highlightMatch ? highlightMatch[1] : '';
        const range = new vscode.Range(
          document.positionAt(index),
          document.positionAt(index + rawComment.length)
        );
        await applyWorkspaceReplacement(document, range, highlighted);
        sidebarProvider.refresh(document.uri.toString());
        return;
      }

      let editor = commandPayload?.source && rawComment
        ? await getMarkdownEditorContaining(rawComment, commandPayload.source)
        : vscode.window.activeTextEditor;
      if (commandPayload?.source && rawComment && !editor) {
        vscode.window.showInformationMessage('No comment found for this preview item.');
        return;
      }
      if ((!editor || editor.document.languageId !== 'markdown') && rawComment) {
        editor = await getMarkdownEditorContaining(rawComment);
      }
      if (!editor) {
        return;
      }

      let targetComment: string | undefined = rawComment;
      let targetRange: vscode.Range | undefined;

      const text = editor.document.getText();

      if (targetComment) {
        const index = text.indexOf(targetComment);
        if (index !== -1) {
          targetRange = new vscode.Range(
            editor.document.positionAt(index),
            editor.document.positionAt(index + targetComment.length)
          );
        }
      } else {
        // Find comment under cursor
        const cursorOffset = editor.document.offsetAt(editor.selection.active);
        const comments = parseAllComments(text);
        const matched = comments.find(c => cursorOffset >= c.start && cursorOffset <= c.end);
        if (matched) {
          targetComment = matched.full;
          targetRange = new vscode.Range(
            editor.document.positionAt(matched.start),
            editor.document.positionAt(matched.end)
          );
        }
      }

      if (!targetComment || !targetRange) {
        vscode.window.showInformationMessage('No comment found at the cursor.');
        return;
      }

      // Extract highlighted text: {==(.*?)==}
      const highlightMatch = targetComment.match(/^\{==([\s\S]+?)==\}/);
      const highlighted = highlightMatch ? highlightMatch[1] : '';

      await editor.edit(editBuilder => {
        editBuilder.replace(targetRange!, highlighted);
      });

      sidebarProvider.refresh();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error in Resolve Comment: ${err.message || err}`);
    }
  });

  // Command: Edit Comment
  const editCommand = vscode.commands.registerCommand('review-comments.edit', async (payload?: CommentCommandPayload) => {
    try {
      const commandPayload = normalizeCommentCommandPayload(payload);
      const rawComment = commandPayload?.rawComment;
      if (commandPayload?.source && rawComment) {
        const document = await getMarkdownDocument(commandPayload.source);
        if (!document || !document.getText().includes(rawComment)) {
          vscode.window.showInformationMessage('No comment found for this preview item.');
          return;
        }

        sidebarProvider.setNavigationTarget(document.uri, 'preview');
        await vscode.commands.executeCommand('review-comments-sidebar.focus');
        await sidebarProvider.activateEditInSidebar(rawComment, document.uri, 'preview');
        return;
      }

      let editor = commandPayload?.source && rawComment
        ? await getMarkdownEditorContaining(rawComment, commandPayload.source)
        : vscode.window.activeTextEditor;
      if (commandPayload?.source && rawComment && !editor) {
        vscode.window.showInformationMessage('No comment found for this preview item.');
        return;
      }
      if ((!editor || editor.document.languageId !== 'markdown') && rawComment) {
        editor = await getMarkdownEditorContaining(rawComment);
      }
      if (!editor) {
        return;
      }

      let targetComment: string | undefined = rawComment;
      let targetRange: vscode.Range | undefined;

      const text = editor.document.getText();

      if (targetComment) {
        const index = text.indexOf(targetComment);
        if (index !== -1) {
          targetRange = new vscode.Range(
            editor.document.positionAt(index),
            editor.document.positionAt(index + targetComment.length)
          );
        }
      } else {
        // Find comment under cursor
        const cursorOffset = editor.document.offsetAt(editor.selection.active);
        const comments = parseAllComments(text);
        const matched = comments.find(c => cursorOffset >= c.start && cursorOffset <= c.end);
        if (matched) {
          targetComment = matched.full;
          targetRange = new vscode.Range(
            editor.document.positionAt(matched.start),
            editor.document.positionAt(matched.end)
          );
        }
      }

      if (!targetComment || !targetRange) {
        vscode.window.showInformationMessage('No comment found at the cursor.');
        return;
      }

      // Scroll and select in editor
      editor.selection = new vscode.Selection(targetRange.start, targetRange.end);
      editor.revealRange(targetRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);

      // Focus sidebar
      await vscode.commands.executeCommand('review-comments-sidebar.focus');

      // Trigger editing in sidebar
      await sidebarProvider.activateEditInSidebar(targetComment, editor.document.uri, 'source');
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error in Edit Comment: ${err.message || err}`);
    }
  });

  context.subscriptions.push(
    addCommand,
    addFromPreviewCommand,
    resolveCommand,
    editCommand
  );


  const uriHandler = vscode.window.registerUriHandler({
    async handleUri(uri: vscode.Uri) {
      const action = uri.path.startsWith('/') ? uri.path.slice(1) : uri.path;
      const queryParams = new URLSearchParams(uri.query);
      const argsStr = queryParams.get('args');
      let args: any[] = [];
      if (argsStr) {
        try {
          args = parseUriArgs(argsStr);
        } catch (err) {
          logChannel.appendLine(`[ReviewComments] Failed to parse URI query args: ${argsStr}`);
        }
      }

      logChannel.appendLine(`[ReviewComments] URI Handler received action: ${action}, args: ${JSON.stringify(args)}`);

      if (action === 'focus-sidebar' || action === 'sidebar.focus') {
        await vscode.commands.executeCommand('review-comments-sidebar.focus');
      } else if (action === 'edit') {
        await vscode.commands.executeCommand('review-comments.edit', ...args);
      } else if (action === 'resolve') {
        await vscode.commands.executeCommand('review-comments.resolve', ...args);
      } else if (action === 'addFromPreview') {
        await vscode.commands.executeCommand('review-comments.addFromPreview', ...args);
      } else {
        logChannel.appendLine(`[ReviewComments] Unknown URI Handler action: ${action}`);
      }
    }
  });
  context.subscriptions.push(uriHandler);


  // Hover Provider registration
  const hoverProvider = vscode.languages.registerHoverProvider('markdown', {
    provideHover(document, position) {
      const offset = document.offsetAt(position);
      const text = document.getText();
      const comments = parseAllComments(text);

      // Check if cursor is hovering over any part of the comment range
      const comment = comments.find(c => {
        return offset >= c.start && offset <= c.end;
      });

      if (!comment) {
        return undefined;
      }

      // Do not show hover if the user's cursor is on the same line as the comment (i.e. it is unfolded and they are editing it)
      const editor = vscode.window.activeTextEditor;
      const resolveUri = vscode.Uri.parse(`command:review-comments.resolve?${encodeURIComponent(JSON.stringify([comment.full]))}`);
      const editUri = vscode.Uri.parse(`command:review-comments.edit?${encodeURIComponent(JSON.stringify([comment.full]))}`);

      const mdString = new vscode.MarkdownString();
      mdString.isTrusted = true;
      mdString.supportHtml = true;

      // Simplified hover tooltip: Author, Date, Edit, and Resolve on one line
      mdString.appendMarkdown(`💬 **${comment.meta.author}** · *${comment.meta.date}* &emsp; [Edit](${editUri} "Edit") &nbsp; [Resolve](${resolveUri} "Resolve")\n\n`);
      mdString.appendMarkdown(`${comment.meta.body}`);

      // Use the actual highlight range so VS Code's hover background matches our decoration
      const highlightStart = comment.start + 3;
      const highlightEnd = highlightStart + comment.highlighted.length;
      const hoverRange = new vscode.Range(
        document.positionAt(highlightStart),
        document.positionAt(highlightEnd)
      );

      return new vscode.Hover(mdString, hoverRange);
    }
  });

  context.subscriptions.push(hoverProvider);

  // Decoration listeners
  const initialEditor = vscode.window.activeTextEditor;
  if (initialEditor) {
    if (initialEditor.document.languageId === 'markdown') {
      lastMarkdownDocumentUri = initialEditor.document.uri;
    }
    logChannel.appendLine(`[ReviewComments] Initial editor found: ${initialEditor.document.fileName}`);
    triggerUpdateDecorations(initialEditor);
  }
  syncSidebarNavigationContext();

  vscode.window.onDidChangeActiveTextEditor(editor => {
    if (editor) {
      if (editor.document.languageId === 'markdown') {
        lastMarkdownDocumentUri = editor.document.uri;
      }
      logChannel.appendLine(`[ReviewComments] Active editor changed: ${editor.document.fileName}`);
      triggerUpdateDecorations(editor);
    } else {
      logChannel.appendLine("[ReviewComments] Active editor changed: None");
    }
    syncSidebarNavigationContext();
    sidebarProvider.refresh();
  }, null, context.subscriptions);

  vscode.window.tabGroups.onDidChangeTabs(() => {
    syncSidebarNavigationContext();
    sidebarProvider.refresh();
  }, null, context.subscriptions);

  vscode.window.onDidChangeVisibleTextEditors(() => {
    syncSidebarNavigationContext();
    sidebarProvider.refresh();
  }, null, context.subscriptions);

  vscode.window.onDidChangeTextEditorSelection(event => {
    const editor = vscode.window.activeTextEditor;
    if (editor && event.textEditor === editor) {
      sidebarProvider.setNavigationTarget(editor.document.uri, 'source');

      triggerUpdateDecorations(editor);

      // Auto scroll-sync in sidebar
      const cursorOffset = editor.document.offsetAt(editor.selection.active);
      const text = editor.document.getText();
      const comments = parseAllComments(text);
      const activeComment = comments.find(c => cursorOffset >= c.start && cursorOffset <= c.end);
      if (activeComment) {
        sidebarProvider.highlightCommentInSidebar(activeComment.full);

        // If user clicked the 💬 badge (cursor lands inside the comment metadata range)
        const highlightEnd = activeComment.start + 3 + activeComment.highlighted.length;
        const commentMetaStart = highlightEnd + 3;
        if (cursorOffset >= commentMetaStart && cursorOffset <= activeComment.end) {
          vscode.commands.executeCommand('review-comments-sidebar.focus');
        }
      }
    }
  }, null, context.subscriptions);

  vscode.workspace.onDidChangeTextDocument(event => {
    const editor = vscode.window.activeTextEditor;
    if (editor && event.document === editor.document) {
      triggerUpdateDecorations(editor);
    }
    if (event.document.languageId === 'markdown') {
      sidebarProvider.refresh();
    }
  }, null, context.subscriptions);

  vscode.workspace.onDidCloseTextDocument(document => {
    if (document.languageId === 'markdown') {
      syncSidebarNavigationContext();
      sidebarProvider.refresh();
    }
  }, null, context.subscriptions);

  function triggerUpdateDecorations(editor: vscode.TextEditor) {
    if (editor.document.languageId !== 'markdown') {
      return;
    }
    if (decorationTimeout) {
      clearTimeout(decorationTimeout);
    }
    decorationTimeout = setTimeout(() => {
      try {
        updateDecorations(editor);
      } catch (err) {
        logChannel.appendLine(`[ReviewComments] Error updating decorations: ${err}`);
      }
    }, 30);
  }

  function updateDecorations(editor: vscode.TextEditor) {
    const text = editor.document.getText();
    const comments = parseAllComments(text);

    logChannel.appendLine(`[ReviewComments] --- updateDecorations Start ---`);
    logChannel.appendLine(`[ReviewComments] Document: ${editor.document.fileName}`);
    logChannel.appendLine(`[ReviewComments] Found ${comments.length} comments.`);

    const highlightDecorations: vscode.DecorationOptions[] = [];
    const braceDecorations: vscode.DecorationOptions[] = [];
    const commentDecorations: vscode.DecorationOptions[] = [];

    comments.forEach((comment, idx) => {
      // 1. Highlight range (always highlighted)
      const highlightStart = comment.start + 3;
      const highlightEnd = highlightStart + comment.highlighted.length;
      highlightDecorations.push({
        range: new vscode.Range(
          editor.document.positionAt(highlightStart),
          editor.document.positionAt(highlightEnd)
        )
      });

      // 2. Hide {== brace
      braceDecorations.push({
        range: new vscode.Range(
          editor.document.positionAt(comment.start),
          editor.document.positionAt(comment.start + 3)
        )
      });

      // 3. Hide ==} brace
      braceDecorations.push({
        range: new vscode.Range(
          editor.document.positionAt(highlightEnd),
          editor.document.positionAt(highlightEnd + 3)
        )
      });

      // 4. Hide comment meta {>>author|date: body<<} and replace with indicator
      const commentMetaStart = highlightEnd + 3;
      commentDecorations.push({
        range: new vscode.Range(
          editor.document.positionAt(commentMetaStart),
          editor.document.positionAt(comment.end)
        )
      });
    });

    editor.setDecorations(highlightDecorationType, highlightDecorations);
    editor.setDecorations(braceDecorationType, braceDecorations);
    editor.setDecorations(commentDecorationType, commentDecorations);
    logChannel.appendLine(`[ReviewComments] Applied decorations: highlight=${highlightDecorations.length}, brace=${braceDecorations.length}, comment=${commentDecorations.length}`);
    logChannel.appendLine(`[ReviewComments] --- updateDecorations End ---`);
  }

  return {
    extendMarkdownIt
  };
}

export function deactivate() {
  if (highlightDecorationType) { highlightDecorationType.dispose(); }
  if (braceDecorationType) { braceDecorationType.dispose(); }
  if (commentDecorationType) { commentDecorationType.dispose(); }
}

function formatDate(date: Date, format: string): string {
  const yyyy = date.getFullYear();
  const MM = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  if (format === 'japanese') {
    return `${yyyy}年${MM}月${dd}日`;
  }
  return `${yyyy}-${MM}-${dd}`;
}

export function extendMarkdownIt(md: any) {
  // Inject document source URI so frontend scripts can resolve the path in native preview mode
  md.core.ruler.push('review_comments_metadata', (state: any) => {
    const docUri = state.env?.resource || lastMarkdownDocumentUri;
    const uriScheme = vscode.env.uriScheme;
    if (docUri) {
      const docUriStr = docUri.toString();
      const token = new state.Token('html_block', '', 0);
      token.content = `<div id="vscode-markdown-preview-data" data-settings="${escapeAttribute(JSON.stringify({ source: docUriStr, uriScheme }))}" hidden></div>`;
      state.tokens.unshift(token);
    }
  });

  md.inline.ruler.before('text', 'review_comments', (state: any, silent: boolean) => {
    const text = state.src.slice(state.pos);
    const regex = /^\{==([\s\S]+?)==\}\{>>([\s\S]+?)<<\}/;
    const match = regex.exec(text);
    if (!match) {
      return false;
    }

    if (!silent) {
      const full = match[0];
      const highlighted = match[1];
      const rawMeta = match[2];
      const parsedMeta = parseMeta(rawMeta);
      const commentId = `review-comment-${getCommentHash(full)}`;
      const encodedFull = encodeURIComponent(full);

      // 1. Highlight container open
      const docUri = state.env?.resource || lastMarkdownDocumentUri;
      const docUriStr = docUri ? docUri.toString() : '';
      const uriScheme = vscode.env.uriScheme;
      const encodedCommentPayload = encodeURIComponent(JSON.stringify([{ source: docUriStr, rawComment: full }]));
      const tHighlightOpen = state.push('html_inline', '', 0);
      tHighlightOpen.content = `<span id="${commentId}" class="review-comment-highlight" data-review-comment-raw="${encodedFull}" data-review-comment-source="${docUriStr}">`;

      // 2. Highlighted text
      const tText = state.push('text', '', 0);
      tText.content = highlighted;

      // 3. Indicator badge (placed inside highlight span, styled as a link to focus the sidebar)
      const tBadge = state.push('html_inline', '', 0);
      tBadge.content = `<a href="${uriScheme}://andrew-qiqi.vscode-md-comments/sidebar.focus" class="review-comment-indicator-badge" title="Focus Sidebar">💬</a>`;

      // 4. Tooltip and Closing tags as a single token to prevent tag-mismatch / sanitization issues
      const tTooltipAndClose = state.push('html_inline', '', 0);
      tTooltipAndClose.content = `<span class="review-comment-tooltip">` +
        `<span class="review-comment-tooltip-meta">` +
          `<span class="review-comment-tooltip-author">💬 <strong>${md.utils.escapeHtml(parsedMeta.author)}</strong></span>` +
          `<span class="review-comment-tooltip-date"> · <em>${md.utils.escapeHtml(parsedMeta.date)}</em></span>` +
          `<span class="review-comment-tooltip-actions">` +
            `<a href="${uriScheme}://andrew-qiqi.vscode-md-comments/edit?args=${encodedCommentPayload}" title="Edit Comment">Edit</a>` +
            `<a href="${uriScheme}://andrew-qiqi.vscode-md-comments/resolve?args=${encodedCommentPayload}" title="Resolve Comment">Resolve</a>` +
          `</span>` +
        `</span>` +
        `<span class="review-comment-tooltip-body">${md.utils.escapeHtml(parsedMeta.body)}</span>` +
        `</span></span>`;

      state.pos += full.length;
    }
    return true;
  });
  return md;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
