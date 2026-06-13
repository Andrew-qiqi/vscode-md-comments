(function () {
  const buttonId = "review-comments-preview-add";
  let button;
  let lastPayload;

  function ensureButton() {
    if (button) {
      return button;
    }

    button = document.createElement("a");
    button.id = buttonId;
    button.textContent = "Add Comment";
    button.title = "Add comment to selected text";
    button.className = "review-comments-preview-add-button";
    button.setAttribute("role", "button");
    button.href = "#";
    button.style.display = "none";
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", event => {
      if (!lastPayload) {
        event.preventDefault();
        return;
      }
      button.href = buildAddCommentUri({ ...lastPayload, source: getSource() });
    });
    document.body.appendChild(button);
    return button;
  }

  function hideButton() {
    if (button) {
      button.style.display = "none";
    }
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

  function getUriScheme() {
    const data = document.getElementById("vscode-markdown-preview-data");
    const raw = data && data.getAttribute("data-settings");
    if (!raw) {
      return "vscode";
    }

    try {
      return JSON.parse(raw).uriScheme || "vscode";
    } catch {
      return "vscode";
    }
  }

  function buildAddCommentUri(payload) {
    const uriScheme = getUriScheme();
    const args = encodeURIComponent(JSON.stringify([payload]));
    return `${uriScheme}://andrew-qiqi.vscode-md-comments/addFromPreview?args=${args}`;
  }

  function updateButton() {
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
    if (parent?.closest?.(`#${buttonId}`)) {
      hideButton();
      return;
    }

    const rect = getSelectionRect(range);
    if (!rect) {
      hideButton();
      return;
    }

    const payload = {
      selectedText,
      leftContext: getTextBefore(range).slice(-300),
      rightContext: getTextAfter(range).slice(0, 300),
      source: getSource()
    };
    lastPayload = payload;

    const addButton = ensureButton();
    addButton.href = buildAddCommentUri(payload);
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
    id = id.split(":")[0];

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
