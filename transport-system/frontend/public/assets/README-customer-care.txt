CUSTOMER CARE REPRESENTATIVE PHOTO
=================================

Put the customer-care representative's photo here as:

    public/assets/customer-care.jpg      (or .webp / .png)

Recommended: a square or 4:5 portrait, at least 400x400 px, under ~200 KB.

Then set ONE environment variable on the backend — this is the only step, and
the Support card, the sticky mobile bar and the customer-care API response all
pick it up automatically:

    CUSTOMER_CARE_PHOTO=/assets/customer-care.jpg

Add it to:
  • transport-system/backend/.env            (local)
  • Render dashboard → Environment           (production)
  • transport-system/backend/.env.example   (documented default)

No frontend code change is required. The image is requested by the browser from
the public assets folder and delivered by the same origin as the rest of the
site, so there is no bundler import and no base64 payload.

If the variable is unset, the Support card falls back to a branded monogram
avatar derived from the support name — so the page never shows a broken image.
