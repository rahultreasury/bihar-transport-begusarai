CUSTOMER CARE REPRESENTATIVE PHOTO
=================================

The photo that the Support card on the enquiry confirmation page renders:

    public/assets/customer-care.png

That path is the compiled-in default (DEFAULT_CUSTOMER_CARE_PHOTO in
src/config/customerCare.js), so the portrait shows up with NO environment
variable and NO backend configuration. It ships with the frontend build and is
served from the same origin as the rest of the site.

WHY IT IS A PNG
---------------
The portrait is a transparent-background cutout. It must stay PNG (or WebP with
alpha) — a JPEG flattens the alpha channel onto a white rectangle, which shows
up on the card as a white box behind the executive.

The navy background you see behind the person is a CSS panel in
components/enquiry/SupportCard.jsx, painted BEHIND the alpha channel. Never bake
a background colour into the image itself, and never add a white background
behind it — the transparency is the point.

RECOMMENDED SPEC
----------------
3:4 portrait, transparent, ~400px on the long edge, under 200 KB.
The card renders it at 96x140 CSS px, so 400px is already ~3x for retina.

    sips -Z 400 "your-source.png" --out public/assets/customer-care.png

VERIFYING
---------
The Support card falls back to a branded "BT" monogram if the image fails to
load, so a broken path looks like a working page. Always check the Network tab
for /assets/customer-care.png and confirm:

    200 OK   Content-Type: image/png

A 200 that returns text/html means the SPA fallback caught the miss and the
file is NOT in the build output.

TO USE A DIFFERENT PHOTO
------------------------
Point the env var at it. Both are optional.

  Frontend (build time)
    VITE_CUSTOMER_CARE_PHOTO=/assets/customer-care.png

  Backend (runtime — the API response can override the frontend default)
    CUSTOMER_CARE_PHOTO=/assets/customer-care.png
    Add it to transport-system/backend/.env and the Render dashboard.

NOTE: if you rename or delete the file here, update
DEFAULT_CUSTOMER_CARE_PHOTO in src/config/customerCare.js in the same commit,
otherwise the card silently renders the monogram again.
