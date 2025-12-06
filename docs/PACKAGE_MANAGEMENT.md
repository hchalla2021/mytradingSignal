# Global Package Management

This project uses **npm workspaces** for centralized dependency management.

## Structure

```
mytradingSignal/
├── package.json              # 🌍 Global package.json (root)
├── node_modules/             # All dependencies installed here
└── frontend/
    ├── package.json          # Minimal workspace config
    └── node_modules/         # Symlinked to root
```

## Benefits

- ✅ **Single node_modules**: One location for all packages
- ✅ **Faster installs**: No duplicate dependencies
- ✅ **Easier updates**: Manage versions in one place
- ✅ **Smaller disk usage**: No redundant packages
- ✅ **Consistent versions**: Same packages everywhere

## Available Scripts (from root)

### Development
```bash
npm run dev              # Start frontend dev server
npm run start:backend    # Start Python backend
npm run start:frontend   # Start Next.js frontend
npm run start:all        # Start both (requires concurrently)
```

### Production
```bash
npm run build            # Build frontend for production
npm run start            # Start production server
```

### Installation
```bash
npm install              # Install all dependencies
npm run install:all      # Install both npm and pip dependencies
```

### Linting
```bash
npm run lint             # Run Next.js linter
```

## How It Works

### NPM Workspaces
The root `package.json` defines workspaces:
```json
{
  "workspaces": ["frontend"]
}
```

This tells npm to:
1. Install all dependencies in root `node_modules`
2. Symlink `frontend/node_modules` → `../node_modules`
3. Allow running workspace-specific scripts from root

### Running Commands
```bash
# From root - runs frontend dev server
npm run dev

# Equivalent to:
cd frontend && npm run dev

# But uses root dependencies
```

## Migration from Old Structure

### Before (Duplicate Dependencies)
```
frontend/
├── package.json          # All dependencies here
└── node_modules/         # ~300MB of packages
```

### After (Workspace)
```
package.json              # All dependencies here
node_modules/             # ~300MB (one copy)
frontend/
└── package.json          # Just scripts
```

## Adding New Packages

### Frontend Packages
```bash
# From root
npm install package-name --workspace=frontend

# Or from frontend directory
cd frontend && npm install package-name
```

### Global Dev Tools
```bash
# From root
npm install -D package-name
```

## Troubleshooting

### "Cannot find module"
```bash
# Reinstall dependencies
npm install
```

### Workspace Not Found
```bash
# Verify workspace configuration
npm run dev --workspace=frontend
```

### Port Already in Use
```bash
# Frontend (default: 3000)
npm run dev -- -p 3001
```

## Deployment Notes

- **Netlify/Vercel**: Automatically detects workspace setup
- **Render**: Use `npm install && npm run build` as build command
- **Root directory**: Set to `mytradingSignal` (not `frontend`)
- **Publish directory**: `frontend/.next` or `frontend/out`

## Security

Run security audits from root:
```bash
npm audit
npm audit fix
```

All workspaces share the same dependency tree for consistent security.
