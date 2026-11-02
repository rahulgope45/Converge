import { useEffect, useState } from "react";

import type { Incident, LocalChange } from "@converge/sync-core";

type IncidentEditorProps = {
  incident: Incident;
  onChange: (change: LocalChange) => void;
};

export function IncidentEditor({ incident, onChange }: IncidentEditorProps) {
  const [titleDraft, setTitleDraft] = useState(incident.title);
  const [titleError, setTitleError] = useState<string>();

  useEffect(() => {
    setTitleDraft(incident.title);
  }, [incident.id, incident.title]);

  const commitTitle = () => {
    const title = titleDraft.trim();
    if (!title) {
      setTitleError("Title must contain at least one character.");
      setTitleDraft(incident.title);
      return;
    }

    setTitleError(undefined);
    setTitleDraft(title);
    if (title !== incident.title) {
      onChange({ kind: "set_title", value: title });
    }
  };

  return (
    <section className="incident-card">
      <label>
        <span>Incident title</span>
        <input
          value={titleDraft}
          maxLength={200}
          aria-invalid={titleError ? "true" : undefined}
          aria-describedby={titleError ? "title-error" : undefined}
          onChange={(event) => {
            setTitleDraft(event.target.value);
            setTitleError(undefined);
          }}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        {titleError ? (
          <small id="title-error" className="field-error" role="alert">
            {titleError}
          </small>
        ) : null}
      </label>

      <div className="field-grid">
        <label>
          <span>Severity</span>
          <select
            value={incident.severity}
            onChange={(event) =>
              onChange({
                kind: "set_severity",
                value: event.target.value as Incident["severity"],
              })
            }
          >
            <option value="SEV1">SEV1 - Critical</option>
            <option value="SEV2">SEV2 - Major</option>
            <option value="SEV3">SEV3 - Minor</option>
          </select>
        </label>

        <label>
          <span>Status</span>
          <select
            value={incident.status}
            onChange={(event) =>
              onChange({
                kind: "set_status",
                value: event.target.value as Incident["status"],
              })
            }
          >
            <option value="investigating">Investigating</option>
            <option value="identified">Identified</option>
            <option value="monitoring">Monitoring</option>
            <option value="resolved">Resolved</option>
          </select>
        </label>
      </div>
    </section>
  );
}
