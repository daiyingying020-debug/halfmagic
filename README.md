# HALF MAGIC — Makeup is Play

A responsive beauty storefront prototype with a dark editorial visual system and acid-lime accents.

## Run locally
Open `index.html` through a local static server. Camera try-on requires HTTPS or localhost and explicit camera permission.

## Features
- Responsive brand landing page and product cards
- Product detail views, wishlist, cart and demo checkout
- Local order history and order detail views
- Product category filters, keyword search and price sorting
- Browser-local demo account and saved preferences
- Live camera try-on prototype powered by MediaPipe Face Landmarker
- On-device face landmark tracking with lipstick and eye-color overlays
- Selfie preview and local look saving

## Important prototype boundaries
- Accounts, wishlist, cart and orders are stored in the current browser using localStorage; they are not synchronized across devices.
- Checkout is simulated. No payment is collected, and no shipping label or real fulfillment order is created.
- Live try-on uses browser camera access and a face-landmark overlay. It is an experimental visual preview, not shade-accurate commercial AR or a substitute for device/browser testing.
- MediaPipe runtime/model assets load from external CDNs; a network connection is required.
- Production launch still requires a secure backend, authentication, database, payment provider, inventory, privacy/consent flows and end-to-end testing.
