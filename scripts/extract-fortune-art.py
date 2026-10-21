"""Reproducible extraction/retouch of the owner's ORIGINAL flattened artwork.
No image generation. Dependencies for this offline build tool only:
  Pillow, numpy, opencv-python-headless==4.11.0.86
Runtime uses the exported WebP layers, with no image-processing dependency.
"""
from pathlib import Path
import hashlib
import json
import math
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'scripts/artwork/fortune-reference.jpg'
OUT=ROOT/'public/fortune'
OUT.mkdir(exist_ok=True)
im=Image.open(SOURCE).convert('RGB')
W,H=im.size
assert (W,H)==(853,1280)
a=np.array(im)
def poly(points):
 m=Image.new('L',(W,H));ImageDraw.Draw(m).polygon(points,fill=255);return np.array(m)
def retouch(array,boxes=(),polygons=(),radius=4):
 m=np.zeros(array.shape[:2],np.uint8)
 for x1,y1,x2,y2 in boxes:cv2.rectangle(m,(x1,y1),(x2,y2),255,-1)
 for pts in polygons:cv2.fillPoly(m,[np.array(pts,np.int32)],255)
 return cv2.inpaint(array,m,radius,cv2.INPAINT_TELEA)
def export(name,rgb,mask,box):
 rgba=Image.fromarray(rgb).convert('RGBA');rgba.putalpha(Image.fromarray(mask).filter(ImageFilter.GaussianBlur(.35)))
 rgba.crop(box).save(OUT/name,lossless=True,method=6)
# The crown, red plaque, gold lettering and purple ribbons are untouched source
# pixels. The hand-drawn alpha follows their silhouette, never a recreated title.
title_outline=[(213,81),(231,73),(256,72),(277,82),(290,69),(316,63),(335,60),(342,44),(354,53),(365,53),(374,40),(384,47),(397,49),(401,26),(411,39),(418,28),(419,18),(426,8),(434,19),(434,30),(443,42),(454,29),(465,29),(461,53),(476,51),(486,43),(495,52),(522,54),(533,61),(557,65),(582,82),(599,73),(621,72),(644,80),(628,89),(618,108),(621,129),(635,141),(621,148),(614,165),(622,179),(606,185),(591,183),(590,195),(577,207),(548,211),(513,205),(477,203),(451,214),(436,225),(426,238),(413,224),(399,216),(373,207),(341,207),(311,213),(279,213),(258,207),(247,198),(246,184),(233,181),(220,186),(224,169),(218,153),(207,147),(216,133),(222,116),(221,100)]
export('original-title.webp',a,poly(title_outline),(200,5,647,240))
# Exact original pointer, retained independently of the rotating assembly.
pointer_outline=[(426,212),(434,236),(441,249),(450,246),(451,257),(469,269),(480,275),(456,285),(445,304),(426,333),(410,307),(399,286),(378,277),(386,270),(403,258),(405,246),(414,249),(420,235)]
export('original-pointer.webp',a,poly(pointer_outline),(374,211,482,335))
# Original panels. Inpaint only their obsolete baked-in text/value, preserving
# the actual gold frames, ticket illustration and question medallion.
panel=np.zeros((H,W),np.uint8)
p=Image.fromarray(panel);ImageDraw.Draw(p).rounded_rectangle((7,16,211,78),radius=31,fill=255);panel=np.array(p)
ticket=retouch(a,[(77,28,195,67)])
export('original-ticket-panel.webp',ticket,panel,(5,14,214,81))
p=Image.new('L',(W,H));ImageDraw.Draw(p).rounded_rectangle((659,16,847,78),radius=31,fill=255)
rules=retouch(a,[(720,30,832,64)])
export('original-rules-panel.webp',rules,np.array(p),(656,14,850,81))
# Spin: original button enamel, bevels, border and side diamonds; DOM supplies
# button text, ticket and quantity, rather than hiding hit areas over a screen.
button_outline=[(278,879),(565,879),(583,887),(596,906),(603,927),(619,945),(604,962),(597,986),(580,1001),(563,1010),(280,1010),(261,1003),(249,989),(244,967),(233,945),(245,927),(251,905),(262,889)]
button=retouch(a,[(295,900,562,950),(369,951,469,991)],radius=5)
export('original-spin-frame.webp',button,poly(button_outline),(230,875,622,1015))
export('original-ticket.webp',a,poly([(24,39),(29,33),(56,27),(62,32),(63,48),(59,54),(31,61),(25,57)]),(21,25,66,64))
# Wheel retains original sectors/illustrations in their original positions.
# The only removed illustration is the obsolete scroll. Battle stone uses the
# existing canonical game art, because the reference has no battle stone.
# Clone clean neighboring ORIGINAL texture over the complete old glyphs and
# shadows. Each donor comes from the same sector, avoiding synthetic flat fills.
wheel=a.copy()
def clone_label(dst,src,polygon=None):
 x1,y1,x2,y2=dst;u1,v1,u2,v2=src
 tile=cv2.resize(a[v1:v2,u1:u2],(x2-x1,y2-y1),interpolation=cv2.INTER_LINEAR)
 m=Image.new('L',(W,H));d=ImageDraw.Draw(m)
 if polygon:d.polygon(polygon,fill=255)
 else:d.rectangle((x1,y1,x2,y2),fill=255)
 alpha=np.array(m.filter(ImageFilter.GaussianBlur(.7)))[y1:y2,x1:x2,None]/255.
 wheel[y1:y2,x1:x2]=np.uint8(wheel[y1:y2,x1:x2]*(1-alpha)+tile*alpha)
clone_label((285,411,375,460),(307,461,340,479))
clone_label((386,385,467,435),(394,437,464,459))
clone_label((616,489,673,536),(672,474,695,499))
clone_label((207,590,245,635),(247,593,272,629))
clone_label((195,713,249,761),(250,710,268,746))
clone_label((531,785,571,831),(573,783,589,823))
clone_label((389,826,466,871),(468,826,482,866))
clone_label((242,782,372,855),(347,780,358,800),[(252,782),(371,819),(360,855),(242,815)])
CX,CY=426.,595.
y,x=np.indices((H,W));dx=x-CX;dy=y-CY;r=np.hypot(dx,dy);theta=np.arctan2(dy,dx)
# Remove the original fixed pointer from the rotor. Clone same-radius source
# gold/sector pixels at the adjacent uncovered angle, retaining metal texture.
pm=poly(pointer_outline)>0
rr,cc=np.where(pm & (r>250) & (r<357))
ang=theta[rr,cc]+np.where(r[rr,cc]>=292,.34,np.where(dx[rr,cc]>0,.14,-.14))
sx=np.rint(CX+r[rr,cc]*np.cos(ang)).astype(int)
sy=np.rint(CY+r[rr,cc]*np.sin(ang)).astype(int)
wheel[rr,cc]=wheel[sy,sx]
# Remove the hostess' fingers from the rotor where they originally crossed
# the rim, cloning the uncovered neighboring original rim at the same radius.
arm=[(173,275),(194,245),(265,250),(305,241),(329,226),(352,231),(379,239),(399,245),(393,252),(369,253),(362,263),(346,265),(326,273),(266,291),(214,316)]
rr,cc=np.where((poly(arm)>0)&(r>300)&(r<355))
ang=theta[rr,cc]+.48
sx=np.rint(CX+r[rr,cc]*np.cos(ang)).astype(int);sy=np.rint(CY+r[rr,cc]*np.sin(ang)).astype(int)
wheel[rr,cc]=wheel[sy,sx]
# The flattened button occludes a short bottom arc. Reconstruct just that arc
# from the opposite original engraved rim, never synthesize a new ornament.
bottom=(y>=883)&(r>=289)&(r<355)
rr,cc=np.where(bottom)
sx=np.rint(2*CX-cc).astype(int);sy=np.rint(2*CY-rr).astype(int)
wheel[rr,cc]=wheel[sy,sx]
# The scroll and its old '5' are fully removed. Clone the original empty
# sapphire texture from the same sector; the canonical battle stone overlays it.
scroll_area=(abs(theta)<.245)&(r>128)&(r<279)&(x>500)
rr,cc=np.where(scroll_area)
sx=686+np.minimum((cc-500)%36,35-(cc-500)%36)//2
sy=555+np.minimum((rr-510)%116,115-(rr-510)%116)//2
wheel[rr,cc]=a[sy,sx]
# Retain the original rim and projecting jewels, excluding exposed castle pixels
# outside the metal silhouette. No circle, lion or frame is redrawn.
gold=(wheel[:,:,0]>115)&(wheel[:,:,1]>65)&(wheel[:,:,0]>wheel[:,:,2]*1.18)&(wheel[:,:,1]>wheel[:,:,2]*.9)
ruby=(wheel[:,:,0]>130)&(wheel[:,:,0]>wheel[:,:,1]*1.4)
mask=np.uint8((r<=337)|((r<=354)&(gold|ruby)))*255
export('original-wheel.webp',wheel,mask,(66,235,786,955))
# The static scene has ALL original wheel/title/pointer/button/panel pixels
# removed. Its large reconstructed hidden area remains behind the opaque rotor.
background_mask=np.uint8(r<374)*255
background_mask=np.maximum(background_mask,poly(title_outline))
background_mask=np.maximum(background_mask,poly(pointer_outline))
background_mask=np.maximum(background_mask,poly(button_outline))
cv2.rectangle(background_mask,(0,0),(215,82),255,-1)
cv2.rectangle(background_mask,(653,0),(852,84),255,-1)
# Keep the original hostess' outstretched arm where it crosses above the rim.
arm=[(173,275),(194,245),(265,250),(305,241),(329,226),(352,231),(379,239),(399,245),(393,252),(369,253),(362,263),(346,265),(326,273),(266,291),(214,316)]
background_mask[poly(arm)>0]=0
# Reconstruct hidden castle regions from a clean ORIGINAL stained-glass patch.
# A soft optical expansion avoids repeated brick/chain seams when the viewport
# exposes areas that were fully occluded by the flattened reference wheel.
cv2.rectangle(background_mask,(201,0),(647,239),255,-1)
background_mask=cv2.dilate(background_mask,np.ones((7,7),np.uint8))
background_mask[poly(arm)>0]=0
texture=cv2.resize(a[0:42,259:321],(W,H),interpolation=cv2.INTER_CUBIC)
texture=cv2.GaussianBlur(texture,(0,0),3)
# The narrow exposed gap outside the extracted rim uses adjacent original
# castle/treasure pixels rather than the blue hidden-area fill. Sample safely
# beyond the old wheel; lower angles use the platform below the old button.
rr,cc=np.where((r>328)&(r<390)&(dy>-265))
donor_radius=np.where(dy[rr,cc]/r[rr,cc]>.70,455.,400.)
sx=np.clip(np.rint(CX+donor_radius*np.cos(theta[rr,cc])).astype(int),0,W-1)
sy=np.clip(np.rint(CY+donor_radius*np.sin(theta[rr,cc])).astype(int),0,H-1)
texture[rr,cc]=a[sy,sx]
feather=np.array(Image.fromarray(background_mask).filter(ImageFilter.GaussianBlur(4)))[:,:,None]/255.
background=np.uint8(a*(1-feather)+texture*feather)
Image.fromarray(background[:1080]).save(OUT/'original-scene.webp',lossless=True,method=6)
im.crop((0,1268,853,1280)).save(OUT/'original-floor.webp',lossless=True,method=6)
manifest={'source':'scripts/artwork/fortune-reference.jpg','source_sha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'source_size':[W,H],
 'method':'Original source pixels, hand-drawn alpha masks, same-sector texture retouch, panel inpainting, same-source cloned rim/background repair. No generated artwork.',
 'wheel_center':[426,595],'wheel_crop':[66,235,786,955],
 'server_index_to_original_slot':[11,0,6,8,9,2,3,10,1,5,4,7],
 'background_original_wheel_removed':True,'bottom_gallery_removed':True}
(OUT/'original-art.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps(manifest,indent=2))
