# Card Balance Apps Script bridge

`Code.gs` is the source of the existing Apps Script deployment used by the PWA API. It keeps the approval-email behavior and adds the authenticated balance bridge required because Cloudflare cannot validate the upstream AB TLS chain.

The bridge accepts only a Firebase ID token and a matching approved Web installation request. Firestore Security Rules still enforce request ownership. No service-account key or administrator token is stored in this repository.

Deploy updates as a new version of the existing Web app so its `/exec` URL remains unchanged.
