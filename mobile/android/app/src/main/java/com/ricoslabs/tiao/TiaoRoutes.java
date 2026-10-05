package com.ricoslabs.tiao;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.function.Predicate;

/**
 * Maps a WebView request path onto a file in the bundled Next.js static export.
 *
 * <p>Capacitor's local server serves the root {@code index.html} for every path without a file
 * extension. The static export instead has one {@code index.html} per route ({@code
 * trailingSlash: true}) under a locale folder, and the dynamic routes ({@code /game/[gameId]} and
 * friends) exist only as a {@code __spa__} placeholder page. The rules:
 *
 * <ol>
 *   <li>A path without an extension means that route's {@code index.html}.
 *   <li>A path without a locale means the default locale ({@code en}), as with next-intl's {@code
 *       localePrefix: "as-needed"} on the web.
 *   <li>A dynamic route's param segment is replaced by {@code __spa__}; the client reads the real
 *       value from the URL ({@code useDynamicParam}).
 *   <li>Anything else: the root shell for pages, the path as-is (404) for files.
 * </ol>
 *
 * <p>Mirrors the iOS {@code TiaoRoutes.swift}; both are tested against {@code
 * mobile/scripts/routes-cases.txt}.
 */
final class TiaoRoutes {

    static final String PLACEHOLDER = "__spa__";
    private static final List<String> LOCALES = Arrays.asList("en", "de", "es");
    private static final String DEFAULT_LOCALE = "en";

    /** Route prefixes after the locale whose next segment is a dynamic param. */
    private static final List<List<String>> DYNAMIC_ROUTES = Arrays.asList(
        Arrays.asList("game"),
        Arrays.asList("profile"),
        Arrays.asList("tournament"),
        Arrays.asList("embed", "game")
    );

    private TiaoRoutes() {}

    /**
     * @param path request path, already percent-decoded, e.g. {@code /en/game/ABC/}
     * @param exists whether a web-root-relative path (leading {@code /}) is a bundled file
     * @return the web-root-relative file to serve
     */
    static String resolve(String path, Predicate<String> exists) {
        List<String> segments = new ArrayList<>();
        for (String s : path == null ? new String[0] : path.split("/")) {
            if (!s.isEmpty()) segments.add(s);
        }
        if (segments.isEmpty() || segments.contains(".") || segments.contains("..")) return "/index.html";
        boolean hasExtension = segments.get(segments.size() - 1).contains(".");

        List<List<String>> bases = new ArrayList<>();
        bases.add(segments);
        if (!LOCALES.contains(segments.get(0))) {
            List<String> prefixed = new ArrayList<>();
            prefixed.add(DEFAULT_LOCALE);
            prefixed.addAll(segments);
            bases.add(prefixed);
        }
        for (List<String> base : bases) {
            String exact = file(base, hasExtension);
            if (exists.test(exact)) return exact;
            // Directory segments only: with an extension the last segment is the file name.
            int directoryCount = hasExtension ? base.size() - 1 : base.size();
            for (List<String> route : DYNAMIC_ROUTES) {
                int paramIndex = 1 + route.size();
                if (paramIndex >= directoryCount || !base.subList(1, paramIndex).equals(route)) continue;
                List<String> rewritten = new ArrayList<>(base);
                rewritten.set(paramIndex, PLACEHOLDER);
                String candidate = file(rewritten, hasExtension);
                if (exists.test(candidate)) return candidate;
            }
        }
        return hasExtension ? file(segments, true) : "/index.html";
    }

    private static String file(List<String> parts, boolean hasExtension) {
        String joined = "/" + String.join("/", parts);
        return hasExtension ? joined : joined + "/index.html";
    }
}
