# World Net Hosting Security and Dashboard Scroll Audit

## Repairs applied

- Restored mouse-wheel and touchpad scrolling across the complete dashboard sidebar, including when the pointer is over menu links or the scroll buttons.
- Prevented wheel trapping at the top and bottom of the sidebar so normal page scrolling can continue when the menu cannot move further.
- Forced the dashboard menu viewport to remain vertically scrollable on desktop and mobile.
- Fixed an existing JavaScript syntax error in `dashboard-shell.js` caused by apostrophes inside reseller menu labels.
- Removed the numeric text from the domain result heading. It now shows only `Live domain result` or `Live domain results`.
- Strengthened frontend response headers with HSTS, `object-src 'none'`, Cross-Origin Resource Policy, and automatic insecure-request upgrades.

## Dangerous-site code audit

The source tree was checked for executable downloads, archive downloads, obvious obfuscated JavaScript, `eval`, `new Function`, `document.write`, unknown external form actions, insecure HTTP resources, and unexpected external iframes. No executable/download payloads were found in the frontend tree. The project uses same-origin dashboard iframes and the expected Paystack checkout/API domains.

A Chrome `Dangerous` warning is controlled by Google Safe Browsing. Code cleanup alone cannot remove an existing classification. After deployment, verify the exact Render frontend property in Google Search Console, open **Security & Manual Actions → Security issues**, repair every URL Google lists, and request a review. Also verify that the deployed Render service contains only this clean build and that no older malicious or deceptive route remains available.
