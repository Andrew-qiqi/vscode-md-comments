import * as vscode from 'vscode';
import { parseAllComments, COMMENT_REGEX, parseMeta } from './commentParser';
import { ReviewCommentsSidebarProvider } from './sidebar';

class ReviewComment implements vscode.Comment {
  constructor(
    public body: string | vscode.MarkdownString,
    public mode: vscode.CommentMode,
    public author: vscode.CommentAuthorInformation,
    public parent: vscode.CommentThread,
    public contextValue?: string
  ) {}
}

let highlightDecorationType: vscode.TextEditorDecorationType;
let braceDecorationType: vscode.TextEditorDecorationType;
let commentDecorationType: vscode.TextEditorDecorationType;
let logChannel: vscode.OutputChannel;
let decorationTimeout: NodeJS.Timeout | undefined = undefined;



export function activate(context: vscode.ExtensionContext) {
  let activeTempThread: vscode.CommentThread | undefined = undefined;
  const commentController = vscode.comments.createCommentController('review-comments', 'Review Comments');
  context.subscriptions.push(commentController);

  // No commentingRangeProvider — removes gutter "+" icons on every line.
  // We use our own commands (right-click / shortcut) to create threads.

  // Minimize the widget: empty prompt removes the label above the textarea
  commentController.options = { prompt: '', placeHolder: 'Type your comment...' };

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

      if (activeTempThread) {
        activeTempThread.dispose();
      }

      // Create a thread and add a draft comment in Editing mode to force the input box to show
      activeTempThread = commentController.createCommentThread(editor.document.uri, selection, []);
      activeTempThread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
      activeTempThread.canReply = false;
      activeTempThread.label = '';  // empty label to remove header text

      const comment = new ReviewComment(
        '',
        vscode.CommentMode.Editing,
        { name: '' },  // empty author removes the "Reviewer" line
        activeTempThread,
        'draftComment'
      );
      activeTempThread.comments = [comment];
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error in Add Comment: ${err.message || err}`);
    }
  });

  // Command: Submit Add Comment
  const submitAddCommand = vscode.commands.registerCommand('review-comments.submitAdd', async (comment: any) => {
    try {
      const text = (typeof comment.body === 'string' ? comment.body : comment.body.value).trim();
      if (!text) {
        vscode.window.showWarningMessage('Comment cannot be empty.');
        return;
      }

      const thread = comment.parent;
      if (!thread) {
        return;
      }
      const uri = thread.uri;
      const range = thread.range;
      if (!range) {
        return;
      }
      const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());
      if (!editor) {
        thread.dispose();
        return;
      }

      const selectedText = editor.document.getText(range);

      const config = vscode.workspace.getConfiguration('review-comments');
      const author = (config.get<string>('authorName') || 'you').replace(/\|/g, '').trim();
      const dateFormat = config.get<string>('dateFormat') || 'iso';
      const dateStr = formatDate(new Date(), dateFormat);

      // Escape any <<} inside comment body
      const escapedText = text.replace(/<<}/g, "<< }");
      const commentString = `{==${selectedText}==}{>>${author}|${dateStr}: ${escapedText}<<}`;

      await editor.edit(editBuilder => {
        editBuilder.replace(range, commentString);
      });

      thread.dispose();
      if (activeTempThread === thread) {
        activeTempThread = undefined;
      }
      
      // Focus the editor to ensure hover is closed
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
      sidebarProvider.refresh();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error in Submit Add Comment: ${err.message || err}`);
    }
  });

  // Command: Cancel Add Comment
  const cancelAddCommand = vscode.commands.registerCommand('review-comments.cancelAdd', async (comment: any) => {
    try {
      const thread = comment.parent;
      if (thread) {
        thread.dispose();
        if (activeTempThread === thread) {
          activeTempThread = undefined;
        }
      }
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error in Cancel Add Comment: ${err.message || err}`);
    }
  });

  // Command: Resolve Comment
  const resolveCommand = vscode.commands.registerCommand('review-comments.resolve', async (rawComment?: string) => {
    try {
      const editor = vscode.window.activeTextEditor;
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
  const editCommand = vscode.commands.registerCommand('review-comments.edit', async (rawComment?: string) => {
    try {
      const editor = vscode.window.activeTextEditor;
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

      // Parse comment details
      const highlightMatch = targetComment.match(/^\{==([\s\S]+?)==\}\{>>([\s\S]+?)<<\}/);
      if (!highlightMatch) {
        return;
      }

      const rawMeta = highlightMatch[2];
      const parsedMeta = parseMeta(rawMeta);

      if (activeTempThread) {
        activeTempThread.dispose();
      }

      activeTempThread = commentController.createCommentThread(editor.document.uri, targetRange, []);
      activeTempThread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
      activeTempThread.canReply = false;
      activeTempThread.label = '';  // empty label to remove header text

      const comment = new ReviewComment(
        parsedMeta.body,
        vscode.CommentMode.Editing,
        { name: '' },  // empty author removes the "Reviewer" line
        activeTempThread,
        'editableComment'
      );
      activeTempThread.comments = [comment];
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error in Edit Comment: ${err.message || err}`);
    }
  });

  // Command: Submit Edit Comment
  const submitEditCommand = vscode.commands.registerCommand('review-comments.submitEdit', async (comment: any) => {
    try {
      const text = (typeof comment.body === 'string' ? comment.body : comment.body.value).trim();
      const thread = comment.parent;
      if (!thread) {
        return;
      }
      const uri = thread.uri;
      const range = thread.range;
      const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());
      if (!editor) {
        thread.dispose();
        return;
      }

      const currentText = editor.document.getText(range);
      const highlightMatch = currentText.match(/^\{==([\s\S]+?)==\}\{>>([\s\S]+?)<<\}/);
      if (!highlightMatch) {
        thread.dispose();
        return;
      }

      const highlightedText = highlightMatch[1];
      const rawMeta = highlightMatch[2];
      const parsedMeta = parseMeta(rawMeta);

      const escapedBody = text.replace(/<<}/g, "<< }");
      const newComment = `{==${highlightedText}==}{>>${parsedMeta.author}|${parsedMeta.date}: ${escapedBody}<<}`;

      await editor.edit(editBuilder => {
        editBuilder.replace(range, newComment);
      });

      thread.dispose();
      if (activeTempThread === thread) {
        activeTempThread = undefined;
      }

      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
      sidebarProvider.refresh();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error in Submit Edit Comment: ${err.message || err}`);
    }
  });

  // Command: Cancel Edit Comment
  const cancelEditCommand = vscode.commands.registerCommand('review-comments.cancelEdit', async (comment: any) => {
    try {
      const thread = comment.parent;
      if (thread) {
        thread.dispose();
        if (activeTempThread === thread) {
          activeTempThread = undefined;
        }
      }
      await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    } catch (err: any) {
      vscode.window.showErrorMessage(`Error in Cancel Edit Comment: ${err.message || err}`);
    }
  });

  context.subscriptions.push(
    addCommand,
    submitAddCommand,
    cancelAddCommand,
    resolveCommand,
    editCommand,
    submitEditCommand,
    cancelEditCommand
  );


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
      const resolveUri = vscode.Uri.parse(`command:review-comments.resolve?${encodeURIComponent(JSON.stringify(comment.full))}`);
      const editUri = vscode.Uri.parse(`command:review-comments.edit?${encodeURIComponent(JSON.stringify(comment.full))}`);

      const mdString = new vscode.MarkdownString();
      mdString.isTrusted = true;
      mdString.supportHtml = true;

      // Simplified hover tooltip: Author, Date, Edit, and Resolve on one line
      mdString.appendMarkdown(`💬 **${comment.meta.author}** · *${comment.meta.date}* &emsp; [✏️ Edit](${editUri} "Edit") &nbsp; [✅ Resolve](${resolveUri} "Resolve")\n\n`);
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
    logChannel.appendLine(`[ReviewComments] Initial editor found: ${initialEditor.document.fileName}`);
    triggerUpdateDecorations(initialEditor);
  }

  vscode.window.onDidChangeActiveTextEditor(editor => {
    if (editor) {
      logChannel.appendLine(`[ReviewComments] Active editor changed: ${editor.document.fileName}`);
      triggerUpdateDecorations(editor);
    } else {
      logChannel.appendLine("[ReviewComments] Active editor changed: None");
    }
    sidebarProvider.refresh();
  }, null, context.subscriptions);

  vscode.window.onDidChangeTextEditorSelection(event => {
    const editor = vscode.window.activeTextEditor;
    if (editor && event.textEditor === editor) {

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

      // 1. Highlight container open
      const tHighlightOpen = state.push('html_inline', '', 0);
      tHighlightOpen.content = `<span class="review-comment-highlight">`;

      // 2. Highlighted text
      const tText = state.push('text', '', 0);
      tText.content = highlighted;

      // 3. Indicator badge (placed inside highlight span, styled as a link to focus the sidebar)
      const tBadge = state.push('html_inline', '', 0);
      tBadge.content = `<a href="command:review-comments-sidebar.focus" class="review-comment-indicator-badge">💬</a>`;

      // 4. Tooltip and Closing tags as a single token to prevent tag-mismatch / sanitization issues
      const tTooltipAndClose = state.push('html_inline', '', 0);
      tTooltipAndClose.content = `<span class="review-comment-tooltip">` +
        `<span class="review-comment-tooltip-meta">` +
          `<span class="review-comment-tooltip-author">💬 <strong>${md.utils.escapeHtml(parsedMeta.author)}</strong></span>` +
          `<span class="review-comment-tooltip-date"> · <em>${md.utils.escapeHtml(parsedMeta.date)}</em></span>` +
        `</span>` +
        `<span class="review-comment-tooltip-quote">"${md.utils.escapeHtml(highlighted)}"</span>` +
        `<span class="review-comment-tooltip-body">${md.utils.escapeHtml(parsedMeta.body)}</span>` +
        `</span></span>`;

      state.pos += full.length;
    }
    return true;
  });
  return md;
}
