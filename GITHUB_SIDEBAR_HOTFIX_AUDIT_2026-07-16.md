# GitHub and Dashboard Sidebar Hotfix Audit — 2026-07-16

## Changes
- Added independent sidebar menu scrolling to dashboard pages.
- Added visible up/down sidebar scroll buttons when menu content exceeds available height.
- Kept Logout separate and fixed below the scrollable menu.
- Removed the customer Support menu item that was overlapping Logout.
- Replaced the Connect GitHub symbol with the official GitHub mark SVG.
- Added connected-account text to the GitHub button after successful connection.
- Fixed hosting dashboard null-element JavaScript errors.
- Added GitHub callback aliases for `/api/github/callback`, trailing slash, and `/api/hosting/github/callback`.
- Added `/api/github/status` route for deployment verification.

## Validation
- Frontend app JavaScript syntax: passed.
- Hosting dashboard JavaScript syntax: passed.
- Backend server JavaScript syntax: passed.
- Root npm check: passed.
- Existing user, staff and admin authorization logic was not changed.
