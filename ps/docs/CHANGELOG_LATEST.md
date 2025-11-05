## Latest Changes (11/5/2025)

- **v0.8.7 - Critical Fix: Zone Template EJS Syntax Error** (f6ec015) - Scott
  - Fixed zone.ejs line 166: Changed <%= to <%- for characterData
  - Issue: HTML escaping was breaking JSON syntax (&amp; instead of &)
  - Added Socket.IO client library to zone.ejs
  - Implemented proper script loading order with defer attribute
  - Zone pages now load correctly at /universe/zone/:zoneId
- **socket location stable** (fb9a7f1) - Scott
- **Refactor: Socket.IO player coordinates and galactic level standardization** (b3517f1) - Scott
- **v0.8.6 - Infrastructure & Documentation Organization** (ac723ba) - Scott
- **commit 8.0.6** (c965686) - Scott
- **commit** (57d9668) - Scott

