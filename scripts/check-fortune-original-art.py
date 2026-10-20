"""Verify that the restored art actually contains the attached original pixels."""
from pathlib import Path
import hashlib
import json
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
source=ROOT/'scripts/artwork/fortune-reference.jpg'
meta=json.loads((ROOT/'public/fortune/original-art.json').read_text())
assert hashlib.sha256(source.read_bytes()).hexdigest()==meta['source_sha256']
src=Image.open(source).convert('RGB')
rotor=Image.open(ROOT/'public/fortune/original-wheel.webp').convert('RGBA')
# Central lion is copied exactly, not an approximation or a newly rendered logo.
count=0
for dy in range(-115,116):
 for dx in range(-115,116):
  if dx*dx+dy*dy<=115*115:
   assert rotor.getpixel((360+dx,360+dy))[:3]==src.getpixel((426+dx,595+dy))
   count+=1
for name,offset in [('original-title.webp',(200,5)),('original-pointer.webp',(374,211))]:
 im=Image.open(ROOT/'public/fortune'/name).convert('RGBA')
 for y in range(im.height):
  for x in range(im.width):
   r,g,b,a=im.getpixel((x,y))
   if a==255:assert (r,g,b)==src.getpixel((x+offset[0],y+offset[1])),(name,x,y)
scene=Image.open(ROOT/'public/fortune/original-scene.webp').convert('RGB')
assert scene.crop((60,170,165,250)).tobytes()==src.crop((60,170,165,250)).tobytes(),'original hostess face must be preserved'
for box in [(290,417,369,450),(393,394,460,425),(205,724,244,750),(215,601,239,625),(543,799,560,821),(400,834,458,861),(596,565,648,613)]:
 same=total=0
 for y in range(box[1],box[3]):
  for x in range(box[0],box[2]):
   same+=rotor.getpixel((x-66,y-235))[:3]==src.getpixel((x,y));total+=1
 assert same/total<.05,('obsolete label/scroll was not fully retouched',box,same/total)
# The background has no central static lion/wheel beneath the rotating layer.
assert scene.crop((339,500,513,690)).tobytes()!=src.crop((339,500,513,690)).tobytes()
wheel=(ROOT/'src/components/WheelOfFortune.tsx').read_text()
css=(ROOT/'src/components/fortune.css').read_text()
assert 'fortune-prizes' not in wheel+css and 'Возможные награды' not in wheel
assert 'approved-' not in wheel+css
assert meta['server_index_to_original_slot']==[11,0,6,8,9,2,3,10,1,5,4,7]
print(f'Original art PASS: {count} unchanged lion pixels, exact title/pointer pixels and hostess face, old quantities/scroll retouched, cleared background, no gallery or generated-art references.')
