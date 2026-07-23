# World Net Hosting

The project contains two independent services.

## Frontend
```powershell
cd frontend
npm install
npm start
```
Local frontend URL: `https://world-net-hosting-frontend.onrender.com`

## Backend
```powershell
cd backend
npm install
npm start
```
Local API URL: `https://world-net-hosting-backend.onrender.com/api`

Deploy the frontend and backend as separate Render services. Set `FRONTEND_URL` and `PAYSTACK_CALLBACK_URL` in the backend environment to the live frontend address.
