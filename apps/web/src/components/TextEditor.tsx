import { useEffect, useRef, useState } from "react";

import type { Document, LocalChange } from "@converge/sync-core";

import { nextDraft, sanitizeText } from "./draft.js";

const COMMIT_DELAY_MS = 300;
const MAX_TEXT_LENGTH = 10_000;

type TextEditorProps = {
  document: Document;
  queuedLocalChanges: number;
  onChange: (change: LocalChange) => void;
};

export function TextEditor({
  document,
  queuedLocalChanges,
  onChange,
}: TextEditorProps) {
  const [draft, setDraft] = useState(document.text);
  const draftRef = useRef(document.text);
  const lastCommittedRef = useRef(document.text);
  const timerRef = useRef<number | undefined>(undefined);

  const clearTimer = () => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  };

  useEffect(() => {
    const next = nextDraft({
      draft: draftRef.current,
      lastCommitted: lastCommittedRef.current,
      incoming: document.text,
      queuedLocalChanges,
    });
    if (queuedLocalChanges === 0) {
      lastCommittedRef.current = document.text;
    }
    draftRef.current = next;
    setDraft(next);
  }, [document.id, document.text, queuedLocalChanges]);

  useEffect(() => clearTimer, []);

  const commit = () => {
    clearTimer();
    const value = sanitizeText(draftRef.current);
    if (value !== draftRef.current) {
      draftRef.current = value;
      setDraft(value);
    }
    if (value !== lastCommittedRef.current) {
      lastCommittedRef.current = value;
      onChange({ kind: "set_text", value });
    }
  };

  return (
    <section className="editor-card">
      <label>
        <span>Shared text</span>
        <textarea
          value={draft}
          maxLength={MAX_TEXT_LENGTH}
          rows={14}
          placeholder="Start typing…"
          onChange={(event) => {
            draftRef.current = event.target.value;
            setDraft(event.target.value);
            clearTimer();
            timerRef.current = window.setTimeout(commit, COMMIT_DELAY_MS);
          }}
          onBlur={commit}
        />
      </label>
    </section>
  );
}
