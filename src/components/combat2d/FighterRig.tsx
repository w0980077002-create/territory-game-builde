import { memo, useId } from 'react';
import { rigAsset, type FighterRigDefinition } from './fighterRigs';

/** Joint translation wrappers keep local pivots independent of animated rotation.
 * Reconstructed overlapping elbows and shoulders remain covered throughout swings. */
export const FighterRig = memo(function FighterRig({ rig }: { rig: FighterRigDefinition }) {
  const id = useId().replace(/:/g, '');
  const goblin = rig.id === 'goblin';
  const asset = (part: string) => rigAsset(rig, part);
  const armImage = (side: string, y: number) => <image href={asset(`arm-${side}`)} x={-34} y={y} width={72} height={145} preserveAspectRatio="none" />;
  function arm(side: 'left' | 'right') {
    const left = side === 'left';
    return <g transform={`translate(${left ? 194 : 318} 258)`}>
      <g data-rig-part={`arm-${side}`} className={`rig-joint rig-arm-${side}`}>
        <ellipse cx="0" cy="9" rx="24" ry="25" fill={rig.skin} />
        <g clipPath={`url(#${id}-upper)`}>{armImage(side, -18)}</g>
        <g transform="translate(0 57)">
          <g data-rig-part={`forearm-${side}`} className={`rig-joint rig-forearm-${side}`}>
            <circle r="19" fill={rig.skin} />
            <g clipPath={`url(#${id}-lower)`}>{armImage(side, -75)}</g>
            <g transform="translate(3 57)">
              {left ? <g data-rig-part="shield" className="rig-joint rig-shield">
                <ellipse data-anchor="shield-hit-area" cx="0" cy="0" rx="71" ry="96" visibility="hidden" />
                <image href={asset('shield')} x="-83" y="-108" width="166" height="222" preserveAspectRatio="none" />
                <ellipse data-effect="shield-glint" className="rig-shield-glint" cx="0" cy="0" rx="71" ry="96" />
              </g> : <g data-rig-part="weapon" className="rig-joint rig-weapon">
                <circle data-anchor="weapon-grip" cx="0" cy="0" r="1" visibility="hidden" />
                <circle data-anchor="weapon-tip" cx={goblin ? 23 : 2} cy="-192" r="1" visibility="hidden" />
                <path data-anchor="weapon-edge" d={goblin ? 'M23 -192 Q65 -94 0 -35' : 'M2 -196 L2 -45'} visibility="hidden" />
                <g transform={goblin ? 'scale(-1 1)' : undefined}><image href={asset('weapon')} x={goblin ? -68 : -30} y="-205" width={goblin ? 85 : 65} height="224" preserveAspectRatio="none" /></g>
                <path data-effect="blade-trail" className="rig-blade-trail" d={goblin ? 'M23 -192 Q65 -94 0 -35' : 'M2 -196 L2 -45'} />
              </g>}
            </g>
          </g>
        </g>
      </g>
    </g>;
  }
  function leg(side: 'left' | 'right') {
    const left = side === 'left';
    const sprite = (y: number) => <image href={asset(`leg-${side}`)} x={left ? -43 : -39} y={y} width={left ? 92 : 99} height="121" preserveAspectRatio="none" />;
    return <g transform={`translate(${left ? -35 : 31} 0)`}><g data-rig-part={`leg-${side}`} className={`rig-joint rig-leg-${side}`}>
      <g clipPath={`url(#${id}-thigh)`}>{sprite(-13)}</g>
      <g transform="translate(0 53)"><g data-rig-part={`knee-${side}`} className={`rig-joint rig-knee-${side}`}>
        <circle data-anchor={`foot-${side}`} cx="0" cy="55" r="1" visibility="hidden" />
        <g clipPath={`url(#${id}-shin)`}>{sprite(-66)}</g>
      </g></g>
    </g></g>;
  }
  return <>
    <defs>
      <clipPath id={`${id}-thigh`}><rect x="-55" y="-20" width="120" height="84" /></clipPath>
      <clipPath id={`${id}-shin`}><rect x="-55" y="-12" width="120" height="80" /></clipPath>
      <clipPath id={`${id}-head`}><rect x="-95" y="-145" width="190" height="164" /></clipPath>
      <clipPath id={`${id}-hair`}><rect x="-95" y="12" width="190" height="45" /></clipPath>
      <clipPath id={`${id}-upper`}><rect x="-45" y="-25" width="90" height="94" /></clipPath>
      <clipPath id={`${id}-lower`}><rect x="-45" y="-9" width="90" height="84" /></clipPath>
    </defs>
    <ellipse className="rig-ground" cx="256" cy="493" rx="112" ry="10" />
    <g transform="translate(256 390)">
      <g data-rig-part="root" className="rig-joint rig-root">
        {leg('left')}
        {leg('right')}
        <g data-rig-part="torso" className="rig-joint rig-torso">
          <g transform="translate(-256 -390)">
            <ellipse data-anchor="torso-hit-area" cx="258" cy="302" rx="65" ry="65" visibility="hidden" />
            <image href={asset('torso')} x="169" y="220" width="175" height="219" preserveAspectRatio="none" />
            <g transform="translate(258 238)"><g data-rig-part="head" className="rig-joint rig-head">
              <g transform={goblin ? 'scale(-1 1)' : undefined}>
                <g clipPath={`url(#${id}-head)`}><image href={asset('head')} x="-77" y="-139" width="155" height="186" preserveAspectRatio="none" /></g>
                <g data-rig-part="hair" className="rig-joint rig-hair" clipPath={`url(#${id}-hair)`}><image href={asset('head')} x="-77" y="-139" width="155" height="186" preserveAspectRatio="none" /></g>
              </g>
            </g></g>
            {arm('left')}
            {arm('right')}
          </g>
        </g>
      </g>
    </g>
  </>;
});
