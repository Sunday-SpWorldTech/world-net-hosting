# World Net Hosting deployment

## Frontend service
Root directory: `frontend`

Build command:
```bash
npm install
```

Start command:
```bash
npm start
```

Set the frontend public URL in the backend environment:
```env
FRONTEND_URL=https://your-frontend-domain.onrender.com
PAYSTACK_CALLBACK_URL=https://your-frontend-domain.onrender.com/payment-success.html
```

## Backend service
Root directory: `backend`

Build command:
```bash
npm install
```

Start command:
```bash
npm start
```

The browser frontend connects to:
`https://world-net-hosting-backend.onrender.com/api`

For local development, frontend uses `https://world-net-hosting-backend.onrender.com/api` automatically.
