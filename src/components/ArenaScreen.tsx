import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { currentArenaRoom } from '@/game/arenaApi';
import { ArenaLobby } from './arena/ArenaLobby';
import { ArenaRoom } from './arena/ArenaRoom';

export function ArenaScreen() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    currentArenaRoom()
      .then((id) => setRoomId(id ?? null))
      .catch(() => setRoomId(null))
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-teal-400" />
      </div>
    );
  }

  if (roomId) return <ArenaRoom key={roomId} roomId={roomId} onExit={() => setRoomId(null)} />;
  return <ArenaLobby onJoined={setRoomId} />;
}
