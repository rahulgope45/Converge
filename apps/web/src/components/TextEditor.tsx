import { useLayoutEffect, useRef } from "react";

import type { PeerView } from "../sync/controller.js";
import { CaretOverlay } from "./CaretOverlay.js";

const MAX_TEXT_LENGTH = 10_000;

type TextEditorProps = {
  text: string;
  // Where the user's selection belongs in `text`, as UTF-16 offsets.
  selection?: { start: number; end: number };
  peers: readonly PeerView[];
  onEdit: (text: string, caret: number) => void;
  onSelect: (start: number, end: number) => void;
};

export function TextEditor({
  text,
  selection,
  peers,
  onEdit,
  onSelect,
}: TextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // When someone else changes the text, the browser would leave the caret at
  // its old numeric position (or jump to the end). Put it back on the
  // characters it was on.
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !selection || document.activeElement !== textarea) {
      return;
    }
    if (
      textarea.selectionStart !== selection.start ||
      textarea.selectionEnd !== selection.end
    ) {
      textarea.setSelectionRange(selection.start, selection.end);
    }
  }, [text, selection?.start, selection?.end]);

  const syncScroll = () => {
    if (textareaRef.current && overlayRef.current) {
      overlayRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  useLayoutEffect(syncScroll);

  const reportSelection = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      onSelect(textarea.selectionStart, textarea.selectionEnd);
    }
  };

  return (
    <section className="editor-card">
      <label>
        <span>Shared text</span>
        <div className="editor-stack">
          <textarea
            ref={textareaRef}
            className="editor-surface"
            value={text}
            maxLength={MAX_TEXT_LENGTH}
            rows={14}
            placeholder="Start typing…"
            spellCheck={false}
            onChange={(event) =>
              onEdit(event.target.value, event.target.selectionStart)
            }
            onSelect={reportSelection}
            onKeyUp={reportSelection}
            onClick={reportSelection}
            onFocus={reportSelection}
            onScroll={syncScroll}
          />
          <CaretOverlay ref={overlayRef} text={text} peers={peers} />
        </div>
      </label>
    </section>
  );
}
