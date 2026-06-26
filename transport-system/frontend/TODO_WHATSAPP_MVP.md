# TODO - WhatsApp Booking MVP (Replace Backend Call)

## Completed
- [x] Replace Home.jsx `handleBookNowSubmit` backend booking API call with WhatsApp deep-link.
- [x] Keep existing validation + modal state handling.
- [x] Create reusable helper `createBookingMessage(data)` using the exact required format.
- [x] Encode message using `encodeURIComponent(message)`.
- [x] WhatsApp URL uses `https://wa.me/91XXXXXXXXXX?text=...` with `WHATSAPP_NUMBER` constant.
- [x] After opening WhatsApp: close modal + reset form + show toast text in `bookNowSuccess`.
- [x] If validation fails: existing `bookNowError` is shown, WhatsApp is not opened.
- [x] No changes to Google Maps / Places Autocomplete / price calculation UI.

## Notes / Known
- `latestQuote.duration` may be empty because current `Home.jsx` snapshot does not persist duration into `latestQuote`.
  - Current MVP uses `calcDuration` as a fallback when building WhatsApp message.

