# Public and Dashboard Mobile Menu Structure Fix

- Normalized every public `header.top-nav` so the logo and menu button are direct header children.
- Kept only `.nav-left` and `.nav-right` collapsible on mobile.
- Added a runtime guard in `assets/js/app.js` for older or dynamically injected headers.
- Added narrowly scoped mobile CSS that does not affect domain search, banking, authentication, reseller pricing, API routes, or dashboard permissions.
- Preserved the existing separate dashboard off-canvas menu implementation.
