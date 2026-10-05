// Inlined into client/.next-mobile/index.html by write-index-redirect.sh.
// The native routers (TiaoRoutes) serve this root shell for "/" and for any
// path with no matching page, so it sends the user to a real home page:
//   /                    -> /<device locale>/
//   /<locale>/<unknown>  -> /<locale>/
//   /<unknown>           -> /<device locale>/
// Every target is a real page, so the shell never redirects to itself.
(() => {
  var supported = ["en", "de", "es"];
  var fallback = "en";
  var raw = (navigator.language || navigator.userLanguage || fallback).toLowerCase();
  var primary = raw.split("-")[0];
  var locale = supported.indexOf(primary) >= 0 ? primary : fallback;
  var first = location.pathname.split("/").filter(Boolean)[0];
  if (supported.indexOf(first) >= 0) locale = first;
  location.replace("/" + locale + "/");
})();
