from pathlib import Path
from PIL import Image, ImageDraw

out = Path(__file__).resolve().parent.parent / 'public' / 'icons'
out.mkdir(parents=True, exist_ok=True)
for size, name in [(192, 'icon-192.png'), (512, 'icon-512.png'), (512, 'maskable-512.png')]:
    image = Image.new('RGB', (size, size), '#123c32')
    d = ImageDraw.Draw(image)
    def box(a): return tuple(int(x * size / 512) for x in a)
    d.rounded_rectangle(box((144, 113, 366, 400)), radius=int(size*.035), fill='#dfd6b7')
    d.rounded_rectangle(box((119, 99, 341, 385)), radius=int(size*.035), fill='#fffdf7')
    d.polygon([tuple(int(x * size / 512) for x in p) for p in [(230, 162), (163, 244), (168, 268), (192, 286), (216, 272), (211, 311), (195, 327), (265, 327), (249, 311), (244, 272), (268, 286), (292, 268), (297, 244)]], fill='#123c32')
    d.ellipse(box((162, 227, 221, 287)), fill='#123c32')
    d.ellipse(box((239, 227, 298, 287)), fill='#123c32')
    image.save(out / name)
print('Generated 192 / 512 / maskable local PWA icons.')
