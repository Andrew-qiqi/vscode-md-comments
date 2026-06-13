import * as vscode from 'vscode';
import { parseAllComments } from './commentParser';

export class ReviewCommentsSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'review-comments-sidebar';
  private _view?: vscode.WebviewView;
  private _activeDocumentUri?: vscode.Uri;
  private _navigationTarget?: {
    mode: 'preview' | 'source';
    uri: vscode.Uri;
    viewColumn?: vscode.ViewColumn;
  };
  private _pendingAction?: {
    type: 'activateEdit' | 'showNewForm';
    payload: any;
  };

  constructor(private readonly _extensionContext: vscode.ExtensionContext) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionContext.extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      const document = await this._getCurrentMarkdownDocument(data.source);

      switch (data.type) {
        case 'ready': {
          await this.refresh(this._pendingAction?.payload?.source);
          this._flushPendingAction();
          break;
        }
        case 'jump': {
          if (document) {
            const text = document.getText();
            const index = text.indexOf(data.full);
            if (index !== -1) {
              const startPos = document.positionAt(index);
              const endPos = document.positionAt(index + data.full.length);
              const range = new vscode.Range(startPos, endPos);

              if (await this._jumpInOpenPreview(document.uri, range)) {
                break;
              }

              this._navigationTarget = { uri: document.uri, mode: 'source' };
              const visibleEditor = vscode.window.visibleTextEditors.find(editor =>
                editor.document.uri.toString() === document.uri.toString()
              );
              const editor = visibleEditor || await vscode.window.showTextDocument(document, {
                preview: false,
                preserveFocus: false
              });

              editor.selection = new vscode.Selection(startPos, endPos);
              editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
            }
          }
          break;
        }
        case 'resolve': {
          if (document) {
            const text = document.getText();
            const index = text.indexOf(data.full);
            if (index !== -1) {
              const startPos = document.positionAt(index);
              const endPos = document.positionAt(index + data.full.length);
              const edit = new vscode.WorkspaceEdit();
              edit.replace(document.uri, new vscode.Range(startPos, endPos), data.highlighted);
              await vscode.workspace.applyEdit(edit);
              this.refresh(document.uri.toString());
            }
          }
          break;
        }
        case 'save': {
          if (document) {
            const text = document.getText();
            const index = text.indexOf(data.full);
            if (index !== -1) {
              const startPos = document.positionAt(index);
              const endPos = document.positionAt(index + data.full.length);
              
              // Format new comment: {==highlighted==}{>>author|date: body<<}
              // Escape any <<} inside new comment body
              const escapedBody = data.newBody.replace(/<<}/g, "<< }");
              const newRaw = `{==${data.highlighted}==}{>>${data.author}|${data.date}: ${escapedBody}<<}`;
              
              const edit = new vscode.WorkspaceEdit();
              edit.replace(document.uri, new vscode.Range(startPos, endPos), newRaw);
              await vscode.workspace.applyEdit(edit);
              this.refresh(document.uri.toString());
            }
          }
          break;
        }
        case 'create': {
          if (document) {
            const rangeJson = data.range;
            const range = new vscode.Range(
              rangeJson.startLine,
              rangeJson.startCharacter,
              rangeJson.endLine,
              rangeJson.endCharacter
            );

            const config = vscode.workspace.getConfiguration('review-comments');
            const author = (config.get<string>('authorName') || 'you').replace(/\|/g, '').trim();
            const dateFormat = config.get<string>('dateFormat') || 'iso';
            const dateStr = formatDate(new Date(), dateFormat);

            const escapedText = data.body.replace(/<<}/g, "<< }");
            const commentString = `{==${data.selectedText}==}{>>${author}|${dateStr}: ${escapedText}<<}`;

            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, range, commentString);
            await vscode.workspace.applyEdit(edit);
            this.refresh(document.uri.toString());
          }
          break;
        }
      }
    });

    // Handle view visibility changes
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.refresh();
      }
    });
  }

  public highlightCommentInSidebar(commentFullText: string) {
    if (this._view && this._view.visible) {
      this._view.webview.postMessage({
        type: 'highlight',
        full: commentFullText
      });
    }
  }

  public setNavigationTarget(uri: vscode.Uri, mode: 'preview' | 'source', viewColumn?: vscode.ViewColumn) {
    const sourceUri = this._sourceUri(uri);
    this._navigationTarget = { uri: sourceUri, mode, viewColumn };
    this._activeDocumentUri = sourceUri;
  }

  public async setNavigationTargetAndRefresh(uri: vscode.Uri, mode: 'preview' | 'source', viewColumn?: vscode.ViewColumn) {
    const sourceUri = this._sourceUri(uri);
    this.setNavigationTarget(sourceUri, mode, viewColumn);
    await this.refresh(sourceUri.toString());
  }

  public async activateEditInSidebar(commentFullText: string, sourceUri?: vscode.Uri, mode: 'preview' | 'source' = 'source') {
    if (sourceUri) {
      sourceUri = this._sourceUri(sourceUri);
      this._activeDocumentUri = sourceUri;
      this._navigationTarget = { uri: sourceUri, mode };
    }
    this._pendingAction = {
      type: 'activateEdit',
      payload: { full: commentFullText, source: sourceUri?.toString() }
    };
    if (this._view && this._view.visible) {
      await this.refresh(sourceUri?.toString());
      this._flushPendingAction();
    }
  }

  public async showNewCommentForm(selectedText: string, range: vscode.Range, sourceUri: vscode.Uri, mode: 'preview' | 'source' = 'source') {
    sourceUri = this._sourceUri(sourceUri);
    this._activeDocumentUri = sourceUri;
    this._navigationTarget = { uri: sourceUri, mode };
    const rangeJson = {
      startLine: range.start.line,
      startCharacter: range.start.character,
      endLine: range.end.line,
      endCharacter: range.end.character
    };
    const payload = {
      selectedText,
      range: rangeJson,
      source: sourceUri.toString()
    };
    this._pendingAction = {
      type: 'showNewForm',
      payload
    };
    if (this._view && this._view.visible) {
      await this.refresh(sourceUri.toString());
      this._flushPendingAction();
    }
  }

  public async refresh(source?: string) {
    if (!this._view) {
      return;
    }

    if (!source && !this._hasOpenMarkdownSurface()) {
      this._activeDocumentUri = undefined;
      this._navigationTarget = undefined;
      this._view.webview.postMessage({ type: 'update', state: 'no_editor' });
      return;
    }

    const document = await this._getCurrentMarkdownDocument(source, Boolean(source));
    if (!document) {
      if (!source) {
        this._activeDocumentUri = undefined;
        this._navigationTarget = undefined;
      }
      this._view.webview.postMessage({ type: 'update', state: 'no_editor' });
      return;
    }

    const text = document.getText();
    const comments = parseAllComments(text);

    this._view.webview.postMessage({
      type: 'update',
      state: 'loaded',
      source: this._sourceUri(document.uri).toString(),
      comments
    });
  }

  private _flushPendingAction() {
    if (!this._pendingAction) {
      return;
    }

    if (this._pendingAction.type === 'activateEdit') {
      this._view?.webview.postMessage({
        type: 'activateEdit',
        ...this._pendingAction.payload
      });
    } else if (this._pendingAction.type === 'showNewForm') {
      this._view?.webview.postMessage({
        type: 'showNewForm',
        ...this._pendingAction.payload
      });
    }
    this._pendingAction = undefined;
  }

  private async _getCurrentMarkdownDocument(source?: string, allowStoredContext: boolean = false): Promise<vscode.TextDocument | undefined> {
    if (source) {
      try {
        const sourceUri = this._sourceUri(vscode.Uri.parse(source));
        const document = await vscode.workspace.openTextDocument(sourceUri);
        if (document.languageId === 'markdown') {
          this._activeDocumentUri = this._sourceUri(document.uri);
          return document;
        }
      } catch {
        // Fall back to active editor/tab below.
      }
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor?.document.languageId === 'markdown') {
      this._activeDocumentUri = this._sourceUri(activeEditor.document.uri);
      return activeEditor.document;
    }

    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const input = activeTab?.input;

    if (input instanceof vscode.TabInputText) {
      const document = await vscode.workspace.openTextDocument(this._sourceUri(input.uri));
      if (document.languageId === 'markdown') {
        this._activeDocumentUri = this._sourceUri(document.uri);
        return document;
      }
      return undefined;
    }

    if (
      input instanceof vscode.TabInputCustom &&
      this._isMarkdownPreviewViewType(input.viewType)
    ) {
      const document = await vscode.workspace.openTextDocument(this._sourceUri(input.uri));
      if (document.languageId === 'markdown') {
        this._activeDocumentUri = this._sourceUri(document.uri);
        return document;
      }
      return undefined;
    }

    if (input instanceof vscode.TabInputWebview && this._isMarkdownPreviewViewType(input.viewType)) {
      const document = await this._getStoredMarkdownDocument();
      if (document) {
        return document;
      }
    }

    const visibleEditor = this._getBestVisibleMarkdownEditor();
    if (visibleEditor) {
      this._activeDocumentUri = this._sourceUri(visibleEditor.document.uri);
      return visibleEditor.document;
    }

    if (allowStoredContext) {
      return this._getStoredMarkdownDocument();
    }

    return undefined;
  }

  private async _getStoredMarkdownDocument(): Promise<vscode.TextDocument | undefined> {
    if (this._activeDocumentUri) {
      const document = await vscode.workspace.openTextDocument(this._activeDocumentUri);
      return document.languageId === 'markdown' ? document : undefined;
    }

    return undefined;
  }

  private _hasOpenMarkdownSurface(): boolean {
    if (vscode.window.visibleTextEditors.some(editor => editor.document.languageId === 'markdown')) {
      return true;
    }

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input instanceof vscode.TabInputText) {
          // Do not open the document here; only check already known text documents.
          const document = vscode.workspace.textDocuments.find(doc => this._sameSourceUri(doc.uri, input.uri));
          if (document?.languageId === 'markdown') {
            return true;
          }
        }
        if (
          input instanceof vscode.TabInputCustom &&
          this._isMarkdownPreviewViewType(input.viewType)
        ) {
          return true;
        }
        if (
          input instanceof vscode.TabInputWebview &&
          this._isMarkdownPreviewViewType(input.viewType)
        ) {
          return true;
        }
      }
    }

    return false;
  }

  private async _jumpInOpenPreview(uri: vscode.Uri, range: vscode.Range): Promise<boolean> {
    const sourceUri = this._sourceUri(uri);
    const target = this._navigationTarget;
    if (!target || target.mode !== 'preview' || !this._sameSourceUri(target.uri, sourceUri)) {
      return false;
    }

    const previewColumn = this._findOpenPreviewColumn(sourceUri);
    if (!previewColumn) {
      return false;
    }

    const document = await vscode.workspace.openTextDocument(sourceUri);
    const visibleEditor = vscode.window.visibleTextEditors.find(editor =>
      this._sameSourceUri(editor.document.uri, sourceUri)
    );
    const editor = visibleEditor ?? await vscode.window.showTextDocument(document, {
      viewColumn: this._sourceColumnForPreview(previewColumn),
      preview: false,
      preserveFocus: true
    });
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

    await vscode.commands.executeCommand('vscode.openWith', sourceUri, 'vscode.markdown.preview.editor', {
      viewColumn: previewColumn,
      preserveFocus: false,
      preview: false
    });
    return true;
  }

  private _findOpenPreviewColumn(uri: vscode.Uri): vscode.ViewColumn | undefined {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (
          input instanceof vscode.TabInputCustom &&
          this._isMarkdownPreviewViewType(input.viewType) &&
          this._sameSourceUri(input.uri, uri)
        ) {
          return group.viewColumn;
        }
        if (
          input instanceof vscode.TabInputWebview &&
          this._isMarkdownPreviewViewType(input.viewType) &&
          this._activeDocumentUri &&
          this._sameSourceUri(this._activeDocumentUri, uri)
        ) {
          return group.viewColumn;
        }
      }
    }

    return undefined;
  }

  private _sourceColumnForPreview(previewColumn: vscode.ViewColumn): vscode.ViewColumn {
    return previewColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;
  }

  private _getBestVisibleMarkdownEditor(): vscode.TextEditor | undefined {
    if (this._activeDocumentUri) {
      const matchingEditor = vscode.window.visibleTextEditors.find(editor =>
        editor.document.languageId === 'markdown' &&
        this._sameSourceUri(editor.document.uri, this._activeDocumentUri!)
      );
      if (matchingEditor) {
        return matchingEditor;
      }
    }

    return vscode.window.visibleTextEditors.find(editor => editor.document.languageId === 'markdown');
  }

  private _isMarkdownPreviewViewType(viewType: string): boolean {
    return viewType === 'vscode.markdown.preview.editor' ||
      viewType === 'markdown.preview' ||
      viewType === 'review-comments.preview';
  }

  private _sourceUri(uri: vscode.Uri): vscode.Uri {
    return uri.with({ fragment: '' });
  }

  private _sameSourceUri(left: vscode.Uri, right: vscode.Uri): boolean {
    return this._sourceUri(left).toString() === this._sourceUri(right).toString();
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Review Comments</title>
  <style>
    body {
      padding: 10px;
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family, system-ui, -apple-system, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      background-color: var(--vscode-editor-background);
    }
    
    .comment-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .review-comment-card {
      background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
      border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, #3c3c3c));
      border-left: 3px solid var(--vscode-button-background, #007acc);
      border-radius: 6px;
      padding: 10px 12px;
      cursor: pointer;
      position: relative;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }

    .review-comment-card:hover {
      border-color: var(--vscode-button-background);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
    }

    .review-comment-card.editing {
      border-color: var(--vscode-focusBorder, #007acc) !important;
      box-shadow: 0 0 6px var(--vscode-focusBorder, #007acc);
      background-color: var(--vscode-editor-inactiveSelectionBackground, rgba(0, 122, 204, 0.08));
    }

    .review-comment-card.new-comment-card {
      border-left-color: var(--vscode-charts-green, #388a34);
      margin-bottom: 12px;
    }

    .review-comment-card-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
    }

    .review-comment-card-icon {
      font-size: 13px;
    }

    .review-comment-card-meta {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      font-weight: 500;
    }

    .review-comment-card-header-actions {
      margin-left: auto;
      display: flex;
      gap: 4px;
      opacity: 0.3;
      transition: opacity 0.2s ease;
    }

    .review-comment-card:hover .review-comment-card-header-actions {
      opacity: 1;
    }

    .review-comment-card-action-icon-btn {
      background: transparent;
      border: none;
      cursor: pointer;
      font-size: 11px;
      padding: 2px 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--vscode-descriptionForeground);
    }

    .review-comment-card-action-icon-btn:hover {
      background-color: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
      color: var(--vscode-foreground);
    }

    .review-comment-card-action-icon-btn.resolve:hover {
      color: #7ed321;
    }

    .review-comment-card-original {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-textBlockQuote-background, rgba(0, 0, 0, 0.1));
      border-left: 2px solid var(--vscode-textBlockQuote-border, var(--vscode-button-background));
      padding: 4px 6px;
      margin-bottom: 6px;
      border-radius: 3px;
      font-style: italic;
      word-break: break-all;
      max-height: 48px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .review-comment-card-body {
      font-size: 12.5px;
      line-height: 1.45;
      color: var(--vscode-foreground);
      word-break: break-word;
      white-space: pre-wrap;
    }

    /* Editing state */
    .review-comment-card-edit-container {
      margin-top: 6px;
      display: none;
    }

    .review-comment-card-textarea {
      width: 100%;
      min-height: 60px;
      font-size: 12px;
      padding: 6px 8px;
      border-radius: 4px;
      border: 1px solid var(--vscode-input-border, #3c3c3c);
      background: var(--vscode-input-background, #252526);
      color: var(--vscode-input-foreground, #cccccc);
      resize: vertical;
      box-sizing: border-box;
      margin-bottom: 6px;
      font-family: inherit;
    }

    .review-comment-card-textarea:focus {
      outline: none;
      border-color: var(--vscode-focusBorder, #007acc);
    }

    .review-comment-card-edit-actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
    }

    .review-comment-card-btn {
      font-size: 11px;
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid var(--vscode-button-border, transparent);
      font-weight: 500;
    }

    .review-comment-card-btn.cancel {
      background: transparent;
      color: var(--vscode-foreground);
      border-color: var(--vscode-button-border, var(--vscode-widget-border, #3c3c3c));
    }

    .review-comment-card-btn.cancel:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(255, 255, 255, 0.1));
    }

    .review-comment-card-btn.save {
      background: var(--vscode-button-background, #007acc);
      color: var(--vscode-button-foreground, #ffffff);
    }

    .review-comment-card-btn.save:hover {
      background: var(--vscode-button-hoverBackground, #0062a3);
    }

    .empty-state {
      color: var(--vscode-descriptionForeground);
      text-align: center;
      padding: 20px;
      font-size: 12px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div id="new-comment-container" style="display: none; margin-bottom: 15px;"></div>
  <div id="content"></div>

  <script>
    const vscode = acquireVsCodeApi();
    const contentEl = document.getElementById('content');
    const newCommentContainerEl = document.getElementById('new-comment-container');

    // Signal ready to get initial data
    vscode.postMessage({ type: 'ready' });

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'update') {
        if (newCommentContainerEl.style.display !== 'block') {
          newCommentContainerEl.innerHTML = '';
        }
        render(message.state, message.comments || [], message.source);
      } else if (message.type === 'highlight') {
        const cards = document.querySelectorAll('.review-comment-card');
        cards.forEach(card => {
          if (card.getAttribute('data-full') === message.full) {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            card.style.borderColor = 'var(--vscode-focusBorder)';
            card.style.boxShadow = '0 0 6px var(--vscode-focusBorder)';
            setTimeout(() => {
              card.style.borderColor = '';
              card.style.boxShadow = '';
            }, 1500);
          }
        });
      } else if (message.type === 'activateEdit') {
        const cards = document.querySelectorAll('.review-comment-card');
        cards.forEach(card => {
          if (card.getAttribute('data-full') === message.full) {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            const editContainer = card.querySelector('.review-comment-card-edit-container');
            if (editContainer && editContainer.style.display !== 'block') {
              const editBtn = card.querySelector('.review-comment-card-action-icon-btn[title="Edit"]');
              if (editBtn) {
                editBtn.click();
              }
            }
          }
        });
      } else if (message.type === 'showNewForm') {
        showNewCommentForm(message);
      }
    });

    function showNewCommentForm(data) {
      newCommentContainerEl.innerHTML = '';
      newCommentContainerEl.style.display = 'block';
      newCommentContainerEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      // Dismiss any existing card edits
      const activeTextareas = document.querySelectorAll('.review-comment-card-edit-container');
      activeTextareas.forEach(el => {
        if (el.style.display === 'block') {
          const cancelBtn = el.querySelector('.review-comment-card-btn.cancel');
          if (cancelBtn) cancelBtn.click();
        }
      });

      const card = document.createElement('div');
      card.className = 'review-comment-card new-comment-card';

      const header = document.createElement('div');
      header.className = 'review-comment-card-header';

      const icon = document.createElement('span');
      icon.className = 'review-comment-card-icon';
      icon.textContent = '➕';

      const meta = document.createElement('span');
      meta.className = 'review-comment-card-meta';
      meta.textContent = 'New Comment';

      header.appendChild(icon);
      header.appendChild(meta);

      const original = document.createElement('div');
      original.className = 'review-comment-card-original';
      original.textContent = '"' + data.selectedText + '"';

      const editContainer = document.createElement('div');
      editContainer.className = 'review-comment-card-edit-container';
      editContainer.style.display = 'block';

      const textarea = document.createElement('textarea');
      textarea.className = 'review-comment-card-textarea';
      textarea.placeholder = 'Type your comment...';

      const editActions = document.createElement('div');
      editActions.className = 'review-comment-card-edit-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'review-comment-card-btn cancel';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        newCommentContainerEl.style.display = 'none';
        newCommentContainerEl.innerHTML = '';
      });

      const saveBtn = document.createElement('button');
      saveBtn.className = 'review-comment-card-btn save';
      saveBtn.textContent = 'Save';
      saveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = textarea.value.trim();
        if (val) {
          vscode.postMessage({
            type: 'create',
            selectedText: data.selectedText,
            range: data.range,
            source: data.source,
            body: val
          });
        }
        newCommentContainerEl.style.display = 'none';
        newCommentContainerEl.innerHTML = '';
      });

      editActions.appendChild(cancelBtn);
      editActions.appendChild(saveBtn);
      editContainer.appendChild(textarea);
      editContainer.appendChild(editActions);

      card.appendChild(header);
      card.appendChild(original);
      card.appendChild(editContainer);
      newCommentContainerEl.appendChild(card);

      setTimeout(() => {
        textarea.focus();
      }, 50);
    }

    function render(state, comments, source) {
      contentEl.innerHTML = '';

      if (state === 'no_editor') {
        contentEl.innerHTML = '<div class="empty-state">Please open a markdown file.</div>';
        return;
      }

      if (comments.length === 0) {
        contentEl.innerHTML = '<div class="empty-state">No comments yet. Select text, right-click and choose "Add Comment to Selection".</div>';
        return;
      }

      const listEl = document.createElement('div');
      listEl.className = 'comment-list';

      comments.forEach(comment => {
        const card = document.createElement('div');
        card.className = 'review-comment-card';
        card.setAttribute('data-full', comment.full);

        // Card click handler to jump to editor range
        card.addEventListener('click', (e) => {
          if (e.target.closest('.review-comment-card-header-actions') || 
              e.target.closest('.review-comment-card-edit-container')) {
            return;
          }
          vscode.postMessage({
            type: 'jump',
            source,
            full: comment.full
          });
        });

        // Header
        const header = document.createElement('div');
        header.className = 'review-comment-card-header';
        
        const icon = document.createElement('span');
        icon.className = 'review-comment-card-icon';
        icon.textContent = '💬';

        const meta = document.createElement('span');
        meta.className = 'review-comment-card-meta';
        meta.textContent = comment.meta.author + ' · ' + comment.meta.date;

        const actions = document.createElement('div');
        actions.className = 'review-comment-card-header-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'review-comment-card-action-icon-btn';
        editBtn.title = 'Edit';
        editBtn.innerHTML = '✏️';

        const resolveBtn = document.createElement('button');
        resolveBtn.className = 'review-comment-card-action-icon-btn resolve';
        resolveBtn.title = 'Resolve';
        resolveBtn.innerHTML = '✅';

        actions.appendChild(editBtn);
        actions.appendChild(resolveBtn);
        header.appendChild(icon);
        header.appendChild(meta);
        header.appendChild(actions);

        // Original Text quote
        const original = document.createElement('div');
        original.className = 'review-comment-card-original';
        original.textContent = '"' + comment.highlighted + '"';

        // Comment Body
        const body = document.createElement('div');
        body.className = 'review-comment-card-body';
        body.textContent = comment.meta.body;

        // Edit Container
        const editContainer = document.createElement('div');
        editContainer.className = 'review-comment-card-edit-container';

        const textarea = document.createElement('textarea');
        textarea.className = 'review-comment-card-textarea';
        textarea.value = comment.meta.body;

        const editActions = document.createElement('div');
        editActions.className = 'review-comment-card-edit-actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'review-comment-card-btn cancel';
        cancelBtn.textContent = 'Cancel';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'review-comment-card-btn save';
        saveBtn.textContent = 'Save';

        editActions.appendChild(cancelBtn);
        editActions.appendChild(saveBtn);
        editContainer.appendChild(textarea);
        editContainer.appendChild(editActions);

        // State switching
        let isEditing = false;
        const startEdit = () => {
          isEditing = true;
          card.classList.add('editing');
          body.style.display = 'none';
          original.style.display = 'none';
          editContainer.style.display = 'block';
          textarea.focus();

          // Dismiss new comment form if editing an existing card
          newCommentContainerEl.style.display = 'none';
          newCommentContainerEl.innerHTML = '';
        };

        const stopEdit = () => {
          isEditing = false;
          card.classList.remove('editing');
          body.style.display = 'block';
          original.style.display = 'block';
          editContainer.style.display = 'none';
        };

        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isEditing) stopEdit();
          else startEdit();
        });

        cancelBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          stopEdit();
        });

        saveBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const val = textarea.value.trim();
          if (val) {
            vscode.postMessage({
              type: 'save',
              source,
              full: comment.full,
              highlighted: comment.highlighted,
              author: comment.meta.author,
              date: comment.meta.date,
              newBody: val
            });
          }
          stopEdit();
        });

        resolveBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          vscode.postMessage({
            type: 'resolve',
            source,
            full: comment.full,
            highlighted: comment.highlighted
          });
        });

        card.appendChild(header);
        card.appendChild(original);
        card.appendChild(body);
        card.appendChild(editContainer);

        listEl.appendChild(card);
      });

      contentEl.appendChild(listEl);
    }
  </script>
</body>
</html>`;
  }
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
