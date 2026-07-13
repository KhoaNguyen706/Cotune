import { peerColor, type Peer } from "../realtime/socket";

/**
 * "Alice is over there."
 *
 * A cursor can only be drawn in the piano roll when you are BOTH looking at the
 * same lane of the same beat — anywhere else there is no cell to point at. The
 * first version stopped there, so stepping onto another lane made your
 * collaborator vanish with no explanation, which is the exact opposite of what
 * presence is for: the moment you most need to know where someone is, is when
 * they are somewhere you are not.
 *
 * So when we cannot show their cursor, we show their FACE on the thing they are
 * working on — the beat in the beat list, the lane in the lane list. Same colour
 * as their cursor, so "the green dot on Bass" and "the green cursor in the grid"
 * are obviously the same person.
 */
export function PeerDots({ list, where }: { list: Peer[]; where: string }) {
  if (list.length === 0) return null;
  return (
    // -space-x-1: overlap them like a stacked avatar group, so a busy lane
    // doesn't push the mute/solo buttons off the row.
    <span className="flex shrink-0 -space-x-1">
      {list.map((peer) => (
        <span
          key={peer.userId}
          title={`${peer.displayName} is on ${where}`}
          className="flex h-4 w-4 items-center justify-center rounded-full text-[0.5rem] font-bold text-bg ring-1 ring-bg"
          style={{ background: peerColor(peer.userId) }}
        >
          {peer.displayName[0]?.toUpperCase() ?? "?"}
        </span>
      ))}
    </span>
  );
}
