"""
Generates the app icon: an off-white paper plane with an orange
fountain-pen nib fused at the nose, on a graphite-gray rounded square.

Writes the Safari toolbar icons straight into extension/images/ (the
filenames the manifest expects) and the macOS AppIcon sizes into
appicon/ (see README.md for how to drop those into Xcode's asset
catalog). Re-run this after any tweak to regenerate every size.
"""
from PIL import Image, ImageDraw, ImageFilter
import math, os

SS = 4
BASE = 1024
S = BASE * SS

INK_DARK  = (26, 25, 23, 255)
CREAM     = (247, 242, 231, 255)
CREAM_DIM = (219, 211, 194, 255)
ORANGE    = (222, 118, 42, 255)

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))

def vgrad(size, top, bot):
    g = Image.new("RGBA", (1, size), (0,0,0,255))
    gd = ImageDraw.Draw(g)
    for y in range(size):
        gd.point((0,y), fill=lerp(top,bot,y/size))
    return g.resize((size,size))

def bg_rounded(img, top, bot, radius_frac=0.225):
    grad = vgrad(S, top, bot)
    mask = Image.new("L", (S,S), 0)
    md = ImageDraw.Draw(mask)
    r = int(S*radius_frac)
    md.rounded_rectangle([0,0,S-1,S-1], radius=r, fill=255)
    img.paste(grad, (0,0), mask)
    # subtle inner highlight ring
    ring = Image.new("RGBA", (S,S), (0,0,0,0))
    rd = ImageDraw.Draw(ring)
    inset = int(S*0.012)
    rd.rounded_rectangle([inset,inset,S-1-inset,S-1-inset], radius=r-inset,
                          outline=(255,255,255,38), width=int(S*0.004))
    img.alpha_composite(ring)

def rotate_pts(pts, cx, cy, deg):
    a = math.radians(deg)
    ca, sa = math.cos(a), math.sin(a)
    out = []
    for (x,y) in pts:
        x -= cx; y -= cy
        out.append((cx + x*ca - y*sa, cy + x*sa + y*ca))
    return out

def paper_plane(img, cx, cy, scale, angle_deg, body_col, flap_col, outline=None, ow=0):
    L = scale
    nose      = (cx + L*0.66, cy)
    top_back  = (cx - L*0.58, cy - L*0.46)
    bot_back  = (cx - L*0.26, cy + L*0.50)
    notch     = (cx - L*0.06, cy + L*0.06)

    main_tri = rotate_pts([nose, top_back, notch], cx, cy, angle_deg)
    flap_tri = rotate_pts([nose, notch, bot_back], cx, cy, angle_deg)

    d = ImageDraw.Draw(img)
    d.polygon(flap_tri, fill=flap_col)
    d.polygon(main_tri, fill=body_col)
    if outline:
        pts = [main_tri[1], main_tri[0], flap_tri[2], main_tri[2], main_tri[1]]
        d.line(pts, fill=outline, width=ow, joint="curve")
    return main_tri[0]

def fountain_nib(img, cx, cy, length, angle_deg, col):
    L = length
    tip = (cx+L*0.5, cy)
    left = (cx-L*0.3, cy-L*0.30)
    right = (cx-L*0.3, cy+L*0.30)
    back = (cx-L*0.5, cy)
    pts = rotate_pts([tip,left,back,right], cx, cy, angle_deg)
    d = ImageDraw.Draw(img)
    d.polygon(pts, fill=col)
    slit = rotate_pts([(cx-L*0.45,cy),(cx+L*0.42,cy)], cx, cy, angle_deg)
    d.line(slit, fill=(0,0,0,90), width=max(1,int(length*0.05)))

def soft_shadow(base_img, draw_fn, blur_frac=0.022, offset=(0.012,0.017), alpha=155):
    layer = Image.new("RGBA", base_img.size, (0,0,0,0))
    draw_fn(layer)
    a = layer.split()[3].point(lambda p: min(255, int(p * alpha/255)))
    black = Image.new("RGBA", base_img.size, (0,0,0,255))
    solid = Image.composite(black, Image.new("RGBA", base_img.size,(0,0,0,0)), layer.split()[3])
    solid.putalpha(a)
    solid = solid.filter(ImageFilter.GaussianBlur(base_img.size[0]*blur_frac))
    dx, dy = int(base_img.size[0]*offset[0]), int(base_img.size[1]*offset[1])
    base_img.alpha_composite(solid, (dx,dy))

def render_master():
    img = Image.new("RGBA",(S,S),(0,0,0,0))
    bg_rounded(img, (68,68,71,255), (47,47,49,255))
    cx, cy = S*0.47, S*0.52
    scale = S*0.40
    angle = -14
    soft_shadow(img, lambda L: paper_plane(L, cx, cy, scale, angle, CREAM, CREAM_DIM))
    nose = paper_plane(img, cx, cy, scale, angle, CREAM, CREAM_DIM, outline=(0,0,0,32), ow=int(S*0.005))
    fountain_nib(img, nose[0]-scale*0.12, nose[1], scale*0.46, angle, ORANGE)
    return img

def main():
    master = render_master()
    os.makedirs("extension/images", exist_ok=True)
    os.makedirs("appicon", exist_ok=True)

    for sz in (48, 96, 128, 256, 512):
        master.resize((sz,sz), Image.LANCZOS).save(f"extension/images/icon-{sz}.png")
    for sz in (16, 32, 64, 128, 256, 512, 1024):
        master.resize((sz,sz), Image.LANCZOS).save(f"appicon/appicon-{sz}.png")
    master.resize((BASE,BASE), Image.LANCZOS).save("appicon/master-1024.png")
    print("icons written to extension/images/ and appicon/")

if __name__ == "__main__":
    main()
