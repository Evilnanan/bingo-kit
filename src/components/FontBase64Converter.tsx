import {
  useState,
  useCallback,
  useMemo,
  type DragEvent,
  type ChangeEvent,
} from "react";
import "./FontBase64Converter.css";

interface FontEntry {
  id: string;
  name: string;
  family: string;
  format: string;
  base64: string;
  size: number;
  /** Stable internal name for preview injection — never changes after load */
  previewName: string;
}

let idCounter = 0;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getFormat(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ttf":
      return "truetype";
    case "otf":
      return "opentype";
    case "woff":
      return "woff";
    case "woff2":
      return "woff2";
    default:
      return "truetype";
  }
}

function fontFormatToCss(format: string): string {
  switch (format) {
    case "truetype":
      return 'format("truetype")';
    case "opentype":
      return 'format("opentype")';
    case "woff":
      return 'format("woff")';
    case "woff2":
      return 'format("woff2")';
    default:
      return `format("${format}")`;
  }
}

function buildMimeType(format: string): string {
  switch (format) {
    case "truetype":
      return "font/ttf";
    case "opentype":
      return "font/otf";
    case "woff":
      return "font/woff";
    case "woff2":
      return "font/woff2";
    default:
      return "font/ttf";
  }
}

export default function FontBase64Converter() {
  const [fonts, setFonts] = useState<FontEntry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [previewText, setPreviewText] = useState("Bingo 宾果 0123456789");
  const [copied, setCopied] = useState(false);

  const processFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1] ?? "";
      const format = getFormat(file.name);
      const familyBase = file.name
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-zA-Z0-9_-]/g, "-");
      const id = `font-${++idCounter}`;
      const entry: FontEntry = {
        id,
        name: file.name,
        family: familyBase,
        format,
        base64,
        size: file.size,
        // Stable internal name — never changes, so the <style> tag stays untouched
        previewName: `__fc_${idCounter}__`,
      };
      setFonts((prev) => [...prev, entry]);
    };
    reader.readAsDataURL(file);
  }, []);

  // ── drag & drop ──
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    for (const file of e.dataTransfer.files) {
      processFile(file);
    }
  };

  // ── file input ──
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of files) {
      processFile(file);
    }
    e.target.value = "";
  };

  // ── remove a font ──
  const removeFont = (id: string) => {
    setFonts((prev) => prev.filter((f) => f.id !== id));
  };

  // ── update family name ──
  const updateFamily = (id: string, family: string) => {
    setFonts((prev) => prev.map((f) => (f.id === id ? { ...f, family } : f)));
  };

  // ── preview CSS (stable — only recomputes when fonts are added/removed, not on family edits) ──
  const fontsKey = fonts.map((f) => f.id).join(",");
  const previewFontsCSS = useMemo(() => {
    return fonts
      .map((f) => {
        const mime = buildMimeType(f.format);
        const fmt = fontFormatToCss(f.format);
        return `@font-face { font-family: "${f.previewName}"; src: url("data:${mime};base64,${f.base64}") ${fmt}; }`;
      })
      .join("\n");
    // fontsKey changes only on add/remove
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontsKey]);

  // ── build CSS for copy (uses user-editable family name) ──
  const buildCSS = useCallback((): string => {
    const blocks = fonts.map((f) => {
      const mime = buildMimeType(f.format);
      const fmt = fontFormatToCss(f.format);
      return `@font-face {
  font-family: "${f.family}";
  src: url("data:${mime};base64,${f.base64}") ${fmt};
  font-weight: normal;
  font-style: normal;
}`;
    });
    const sansValue = [
      ...fonts.map((f) => `"${f.family}"`),
      "system-ui",
      "-apple-system",
      '"Segoe UI"',
      "Roboto",
      "sans-serif",
    ].join(", ");
    const extras = `\n\n:root {\n  --sans: ${sansValue};\n  --cell-font-scale: 1.0;\n}\n\n/* Hide UI elements */\n.counter { display: none !important; }\n.tooltip { display: none !important; }\n.star    { display: none !important; }`;
    return (blocks.join("\n\n") + extras).trim();
  }, [fonts]);

  // ── copy ──
  const handleCopy = async () => {
    const css = buildCSS();
    try {
      await navigator.clipboard.writeText(css);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = css;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      navigator.clipboard.writeText(css);
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fc-page">
      {/* Inject preview fonts — only changes when fonts are added/removed */}
      {fonts.length > 0 && <style>{previewFontsCSS}</style>}

      <h1 className="fc-title">Font Base64 Converter</h1>
      <p className="fc-subtitle">
        Convert local font files to Base64 Data URIs and generate custom CSS for
        OBS browser sources.
      </p>

      {/* ── Drop zone ── */}
      <div
        className={`fc-dropzone${dragOver ? " fc-dropzone--active" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="fc-dropzone-icon">📁</div>
        <div className="fc-dropzone-text">Drop font files here</div>
        <div className="fc-dropzone-hint">Supports .ttf .otf .woff .woff2</div>
        <label className="fc-dropzone-btn">
          Select Files
          <input
            type="file"
            accept=".ttf,.otf,.woff,.woff2"
            multiple
            onChange={handleFileChange}
            className="fc-file-input"
          />
        </label>
      </div>

      {/* ── Font list ── */}
      {fonts.length > 0 && (
        <>
          <div className="fc-section">
            <div className="fc-section-header">
              <h2 className="fc-section-title">
                Loaded Fonts ({fonts.length})
              </h2>
              <button
                type="button"
                className="fc-btn fc-btn--ghost"
                onClick={() => setFonts([])}
              >
                Clear All
              </button>
            </div>

            {fonts.map((font) => (
              <div key={font.id} className="fc-font-card">
                <div className="fc-font-card-left">
                  <div className="fc-font-name">{font.name}</div>
                  <div className="fc-font-meta">
                    {formatSize(font.size)} · {font.format}
                  </div>
                  <label className="fc-family-label">
                    CSS font-family:
                    <input
                      type="text"
                      className="fc-family-input"
                      value={font.family}
                      onChange={(e) => updateFamily(font.id, e.target.value)}
                    />
                  </label>
                </div>
                <div className="fc-font-card-right">
                  <div className="fc-font-preview-label">Preview:</div>
                  <div
                    className="fc-font-preview"
                    style={{ fontFamily: `"${font.previewName}", sans-serif` }}
                  >
                    {previewText}
                  </div>
                  <button
                    type="button"
                    className="fc-btn fc-btn--remove"
                    onClick={() => removeFont(font.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* ── Preview text input ── */}
          <div className="fc-section">
            <label className="fc-label">
              Preview Text:
              <input
                type="text"
                className="fc-preview-input"
                value={previewText}
                onChange={(e) => setPreviewText(e.target.value)}
              />
            </label>
          </div>
        </>
      )}

      {/* ── Copy button ── (always visible) */}
      <div className="fc-section">
        <button
          type="button"
          className="fc-btn fc-btn--copy"
          onClick={handleCopy}
        >
          {copied ? "✓ Copied to Clipboard" : "📋 Copy CSS"}
        </button>
      </div>
    </div>
  );
}
