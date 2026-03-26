Three things, in order:

1. MT5 must be open and logged in

2. Terminal 1 — Frontend:


cd "c:\Users\locks\OneDrive\Documents\Trading engagement and dashboard"
npm run dev
3. Terminal 2 — API:


cd "c:\Users\locks\OneDrive\Documents\Trading engagement and dashboard\backend"
uvicorn api:app --reload --port 8000
Then open whatever localhost URL Vite prints (5173 or 5174).

That's it — all three must be running at the same time.