from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path

out = Path(__file__).resolve().parent.parent / 'assets' / 'knk-suite.ico'
out.parent.mkdir(parents=True, exist_ok=True)

sizes = [16, 24, 32, 48, 64, 128, 256]
images = []
for size in sizes:
    scale = size / 256
    img = Image.new('RGBA', (size, size), (9, 10, 13, 255))
    glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.rounded_rectangle((8*scale, 8*scale, 248*scale, 248*scale), radius=42*scale, outline=(255, 51, 71, 150), width=max(1, int(9*scale)))
    glow = glow.filter(ImageFilter.GaussianBlur(max(1, int(4*scale))))
    img.alpha_composite(glow)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((8*scale, 8*scale, 248*scale, 248*scale), radius=42*scale, fill=(24, 7, 12, 255), outline=(255, 51, 71, 255), width=max(1, int(6*scale)))
    d.line((45*scale, 83*scale, 211*scale, 83*scale), fill=(255, 51, 71, 75), width=max(1, int(3*scale)))
    d.line((45*scale, 178*scale, 211*scale, 178*scale), fill=(255, 51, 71, 75), width=max(1, int(3*scale)))
    d.line((58*scale, 103*scale, 85*scale, 127*scale, 58*scale, 151*scale), fill=(255, 71, 88, 255), width=max(1, int(13*scale)), joint='curve')
    d.line((103*scale, 151*scale, 145*scale, 151*scale), fill=(255, 255, 255, 235), width=max(1, int(11*scale)))
    d.ellipse((134*scale, 102*scale, 220*scale, 166*scale), fill=(255, 51, 71, 255))
    d.ellipse((169*scale, 112*scale, 183*scale, 156*scale), fill=(22, 6, 10, 255))
    d.ellipse((178*scale, 119*scale, 186*scale, 127*scale), fill=(255, 255, 255, 255))
    images.append(img)

images[-1].save(out, format='ICO', sizes=[(s, s) for s in sizes])
print(out)
