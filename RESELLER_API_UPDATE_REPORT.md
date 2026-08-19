# Reseller API Sections Update

## Scope
Only reseller API credential management was changed.

## Completed
- Test and live Domain API credentials remain attached to the authenticated reseller account until that reseller deletes them.
- Test and live Banking API credentials remain attached to the authenticated reseller account until that reseller deletes them.
- Generating credentials when a key already exists no longer rotates or replaces it.
- Copy Key and Delete Key controls appear for existing test and live keys.
- New credentials provide one-time Copy controls for public key, secret key, and base URL.
- Credential deletion uses an authenticated owner-scoped backend DELETE route.
- Deletion clears both the public key and its secret hash.
- A confirmation warning explains that deleting a key immediately stops applications using it.
- Mobile layouts stack credential action buttons professionally.

## Security
- Secret keys remain hashed in the database.
- Existing secret keys are not re-displayed.
- Only the signed-in reseller who owns the profile, or an authorized admin operating under the existing reseller middleware, can manage that profile's credentials.
- Live credential creation still requires live provider approval and configuration.
