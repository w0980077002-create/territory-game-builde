import { useState } from 'react';

const ART = 'assets/territory/ui/honors/mortarion-lord-approved.';

/** Crops of the approved image, never replacement artwork. Each gem/crown
 * keeps its source aspect ratio; only the narrow, gem-free rails flex. */
export function MortarionLordFrame() {
  const [format, setFormat] = useState<'avif' | 'webp'>('avif');
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  if (failed) return null;
  const source = import.meta.env.BASE_URL + ART + format;
  const fragment = (name: string, viewBox: string, rail = false) => (
    <svg className={'mortarion-crown__' + name} viewBox={viewBox}
      preserveAspectRatio={rail ? 'none' : 'xMidYMid meet'} overflow="hidden">
      <image href={source} width="512" height="512" />
    </svg>
  );
  return <div className={'mortarion-crown' + (ready ? ' mortarion-crown--ready' : '')}
    data-testid="mortarion-lord-composition" aria-hidden="true">
    <img className="mortarion-crown__loader" data-testid="mortarion-forged-frame" src={source}
      alt="" draggable={false} onLoad={() => setReady(true)}
      onError={() => format === 'avif' ? setFormat('webp') : setFailed(true)} />
    {fragment('crest', '0 0 512 116')}
    {fragment('left-rail upper-rail', '4 116 38 104', true)}
    {fragment('right-rail upper-rail', '470 116 38 104', true)}
    {fragment('left-rail lower-rail', '4 282 38 118', true)}
    {fragment('right-rail lower-rail', '470 282 38 118', true)}
    {fragment('left-gem', '0 220 52 62')}
    {fragment('right-gem', '460 220 52 62')}
    {fragment('foot', '0 400 512 112')}
    <span className="mortarion-crown__ruby" />
    <span className="mortarion-crown__awakening" />
    <span className="mortarion-crown__reflection" />
    <span className="mortarion-crown__spark mortarion-crown__spark--one" />
    <span className="mortarion-crown__spark mortarion-crown__spark--two" />
    <span className="mortarion-crown__spark mortarion-crown__spark--three" />
  </div>;
}
