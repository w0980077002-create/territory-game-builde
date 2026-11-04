import { PumpkinWitch } from '@/components/PumpkinWitch';
import { getFollowerArt } from '@/game/combatArt';

/** Keep the actual selected companion in the approved City lane.
 * The Witch has a real alternate blink frame and particle layers. Do not
 * play attack/heal poses here: those require a confirmed battle event. */
export function CityLivingFollower({ id, name }: { id: string; name: string }) {
  if (id === 'follower_pumpkin_witch_2026') {
    return <span data-testid="city-living-witch" role="img" aria-label={name}
      className="relative block w-full max-h-full aspect-square">
      <PumpkinWitch />
    </span>;
  }
  return <img src={getFollowerArt(id)} alt={name}
    className="home-follower-art city-follower-idle relative w-full h-auto object-contain object-bottom" />;
}
