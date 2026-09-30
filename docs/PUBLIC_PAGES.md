# Public pages and application entry

The web root is a server-rendered introduction to Tiao. `/rules` contains the
illustrated standard rules. Both have English, German, and Spanish versions,
canonical URLs, language alternates, social metadata, and sitemap entries.

The application lobby is `/play`. Application navigation and the PWA launch URL
point there. Existing game URLs remain valid. Desktop and mobile static builds
still render the lobby at their existing root launch URL as well as `/play`.

## Session behavior

Public pages check an existing session through `AuthProvider` without creating a
guest or mounting the lobby socket providers. The home page replaces its URL with
localized `/play` when an account session is verified. Guest identities do not
trigger this redirect. Accounts that require a username use the existing
onboarding guard. The rules remain readable by signed-in players.

The redirect preserves query strings and fragments. Legacy `/#invitations` links
also enter the lobby. A failed session check leaves public content visible.
Entering an application route enables the usual guest bootstrap.

## Search verification after deployment

Local validation cannot verify a Google Search Console property or request
indexing of unpublished pages. The owner should use an existing verified
`playtiao.com` property, or verify a domain property with Google's DNS record.
No Search Console credentials or verification tokens belong in this repository.

After deployment:

1. Submit `https://playtiao.com/sitemap.xml` in Search Console.
2. Inspect `/`, `/rules`, and their `/de` and `/es` equivalents. Check the rendered
   content and Google's selected canonical URL.
3. Request indexing for the new public pages.
4. Review queries, impressions, and clicks after Google collects data. Compare
   searches for Tiao with broader searches, and use those results to choose
   further content.

The sitemap helps discovery; it does not guarantee indexing or rankings.
