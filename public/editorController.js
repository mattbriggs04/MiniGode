const MONACO_BASE_PATH = "/vendor/monaco/vs";
const EDITOR_FONT_FAMILY = "'Cascadia Code', 'Fira Code', 'SFMono-Regular', Consolas, monospace";

export const EDITOR_THEMES = [
  { id: "midnight", label: "Midnight", monaco: "minigode-midnight" },
  { id: "paper", label: "Paper", monaco: "minigode-paper" },
  { id: "forest", label: "Forest", monaco: "minigode-forest" }
];

let monacoLoadPromise;
let themesDefined = false;

function getThemePalette(themeId) {
  switch (themeId) {
    case "paper":
      return {
        base: "vs",
        background: "#f5f5ef",
        foreground: "#1d3028",
        lineNumber: "#86a194",
        lineHighlight: "#e6f0ea",
        selection: "#c7ddd2",
        inactiveSelection: "#dbe9e2",
        cursor: "#22624a",
        border: "#d7e3dc",
        guides: "#d7e3dc",
        keyword: "#2f6d58",
        string: "#34734b",
        number: "#6a7d2e",
        identifier: "#264136",
        delimiter: "#5c7468",
        comment: "#6d8a7d"
      };
    case "forest":
      return {
        base: "vs-dark",
        background: "#0d1713",
        foreground: "#dcefe8",
        lineNumber: "#4d7064",
        lineHighlight: "#11231c",
        selection: "#1c4336",
        inactiveSelection: "#17342b",
        cursor: "#8fd8b4",
        border: "#183127",
        guides: "#183127",
        keyword: "#8fd8b4",
        string: "#c3e88d",
        number: "#ffcb6b",
        identifier: "#dcefe8",
        delimiter: "#7aa495",
        comment: "#5f8a79"
      };
    case "midnight":
    default:
      return {
        base: "vs-dark",
        background: "#08120f",
        foreground: "#e2f5ee",
        lineNumber: "#406257",
        lineHighlight: "#10201a",
        selection: "#17392e",
        inactiveSelection: "#102c23",
        cursor: "#79d9b2",
        border: "#133126",
        guides: "#133126",
        keyword: "#7bdcb5",
        string: "#bfe38d",
        number: "#f5c26b",
        identifier: "#e2f5ee",
        delimiter: "#77a796",
        comment: "#54786b"
      };
  }
}

function defineThemes(monaco) {
  if (themesDefined) {
    return;
  }

  for (const theme of EDITOR_THEMES) {
    const palette = getThemePalette(theme.id);
    monaco.editor.defineTheme(theme.monaco, {
      base: palette.base,
      inherit: true,
      rules: [
        { token: "", foreground: palette.foreground.slice(1) },
        { token: "comment", foreground: palette.comment.slice(1), fontStyle: "italic" },
        { token: "keyword", foreground: palette.keyword.slice(1), fontStyle: "bold" },
        { token: "string", foreground: palette.string.slice(1) },
        { token: "number", foreground: palette.number.slice(1) },
        { token: "identifier", foreground: palette.identifier.slice(1) },
        { token: "delimiter", foreground: palette.delimiter.slice(1) }
      ],
      colors: {
        "editor.background": palette.background,
        "editor.foreground": palette.foreground,
        "editorCursor.foreground": palette.cursor,
        "editor.lineHighlightBackground": palette.lineHighlight,
        "editor.selectionBackground": palette.selection,
        "editor.inactiveSelectionBackground": palette.inactiveSelection,
        "editorIndentGuide.background1": palette.guides,
        "editorIndentGuide.activeBackground1": palette.keyword,
        "editorLineNumber.foreground": palette.lineNumber,
        "editorLineNumber.activeForeground": palette.foreground,
        "editorGutter.background": palette.background,
        "editorWhitespace.foreground": palette.guides,
        "editorWidget.background": palette.background,
        "editorWidget.border": palette.border,
        "editorSuggestWidget.background": palette.background,
        "editorSuggestWidget.border": palette.border,
        "editorSuggestWidget.selectedBackground": palette.lineHighlight,
        "editorSuggestWidget.foreground": palette.foreground,
        "editorHoverWidget.background": palette.background,
        "editorHoverWidget.border": palette.border,
        "scrollbarSlider.background": `${palette.selection}88`,
        "scrollbarSlider.hoverBackground": `${palette.selection}bb`,
        "scrollbarSlider.activeBackground": `${palette.selection}dd`
      }
    });
  }

  themesDefined = true;
}

function loadMonaco() {
  if (window.monaco?.editor) {
    defineThemes(window.monaco);
    return Promise.resolve(window.monaco);
  }

  if (monacoLoadPromise) {
    return monacoLoadPromise;
  }

  monacoLoadPromise = new Promise((resolve, reject) => {
    if (!window.require?.config) {
      reject(new Error("Monaco loader failed to load."));
      return;
    }

    window.require.config({
      paths: { vs: MONACO_BASE_PATH }
    });

    window.require(["vs/editor/editor.main"], () => {
      if (!window.monaco?.editor) {
        reject(new Error("Monaco editor failed to initialize."));
        return;
      }

      defineThemes(window.monaco);
      resolve(window.monaco);
    }, reject);
  });

  return monacoLoadPromise;
}

export function getEditorTheme(themeId) {
  return EDITOR_THEMES.find((theme) => theme.id === themeId) ?? EDITOR_THEMES[0];
}

function getPreferredCursorPosition(value) {
  const lines = String(value ?? "").split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const passColumn = line.indexOf("pass");

    if (passColumn >= 0) {
      return {
        lineNumber: index + 1,
        column: passColumn + 1
      };
    }
  }

  return {
    lineNumber: 1,
    column: 1
  };
}

export function createEditorController({ elementId, onChange, onSubmit }) {
  let editor;
  let monacoRef;
  let readyPromise;
  let changeHandler = onChange;
  let submitHandler = onSubmit;
  let suppressChange = false;

  async function ensureReady() {
    if (editor) {
      return editor;
    }

    if (readyPromise) {
      return readyPromise;
    }

    readyPromise = loadMonaco().then((monaco) => {
      monacoRef = monaco;
      const element = document.getElementById(elementId);
      if (!element) {
        throw new Error(`Editor mount #${elementId} was not found.`);
      }

      editor = monaco.editor.create(element, {
        value: "",
        language: "python",
        theme: EDITOR_THEMES[0].monaco,
        fontSize: 14,
        fontFamily: EDITOR_FONT_FAMILY,
        fontLigatures: true,
        lineHeight: 22,
        minimap: { enabled: false },
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        smoothScrolling: true,
        cursorSmoothCaretAnimation: "on",
        stickyTabStops: true,
        autoIndent: "full",
        wordWrap: "on",
        padding: { top: 14, bottom: 14 },
        renderLineHighlight: "all",
        cursorBlinking: "smooth",
        cursorStyle: "line",
        cursorWidth: 2,
        roundedSelection: false,
        codeLens: false,
        quickSuggestions: {
          other: true,
          comments: false,
          strings: false
        },
        suggestOnTriggerCharacters: true,
        snippetSuggestions: "top",
        scrollbar: {
          verticalScrollbarSize: 10,
          horizontalScrollbarSize: 10
        },
        overviewRulerBorder: false
      });
      editor.getModel()?.updateOptions({
        tabSize: 4,
        indentSize: 4,
        insertSpaces: true,
        trimAutoWhitespace: true
      });

      editor.onDidChangeModelContent(() => {
        if (!suppressChange) {
          changeHandler?.(editor.getValue());
        }
      });

      editor.addAction({
        id: "run-tests",
        label: "Run Tests",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        run: () => submitHandler?.()
      });

      return editor;
    });

    return readyPromise;
  }

  return {
    async ensureReady() {
      await ensureReady();
    },
    async setValue(nextValue) {
      const nextText = nextValue ?? "";
      await ensureReady();
      if (editor.getValue() === nextText) {
        return;
      }

      suppressChange = true;
      editor.setValue(nextText);
      const nextPosition = getPreferredCursorPosition(nextText);
      editor.setPosition(nextPosition);
      editor.revealPositionInCenter(nextPosition);
      suppressChange = false;
    },
    getValue() {
      return editor ? editor.getValue() : "";
    },
    async setTheme(themeId) {
      await ensureReady();
      monacoRef.editor.setTheme(getEditorTheme(themeId).monaco);
    },
    layout() {
      editor?.layout();
    },
    focus() {
      editor?.focus();
    },
    setChangeHandler(handler) {
      changeHandler = handler;
    },
    setSubmitHandler(handler) {
      submitHandler = handler;
    },
    dispose() {
      editor?.dispose();
      editor = undefined;
      readyPromise = undefined;
    }
  };
}
