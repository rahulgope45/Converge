import type { ConnectionState } from "../sync/controller.js";

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  return (
    <span className={`connection connection--${state}`}>
      <span className="connection__dot" aria-hidden="true" />
      {state}
    </span>
  );
}
