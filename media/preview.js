(function () {
  const buttonId = "review-comments-preview-add";
  const editorId = "review-comments-preview-editor";
  let button;
  let editor;
  let textarea;
  let status;
  let lastPayload;
  let activeRequest;
  const vscode = getVsCodeApi();

  function getVsCodeApi() {
    if (window.__reviewCommentsVsCodeApi) {
      return window.__reviewCommentsVsCodeApi;
    }

    if (typeof acquireVsCodeApi !== "function") {
      return undefined;
    }

    const originalAcquireVsCodeApi = acquireVsCodeApi;
    try {
      const api = originalAcquireVsCodeApi();
      window.__reviewCommentsVsCodeApi = api;
      window.acquireVsCodeApi = () => api;
      return api;
    } catch {
      return undefined;
    }
  }

  function ensureButton() {
    if (button) {
      return button;
    }

    button = document.createElement("button");
    button.id = buttonId;
    button.textContent = "Add Comment";
    button.title = "Add comment to selected text";
    button.className = "review-comments-preview-add-button";
    button.type = "button";
    button.style.display = "none";
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", event => {
      event.preventDefault();
      if (lastPayload) {
        openEditor({
          kind: "add",
          payload: lastPayload,
          anchorRect: button.getBoundingClientRect(),
          initialBody: ""
        });
      }
    });
    document.body.appendChild(button);
    return button;
  }

  function ensureEditor() {
    if (editor) {
      return editor;
    }

    editor = document.createElement("div");
    editor.id = editorId;
    editor.className = "review-comments-preview-editor";
    editor.style.display = "none";

    textarea = document.createElement("textarea");
    textarea.className = "review-comments-preview-editor-textarea";
    textarea.placeholder = "Type your comment...";

    status = document.createElement("div");
    status.className = "review-comments-preview-editor-status";

    const actions = document.createElement("div");
    actions.className = "review-comments-preview-editor-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.className = "review-comments-preview-editor-button secondary";
    cancel.addEventListener("click", hideEditor);

    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Save";
    save.className = "review-comments-preview-editor-button primary";
    save.addEventListener("click", saveEditor);

    actions.appendChild(status);
    actions.appendChild(cancel);
    actions.appendChild(save);
    editor.appendChild(textarea);
    editor.appendChild(actions);
    editor.addEventListener("mousedown", event => event.stopPropagation());
    editor.addEventListener("click", event => event.stopPropagation());
    document.body.appendChild(editor);
    return editor;
  }

  function hideButton() {
    if (button) {
      button.style.display = "none";
    }
  }

  function hideEditor() {
    activeRequest = undefined;
    if (editor) {
      editor.style.display = "none";
    }
  }

  function openEditor(request) {
    activeRequest = request;
    hideButton();

    const panel = ensureEditor();
    textarea.value = request.initialBody || "";
    status.textContent = "";

    const rect = request.anchorRect;
    panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 328))}px`;
    panel.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 146))}px`;
    panel.style.display = "block";

    window.setTimeout(() => {
      textarea.focus();
      textarea.select();
    }, 0);
  }

  function saveEditor() {
    if (!activeRequest) {
      return;
    }

    const body = textarea.value.trim();
    if (!body) {
      status.textContent = "Comment cannot be empty.";
      return;
    }

    const source = getSource();
    if (!source) {
      status.textContent = "Could not identify the preview source.";
      return;
    }

    if (!vscode) {
      status.textContent = "Preview messaging is unavailable. Please reload the preview.";
      return;
    }

    if (activeRequest.kind === "add") {
      runCommand("review-comments.addFromPreview", [{
        ...activeRequest.payload,
        source,
        body
      }]);
    } else if (activeRequest.kind === "edit") {
      runCommand("review-comments.editFromPreview", [{
        source,
        rawComment: activeRequest.rawComment,
        body
      }]);
    }

    hideEditor();
  }

  function runCommand(command, args) {
    const source = getSource();
    if (!source || !vscode) {
      return;
    }

    if (!isOwnedPreview()) {
      if (status) {
        status.textContent = "Use MD Comments Preview to edit here.";
      }
      return;
    }

    const payload = args && args[0] ? args[0] : {};
    if (command === "review-comments.addFromPreview") {
      vscode.postMessage({ type: "add", payload });
    } else if (command === "review-comments.editFromPreview") {
      vscode.postMessage({ type: "edit", payload });
    } else if (command === "review-comments.resolveFromPreview") {
      vscode.postMessage({ type: "resolve", payload });
    } else if (command === "review-comments-sidebar.focus") {
      vscode.postMessage({ type: "focusSidebar" });
    }
  }

  function isOwnedPreview() {
    return document.body?.getAttribute("data-review-comments-preview") === "owned";
  }

  function getSource() {
    const data = document.getElementById("vscode-markdown-preview-data");
    const raw = data && data.getAttribute("data-settings");
    if (!raw) {
      return undefined;
    }

    try {
      return JSON.parse(raw).source;
    } catch {
      return undefined;
    }
  }

  function updateButton() {
    if (editor && editor.style.display !== "none") {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      hideButton();
      return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) {
      hideButton();
      return;
    }

    const range = selection.getRangeAt(0);
    const parent = range.commonAncestorContainer.parentElement;
    if (parent?.closest?.(`#${buttonId}, #${editorId}`)) {
      hideButton();
      return;
    }

    const rect = getSelectionRect(range);
    if (!rect) {
      hideButton();
      return;
    }

    lastPayload = {
      selectedText,
      leftContext: getTextBefore(range).slice(-300),
      rightContext: getTextAfter(range).slice(0, 300)
    };

    const addButton = ensureButton();
    addButton.style.left = `${Math.max(8, rect.left)}px`;
    addButton.style.top = `${Math.max(8, rect.bottom + 6)}px`;
    addButton.style.display = "block";
  }

  function getSelectionRect(range) {
    const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
    if (rects.length > 0) {
      return rects[rects.length - 1];
    }
    const rect = range.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 ? rect : undefined;
  }

  function getTextBefore(range) {
    const before = document.createRange();
    before.setStart(document.body, 0);
    before.setEnd(range.startContainer, range.startOffset);
    return before.toString();
  }

  function getTextAfter(range) {
    const after = document.createRange();
    after.setStart(range.endContainer, range.endOffset);
    after.setEnd(document.body, document.body.childNodes.length);
    return after.toString();
  }

  function getActionRaw(target) {
    const raw = target.getAttribute("data-review-comment-raw") ||
      target.closest(".review-comment-highlight")?.getAttribute("data-review-comment-raw");
    if (!raw) {
      return undefined;
    }

    try {
      return decodeURIComponent(raw);
    } catch {
      return undefined;
    }
  }

  function getActionBody(target) {
    const body = target.getAttribute("data-review-comment-body");
    if (!body) {
      return "";
    }

    try {
      return decodeURIComponent(body);
    } catch {
      return "";
    }
  }

  document.addEventListener("click", event => {
    const target = event.target?.closest?.("[data-review-comment-action]");
    if (!target) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const action = target.getAttribute("data-review-comment-action");
    if (action === "focus-sidebar") {
      runCommand("review-comments-sidebar.focus", []);
      return;
    }

    const rawComment = getActionRaw(target);
    if (!rawComment) {
      return;
    }

    if (action === "resolve") {
      runCommand("review-comments.resolveFromPreview", [{
        source: getSource(),
        rawComment
      }]);
      return;
    }

    if (action === "edit") {
      const highlight = target.closest(".review-comment-highlight");
      const rect = highlight ? highlight.getBoundingClientRect() : target.getBoundingClientRect();
      openEditor({
        kind: "edit",
        rawComment,
        initialBody: getActionBody(target),
        anchorRect: rect
      });
    }
  }, true);

  function scrollToLinkedComment() {
    if (!window.location.hash) {
      return;
    }

    let id;
    try {
      id = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      id = window.location.hash.slice(1);
    }

    const target = document.getElementById(id);
    if (!target) {
      return;
    }

    target.scrollIntoView({ block: "center", inline: "nearest" });
    target.classList.add("review-comment-preview-target");
    window.setTimeout(() => {
      target.classList.remove("review-comment-preview-target");
    }, 1400);
  }

  function scrollToRawComment(rawComment) {
    if (!rawComment) {
      return;
    }

    const encoded = encodeURIComponent(rawComment);
    const target = document.querySelector(`[data-review-comment-raw="${cssEscape(encoded)}"]`)?.closest(".review-comment-highlight");
    if (!target) {
      return;
    }

    target.scrollIntoView({ block: "center", inline: "nearest" });
    target.classList.add("review-comment-preview-target");
    window.setTimeout(() => {
      target.classList.remove("review-comment-preview-target");
    }, 1400);
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return value.replace(/["\\]/g, "\\$&");
  }

  document.addEventListener("selectionchange", () => {
    window.setTimeout(updateButton, 0);
  });
  document.addEventListener("mouseup", updateButton);
  document.addEventListener("keyup", updateButton);
  document.addEventListener("scroll", () => {
    hideButton();
    hideEditor();
  }, true);
  window.addEventListener("hashchange", () => window.setTimeout(scrollToLinkedComment, 0));
  window.addEventListener("message", event => {
    const message = event.data;
    if (message && message.type === "reveal") {
      window.setTimeout(() => scrollToRawComment(message.rawComment), 0);
    }
  });
  window.addEventListener("vscode.markdown.updateContent", () => window.setTimeout(scrollToLinkedComment, 0));
  window.setTimeout(scrollToLinkedComment, 100);
})();
