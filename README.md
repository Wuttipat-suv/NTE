# TalesRunner Shop

E-commerce web app for selling TalesRunner game items. Built with vanilla HTML/CSS/JS + Firebase.

## Live

| Page | URL |
|------|-----|
| Shop (customer) | https://telesrunner-peerapong.web.app |
| Admin (backoffice) | https://telesrunner-peerapong.web.app/admin.html |

## Tech Stack

- **Frontend:** HTML + CSS + JavaScript (no framework)
- **Database:** Firebase Firestore
- **Hosting:** Firebase Hosting (free tier)
- **Theme:** Purple/pink TalesRunner game style

## Project Structure

```
├── index.html              # Customer shop page (single page)
├── admin.html              # Admin backoffice page (single page)
├── css/
│   └── style.css           # TalesRunner purple/pink theme
├── js/
│   ├── firebase-config.js  # Firebase project config
│   ├── shop.js             # Shop logic (cart, modals, orders)
│   └── admin.js            # Admin logic (products, orders, stock)
├── assets/                 # Item images (use English filenames only)
├── firebase.json           # Firebase hosting config
├── firestore.rules         # Firestore security rules
├── firestore.indexes.json  # Firestore indexes
└── .firebaserc             # Firebase project reference
```

## Features

### Shop (index.html)

- **Item grid** — displays all products with image, name, price, stock badge
- **Item modal** — click item to open modal with +/- quantity selector, realtime price calculation
- **Cart side panel** — shows selected items, quantities, subtotals, remove button
- **Order summary modal** — review order, input Facebook name + character name, warning message, confirm button
- **Order history tab** — customer searches by Facebook name to view past orders and status
- **Stock protection** — customers cannot order more than available stock, uses Firestore transactions to prevent race conditions

### Admin (admin.html)

- **Password protected** — modal prompt on page load (default password: `peerapong`, set in `js/admin.js` line 6)
- **Order Board tab** — view all orders (Facebook, character name, items, total, status), change status (pending/completed/cancelled)
- **Product Management tab** — add/edit/delete products via modals
- **Stock system** — "+" button to add stock with person's name logged, eye icon to view stock addition history (who added how much and when)
- **Inline validation** — red error text under input fields instead of alert popups

## Firestore Collections

### `items`
```
{
  name: string,          // item name
  price: number,         // price per unit (baht)
  stock: number,         // current stock quantity
  image: string,         // path to image (e.g. "assets/item1.png")
  createdAt: timestamp
}
```

### `items/{id}/stockHistory` (subcollection)
```
{
  qty: number,           // quantity added
  addedBy: string,       // name of person who added stock
  createdAt: timestamp
}
```

### `orders`
```
{
  facebook: string,      // customer's Facebook name
  characterName: string, // in-game character name
  items: [{              // ordered items array
    itemId, name, price, qty, subtotal
  }],
  totalPrice: number,
  status: string,        // "pending" | "completed" | "cancelled"
  createdAt: timestamp
}
```

## Setup (for new developers)

### Prerequisites
- Node.js installed
- Firebase CLI: `npm install -g firebase-tools`

### Steps

1. **Clone the repo**
   ```bash
   git clone https://github.com/PeerapongMala/talesrunner.git
   cd talesrunner
   ```

2. **Firebase login**
   ```bash
   firebase login
   ```

3. **Update Firebase config** (if using a different project)
   - Edit `js/firebase-config.js` with your Firebase project config
   - Edit `.firebaserc` with your project ID

4. **Add item images**
   - Place images in `assets/` folder
   - Use English filenames only (e.g. `item1.png`, not Thai)

5. **Local development**
   ```bash
   firebase serve --only hosting
   ```
   Opens at `http://localhost:5000`

6. **Deploy**
   ```bash
   firebase deploy
   ```

## Important Notes

- **Image filenames must be in English** — Thai filenames break on Firebase Hosting URL encoding
- **Admin password** is hardcoded in `js/admin.js` (line 6) — change it for production
- **Firestore rules** are currently open (read/write: true) — tighten for production
- **Stock deduction** uses Firestore transactions to handle concurrent orders safely
