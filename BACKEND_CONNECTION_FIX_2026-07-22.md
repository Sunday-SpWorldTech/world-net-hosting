# Backend connection and GitHub sign-in update

Updated only backend-connected flows requested by the owner.

- Frontend API calls now use the generated `WORLDNET_CONFIG.API_BASE_URL` instead of a second hard-coded constant.
- General dashboard API calls and Project & Hosting calls now have a 45-second timeout and release loading states with a clear error.
- GitHub OAuth uses GitHub's verified email (`user:email`) and now completes sign-in directly to the requested user/staff dashboard instead of redirecting to the local PIN page.
- Existing username/password and administrator PIN flows remain unchanged.
- Domain provider searches remain limited to 12 names per request.
- No client IP address is sent as part of domain search, GitHub login, banking, or hosting payloads.

External services still require valid Render environment variables and active accounts: MongoDB, Domain Name API, GitHub OAuth App, GitHub App, Render API, and Paystack.
