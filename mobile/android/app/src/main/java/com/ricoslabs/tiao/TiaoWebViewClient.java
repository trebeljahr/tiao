package com.ricoslabs.tiao;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.IOException;
import java.io.InputStream;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Serves each route's own page from the static export instead of Capacitor's single-page
 * fallback. The request URL keeps the real path (so the client router and back navigation see
 * it); only the file Capacitor's local server reads is swapped. See {@link TiaoRoutes}.
 */
public class TiaoWebViewClient extends BridgeWebViewClient {

    private static final String ASSET_ROOT = "public";
    private final Bridge bridge;
    private final AssetManager assets;
    private final Map<String, Boolean> existsCache = new ConcurrentHashMap<>();

    public TiaoWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
        this.assets = bridge.getContext().getAssets();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String path = url.getPath();
        boolean bundled =
            bridge.getServerUrl() == null &&
            bridge.getHost().equals(url.getHost()) &&
            bridge.getScheme().equals(url.getScheme()) &&
            path != null &&
            !path.startsWith("/_capacitor_");
        if (bundled) {
            String file = TiaoRoutes.resolve(path, this::assetExists);
            if (!file.equals(path)) {
                Uri rewritten = url.buildUpon().path(file).build();
                return bridge.getLocalServer().shouldInterceptRequest(new RewrittenRequest(request, rewritten));
            }
        }
        return super.shouldInterceptRequest(view, request);
    }

    private boolean assetExists(String webPath) {
        return existsCache.computeIfAbsent(webPath, (key) -> {
            try (InputStream ignored = assets.open(ASSET_ROOT + key)) {
                return true;
            } catch (IOException e) {
                return false;
            }
        });
    }

    /** The original request with a different URL, so the local server reads another file. */
    private static final class RewrittenRequest implements WebResourceRequest {

        private final WebResourceRequest original;
        private final Uri url;

        RewrittenRequest(WebResourceRequest original, Uri url) {
            this.original = original;
            this.url = url;
        }

        @Override
        public Uri getUrl() {
            return url;
        }

        @Override
        public boolean isForMainFrame() {
            return original.isForMainFrame();
        }

        @Override
        public boolean isRedirect() {
            return original.isRedirect();
        }

        @Override
        public boolean hasGesture() {
            return original.hasGesture();
        }

        @Override
        public String getMethod() {
            return original.getMethod();
        }

        @Override
        public Map<String, String> getRequestHeaders() {
            return original.getRequestHeaders();
        }
    }
}
