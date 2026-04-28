# BubbleShop - TalesRunner Item Store

E-commerce web app for selling TalesRunner game items.
Built from scratch in **~20 hours** with vanilla HTML/CSS/JS + Firebase (no framework).

## Preview

### Customer Shop

![Shop Page](screenshots/shop.png)

### Admin Backoffice

![Admin Page](screenshots/admin.png)

## Live Demo

| Page               | URL                                              |
| ------------------ | ------------------------------------------------ |
| Shop (customer)    | https://telesrunner-peerapong.web.app            |
| Admin (backoffice) | https://telesrunner-peerapong.web.app/admin.html |

## Tech Stack

- **Frontend:** HTML + CSS + vanilla JavaScript (zero dependencies)
- **Backend:** Firebase Firestore (realtime database)
- **Auth:** Firebase Authentication (email/password)
- **Hosting:** Firebase Hosting
- **Security:** Firestore rules with field-level validation

## Features

### Customer Shop

- Product grid with real-time stock badges
- Item modal with quantity selector and live price calculation
- Cart side panel with subtotals
- Order checkout with Facebook name + character name validation
- Order history search by Facebook name
- Shop open/close hours display (auto-detect by day/time)
- Anti-spam: honeypot, cooldown, captcha, duplicate order check

### Admin Backoffice

- Firebase Auth login (multi-admin support)
- Real-time order board with status management (pending / completed / cancelled)
- Product CRUD with drag & drop reordering
- Quick stock +/- buttons (instant adjust for personal admin accounts)
- Stock history log (who added/reduced, when, how much)
- BAN list management (block/unblock customers)
- Base64 image upload with size validation (500KB limit)
- Decimal price support

## Security

- **Firebase Auth** with UID-based admin check (no passwords in database)
- **Firestore rules** enforce field-level permissions:
  - Customers can only update stock field (>= 0) and cancel own pending orders
  - Admin-only: create/delete items, manage settings, update order status
- **XSS prevention:** event delegation instead of inline handlers, HTML escaping with single quote support
- **Race condition protection:** Firestore transactions for stock deduction and order cancellation
- **Anti-bot:** honeypot field, cooldown timer, captcha, server-side field validation

## Project Structure

```
index.html          # Customer shop page
admin.html          # Admin backoffice page
css/style.css       # Purple/pink TalesRunner theme
js/shop.js          # Shop logic (cart, orders, anti-spam)
js/admin.js         # Admin logic (products, orders, stock, BAN)
js/modal-alert.js   # Custom modal & toast notification system
firestore.rules     # Security rules
firebase.json       # Hosting config
```

## Development Timeline

Built in **~20 hours** (March 27, 2026 22:00 — March 28, 2026) including:

- Full e-commerce flow (browse, cart, checkout, order history)
- Admin backoffice with real-time updates
- Security hardening (auth, rules, XSS, race conditions)
- Multiple rounds of code review and fixes
- Drag & drop product reordering
- BAN list management
- Stock adjustment system with audit log
