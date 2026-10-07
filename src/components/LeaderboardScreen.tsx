import { useState, useEffect } from 'react';
import { getLeaderboard } from '@/game/cloud';
import { Trophy, Crown, Medal } from 'lucide-react';
import type { AuthUser } from '@/game/auth';

interface LeaderboardEntry {
  player_id: string;
  display_name: string;
  level: number;
  arena_rating: number;
  arena_wins: number;
  total_battles_won: number;
  photo_url: string | null;
}

export function LeaderboardScreen({ user }: { user: AuthUser }) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<'rating' | 'wins'>('rating');

  useEffect(() => {
    loadLeaderboard();
  }, []);

  const loadLeaderboard = async () => {
    setLoading(true);
    setError(false);
    try {
      setEntries((await getLeaderboard(50)) as LeaderboardEntry[]);
    } catch {
      setError(true);
    }
    setLoading(false);
  };

  const sorted = tab === 'rating'
    ? [...entries].sort((a, b) => b.arena_rating - a.arena_rating)
    : [...entries].sort((a, b) => b.arena_wins - a.arena_wins);

  return (
    <div className="space-y-4 animate-fade-in pb-4">
      <div className="card text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <Trophy className="w-6 h-6 text-amber-400" />
          <h2 className="text-xl font-bold text-white">Топ игроков</h2>
        </div>
        <div className="flex gap-2">
          <button
            className={`flex-1 btn text-sm ${tab === 'rating' ? 'btn-accent' : 'btn-ghost'}`}
            onClick={() => setTab('rating')}
          >
            По рейтингу
          </button>
          <button
            className={`flex-1 btn text-sm ${tab === 'wins' ? 'btn-accent' : 'btn-ghost'}`}
            onClick={() => setTab('wins')}
          >
            По победам
          </button>
        </div>
      </div>

      {error && (
        <div className="card text-center text-sm text-red-400">Не удалось загрузить рейтинг. Проверь связь.</div>
      )}

      {loading ? (
        <div className="card text-center py-8 text-gray-500">
          <p className="text-sm">Загрузка...</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">
          <Trophy className="w-12 h-12 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Пока нет игроков в рейтинге</p>
          <p className="text-xs mt-1">Сыграй на арене, чтобы попасть в топ!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((entry, index) => {
            const isMe = entry.player_id === user.id;
            const rank = index + 1;

            return (
              <div
                key={entry.player_id}
                className={`card flex items-center gap-3 ${
                  isMe ? 'border-teal-500/50 bg-teal-900/10' : ''
                } ${rank <= 3 ? 'animate-pop' : ''}`}
              >
                {/* Rank */}
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold shrink-0 ${
                  rank === 1 ? 'bg-amber-500/20 text-amber-400' :
                  rank === 2 ? 'bg-gray-400/20 text-gray-300' :
                  rank === 3 ? 'bg-orange-700/20 text-orange-400' :
                  'bg-black/30 text-gray-500'
                }`}>
                  {rank === 1 ? <Crown className="w-5 h-5" /> :
                   rank === 2 ? <Medal className="w-5 h-5" /> :
                   rank === 3 ? <Medal className="w-5 h-5" /> :
                   rank}
                </div>

                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-black/30 overflow-hidden shrink-0 flex items-center justify-center text-xl">
                  {entry.photo_url ? (
                    <img src={entry.photo_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    '🦸'
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <h4 className={`text-sm font-semibold truncate ${isMe ? 'text-teal-400' : 'text-white'}`}>
                    {entry.display_name} {isMe && '(ты)'}
                  </h4>
                  <div className="flex gap-3 text-xs text-gray-400">
                    <span>Ур. {entry.level}</span>
                    {tab === 'rating' ? (
                      <span className="text-amber-400">{entry.arena_rating} рейтинг</span>
                    ) : (
                      <span className="text-teal-400">{entry.arena_wins} побед</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button className="btn-ghost w-full text-sm" onClick={loadLeaderboard}>
        Обновить
      </button>
    </div>
  );
}
