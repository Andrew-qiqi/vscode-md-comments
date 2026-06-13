import * as vscode from 'vscode';
import { locatePreviewSelection, PreviewSelectionPayload } from './previewProjection';
import { parseMeta } from './commentParser';

type PreviewAddPayload = PreviewSelectionPayload & {
  source?: string;
  body?: string;
};

interface PreviewCommentPayload {
  source?: string;
  rawComment: string;
  body?: string;
}

export class ReviewCommentsPreviewProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'review-comments.preview';

  private readonly panels = new Map<string, vscode.WebviewPanel>();

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };

    const key = document.uri.toString();
    this.panels.set(key, webviewPanel);

    const update = () => {
      this.updatePreview(document, webviewPanel).catch(error => {
        vscode.window.showErrorMessage(`Error rendering MD Comments Preview: ${error.message || error}`);
      });
    };

    const changeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() === key) {
        update();
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSubscription.dispose();
      if (this.panels.get(key) === webviewPanel) {
        this.panels.delete(key);
      }
    });

    webviewPanel.webview.onDidReceiveMessage(async message => {
      await this.handleMessage(document, message);
    });

    update();
  }

  public reveal(uri: vscode.Uri, rawComment: string) {
    const panel = this.panels.get(uri.toString());
    panel?.reveal(undefined, true);
    panel?.webview.postMessage({ type: 'reveal', rawComment });
  }

  private async updatePreview(document: vscode.TextDocument, panel: vscode.WebviewPanel) {
    const rendered = await vscode.commands.executeCommand<string>('markdown.api.render', document);
    panel.webview.html = this.buildHtml(panel.webview, document, rendered || escapeHtml(document.getText()));
  }

  private async handleMessage(document: vscode.TextDocument, message: any) {
    switch (message?.type) {
      case 'add':
        await this.addComment(document, message.payload);
        break;
      case 'edit':
        await this.editComment(document, message.payload);
        break;
      case 'resolve':
        await this.resolveComment(document, message.payload);
        break;
      case 'focusSidebar':
        await vscode.commands.executeCommand('review-comments-sidebar.focus');
        break;
    }
  }

  private async addComment(document: vscode.TextDocument, payload: PreviewAddPayload) {
    const body = (payload.body || '').trim();
    if (!body) {
      vscode.window.showWarningMessage('Comment cannot be empty.');
      return;
    }

    const located = locatePreviewSelection(document.getText(), payload);
    if (!located) {
      vscode.window.showInformationMessage('Could not reliably locate this preview selection in the Markdown source. Please add the comment in Source mode.');
      return;
    }

    const range = new vscode.Range(document.positionAt(located.start), document.positionAt(located.end));
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

    const config = vscode.workspace.getConfiguration('review-comments');
    const author = (config.get<string>('authorName') || 'you').replace(/\|/g, '').trim();
    const dateFormat = config.get<string>('dateFormat') || 'iso';
    const dateStr = formatDate(new Date(), dateFormat);
    const escapedBody = body.replace(/<<}/g, '<< }');
    const replacement = `{==${selectedText}==}{>>${author}|${dateStr}: ${escapedBody}<<}`;

    await replaceRange(document, range, replacement);
  }

  private async editComment(document: vscode.TextDocument, payload: PreviewCommentPayload) {
    const body = (payload.body || '').trim();
    if (!body) {
      vscode.window.showWarningMessage('Comment cannot be empty.');
      return;
    }

    const source = document.getText();
    const index = source.indexOf(payload.rawComment);
    if (index === -1) {
      vscode.window.showInformationMessage('No comment found for this preview item.');
      return;
    }

    const match = payload.rawComment.match(/^\{==([\s\S]+?)==\}\{>>([\s\S]+?)<<\}/);
    if (!match) {
      return;
    }

    const meta = parseMeta(match[2]);
    const escapedBody = body.replace(/<<}/g, '<< }');
    const replacement = `{==${match[1]}==}{>>${meta.author}|${meta.date}: ${escapedBody}<<}`;
    const range = new vscode.Range(
      document.positionAt(index),
      document.positionAt(index + payload.rawComment.length)
    );

    await replaceRange(document, range, replacement);
  }

  private async resolveComment(document: vscode.TextDocument, payload: PreviewCommentPayload) {
    const source = document.getText();
    const index = source.indexOf(payload.rawComment);
    if (index === -1) {
      vscode.window.showInformationMessage('No comment found for this preview item.');
      return;
    }

    const match = payload.rawComment.match(/^\{==([\s\S]+?)==\}/);
    const replacement = match ? match[1] : '';
    const range = new vscode.Range(
      document.positionAt(index),
      document.positionAt(index + payload.rawComment.length)
    );

    await replaceRange(document, range, replacement);
  }

  private buildHtml(webview: vscode.Webview, document: vscode.TextDocument, rendered: string): string {
    const nonce = getNonce();
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'preview.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'preview.js'));
    const settings = escapeAttribute(JSON.stringify({
      source: document.uri.toString(),
      uriScheme: vscode.env.uriScheme
    }));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>${escapeHtml(document.fileName)}</title>
  <style>
    body {
      box-sizing: border-box;
      max-width: 860px;
      margin: 0 auto;
      padding: 24px 32px 64px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
      font-size: var(--vscode-font-size, 14px);
      line-height: 1.6;
    }
    img { max-width: 100%; }
    pre {
      overflow: auto;
      padding: 12px;
      background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.12));
      border-radius: 4px;
    }
    code {
      font-family: var(--vscode-editor-font-family, monospace);
    }
    blockquote {
      margin-left: 0;
      padding-left: 12px;
      border-left: 3px solid var(--vscode-textBlockQuote-border, var(--vscode-panel-border));
      color: var(--vscode-descriptionForeground);
    }
    a { color: var(--vscode-textLink-foreground); }
  </style>
</head>
<body data-review-comments-preview="owned">
  <div id="vscode-markdown-preview-data" data-settings="${settings}" hidden></div>
  <main class="markdown-body">${rendered}</main>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

async function replaceRange(document: vscode.TextDocument, range: vscode.Range, replacement: string) {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, range, replacement);
  await vscode.workspace.applyEdit(edit);
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

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
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
