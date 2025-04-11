# NovaNews Server API

This is the backend API server for the NovaNews application.

## How to Deploy to Glitch

1. Go to [Glitch.com](https://glitch.com) and sign up or log in
2. Click "New Project" and select "Import from GitHub"
3. Enter the repository URL: `https://github.com/Sharif-Hamza/novanews.git`
4. Once imported, go to the `.env` file and ensure it has:
   ```
   PORT=3000
   SUPABASE_URL=https://oqxqaztfetfxpjxcvuei.supabase.co
   SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xeHFhenRmZXRmeHBqeGN2dWVpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQxNDk2ODYsImV4cCI6MjA1OTcyNTY4Nn0.WdzeqC0yNnrtqxM_umd2CYwM8PEFrO0HEKoLRhWa2Vo
   ```
5. Glitch will automatically install dependencies and start the server

## Manual Deployment Steps

1. Install dependencies:
   ```
   npm install
   ```

2. Start the server:
   ```
   npm start
   ```

## API Endpoints

- `GET /`: API health check
- `GET /meta.json`: API information
- `GET /api/article-count`: Get article count and next update time
- `GET /api/check-articles`: Check for articles in the database
- `GET /api/news`: Get latest news articles
- `GET /api/stocks`: Get stock market data
- `GET /api/crypto`: Get cryptocurrency data
- `GET /api/crypto-news`: Get cryptocurrency news
- `GET /api/lifecycle-status`: Get article lifecycle status

## Frontend Configuration

In your frontend project, set the API_URL environment variable to your Glitch project URL:

```
API_URL=https://your-project-name.glitch.me
```

For local development, the API uses port 3005 by default. 