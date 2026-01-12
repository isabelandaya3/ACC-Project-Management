# OAuth Configuration - Autodesk ACC

## Credentials Configured

Your Autodesk ACC OAuth credentials have been successfully configured in the `.env` file:

```
Client ID:      dm05OdlHcCueXbemPOz406tAiPlTlQQrivSs6NssrFPteiGc
Client Secret:  m2noZOUtCst7eka0AzksqBsmrgQ96rL3ZV3fwdvLPBuPb8FDoy0YlKb25JMOVMvT
Callback URL:   http://localhost:3001/auth/callback
```

## File Locations

- **Active config:** `server/.env` (contains your credentials)
- **Template:** `server/.env.example` (safe to commit to git)
- **Git ignore:** `server/.gitignore` (ensures .env is never committed)
- **Config loader:** `server/src/config/index.ts` (loads environment variables)

## Security Notes

### ⚠️ IMPORTANT: Keep Credentials Secure

1. **Never commit `.env` to git** - Already configured in `.gitignore`
2. **Rotate secrets regularly** - Change client secret periodically
3. **Use different credentials for production** - Generate new credentials for prod environment
4. **Restrict callback URLs** - In Autodesk console, only allow trusted domains

### Production Deployment

When deploying to production:

1. Generate new OAuth credentials in Autodesk console for your production domain
2. Update callback URL to your production domain (e.g., `https://yourdomain.com/auth/callback`)
3. Set environment variables via your hosting platform (don't use .env file)
4. Use strong encryption keys:
   ```bash
   # Generate secure keys
   openssl rand -hex 32  # For TOKEN_ENCRYPTION_KEY
   openssl rand -hex 64  # For SESSION_SECRET
   ```

## OAuth Flow

### 1. Authorization Request

User clicks "Connect to ACC" button:

```
GET https://developer.api.autodesk.com/authentication/v2/authorize
  ?response_type=code
  &client_id=dm05OdlHcCueXbemPOz406tAiPlTlQQrivSs6NssrFPteiGc
  &redirect_uri=http://localhost:3001/auth/callback
  &scope=data:read data:write data:create account:read user:read user-profile:read
```

### 2. User Authorizes

- User logs into Autodesk account
- Grants permissions to your app
- Autodesk redirects back to callback URL with authorization code

### 3. Token Exchange

Your server exchanges the code for access token:

```typescript
POST https://developer.api.autodesk.com/authentication/v2/token
  Content-Type: application/x-www-form-urlencoded
  
  grant_type=authorization_code
  &code={authorization_code}
  &client_id=dm05OdlHcCueXbemPOz406tAiPlTlQQrivSs6NssrFPteiGc
  &client_secret=m2noZOUtCst7eka0AzksqBsmrgQ96rL3ZV3fwdvLPBuPb8FDoy0YlKb25JMOVMvT
  &redirect_uri=http://localhost:3001/auth/callback
```

### 4. Store Tokens

Response contains:
```json
{
  "access_token": "eyJhbGc...",
  "refresh_token": "abc123...",
  "expires_in": 3599,
  "token_type": "Bearer"
}
```

Store in database (`AccOAuthToken` table) with encryption.

### 5. Use Access Token

Make API requests with token:

```typescript
GET https://developer.api.autodesk.com/project/v1/hubs
  Authorization: Bearer {access_token}
```

### 6. Refresh Token

When access token expires (after ~1 hour):

```typescript
POST https://developer.api.autodesk.com/authentication/v2/token
  Content-Type: application/x-www-form-urlencoded
  
  grant_type=refresh_token
  &refresh_token={refresh_token}
  &client_id=dm05OdlHcCueXbemPOz406tAiPlTlQQrivSs6NssrFPteiGc
  &client_secret=m2noZOUtCst7eka0AzksqBsmrgQ96rL3ZV3fwdvLPBuPb8FDoy0YlKb25JMOVMvT
```

## Required Scopes

Your app requests these permissions:

| Scope | Purpose |
|-------|---------|
| `data:read` | Read files and folders from ACC |
| `data:write` | Download PDFs and attachments |
| `data:create` | Upload response files to ACC |
| `account:read` | Access ACC projects and hubs |
| `user:read` | Get user information |
| `user-profile:read` | Display user name and email |

## Callback URL Configuration

### Development
```
http://localhost:3001/auth/callback
```

### Production Examples
```
https://yourdomain.com/auth/callback
https://api.yourdomain.com/auth/callback
```

**Note:** Must match exactly in:
1. Autodesk console settings
2. Your `.env` file
3. Frontend redirect configuration

## Testing OAuth Flow

### Verify Configuration

Run the config validator:
```bash
cd server
npm run validate-config
```

Expected output:
```
✅ Configuration validation passed
Autodesk Client ID configured: dm05OdlHc...
Autodesk Client Secret configured
Callback URL configured: http://localhost:3001/auth/callback
```

### Test Authorization

1. Start the server:
   ```bash
   npm run dev
   ```

2. Navigate to:
   ```
   http://localhost:3001/auth/login
   ```

3. Should redirect to Autodesk login
4. After login, redirects back to `/auth/callback`
5. Check database for new `AccOAuthToken` record

### Manual Token Test

Use curl to test token exchange:

```bash
curl -X POST https://developer.api.autodesk.com/authentication/v2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=YOUR_AUTH_CODE" \
  -d "client_id=dm05OdlHcCueXbemPOz406tAiPlTlQQrivSs6NssrFPteiGc" \
  -d "client_secret=m2noZOUtCst7eka0AzksqBsmrgQ96rL3ZV3fwdvLPBuPb8FDoy0YlKb25JMOVMvT" \
  -d "redirect_uri=http://localhost:3001/auth/callback"
```

## Troubleshooting

### "Invalid client_id"
- Check that client ID exactly matches Autodesk console
- No extra spaces or line breaks
- Case-sensitive

### "Invalid redirect_uri"
- Must exactly match registered callback URL
- Check protocol (http vs https)
- Check port number
- No trailing slashes

### "Invalid client_secret"
- Verify secret in Autodesk console
- Check for copy/paste errors
- Ensure no line breaks in .env file

### "Invalid grant"
- Authorization code already used (codes are single-use)
- Code expired (valid for ~10 minutes)
- Request new authorization code

### Token Refresh Fails
- Refresh token expired (valid for ~14 days with no use)
- User revoked permissions
- Re-authenticate user

## Database Schema

Tokens are stored in `AccOAuthToken` table:

```prisma
model AccOAuthToken {
  id                String   @id @default(uuid())
  userId            String
  email             String
  firstName         String?
  lastName          String?
  
  accessToken       String   // Encrypted
  refreshToken      String   // Encrypted
  expiresAt         DateTime
  
  scope             String
  
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  
  user              User     @relation(...)
  accProjectLinks   AccProjectLink[]
}
```

## Next Steps

1. ✅ OAuth credentials configured
2. ⏭️ Implement auth routes (`/auth/login`, `/auth/callback`)
3. ⏭️ Implement token encryption/decryption
4. ⏭️ Implement token refresh logic
5. ⏭️ Test OAuth flow end-to-end
6. ⏭️ Build frontend OAuth button
7. ⏭️ Implement ACC API client functions

## Reference Links

- [Autodesk Authentication Guide](https://aps.autodesk.com/en/docs/oauth/v2/developers_guide/overview/)
- [OAuth 2.0 Specification](https://oauth.net/2/)
- [ACC API Documentation](https://aps.autodesk.com/en/docs/acc/v1/overview/)
