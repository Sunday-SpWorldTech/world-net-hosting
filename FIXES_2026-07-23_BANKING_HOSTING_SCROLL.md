# Banking, Projects, Domain Loading and Sidebar Scroll Repair

- Repaired legacy wallet documents that were missing the required email/currency fields.
- Added safe conversion for Mongoose Map wallet balances.
- Removed the destructive cleanup query from the Projects list endpoint.
- Added one controlled retry for transient Render 502/503/504 and network wake-up failures.
- Replaced misleading generic reconnect messages with the real backend error.
- Removed the public domain-search waiting text and replaced it with an accessible compact spinner.
- Added mouse-wheel, touchpad and touch scrolling to the dashboard sidebar while keeping the arrow controls.
- Rebuilt frontend/dist and synchronized backend/public.
