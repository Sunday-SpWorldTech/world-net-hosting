# Final API and Mobile Update

- Reseller API credential actions update immediately without a manual browser refresh.
- Test and live cards show public key, secret key, base URL, callback link, copy controls, and delete control.
- New API secrets are encrypted at rest and remain available only to the authenticated reseller owner.
- Existing credentials created before encrypted-secret storage cannot be reconstructed from their one-way hash; delete and regenerate those credentials once to make the secret persistently available.
- API credential responses use `Cache-Control: no-store`.
- Every public HTML page loads the shared application script, and pages without a navigation header receive the complete responsive public navigation automatically.
- Existing dashboard mobile sidebar behavior remains unchanged and available across dashboard pages.
- Recommended production environment variable: `API_CREDENTIAL_ENCRYPTION_KEY` with at least 32 random characters. If omitted, the backend derives the encryption key from the existing `JWT_SECRET`.
