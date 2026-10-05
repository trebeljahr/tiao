import Foundation

/// Maps a WebView request path onto a file in the bundled Next.js static export.
///
/// Capacitor's default router serves the root `index.html` for every path
/// without a file extension. The static export instead has one
/// `index.html` per route (`trailingSlash: true`) under a locale folder,
/// and the dynamic routes (`/game/[gameId]` and friends) exist only as a
/// `__spa__` placeholder page. The rules:
///
/// 1. A path without an extension means that route's `index.html`.
/// 2. A path without a locale means the default locale (`en`), as with
///    next-intl's `localePrefix: "as-needed"` on the web.
/// 3. A dynamic route's param segment is replaced by `__spa__`; the client
///    reads the real value from the URL (`useDynamicParam`).
/// 4. Anything else: the root shell for pages, the path as-is (404) for files.
///
/// Mirrors the Android `TiaoRoutes.java`; both are tested against
/// `mobile/scripts/routes-cases.txt`.
enum TiaoRoutes {
    static let placeholder = "__spa__"
    static let locales = ["en", "de", "es"]
    static let defaultLocale = "en"
    /// Route prefixes after the locale whose next segment is a dynamic param.
    static let dynamicRoutes: [[String]] = [["game"], ["profile"], ["tournament"], ["embed", "game"]]

    /// - Parameters:
    ///   - path: Request path, already percent-decoded, e.g. `/en/game/ABC/`.
    ///   - exists: Whether a web-root-relative path (leading `/`) is a bundled file.
    /// - Returns: The web-root-relative file to serve.
    static func resolve(_ path: String, exists: (String) -> Bool) -> String {
        let segments = path.split(separator: "/").map(String.init)
        if segments.isEmpty || segments.contains(where: { $0 == "." || $0 == ".." }) {
            return "/index.html"
        }
        let hasExtension = segments[segments.count - 1].contains(".")
        func file(_ parts: [String]) -> String {
            let joined = "/" + parts.joined(separator: "/")
            return hasExtension ? joined : joined + "/index.html"
        }
        var bases = [segments]
        if !locales.contains(segments[0]) { bases.append([defaultLocale] + segments) }
        for base in bases {
            let exact = file(base)
            if exists(exact) { return exact }
            // Directory segments only: with an extension the last segment is the file name.
            let directoryCount = hasExtension ? base.count - 1 : base.count
            for route in dynamicRoutes {
                let paramIndex = 1 + route.count
                guard paramIndex < directoryCount, Array(base[1..<paramIndex]) == route else { continue }
                var rewritten = base
                rewritten[paramIndex] = placeholder
                let candidate = file(rewritten)
                if exists(candidate) { return candidate }
            }
        }
        return hasExtension ? file(segments) : "/index.html"
    }
}
