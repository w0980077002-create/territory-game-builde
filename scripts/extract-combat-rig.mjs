// Offline atlas export only. The atlas was reconstructed from approved designs;
// these crops isolate complete painted parts, never slices of an assembled body.
import { writeFileSync } from 'node:fs';
const commands = ['#!/usr/bin/env bash', 'set -euo pipefail'];
const source = 'docs/art-reference/combat2d/cutout-source.png';
const parts = ['head', 'torso', 'arm-right', 'arm-left', 'leg-left', 'leg-right', 'weapon', 'shield'];
const cells = {
 male_viking: [[35,0,300,341],[355,0,305,342],[715,0,180,321],[979,0,260,316],[33,347,242,276],[412,342,253,280],[736,320,144,313],[964,341,276,286]],
 goblin: [[24,626,316,354],[359,629,307,336],[724,637,180,295],[995,638,242,291],[34,950,246,287],[399,949,243,286],[731,933,178,313],[970,932,270,313]],
};
for (const [rig, boxes] of Object.entries(cells)) boxes.forEach(([x,y,w,h],i) => {
 commands.push(['convert', source, '-crop', `${w}x${h}+${x}+${y}`, '+repage', ...(rig === 'goblin' && i === 0 ? ['-region', '170x45+146+309', '-channel', 'A', '-evaluate', 'set', '0', '+channel', '+region'] : rig === 'goblin' && i === 1 ? ['-region', '151x26+0+310', '-channel', 'A', '-evaluate', 'set', '0', '+channel', '+region'] : rig === 'goblin' && i === 4 ? ['-region', '120x32+0+0', '-channel', 'A', '-evaluate', 'set', '0', '+channel', '+region'] : []), '-trim', '+repage', '-resize', '300x300>', '-quality', '88', '-define', 'webp:method=6', `public/assets/territory/combat2d/${rig}/${parts[i]}.webp`].map(x => `'${x}'`).join(' '));
});

writeFileSync('/tmp/extract-combat-rig.sh', commands.join('\n'));
console.log('Run bash /tmp/extract-combat-rig.sh to export the local sprites.');
