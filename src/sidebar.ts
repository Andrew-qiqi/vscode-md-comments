import * as vscode from 'vscode';
import { parseAllComments, CommentMatch } from './commentParser';

export class ReviewCommentsSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'review-comments-sidebar';
  private _view?: vscode.WebviewView;
  private _lastActiveDocument?: vscode.TextDocument;

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
      const document = vscode.window.activeTextEditor?.document || this._lastActiveDocument;

      switch (data.type) {
        case 'ready': {
          this.refresh();
          break;
        }
        case 'jump': {
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            const text = editor.document.getText();
            const index = text.indexOf(data.full);
            if (index !== -1) {
              const startPos = editor.document.positionAt(index);
              const endPos = editor.document.positionAt(index + data.full.length);
              editor.selection = new vscode.Selection(startPos, endPos);
              editor.revealRange(new vscode.Range(startPos, endPos), vscode.TextEditorRevealType.InCenter);
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
              this.refresh();
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
              this.refresh();
            }
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

  public refresh() {
    if (!this._view) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.languageId === 'markdown') {
      this._lastActiveDocument = editor.document;
    }

    const document = this._lastActiveDocument;
    if (!document) {
      this._view.webview.postMessage({ type: 'update', state: 'no_editor' });
      return;
    }

    const text = document.getText();
    const comments = parseAllComments(text);

    this._view.webview.postMessage({
      type: 'update',
      state: 'loaded',
      comments
    });
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
  <div id="content"></div>

  <script>
    const vscode = acquireVsCodeApi();
    const contentEl = document.getElementById('content');

    // Signal ready to get initial data
    vscode.postMessage({ type: 'ready' });

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'update') {
        render(message.state, message.comments || []);
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
      }
    });

    function render(state, comments) {
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
          // Prevent jump if clicking inside input/buttons or during edit
          if (e.target.closest('.review-comment-card-header-actions') || 
              e.target.closest('.review-comment-card-edit-container')) {
            return;
          }
          vscode.postMessage({
            type: 'jump',
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
          body.style.display = 'none';
          original.style.display = 'none';
          editContainer.style.display = 'block';
          textarea.focus();
        };

        const stopEdit = () => {
          isEditing = false;
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
