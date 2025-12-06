# Global Configuration

This folder contains the **single global .env file** used by both frontend and backend.

## Structure

```
config/
├── .env         # Single source of truth for all environment variables (git-ignored)
├── .env.example # Template showing all required variables
└── README.md    # This file
```

## Why Global Configuration?

**Benefits:**
- ✅ **Single Source of Truth**: One .env file to maintain
- ✅ **No Duplication**: No need to sync multiple .env files
- ✅ **Centralized Management**: All credentials in one place
- ✅ **Easier Deployment**: Set environment variables once
- ✅ **Better Security**: Single file to protect

## How It Works

### Backend
The backend loads the global config automatically via `backend/config/settings.py`:

```python
# Loads from root config/.env
root_dir = Path(__file__).parent.parent.parent
env_path = root_dir / "config" / ".env"
load_dotenv(dotenv_path=env_path)
```

### Frontend
If your frontend needs environment variables, configure Next.js to reference the global config:
- Use `NEXT_PUBLIC_` prefix for client-side variables
- Backend proxy pattern recommended for sensitive API calls

## Setup Instructions

1. **Copy the template:**
   ```bash
   copy config\.env.example config\.env
   ```

2. **Add your credentials:**
   Edit `config/.env` with your actual API keys and tokens.

3. **Never commit .env:**
   The `.gitignore` already excludes `config/.env`

## Environment Variables

See [.env.example](config/.env.example) for all required variables:
- Zerodha API credentials
- Twilio WhatsApp configuration
- OpenAI API key
- Server settings
- Alert configuration

## Security

⚠️ **IMPORTANT**: 
- Never commit `config/.env` to version control
- Regenerate all exposed API keys before deployment
- Use platform environment variables in production (Render, Netlify, etc.)

For detailed security guidelines, see [docs/SECURITY.md](../docs/SECURITY.md)
