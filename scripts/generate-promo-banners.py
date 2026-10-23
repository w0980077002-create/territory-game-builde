#!/usr/bin/env python3
"""Render 1200x630 Telegram OG JPEG banners from TERRITORY-owned source artwork."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
ROOT=Path(__file__).resolve().parents[1]
PUBLIC=ROOT/'public'
OUT=PUBLIC/'promo'
OUT.mkdir(parents=True,exist_ok=True)
W,H=1200,630
def cover(path):
    im=Image.open(path).convert('RGB')
    scale=max(W/im.width,H/im.height)
    new=(round(im.width*scale),round(im.height*scale))
    im=im.resize(new,Image.Resampling.LANCZOS)
    return im.crop(((im.width-W)//2,(im.height-H)//2,(im.width+W)//2,(im.height+H)//2))
def font(sz):
    for candidate in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf'):
        if Path(candidate).exists():return ImageFont.truetype(candidate,sz)
    return ImageFont.load_default()
back=cover(PUBLIC/'monopoly'/'lagoon.png')
# Darken the left for copy readability without obscuring the lagoon or ship.
shade=Image.new('RGBA',(W,H),(0,0,0,0));px=shade.load()
for x in range(W):
    alpha=round(205*(1-x/W)**1.55)
    for y in range(H):px[x,y]=(4,13,27,alpha)
base=Image.alpha_composite(back.convert('RGBA'),shade)
def paste_obj(img,path,position,limit):
    if not path.exists():return
    sprite=Image.open(path).convert('RGBA')
    sprite.thumbnail(limit,Image.Resampling.LANCZOS)
    img.alpha_composite(sprite,(position[0],position[1]))
for lang,tag,sub,caption in [
 ('ru','БОИ • СОКРОВИЩА • ПРИКЛЮЧЕНИЯ','ИГРАЙ В TELEGRAM','Сражайся • Собирай • Побеждай'),
 ('en','FIGHT • TREASURE • ADVENTURE','PLAY IN TELEGRAM','Battle • Explore • Win')
]:
    im=base.copy()
    paste_obj(im,PUBLIC/'monopoly'/'ship.webp',(775,125),(365,360))
    paste_obj(im,PUBLIC/'assets'/'territory'/'characters'/'heroes'/'female_warrior'/'idle.webp',(805,218),(330,410))
    d=ImageDraw.Draw(im)
    d.rounded_rectangle((15,15,W-15,H-15),radius=28,outline='#fbd488',width=8)
    # Shadow for title and subtitle
    def title(pos,label,size,color):
        f=font(size)
        d.text((pos[0]+4,pos[1]+5),label,font=f,fill='#170c0a',stroke_width=8,stroke_fill='#170c0a')
        d.text(pos,label,font=f,fill=color,stroke_width=3,stroke_fill='#6e3512')
    title((70,105),'TERRITORY',105,'#ffd47c')
    d.rounded_rectangle((65,263,772,332),radius=16,fill=(23,40,52,230),outline='#b68c43',width=3)
    d.text((89,276),tag,font=font(30 if lang=='en' else 28),fill='#fff3c9')
    title((75,405),sub,48,'#f0ddab')
    d.text((78,480),caption,font=font(28),fill='#e8f7fd')
    d.rounded_rectangle((75,550,475,598),radius=10,fill='#0c74ce',outline='#afe8ff',width=2)
    d.text((106,559),'PLAY NOW' if lang=='en' else 'ИГРАТЬ',font=font(27),fill='#ffffff')
    image=im.convert('RGB')
    image.save(OUT/f'og-{lang}.jpg',format='JPEG',quality=88,optimize=True)
    assert Image.open(OUT/f'og-{lang}.jpg').size==(1200,630)
    print('Generated',OUT/f'og-{lang}.jpg')
