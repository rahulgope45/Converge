import { forwardRef, Fragment } from "react";
import type { CSSProperties } from "react";

import type { PeerView } from "../sync/controller.js";

type CaretOverlayProps = {
  text: string;
  peers: readonly PeerView[];
};

// Draws other people's carets on top of the textarea. A textarea cannot hold
// markup, so this layer repeats the same text invisibly, with identical font,
// padding and wrapping, and places a marker at each caret position. It must
// share the `editor-surface` class with the textarea to line up.
export const CaretOverlay = forwardRef<HTMLDivElement, CaretOverlayProps>(
  function CaretOverlay({ text, peers }, ref) {
    const carets = peers
      .filter((peer): peer is PeerView & { offset: number } => peer.offset !== undefined)
      .sort((left, right) => left.offset - right.offset);

    let position = 0;
    return (
      <div ref={ref} className="editor-surface caret-overlay" aria-hidden="true">
        {carets.map((peer) => {
          const before = text.slice(position, peer.offset);
          position = Math.max(position, peer.offset);
          return (
            <Fragment key={peer.actorId}>
              {before}
              <span
                className="remote-caret"
                style={{ "--caret-color": peer.color } as CSSProperties}
              >
                <span className="remote-caret__label">{peer.name}</span>
              </span>
            </Fragment>
          );
        })}
        {text.slice(position)}
        {/* A trailing newline only takes up a line if something follows it. */}
        {"​"}
      </div>
    );
  },
);
