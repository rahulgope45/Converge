import type { CSSProperties } from "react";

import type { PeerView } from "../sync/controller.js";

type PresenceBarProps = {
  self?: { name: string; color: string };
  peers: readonly PeerView[];
};

export function PresenceBar({ self, peers }: PresenceBarProps) {
  if (!self) {
    return null;
  }

  return (
    <ul className="presence-bar" aria-label="People in this room">
      <li
        className="presence-chip"
        style={{ "--chip-color": self.color } as CSSProperties}
      >
        <span className="presence-chip__dot" />
        You
      </li>
      {peers.map((peer) => (
        <li
          key={peer.actorId}
          className="presence-chip"
          style={{ "--chip-color": peer.color } as CSSProperties}
        >
          <span className="presence-chip__dot" />
          {peer.name}
        </li>
      ))}
    </ul>
  );
}
